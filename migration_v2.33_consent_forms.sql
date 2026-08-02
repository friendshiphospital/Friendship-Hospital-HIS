-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.33_consent_forms.sql
-- Documentation/Logbook expansion, Phase 2 (Doctor) — Digital Informed
-- Consent. Genuinely new, per the Phase 0 audit: the app previously only
-- had plain "consent obtained" checkboxes (Theatre pre-op, Registration,
-- Pre-op Assessment) with no signature capture and none of them inside
-- the Doctor Consultation module. This adds a real consent record, one
-- row per signed form, linked to the patient (and optionally the current
-- admission), with a canvas-captured signature image (base64 PNG data
-- URL — no external e-signature library, matching this codebase's
-- existing "plain canvas API, no dependencies" convention).
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.consent_forms (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  admission_id uuid references public.admissions(id) on delete set null,
  consent_type text not null check (consent_type in ('Surgical Procedure','Anaesthesia','High-Risk Procedure / Intervention','Blood Transfusion','Other')),
  consent_date date not null default current_date,
  procedure_description text not null,
  risks_explained text,
  signee_name text not null,
  signee_relationship text default 'Self',
  witnessed_by text,
  signature_data_url text not null,
  performed_by uuid references auth.users(id),
  performed_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_consent_forms_patient on public.consent_forms(patient_id, created_at desc);

alter table public.consent_forms enable row level security;

-- Same admin/clinical-staff shape as blood_requests, discharge_summaries,
-- etc. — any clinical role can read and record a signed consent. No
-- update/delete policy: a signed consent is a permanent record, matching
-- blood_issue_log's append-only precedent (corrections are a new row,
-- not an edit to history).
drop policy if exists consent_forms_select on public.consent_forms;
create policy consent_forms_select on public.consent_forms
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists consent_forms_insert on public.consent_forms;
create policy consent_forms_insert on public.consent_forms
  for insert with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.consent_forms from anon;
grant select, insert on public.consent_forms to authenticated;

comment on table public.consent_forms is 'Digital informed consent records — one row per signed form, canvas-captured signature stored as a PNG data URL. Append-only (no update/delete policy).';
comment on column public.consent_forms.signature_data_url is 'canvas.toDataURL(''image/png'') output from the consent tab''s signature pad (index.html initConsentPad()/saveConsentForm()) — rendered directly via <img src=...> in printConsentForm().';
