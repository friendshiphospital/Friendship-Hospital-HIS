-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.26_blood_bank_requests.sql
-- Blood Bank / Transfusion Services, Phase 3 — blood request workflow
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   radiology_requests is the closest existing shape to copy: one
--   dedicated table per request, PLUS a mirror row in doctor_orders
--   (order_type:'Radiology') so the request also shows up in the
--   patient's unified "Active Orders" list. blood_requests below follows
--   that exact convention — a dedicated table for Blood Bank's own
--   fields (component/units/urgency/indication), with _submitBloodRequest()
--   (index.html, added to Doctor Consultation's Orders tab alongside Lab/
--   Radiology) also inserting a mirrored doctor_orders row.
--
-- WHAT THIS ADDS
--   blood_requests — one row per request. status is independent from
--   blood_units.status (Phase 1) because a single request can need
--   several units and isn't "done" until every unit against it is
--   Issued — Requested -> Crossmatched (at least one unit reserved) ->
--   Issued (Phase 4) -> or Cancelled.
--
--   blood_units.request_id — added by this migration, links a
--   Crossmatched unit back to the specific request it was reserved
--   against (crossmatchUnit() in index.html sets this the moment it
--   moves a unit from Available to Crossmatched) — needed again in
--   Phase 4's issue workflow to know which request a unit fulfils.
--
-- Crossmatch itself (ABO/Rh compatibility, and the "patient has no
-- on-file blood group -> block, require typing first" rule) is
-- client-side logic against results_hematology.blood_group/rh_factor
-- (already existing, per Phase 0's audit) — nothing new to store for
-- that; this migration only adds where a MATCHED unit gets recorded.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.25.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.blood_requests (
  id                  uuid primary key default gen_random_uuid(),
  request_no          text not null unique,
  patient_id          uuid not null references public.patients(id) on delete cascade,
  component_type      text not null check (component_type in ('Whole Blood','Packed RBC','FFP','Platelets','Cryoprecipitate')),
  units_requested      integer not null default 1 check (units_requested > 0),
  urgency              text not null default 'Routine' check (urgency in ('Routine','Urgent','STAT')),
  clinical_indication  text,
  requesting_doctor    text,
  status               text not null default 'Requested' check (status in ('Requested','Crossmatched','Issued','Cancelled')),
  created_by           uuid,
  created_by_name      text,
  created_at           timestamptz not null default now()
);

create index if not exists blood_requests_patient_idx on public.blood_requests (patient_id);
create index if not exists blood_requests_status_idx on public.blood_requests (status);

comment on table public.blood_requests is
  'One row per blood request (Blood Bank Phase 3), same shape/convention as radiology_requests. _submitBloodRequest() (index.html, Doctor Consultation Orders tab) also inserts a mirrored doctor_orders row (order_type:''Blood Bank'') so the request shows up in the patient''s unified Active Orders list, same as every Lab/Radiology order already does.';

alter table public.blood_units add column if not exists request_id uuid references public.blood_requests(id) on delete set null;
comment on column public.blood_units.request_id is
  'Set by crossmatchUnit() (index.html) the moment a unit moves from Available to Crossmatched against a specific blood_requests row — null again if a crossmatch is ever reversed.';

alter table public.blood_requests enable row level security;

drop policy if exists blood_requests_select on public.blood_requests;
create policy blood_requests_select on public.blood_requests
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists blood_requests_insert on public.blood_requests;
create policy blood_requests_insert on public.blood_requests
  for insert with check (public.is_admin() or public.is_clinical_staff());

drop policy if exists blood_requests_update on public.blood_requests;
create policy blood_requests_update on public.blood_requests
  for update using (public.is_admin() or public.is_lab_staff())
  with check (public.is_admin() or public.is_lab_staff());

revoke all on public.blood_requests from anon;
grant select, insert, update on public.blood_requests to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.26_blood_bank_requests.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, count(*) from public.blood_requests group by status;
-- ═══════════════════════════════════════════════════════════════════════
