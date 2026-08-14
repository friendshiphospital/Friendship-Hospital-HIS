-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.25_blood_bank_intake.sql
-- Blood Bank / Transfusion Services, Phase 2 — dual-source unit intake
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   migration_v2.24 (Phase 1) deliberately left blood_units' source-
--   specific linkage out — this migration adds exactly what each of the
--   two intake paths needs, nothing added speculatively.
--
-- WHAT THIS ADDS
--   Path A (In-House Donation):
--     blood_donors      — one row per donor, reusable across repeat
--                          donations (donation history = every
--                          blood_donations row with this donor_id).
--     blood_donations    — one row per collection EVENT. Carries the
--                          eligibility screening questionnaire answers
--                          and the mandatory infectious-disease screening
--                          results (HIV/HBV/HCV/Syphilis/Malaria). A
--                          donation only becomes `cleared` once every
--                          result is recorded Negative — clearDonation()
--                          in index.html is the only thing allowed to move
--                          its linked blood_units out of Quarantined.
--     blood_units.donation_id — added by this migration, links a unit
--                          back to the donation event that produced it (a
--                          single collection can produce more than one
--                          unit, e.g. several identical-expiry bags from
--                          one donation — they all share one donation_id).
--
--   Path B (External Receipt) — lighter-weight, no donor/donation
--   records at all (there is no local donor); everything it needs is
--   columns added directly to blood_units: which organisation supplied
--   it, their own unit reference, what they attest about their own
--   screening (recorded as their attestation, never re-derived or
--   verified beyond that — per spec, "record what they attest"), and the
--   mandatory (not skippable) "Verified on Receipt" confirmation that the
--   physical unit's own label matches what was recorded, before the unit
--   can leave Quarantined.
--
-- Both paths still converge on the exact same blood_units row/status
-- lifecycle from Phase 1 — this migration only adds how a unit GOT there,
-- never a second status system.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.24.
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — Path A: donors + donations
-- ───────────────────────────────────────────────────────────────────────

create table if not exists public.blood_donors (
  id                    uuid primary key default gen_random_uuid(),
  donor_no              text not null unique,
  full_name             text not null,
  age                   integer,
  sex                   text,
  phone                 text,
  blood_group           text check (blood_group in ('A','B','AB','O')),
  rh_factor             text check (rh_factor in ('Positive','Negative')),
  address               text,
  created_by            uuid,
  created_by_name       text,
  created_at            timestamptz not null default now()
);

comment on table public.blood_donors is
  'One row per donor (Blood Bank Phase 2, In-House Donation path). Donation history = every blood_donations row with this donor_id — nothing here is duplicated per-donation.';

create table if not exists public.blood_donations (
  id                       uuid primary key default gen_random_uuid(),
  donor_id                 uuid not null references public.blood_donors(id) on delete cascade,
  collection_date          date not null default current_date,
  -- Eligibility screening questionnaire (basic deferral criteria)
  recent_illness           boolean not null default false,
  on_medication             boolean not null default false,
  recent_travel             boolean not null default false,
  prior_deferral             boolean not null default false,
  deferral_notes            text,
  -- Mandatory infectious-disease screening — each starts Pending; a
  -- donation is only `cleared` once every one of these is 'Negative'.
  hiv_result                text not null default 'Pending' check (hiv_result in ('Pending','Negative','Positive')),
  hbv_result                text not null default 'Pending' check (hbv_result in ('Pending','Negative','Positive')),
  hcv_result                text not null default 'Pending' check (hcv_result in ('Pending','Negative','Positive')),
  syphilis_result           text not null default 'Pending' check (syphilis_result in ('Pending','Negative','Positive')),
  malaria_result            text not null default 'Pending' check (malaria_result in ('Pending','Negative','Positive')),
  cleared                   boolean not null default false,
  screened_by               text,
  screened_at               timestamptz,
  created_by                uuid,
  created_by_name           text,
  created_at                timestamptz not null default now()
);

create index if not exists blood_donations_donor_idx on public.blood_donations (donor_id);
create index if not exists blood_donations_cleared_idx on public.blood_donations (cleared);

comment on table public.blood_donations is
  'One row per collection event (Blood Bank Phase 2). cleared is set true only when every one of hiv_result/hbv_result/hcv_result/syphilis_result/malaria_result is Negative — clearDonation() (index.html) is the only path that sets it, and it is the only thing that moves this donation''s linked blood_units out of Quarantined.';

alter table public.blood_units add column if not exists donation_id uuid references public.blood_donations(id) on delete set null;
comment on column public.blood_units.donation_id is
  'Links a unit back to the In-House Donation collection event that produced it (Path A only — null for externally-received units). A single donation can produce more than one unit; all share the same donation_id.';

alter table public.blood_donors enable row level security;
drop policy if exists blood_donors_select on public.blood_donors;
create policy blood_donors_select on public.blood_donors for select using (public.is_admin() or public.is_lab_staff());
drop policy if exists blood_donors_insert on public.blood_donors;
create policy blood_donors_insert on public.blood_donors for insert with check (public.is_admin() or public.is_lab_staff());
drop policy if exists blood_donors_update on public.blood_donors;
create policy blood_donors_update on public.blood_donors for update using (public.is_admin() or public.is_lab_staff()) with check (public.is_admin() or public.is_lab_staff());
revoke all on public.blood_donors from anon;
grant select, insert, update on public.blood_donors to authenticated;

alter table public.blood_donations enable row level security;
drop policy if exists blood_donations_select on public.blood_donations;
create policy blood_donations_select on public.blood_donations for select using (public.is_admin() or public.is_lab_staff());
drop policy if exists blood_donations_insert on public.blood_donations;
create policy blood_donations_insert on public.blood_donations for insert with check (public.is_admin() or public.is_lab_staff());
drop policy if exists blood_donations_update on public.blood_donations;
create policy blood_donations_update on public.blood_donations for update using (public.is_admin() or public.is_lab_staff()) with check (public.is_admin() or public.is_lab_staff());
revoke all on public.blood_donations from anon;
grant select, insert, update on public.blood_donations to authenticated;

-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — Path B: external receipt fields directly on blood_units
-- ───────────────────────────────────────────────────────────────────────

alter table public.blood_units add column if not exists external_source_org text;
alter table public.blood_units add column if not exists external_unit_ref text;
alter table public.blood_units add column if not exists external_screening_attested text;
alter table public.blood_units add column if not exists received_by text;
alter table public.blood_units add column if not exists receipt_date date;
alter table public.blood_units add column if not exists verified_on_receipt boolean not null default false;
alter table public.blood_units add column if not exists verified_by text;
alter table public.blood_units add column if not exists verified_at timestamptz;

comment on column public.blood_units.external_screening_attested is
  'What the SUPPLYING organisation attests about their own screening (e.g. "Screened per national blood safety protocol, certificate #1234") — recorded as their claim, never re-derived or independently verified here. verified_on_receipt below is a separate, lighter check: does the physical unit''s own label match what was recorded at intake.';

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.25_blood_bank_intake.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select cleared, count(*) from public.blood_donations group by cleared;
--   select verified_on_receipt, count(*) from public.blood_units
--     where source = 'Received - External Supply' group by verified_on_receipt;
-- ═══════════════════════════════════════════════════════════════════════
