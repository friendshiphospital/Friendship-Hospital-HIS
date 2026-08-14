-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.29_blood_bank_access.sql
-- Blood Bank / Transfusion Services, Phase 6 — access control
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   Every blood_* table added in Phases 1-5 already got its own RLS
--   policies in its own migration file (migration_v2.24 blood_units,
--   v2.25 blood_donors/blood_donations, v2.26 blood_requests, v2.27
--   blood_issue_log), reusing the existing helper functions from
--   migration_v2.8_rls_security.sql (is_admin(), is_clinical_staff(),
--   is_lab_staff()) throughout — no new helper function was needed, since
--   the Blood Bank role set (admin, lab_supervisor, lab_tech, doctor,
--   nurse) is already exactly covered by composing is_admin() and
--   is_clinical_staff() (which already includes doctor/nurse/lab_tech/
--   lab_supervisor/radiologist/theatre_nurse).
--
--   ONE genuine gap found on re-review: migration_v2.28 created
--   blood_transfusions but never enabled row level security on it or
--   added policies — this migration closes that gap. Every other
--   blood_* table's RLS is unchanged; nothing here duplicates or
--   contradicts an earlier phase's policy.
--
-- ROLE_PAGES (index.html) — client-side UX only, not a security boundary
-- (RLS below is) — now grants 'bloodbank' to: admin, lab_supervisor,
-- lab_tech (fulfil requests, manage inventory/intake/issue), doctor
-- (place requests), nurse (administer transfusions, record vitals,
-- report reactions). receptionist/cashier/theatre_nurse/radiologist are
-- deliberately not granted the page — none of their existing
-- responsibilities touch blood products.
--
-- WHAT THIS ADDS
--   blood_transfusions RLS (the gap above) — select/insert for
--   is_admin() or is_clinical_staff() (matches blood_requests, the
--   closest-shaped existing table: any clinical role can read and any
--   clinical role can start a transfusion or record vitals against one),
--   update likewise (stopping a transfusion, marking Reaction Reported).
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.28.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.blood_transfusions enable row level security;

drop policy if exists blood_transfusions_select on public.blood_transfusions;
create policy blood_transfusions_select on public.blood_transfusions
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists blood_transfusions_insert on public.blood_transfusions;
create policy blood_transfusions_insert on public.blood_transfusions
  for insert with check (public.is_admin() or public.is_clinical_staff());

drop policy if exists blood_transfusions_update on public.blood_transfusions;
create policy blood_transfusions_update on public.blood_transfusions
  for update using (public.is_admin() or public.is_clinical_staff())
  with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.blood_transfusions from anon;
grant select, insert, update on public.blood_transfusions to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Full Blood Bank RLS summary (for review — every policy already exists
-- as of the migration noted; nothing below is created by THIS file
-- except blood_transfusions, listed here only for a single reference
-- point across the whole module):
--
--   blood_units          (migration_v2.24) select: admin/clinical · insert: admin/lab · update: admin/clinical
--   blood_donors         (migration_v2.25) select/insert/update: admin/lab
--   blood_donations      (migration_v2.25) select/insert/update: admin/lab
--   blood_requests       (migration_v2.26) select/insert: admin/clinical · update: admin/lab
--   blood_issue_log      (migration_v2.27) select/insert: admin/clinical · NO update/delete (permanent record)
--   blood_transfusions   (this migration)  select/insert/update: admin/clinical
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename like 'blood_%'
--     order by tablename, cmd;
--   -- Confirm every blood_* table has rowsecurity enabled:
--   select relname, relrowsecurity from pg_class
--     where relname like 'blood_%' and relnamespace = 'public'::regnamespace;
-- ═══════════════════════════════════════════════════════════════════════
