-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.43_lab_verification_scoping.sql
-- Lab Safety Phase 1: verification scoped to what was actually ordered
-- this visit (all seven lab departments)
-- ═══════════════════════════════════════════════════════════════════════
--
-- ROOT CAUSE (see Phase 0 findings): every results_* table has a single
-- row-level is_verified boolean. Every department's save function stamped
-- that ONE flag across the WHOLE row on Verify, including columns that
-- were never part of this visit's order -- e.g. a column still holding a
-- value from an earlier order in the same visit (results_* tables are one
-- row per patient_id; a single visit/admission commonly has more than one
-- lab order over its course, and loadExistingResults() pre-fills the
-- entry form from whatever the row already has). Verifying a NEWLY
-- ordered test therefore silently also stamped an OLDER, never-reviewed
-- value as freshly verified.
--
-- FIX: verified_fields records, per row, exactly which result columns
-- have actually been reviewed and verified -- only ever appended to for
-- columns that were part of THIS visit's order (index.html:
-- checkVerificationComplete() / checkMicroVerificationComplete() /
-- checkPcrVerificationComplete() / checkHistoVerificationComplete() /
-- checkCytoVerificationComplete()), never touched for anything else.
-- is_verified stays as a boolean, but its meaning changes from "someone
-- clicked Verify once, ever" to "every test ordered as of the most recent
-- Verify action has a value AND is recorded in verified_fields" --
-- recomputed on every Verify, never a blind carry-forward.
--
-- Column shape differs slightly by department because the underlying
-- report shapes differ (see Phase 0 report):
--   - results_hematology / results_chemistry / results_serology: holds
--     actual result-table COLUMN NAMES (e.g. 'wbc', 'hgb', 'tbil') --
--     these three departments (results_serology is shared by the
--     Serology AND Immunology entry pages) already have exact
--     column-to-test-name tagging via RESULT_TAGS in index.html, reused
--     from printAllReports()'s existing stray-value filtering.
--   - results_microbiology: holds column names too, but completeness is
--     checked per ordered PANEL (e.g. "Urinalysis (UA)"), not per
--     individual sub-field -- many UA/stool/CSF sub-fields are legitimately
--     method-dependent and optional, unlike a Hem/Chem analyzer panel that
--     always reports every parameter together.
--   - results_pcr: holds PCR TARGET/PATHOGEN NAMES (e.g. 'COVID-19 PCR'),
--     not column names -- results_pcr.tests.targets is a jsonb array of
--     {target, result, ct_value}, not fixed columns.
--   - results_histopathology / results_cytology: holds a simple marker
--     (e.g. 'diagnosis') since these are one narrative report per
--     specimen, not a multi-analyte panel -- completeness there just means
--     "the diagnosis/findings field is filled," not per-sub-field.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.results_hematology     add column if not exists verified_fields text[] default '{}';
alter table public.results_chemistry      add column if not exists verified_fields text[] default '{}';
alter table public.results_serology       add column if not exists verified_fields text[] default '{}'; -- shared by Serology + Immunology entry pages
alter table public.results_microbiology   add column if not exists verified_fields text[] default '{}';
alter table public.results_pcr            add column if not exists verified_fields text[] default '{}';
alter table public.results_histopathology add column if not exists verified_fields text[] default '{}';
alter table public.results_cytology       add column if not exists verified_fields text[] default '{}';

comment on column public.results_hematology.verified_fields is 'Lab Safety Phase 1 — result columns actually verified as part of an order, append-only per Verify action. Never includes a column outside what was ordered that visit.';
comment on column public.results_chemistry.verified_fields is 'Lab Safety Phase 1 — see results_hematology.verified_fields.';
comment on column public.results_serology.verified_fields is 'Lab Safety Phase 1 — see results_hematology.verified_fields. Shared by Serology and Immunology entry pages; each only ever adds its OWN department''s columns, never touching the other''s.';
comment on column public.results_microbiology.verified_fields is 'Lab Safety Phase 1 — result columns actually verified, appended per ordered panel (Urinalysis/Stool/Culture/CSF), not per individual sub-field.';
comment on column public.results_pcr.verified_fields is 'Lab Safety Phase 1 — PCR target/pathogen NAMES actually verified (not column names — results_pcr.tests.targets is a jsonb array, not fixed columns).';
comment on column public.results_histopathology.verified_fields is 'Lab Safety Phase 1 — simple marker (''diagnosis'') recorded once the diagnosis field is verified for an ordered biopsy/specimen.';
comment on column public.results_cytology.verified_fields is 'Lab Safety Phase 1 — simple marker (''diagnosis'') recorded once the diagnosis/findings field is verified for an ordered specimen.';
