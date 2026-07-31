-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.10_sms_log.sql
-- Adds sms_log for the SMS reminders / result-ready notifications feature
-- (Phase 8 of the feature-development pass)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in the Supabase SQL editor, after migration_v2.8_rls_security.sql
-- (this migration depends on the public.current_staff_role()/is_admin()/
-- is_clinical_staff()/is_billing_staff() helper functions that one defines).
-- Idempotent — safe to re-run.
--
-- Every sendSms() call (index.html) logs one row here regardless of
-- whether the send itself succeeded — status/error record the outcome —
-- so there's always a record of what was attempted, not just what worked.

create table if not exists public.sms_log (
  id            bigint generated always as identity primary key,
  patient_id    uuid,
  phone         text not null,
  message       text not null,
  purpose       text not null default 'other' check (purpose in ('appointment_reminder','result_ready','other')),
  status        text not null check (status in ('sent','failed')),
  error         text,
  sent_by       uuid,
  sent_by_name  text,
  created_at    timestamptz not null default now()
);

create index if not exists sms_log_patient_idx on public.sms_log (patient_id);
create index if not exists sms_log_created_at_idx on public.sms_log (created_at desc);

alter table public.sms_log enable row level security;

-- SELECT matches ROLE_PAGES' actual grant of the 'delivery' page (Result/
-- Reminder Delivery Log): admin, lab_tech, lab_supervisor.
drop policy if exists sms_log_select on public.sms_log;
create policy sms_log_select on public.sms_log
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('lab_tech','lab_supervisor')
  );

-- INSERT is broader than SELECT on purpose: sendSms() is called from two
-- different pages with two different role sets (Appointments — reception/
-- billing roles send reminders; All Results — clinical/lab roles send
-- result-ready notices), so any authenticated staff role may log a send.
-- Sending a message isn't especially privileged; reviewing the accumulated
-- log of patient phone numbers is what's restricted above.
drop policy if exists sms_log_insert on public.sms_log;
create policy sms_log_insert on public.sms_log
  for insert
  with check (
    public.is_admin() or public.is_clinical_staff() or public.is_billing_staff()
  );

-- No UPDATE policy for any role — a log entry reflects what was actually
-- attempted at send time and shouldn't be editable after the fact.
drop policy if exists sms_log_delete on public.sms_log;
create policy sms_log_delete on public.sms_log
  for delete
  using (public.is_admin());

revoke all on public.sms_log from anon;
-- Table-level GRANTs, not just RLS policies: a fresh table created outside
-- Supabase's dashboard table editor does not automatically pick up
-- PostgREST-usable privileges for `authenticated` just because RLS
-- policies exist — RLS narrows what a grant already allows, it doesn't
-- substitute for the grant. Explicit here rather than assuming this
-- project's ALTER DEFAULT PRIVILEGES setup covers it (confirmed by testing
-- this migration against a bare Postgres instance with no Supabase
-- provisioning: policies alone produced "permission denied for table
-- sms_log", not the empty-result-set behavior a policy denial gives).
grant select, insert, delete on public.sms_log to authenticated;
grant usage, select on sequence sms_log_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.10_sms_log.sql
-- ═══════════════════════════════════════════════════════════════════════
