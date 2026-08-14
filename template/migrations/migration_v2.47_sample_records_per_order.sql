-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.47_sample_records_per_order.sql
-- sample_records: allow one row per SPECIMEN/ORDER-BATCH, not one row
-- forced to be unique per patient
-- ═══════════════════════════════════════════════════════════════════════
--
-- ROOT CAUSE: sample_records has always been written and read as exactly
-- ONE row per patient_id (every insert path in index.html uses
-- .upsert(..., {onConflict:'patient_id'}), which only works against a real
-- unique constraint/index on that column). That's fine for a visit with a
-- single lab order, but a SECOND, later lab order for a DIFFERENT test
-- (e.g. the doctor adds an RFT mid-visit after the original CBC was
-- already collected, received, verified and released) had nowhere to go:
-- the existing row was already Released, and the app deliberately never
-- overwrites an in-progress/finished row's status (see the ignoreDuplicates
-- comment this replaces in _submitLabOrder(), index.html) -- so the new
-- test silently inherited the FIRST order's Released status and skipped
-- Sample Collection/Receipt entirely, becoming directly enterable in
-- Result Entry the moment payment cleared.
--
-- FIX: drop the unique constraint/index on sample_records(patient_id) so a
-- patient can have more than one row -- one per specimen/order-batch, the
-- same way a real lab issues a new accession per draw. index.html's
-- _submitLabOrder() now INSERTs a genuinely new Pending row whenever the
-- patient's most recent specimen has already moved past collection,
-- instead of upserting onto (and thereby either corrupting or being
-- silently ignored by) the existing one.
--
-- "Most recent row" identifies the CURRENT specimen (index.html's
-- getCurrentSampleRecord()/mostRecentSampleByPatient(), used consistently
-- by Worklist, Doctor's View Result gate, the Results Ready notification,
-- Release, and Sample Collection/Receipt) rather than adding a new
-- doctor_orders-batch foreign key column. Deliberate choice: one specimen
-- routinely satisfies SEVERAL simultaneously-ordered tests that share a
-- collection tube (see index.html's getRequiredTubes() -- e.g. CBC + ESR +
-- Blood Film all draw from one EDTA tube), so a rigid one-row-per-order FK
-- would misrepresent the real collection model; created_at ordering is
-- already the established pattern this codebase uses elsewhere for "the
-- current row" once a table can have more than one per patient (see
-- results_*_history tables, migration_v2.17).
--
-- A plain (non-unique) index on patient_id is added back so every existing
-- .eq('patient_id', ...) read stays fast now that the implicit unique
-- index is gone.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor. Apply AFTER
-- migration_v2.8 (sample_records RLS) and migration_v2.18 (payment
-- deferral columns), which this doesn't touch.
-- ═══════════════════════════════════════════════════════════════════════

-- Drop whatever unique constraint or unique index currently enforces
-- one-row-per-patient_id on sample_records, regardless of its name (the
-- base schema that created it isn't part of this checkout — see
-- CLAUDE.md — so its exact name can't be assumed). Only ever touches a
-- unique constraint/index whose columns are EXACTLY {patient_id}; a
-- composite or differently-scoped constraint is left alone.
do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.sample_records'::regclass
      and contype = 'u'
      and (select array_agg(attname::text order by attname)
           from pg_attribute
           where attrelid = conrelid and attnum = any(conkey)) = array['patient_id']
  loop
    execute format('alter table public.sample_records drop constraint %I', con.conname);
  end loop;

  for con in
    select indexrelid::regclass::text as indexname
    from pg_index
    where indrelid = 'public.sample_records'::regclass
      and indisunique
      and not indisprimary
      and (select array_agg(a.attname::text order by a.attname)
           from pg_attribute a
           where a.attrelid = indrelid and a.attnum = any(indkey::int[])) = array['patient_id']
  loop
    execute format('drop index if exists %s', con.indexname);
  end loop;
end $$;

create index if not exists sample_records_patient_id_idx on public.sample_records (patient_id);
create index if not exists sample_records_patient_id_created_at_idx on public.sample_records (patient_id, created_at desc);

comment on table public.sample_records is 'One row PER SPECIMEN/ORDER-BATCH (not per patient) — a patient with multiple lab orders across a visit has multiple rows. "Current" status for a patient is always the most recently created row; see index.html getCurrentSampleRecord()/mostRecentSampleByPatient().';
