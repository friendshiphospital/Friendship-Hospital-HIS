-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.50_doctor_specialty_routing.sql
-- Doctor specialty-based patient routing + per-doctor consultation fees
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   The 'doctors' table (a reference directory used only for the
--   registration "Referring Doctor" dropdown / populateDoctorDropdown() in
--   index.html) already had a good specialty list, but was completely
--   separate from and unlinked to the 'staff' table's actual role='doctor'
--   LOGIN accounts, which had no specialty field at all. loadDoctorQueue()
--   showed every doctor-destined patient to every logged-in doctor
--   regardless of specialty, and buildAutoInvoiceLines() always charged one
--   single flat 'Consultation Fee' price-list item regardless of which
--   doctor was selected.
--
-- SECTION 1 — staff.specialty
--   Nullable, meaningful only for role='doctor' accounts (any other role
--   just leaves it null — no constraint ties it to role, matching how
--   staff.department already has no role constraint either). Same free-text
--   option set as doctors.specialty (kept in sync client-side via one
--   shared SPECIALTY_OPTIONS JS constant in index.html, not duplicated
--   here as a CHECK — the doctors.specialty column itself has never had a
--   CHECK constraint, so staff.specialty matches that existing precedent
--   rather than introducing a new, differently-enforced rule).
--
-- SECTION 2 — doctors.doctor_type / doctors.consultation_fee
--   doctor_type is enum-like text (GP / Specialist / Consultant), default
--   'GP' — same "add column if not exists ... check (...)" idempotent
--   pattern migration_v2.19 already used for patients.visit_status.
--   consultation_fee is nullable numeric: null means "use the Settings
--   default fee for this doctor_type" (CFG.feeGP/feeSpecialist/
--   feeConsultant in index.html), a non-null value overrides it per doctor.
--
-- SECTION 3 — patients.doctor_id
--   Nullable FK to doctors.id, additive alongside the existing free-text
--   `doctor` column (kept as-is, unchanged, for backward compatibility /
--   display — every existing reader of patients.doctor keeps working
--   exactly as before). doctor_id is the new, reliable reference used by
--   buildAutoInvoiceLines() to look up a specific doctor's own
--   consultation_fee, and by loadDoctorQueue() to filter by the logged-in
--   doctor's specialty. on delete set null (not cascade/restrict) — a
--   doctor row being removed from the directory must never take patient
--   history down with it; the free-text `doctor` column still preserves
--   the name on the patient record regardless.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — staff.specialty
-- ───────────────────────────────────────────────────────────────────────

alter table public.staff add column if not exists specialty text;

comment on column public.staff.specialty is
  'Meaningful only for role=doctor accounts — set via the Staff Management form (index.html) when adding/editing a doctor-role staff member, using the same option list as doctors.specialty (SPECIALTY_OPTIONS in index.html). Drives loadDoctorQueue()''s specialty-based patient filtering: a logged-in doctor whose staff row has a specialty set only sees doctor-destined patients whose patients.doctor_id resolves to a doctors row with a matching specialty; null (unset) shows every doctor-destined patient unfiltered, same as before this column existed.';


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — doctors.doctor_type / doctors.consultation_fee
-- ───────────────────────────────────────────────────────────────────────

alter table public.doctors add column if not exists doctor_type text default 'GP'
  check (doctor_type in ('GP','Specialist','Consultant'));

alter table public.doctors add column if not exists consultation_fee numeric;

comment on column public.doctors.doctor_type is
  'GP / Specialist / Consultant — set via the Doctor Management form (index.html). Used as the fallback key into CFG.feeGP/feeSpecialist/feeConsultant (Settings) whenever this doctor''s own consultation_fee below is null.';

comment on column public.doctors.consultation_fee is
  'This doctor''s own consultation fee, overriding the doctor_type default. Null means "use the Settings default fee for this doctor_type" — see buildAutoInvoiceLines() in index.html, which resolves the real charge for the registration invoice''s Consultation Fee line whenever a specific doctor was selected (patients.doctor_id), falling back to the existing flat price_list "Consultation Fee" item exactly as before only when no doctor was selected at all.';


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — patients.doctor_id
-- ───────────────────────────────────────────────────────────────────────

alter table public.patients add column if not exists doctor_id uuid references public.doctors(id) on delete set null;

create index if not exists patients_doctor_id_idx on public.patients (doctor_id);

comment on column public.patients.doctor_id is
  'Additive reference alongside the existing free-text `doctor` column (unchanged, still the display/backward-compatible field) — set at Registration (submitRegistration() in index.html) from the selected "Referring Doctor" dropdown option''s doctors.id. Used by buildAutoInvoiceLines() to charge that specific doctor''s real consultation fee, and by loadDoctorQueue() to filter the doctor queue by the logged-in doctor''s specialty. Null for patients registered without selecting a specific doctor, or registered before this column existed — both cases fall back to today''s unfiltered/flat-fee behavior exactly as before.';

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.50_doctor_specialty_routing.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--     where table_name in ('staff','doctors','patients')
--       and column_name in ('specialty','doctor_type','consultation_fee','doctor_id')
--     order by table_name, column_name;
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.doctors'::regclass and contype = 'c';
-- ═══════════════════════════════════════════════════════════════════════
