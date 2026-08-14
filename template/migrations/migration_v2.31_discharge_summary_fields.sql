-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.31_discharge_summary_fields.sql
-- Bug fix (found during Documentation/Logbook Phase 0 audit): the Doctor
-- Consultation module's own Discharge tab (#doc-tab-discharge, field ids
-- dis-*) has always been visually present and fillable, but its Save
-- button called the same saveDischarge() function used by the separate
-- Admissions-module discharge modal (field ids disch-*) — which only ever
-- read the disch-* fields. None of the Consultation tab's own fields
-- (Reason for Admission, Clinical Findings, Investigations, Treatment,
-- Medications, Follow-up Instructions) were ever actually saved, and its
-- Print button (printDischarge()) read a THIRD set of column names
-- (reason_for_admission, clinical_findings, investigations_summary,
-- treatment_given, discharge_medications, followup_instructions,
-- doctor_name) that no insert anywhere ever wrote — so printing showed
-- blanks for anything entered via that tab.
--
-- The index.html fix makes saveDischarge(source) branch on an explicit
-- 'consultation' origin (only when invoked from the Consultation tab's own
-- Save button) and write these columns; the Admissions-modal path is
-- completely unchanged. This migration adds the columns printDischarge()
-- already expected but that were never defined.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.discharge_summaries
  add column if not exists reason_for_admission text,
  add column if not exists clinical_findings text,
  add column if not exists investigations_summary text,
  add column if not exists treatment_given text,
  add column if not exists discharge_medications text,
  add column if not exists followup_instructions text,
  add column if not exists doctor_name text,
  add column if not exists condition_at_discharge text,
  add column if not exists primary_diagnosis text;

comment on column public.discharge_summaries.reason_for_admission is 'Consultation-tab discharge field (#dis-reason) — presenting complaint at admission, in the doctor''s own words.';
comment on column public.discharge_summaries.clinical_findings is 'Consultation-tab discharge field (#dis-clinical) — summary of clinical findings during admission.';
comment on column public.discharge_summaries.investigations_summary is 'Consultation-tab discharge field (#dis-investigations) — key lab/imaging results.';
comment on column public.discharge_summaries.treatment_given is 'Consultation-tab discharge field (#dis-treatment) — treatment given during admission.';
comment on column public.discharge_summaries.discharge_medications is 'Consultation-tab discharge field (#dis-meds) — medications on discharge.';
comment on column public.discharge_summaries.followup_instructions is 'Consultation-tab discharge field (#dis-followup) — free-text follow-up instructions.';
comment on column public.discharge_summaries.doctor_name is 'Discharging doctor, stamped from currentProfile at save time (Consultation-tab path).';
comment on column public.discharge_summaries.condition_at_discharge is 'Duplicate of discharge_condition, written by the Consultation-tab path — kept as a separate column since printDischarge() reads this name; both are populated identically by saveDischarge().';
comment on column public.discharge_summaries.primary_diagnosis is 'Duplicate of final_diagnosis, written by the Consultation-tab path — kept as a separate column since printDischarge() reads this name; both are populated identically by saveDischarge().';
