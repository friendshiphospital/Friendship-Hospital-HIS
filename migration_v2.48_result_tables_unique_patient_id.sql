-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.48_result_tables_unique_patient_id.sql
-- Diagnose + (conditionally) restore the unique constraint on patient_id
-- for the 7 lab results_* tables that every save*Entry() function in
-- index.html upserts against with .upsert(payload, {onConflict:'patient_id'})
-- ═══════════════════════════════════════════════════════════════════════
--
-- CONTEXT: index.html's saveResultWithSafetyChecks() (Haematology/
-- Chemistry) and the six per-department save*Entry() functions (Serology,
-- Immunology, Microbiology, PCR, Histopathology, Cytology) all write via
-- .upsert(payload, {onConflict:'patient_id'}) — every one of these tables
-- is designed and documented throughout this codebase as ONE ROW PER
-- PATIENT. That upsert only works against a REAL unique constraint or
-- unique index on exactly {patient_id}; if the base schema (not part of
-- this checkout — see CLAUDE.md) never created one, or a prior manual
-- change to the database removed it, Postgrest throws
-- "no unique or exclusion constraint matching the ON CONFLICT
-- specification" for that upsert — the exact class of failure already
-- confirmed live on sample_records before its own redesign
-- (migration_v2.47, a DIFFERENT fix — that table intentionally moved to
-- MULTIPLE rows per patient and had its unique constraint dropped; this
-- migration does the opposite check for a different set of tables that
-- are intentionally still one-row-per-patient).
--
-- Paired with an index.html code fix (this same round) that makes a
-- failed .upsert() actually throw and show an error toast instead of
-- being silently swallowed — this migration is the other half: if the
-- constraint itself is missing, that fix will now correctly SURFACE the
-- failure, but the underlying save will still not work until the
-- constraint exists.
--
-- WHAT THIS MIGRATION DOES (all read-only reporting except the final
-- conditional ADD CONSTRAINT):
--   1. For each of the 7 tables, checks whether a unique constraint/index
--      on exactly {patient_id} already exists. If so: reports it and
--      skips (idempotent, safe to re-run).
--   2. If missing, first checks for duplicate patient_id rows (the same
--      pre-check migration_v2.47 used before altering sample_records).
--      If duplicates are found, reports every duplicated patient_id and
--      its row count via RAISE NOTICE and DOES NOT add the constraint for
--      that table — adding a unique constraint over duplicate data would
--      simply fail, and which duplicate row is "correct" to keep is a
--      clinical-data decision this migration will not guess at.
--   3. Only when a table has NO existing patient_id-only unique
--      constraint AND NO duplicate patient_id rows does it add
--      `unique (patient_id)`.
--
-- HOW TO READ THE OUTPUT: run this in the Supabase SQL editor and read
-- the NOTICE messages in the output pane (or Postgres log) — every table
-- gets exactly one of: "already has unique(patient_id) — skipping",
-- "added unique(patient_id)", or "HAS N DUPLICATE PATIENT_ID ROW(S) —
-- NOT adding constraint, needs manual review" followed by one line per
-- duplicated patient_id.
--
-- NOT applied automatically — for manual review and application in the
-- Supabase SQL editor, same as every other migration in this repo.
-- Idempotent — safe to re-run after resolving any reported duplicates.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  tbl text;
  has_constraint boolean;
  dup_count integer;
  dup_row record;
  tables text[] := array[
    'results_hematology','results_chemistry','results_serology',
    'results_microbiology','results_pcr','results_histopathology','results_cytology'
  ];
begin
  foreach tbl in array tables loop
    -- 1. Does a unique constraint/index on exactly {patient_id} already exist?
    select exists (
      select 1
      from pg_constraint
      where conrelid = ('public.'||tbl)::regclass
        and contype = 'u'
        and (select array_agg(attname::text order by attname)
             from pg_attribute
             where attrelid = conrelid and attnum = any(conkey)) = array['patient_id']
    ) or exists (
      select 1
      from pg_index
      where indrelid = ('public.'||tbl)::regclass
        and indisunique
        and (select array_agg(a.attname::text order by a.attname)
             from pg_attribute a
             where a.attrelid = indrelid and a.attnum = any(indkey::int[])) = array['patient_id']
    ) into has_constraint;

    if has_constraint then
      raise notice '%: already has unique(patient_id) — skipping', tbl;
      continue;
    end if;

    -- 2. Pre-check for duplicate patient_id rows before proposing the constraint.
    execute format('select count(*) from (select patient_id from %I group by patient_id having count(*) > 1) d', tbl)
      into dup_count;

    if dup_count > 0 then
      raise notice '%: HAS % DUPLICATE PATIENT_ID ROW(S) — NOT adding constraint, needs manual review', tbl, dup_count;
      for dup_row in execute format('select patient_id, count(*) as n from %I group by patient_id having count(*) > 1 order by n desc', tbl)
      loop
        raise notice '  %: patient_id=% has % rows', tbl, dup_row.patient_id, dup_row.n;
      end loop;
      continue;
    end if;

    -- 3. No existing constraint, no duplicates — safe to add.
    execute format('alter table public.%I add constraint %I unique (patient_id)', tbl, tbl||'_patient_id_key');
    raise notice '%: added unique(patient_id)', tbl;
  end loop;
end $$;
