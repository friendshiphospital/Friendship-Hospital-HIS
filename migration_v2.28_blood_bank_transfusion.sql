-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.28_blood_bank_transfusion.sql
-- Blood Bank / Transfusion Services, Phase 5 — transfusion administration
-- & reaction reporting
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   Nursing already has a full, working vitals-entry form/table
--   (vital_signs, saveVitals()/loadVitalsForPatient() in index.html) — the
--   spec says reuse that pattern rather than building a second vitals
--   form. Same approach already used for the Bed Management overhaul's
--   Medications tab (deep-link into the existing Nursing MAR instead of
--   rebuilding it): this phase adds two nullable columns to vital_signs so
--   a reading taken via the SAME existing form can optionally be tagged as
--   belonging to a specific transfusion + stage, and lets Blood Bank read
--   those tagged rows back — no parallel vitals table.
--
--   Critical Values (critical_values table, checkCriticals()/
--   refreshNotifications()/the Criticals page) already has a working
--   alert pipeline — reaction reports are inserted directly into this
--   EXISTING table so they automatically flow through the same
--   notification bell / banner / acknowledge workflow every critical lab
--   value already uses ("same urgency handling already built for critical
--   lab values", per spec) — no second alerting system. The existing
--   acknowledge functions were found (Phase 4's audit) to only capture a
--   name, not a true read-back of the value — that gap already exists for
--   every other critical value in this app today and is out of scope to
--   fix here; reaction reports simply flow through whatever acknowledge
--   mechanism the Criticals page already has, unchanged.
--
-- WHAT THIS ADDS
--   blood_transfusions — one row per transfusion episode (start/stop
--   time, who started/stopped it, status).
--   vital_signs.transfusion_id / transfusion_stage — nullable, only set
--   when a vitals reading was taken specifically for a transfusion
--   (Before/During/After); every other use of vital_signs is unaffected.
--   blood_units gains discard columns — a unit removed from inventory
--   (expired, damaged, reaction-related, etc.) must always carry a
--   mandatory reason code; there is no silent-delete path anywhere in
--   this schema (matches the rest of this app's audit-trail discipline).
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.27.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.blood_transfusions (
  id                uuid primary key default gen_random_uuid(),
  unit_id           uuid not null references public.blood_units(id) on delete restrict,
  request_id        uuid references public.blood_requests(id) on delete set null,
  patient_id        uuid not null references public.patients(id) on delete restrict,
  started_by        uuid,
  started_by_name   text,
  start_time        timestamptz,
  stopped_by        uuid,
  stopped_by_name   text,
  stop_time         timestamptz,
  status            text not null default 'In Progress' check (status in ('In Progress','Completed','Reaction Reported')),
  created_at        timestamptz not null default now()
);

create index if not exists blood_transfusions_unit_idx on public.blood_transfusions (unit_id);
create index if not exists blood_transfusions_patient_idx on public.blood_transfusions (patient_id);

comment on table public.blood_transfusions is
  'One row per transfusion episode (Blood Bank Phase 5), started/stopped by startTransfusion()/stopTransfusion() (index.html) once a unit is Issued. Vitals before/during/after are recorded through the EXISTING Nursing vitals form (vital_signs, tagged via transfusion_id/transfusion_stage below) — not a separate form.';

alter table public.vital_signs add column if not exists transfusion_id uuid references public.blood_transfusions(id) on delete set null;
alter table public.vital_signs add column if not exists transfusion_stage text check (transfusion_stage in ('Before','During','After'));
comment on column public.vital_signs.transfusion_id is
  'Set only when this vitals reading was taken specifically for a transfusion episode (via the Nursing vitals form''s optional Transfusion Stage field, shown only when arriving via Blood Bank''s "Record Vitals" deep-link) — null for every ordinary vitals reading.';

alter table public.blood_units add column if not exists discard_reason_code text check (discard_reason_code in ('Expired','Reaction-Related','Damaged','Other'));
alter table public.blood_units add column if not exists discarded_by uuid;
alter table public.blood_units add column if not exists discarded_by_name text;
alter table public.blood_units add column if not exists discarded_at timestamptz;
comment on column public.blood_units.discard_reason_code is
  'Set by discardBloodUnit() (index.html) whenever a unit is removed from usable inventory (status -> Discarded) — always required, together with the free-text discard_reason (existing column) for detail. No status update to Discarded is allowed without both.';

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.28_blood_bank_transfusion.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, count(*) from public.blood_transfusions group by status;
--   select discard_reason_code, count(*) from public.blood_units
--     where status = 'Discarded' group by discard_reason_code;
-- ═══════════════════════════════════════════════════════════════════════
