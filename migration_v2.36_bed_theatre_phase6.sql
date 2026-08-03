-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.36_bed_theatre_phase6.sql
-- Documentation/Logbook expansion, Phase 6 (Bed Management & Theatre)
-- ═══════════════════════════════════════════════════════════════════════
--
-- No schema changes needed for the Bed Transfer Register or Daily Bed
-- Census — both are pure reporting layers over existing data
-- (bed_transfers, admissions, beds), confirmed by the Phase 0 audit to
-- already exist; only the register/report VIEW was missing.
--
-- who_safety_checklist is genuinely new — the WHO Surgical Safety
-- Checklist's three sequential stages (Sign In/Time Out/Sign Out), one
-- row per theatre_bookings row, each stage independently timestamped and
-- attributed. The existing pre_op_assessments/pre_op_checklist is a
-- single flat form completed once before the OT day (closest to a
-- "Sign In" equivalent in spirit, but not the same intra-operative
-- three-phase team check this models) and is left untouched.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.who_safety_checklist (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.theatre_bookings(id) on delete cascade,
  signin_items jsonb, signin_completed_by uuid references auth.users(id), signin_completed_by_name text, signin_completed_at timestamptz,
  timeout_items jsonb, timeout_completed_by uuid references auth.users(id), timeout_completed_by_name text, timeout_completed_at timestamptz,
  signout_items jsonb, signout_completed_by uuid references auth.users(id), signout_completed_by_name text, signout_completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.who_safety_checklist enable row level security;

-- Same admin/clinical-staff shape as the rest of the Theatre workflow
-- (theatre_bookings/pre_op_assessments). No delete policy — a completed
-- stage is a permanent record, matching blood_issue_log's precedent.
drop policy if exists who_safety_checklist_select on public.who_safety_checklist;
create policy who_safety_checklist_select on public.who_safety_checklist
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists who_safety_checklist_insert on public.who_safety_checklist;
create policy who_safety_checklist_insert on public.who_safety_checklist
  for insert with check (public.is_admin() or public.is_clinical_staff());

drop policy if exists who_safety_checklist_update on public.who_safety_checklist;
create policy who_safety_checklist_update on public.who_safety_checklist
  for update using (public.is_admin() or public.is_clinical_staff())
  with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.who_safety_checklist from anon;
grant select, insert, update on public.who_safety_checklist to authenticated;

comment on table public.who_safety_checklist is 'WHO Surgical Safety Checklist — one row per theatre_bookings row, three independently-gated sequential stages (Sign In / Time Out / Sign Out). Each stage requires every item checked plus a signing staff name (index.html completeWhoStage()) before the next stage unlocks (openWhoChecklist()/renderWhoStage()).';
