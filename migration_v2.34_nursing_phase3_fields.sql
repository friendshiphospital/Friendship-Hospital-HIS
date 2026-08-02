-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.34_nursing_phase3_fields.sql
-- Documentation/Logbook expansion, Phase 3 (Nursing)
-- ═══════════════════════════════════════════════════════════════════════
--
-- SBAR-structured Ward Handover Notes. The Phase 0 audit confirmed
-- Handover Notes existed but was NOT SBAR-structured — it had a
-- Ward/Shift/Date/staff header plus free-text Critical Patients/Pending
-- Tasks/General Notes fields, none labeled or stored as Situation/
-- Background/Assessment/Recommendation. This adds four genuinely
-- distinct, separately-stored fields for the SBAR structure, alongside
-- (not replacing) the existing Critical/Pending/Notes fields.
--
-- No schema changes needed for MAR (Medication Administration Record) —
-- mar_entries is a jsonb column on vital_signs, and the new Refused
-- status, per-row reason, and second-staff-verification fields
-- (reason, second_verified_by) are simply additional keys inside each
-- JSON entry, requiring no new columns.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.ward_handover_notes
  add column if not exists situation text,
  add column if not exists background text,
  add column if not exists assessment text,
  add column if not exists recommendation text;

comment on column public.ward_handover_notes.situation is 'SBAR — Situation: what is happening right now (index.html #ho-situation).';
comment on column public.ward_handover_notes.background is 'SBAR — Background: relevant clinical/admission history (index.html #ho-background).';
comment on column public.ward_handover_notes.assessment is 'SBAR — Assessment: current clinical assessment (index.html #ho-assessment).';
comment on column public.ward_handover_notes.recommendation is 'SBAR — Recommendation: what the receiving shift should do (index.html #ho-recommendation).';
