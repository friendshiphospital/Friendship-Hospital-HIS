-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.8_rls_security.sql
-- Row-Level Security hardening + audit logging
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHO THIS IS FOR
--   Run this in the Supabase SQL editor against a project that already has
--   the v1 base schema + migration_v2 / v2.2 / v2.4 / v2.5 / v2.6 changes
--   applied (see CHANGELOG.md). This migration assumes those tables exist
--   with (at minimum) the columns the app reads/writes — this file was
--   written by reverse-engineering every sb.from(...) call in index.html,
--   since no schema .sql files ship in this checkout (see CLAUDE.md).
--
-- WHY THIS MATTERS
--   index.html enforces role access (ROLE_PAGES / goPage / filterSidebar)
--   entirely client-side, for UX only. Anyone with the anon key (which is
--   public by design — it ships in every deployment's localStorage) can
--   call the Supabase REST API directly and bypass every client-side
--   check. RLS is the ONLY real access boundary for this app. Before this
--   migration, none of the tables below have RLS enabled, so ANY
--   authenticated user (any staff login) can read/write ANY row in ANY
--   of them.
--
-- SCOPE
--   RLS is enabled on the tables explicitly requested:
--     patients_master, patients, admissions, results_hematology,
--     results_chemistry, results_serology, results_microbiology,
--     results_pcr, results_histopathology, results_cytology,
--     invoices, doctor_consultations, critical_values, radiology_requests
--
--   Two tables NOT on that list are also locked down here, and flagged
--   clearly below, because leaving them open defeats the point of doing
--   this at all:
--     - staff:          this is the table every policy in this file reads
--                        (staff.role where staff.user_id = auth.uid()).
--                        Without RLS on staff itself, any logged-in user
--                        could UPDATE their own row and grant themselves
--                        role='admin', or read every other staff member's
--                        row. This is not optional.
--     - sample_records:  holds patient_id + specimen collection status,
--                        read across nearly every lab/nursing page and
--                        written during sample collection/order placement.
--                        Left it open == an unauth'd gap right next to the
--                        results_* tables it feeds. If you'd rather ship
--                        this migration without touching it, delete
--                        Section 6 below; nothing else in this file
--                        depends on it.
--
-- ROLE MODEL
--   This is a staff-only system — patients never authenticate against
--   Supabase, so there is no "patient self-access" policy anywhere here.
--   Every policy below resolves the acting user's role via:
--       staff.role where staff.user_id = auth.uid()
--   using the public.current_staff_role() helper defined in Section 1.
--   The 9 roles match ROLE_PAGES in index.html exactly: admin, doctor,
--   nurse, lab_tech, lab_supervisor, receptionist, cashier,
--   theatre_nurse, radiologist.
--
-- DESIGN NOTES / JUDGMENT CALLS (read before you apply this)
--   1. "Relevant to their department" was interpreted using the app's own
--      ROLE_PAGES access matrix, not a stricter per-lab-department split.
--      lab_tech and lab_supervisor already get the cross-department
--      "All Results" viewer and doctor/nurse/radiologist/theatre_nurse
--      already get the cross-department "Patient History Timeline" —
--      so all six clinical roles get SELECT across all results_*,
--      critical_values (except radiologist — see #2), doctor_consultations,
--      and radiology_requests. What's actually fenced off is the
--      billing/front-desk boundary the requirements called out explicitly:
--      receptionist/cashier get zero access to any of that clinical
--      content, full stop.
--   2. critical_values SELECT deliberately excludes radiologist — ROLE_PAGES
--      does not grant radiologist the 'criticals' page; a radiologist's own
--      critical findings live on radiology_requests.is_critical instead.
--   3. WRITE access to results_*/critical_values/sample_records is
--      restricted to lab_tech + lab_supervisor + admin, matching who
--      ROLE_PAGES actually grants the *-entry / unified-entry pages to.
--      doctor_consultations WRITE is doctor + admin only (ROLE_PAGES:
--      only 'doctor' and 'admin' have the 'consultation' page).
--      radiology_requests WRITE is doctor + radiologist + admin (order
--      placement + report authoring).
--   4. DELETE on every clinical table is admin-only everywhere in this
--      file. This mirrors the app's own deletePatientRecord() guard
--      (currentProfile?.role !== 'admin' → refused client-side) — RLS now
--      backs that up server-side instead of trusting the client.
--   5. patients / patients_master intermix demographic AND clinical
--      fields (patients has diagnosis, tests_requested, etc. right next
--      to phone/name). Table-level RLS cannot separate "billing may see
--      the phone number but not the diagnosis" within the same row — the
--      requirement explicitly grants receptionist/cashier read/write on
--      `patients`, so that limitation is accepted here as a known gap.
--      If column-level separation ever becomes a hard compliance
--      requirement, the fix is a view or a table split, not RLS.
--   6. README.md's role/page table and the actual ROLE_PAGES object in
--      index.html have already drifted (e.g. README lists Nurse with
--      Samples/Handover/Infection access that ROLE_PAGES does not grant
--      today). This migration follows ROLE_PAGES (the code that's
--      actually enforced client-side) as the source of truth, not
--      README.md. Worth reconciling separately — not a schema problem.
--   7. `enforce_result_lock` (mentioned in the request) already exists on
--      the results_* tables per the project's own migration history.
--      This file does not read, replace, or depend on its definition —
--      Section 7 adds a separate, independent AFTER trigger per table for
--      audit logging, following the same "one small trigger function,
--      reused via CREATE TRIGGER per table" convention rather than
--      touching the existing lock trigger at all.
--
-- This migration is idempotent — every statement can be re-run safely.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — Role-lookup helper functions
-- ───────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER is required here: once RLS is enabled on `staff`
-- (Section 2), a plain `select role from staff where user_id = auth.uid()`
-- run from inside another table's policy would itself be subject to
-- staff's RLS policies — which would in turn call this function again,
-- recursing. SECURITY DEFINER makes the lookup run as the function owner
-- (bypassing RLS on staff for this one read), breaking that cycle. The
-- pinned search_path prevents the classic SECURITY DEFINER hijack via a
-- shadowing object earlier in a caller's search_path.

create or replace function public.current_staff_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.staff where user_id = auth.uid() limit 1;
$$;

comment on function public.current_staff_role() is
  'Returns the role of the currently authenticated staff member (staff.role where staff.user_id = auth.uid()), or NULL if unauthenticated / not linked to a staff row. SECURITY DEFINER to safely bypass RLS on staff for this single lookup.';

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() = 'admin';
$$;

create or replace function public.is_clinical_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() in
    ('doctor','nurse','lab_tech','lab_supervisor','radiologist','theatre_nurse');
$$;

create or replace function public.is_lab_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() in ('lab_tech','lab_supervisor');
$$;

create or replace function public.is_billing_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() in ('receptionist','cashier');
$$;

revoke execute on function public.current_staff_role() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_clinical_staff() from public;
revoke execute on function public.is_lab_staff() from public;
revoke execute on function public.is_billing_staff() from public;

grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_clinical_staff() to authenticated;
grant execute on function public.is_lab_staff() to authenticated;
grant execute on function public.is_billing_staff() to authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — staff  (not explicitly requested — see header note above)
-- ───────────────────────────────────────────────────────────────────────
-- Every other policy in this file depends on staff being readable enough
-- to resolve current_staff_role(), but NOT writable by non-admins — a
-- non-admin who could update their own `role` column would be a one-row
-- UPDATE away from becoming admin.
--
-- Critical: loadProfile() in index.html does
--   sb.from('staff').select('*').eq('user_id', currentUser.id).maybeSingle()
-- and FALLS BACK TO role:'admin' if that query errors or returns nothing.
-- If self-select were blocked, every login would silently become admin.
-- The staff_self_select policy below exists specifically to keep that
-- query working for every role.

alter table public.staff enable row level security;

drop policy if exists staff_self_select on public.staff;
create policy staff_self_select on public.staff
  for select
  using (user_id = auth.uid());

drop policy if exists staff_supervisor_select on public.staff;
create policy staff_supervisor_select on public.staff
  for select
  using (public.current_staff_role() = 'lab_supervisor');

drop policy if exists staff_admin_all on public.staff;
create policy staff_admin_all on public.staff
  for all
  using (public.is_admin())
  with check (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — patients_master  (registration / master identity index)
-- ───────────────────────────────────────────────────────────────────────
-- Only touched by the registration flow (dedup-by-mrn) and the admin
-- patient-deletion cascade. Clinical pages read `patients`, not this
-- table, day-to-day — so clinical roles get no access here at all.

alter table public.patients_master enable row level security;

drop policy if exists patients_master_select on public.patients_master;
create policy patients_master_select on public.patients_master
  for select
  using (public.is_admin() or public.is_billing_staff());

drop policy if exists patients_master_insert on public.patients_master;
create policy patients_master_insert on public.patients_master
  for insert
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists patients_master_update on public.patients_master;
create policy patients_master_update on public.patients_master
  for update
  using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists patients_master_delete on public.patients_master;
create policy patients_master_delete on public.patients_master
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 4 — patients  (per-visit record: read by virtually every page)
-- ───────────────────────────────────────────────────────────────────────
-- SELECT is intentionally broad: every department's worklist/queue/print
-- view joins this table for name/mrn/ward/etc. WRITE is scoped to the
-- roles that actually call .insert()/.update() on it in index.html:
-- registration + billing (receptionist/cashier/admin), and admission/
-- consultation updates (doctor/nurse/theatre_nurse). lab_tech,
-- lab_supervisor and radiologist never write to `patients` directly in
-- the app (they write results_*/radiology_requests instead), so they get
-- read-only here.

alter table public.patients enable row level security;

drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients
  for select
  using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients
  for insert
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists patients_update on public.patients;
create policy patients_update on public.patients
  for update
  using (
    public.is_admin() or public.is_billing_staff()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin() or public.is_billing_staff()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists patients_delete on public.patients;
create policy patients_delete on public.patients
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 5 — admissions
-- ───────────────────────────────────────────────────────────────────────
-- ROLE_PAGES grants the 'admission'/'theatre' pages only to admin,
-- doctor, nurse, theatre_nurse. Lab/radiology/billing roles get nothing.

alter table public.admissions enable row level security;

drop policy if exists admissions_select on public.admissions;
create policy admissions_select on public.admissions
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists admissions_insert on public.admissions;
create policy admissions_insert on public.admissions
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists admissions_update on public.admissions;
create policy admissions_update on public.admissions
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists admissions_delete on public.admissions;
create policy admissions_delete on public.admissions
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 6 — sample_records  (not explicitly requested — see header note)
-- ───────────────────────────────────────────────────────────────────────
-- Feeds the worklist (including receptionist's read-only worklist view),
-- nursing/lab collection screens, and TAT tracking. Write access mirrors
-- who actually calls .insert()/.update() on it: doctor (placing orders),
-- nurse (collection), lab_tech/lab_supervisor (receipt/rejection/status).

alter table public.sample_records enable row level security;

drop policy if exists sample_records_select on public.sample_records;
create policy sample_records_select on public.sample_records
  for select
  using (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  );

drop policy if exists sample_records_insert on public.sample_records;
create policy sample_records_insert on public.sample_records
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor')
  );

drop policy if exists sample_records_update on public.sample_records;
create policy sample_records_update on public.sample_records
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor')
  );

drop policy if exists sample_records_delete on public.sample_records;
create policy sample_records_delete on public.sample_records
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 7 — results_* (hematology, chemistry, serology, microbiology,
--                         pcr, histopathology, cytology)
-- ───────────────────────────────────────────────────────────────────────
-- SELECT: all six clinical roles (see Design Note #1) — never billing.
-- WRITE:  lab_tech + lab_supervisor + admin only, matching the app's own
--         ROLE_PAGES grants for the *-entry / unified-entry pages.
-- DELETE: admin only.
-- Note: enforce_result_lock (pre-existing) is untouched by this section.

do $$
declare
  t text;
  results_tables text[] := array[
    'results_hematology','results_chemistry','results_serology',
    'results_microbiology','results_pcr','results_histopathology',
    'results_cytology'
  ];
begin
  foreach t in array results_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select
        using (public.is_admin() or public.is_clinical_staff())
    $f$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($f$
      create policy %I on public.%I
        for insert
        with check (public.is_admin() or public.is_lab_staff())
    $f$, t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($f$
      create policy %I on public.%I
        for update
        using (public.is_admin() or public.is_lab_staff())
        with check (public.is_admin() or public.is_lab_staff())
    $f$, t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($f$
      create policy %I on public.%I
        for delete
        using (public.is_admin())
    $f$, t || '_delete', t);
  end loop;
end $$;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 8 — critical_values
-- ───────────────────────────────────────────────────────────────────────
-- SELECT excludes radiologist (see Design Note #2). INSERT is lab-only
-- (auto-flagged from results_hematology/results_chemistry saves via
-- logCriticalValues()). UPDATE covers acknowledgement, which any of the
-- clinical roles that can see the criticals page/banner may perform.

alter table public.critical_values enable row level security;

drop policy if exists critical_values_select on public.critical_values;
create policy critical_values_select on public.critical_values
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor','theatre_nurse')
  );

drop policy if exists critical_values_insert on public.critical_values;
create policy critical_values_insert on public.critical_values
  for insert
  with check (public.is_admin() or public.is_lab_staff());

drop policy if exists critical_values_update on public.critical_values;
create policy critical_values_update on public.critical_values
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor','theatre_nurse')
  );

drop policy if exists critical_values_delete on public.critical_values;
create policy critical_values_delete on public.critical_values
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 9 — invoices  (billing only — zero clinical-role access)
-- ───────────────────────────────────────────────────────────────────────

alter table public.invoices enable row level security;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select
  using (public.is_admin() or public.is_billing_staff());

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update
  using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 10 — doctor_consultations  (SOAP notes — zero billing access)
-- ───────────────────────────────────────────────────────────────────────
-- WRITE is doctor + admin only — ROLE_PAGES grants the 'consultation'
-- page to no other role. SELECT is the broader clinical group because
-- the Patient History Timeline (pt-history), which every clinical role
-- has, surfaces these notes for continuity of care.

alter table public.doctor_consultations enable row level security;

drop policy if exists doctor_consultations_select on public.doctor_consultations;
create policy doctor_consultations_select on public.doctor_consultations
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists doctor_consultations_insert on public.doctor_consultations;
create policy doctor_consultations_insert on public.doctor_consultations
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists doctor_consultations_update on public.doctor_consultations;
create policy doctor_consultations_update on public.doctor_consultations
  for update
  using (public.is_admin() or public.current_staff_role() = 'doctor')
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists doctor_consultations_delete on public.doctor_consultations;
create policy doctor_consultations_delete on public.doctor_consultations
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 11 — radiology_requests
-- ───────────────────────────────────────────────────────────────────────
-- WRITE is doctor (order placement) + radiologist (report authoring) +
-- admin — matching ROLE_PAGES' 'radiology' page grant. SELECT is the
-- broader clinical group for the same pt-history continuity-of-care
-- reason as doctor_consultations above.

alter table public.radiology_requests enable row level security;

drop policy if exists radiology_requests_select on public.radiology_requests;
create policy radiology_requests_select on public.radiology_requests
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists radiology_requests_insert on public.radiology_requests;
create policy radiology_requests_insert on public.radiology_requests
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','radiologist')
  );

drop policy if exists radiology_requests_update on public.radiology_requests;
create policy radiology_requests_update on public.radiology_requests
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','radiologist')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','radiologist')
  );

drop policy if exists radiology_requests_delete on public.radiology_requests;
create policy radiology_requests_delete on public.radiology_requests
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 12 — Defense-in-depth: make sure `anon` has nothing here
-- ───────────────────────────────────────────────────────────────────────
-- No policy above grants anon anything (current_staff_role() is NULL for
-- an unauthenticated caller, so every "in (...)"/"= 'x'" check is false
-- and every USING/WITH CHECK clause evaluates to false or null). This is
-- an explicit belt-and-suspenders revoke on top of that, so a future
-- policy change can't accidentally open these tables to the anon key.

revoke all on
  public.staff, public.patients_master, public.patients, public.admissions,
  public.sample_records, public.results_hematology, public.results_chemistry,
  public.results_serology, public.results_microbiology, public.results_pcr,
  public.results_histopathology, public.results_cytology,
  public.critical_values, public.invoices, public.doctor_consultations,
  public.radiology_requests
from anon;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 13 — audit_logs + audit triggers
-- ───────────────────────────────────────────────────────────────────────
-- Logs every UPDATE/DELETE on doctor_consultations and every results_*
-- table: who (auth.uid() + resolved role), when, and the before/after
-- row as jsonb. record_id is stored as text so this works regardless of
-- whether a given table's primary key is uuid, bigint, or serial.
--
-- This is intentionally a separate AFTER trigger, not a modification of
-- enforce_result_lock (a pre-existing BEFORE trigger per the project's
-- migration history that this file was told not to replace). AFTER
-- trigger return values are ignored by Postgres, so this can never
-- interfere with whatever enforce_result_lock decides to allow or block.

create table if not exists public.audit_logs (
  id            bigint generated always as identity primary key,
  table_name    text not null,
  record_id     text,
  patient_id    text,
  action        text not null check (action in ('UPDATE','DELETE')),
  changed_by    uuid,
  changed_by_role text,
  old_data      jsonb,
  new_data      jsonb,
  changed_at    timestamptz not null default now()
);

create index if not exists audit_logs_table_record_idx
  on public.audit_logs (table_name, record_id);
create index if not exists audit_logs_patient_idx
  on public.audit_logs (patient_id);
create index if not exists audit_logs_changed_at_idx
  on public.audit_logs (changed_at desc);

alter table public.audit_logs enable row level security;

-- Read-only, admin-only. Deliberately NO insert/update/delete policy for
-- any role — the only path into this table is the SECURITY DEFINER
-- trigger function below, which bypasses RLS as the function owner. If
-- application code ever needs to insert/update/delete this table
-- directly, that's a bug, not a missing policy.
drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs
  for select
  using (public.is_admin());

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;

  insert into public.audit_logs (
    table_name, record_id, patient_id, action,
    changed_by, changed_by_role, old_data, new_data
  ) values (
    TG_TABLE_NAME,
    v_row ->> 'id',
    v_row ->> 'patient_id',
    TG_OP,
    auth.uid(),
    public.current_staff_role(),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP = 'UPDATE' then to_jsonb(NEW) end
  );

  -- AFTER trigger: return value is ignored by Postgres either way.
  return null;
end;
$$;

comment on function public.log_audit_event() is
  'Generic AFTER UPDATE/DELETE audit trigger — logs actor, role, and before/after row to audit_logs. Attached individually per table below, following the same one-function/many-tables convention as enforce_result_lock.';

do $$
declare
  t text;
  audited_tables text[] := array[
    'doctor_consultations',
    'results_hematology','results_chemistry','results_serology',
    'results_microbiology','results_pcr','results_histopathology',
    'results_cytology'
  ];
begin
  foreach t in array audited_tables loop
    execute format('drop trigger if exists audit_%s on public.%I', t, t);
    execute format($f$
      create trigger audit_%s
      after update or delete on public.%I
      for each row execute function public.log_audit_event()
    $f$, t, t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.8_rls_security.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' order by tablename, cmd;
--   select tgname, tgrelid::regclass from pg_trigger
--     where tgname like 'audit_%';
--
-- Then re-test a login as each role (or query via a service_role-signed
-- JWT with the relevant staff row) to confirm nobody lost access they
-- actually need before rolling this out to the live project.
-- ═══════════════════════════════════════════════════════════════════════
