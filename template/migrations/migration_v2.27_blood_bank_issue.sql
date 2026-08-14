-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.27_blood_bank_issue.sql
-- Blood Bank / Transfusion Services, Phase 4 — MANDATORY two-person
-- verified issue workflow
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   Existing Critical Values "acknowledge with read-back confirmation"
--   (acknowledgeCritical()/submitCritAck() in index.html) turned out, on
--   inspection, to only capture a clinician's NAME via a bare prompt() —
--   neither implementation makes anyone actually re-type/confirm the
--   value itself. That is not sufficient for handing over blood, so this
--   phase does NOT reuse that function as-is: instead it builds a real
--   typed re-entry confirmation (each confirmer re-types the patient MRN
--   and the unit number, compared against the actual values) for BOTH of
--   the two required confirmations.
--
--   The existing Anti-Fraud "Quick-PIN override" (requireOverride()/
--   submitOverridePassword() in index.html, migration_v2.12) already
--   solved a closely related problem — proving a SPECIFIC staff member's
--   identity, independent of who is currently logged in, without forcing
--   a full logout/login cycle — via a throwaway Supabase client
--   (`window.supabase.createClient(...)`) that signs in, reads the staff
--   row, and immediately signs out again, never disturbing the primary
--   session. This migration/phase reuses that exact TECHNIQUE for the
--   second (receiving) confirmer's identity check, but as a new,
--   non-admin-restricted function (verifyStaffCredentials() in
--   index.html) — the existing one is hardcoded to role='admin' only,
--   and a receiving nurse/doctor is very much not required to be an
--   admin.
--
-- WHAT THIS ADDS
--   blood_units gains crossmatch-attribution columns (who reserved it,
--   when) — crossmatchUnit() (Phase 3) is updated to stamp these, so the
--   full chain (reserved -> issued -> received) has a start.
--
--   blood_issue_log — one row per completed issue, APPEND-ONLY (no
--   update/delete policy granted at all, same durability posture as this
--   app's other audit-log tables) — reserved_by/issued_by/received_by
--   with names and timestamps for all three. This is the durable
--   traceability record; blood_units.status/issued_at etc. reflect
--   current state but this table is the permanent chain-of-custody log.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.26.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.blood_units add column if not exists crossmatched_by uuid;
alter table public.blood_units add column if not exists crossmatched_by_name text;
alter table public.blood_units add column if not exists crossmatched_at timestamptz;
alter table public.blood_units add column if not exists issued_by uuid;
alter table public.blood_units add column if not exists issued_by_name text;
alter table public.blood_units add column if not exists issued_at timestamptz;
alter table public.blood_units add column if not exists received_by uuid;
alter table public.blood_units add column if not exists received_by_name text;
alter table public.blood_units add column if not exists received_at timestamptz;

create table if not exists public.blood_issue_log (
  id                    uuid primary key default gen_random_uuid(),
  unit_id               uuid not null references public.blood_units(id) on delete restrict,
  request_id            uuid references public.blood_requests(id) on delete set null,
  patient_id            uuid not null references public.patients(id) on delete restrict,
  reserved_by           uuid,
  reserved_by_name      text,
  reserved_at           timestamptz,
  issued_by             uuid not null,
  issued_by_name        text not null,
  issued_at             timestamptz not null default now(),
  received_by           uuid not null,
  received_by_name      text not null,
  received_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint blood_issue_log_two_person check (issued_by is distinct from received_by)
);

create index if not exists blood_issue_log_unit_idx on public.blood_issue_log (unit_id);
create index if not exists blood_issue_log_patient_idx on public.blood_issue_log (patient_id);

comment on table public.blood_issue_log is
  'Permanent, append-only chain-of-custody record — who reserved (crossmatched) each issued unit, who issued it, who received it, and every timestamp. Written once by issueBloodUnit() (index.html) at the moment BOTH required independent confirmations (issuing staff + receiving staff, re-typed patient MRN + unit number each) succeed. blood_issue_log_two_person enforces at the database level that the same staff member cannot be both the issuer and the receiver — belt-and-braces alongside the client-side check.';

alter table public.blood_issue_log enable row level security;

drop policy if exists blood_issue_log_select on public.blood_issue_log;
create policy blood_issue_log_select on public.blood_issue_log
  for select using (public.is_admin() or public.is_clinical_staff());

-- Insert-only — no update/delete policy is granted to anyone (not even
-- admin), matching this table's append-only, permanent-record purpose.
drop policy if exists blood_issue_log_insert on public.blood_issue_log;
create policy blood_issue_log_insert on public.blood_issue_log
  for insert with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.blood_issue_log from anon;
grant select, insert on public.blood_issue_log to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.27_blood_bank_issue.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select count(*) from public.blood_issue_log where issued_by = received_by; -- must always be 0
--   select bu.unit_no, bil.issued_by_name, bil.received_by_name, bil.issued_at
--     from public.blood_issue_log bil join public.blood_units bu on bu.id = bil.unit_id
--     order by bil.issued_at desc limit 20;
-- ═══════════════════════════════════════════════════════════════════════
