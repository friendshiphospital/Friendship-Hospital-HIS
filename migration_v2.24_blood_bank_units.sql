-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.24_blood_bank_units.sql
-- Blood Bank / Transfusion Services, Phase 1 — blood unit inventory
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   reagent_inventory + inventory_batches (migration_v2.14) already give
--   this app a working FEFO (First-Expiry-First-Out) engine —
--   computeExpiryStatus()/dispenseFromInventoryFefo() in index.html. That
--   engine models an ITEM (e.g. "Glucose Reagent") with many interchangeable
--   BATCHES, each just an aggregate quantity + one shared expiry date —
--   perfectly right for reagent stock, wrong for blood units. A blood unit
--   is not fungible: unit BB-2026-0001 is a specific bag with its own
--   barcode, its own individual lifecycle (Quarantined -> Available ->
--   Crossmatched -> Issued, or Expired/Discarded), and it gets reserved
--   against ONE specific patient's request, never "any 2 of this batch."
--   So this is a new table, not a reuse of inventory_batches — but it
--   deliberately mirrors that engine's SHAPE (expiry_date, status,
--   FEFO-style sorted allocation) and reuses computeExpiryStatus()'s exact
--   colour thresholds/logic directly (called client-side against
--   blood_units.expiry_date, not duplicated) so units and reagents look
--   and behave the same way in the UI.
--
--   Blood group/Rh already exists per-patient on results_hematology
--   (blood_group/rh_factor columns, one row per patient) — Blood Bank
--   reads that as the source of truth for a PATIENT's type (see Phase 3's
--   crossmatch check) rather than storing it a second time anywhere
--   patient-side; blood_units.blood_group/rh_factor below is the UNIT's
--   own type, a completely different thing (donor/supplier-typed), and
--   both must independently be on file before Phase 3 can crossmatch them
--   against each other.
--
-- WHAT THIS ADDS
--   blood_units — one row per physical unit. source/donor-linkage fields
--   (donor_id, external receipt fields) are deliberately NOT added here —
--   Phase 2's own migration adds those once the donor-registration and
--   external-receipt tables exist, keeping each migration scoped to what
--   its own phase actually needs, same discipline as every prior phased
--   migration in this repo.
--
--   unit_no is generated client-side the same simple way admissions.
--   admission_no already is (index.html's submitAdmission(): a
--   count-based 'BB-<year>-<seq>' format) rather than wiring it into the
--   generate_next_id()/COUNTER_TO_ID_TYPE system used for
--   MRN/OPD/IP/lab/radiology numbers — those are patient-identity numbers
--   where a collision is a much more serious safety issue than here, and
--   admission_no already establishes this simpler pattern is an accepted
--   choice in this codebase for a non-patient-identity sequence.
--
-- Component-specific default shelf-life (AABB standard, days) is a
-- client-side Settings default (CFG.bloodShelfLife*), not stored here —
-- same pattern as every other admin-configurable numeric threshold in
-- this app (e.g. CFG.bedTurnaroundAmberMin). expiry_date itself is always
-- an explicit, staff-entered value at intake (Phase 2), never silently
-- computed and hidden from the person recording the unit.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.23.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.blood_units (
  id               uuid primary key default gen_random_uuid(),
  unit_no          text not null unique,
  blood_group      text not null check (blood_group in ('A','B','AB','O')),
  rh_factor        text not null check (rh_factor in ('Positive','Negative')),
  component_type   text not null check (component_type in ('Whole Blood','Packed RBC','FFP','Platelets','Cryoprecipitate')),
  collection_date  date,
  expiry_date      date not null,
  volume_ml        numeric,
  source           text not null check (source in ('In-House Donation','Received - External Supply')),
  status           text not null default 'Quarantined' check (status in ('Quarantined','Available','Crossmatched','Issued','Expired','Discarded')),
  discard_reason   text,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now()
);

create index if not exists blood_units_status_idx on public.blood_units (status);
create index if not exists blood_units_expiry_idx on public.blood_units (expiry_date);
create index if not exists blood_units_group_idx on public.blood_units (blood_group, rh_factor, component_type, status);

comment on table public.blood_units is
  'One row per physical blood unit (Blood Bank / Transfusion Services module, index.html). Deliberately separate from reagent_inventory/inventory_batches — see migration file header for why. status lifecycle: Quarantined (just intaken, screening/verification not yet cleared) -> Available (cleared, in general stock) -> Crossmatched (reserved against one specific blood_requests row, Phase 3) -> Issued (handed over via the mandatory two-person verification, Phase 4) — or Expired/Discarded at any point before Issued, always with discard_reason set (no silent removals).';
comment on column public.blood_units.source is
  'Provenance tracking only, per spec — does not fork downstream behaviour. In-House Donation units additionally link to a donor/collection record (Phase 2 migration adds donor_id once that table exists); External Supply units additionally record the supplying organisation''s own reference (Phase 2 migration adds those columns too).';

alter table public.blood_units enable row level security;

drop policy if exists blood_units_select on public.blood_units;
create policy blood_units_select on public.blood_units
  for select using (public.is_admin() or public.is_clinical_staff());

-- Update is intentionally broader than just lab staff: Phase 4's mandatory
-- two-person issue verification requires a RECEIVING nurse/doctor
-- (is_clinical_staff(), not just is_lab_staff()) to also be able to write
-- their own independent confirmation onto the same unit row — scoping
-- this now avoids a second migration just to widen the policy later.
drop policy if exists blood_units_insert on public.blood_units;
create policy blood_units_insert on public.blood_units
  for insert with check (public.is_admin() or public.is_lab_staff());

drop policy if exists blood_units_update on public.blood_units;
create policy blood_units_update on public.blood_units
  for update using (public.is_admin() or public.is_clinical_staff())
  with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.blood_units from anon;
grant select, insert, update on public.blood_units to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.24_blood_bank_units.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, component_type, count(*) from public.blood_units
--     group by status, component_type order by status, component_type;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'blood_units' order by cmd;
-- ═══════════════════════════════════════════════════════════════════════
