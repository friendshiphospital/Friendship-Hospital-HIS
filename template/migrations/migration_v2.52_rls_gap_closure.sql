-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.52_rls_gap_closure.sql
-- Row-Level Security for the 15 tables migration_v2.8 (and everything
-- since) never covered
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHO THIS IS FOR
--   Run this in the Supabase SQL editor against a project that already has
--   migration_v2.8_rls_security.sql applied (this file depends on its
--   helper functions: current_staff_role(), is_admin(), is_clinical_staff(),
--   is_lab_staff(), is_billing_staff() — all reused here unchanged, none
--   redefined). Written the same way v2.8 was: by reverse-engineering
--   every sb.from(...) call in index.html against these 15 tables, since
--   no schema .sql files ship in this checkout (see CLAUDE.md).
--
-- WHY THIS MATTERS
--   A design audit of the whole app's RLS coverage found 60 tables in use
--   by index.html. 49 already have RLS (41 explicit + the 7 results_*
--   tables covered by v2.8's dynamic loop, plus a handful added by later
--   migrations). These 15 do not have ANY RLS policy — not "wrong role
--   scoping," genuinely zero access control beyond "authenticated." Any
--   staff login (any role) can currently read or write every row in every
--   one of them via the Supabase REST API directly, same class of gap
--   v2.8 closed for its 14 tables, just never extended to these:
--     appointments, beds, discharge_summaries, doctor_orders, doctors,
--     id_counters, infection_flags, pre_op_assessments, prescriptions,
--     price_list, qc_lots, qc_results, theatre_bookings, vital_signs,
--     ward_handover_notes
--
-- SCOPE
--   RLS enabled + scoped policies for exactly the 15 tables above. Nothing
--   else touched — no changes to any table v2.8 or a later migration
--   already covers.
--
-- ROLE MODEL
--   Identical to v2.8: staff-only system, no patient self-access, every
--   policy resolves the caller via current_staff_role() /
--   staff.user_id = auth.uid(). Same 9 roles: admin, doctor, nurse,
--   lab_tech, lab_supervisor, receptionist, cashier, theatre_nurse,
--   radiologist.
--
-- DESIGN NOTES / JUDGMENT CALLS (read before you apply this)
--   1. Role sets below come from TWO sources cross-checked against each
--      other, same discipline as v2.8: (a) ROLE_PAGES in index.html — which
--      roles can reach the page a table belongs to, and (b) actually
--      grepping every .insert()/.update()/.delete()/.select() call site on
--      each table to confirm which roles' code paths actually touch it.
--      Where they agreed, that's the policy. Where they didn't, the
--      disagreement is called out explicitly per table below.
--   2. price_list is the one place this migration deliberately does NOT
--      follow a stale precedent already in the codebase:
--      migration_v2.45_lab_reference_ranges.sql's own comment says
--      "Write access is admin-only, same as Price List" — but price_list
--      itself was never actually given RLS until now, and the app's real
--      Price List page renders Edit/Delete/Save buttons for admin,
--      receptionist, AND cashier with no client-side admin gate (ROLE_PAGES
--      grants all three the 'prices' page). Making price_list admin-only
--      here would silently break existing receptionist/cashier
--      functionality the app has always allowed. Write access below
--      matches what the app actually lets those roles do, not the other
--      migration's aspirational comment.
--   3. doctor_orders splits INSERT from UPDATE: only doctor + admin ever
--      call .insert() (order placement lives on the doctor-only
--      'consultation' page), but nurse legitimately calls .update() too —
--      loadNursingOrders()'s "Mark Done" is the missing write-back side of
--      doctor-placed Nursing-type orders (see that function's own comment
--      in index.html) and cancelOrder() is reachable from more than one
--      page. SELECT is broader still (is_clinical_staff()) because a STAT/
--      Urgent orders banner and admission-detail views read this table
--      from pages beyond just Consultation and Nursing.
--   4. beds splits the same way for a different reason: INSERT/DELETE are
--      the "add/remove a physical bed" config actions (admin-only, a
--      Settings-style action) — UPDATE is bed *status* changes
--      (Occupied/Available/transfer), which admission/discharge/transfer
--      flows perform from doctor, nurse, and theatre_nurse contexts, not
--      just admin. RLS can't distinguish "config edit" from "status
--      update" by call site, only by policy — so INSERT/DELETE stay
--      narrow and UPDATE stays as broad as the roles that actually
--      legitimately change a bed's status.
--   5. pre_op_assessments and theatre_bookings are doctor + theatre_nurse +
--      admin, NOT nurse — ROLE_PAGES does not grant plain 'nurse' the
--      'theatre' page (theatre_nurse and doctor have it, nurse does not).
--      Easy to get wrong by pattern-matching "clinical staff usually
--      includes nurse" — checked ROLE_PAGES directly instead of assuming.
--   6. ward_handover_notes is nurse + admin only, matching ROLE_PAGES'
--      'handover' page grant exactly (not doctor, not theatre_nurse).
--   7. doctors and id_counters both need much broader SELECT than their
--      own "management" pages suggest, because they're read as reference/
--      infrastructure data from many other pages: doctors.name/specialty
--      feeds the registration doctor picker (receptionist) and consultation
--      fee lookups (billing), so SELECT is effectively every staff role;
--      id_counters is read/incremented by getNextNumber() from every role
--      that ever registers a patient, places an order, or admits someone
--      — only cashier never touches it. WRITE to both stays narrow
--      (doctors: admin + lab_supervisor, matching the 'doctors' page
--      exactly; id_counters: same broad set as its SELECT, since
--      getNextNumber()'s self-healing path and the admin-only
--      correctIdCounter() panel both issue the exact same shaped UPDATE
--      statement and RLS can't tell them apart by call site).
--   8. infection_flags has no .insert() call site anywhere in index.html
--      today — rows likely arrive via a mechanism outside this checkout
--      (a trigger or manual entry not present here). INSERT policy below
--      still matches the 'infection' page's role grant (admin, nurse,
--      receptionist) as the safe default, rather than leaving it
--      admin-only and potentially blocking a legitimate path this
--      migration's author couldn't see.
--   9. DELETE on every table below is admin-only, matching v2.8's Design
--      Note #4 and deletePatientRecord()'s own admin-only guard — none of
--      these 15 tables have an app-level DELETE call site for any
--      non-admin role except beds (bed config removal) and price_list
--      (admin/receptionist/cashier per Note #2), both handled in their own
--      sections.
--
-- This migration is idempotent — every statement can be re-run safely.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — appointments
-- ───────────────────────────────────────────────────────────────────────
-- ROLE_PAGES grants 'appointments' to admin + receptionist only. Confirmed
-- against call sites: bookAppointment()/updateAppointmentStatus() are only
-- reachable from the Appointments page.

alter table public.appointments enable row level security;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select
  using (public.is_admin() or public.current_staff_role() = 'receptionist');

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'receptionist');

drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments
  for update
  using (public.is_admin() or public.current_staff_role() = 'receptionist')
  with check (public.is_admin() or public.current_staff_role() = 'receptionist');

drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — beds  (see Design Note #4 — INSERT/DELETE vs UPDATE split)
-- ───────────────────────────────────────────────────────────────────────

alter table public.beds enable row level security;

drop policy if exists beds_select on public.beds;
create policy beds_select on public.beds
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists beds_insert on public.beds;
create policy beds_insert on public.beds
  for insert
  with check (public.is_admin());

drop policy if exists beds_update on public.beds;
create policy beds_update on public.beds
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists beds_delete on public.beds;
create policy beds_delete on public.beds
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — discharge_summaries  (mirrors admissions' own role set)
-- ───────────────────────────────────────────────────────────────────────

alter table public.discharge_summaries enable row level security;

drop policy if exists discharge_summaries_select on public.discharge_summaries;
create policy discharge_summaries_select on public.discharge_summaries
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists discharge_summaries_insert on public.discharge_summaries;
create policy discharge_summaries_insert on public.discharge_summaries
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists discharge_summaries_update on public.discharge_summaries;
create policy discharge_summaries_update on public.discharge_summaries
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists discharge_summaries_delete on public.discharge_summaries;
create policy discharge_summaries_delete on public.discharge_summaries
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 4 — doctor_orders  (see Design Note #3 — INSERT narrower than UPDATE)
-- ───────────────────────────────────────────────────────────────────────

alter table public.doctor_orders enable row level security;

drop policy if exists doctor_orders_select on public.doctor_orders;
create policy doctor_orders_select on public.doctor_orders
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists doctor_orders_insert on public.doctor_orders;
create policy doctor_orders_insert on public.doctor_orders
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists doctor_orders_update on public.doctor_orders;
create policy doctor_orders_update on public.doctor_orders
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse')
  );

drop policy if exists doctor_orders_delete on public.doctor_orders;
create policy doctor_orders_delete on public.doctor_orders
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 5 — doctors  (see Design Note #7 — broad SELECT, narrow WRITE)
-- ───────────────────────────────────────────────────────────────────────

alter table public.doctors enable row level security;

drop policy if exists doctors_select on public.doctors;
create policy doctors_select on public.doctors
  for select
  using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

drop policy if exists doctors_insert on public.doctors;
create policy doctors_insert on public.doctors
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'lab_supervisor');

drop policy if exists doctors_update on public.doctors;
create policy doctors_update on public.doctors
  for update
  using (public.is_admin() or public.current_staff_role() = 'lab_supervisor')
  with check (public.is_admin() or public.current_staff_role() = 'lab_supervisor');

drop policy if exists doctors_delete on public.doctors;
create policy doctors_delete on public.doctors
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 6 — id_counters  (see Design Note #7 — infrastructure, not clinical)
-- ───────────────────────────────────────────────────────────────────────
-- Every role except cashier can trigger a getNextNumber() call somewhere
-- in the app (registration, admission, lab/radiology ordering). The admin-
-- only correctIdCounter() panel issues the identical UPDATE shape as the
-- routine self-healing path, so one shared policy covers both correctly.

alter table public.id_counters enable row level security;

drop policy if exists id_counters_select on public.id_counters;
create policy id_counters_select on public.id_counters
  for select
  using (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  );

drop policy if exists id_counters_insert on public.id_counters;
create policy id_counters_insert on public.id_counters
  for insert
  with check (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  );

drop policy if exists id_counters_update on public.id_counters;
create policy id_counters_update on public.id_counters
  for update
  using (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  )
  with check (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  );

drop policy if exists id_counters_delete on public.id_counters;
create policy id_counters_delete on public.id_counters
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 7 — infection_flags  (see Design Note #8 — no current INSERT call site)
-- ───────────────────────────────────────────────────────────────────────

alter table public.infection_flags enable row level security;

drop policy if exists infection_flags_select on public.infection_flags;
create policy infection_flags_select on public.infection_flags
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('nurse','receptionist')
    or public.is_clinical_staff()
  );

drop policy if exists infection_flags_insert on public.infection_flags;
create policy infection_flags_insert on public.infection_flags
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('nurse','receptionist')
  );

drop policy if exists infection_flags_update on public.infection_flags;
create policy infection_flags_update on public.infection_flags
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('nurse','receptionist')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('nurse','receptionist')
  );

drop policy if exists infection_flags_delete on public.infection_flags;
create policy infection_flags_delete on public.infection_flags
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 8 — pre_op_assessments  (see Design Note #5 — no plain 'nurse')
-- ───────────────────────────────────────────────────────────────────────

alter table public.pre_op_assessments enable row level security;

drop policy if exists pre_op_assessments_select on public.pre_op_assessments;
create policy pre_op_assessments_select on public.pre_op_assessments
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists pre_op_assessments_insert on public.pre_op_assessments;
create policy pre_op_assessments_insert on public.pre_op_assessments
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists pre_op_assessments_update on public.pre_op_assessments;
create policy pre_op_assessments_update on public.pre_op_assessments
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists pre_op_assessments_delete on public.pre_op_assessments;
create policy pre_op_assessments_delete on public.pre_op_assessments
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 9 — prescriptions
-- ───────────────────────────────────────────────────────────────────────
-- WRITE is doctor + admin only (Rx tab lives on the doctor-only
-- 'consultation' page, same as doctor_consultations in v2.8). SELECT is
-- the broader clinical group — Patient History Timeline surfaces past
-- prescriptions to every clinical role for continuity of care, same
-- reasoning v2.8 used for doctor_consultations/radiology_requests SELECT.

alter table public.prescriptions enable row level security;

drop policy if exists prescriptions_select on public.prescriptions;
create policy prescriptions_select on public.prescriptions
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists prescriptions_insert on public.prescriptions;
create policy prescriptions_insert on public.prescriptions
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists prescriptions_update on public.prescriptions;
create policy prescriptions_update on public.prescriptions
  for update
  using (public.is_admin() or public.current_staff_role() = 'doctor')
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists prescriptions_delete on public.prescriptions;
create policy prescriptions_delete on public.prescriptions
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 10 — price_list  (see Design Note #2 — deliberately NOT admin-only write)
-- ───────────────────────────────────────────────────────────────────────

alter table public.price_list enable row level security;

drop policy if exists price_list_select on public.price_list;
create policy price_list_select on public.price_list
  for select
  using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

drop policy if exists price_list_insert on public.price_list;
create policy price_list_insert on public.price_list
  for insert
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists price_list_update on public.price_list;
create policy price_list_update on public.price_list
  for update
  using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists price_list_delete on public.price_list;
create policy price_list_delete on public.price_list
  for delete
  using (public.is_admin() or public.is_billing_staff());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 11 — qc_lots / qc_results  (identical role sets — matches
-- ROLE_PAGES 'qc' page grant exactly: admin, lab_tech, lab_supervisor)
-- ───────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  qc_tables text[] := array['qc_lots','qc_results'];
begin
  foreach t in array qc_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select
        using (public.is_admin() or public.is_lab_staff())
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
-- SECTION 12 — theatre_bookings  (see Design Note #5 — no plain 'nurse')
-- ───────────────────────────────────────────────────────────────────────

alter table public.theatre_bookings enable row level security;

drop policy if exists theatre_bookings_select on public.theatre_bookings;
create policy theatre_bookings_select on public.theatre_bookings
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists theatre_bookings_insert on public.theatre_bookings;
create policy theatre_bookings_insert on public.theatre_bookings
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists theatre_bookings_update on public.theatre_bookings;
create policy theatre_bookings_update on public.theatre_bookings
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists theatre_bookings_delete on public.theatre_bookings;
create policy theatre_bookings_delete on public.theatre_bookings
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 13 — vital_signs  (matches ROLE_PAGES 'nursing'/'fluid-chart')
-- ───────────────────────────────────────────────────────────────────────

alter table public.vital_signs enable row level security;

drop policy if exists vital_signs_select on public.vital_signs;
create policy vital_signs_select on public.vital_signs
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists vital_signs_insert on public.vital_signs;
create policy vital_signs_insert on public.vital_signs
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists vital_signs_update on public.vital_signs;
create policy vital_signs_update on public.vital_signs
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists vital_signs_delete on public.vital_signs;
create policy vital_signs_delete on public.vital_signs
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 14 — ward_handover_notes  (see Design Note #6 — nurse + admin only)
-- ───────────────────────────────────────────────────────────────────────

alter table public.ward_handover_notes enable row level security;

drop policy if exists ward_handover_notes_select on public.ward_handover_notes;
create policy ward_handover_notes_select on public.ward_handover_notes
  for select
  using (public.is_admin() or public.current_staff_role() = 'nurse');

drop policy if exists ward_handover_notes_insert on public.ward_handover_notes;
create policy ward_handover_notes_insert on public.ward_handover_notes
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'nurse');

drop policy if exists ward_handover_notes_update on public.ward_handover_notes;
create policy ward_handover_notes_update on public.ward_handover_notes
  for update
  using (public.is_admin() or public.current_staff_role() = 'nurse')
  with check (public.is_admin() or public.current_staff_role() = 'nurse');

drop policy if exists ward_handover_notes_delete on public.ward_handover_notes;
create policy ward_handover_notes_delete on public.ward_handover_notes
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 15 — Defense-in-depth: make sure `anon` has nothing here
-- ───────────────────────────────────────────────────────────────────────

revoke all on
  public.appointments, public.beds, public.discharge_summaries,
  public.doctor_orders, public.doctors, public.id_counters,
  public.infection_flags, public.pre_op_assessments, public.prescriptions,
  public.price_list, public.qc_lots, public.qc_results,
  public.theatre_bookings, public.vital_signs, public.ward_handover_notes
from anon;

grant select, insert, update, delete on
  public.appointments, public.beds, public.discharge_summaries,
  public.doctor_orders, public.doctors, public.id_counters,
  public.infection_flags, public.pre_op_assessments, public.prescriptions,
  public.price_list, public.qc_lots, public.qc_results,
  public.theatre_bookings, public.vital_signs, public.ward_handover_notes
to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.52_rls_gap_closure.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public'
--       and tablename in (
--         'appointments','beds','discharge_summaries','doctor_orders',
--         'doctors','id_counters','infection_flags','pre_op_assessments',
--         'prescriptions','price_list','qc_lots','qc_results',
--         'theatre_bookings','vital_signs','ward_handover_notes'
--       )
--     order by tablename, cmd;
--
-- Then re-test a login as each role (or query via a service_role-signed
-- JWT with the relevant staff row) to confirm nobody lost access they
-- actually need before rolling this out to the live project — in
-- particular: receptionist/cashier on Price List (Note #2), nurse on
-- "Mark Done" for doctor-placed Nursing orders (Note #3), and the
-- ID Counters admin panel under Settings (Note #7).
-- ═══════════════════════════════════════════════════════════════════════
