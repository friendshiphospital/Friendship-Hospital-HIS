-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.30_handover_notes_fields.sql
-- Bug fix (found during Documentation/Logbook Phase 0 audit): saveHandover()
-- in index.html has always collected "Critical / High-Dependency Patients"
-- (#ho-critical), "Pending Tasks / Outstanding Orders" (#ho-pending), and
-- "Patient Count" (#ho-count) from the Nursing Handover form, but never
-- actually sent any of the three to the database — only the free-text
-- General Notes field (#ho-notes) was ever persisted. The register/list
-- views (loadHandoverNotes(), loadRecentHandovers()) already read
-- h.patient_count defensively (`!= null` guarded), suggesting the column
-- may already exist from an earlier, incomplete pass — this migration adds
-- all three defensively with IF NOT EXISTS so it's safe either way.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual review
-- and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.ward_handover_notes
  add column if not exists patient_count integer,
  add column if not exists critical_patients text,
  add column if not exists pending_tasks text;

comment on column public.ward_handover_notes.patient_count is 'Total patients in ward at handover — entered on the Nursing Handover form (#ho-count).';
comment on column public.ward_handover_notes.critical_patients is 'Critical / high-dependency patients and key concerns — entered on the Nursing Handover form (#ho-critical).';
comment on column public.ward_handover_notes.pending_tasks is 'Pending bloods, procedures, and awaited results — entered on the Nursing Handover form (#ho-pending).';
