-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.51_lab_investigation_history.sql
-- Patient Lab Investigation History — unified append-only EAV table
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST (see PR description / commit message for the full
-- write-up)
--   migration_v2.17_lab_result_history.sql already added
--   results_hematology_history / results_chemistry_history — append-only,
--   one WIDE row per save (same columns as the current-panel table), fed
--   by logResultHistory() from saveResultWithSafetyChecks()'s doFinalize().
--   BUT that shared save pipeline is only used by Haematology and
--   Chemistry — Serology, Immunology, Microbiology, PCR, Histopathology,
--   and Cytology each upsert directly in their own save*Entry() with no
--   history write at all. And critically: NO browsable UI exists anywhere
--   for either of the two history tables that DO exist today — they're
--   only ever read by runDeltaCheck() and two narrow sparkline widgets
--   (Doctor Consultation's glucose trend, Patient History Timeline's
--   hgb/wbc/plt/creat/urea/fbs/alt/ast/alp/ggt trend card).
--
-- WHY A NEW UNIFIED TABLE, NOT "extend the existing per-department wide
-- tables to the other 5 departments" (my first-draft answer to the user)
--   The requested browser (Phase 3) needs, in one query per patient:
--   "every test this patient has ever had, browsable BY TEST NAME across
--   all departments, or BY DATE across all departments." A per-department
--   WIDE table (one column per analyte) is the right shape for
--   runDeltaCheck()'s actual question — "what was THIS patient's last
--   Creatinine" — but it is the wrong shape for "list every test type
--   this patient has ever had, with every date it was performed," which
--   would otherwise mean querying 7 differently-shaped tables and
--   reassembling them client-side. This table is EAV (one row per
--   test/analyte per save), matching Phase 3's own browsing shape
--   directly. It does NOT replace or duplicate results_hematology_history/
--   results_chemistry_history — those keep serving Delta Check exactly as
--   before, untouched. Going forward, a Haematology/Chemistry save writes
--   to BOTH: its existing wide history row (Delta Check) AND rows here
--   (the investigation browser) — two different shapes because they serve
--   two genuinely different questions, not two competing mechanisms for
--   the same one.
--
-- WHAT THIS MIGRATION ADDS (additive only — nothing existing is touched,
-- migration_v2.17's tables are NOT modified)
--   lab_result_history: one row per (patient, test/analyte, save), written
--   by a new logLabResultHistory() in index.html, called from all 7
--   department save functions (Phase 2 — separate commit, not in this
--   migration). Current-panel tables (results_hematology etc.) and
--   migration_v2.17's two history tables are entirely unaffected.
--
-- COLUMN CHOICES
--   department: DEPT_META's short key ('hem','chem','sero','immuno',
--     'micro','pcr','histo','cyto') — same vocabulary index.html already
--     uses everywhere else, not the raw results_* table name.
--   test_code: the underlying field code (e.g. 'hgb','creat') where one
--     exists — lets the browser/trend-chart re-resolve RESULT_META/
--     getLabRefRange() for a field later (unit-system conversion etc.)
--     without re-deriving it from the label text. Null for narrative
--     fields (e.g. Histopathology's free-text diagnosis) that have no
--     underlying analyte code.
--   value / value_numeric: value is always populated (text, so a
--     qualitative result like "Reactive" or a narrative diagnosis fits
--     the same column as a numeric one); value_numeric is populated in
--     parallel whenever the result is actually numeric, so trend charts
--     and sorting never need to parse the text column.
--   ref_range_lo / ref_range_hi: numeric bounds for flagging, mirroring
--     RESULT_META's own {lo,hi} shape (getLabRefRange() in index.html) —
--     null for qualitative/narrative fields where a numeric range makes
--     no sense.
--   ref_range_text: a freeform display string for cases where lo/hi don't
--     apply (e.g. "Negative", "Non-reactive") or as a human-readable
--     mirror of lo–hi for numeric fields, computed at write time so the
--     browser never needs to re-derive it.
--   flag: 'H'/'L'/'N', null when not applicable. Computed and stored at
--     write time (not recomputed at read time) so a later reference-range
--     edit in the Reference Ranges admin page never silently re-flags
--     historical results that were never actually re-evaluated.
--   sample_id: this app's Lab No. (patients.lab_no) at time of save, not
--     a separate specimen-tracking id (this app doesn't have one).
--   mrn: denormalized snapshot from patients.mrn at insert time — lets the
--     browser query "every result for this person across every visit"
--     directly by mrn (same allIdsForMrn pattern runDeltaCheck()/
--     loadPthTimeline() already use, just avoiding that extra patients
--     lookup on every read of this table).
--   source_table: which current-panel table this row was derived from
--     (e.g. 'results_hematology') — audit/debugging trail back to the
--     row that was actually upserted.
--
-- NO BACKFILL IN THIS MIGRATION (unlike migration_v2.17, which backfilled
-- one row per patient from the then-current single-row tables). Unpacking
-- 7 structurally different current-panel tables (flat numeric columns,
-- qualitative text columns, and two genuinely nested jsonb shapes — PCR's
-- targets array, Histopathology's ihc_results object) into EAV rows via
-- one SQL script is materially riskier to get right blind than
-- migration_v2.17's straight column-for-column copy was. History starts
-- accumulating from the next save once Phase 2 wires each department's
-- save*Entry() to logLabResultHistory(). If a backfill of EXISTING
-- current-panel data is wanted, say so and it'll be scoped as its own
-- reviewed migration rather than folded in here.
--
-- RLS — same protection level and helper functions as migration_v2.17.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.50.
-- ═══════════════════════════════════════════════════════════════════════


create table if not exists public.lab_result_history (
  id               bigint generated always as identity primary key,
  patient_id       uuid not null references public.patients(id) on delete cascade,
  mrn              text,
  department       text not null,
  source_table     text,
  test_code        text,
  test_name        text not null,
  value            text,
  value_numeric    numeric,
  unit             text,
  ref_range_lo     numeric,
  ref_range_hi     numeric,
  ref_range_text   text,
  flag             text check (flag in ('H','L','N') or flag is null),
  is_verified      boolean not null default false,
  verified_by      uuid,
  verified_at      timestamptz,
  sample_id        text,
  created_by       uuid,
  saved_at         timestamptz not null default now()
);

-- Every read this feature does is scoped to one patient (test-type tree),
-- one patient+date (the detail table), or one mrn across visits — these
-- three indexes cover all three access patterns without a sequential scan.
create index if not exists lab_result_history_patient_idx
  on public.lab_result_history (patient_id, saved_at desc);

create index if not exists lab_result_history_patient_test_idx
  on public.lab_result_history (patient_id, test_code, saved_at desc);

create index if not exists lab_result_history_mrn_idx
  on public.lab_result_history (mrn, saved_at desc);

alter table public.lab_result_history enable row level security;

drop policy if exists lab_result_history_select on public.lab_result_history;
create policy lab_result_history_select on public.lab_result_history
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists lab_result_history_insert on public.lab_result_history;
create policy lab_result_history_insert on public.lab_result_history
  for insert with check (public.is_admin() or public.is_lab_staff());

-- No update/delete policy anywhere in this file, on purpose — this table
-- is append-only by design, same convention as migration_v2.17's two
-- history tables. A bad row is corrected with a new row, not an edit.

revoke all on public.lab_result_history from anon;
grant select, insert on public.lab_result_history to authenticated;
grant usage, select on sequence lab_result_history_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.51_lab_investigation_history.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select count(*) from public.lab_result_history;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'lab_result_history'
--     order by cmd;
-- ═══════════════════════════════════════════════════════════════════════
