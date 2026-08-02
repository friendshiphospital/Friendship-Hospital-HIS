-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.19_visit_status_and_followup.sql
-- Visit-level status tracking, consultation sign-off lock, follow-up
-- scheduling
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   sample_records.status tracks ONE specimen's collection state
--   (Pending/Collected/Received/Processing/Completed/Released) — it says
--   nothing about the visit as a whole (a visit might have no lab orders
--   at all, or a Nursing/Radiology order with no sample_records row
--   involved). There was no visit-level status anywhere. doctor_consultations
--   had no lock/attestation mechanism at all — a saved consultation note
--   could be edited indefinitely, unlike the existing verify/release lock
--   on lab results (applyResultLock()/canOverrideResultLock() in
--   index.html). There was no follow-up-visit concept anywhere in the
--   schema.
--
-- SECTION 1 — patients.visit_status
--   Six states were specified, but only FIVE are stored:
--     Registered -> With Doctor -> Orders Pending -> Results Ready -> Visit Complete
--   "Payment Pending" is deliberately NOT a sixth stored value — it's
--   computed client-side (effectiveVisitStatus() in index.html) as an
--   overlay whenever the stored status is still 'Registered' AND
--   patient.payment_status is unpaid/insurance_pending. Storing it as a
--   real transition would need an explicit trigger to leave it (nothing
--   in the spec says what un-sticks a visit from "Payment Pending" other
--   than payment itself, which is already tracked by payment_status) —
--   computing it avoids a second source of truth that could drift out of
--   sync with payment_status.
--
-- SECTION 2 — doctor_consultations sign-off columns
--   Mirrors results_hematology/results_chemistry's is_verified pattern
--   exactly (same idea: signed_off_by/_by_name/_at is the audit trail),
--   read/written by index.html's applyConsultationNotesLock()/
--   completeAndSignOffVisit() — same "lock the form once attested, only
--   admin can override" convention as applyResultLock()/
--   canOverrideResultLock() use for lab results.
--
-- SECTION 3 — follow_ups
--   One row per scheduled follow-up. Keyed by patient_mrn (the permanent,
--   cross-visit identity — patients.id is regenerated fresh every visit
--   per submitRegistration(), so a follow-up scheduled during visit A has
--   to be found again during visit B by mrn, not by patients.id).
--   origin_patient_id keeps a reference to the visit it was scheduled
--   from, for display; used/used_at/used_patient_id record when/if
--   Phase 5's reception-side follow-up-pricing prompt was actually
--   confirmed and applied to a later registration, so the same follow-up
--   can never be applied twice.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.8.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — patients.visit_status
-- ───────────────────────────────────────────────────────────────────────

alter table public.patients add column if not exists visit_status text default 'Registered'
  check (visit_status in ('Registered','With Doctor','Orders Pending','Results Ready','Visit Complete'));

comment on column public.patients.visit_status is
  'Visit-level status, distinct from sample_records.status (which tracks one specimen, not the whole visit). Advances automatically (see advanceVisitStatus() in index.html) except the final Visit Complete transition, which only completeAndSignOffVisit() (doctor-only, via "Complete & Sign Off") ever sets. "Payment Pending" is a computed display-only overlay, not a stored value here — see effectiveVisitStatus().';


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — doctor_consultations sign-off / lock columns
-- ───────────────────────────────────────────────────────────────────────

alter table public.doctor_consultations add column if not exists is_signed_off boolean default false;
alter table public.doctor_consultations add column if not exists signed_off_by uuid;
alter table public.doctor_consultations add column if not exists signed_off_by_name text;
alter table public.doctor_consultations add column if not exists signed_off_at timestamptz;

comment on column public.doctor_consultations.is_signed_off is
  'Set by completeAndSignOffVisit() in index.html (the Consultation workspace''s "Complete & Sign Off" action) — a clinical attestation, same seriousness as the existing is_verified lock on lab results. Once true, applyConsultationNotesLock() disables every field in the Notes tab; only an admin (canOverrideConsultationLock()) can unlock it to edit.';


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — follow_ups
-- ───────────────────────────────────────────────────────────────────────

create table if not exists public.follow_ups (
  id                  bigint generated always as identity primary key,
  patient_mrn         text not null,
  origin_patient_id   uuid references public.patients(id) on delete set null,
  scheduled_by        uuid,
  scheduled_by_name   text,
  target_date         date not null,
  reason              text,
  created_at          timestamptz not null default now(),
  used                boolean not null default false,
  used_at             timestamptz,
  used_patient_id     uuid references public.patients(id) on delete set null
);

create index if not exists follow_ups_mrn_idx on public.follow_ups (patient_mrn, used);

comment on table public.follow_ups is
  'Created by completeAndSignOffVisit()''s "Schedule a follow-up?" prompt in Doctor Consultation. Read at Registration (submitRegistration() in index.html) to offer follow-up pricing (see migration_v2.20 / Phase 5) — patient_mrn is the lookup key since patients.id is a fresh uuid every visit. used/used_at/used_patient_id are set the moment a registration actually applies the follow-up pricing, so the same scheduled follow-up can never be reused for an unrelated later visit.';

alter table public.follow_ups enable row level security;

drop policy if exists follow_ups_select on public.follow_ups;
create policy follow_ups_select on public.follow_ups
  for select using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

drop policy if exists follow_ups_insert on public.follow_ups;
create policy follow_ups_insert on public.follow_ups
  for insert with check (public.is_admin() or public.current_staff_role()='doctor');

drop policy if exists follow_ups_update on public.follow_ups;
create policy follow_ups_update on public.follow_ups
  for update using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

revoke all on public.follow_ups from anon;
grant select, insert, update on public.follow_ups to authenticated;
grant usage, select on sequence follow_ups_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.19_visit_status_and_followup.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select visit_status, count(*) from public.patients group by visit_status;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'follow_ups' order by cmd;
-- ═══════════════════════════════════════════════════════════════════════
