-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.15_radiology_safety_upgrade.sql
-- Extends radiology_requests with critical-finding notification detail,
-- radiation dose tracking, contrast clearance, and pregnancy-status
-- confirmation. No new tables and no RLS changes needed — radiology_requests
-- is already covered by migration_v2.8_rls_security.sql's policies, and
-- this migration only adds columns to it.
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in the Supabase SQL editor, after migration_v2.8_rls_security.sql.
-- Idempotent — safe to re-run.
--
-- WHAT WAS AUDITED FIRST (per the request that triggered this migration):
-- index.html's #page-radiology already had a working Requests/Report/
-- Reported workflow on radiology_requests, including a critical-finding
-- checkbox (is_critical/critical_finding) with a red banner on the PRINTED
-- report — but no structured notification log (who was told, when, how),
-- no red badge in the on-screen queues, no dose/contrast/pregnancy safety
-- fields anywhere, and no report templates. This migration only adds the
-- columns those upgrades need; the existing is_critical/critical_finding
-- columns and report/impression workflow are kept as-is.

alter table public.radiology_requests add column if not exists physician_notified_name text;
alter table public.radiology_requests add column if not exists physician_notified_time timestamptz;
alter table public.radiology_requests add column if not exists notification_channel text;
comment on column public.radiology_requests.notification_channel is
  'How the requesting physician was told about a critical finding — e.g. Phone Call, In-Person, SMS, Email, Other. Required alongside physician_notified_name/_time whenever is_critical is set (enforced client-side in saveRadReport()).';

alter table public.radiology_requests add column if not exists recorded_dose numeric;
alter table public.radiology_requests add column if not exists dose_unit text default 'mGy';
comment on column public.radiology_requests.recorded_dose is
  'Radiation dose actually delivered for this study (mGy for plain film/CT dose index, or DAP in µGy·m² for fluoroscopy-style studies — see dose_unit). Recorded at report time since it is only known after acquisition. NULL for non-ionizing modalities (Ultrasound, MRI, ECG).';

alter table public.radiology_requests add column if not exists egfr_value numeric;
alter table public.radiology_requests add column if not exists creatinine_value numeric;
comment on column public.radiology_requests.egfr_value is
  'Recorded at request time for contrast-enhanced CT/MRI studies — a low eGFR (<30) is the standard contraindication threshold for iodinated/gadolinium contrast. Client shows a non-blocking warning, not a hard stop, since the ordering clinician may still proceed with precautions.';

alter table public.radiology_requests add column if not exists pregnancy_status text
  check (pregnancy_status in ('not_applicable','confirmed_not_pregnant','confirmed_pregnant','declined_unknown'));
comment on column public.radiology_requests.pregnancy_status is
  'Mandatory confirmation for female patients of childbearing age (12-55y) before an X-Ray or CT request can be submitted — see the isFemaleChildbearing() check in submitRadRequest(). not_applicable covers male patients / non-childbearing age / non-ionizing modalities where the checkbox is never shown.';

alter table public.radiology_requests add column if not exists pacs_url text;
comment on column public.radiology_requests.pacs_url is
  'Optional link to an external PACS/DICOM viewer for this study. If set, "View DICOM" opens this URL directly; if empty, it opens the built-in simulated viewer (see viewDicomSimulated() in index.html) — there is no real DICOM storage/PACS server in this architecture, only a placeholder pan/zoom/window-level demo.';

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.15_radiology_safety_upgrade.sql
-- ═══════════════════════════════════════════════════════════════════════
