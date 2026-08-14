-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.21_bed_transfers.sql
-- Bed Management (IPD) overhaul, Phase 3 — ward/bed transfer log
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   Nothing like a ward/bed transfer existed anywhere in the schema or
--   index.html before this. admissions.ward/room/bed are plain free-text
--   columns (not FKs) that submitAdmission() sets once at admission and
--   saveDischarge() never touches again — there was no path that updated
--   them mid-stay, and no record of a bed having changed hands.
--
-- WHAT THIS ADDS
--   One row per transfer, written by submitBedTransfer() (index.html, the
--   per-bed drawer's new Transfer tab) — logs the timestamp, who did it,
--   why, and both the old and new ward/room/bed, then the same function
--   updates admissions.ward/room/bed to the new location and re-points
--   the beds table (frees the old bed, occupies the new one) using the
--   exact same two beds writes submitAdmission()/saveDischarge() already
--   make elsewhere — no new bed-linking convention introduced.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.20.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.bed_transfers (
  id                  bigint generated always as identity primary key,
  admission_id        uuid not null references public.admissions(id) on delete cascade,
  patient_id          uuid references public.patients(id) on delete set null,
  from_ward           text,
  from_room           text,
  from_bed            text,
  to_ward             text not null,
  to_room             text not null,
  to_bed              text not null,
  reason              text not null,
  transferred_by      uuid,
  transferred_by_name text,
  transferred_at      timestamptz not null default now()
);

create index if not exists bed_transfers_admission_idx on public.bed_transfers (admission_id, transferred_at);

comment on table public.bed_transfers is
  'Ward/bed transfer log, written by submitBedTransfer() (index.html, per-bed drawer Transfer tab). One row per transfer; admissions.ward/room/bed always reflects the CURRENT location, this table is the history.';

alter table public.bed_transfers enable row level security;

drop policy if exists bed_transfers_select on public.bed_transfers;
create policy bed_transfers_select on public.bed_transfers
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists bed_transfers_insert on public.bed_transfers;
create policy bed_transfers_insert on public.bed_transfers
  for insert with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.bed_transfers from anon;
grant select, insert on public.bed_transfers to authenticated;
grant usage, select on sequence bed_transfers_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.21_bed_transfers.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'bed_transfers' order by cmd;
-- ═══════════════════════════════════════════════════════════════════════
