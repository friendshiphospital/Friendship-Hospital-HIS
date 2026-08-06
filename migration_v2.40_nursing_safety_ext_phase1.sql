-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.40_nursing_safety_ext_phase1.sql
-- Nursing Safety Extension, Phase 1 (SOFA score)
-- ═══════════════════════════════════════════════════════════════════════
--
-- SOFA is manual entry only (see the Phase 0 audit note in index.html:
-- results_chemistry/results_hematology upsert one row per patient with no
-- true visit history yet, so SOFA must never auto-pull from them). Only the
-- computed total needs a column, mirroring how braden_score/morse_fall_score
-- already work on this same table -- no per-organ-system columns, since the
-- six individual values are entered fresh each time and never queried back
-- individually.
--
-- No new column needed for the Fluid Balance dangerous-net-positive
-- threshold -- it is an admin-configurable, client-side-only setting
-- (CFG.fluidNetPositiveThreshold, backed by localStorage like every other
-- CFG.* setting in this app), not stored per-patient.
--
-- No new column needed for GCS -- it already exists (gcs_eye/gcs_verbal/
-- gcs_motor on vital_signs) and Phase 1 reuses it directly for SOFA's CNS
-- component rather than asking for it a second time.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.vital_signs
  add column if not exists sofa_score integer;

comment on column public.vital_signs.sofa_score is 'SOFA (Sepsis-related Organ Failure Assessment) total, 0-24 — manual entry only, computed client-side by calcSOFA() in index.html. Six organ systems (Respiration, Coagulation, Liver, Cardiovascular, CNS, Renal), each 0-4; CNS reuses gcs_eye/gcs_verbal/gcs_motor rather than a separate field.';
