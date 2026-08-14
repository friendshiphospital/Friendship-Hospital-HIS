-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.13_delta_and_instrument_log.sql
-- Adds audit-log tables for two new Laboratory features in index.html:
--   1. Delta Checking (safety alerts when a new result swings wildly from
--      the patient's last on-file result)
--   2. Instrument Interfacing / Middleware message log (ASTM/HL7 message
--      ingestion + auto-verification decisions)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in the Supabase SQL editor, after migration_v2.8_rls_security.sql
-- (depends on public.current_staff_role()/is_admin()/is_clinical_staff()).
-- Idempotent — safe to re-run.
--
-- WHY A NEW delta_check_log TABLE (not new columns on results_hematology/
-- results_chemistry):
--   Those two tables upsert with onConflict:'patient_id' — there is only
--   ever ONE row per patient in each (a running "current CBC"/"current
--   chemistry panel" snapshot, not a visit history). That means delta
--   checking cannot compare against "the row before this one" by querying
--   history from those tables — index.html instead reads the existing row
--   immediately before it gets overwritten, compares it to the incoming
--   save, and if a safety threshold is breached, writes a row here BEFORE
--   the overwrite happens. This table is therefore the only place a delta
--   breach and its resolution (reason code, who overrode it) are durably
--   recorded — an audit trail that would otherwise be destroyed by the
--   next upsert.
--
-- WHY A NEW instrument_messages TABLE:
--   The existing Analyzer Interface page (#page-analyzer) only ever stored
--   *configuration* (protocol/host/port) — it never persisted actual
--   incoming messages. This table gives the new Instrument Data Stream /
--   Middleware panel a real backing store for parsed ASTM/HL7 messages
--   (simulated or pasted in — see the panel's own note about why a live
--   TCP/MLLP listener isn't possible from a static client-side app) and
--   their sync/mapping status.

create table if not exists public.delta_check_log (
  id                bigint generated always as identity primary key,
  patient_id        uuid not null,
  result_table      text not null,                 -- e.g. 'results_hematology'
  department        text not null,                 -- e.g. 'Haematology'
  field             text not null,                 -- e.g. 'hgb'
  field_label       text not null,                 -- e.g. 'Haemoglobin'
  previous_value    numeric,
  previous_date     timestamptz,
  current_value     numeric not null,
  delta_type        text not null check (delta_type in ('pct','abs')),
  delta_value       numeric not null,               -- computed % change or absolute shift
  threshold         numeric not null,
  direction         text not null check (direction in ('drop','rise','either')),
  auto_verify_blocked boolean not null default true,
  reason_code       text,                           -- required before save proceeds
  reason_note       text,
  resolved_by       uuid,
  resolved_by_name  text,
  created_at        timestamptz not null default now()
);

create index if not exists delta_check_log_patient_idx on public.delta_check_log (patient_id);
create index if not exists delta_check_log_created_at_idx on public.delta_check_log (created_at desc);

alter table public.delta_check_log enable row level security;

drop policy if exists delta_check_log_select on public.delta_check_log;
create policy delta_check_log_select on public.delta_check_log
  for select
  using (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

drop policy if exists delta_check_log_insert on public.delta_check_log;
create policy delta_check_log_insert on public.delta_check_log
  for insert
  with check (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

-- No UPDATE/DELETE policy for any role — a flagged delta event and its
-- recorded resolution shouldn't be editable or removable after the fact,
-- same rationale as sms_log/critical_values.

revoke all on public.delta_check_log from anon;
grant select, insert on public.delta_check_log to authenticated;
grant usage, select on sequence delta_check_log_id_seq to authenticated;


create table if not exists public.instrument_messages (
  id                bigint generated always as identity primary key,
  machine_id        text not null,                 -- e.g. 'Sysmex XN-1000'
  protocol          text not null check (protocol in ('ASTM','HL7')),
  raw_message       text not null,
  sample_barcode    text,
  patient_id        uuid,
  test_parameter    text,
  raw_value         text,
  parsed_value      numeric,
  sync_status       text not null default 'pending_mapping'
                      check (sync_status in ('auto_mapped','pending_mapping','error')),
  error_detail      text,
  mapped_table      text,                          -- e.g. 'results_hematology'
  mapped_field      text,                          -- e.g. 'hgb'
  imported_by       uuid,
  imported_by_name  text,
  imported_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists instrument_messages_created_at_idx on public.instrument_messages (created_at desc);
create index if not exists instrument_messages_patient_idx on public.instrument_messages (patient_id);

alter table public.instrument_messages enable row level security;

drop policy if exists instrument_messages_select on public.instrument_messages;
create policy instrument_messages_select on public.instrument_messages
  for select
  using (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

drop policy if exists instrument_messages_insert on public.instrument_messages;
create policy instrument_messages_insert on public.instrument_messages
  for insert
  with check (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

drop policy if exists instrument_messages_update on public.instrument_messages;
create policy instrument_messages_update on public.instrument_messages
  for update
  using (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

revoke all on public.instrument_messages from anon;
grant select, insert, update on public.instrument_messages to authenticated;
grant usage, select on sequence instrument_messages_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.13_delta_and_instrument_log.sql
-- ═══════════════════════════════════════════════════════════════════════
