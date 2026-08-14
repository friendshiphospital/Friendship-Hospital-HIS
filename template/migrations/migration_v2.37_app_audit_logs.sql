-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.37_app_audit_logs.sql
-- Documentation/Logbook expansion — cross-cutting audit table
-- ═══════════════════════════════════════════════════════════════════════
--
-- The existing audit_logs table (migration_v2.8) is a DB-trigger-driven
-- table covering exactly 8 tables (7 lab result tables + doctor_
-- consultations), UPDATE/DELETE only, never written from client JS.
-- billing_audit_logs is a separate, app-level, JS-driven table but is
-- billing-only. Neither reaches Nursing, Radiology, Bed Management,
-- Theatre, or Blood Bank. Per the Phase 0 audit's own guidance, most
-- individual actions in this app already carry a strong "digital
-- signature" via performed_by/verified_at columns directly on their own
-- rows (lab results, discharge summaries, consent forms, blood_issue_log,
-- bed_transfers, who_safety_checklist, etc.) — this table is NOT meant to
-- duplicate all of that. It exists as a single, queryable, cross-module
-- place to see "what safety-relevant actions happened across the whole
-- hospital", for the specific handful of actions that didn't already
-- have an audit trail of their own (see index.html logAppAudit() call
-- sites: Radiology report verification, manual bed status changes,
-- high-alert MAR second-staff verification, Theatre WHO Checklist stage
-- completions, Blood Bank unit discards).
--
-- Follows billing_audit_logs' exact shape/insert-and-forget pattern
-- (dbWrite('app_audit_logs','insert',{...}) in logAppAudit()), just
-- generalized with a `module` column instead of being billing-specific.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.app_audit_logs (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  action text not null,
  record_id text,
  performed_by uuid,
  performed_by_name text,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_audit_logs_module on public.app_audit_logs(module, created_at desc);

alter table public.app_audit_logs enable row level security;

-- Admin-read (matches audit_logs' own admin-only select policy), any
-- authenticated clinical/admin write — a logging failure must never be
-- what blocks the underlying clinical action, so this stays permissive
-- on insert. No update/delete policy: append-only, same as
-- blood_issue_log and billing_audit_logs.
drop policy if exists app_audit_logs_select on public.app_audit_logs;
create policy app_audit_logs_select on public.app_audit_logs
  for select using (public.is_admin());

drop policy if exists app_audit_logs_insert on public.app_audit_logs;
create policy app_audit_logs_insert on public.app_audit_logs
  for insert with check (public.is_admin() or public.is_clinical_staff() or public.is_lab_staff());

revoke all on public.app_audit_logs from anon;
grant select, insert on public.app_audit_logs to authenticated;

comment on table public.app_audit_logs is 'Cross-module audit trail for Nursing/Radiology/Bed Management/Theatre/Blood Bank actions that did not already have a strong audit trail of their own via performed_by/verified_at columns on their own tables. Written via index.html logAppAudit(). Append-only, admin-read.';

-- ── Radiology verify-step attribution (closes a confirmed Phase 0 gap:
--    updateRadStatus(id,'Verified') previously only flipped the status
--    string, capturing no verifier identity or timestamp at all) ──
alter table public.radiology_requests
  add column if not exists verified_by uuid,
  add column if not exists verified_by_name text,
  add column if not exists verified_at timestamptz;

comment on column public.radiology_requests.verified_by_name is 'Set only when status transitions to Verified (index.html updateRadStatus()) — brings radiology''s Verify step in line with the same is_verified/verified_at pattern already used throughout Lab.';
