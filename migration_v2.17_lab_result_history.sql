-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.17_lab_result_history.sql
-- Append-only Haematology/Chemistry result history
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--   results_hematology and results_chemistry are upserted with
--   {onConflict:'patient_id'} — there is at most ONE row per patient EVER
--   in either table. A second visit's results silently overwrite the
--   first visit's. Two consequences, both real:
--     1. Trend charts (Doctor Consultation's Last Vitals tab, Patient
--        History Timeline's trend card) query these tables expecting
--        multiple points, but can structurally never get more than one
--        row back per patient — so a "trend" has always been a single dot.
--     2. Delta-checking (runDeltaCheck() in index.html) compares the
--        incoming save against this same current-panel row. That row
--        still holds the true prior value at compare-time (the upsert
--        hasn't happened yet), so the individual comparison is correct —
--        but the value it's compared against is about to be destroyed,
--        so there is no way to compare against anything OLDER than one
--        save back, and no durable record of what the delta check saw.
--
-- WHAT THIS MIGRATION ADDS (additive only — nothing existing is touched)
--   results_hematology_history and results_chemistry_history: one row
--   per SAVE (not per patient), written in addition to the existing
--   upsert every time saveHemEntry()/saveChemEntry() saves — see
--   logResultHistory() in index.html, called from
--   saveResultWithSafetyChecks()'s doFinalize(). The current-panel
--   tables (results_hematology/results_chemistry) are NOT modified,
--   dropped, or repurposed — every existing read of them (printed
--   reports, the unified "All Results" viewer, critical-value flagging)
--   keeps working exactly as before, off the same "current panel" row.
--
--   Column lists below are reverse-engineered from the payload objects
--   saveHemEntry()/saveChemEntry() build in index.html (~line 9396 and
--   ~9408) — same approach migration_v2.8's header used, since no schema
--   .sql files ship in this checkout (see CLAUDE.md).
--
-- WHAT READS FROM THE NEW TABLES (see index.html changes in the same
-- commit as this migration)
--   - runDeltaCheck(): now reads the *_history table's most recent row
--     (ordered by recorded_at desc) as "the previous value", falling
--     back to the current-panel table if a patient has no history rows
--     yet (pre-migration data, or a deployment that hasn't applied this
--     migration yet — the client checks for that and degrades gracefully
--     rather than throwing).
--   - loadDocVitalsTrend() (Doctor Consultation → Last Vitals tab):
--     glucose sparkline now reads results_chemistry_history instead of
--     results_chemistry.
--   - loadPthTimeline() (Patient History Timeline trend card): hgb/wbc/
--     plt/creat/urea/fbs/alt/ast/alp/ggt trend now reads
--     results_hematology_history / results_chemistry_history instead of
--     the single-row current-panel tables.
--
-- RLS — same protection level as the source tables (migration_v2.8),
-- using its existing helper functions. These are new tables, so they get
-- their own policies here rather than being silently left open.
--
-- Idempotent — safe to re-run. This file only produces SQL for review;
-- it is not applied automatically. Run after migration_v2.8.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — results_hematology_history
-- ───────────────────────────────────────────────────────────────────────

create table if not exists public.results_hematology_history (
  id              bigint generated always as identity primary key,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  analyzer        text,
  analysis_date   date,
  notes           text,
  specimen        text,
  performed_by    uuid,
  has_critical    boolean,
  wbc numeric, rbc numeric, hgb numeric, hct numeric, mcv numeric, mch numeric,
  mchc numeric, rdw numeric, nrbc numeric, plt numeric, mpv numeric, pdw numeric,
  neut numeric, lymph numeric, mono numeric, eosi numeric, baso numeric,
  neut_abs numeric, lymph_abs numeric, mono_abs numeric, eosi_abs numeric, baso_abs numeric,
  pt numeric, inr numeric, aptt numeric, tt numeric, fibg numeric, ddimer numeric, esr numeric,
  blood_group     text,
  rh_factor       text,
  film_result     text,
  film_comment    text,
  is_verified     boolean,
  verified_at     timestamptz,
  recorded_at     timestamptz not null default now()
);

create index if not exists results_hematology_history_patient_idx
  on public.results_hematology_history (patient_id, recorded_at desc);

alter table public.results_hematology_history enable row level security;

drop policy if exists results_hematology_history_select on public.results_hematology_history;
create policy results_hematology_history_select on public.results_hematology_history
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists results_hematology_history_insert on public.results_hematology_history;
create policy results_hematology_history_insert on public.results_hematology_history
  for insert with check (public.is_admin() or public.is_lab_staff());

-- No update/delete policy anywhere in this file, on purpose — this table is
-- append-only by design. If a bad row needs correcting, that's a new
-- corrective row + admin-only manual cleanup, not an app-level update path.

revoke all on public.results_hematology_history from anon;
grant select, insert on public.results_hematology_history to authenticated;
grant usage, select on sequence results_hematology_history_id_seq to authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — results_chemistry_history
-- ───────────────────────────────────────────────────────────────────────

create table if not exists public.results_chemistry_history (
  id              bigint generated always as identity primary key,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  analyzer        text,
  analysis_date   date,
  notes           text,
  specimen        text,
  performed_by    uuid,
  has_critical    boolean,
  tbil numeric, dbil numeric, ibil numeric, alt numeric, ast numeric, alp numeric, ggt numeric,
  tp numeric, alb numeric, creat numeric, urea numeric, ua numeric, egfr numeric,
  na numeric, k numeric, cl numeric, co2 numeric, ca numeric, phos numeric, mg numeric,
  fbs numeric, rbs numeric, ppbs numeric, hba1c numeric, ins numeric, cpep numeric,
  tchol numeric, ldl numeric, hdl numeric, trig numeric,
  troponin_i numeric, hs_tnt numeric, ck numeric, ckmb numeric, nt_probnp numeric,
  hs_crp numeric, ldh numeric,
  is_verified     boolean,
  verified_at     timestamptz,
  recorded_at     timestamptz not null default now()
);

create index if not exists results_chemistry_history_patient_idx
  on public.results_chemistry_history (patient_id, recorded_at desc);

alter table public.results_chemistry_history enable row level security;

drop policy if exists results_chemistry_history_select on public.results_chemistry_history;
create policy results_chemistry_history_select on public.results_chemistry_history
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists results_chemistry_history_insert on public.results_chemistry_history;
create policy results_chemistry_history_insert on public.results_chemistry_history
  for insert with check (public.is_admin() or public.is_lab_staff());

revoke all on public.results_chemistry_history from anon;
grant select, insert on public.results_chemistry_history to authenticated;
grant usage, select on sequence results_chemistry_history_id_seq to authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — one-time backfill (optional but recommended)
-- ───────────────────────────────────────────────────────────────────────
-- Seeds one history row per existing patient from whatever is currently
-- sitting in the current-panel tables, so trend charts and delta-checking
-- have at least one real historical point immediately instead of staying
-- empty until each patient's next save. Guarded by NOT EXISTS so re-running
-- this migration never double-inserts. Safe to delete this section if you
-- would rather start history clean from the next save onward.

insert into public.results_hematology_history (
  patient_id, analyzer, analysis_date, notes, specimen, performed_by, has_critical,
  wbc, rbc, hgb, hct, mcv, mch, mchc, rdw, nrbc, plt, mpv, pdw,
  neut, lymph, mono, eosi, baso, neut_abs, lymph_abs, mono_abs, eosi_abs, baso_abs,
  pt, inr, aptt, tt, fibg, ddimer, esr,
  blood_group, rh_factor, film_result, film_comment, is_verified, verified_at, recorded_at
)
select
  r.patient_id, r.analyzer, r.analysis_date, r.notes, r.specimen, r.performed_by, r.has_critical,
  r.wbc, r.rbc, r.hgb, r.hct, r.mcv, r.mch, r.mchc, r.rdw, r.nrbc, r.plt, r.mpv, r.pdw,
  r.neut, r.lymph, r.mono, r.eosi, r.baso, r.neut_abs, r.lymph_abs, r.mono_abs, r.eosi_abs, r.baso_abs,
  r.pt, r.inr, r.aptt, r.tt, r.fibg, r.ddimer, r.esr,
  r.blood_group, r.rh_factor, r.film_result, r.film_comment, r.is_verified, r.verified_at,
  coalesce(r.created_at, now())
from public.results_hematology r
where not exists (
  select 1 from public.results_hematology_history h where h.patient_id = r.patient_id
);

insert into public.results_chemistry_history (
  patient_id, analyzer, analysis_date, notes, specimen, performed_by, has_critical,
  tbil, dbil, ibil, alt, ast, alp, ggt, tp, alb, creat, urea, ua, egfr,
  na, k, cl, co2, ca, phos, mg,
  fbs, rbs, ppbs, hba1c, ins, cpep,
  tchol, ldl, hdl, trig,
  troponin_i, hs_tnt, ck, ckmb, nt_probnp, hs_crp, ldh,
  is_verified, verified_at, recorded_at
)
select
  r.patient_id, r.analyzer, r.analysis_date, r.notes, r.specimen, r.performed_by, r.has_critical,
  r.tbil, r.dbil, r.ibil, r.alt, r.ast, r.alp, r.ggt, r.tp, r.alb, r.creat, r.urea, r.ua, r.egfr,
  r.na, r.k, r.cl, r.co2, r.ca, r.phos, r.mg,
  r.fbs, r.rbs, r.ppbs, r.hba1c, r.ins, r.cpep,
  r.tchol, r.ldl, r.hdl, r.trig,
  r.troponin_i, r.hs_tnt, r.ck, r.ckmb, r.nt_probnp, r.hs_crp, r.ldh,
  r.is_verified, r.verified_at,
  coalesce(r.created_at, now())
from public.results_chemistry r
where not exists (
  select 1 from public.results_chemistry_history h where h.patient_id = r.patient_id
);

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.17_lab_result_history.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select count(*) from public.results_hematology_history;
--   select count(*) from public.results_chemistry_history;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public'
--     and tablename in ('results_hematology_history','results_chemistry_history')
--     order by tablename, cmd;
-- ═══════════════════════════════════════════════════════════════════════
