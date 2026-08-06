-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.38_analyzer_validation.sql
-- Analyzer Validation & Verification (CLSI EP15-A3 precision verification,
-- EP09-A3 method comparison, EP06-A linearity — EP06-A UI/statistics are
-- not implemented in this first pass; the schema below is shaped to hold
-- its results later without another migration, but nothing writes to the
-- EP06-A-specific columns yet).
--
-- Phase 0 overlap check (see index.html investigation): this is
-- deliberately NOT layered onto qc_lots/qc_results. QC (Levey-Jennings,
-- Westgard, Six Sigma) monitors an instrument that is already in
-- service, ongoing, indefinitely. A validation study CERTIFIES an
-- instrument before it goes into service (or after a major change — new
-- lot, new instrument, method change), is bounded (a fixed number of
-- runs/replicates), and produces a one-time PASS/FAIL determination that
-- a Quality Manager and Laboratory Director sign off on. Distinct
-- purpose, distinct lifecycle, distinct table — no duplication risk.
--
-- Two things this migration deliberately does NOT introduce, because
-- reusing something that doesn't exist would be worse than not having it:
--   1. No instrument/analyzer registry FK. The Analyzer Interface page's
--      "Registered Analyzers" table (index.html addAnalyzerRow()) is
--      pure client-side DOM state with no backing Supabase table at all
--      today — it doesn't even survive a page reload. There is nothing
--      to foreign-key validation_studies.instrument_id against, so
--      instrument identity is plain text (name + serial) here, matching
--      how "analyzer" is already handled everywhere else in this app
--      (free-text fields on results_hematology/results_chemistry/etc.,
--      never a normalized instruments table).
--   2. No DB-side TEa table/join. The existing TEa reference data
--      (TEA_REFERENCE_DEFAULTS / teaFor(analyte) in index.html) is a
--      client-side JS object with per-analyte localStorage overrides,
--      not a database table. validation_studies.tea_limit stores the
--      value teaFor(analyte) resolved to at study-creation time, so the
--      historical record stays accurate even if the reference value is
--      edited later — not a live join to something that doesn't exist
--      server-side.
--
-- Digital-signature attribution reuses this app's existing performed_by/
-- verified_by/verified_at pattern (see consent_forms, radiology_requests)
-- rather than inventing a new one — extended to two named sign-off
-- stages (Quality Manager review, Laboratory Director approval) the same
-- way who_safety_checklist already models multiple independently-signed
-- stages on one row, rather than a single generic "verified" flag.
--
-- Actor columns (created_by/entered_by/performed_by/verified_by/
-- approved_by) are plain uuid, NOT `references auth.users(id)`. The app
-- writes currentProfile?.id to these — the `staff` table's own row id,
-- not the Supabase Auth user id (that's currentProfile.user_id) — and
-- this codebase never enforces that FK anywhere else (see
-- migration_v2.14/24/25/26). Constraining it here (an earlier version of
-- this migration did) broke every save for any staff account whose row
-- wasn't created with id==auth uid, which is not guaranteed for accounts
-- set up before the one-step staff-creation flow existed.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.validation_studies (
  id uuid primary key default gen_random_uuid(),
  analyte text not null,
  instrument_name text not null,
  instrument_serial text,
  protocol_type text not null check (protocol_type in ('EP15-A3','EP09-A3','EP06-A')),
  unit text,
  tea_limit numeric,
  claimed_cv_pct numeric,
  status text not null default 'Draft' check (status in ('Draft','In Progress','Completed')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_validation_studies_analyte on public.validation_studies(analyte, created_at desc);

comment on table public.validation_studies is 'One row per validation study (header/metadata) — CLSI EP15-A3 precision verification, EP09-A3 method comparison, or EP06-A linearity (schema-ready, not yet implemented in the UI). status tracks data-entry workflow, distinct from the PASS/FAIL clinical determination which lives per-calculation-run on validation_results.';
comment on column public.validation_studies.instrument_name is 'Free text — no instrument registry exists in this app to foreign-key against (see migration header note).';
comment on column public.validation_studies.tea_limit is 'Total allowable error %, resolved from index.html teaFor(analyte) at study-creation time and stored here so the historical record is stable even if the reference value is edited later.';
comment on column public.validation_studies.claimed_cv_pct is 'Manufacturer/method-claimed %CV being verified against (EP15-A3).';

create table if not exists public.validation_samples (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.validation_studies(id) on delete cascade,
  run_number integer not null,
  replicate_number integer not null,
  target_level text,
  method text check (method in ('X','Y')),
  result_value numeric not null,
  entered_by uuid,
  entered_by_name text,
  entered_at timestamptz not null default now()
);

create index if not exists idx_validation_samples_study on public.validation_samples(study_id, run_number, replicate_number);

comment on table public.validation_samples is 'Raw replicate run data entered against a validation_studies row. target_level is the EP15-A3 concentration level label (e.g. Low/Normal/High), not a fixed enum since labs use different level naming. method (X/Y) is only populated for EP09-A3 method-comparison studies — null for EP15-A3.';

create table if not exists public.validation_results (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.validation_studies(id) on delete cascade,
  -- EP15-A3 (precision verification)
  grand_mean numeric,
  ms_within numeric,
  ms_between numeric,
  cv_within_pct numeric,
  cv_total_pct numeric,
  uvl numeric,
  -- EP09-A3 (method comparison)
  regression_method text check (regression_method in ('Deming','OLS')),
  slope numeric,
  intercept numeric,
  r_squared numeric,
  bias_pct numeric,
  sd_differences numeric,
  -- Shared determination + two-stage sign-off, mirroring
  -- who_safety_checklist's multiple-independently-signed-stages pattern.
  -- 'Pending Review' covers EP09-A3 studies where no TEa is on file to
  -- auto-judge bias% against -- EP15-A3 always resolves to Pass/Fail
  -- (claimed-CV/UVL is always evaluable once claimed_cv_pct is entered).
  result_status text not null check (result_status in ('Pass','Fail','Pending Review')),
  calculated_at timestamptz not null default now(),
  performed_by uuid,
  performed_by_name text,
  verified_by uuid,
  verified_by_name text,
  verified_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz
);

create index if not exists idx_validation_results_study on public.validation_results(study_id, calculated_at desc);

comment on table public.validation_results is 'One row per calculation run against a validation_studies row (re-running after adding more samples creates a new row rather than overwriting — the most recent row by calculated_at is current). regression_method records whether slope/intercept/r_squared came from true Deming regression or OLS (labeled explicitly per the requirement to never present OLS output as if it were Deming). verified_by/verified_at = Quality Manager review; approved_by/approved_at = Laboratory Director approval — both optional/nullable until actually signed, printed as blank signature lines on the report until then.';

alter table public.validation_studies enable row level security;
alter table public.validation_samples enable row level security;
alter table public.validation_results enable row level security;

-- Same admin/lab-staff shape as qc_lots/qc_results — this is lab
-- instrument validation, not general clinical data, so is_lab_staff()
-- rather than is_clinical_staff(). validation_studies allows update (the
-- header/status can be edited while a study is still in Draft/In
-- Progress); samples and results are append-only, matching this app's
-- existing precedent for entered data and calculated/signed results
-- (blood_issue_log, consent_forms) — a correction is a new row, not an
-- edit to history.
drop policy if exists validation_studies_select on public.validation_studies;
create policy validation_studies_select on public.validation_studies
  for select using (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_studies_insert on public.validation_studies;
create policy validation_studies_insert on public.validation_studies
  for insert with check (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_studies_update on public.validation_studies;
create policy validation_studies_update on public.validation_studies
  for update using (public.is_admin() or public.is_lab_staff())
  with check (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_samples_select on public.validation_samples;
create policy validation_samples_select on public.validation_samples
  for select using (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_samples_insert on public.validation_samples;
create policy validation_samples_insert on public.validation_samples
  for insert with check (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_results_select on public.validation_results;
create policy validation_results_select on public.validation_results
  for select using (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_results_insert on public.validation_results;
create policy validation_results_insert on public.validation_results
  for insert with check (public.is_admin() or public.is_lab_staff());

-- Sign-off stages (verified_by/approved_by) ARE written after the initial
-- insert (a Quality Manager/Lab Director signs off some time after the
-- calculation itself), so validation_results needs a scoped update policy
-- for that specific purpose — same shape as the others.
drop policy if exists validation_results_update on public.validation_results;
create policy validation_results_update on public.validation_results
  for update using (public.is_admin() or public.is_lab_staff())
  with check (public.is_admin() or public.is_lab_staff());

revoke all on public.validation_studies from anon;
revoke all on public.validation_samples from anon;
revoke all on public.validation_results from anon;
grant select, insert, update on public.validation_studies to authenticated;
grant select, insert on public.validation_samples to authenticated;
grant select, insert, update on public.validation_results to authenticated;
