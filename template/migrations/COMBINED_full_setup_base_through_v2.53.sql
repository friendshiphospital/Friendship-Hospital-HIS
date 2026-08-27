-- =============================================================================
-- Friendship Hospital HIS -- COMBINED FULL SETUP (base schema through v2.53)
-- =============================================================================
--
-- Paste this ENTIRE file into a genuinely empty Supabase project's SQL
-- Editor and run it once, top to bottom. It concatenates, in the exact
-- order documented in SETUP.md:
--   1. FriendshipHospital_HIS_v1_Schema.sql (base schema: 67 tables,
--      constraints, indexes, RLS policies, functions, triggers)
--   2. Every incremental migration v2.8 through v2.53, in numeric version
--      order (NOT filename string order -- v2.9 sorts before v2.10 the
--      wrong way alphabetically, so this file has already done that
--      ordering for you)
--
-- This is the CURRENT, POST-FIX content of every file it contains -- not
-- the originals. Two fixes discovered during dry-run testing on a genuinely
-- fresh project are already folded in here:
--   - 14 tables' `id bigint` columns (audit_logs, bed_transfers,
--     billing_audit_logs, delta_check_log, follow_ups,
--     instrument_messages, inventory_batches, lab_result_history,
--     purchase_order_items, purchase_orders, results_chemistry_history,
--     results_hematology_history, sms_log, stock_requisitions) now have
--     their DEFAULT nextval(...) wired to the sequence the schema already
--     creates for them -- previously missing, which caused
--     "null value in column id ... violates not null constraint" the
--     first time any of those tables was written to (e.g. the very first
--     lab result verify, which writes an audit_logs row).
--   - The `ensure_rls` event trigger is now preceded by
--     `DROP EVENT TRIGGER IF EXISTS ensure_rls;`, so this file no longer
--     fails with "event trigger ensure_rls already exists" if some
--     Supabase Dashboard option created one before this ran.
--   - `migration_v2.53_beds_realtime_publication.sql` (the beds table was
--     never added to the supabase_realtime publication despite the app's
--     live bed-grid depending on it) is included in its correct place at
--     the end.
--
-- v2.45 NOTE: there are two files both versioned v2.45
-- (migration_v2.45_lab_reference_ranges.sql and
-- migration_v2.45_followup_reminders.sql) -- they're independent, order
-- between the two of them doesn't matter, and both are included below
-- after v2.44 and before v2.46, per SETUP.md.
--
-- v2.46 NOTE -- READ BEFORE RUNNING: migration_v2.46_backup_verify_cron.sql
-- normally needs two placeholders hand-edited before it can run
-- (<YOUR-PROJECT-REF>, <YOUR-CRON-SECRET>). Since this combined file is
-- meant to run in one uninterrupted pass, the one statement that needs
-- those values (the `select cron.schedule(...)` call) is commented out
-- below, clearly marked "COMMENTED OUT", so the rest of this file runs
-- cleanly without you having to stop and edit anything mid-run. This is
-- deliberate, not a bug: leaving the placeholders active and uncommented
-- would not error the file out (they're just string literals), it would
-- silently schedule a cron job that calls a non-existent URL with a fake
-- secret forever -- worse than an error, because nothing would tell you
-- it's broken. AFTER finishing this whole file and deploying the
-- `backup-verify` Edge Function with its real secrets (see SETUP.md step
-- 4), come back to the marked block near the end of this file, uncomment
-- it, replace both placeholders with your real values, and run just that
-- block on its own.
--
-- Idempotent extension/table/column creation throughout means re-running
-- this whole file on a project it's already been run on is safe, EXCEPT
-- for the deliberately-commented-out cron.schedule block above, which was
-- never meant to run as part of this pass at all.
-- =============================================================================



-- #############################################################################
-- ## FriendshipHospital_HIS_v1_Schema.sql
-- #############################################################################

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SEQUENCE IF NOT EXISTS public.audit_logs_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.bed_transfers_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.billing_audit_logs_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.delta_check_log_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.follow_ups_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.instrument_messages_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.inventory_batches_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.ip_seq START WITH 101 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.lab_result_history_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.lab_seq START WITH 301 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.mrn_seq START WITH 501 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.opd_seq START WITH 201 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.purchase_order_items_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.purchase_orders_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.rad_seq START WITH 401 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.results_chemistry_history_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.results_hematology_history_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.sms_log_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.stock_requisitions_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE TABLE public.admissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_no text,
  admission_date timestamp with time zone DEFAULT now(),
  discharge_date timestamp with time zone,
  ward text,
  room text,
  bed text,
  admitting_doctor text,
  primary_diagnosis text,
  admission_type text DEFAULT 'Elective'::text,
  status text DEFAULT 'Active'::text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  ip_no text,
  discharge_planning_started_at timestamp with time zone
);

CREATE TABLE public.app_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  module text NOT NULL,
  action text NOT NULL,
  record_id text,
  performed_by uuid,
  performed_by_name text,
  details text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid,
  patient_name text,
  appointment_date date,
  appointment_time time without time zone,
  appt_type text DEFAULT 'Lab Only'::text,
  doctor text,
  department text,
  status text DEFAULT 'Booked'::text,
  notes text,
  theatre_booking_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.audit_logs (
  id bigint NOT NULL DEFAULT nextval('public.audit_logs_id_seq'::regclass),
  table_name text NOT NULL,
  record_id text,
  patient_id text,
  action text NOT NULL,
  changed_by uuid,
  changed_by_role text,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.bed_transfers (
  id bigint NOT NULL DEFAULT nextval('public.bed_transfers_id_seq'::regclass),
  admission_id uuid NOT NULL,
  patient_id uuid,
  from_ward text,
  from_room text,
  from_bed text,
  to_ward text NOT NULL,
  to_room text NOT NULL,
  to_bed text NOT NULL,
  reason text NOT NULL,
  transferred_by uuid,
  transferred_by_name text,
  transferred_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.beds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ward text NOT NULL,
  room text NOT NULL,
  bed_number text NOT NULL,
  status text DEFAULT 'Available'::text,
  current_patient_id uuid,
  current_admission_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  status_changed_at timestamp with time zone
);

CREATE TABLE public.billing_audit_logs (
  id bigint NOT NULL DEFAULT nextval('public.billing_audit_logs_id_seq'::regclass),
  event_type text NOT NULL,
  invoice_id uuid,
  shift_id uuid,
  amount numeric(14,2),
  reason text,
  authorized_by uuid,
  authorized_by_name text,
  performed_by uuid,
  performed_by_name text,
  details jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_donations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  donor_id uuid NOT NULL,
  collection_date date NOT NULL DEFAULT CURRENT_DATE,
  recent_illness boolean NOT NULL DEFAULT false,
  on_medication boolean NOT NULL DEFAULT false,
  recent_travel boolean NOT NULL DEFAULT false,
  prior_deferral boolean NOT NULL DEFAULT false,
  deferral_notes text,
  hiv_result text NOT NULL DEFAULT 'Pending'::text,
  hbv_result text NOT NULL DEFAULT 'Pending'::text,
  hcv_result text NOT NULL DEFAULT 'Pending'::text,
  syphilis_result text NOT NULL DEFAULT 'Pending'::text,
  malaria_result text NOT NULL DEFAULT 'Pending'::text,
  cleared boolean NOT NULL DEFAULT false,
  screened_by text,
  screened_at timestamp with time zone,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_donors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  donor_no text NOT NULL,
  full_name text NOT NULL,
  age integer,
  sex text,
  phone text,
  blood_group text,
  rh_factor text,
  address text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_issue_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL,
  request_id uuid,
  patient_id uuid NOT NULL,
  reserved_by uuid,
  reserved_by_name text,
  reserved_at timestamp with time zone,
  issued_by uuid NOT NULL,
  issued_by_name text NOT NULL,
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  received_by uuid NOT NULL,
  received_by_name text NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_no text NOT NULL,
  patient_id uuid NOT NULL,
  component_type text NOT NULL,
  units_requested integer NOT NULL DEFAULT 1,
  urgency text NOT NULL DEFAULT 'Routine'::text,
  clinical_indication text,
  requesting_doctor text,
  status text NOT NULL DEFAULT 'Requested'::text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_transfusions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL,
  request_id uuid,
  patient_id uuid NOT NULL,
  started_by uuid,
  started_by_name text,
  start_time timestamp with time zone,
  stopped_by uuid,
  stopped_by_name text,
  stop_time timestamp with time zone,
  status text NOT NULL DEFAULT 'In Progress'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_units (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  unit_no text NOT NULL,
  blood_group text NOT NULL,
  rh_factor text NOT NULL,
  component_type text NOT NULL,
  collection_date date,
  expiry_date date NOT NULL,
  volume_ml numeric,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'Quarantined'::text,
  discard_reason text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  donation_id uuid,
  external_source_org text,
  external_unit_ref text,
  external_screening_attested text,
  received_by text,
  receipt_date date,
  verified_on_receipt boolean NOT NULL DEFAULT false,
  verified_by text,
  verified_at timestamp with time zone,
  request_id uuid,
  crossmatched_by uuid,
  crossmatched_by_name text,
  crossmatched_at timestamp with time zone,
  issued_by uuid,
  issued_by_name text,
  issued_at timestamp with time zone,
  received_by_name text,
  received_at timestamp with time zone,
  discard_reason_code text,
  discarded_by uuid,
  discarded_by_name text,
  discarded_at timestamp with time zone
);

CREATE TABLE public.consent_forms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_id uuid,
  consent_type text NOT NULL,
  consent_date date NOT NULL DEFAULT CURRENT_DATE,
  procedure_description text NOT NULL,
  risks_explained text,
  signee_name text NOT NULL,
  signee_relationship text DEFAULT 'Self'::text,
  witnessed_by text,
  signature_data_url text NOT NULL,
  performed_by uuid,
  performed_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.critical_values (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  lab_no text,
  test_name text NOT NULL,
  result_value text NOT NULL,
  critical_range text,
  section text,
  notified_at timestamp with time zone DEFAULT now(),
  notified_by text,
  notified_to text,
  acknowledged boolean DEFAULT false,
  acknowledged_at timestamp with time zone,
  acknowledged_by text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  is_acknowledged boolean DEFAULT false,
  clinician_notified text,
  department text,
  parameter text,
  value text,
  unit text,
  reference text,
  created_by uuid,
  mrn text,
  read_back_confirmed boolean NOT NULL DEFAULT false
);

CREATE TABLE public.delta_check_log (
  id bigint NOT NULL DEFAULT nextval('public.delta_check_log_id_seq'::regclass),
  patient_id uuid NOT NULL,
  result_table text NOT NULL,
  department text NOT NULL,
  field text NOT NULL,
  field_label text NOT NULL,
  previous_value numeric,
  previous_date timestamp with time zone,
  current_value numeric NOT NULL,
  delta_type text NOT NULL,
  delta_value numeric NOT NULL,
  threshold numeric NOT NULL,
  direction text NOT NULL,
  auto_verify_blocked boolean NOT NULL DEFAULT true,
  reason_code text,
  reason_note text,
  resolved_by uuid,
  resolved_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.discharge_summaries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_id uuid NOT NULL,
  discharge_date date DEFAULT CURRENT_DATE,
  discharge_type text,
  final_diagnosis text,
  secondary_diagnoses jsonb DEFAULT '[]'::jsonb,
  procedures_done text,
  discharge_condition text,
  follow_up_date date,
  follow_up_with text,
  discharge_instructions text,
  los_days integer,
  prepared_by text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  reason_for_admission text,
  clinical_findings text,
  investigations_summary text,
  treatment_given text,
  discharge_medications text,
  followup_instructions text,
  doctor_name text,
  condition_at_discharge text,
  primary_diagnosis text
);

CREATE TABLE public.doctor_consultations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid,
  consultation_date date DEFAULT CURRENT_DATE,
  chief_complaint text,
  duration text,
  hpi text,
  pmh text,
  fsh text,
  current_medications text,
  gen_appearance text,
  cvs_exam text,
  resp_exam text,
  abdominal_exam text,
  cns_exam text,
  other_exam text,
  primary_diagnosis text,
  icd10 text,
  differential_dx text,
  management_plan text,
  disposition text,
  followup text,
  consulting_doctor text,
  prescriptions jsonb DEFAULT '[]'::jsonb,
  prescription_notes text,
  sick_leave_days integer,
  sl_from date,
  sl_to date,
  sl_diagnosis text,
  sl_fitness text,
  referral_to text,
  referral_facility text,
  referral_urgency text,
  referral_reason text,
  performed_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  is_signed_off boolean DEFAULT false,
  signed_off_by uuid,
  signed_off_by_name text,
  signed_off_at timestamp with time zone
);

CREATE TABLE public.doctor_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_id uuid,
  order_type text NOT NULL,
  order_detail text NOT NULL,
  priority text DEFAULT 'Routine'::text,
  ordered_by text,
  ordered_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'Pending'::text,
  fulfilled_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  payment_deferred boolean DEFAULT false,
  payment_deferred_by uuid,
  payment_deferred_by_name text,
  payment_deferred_at timestamp with time zone
);

CREATE TABLE public.doctors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  specialty text,
  phone text,
  email text,
  license_no text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  doctor_type text DEFAULT 'GP'::text,
  consultation_fee numeric
);

CREATE TABLE public.follow_ups (
  id bigint NOT NULL DEFAULT nextval('public.follow_ups_id_seq'::regclass),
  patient_mrn text NOT NULL,
  origin_patient_id uuid,
  scheduled_by uuid,
  scheduled_by_name text,
  target_date date NOT NULL,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  used boolean NOT NULL DEFAULT false,
  used_at timestamp with time zone,
  used_patient_id uuid,
  reminder_sent_at timestamp with time zone
);

CREATE TABLE public.id_counters (
  counter_name text NOT NULL,
  current_value bigint NOT NULL DEFAULT 0
);

CREATE TABLE public.infection_flags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_id uuid,
  flag_type text,
  organism text,
  precautions text,
  flagged_by text,
  flagged_at timestamp with time zone DEFAULT now(),
  resolved_at timestamp with time zone,
  active boolean DEFAULT true,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.instrument_messages (
  id bigint NOT NULL DEFAULT nextval('public.instrument_messages_id_seq'::regclass),
  machine_id text NOT NULL,
  protocol text NOT NULL,
  raw_message text NOT NULL,
  sample_barcode text,
  patient_id uuid,
  test_parameter text,
  raw_value text,
  parsed_value numeric,
  sync_status text NOT NULL DEFAULT 'pending_mapping'::text,
  error_detail text,
  mapped_table text,
  mapped_field text,
  imported_by uuid,
  imported_by_name text,
  imported_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_batches (
  id bigint NOT NULL DEFAULT nextval('public.inventory_batches_id_seq'::regclass),
  item_id uuid NOT NULL,
  batch_no text,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  expiry_date date,
  is_opened boolean NOT NULL DEFAULT false,
  opened_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  discard_reason_code text,
  discard_notes text,
  discarded_by uuid,
  discarded_by_name text,
  discarded_at timestamp with time zone
);

CREATE TABLE public.invoice_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  name text NOT NULL,
  category text,
  quantity numeric DEFAULT 1,
  unit_price numeric DEFAULT 0,
  total_price numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid,
  admission_id uuid,
  lab_no text,
  patient_name text,
  invoice_no text,
  invoice_type text DEFAULT 'lab'::text,
  line_items jsonb DEFAULT '[]'::jsonb,
  total_amount numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  net_amount numeric DEFAULT 0,
  payment_status text DEFAULT 'unpaid'::text,
  payment_method text,
  currency text DEFAULT 'SDG'::text,
  insurance_company text,
  insurance_no text,
  pre_auth_no text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  invoice_date date DEFAULT CURRENT_DATE,
  shift_id uuid,
  queue_token text,
  reprint_count integer NOT NULL DEFAULT 0,
  voided boolean NOT NULL DEFAULT false,
  voided_reason text,
  voided_at timestamp with time zone,
  insurance_covered numeric(14,2) DEFAULT 0,
  patient_payable numeric(14,2),
  copay_percent numeric(5,2),
  copay_fixed numeric(14,2),
  wallet_amount numeric(14,2) DEFAULT 0
);

CREATE TABLE public.lab_reference_ranges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  dept_key text NOT NULL,
  field_code text NOT NULL,
  label text NOT NULL,
  si_unit text NOT NULL,
  si_lo numeric,
  si_hi numeric,
  conventional_unit text,
  conventional_lo numeric,
  conventional_hi numeric,
  conversion_factor numeric,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.lab_result_history (
  id bigint NOT NULL DEFAULT nextval('public.lab_result_history_id_seq'::regclass),
  patient_id uuid NOT NULL,
  mrn text,
  department text NOT NULL,
  source_table text,
  test_code text,
  test_name text NOT NULL,
  value text,
  value_numeric numeric,
  unit text,
  ref_range_lo numeric,
  ref_range_hi numeric,
  ref_range_text text,
  flag text,
  is_verified boolean NOT NULL DEFAULT false,
  verified_by uuid,
  verified_at timestamp with time zone,
  sample_id text,
  created_by uuid,
  saved_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.lab_shifts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shift_name text NOT NULL,
  shift_date date DEFAULT CURRENT_DATE,
  start_time time without time zone,
  end_time time without time zone,
  staff_on_duty text,
  supervisor text,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.patient_wallets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'SDG'::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.patients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mrn text,
  lab_no text,
  first_name text NOT NULL,
  middle_name text,
  last_name text,
  name text,
  age text,
  age_unit text DEFAULT 'Years'::text,
  sex text,
  dob date,
  phone text,
  national_id text,
  address text,
  nationality text,
  patient_type text DEFAULT 'Outpatient'::text,
  next_of_kin_name text,
  next_of_kin_phone text,
  ward text,
  source text,
  doctor text,
  diagnosis text,
  primary_specimen text,
  tests_requested jsonb DEFAULT '[]'::jsonb,
  priority text DEFAULT 'Routine'::text,
  insurance_company text,
  insurance_no text,
  referring_facility text,
  notes text,
  clinic_status text DEFAULT 'waiting'::text,
  triage_level text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  visit_destination text DEFAULT 'lab'::text,
  payment_status text DEFAULT 'unpaid'::text,
  visit_no text,
  master_id uuid,
  visit_status text DEFAULT 'Registered'::text,
  doctor_id uuid
);

CREATE TABLE public.patients_master (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mrn text NOT NULL,
  first_name text,
  middle_name text,
  last_name text,
  name text,
  dob date,
  age text,
  age_unit text,
  sex text,
  phone text,
  national_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  method text NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'SDG'::text,
  shift_id uuid,
  received_by uuid,
  received_by_name text,
  reference_no text,
  voided boolean NOT NULL DEFAULT false,
  voided_by uuid,
  voided_reason text,
  voided_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.pre_op_assessments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_id uuid,
  theatre_booking_id uuid,
  allergies text,
  current_medications text,
  pmh text,
  previous_surgeries text,
  airway_assessment text,
  anaesthesia_plan text,
  fasting_instructions text,
  consent_confirmed boolean DEFAULT false,
  required_labs jsonb DEFAULT '{}'::jsonb,
  notes text,
  cleared_for_ot boolean DEFAULT false,
  cleared_by text,
  cleared_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.prescriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_id uuid,
  items jsonb DEFAULT '[]'::jsonb,
  notes text,
  prescribed_by text,
  prescribed_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'Pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.price_list (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  code text,
  price numeric DEFAULT 0,
  currency text DEFAULT 'SDG'::text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  notes text
);

CREATE TABLE public.purchase_order_items (
  id bigint NOT NULL DEFAULT nextval('public.purchase_order_items_id_seq'::regclass),
  po_id bigint NOT NULL,
  item_id uuid,
  item_name_snapshot text NOT NULL,
  qty_ordered numeric NOT NULL,
  unit_cost_estimate numeric
);

CREATE TABLE public.purchase_orders (
  id bigint NOT NULL DEFAULT nextval('public.purchase_orders_id_seq'::regclass),
  po_no text NOT NULL,
  supplier text,
  status text NOT NULL DEFAULT 'draft'::text,
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.qc_lots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_no text NOT NULL,
  control_name text NOT NULL,
  section text,
  level text,
  expiry_date date,
  target_mean numeric,
  target_sd numeric,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  analyte text
);

CREATE TABLE public.qc_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id uuid,
  result_date date DEFAULT CURRENT_DATE,
  result_value numeric NOT NULL,
  z_score numeric,
  rule_violation text,
  accepted boolean DEFAULT true,
  comment text,
  performed_by uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.queue_token_counters (
  token_date date NOT NULL,
  prefix text NOT NULL,
  last_number integer NOT NULL DEFAULT 0
);

CREATE TABLE public.radiology_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_id uuid,
  imaging_type text NOT NULL,
  urgency text DEFAULT 'Routine'::text,
  indication text,
  requesting_doctor text,
  radiologist text,
  report text,
  impression text,
  status text DEFAULT 'Requested'::text,
  performed_at timestamp with time zone,
  reported_at timestamp with time zone,
  is_verified boolean DEFAULT false,
  has_critical boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  technique text,
  recommendation text,
  is_critical boolean DEFAULT false,
  critical_finding text,
  updated_at timestamp with time zone DEFAULT now(),
  clinical_history text,
  radiology_no text,
  physician_notified_name text,
  physician_notified_time timestamp with time zone,
  notification_channel text,
  recorded_dose numeric,
  dose_unit text DEFAULT 'mGy'::text,
  egfr_value numeric,
  creatinine_value numeric,
  pregnancy_status text,
  pacs_url text,
  payment_deferred boolean DEFAULT false,
  payment_deferred_by uuid,
  payment_deferred_by_name text,
  payment_deferred_at timestamp with time zone,
  verified_by uuid,
  verified_by_name text,
  verified_at timestamp with time zone
);

CREATE TABLE public.reagent_inventory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  category text,
  lot_no text,
  expiry_date date,
  current_stock numeric DEFAULT 0,
  unit text DEFAULT 'Units'::text,
  min_level numeric DEFAULT 5,
  cost_per_unit numeric DEFAULT 0,
  supplier text,
  analyzer text,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  department text,
  barcode text,
  onboard_stability_days integer
);

CREATE TABLE public.reception_shifts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shift_no text NOT NULL,
  staff_id uuid,
  staff_name text NOT NULL,
  station_id text NOT NULL DEFAULT 'Reception-1'::text,
  shift_type text NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  currency text NOT NULL DEFAULT 'SDG'::text,
  opening_float numeric(14,2) NOT NULL DEFAULT 0,
  opened_at timestamp with time zone NOT NULL DEFAULT now(),
  opened_by uuid,
  closed_at timestamp with time zone,
  closed_by uuid,
  total_patients integer,
  gross_revenue numeric(14,2),
  total_cash numeric(14,2),
  total_card numeric(14,2),
  total_insurance numeric(14,2),
  total_wallet numeric(14,2),
  total_online numeric(14,2),
  total_refunds numeric(14,2),
  cash_expected numeric(14,2),
  cash_actual numeric(14,2),
  cash_variance numeric(14,2),
  variance_reason text,
  closing_notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.results_chemistry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  tbil numeric,
  dbil numeric,
  ibil numeric,
  alt numeric,
  ast numeric,
  alp numeric,
  ggt numeric,
  tp numeric,
  alb numeric,
  glob numeric,
  ag numeric,
  creat numeric,
  urea numeric,
  ua numeric,
  egfr numeric,
  tchol numeric,
  ldl numeric,
  hdl numeric,
  trig numeric,
  fbs numeric,
  rbs numeric,
  hba1c numeric,
  na numeric,
  k numeric,
  cl numeric,
  co2 numeric,
  ca numeric,
  phos numeric,
  mg numeric,
  troponin_i numeric,
  hs_tnt numeric,
  ck numeric,
  ckmb numeric,
  nt_probnp numeric,
  bnp numeric,
  hs_crp numeric,
  ldh numeric,
  lipase numeric,
  amylase numeric,
  fe numeric,
  tibc numeric,
  tsat numeric,
  ins numeric,
  cpep numeric,
  homa numeric,
  ppbs numeric,
  ogtt numeric,
  analyzer text,
  analysis_date date,
  performed_by uuid,
  has_critical boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  specimen text,
  verified_fields text[] DEFAULT '{}'::text[],
  is_released boolean NOT NULL DEFAULT false,
  released_at timestamp with time zone,
  released_by uuid
);

CREATE TABLE public.results_chemistry_history (
  id bigint NOT NULL DEFAULT nextval('public.results_chemistry_history_id_seq'::regclass),
  patient_id uuid NOT NULL,
  analyzer text,
  analysis_date date,
  notes text,
  specimen text,
  performed_by uuid,
  has_critical boolean,
  tbil numeric,
  dbil numeric,
  ibil numeric,
  alt numeric,
  ast numeric,
  alp numeric,
  ggt numeric,
  tp numeric,
  alb numeric,
  creat numeric,
  urea numeric,
  ua numeric,
  egfr numeric,
  na numeric,
  k numeric,
  cl numeric,
  co2 numeric,
  ca numeric,
  phos numeric,
  mg numeric,
  fbs numeric,
  rbs numeric,
  ppbs numeric,
  hba1c numeric,
  ins numeric,
  cpep numeric,
  tchol numeric,
  ldl numeric,
  hdl numeric,
  trig numeric,
  troponin_i numeric,
  hs_tnt numeric,
  ck numeric,
  ckmb numeric,
  nt_probnp numeric,
  hs_crp numeric,
  ldh numeric,
  is_verified boolean,
  verified_at timestamp with time zone,
  recorded_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.results_cytology (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  specimen_type text,
  adequacy text,
  findings text,
  diagnosis text,
  recommendation text,
  tests jsonb DEFAULT '{}'::jsonb,
  analyzer text,
  analysis_date date,
  performed_by uuid,
  has_critical boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  verified_fields text[] DEFAULT '{}'::text[],
  is_released boolean NOT NULL DEFAULT false,
  released_at timestamp with time zone,
  released_by uuid
);

CREATE TABLE public.results_hematology (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  wbc numeric,
  rbc numeric,
  hgb numeric,
  hct numeric,
  mcv numeric,
  mch numeric,
  mchc numeric,
  rdw numeric,
  plt numeric,
  mpv numeric,
  pdw numeric,
  nrbc numeric,
  neut numeric,
  lymph numeric,
  mono numeric,
  eosi numeric,
  baso numeric,
  neut_abs numeric,
  lymph_abs numeric,
  mono_abs numeric,
  eosi_abs numeric,
  baso_abs numeric,
  pt numeric,
  inr numeric,
  aptt numeric,
  tt numeric,
  fibg numeric,
  ddimer numeric,
  esr numeric,
  blood_group text,
  rh_factor text,
  film_result text,
  film_comment text,
  analyzer text,
  analysis_date date,
  performed_by uuid,
  has_critical boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  specimen text,
  verified_fields text[] DEFAULT '{}'::text[],
  is_released boolean NOT NULL DEFAULT false,
  released_at timestamp with time zone,
  released_by uuid
);

CREATE TABLE public.results_hematology_history (
  id bigint NOT NULL DEFAULT nextval('public.results_hematology_history_id_seq'::regclass),
  patient_id uuid NOT NULL,
  analyzer text,
  analysis_date date,
  notes text,
  specimen text,
  performed_by uuid,
  has_critical boolean,
  wbc numeric,
  rbc numeric,
  hgb numeric,
  hct numeric,
  mcv numeric,
  mch numeric,
  mchc numeric,
  rdw numeric,
  nrbc numeric,
  plt numeric,
  mpv numeric,
  pdw numeric,
  neut numeric,
  lymph numeric,
  mono numeric,
  eosi numeric,
  baso numeric,
  neut_abs numeric,
  lymph_abs numeric,
  mono_abs numeric,
  eosi_abs numeric,
  baso_abs numeric,
  pt numeric,
  inr numeric,
  aptt numeric,
  tt numeric,
  fibg numeric,
  ddimer numeric,
  esr numeric,
  blood_group text,
  rh_factor text,
  film_result text,
  film_comment text,
  is_verified boolean,
  verified_at timestamp with time zone,
  recorded_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.results_histopathology (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  specimen_site text,
  gross_description text,
  microscopic text,
  diagnosis text,
  grade text,
  stage text,
  ihc_results jsonb DEFAULT '{}'::jsonb,
  tests jsonb DEFAULT '{}'::jsonb,
  analyzer text,
  analysis_date date,
  performed_by uuid,
  has_critical boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  verified_fields text[] DEFAULT '{}'::text[],
  is_released boolean NOT NULL DEFAULT false,
  released_at timestamp with time zone,
  released_by uuid
);

CREATE TABLE public.results_microbiology (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  ua_sg numeric,
  ua_ph numeric,
  ua_wbc numeric,
  ua_rbc numeric,
  ua_epith numeric,
  ua_color text,
  ua_appear text,
  ua_protein text,
  ua_glucose text,
  ua_ketones text,
  ua_blood text,
  ua_bilirubin text,
  ua_urobilinogen text,
  ua_nitrite text,
  ua_leuk text,
  ua_bacteria text,
  ua_crystals text,
  ua_cast_hyal numeric,
  ua_cast_gran text,
  st_wbc numeric,
  st_rbc numeric,
  st_color text,
  st_consist text,
  st_blood text,
  st_mucus text,
  st_fob text,
  st_ova text,
  st_fat text,
  st_yeast text,
  csf_protein numeric,
  csf_glucose numeric,
  csf_ratio numeric,
  csf_chloride numeric,
  csf_wbc numeric,
  csf_rbc numeric,
  csf_appear text,
  csf_culture text,
  culture_result text,
  culture_organism text,
  sensitivity jsonb DEFAULT '{}'::jsonb,
  specimen_type text,
  analyzer text,
  analysis_date date,
  performed_by uuid,
  has_critical boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  ua_yeast text,
  culture_count text,
  culture_notes text,
  received_by text,
  verified_fields text[] DEFAULT '{}'::text[],
  is_released boolean NOT NULL DEFAULT false,
  released_at timestamp with time zone,
  released_by uuid
);

CREATE TABLE public.results_pcr (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  target text,
  result text,
  ct_value numeric,
  platform text,
  tests jsonb DEFAULT '{}'::jsonb,
  analyzer text,
  analysis_date date,
  performed_by uuid,
  has_critical boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  verified_fields text[] DEFAULT '{}'::text[],
  is_released boolean NOT NULL DEFAULT false,
  released_at timestamp with time zone,
  released_by uuid
);

CREATE TABLE public.results_serology (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  tsh numeric,
  ft3 numeric,
  ft4 numeric,
  t3 numeric,
  t4 numeric,
  fsh numeric,
  lh numeric,
  estradiol numeric,
  prog numeric,
  testosterone numeric,
  prolactin numeric,
  psa numeric,
  afp numeric,
  cea numeric,
  ca125 numeric,
  ca199 numeric,
  ca153 numeric,
  vit_d numeric,
  vit_b12 numeric,
  folate numeric,
  ferritin numeric,
  transferrin numeric,
  rf numeric,
  aso numeric,
  ana numeric,
  anti_ccp numeric,
  anti_dsdna numeric,
  ige numeric,
  hiv text,
  hbsag text,
  hcv text,
  rpr text,
  tpha text,
  widal_o text,
  widal_h text,
  brucella text,
  hpylori text,
  bhcg_qual text,
  tests jsonb DEFAULT '{}'::jsonb,
  analyzer text,
  analysis_date date,
  performed_by uuid,
  has_critical boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  specimen text,
  verified_fields text[] DEFAULT '{}'::text[],
  is_released boolean NOT NULL DEFAULT false,
  released_at timestamp with time zone,
  released_by uuid
);

CREATE TABLE public.sample_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  primary_specimen text,
  sample_condition text DEFAULT 'Acceptable'::text,
  collector_name text,
  collection_time text,
  received_by text,
  received_time text,
  received_at timestamp with time zone,
  status text DEFAULT 'Pending'::text,
  redraw_required boolean DEFAULT false,
  rejection_reason text,
  tests_received jsonb DEFAULT '[]'::jsonb,
  source text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  specimen_type text,
  collection_site text,
  needle_gauge text,
  attempts integer DEFAULT 1,
  volume_ml numeric(6,1),
  fasting_status text,
  id_verified boolean DEFAULT false,
  storage_temp text,
  collected_by text,
  collected_at timestamp with time zone,
  condition text DEFAULT 'Acceptable'::text,
  sample_source text,
  payment_deferred boolean DEFAULT false,
  payment_deferred_by uuid,
  payment_deferred_by_name text,
  payment_deferred_at timestamp with time zone
);

CREATE TABLE public.settings (
  key text NOT NULL,
  value jsonb,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sms_log (
  id bigint NOT NULL DEFAULT nextval('public.sms_log_id_seq'::regclass),
  patient_id uuid,
  phone text NOT NULL,
  message text NOT NULL,
  purpose text NOT NULL DEFAULT 'other'::text,
  status text NOT NULL,
  error text,
  sent_by uuid,
  sent_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.staff (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'lab_tech'::text,
  department text,
  phone text,
  email text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'active'::text,
  hire_date date,
  qualifications text,
  national_id text,
  override_pin_hash text,
  specialty text
);

CREATE TABLE public.stock_requisitions (
  id bigint NOT NULL DEFAULT nextval('public.stock_requisitions_id_seq'::regclass),
  requesting_department text NOT NULL,
  item_id uuid NOT NULL,
  qty_requested numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  notes text,
  requested_by uuid,
  requested_by_name text,
  decided_by uuid,
  decided_by_name text,
  decision_note text,
  decided_at timestamp with time zone,
  fulfilled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  received_confirmed_by uuid,
  received_confirmed_by_name text,
  received_confirmed_at timestamp with time zone
);

CREATE TABLE public.theatre_bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_id uuid,
  booking_no text,
  theatre_date date,
  start_time time without time zone,
  end_time time without time zone,
  actual_start timestamp with time zone,
  actual_end timestamp with time zone,
  duration_minutes integer,
  theatre_room text,
  operation_name text,
  operation_type text DEFAULT 'Elective'::text,
  surgeon text,
  assistant_surgeon text,
  anaesthetist text,
  anaesthesia_type text,
  asa_class text,
  pre_op_checklist jsonb DEFAULT '{}'::jsonb,
  post_op_notes text,
  complications text,
  status text DEFAULT 'Scheduled'::text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  notes text
);

CREATE TABLE public.validation_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  grand_mean numeric,
  ms_within numeric,
  ms_between numeric,
  cv_within_pct numeric,
  cv_total_pct numeric,
  uvl numeric,
  regression_method text,
  slope numeric,
  intercept numeric,
  r_squared numeric,
  bias_pct numeric,
  sd_differences numeric,
  result_status text NOT NULL,
  calculated_at timestamp with time zone NOT NULL DEFAULT now(),
  performed_by uuid,
  performed_by_name text,
  verified_by uuid,
  verified_by_name text,
  verified_at timestamp with time zone,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamp with time zone
);

CREATE TABLE public.validation_samples (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  run_number integer NOT NULL,
  replicate_number integer NOT NULL,
  target_level text,
  method text,
  result_value numeric NOT NULL,
  entered_by uuid,
  entered_by_name text,
  entered_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.validation_studies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  analyte text NOT NULL,
  instrument_name text NOT NULL,
  instrument_serial text,
  protocol_type text NOT NULL,
  unit text,
  tea_limit numeric,
  claimed_cv_pct numeric,
  status text NOT NULL DEFAULT 'Draft'::text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.vital_signs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  admission_id uuid,
  recorded_at timestamp with time zone DEFAULT now(),
  bp_systolic numeric,
  bp_diastolic numeric,
  heart_rate numeric,
  respiratory_rate numeric,
  temperature numeric,
  spo2 numeric,
  weight numeric,
  height numeric,
  bmi numeric,
  gcs_eye integer,
  gcs_verbal integer,
  gcs_motor integer,
  pain_score integer,
  fluid_in_ml numeric,
  fluid_out_ml numeric,
  urine_output_ml numeric,
  net_balance numeric,
  recorded_by_name text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  systolic integer,
  diastolic integer,
  map_pressure integer,
  pulse_rhythm text,
  o2_delivery text,
  o2_flow numeric(4,1),
  fio2 integer,
  news2_score integer,
  braden_score integer,
  morse_fall_score integer,
  wound_assessment jsonb,
  mar_entries jsonb,
  recorded_by text,
  transfusion_id uuid,
  transfusion_stage text,
  sofa_score integer,
  rrt_acknowledged boolean,
  rrt_acknowledged_by text,
  rrt_acknowledged_at timestamp with time zone,
  rrt_notified_to text,
  rrt_notes text,
  turning_position text,
  analgesia_administered_at timestamp with time zone
);

CREATE TABLE public.wallet_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  type text NOT NULL,
  amount numeric(14,2) NOT NULL,
  balance_after numeric(14,2) NOT NULL,
  reference_invoice_id uuid,
  shift_id uuid,
  performed_by uuid,
  performed_by_name text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.ward_handover_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ward text NOT NULL,
  shift text,
  handover_date date DEFAULT CURRENT_DATE,
  notes text,
  handing_over text,
  receiving text,
  patient_count integer,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  critical_patients text,
  pending_tasks text,
  situation text,
  background text,
  assessment text,
  recommendation text
);

CREATE TABLE public.who_safety_checklist (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  signin_items jsonb,
  signin_completed_by uuid,
  signin_completed_by_name text,
  signin_completed_at timestamp with time zone,
  timeout_items jsonb,
  timeout_completed_by uuid,
  timeout_completed_by_name text,
  timeout_completed_at timestamp with time zone,
  signout_items jsonb,
  signout_completed_by uuid,
  signout_completed_by_name text,
  signout_completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.admissions ADD CONSTRAINT admissions_admission_no_key UNIQUE (admission_no);

ALTER TABLE public.admissions ADD CONSTRAINT admissions_pkey PRIMARY KEY (id);

ALTER TABLE public.app_audit_logs ADD CONSTRAINT app_audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.appointments ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.bed_transfers ADD CONSTRAINT bed_transfers_pkey PRIMARY KEY (id);

ALTER TABLE public.beds ADD CONSTRAINT beds_pkey PRIMARY KEY (id);

ALTER TABLE public.beds ADD CONSTRAINT beds_ward_room_bed_number_key UNIQUE (ward, room, bed_number);

ALTER TABLE public.billing_audit_logs ADD CONSTRAINT billing_audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.blood_donations ADD CONSTRAINT blood_donations_pkey PRIMARY KEY (id);

ALTER TABLE public.blood_donors ADD CONSTRAINT blood_donors_donor_no_key UNIQUE (donor_no);

ALTER TABLE public.blood_donors ADD CONSTRAINT blood_donors_pkey PRIMARY KEY (id);

ALTER TABLE public.blood_issue_log ADD CONSTRAINT blood_issue_log_pkey PRIMARY KEY (id);

ALTER TABLE public.blood_requests ADD CONSTRAINT blood_requests_pkey PRIMARY KEY (id);

ALTER TABLE public.blood_requests ADD CONSTRAINT blood_requests_request_no_key UNIQUE (request_no);

ALTER TABLE public.blood_transfusions ADD CONSTRAINT blood_transfusions_pkey PRIMARY KEY (id);

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_pkey PRIMARY KEY (id);

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_unit_no_key UNIQUE (unit_no);

ALTER TABLE public.consent_forms ADD CONSTRAINT consent_forms_pkey PRIMARY KEY (id);

ALTER TABLE public.critical_values ADD CONSTRAINT critical_values_pkey PRIMARY KEY (id);

ALTER TABLE public.delta_check_log ADD CONSTRAINT delta_check_log_pkey PRIMARY KEY (id);

ALTER TABLE public.discharge_summaries ADD CONSTRAINT discharge_summaries_pkey PRIMARY KEY (id);

ALTER TABLE public.doctor_consultations ADD CONSTRAINT doctor_consultations_patient_id_key UNIQUE (patient_id);

ALTER TABLE public.doctor_consultations ADD CONSTRAINT doctor_consultations_pkey PRIMARY KEY (id);

ALTER TABLE public.doctor_orders ADD CONSTRAINT doctor_orders_pkey PRIMARY KEY (id);

ALTER TABLE public.doctors ADD CONSTRAINT doctors_pkey PRIMARY KEY (id);

ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_pkey PRIMARY KEY (id);

ALTER TABLE public.id_counters ADD CONSTRAINT id_counters_pkey PRIMARY KEY (counter_name);

ALTER TABLE public.infection_flags ADD CONSTRAINT infection_flags_pkey PRIMARY KEY (id);

ALTER TABLE public.instrument_messages ADD CONSTRAINT instrument_messages_pkey PRIMARY KEY (id);

ALTER TABLE public.inventory_batches ADD CONSTRAINT inventory_batches_pkey PRIMARY KEY (id);

ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);

ALTER TABLE public.invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);

ALTER TABLE public.lab_reference_ranges ADD CONSTRAINT lab_reference_ranges_dept_key_field_code_key UNIQUE (dept_key, field_code);

ALTER TABLE public.lab_reference_ranges ADD CONSTRAINT lab_reference_ranges_pkey PRIMARY KEY (id);

ALTER TABLE public.lab_result_history ADD CONSTRAINT lab_result_history_pkey PRIMARY KEY (id);

ALTER TABLE public.lab_shifts ADD CONSTRAINT lab_shifts_pkey PRIMARY KEY (id);

ALTER TABLE public.patient_wallets ADD CONSTRAINT patient_wallets_patient_id_key UNIQUE (patient_id);

ALTER TABLE public.patient_wallets ADD CONSTRAINT patient_wallets_pkey PRIMARY KEY (id);

ALTER TABLE public.patients_master ADD CONSTRAINT patients_master_mrn_key UNIQUE (mrn);

ALTER TABLE public.patients_master ADD CONSTRAINT patients_master_pkey PRIMARY KEY (id);

ALTER TABLE public.patients ADD CONSTRAINT patients_pkey PRIMARY KEY (id);

ALTER TABLE public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

ALTER TABLE public.pre_op_assessments ADD CONSTRAINT pre_op_assessments_admission_id_key UNIQUE (admission_id);

ALTER TABLE public.pre_op_assessments ADD CONSTRAINT pre_op_assessments_pkey PRIMARY KEY (id);

ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (id);

ALTER TABLE public.price_list ADD CONSTRAINT price_list_code_key UNIQUE (code);

ALTER TABLE public.price_list ADD CONSTRAINT price_list_pkey PRIMARY KEY (id);

ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);

ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);

ALTER TABLE public.qc_lots ADD CONSTRAINT qc_lots_pkey PRIMARY KEY (id);

ALTER TABLE public.qc_results ADD CONSTRAINT qc_results_pkey PRIMARY KEY (id);

ALTER TABLE public.queue_token_counters ADD CONSTRAINT queue_token_counters_pkey PRIMARY KEY (token_date, prefix);

ALTER TABLE public.radiology_requests ADD CONSTRAINT radiology_requests_pkey PRIMARY KEY (id);

ALTER TABLE public.reagent_inventory ADD CONSTRAINT reagent_inventory_pkey PRIMARY KEY (id);

ALTER TABLE public.reception_shifts ADD CONSTRAINT reception_shifts_pkey PRIMARY KEY (id);

ALTER TABLE public.reception_shifts ADD CONSTRAINT reception_shifts_shift_no_key UNIQUE (shift_no);

ALTER TABLE public.results_chemistry_history ADD CONSTRAINT results_chemistry_history_pkey PRIMARY KEY (id);

ALTER TABLE public.results_chemistry ADD CONSTRAINT results_chemistry_patient_id_key UNIQUE (patient_id);

ALTER TABLE public.results_chemistry ADD CONSTRAINT results_chemistry_pkey PRIMARY KEY (id);

ALTER TABLE public.results_cytology ADD CONSTRAINT results_cytology_patient_id_key UNIQUE (patient_id);

ALTER TABLE public.results_cytology ADD CONSTRAINT results_cytology_pkey PRIMARY KEY (id);

ALTER TABLE public.results_hematology_history ADD CONSTRAINT results_hematology_history_pkey PRIMARY KEY (id);

ALTER TABLE public.results_hematology ADD CONSTRAINT results_hematology_patient_id_key UNIQUE (patient_id);

ALTER TABLE public.results_hematology ADD CONSTRAINT results_hematology_pkey PRIMARY KEY (id);

ALTER TABLE public.results_histopathology ADD CONSTRAINT results_histopathology_patient_id_key UNIQUE (patient_id);

ALTER TABLE public.results_histopathology ADD CONSTRAINT results_histopathology_pkey PRIMARY KEY (id);

ALTER TABLE public.results_microbiology ADD CONSTRAINT results_microbiology_patient_id_key UNIQUE (patient_id);

ALTER TABLE public.results_microbiology ADD CONSTRAINT results_microbiology_pkey PRIMARY KEY (id);

ALTER TABLE public.results_pcr ADD CONSTRAINT results_pcr_patient_id_key UNIQUE (patient_id);

ALTER TABLE public.results_pcr ADD CONSTRAINT results_pcr_pkey PRIMARY KEY (id);

ALTER TABLE public.results_serology ADD CONSTRAINT results_serology_patient_id_key UNIQUE (patient_id);

ALTER TABLE public.results_serology ADD CONSTRAINT results_serology_pkey PRIMARY KEY (id);

ALTER TABLE public.sample_records ADD CONSTRAINT sample_records_pkey PRIMARY KEY (id);

ALTER TABLE public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (key);

ALTER TABLE public.sms_log ADD CONSTRAINT sms_log_pkey PRIMARY KEY (id);

ALTER TABLE public.staff ADD CONSTRAINT staff_pkey PRIMARY KEY (id);

ALTER TABLE public.staff ADD CONSTRAINT staff_user_id_key UNIQUE (user_id);

ALTER TABLE public.stock_requisitions ADD CONSTRAINT stock_requisitions_pkey PRIMARY KEY (id);

ALTER TABLE public.theatre_bookings ADD CONSTRAINT theatre_bookings_booking_no_key UNIQUE (booking_no);

ALTER TABLE public.theatre_bookings ADD CONSTRAINT theatre_bookings_pkey PRIMARY KEY (id);

ALTER TABLE public.validation_results ADD CONSTRAINT validation_results_pkey PRIMARY KEY (id);

ALTER TABLE public.validation_samples ADD CONSTRAINT validation_samples_pkey PRIMARY KEY (id);

ALTER TABLE public.validation_studies ADD CONSTRAINT validation_studies_pkey PRIMARY KEY (id);

ALTER TABLE public.vital_signs ADD CONSTRAINT vital_signs_pkey PRIMARY KEY (id);

ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);

ALTER TABLE public.ward_handover_notes ADD CONSTRAINT ward_handover_notes_pkey PRIMARY KEY (id);

ALTER TABLE public.who_safety_checklist ADD CONSTRAINT who_safety_checklist_booking_id_key UNIQUE (booking_id);

ALTER TABLE public.who_safety_checklist ADD CONSTRAINT who_safety_checklist_pkey PRIMARY KEY (id);
ALTER TABLE public.admissions ADD CONSTRAINT admissions_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.admissions ADD CONSTRAINT admissions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.appointments ADD CONSTRAINT appointments_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.appointments ADD CONSTRAINT appointments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;

ALTER TABLE public.appointments ADD CONSTRAINT appointments_theatre_booking_id_fkey FOREIGN KEY (theatre_booking_id) REFERENCES theatre_bookings(id) ON DELETE SET NULL;

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK ((action = ANY (ARRAY['UPDATE'::text, 'DELETE'::text])));

ALTER TABLE public.bed_transfers ADD CONSTRAINT bed_transfers_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE CASCADE;

ALTER TABLE public.bed_transfers ADD CONSTRAINT bed_transfers_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;

ALTER TABLE public.beds ADD CONSTRAINT beds_current_patient_id_fkey FOREIGN KEY (current_patient_id) REFERENCES patients(id) ON DELETE SET NULL;

ALTER TABLE public.beds ADD CONSTRAINT beds_status_check CHECK ((status = ANY (ARRAY['Available'::text, 'Occupied'::text, 'Cleaning'::text, 'Maintenance'::text, 'Discharge Pending'::text])));

ALTER TABLE public.billing_audit_logs ADD CONSTRAINT billing_audit_logs_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES staff(id);

ALTER TABLE public.billing_audit_logs ADD CONSTRAINT billing_audit_logs_event_type_check CHECK ((event_type = ANY (ARRAY['shift_open'::text, 'shift_close'::text, 'void_invoice'::text, 'refund'::text, 'discount_override'::text, 'wallet_credit'::text, 'wallet_debit'::text, 'reprint'::text])));

ALTER TABLE public.billing_audit_logs ADD CONSTRAINT billing_audit_logs_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);

ALTER TABLE public.billing_audit_logs ADD CONSTRAINT billing_audit_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES staff(id);

ALTER TABLE public.billing_audit_logs ADD CONSTRAINT billing_audit_logs_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES reception_shifts(id);

ALTER TABLE public.blood_donations ADD CONSTRAINT blood_donations_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES blood_donors(id) ON DELETE CASCADE;

ALTER TABLE public.blood_donations ADD CONSTRAINT blood_donations_hbv_result_check CHECK ((hbv_result = ANY (ARRAY['Pending'::text, 'Negative'::text, 'Positive'::text])));

ALTER TABLE public.blood_donations ADD CONSTRAINT blood_donations_hcv_result_check CHECK ((hcv_result = ANY (ARRAY['Pending'::text, 'Negative'::text, 'Positive'::text])));

ALTER TABLE public.blood_donations ADD CONSTRAINT blood_donations_hiv_result_check CHECK ((hiv_result = ANY (ARRAY['Pending'::text, 'Negative'::text, 'Positive'::text])));

ALTER TABLE public.blood_donations ADD CONSTRAINT blood_donations_malaria_result_check CHECK ((malaria_result = ANY (ARRAY['Pending'::text, 'Negative'::text, 'Positive'::text])));

ALTER TABLE public.blood_donations ADD CONSTRAINT blood_donations_syphilis_result_check CHECK ((syphilis_result = ANY (ARRAY['Pending'::text, 'Negative'::text, 'Positive'::text])));

ALTER TABLE public.blood_donors ADD CONSTRAINT blood_donors_blood_group_check CHECK ((blood_group = ANY (ARRAY['A'::text, 'B'::text, 'AB'::text, 'O'::text])));

ALTER TABLE public.blood_donors ADD CONSTRAINT blood_donors_rh_factor_check CHECK ((rh_factor = ANY (ARRAY['Positive'::text, 'Negative'::text])));

ALTER TABLE public.blood_issue_log ADD CONSTRAINT blood_issue_log_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;

ALTER TABLE public.blood_issue_log ADD CONSTRAINT blood_issue_log_request_id_fkey FOREIGN KEY (request_id) REFERENCES blood_requests(id) ON DELETE SET NULL;

ALTER TABLE public.blood_issue_log ADD CONSTRAINT blood_issue_log_two_person CHECK ((issued_by IS DISTINCT FROM received_by));

ALTER TABLE public.blood_issue_log ADD CONSTRAINT blood_issue_log_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES blood_units(id) ON DELETE RESTRICT;

ALTER TABLE public.blood_requests ADD CONSTRAINT blood_requests_component_type_check CHECK ((component_type = ANY (ARRAY['Whole Blood'::text, 'Packed RBC'::text, 'FFP'::text, 'Platelets'::text, 'Cryoprecipitate'::text])));

ALTER TABLE public.blood_requests ADD CONSTRAINT blood_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.blood_requests ADD CONSTRAINT blood_requests_status_check CHECK ((status = ANY (ARRAY['Requested'::text, 'Crossmatched'::text, 'Issued'::text, 'Cancelled'::text])));

ALTER TABLE public.blood_requests ADD CONSTRAINT blood_requests_units_requested_check CHECK ((units_requested > 0));

ALTER TABLE public.blood_requests ADD CONSTRAINT blood_requests_urgency_check CHECK ((urgency = ANY (ARRAY['Routine'::text, 'Urgent'::text, 'STAT'::text])));

ALTER TABLE public.blood_transfusions ADD CONSTRAINT blood_transfusions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;

ALTER TABLE public.blood_transfusions ADD CONSTRAINT blood_transfusions_request_id_fkey FOREIGN KEY (request_id) REFERENCES blood_requests(id) ON DELETE SET NULL;

ALTER TABLE public.blood_transfusions ADD CONSTRAINT blood_transfusions_status_check CHECK ((status = ANY (ARRAY['In Progress'::text, 'Completed'::text, 'Reaction Reported'::text])));

ALTER TABLE public.blood_transfusions ADD CONSTRAINT blood_transfusions_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES blood_units(id) ON DELETE RESTRICT;

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_blood_group_check CHECK ((blood_group = ANY (ARRAY['A'::text, 'B'::text, 'AB'::text, 'O'::text])));

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_component_type_check CHECK ((component_type = ANY (ARRAY['Whole Blood'::text, 'Packed RBC'::text, 'FFP'::text, 'Platelets'::text, 'Cryoprecipitate'::text])));

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_discard_reason_code_check CHECK ((discard_reason_code = ANY (ARRAY['Expired'::text, 'Reaction-Related'::text, 'Damaged'::text, 'Other'::text])));

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES blood_donations(id) ON DELETE SET NULL;

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_request_id_fkey FOREIGN KEY (request_id) REFERENCES blood_requests(id) ON DELETE SET NULL;

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_rh_factor_check CHECK ((rh_factor = ANY (ARRAY['Positive'::text, 'Negative'::text])));

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_source_check CHECK ((source = ANY (ARRAY['In-House Donation'::text, 'Received - External Supply'::text])));

ALTER TABLE public.blood_units ADD CONSTRAINT blood_units_status_check CHECK ((status = ANY (ARRAY['Quarantined'::text, 'Available'::text, 'Crossmatched'::text, 'Issued'::text, 'Expired'::text, 'Discarded'::text])));

ALTER TABLE public.consent_forms ADD CONSTRAINT consent_forms_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE SET NULL;

ALTER TABLE public.consent_forms ADD CONSTRAINT consent_forms_consent_type_check CHECK ((consent_type = ANY (ARRAY['Surgical Procedure'::text, 'Anaesthesia'::text, 'High-Risk Procedure / Intervention'::text, 'Blood Transfusion'::text, 'Other'::text])));

ALTER TABLE public.consent_forms ADD CONSTRAINT consent_forms_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.critical_values ADD CONSTRAINT critical_values_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(user_id);

ALTER TABLE public.critical_values ADD CONSTRAINT critical_values_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.delta_check_log ADD CONSTRAINT delta_check_log_delta_type_check CHECK ((delta_type = ANY (ARRAY['pct'::text, 'abs'::text])));

ALTER TABLE public.delta_check_log ADD CONSTRAINT delta_check_log_direction_check CHECK ((direction = ANY (ARRAY['drop'::text, 'rise'::text, 'either'::text])));

ALTER TABLE public.discharge_summaries ADD CONSTRAINT discharge_summaries_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE CASCADE;

ALTER TABLE public.discharge_summaries ADD CONSTRAINT discharge_summaries_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.discharge_summaries ADD CONSTRAINT discharge_summaries_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.doctor_consultations ADD CONSTRAINT doctor_consultations_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.doctor_consultations ADD CONSTRAINT doctor_consultations_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES staff(id);

ALTER TABLE public.doctor_orders ADD CONSTRAINT doctor_orders_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE SET NULL;

ALTER TABLE public.doctor_orders ADD CONSTRAINT doctor_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.doctor_orders ADD CONSTRAINT doctor_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.doctors ADD CONSTRAINT doctors_doctor_type_check CHECK ((doctor_type = ANY (ARRAY['GP'::text, 'Specialist'::text, 'Consultant'::text])));

ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_origin_patient_id_fkey FOREIGN KEY (origin_patient_id) REFERENCES patients(id) ON DELETE SET NULL;

ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_used_patient_id_fkey FOREIGN KEY (used_patient_id) REFERENCES patients(id) ON DELETE SET NULL;

ALTER TABLE public.infection_flags ADD CONSTRAINT infection_flags_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE SET NULL;

ALTER TABLE public.infection_flags ADD CONSTRAINT infection_flags_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.infection_flags ADD CONSTRAINT infection_flags_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.instrument_messages ADD CONSTRAINT instrument_messages_protocol_check CHECK ((protocol = ANY (ARRAY['ASTM'::text, 'HL7'::text])));

ALTER TABLE public.instrument_messages ADD CONSTRAINT instrument_messages_sync_status_check CHECK ((sync_status = ANY (ARRAY['auto_mapped'::text, 'pending_mapping'::text, 'error'::text])));

ALTER TABLE public.inventory_batches ADD CONSTRAINT inventory_batches_discard_reason_code_check CHECK ((discard_reason_code = ANY (ARRAY['Expired'::text, 'Damaged'::text, 'Contaminated'::text, 'Other'::text])));

ALTER TABLE public.inventory_batches ADD CONSTRAINT inventory_batches_item_id_fkey FOREIGN KEY (item_id) REFERENCES reagent_inventory(id) ON DELETE CASCADE;

ALTER TABLE public.inventory_batches ADD CONSTRAINT inventory_batches_quantity_check CHECK ((quantity >= (0)::numeric));

ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE public.invoices ADD CONSTRAINT invoices_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE SET NULL;

ALTER TABLE public.invoices ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.invoices ADD CONSTRAINT invoices_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;

ALTER TABLE public.invoices ADD CONSTRAINT invoices_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES reception_shifts(id);

ALTER TABLE public.lab_reference_ranges ADD CONSTRAINT lab_reference_ranges_dept_key_check CHECK ((dept_key = ANY (ARRAY['hem'::text, 'chem'::text, 'sero'::text, 'immuno'::text])));

ALTER TABLE public.lab_result_history ADD CONSTRAINT lab_result_history_flag_check CHECK (((flag = ANY (ARRAY['H'::text, 'L'::text, 'N'::text])) OR (flag IS NULL)));

ALTER TABLE public.lab_result_history ADD CONSTRAINT lab_result_history_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.patient_wallets ADD CONSTRAINT patient_wallets_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.patients ADD CONSTRAINT patients_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL;

ALTER TABLE public.patients ADD CONSTRAINT patients_master_id_fkey FOREIGN KEY (master_id) REFERENCES patients_master(id);

ALTER TABLE public.patients ADD CONSTRAINT patients_visit_status_check CHECK ((visit_status = ANY (ARRAY['Registered'::text, 'With Doctor'::text, 'Orders Pending'::text, 'Results Ready'::text, 'Visit Complete'::text])));

ALTER TABLE public.payments ADD CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric));

ALTER TABLE public.payments ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE public.payments ADD CONSTRAINT payments_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'card'::text, 'insurance'::text, 'wallet'::text, 'online'::text, 'bank_transfer'::text, 'mobile_money'::text])));

ALTER TABLE public.payments ADD CONSTRAINT payments_received_by_fkey FOREIGN KEY (received_by) REFERENCES staff(id);

ALTER TABLE public.payments ADD CONSTRAINT payments_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES reception_shifts(id);

ALTER TABLE public.payments ADD CONSTRAINT payments_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES staff(id);

ALTER TABLE public.pre_op_assessments ADD CONSTRAINT pre_op_assessments_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE SET NULL;

ALTER TABLE public.pre_op_assessments ADD CONSTRAINT pre_op_assessments_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.pre_op_assessments ADD CONSTRAINT pre_op_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.pre_op_assessments ADD CONSTRAINT pre_op_assessments_theatre_booking_id_fkey FOREIGN KEY (theatre_booking_id) REFERENCES theatre_bookings(id) ON DELETE SET NULL;

ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE SET NULL;

ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES reagent_inventory(id);

ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_qty_ordered_check CHECK ((qty_ordered > (0)::numeric));

ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'received'::text, 'cancelled'::text])));

ALTER TABLE public.qc_results ADD CONSTRAINT qc_results_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES qc_lots(id) ON DELETE CASCADE;

ALTER TABLE public.qc_results ADD CONSTRAINT qc_results_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES staff(id);

ALTER TABLE public.radiology_requests ADD CONSTRAINT radiology_requests_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE SET NULL;

ALTER TABLE public.radiology_requests ADD CONSTRAINT radiology_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.radiology_requests ADD CONSTRAINT radiology_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.radiology_requests ADD CONSTRAINT radiology_requests_pregnancy_status_check CHECK ((pregnancy_status = ANY (ARRAY['not_applicable'::text, 'confirmed_not_pregnant'::text, 'confirmed_pregnant'::text, 'declined_unknown'::text])));

ALTER TABLE public.reagent_inventory ADD CONSTRAINT reagent_inventory_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.reception_shifts ADD CONSTRAINT reception_shifts_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES staff(id);

ALTER TABLE public.reception_shifts ADD CONSTRAINT reception_shifts_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES staff(id);

ALTER TABLE public.reception_shifts ADD CONSTRAINT reception_shifts_shift_type_check CHECK ((shift_type = ANY (ARRAY['morning'::text, 'evening'::text, 'night'::text])));

ALTER TABLE public.reception_shifts ADD CONSTRAINT reception_shifts_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id);

ALTER TABLE public.reception_shifts ADD CONSTRAINT reception_shifts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text])));

ALTER TABLE public.reception_shifts ADD CONSTRAINT reception_shifts_variance_reason_check CHECK (((variance_reason IS NULL) OR (variance_reason = ANY (ARRAY['counter_change_shortage'::text, 'unprocessed_refund'::text, 'bank_deposit_variance'::text, 'counterfeit_note'::text, 'miscount'::text, 'other'::text]))));

ALTER TABLE public.results_chemistry_history ADD CONSTRAINT results_chemistry_history_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.results_chemistry ADD CONSTRAINT results_chemistry_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.results_cytology ADD CONSTRAINT results_cytology_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.results_hematology_history ADD CONSTRAINT results_hematology_history_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.results_hematology ADD CONSTRAINT results_hematology_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.results_histopathology ADD CONSTRAINT results_histopathology_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.results_microbiology ADD CONSTRAINT results_microbiology_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.results_pcr ADD CONSTRAINT results_pcr_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.results_serology ADD CONSTRAINT results_serology_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.sample_records ADD CONSTRAINT sample_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.sms_log ADD CONSTRAINT sms_log_purpose_check CHECK ((purpose = ANY (ARRAY['appointment_reminder'::text, 'result_ready'::text, 'other'::text])));

ALTER TABLE public.sms_log ADD CONSTRAINT sms_log_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])));

ALTER TABLE public.staff ADD CONSTRAINT staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.stock_requisitions ADD CONSTRAINT stock_requisitions_item_id_fkey FOREIGN KEY (item_id) REFERENCES reagent_inventory(id);

ALTER TABLE public.stock_requisitions ADD CONSTRAINT stock_requisitions_qty_requested_check CHECK ((qty_requested > (0)::numeric));

ALTER TABLE public.stock_requisitions ADD CONSTRAINT stock_requisitions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'fulfilled'::text, 'received'::text])));

ALTER TABLE public.theatre_bookings ADD CONSTRAINT theatre_bookings_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE SET NULL;

ALTER TABLE public.theatre_bookings ADD CONSTRAINT theatre_bookings_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.theatre_bookings ADD CONSTRAINT theatre_bookings_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.validation_results ADD CONSTRAINT validation_results_regression_method_check CHECK ((regression_method = ANY (ARRAY['Deming'::text, 'OLS'::text])));

ALTER TABLE public.validation_results ADD CONSTRAINT validation_results_result_status_check CHECK ((result_status = ANY (ARRAY['Pass'::text, 'Fail'::text])));

ALTER TABLE public.validation_results ADD CONSTRAINT validation_results_study_id_fkey FOREIGN KEY (study_id) REFERENCES validation_studies(id) ON DELETE CASCADE;

ALTER TABLE public.validation_samples ADD CONSTRAINT validation_samples_method_check CHECK ((method = ANY (ARRAY['X'::text, 'Y'::text])));

ALTER TABLE public.validation_samples ADD CONSTRAINT validation_samples_study_id_fkey FOREIGN KEY (study_id) REFERENCES validation_studies(id) ON DELETE CASCADE;

ALTER TABLE public.validation_studies ADD CONSTRAINT validation_studies_protocol_type_check CHECK ((protocol_type = ANY (ARRAY['EP15-A3'::text, 'EP09-A3'::text, 'EP06-A'::text])));

ALTER TABLE public.validation_studies ADD CONSTRAINT validation_studies_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'In Progress'::text, 'Completed'::text])));

ALTER TABLE public.vital_signs ADD CONSTRAINT vital_signs_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES admissions(id) ON DELETE SET NULL;

ALTER TABLE public.vital_signs ADD CONSTRAINT vital_signs_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.vital_signs ADD CONSTRAINT vital_signs_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.vital_signs ADD CONSTRAINT vital_signs_transfusion_id_fkey FOREIGN KEY (transfusion_id) REFERENCES blood_transfusions(id) ON DELETE SET NULL;

ALTER TABLE public.vital_signs ADD CONSTRAINT vital_signs_transfusion_stage_check CHECK ((transfusion_stage = ANY (ARRAY['Before'::text, 'During'::text, 'After'::text])));

ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_amount_check CHECK ((amount > (0)::numeric));

ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES staff(id);

ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_reference_invoice_id_fkey FOREIGN KEY (reference_invoice_id) REFERENCES invoices(id);

ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES reception_shifts(id);

ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check CHECK ((type = ANY (ARRAY['credit'::text, 'debit'::text, 'refund'::text])));

ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES patient_wallets(id) ON DELETE CASCADE;

ALTER TABLE public.ward_handover_notes ADD CONSTRAINT ward_handover_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);

ALTER TABLE public.who_safety_checklist ADD CONSTRAINT who_safety_checklist_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES theatre_bookings(id) ON DELETE CASCADE;
CREATE INDEX audit_logs_changed_at_idx ON public.audit_logs USING btree (changed_at DESC);

CREATE INDEX audit_logs_patient_idx ON public.audit_logs USING btree (patient_id);

CREATE INDEX audit_logs_table_record_idx ON public.audit_logs USING btree (table_name, record_id);

CREATE INDEX bed_transfers_admission_idx ON public.bed_transfers USING btree (admission_id, transferred_at);

CREATE INDEX blood_donations_cleared_idx ON public.blood_donations USING btree (cleared);

CREATE INDEX blood_donations_donor_idx ON public.blood_donations USING btree (donor_id);

CREATE INDEX blood_issue_log_patient_idx ON public.blood_issue_log USING btree (patient_id);

CREATE INDEX blood_issue_log_unit_idx ON public.blood_issue_log USING btree (unit_id);

CREATE INDEX blood_requests_patient_idx ON public.blood_requests USING btree (patient_id);

CREATE INDEX blood_requests_status_idx ON public.blood_requests USING btree (status);

CREATE INDEX blood_transfusions_patient_idx ON public.blood_transfusions USING btree (patient_id);

CREATE INDEX blood_transfusions_unit_idx ON public.blood_transfusions USING btree (unit_id);

CREATE INDEX blood_units_expiry_idx ON public.blood_units USING btree (expiry_date);

CREATE INDEX blood_units_group_idx ON public.blood_units USING btree (blood_group, rh_factor, component_type, status);

CREATE INDEX blood_units_status_idx ON public.blood_units USING btree (status);

CREATE INDEX delta_check_log_created_at_idx ON public.delta_check_log USING btree (created_at DESC);

CREATE INDEX delta_check_log_patient_idx ON public.delta_check_log USING btree (patient_id);

CREATE INDEX follow_ups_mrn_idx ON public.follow_ups USING btree (patient_mrn, used);

CREATE INDEX idx_admissions_date ON public.admissions USING btree (admission_date);

CREATE UNIQUE INDEX idx_admissions_ip_no ON public.admissions USING btree (ip_no) WHERE (ip_no IS NOT NULL);

CREATE INDEX idx_admissions_no ON public.admissions USING btree (admission_no);

CREATE INDEX idx_admissions_patient ON public.admissions USING btree (patient_id);

CREATE INDEX idx_admissions_status ON public.admissions USING btree (status);

CREATE INDEX idx_admissions_ward ON public.admissions USING btree (ward);

CREATE INDEX idx_app_audit_logs_module ON public.app_audit_logs USING btree (module, created_at DESC);

CREATE INDEX idx_appt_date ON public.appointments USING btree (appointment_date);

CREATE INDEX idx_appt_patient ON public.appointments USING btree (patient_id);

CREATE INDEX idx_appt_status ON public.appointments USING btree (status);

CREATE INDEX idx_beds_status ON public.beds USING btree (status);

CREATE INDEX idx_beds_ward ON public.beds USING btree (ward);

CREATE INDEX idx_billing_audit_event ON public.billing_audit_logs USING btree (event_type);

CREATE INDEX idx_billing_audit_invoice ON public.billing_audit_logs USING btree (invoice_id);

CREATE INDEX idx_chem_critical ON public.results_chemistry USING btree (has_critical);

CREATE INDEX idx_chem_date ON public.results_chemistry USING btree (analysis_date);

CREATE INDEX idx_chem_patient ON public.results_chemistry USING btree (patient_id);

CREATE INDEX idx_chem_verified ON public.results_chemistry USING btree (is_verified);

CREATE INDEX idx_consent_forms_patient ON public.consent_forms USING btree (patient_id, created_at DESC);

CREATE INDEX idx_consult_patient ON public.doctor_consultations USING btree (patient_id);

CREATE INDEX idx_criticals_ack ON public.critical_values USING btree (acknowledged);

CREATE INDEX idx_criticals_patient ON public.critical_values USING btree (patient_id);

CREATE INDEX idx_critvals_ack ON public.critical_values USING btree (is_acknowledged);

CREATE INDEX idx_critvals_patient ON public.critical_values USING btree (patient_id);

CREATE INDEX idx_cyto_patient ON public.results_cytology USING btree (patient_id);

CREATE INDEX idx_hem_critical ON public.results_hematology USING btree (has_critical);

CREATE INDEX idx_hem_date ON public.results_hematology USING btree (analysis_date);

CREATE INDEX idx_hem_patient ON public.results_hematology USING btree (patient_id);

CREATE INDEX idx_hem_verified ON public.results_hematology USING btree (is_verified);

CREATE INDEX idx_histo_patient ON public.results_histopathology USING btree (patient_id);

CREATE INDEX idx_invoices_created ON public.invoices USING btree (created_at);

CREATE INDEX idx_invoices_date ON public.invoices USING btree (invoice_date);

CREATE INDEX idx_invoices_no ON public.invoices USING btree (invoice_no);

CREATE INDEX idx_invoices_patient ON public.invoices USING btree (patient_id);

CREATE INDEX idx_invoices_shift ON public.invoices USING btree (shift_id);

CREATE INDEX idx_invoices_status ON public.invoices USING btree (payment_status);

CREATE INDEX idx_micro_date ON public.results_microbiology USING btree (analysis_date);

CREATE INDEX idx_micro_patient ON public.results_microbiology USING btree (patient_id);

CREATE INDEX idx_micro_verified ON public.results_microbiology USING btree (is_verified);

CREATE INDEX idx_orders_admission ON public.doctor_orders USING btree (admission_id);

CREATE INDEX idx_orders_patient ON public.doctor_orders USING btree (patient_id);

CREATE INDEX idx_orders_status ON public.doctor_orders USING btree (status);

CREATE INDEX idx_orders_type ON public.doctor_orders USING btree (order_type);

CREATE INDEX idx_patients_created ON public.patients USING btree (created_at);

CREATE INDEX idx_patients_destination ON public.patients USING btree (visit_destination);

CREATE INDEX idx_patients_lab_no ON public.patients USING btree (lab_no);

CREATE INDEX idx_patients_master_phone ON public.patients_master USING btree (phone);

CREATE INDEX idx_patients_mrn ON public.patients USING btree (mrn);

CREATE INDEX idx_patients_name ON public.patients USING btree (name);

CREATE INDEX idx_patients_payment ON public.patients USING btree (payment_status);

CREATE INDEX idx_patients_type ON public.patients USING btree (patient_type);

CREATE UNIQUE INDEX idx_patients_visit_no ON public.patients USING btree (visit_no) WHERE (visit_no IS NOT NULL);

CREATE INDEX idx_payments_invoice ON public.payments USING btree (invoice_id);

CREATE INDEX idx_payments_shift ON public.payments USING btree (shift_id);

CREATE INDEX idx_pcr_date ON public.results_pcr USING btree (analysis_date);

CREATE INDEX idx_pcr_patient ON public.results_pcr USING btree (patient_id);

CREATE INDEX idx_prescriptions_pt ON public.prescriptions USING btree (patient_id);

CREATE INDEX idx_price_category ON public.price_list USING btree (category);

CREATE INDEX idx_price_code ON public.price_list USING btree (code);

CREATE INDEX idx_rad_patient ON public.radiology_requests USING btree (patient_id);

CREATE INDEX idx_rad_status ON public.radiology_requests USING btree (status);

CREATE INDEX idx_radreq_patient ON public.radiology_requests USING btree (patient_id);

CREATE INDEX idx_radreq_reported ON public.radiology_requests USING btree (reported_at);

CREATE INDEX idx_radreq_status ON public.radiology_requests USING btree (status);

CREATE UNIQUE INDEX idx_reception_shifts_one_active_per_staff ON public.reception_shifts USING btree (staff_id) WHERE (status = 'active'::text);

CREATE INDEX idx_reception_shifts_opened_at ON public.reception_shifts USING btree (opened_at DESC);

CREATE INDEX idx_reception_shifts_staff ON public.reception_shifts USING btree (staff_id);

CREATE INDEX idx_reception_shifts_status ON public.reception_shifts USING btree (status);

CREATE INDEX idx_samples_patient ON public.sample_records USING btree (patient_id);

CREATE INDEX idx_samples_status ON public.sample_records USING btree (status);

CREATE INDEX idx_sero_date ON public.results_serology USING btree (analysis_date);

CREATE INDEX idx_sero_patient ON public.results_serology USING btree (patient_id);

CREATE INDEX idx_sero_verified ON public.results_serology USING btree (is_verified);

CREATE INDEX idx_staff_role ON public.staff USING btree (role);

CREATE INDEX idx_staff_status ON public.staff USING btree (status);

CREATE INDEX idx_theatre_date ON public.theatre_bookings USING btree (theatre_date);

CREATE INDEX idx_theatre_patient ON public.theatre_bookings USING btree (patient_id);

CREATE INDEX idx_theatre_room ON public.theatre_bookings USING btree (theatre_room);

CREATE INDEX idx_theatre_status ON public.theatre_bookings USING btree (status);

CREATE INDEX idx_validation_results_study ON public.validation_results USING btree (study_id, calculated_at DESC);

CREATE INDEX idx_validation_samples_study ON public.validation_samples USING btree (study_id, run_number, replicate_number);

CREATE INDEX idx_validation_studies_analyte ON public.validation_studies USING btree (analyte, created_at DESC);

CREATE INDEX idx_vitals_admission ON public.vital_signs USING btree (admission_id);

CREATE INDEX idx_vitals_patient ON public.vital_signs USING btree (patient_id);

CREATE INDEX idx_vitals_recorded ON public.vital_signs USING btree (recorded_at);

CREATE INDEX idx_wallet_txn_patient ON public.wallet_transactions USING btree (patient_id);

CREATE INDEX idx_wallet_txn_wallet ON public.wallet_transactions USING btree (wallet_id);

CREATE INDEX instrument_messages_created_at_idx ON public.instrument_messages USING btree (created_at DESC);

CREATE INDEX instrument_messages_patient_idx ON public.instrument_messages USING btree (patient_id);

CREATE INDEX inventory_batches_expiry_idx ON public.inventory_batches USING btree (expiry_date);

CREATE INDEX inventory_batches_item_idx ON public.inventory_batches USING btree (item_id);

CREATE INDEX lab_reference_ranges_dept_idx ON public.lab_reference_ranges USING btree (dept_key);

CREATE INDEX lab_result_history_mrn_idx ON public.lab_result_history USING btree (mrn, saved_at DESC);

CREATE INDEX lab_result_history_patient_idx ON public.lab_result_history USING btree (patient_id, saved_at DESC);

CREATE INDEX lab_result_history_patient_test_idx ON public.lab_result_history USING btree (patient_id, test_code, saved_at DESC);

CREATE INDEX patients_doctor_id_idx ON public.patients USING btree (doctor_id);

CREATE INDEX purchase_order_items_po_idx ON public.purchase_order_items USING btree (po_id);

CREATE INDEX reagent_inventory_barcode_idx ON public.reagent_inventory USING btree (barcode);

CREATE INDEX reagent_inventory_department_idx ON public.reagent_inventory USING btree (department);

CREATE INDEX results_chemistry_history_patient_idx ON public.results_chemistry_history USING btree (patient_id, recorded_at DESC);

CREATE INDEX results_hematology_history_patient_idx ON public.results_hematology_history USING btree (patient_id, recorded_at DESC);

CREATE INDEX sample_records_patient_id_created_at_idx ON public.sample_records USING btree (patient_id, created_at DESC);

CREATE INDEX sample_records_patient_id_idx ON public.sample_records USING btree (patient_id);

CREATE INDEX sms_log_created_at_idx ON public.sms_log USING btree (created_at DESC);

CREATE INDEX sms_log_patient_idx ON public.sms_log USING btree (patient_id);

CREATE INDEX stock_requisitions_created_at_idx ON public.stock_requisitions USING btree (created_at DESC);

CREATE INDEX stock_requisitions_status_idx ON public.stock_requisitions USING btree (status);
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bed_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_donors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_issue_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_transfusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.critical_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delta_check_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discharge_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.id_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.infection_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instrument_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_reference_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_result_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_op_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_token_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radiology_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reagent_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results_chemistry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results_chemistry_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results_cytology ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results_hematology ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results_hematology_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results_histopathology ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results_microbiology ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results_pcr ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results_serology ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sample_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theatre_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validation_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validation_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vital_signs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ward_handover_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.who_safety_checklist ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_staff_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.staff where user_id = auth.uid() limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_staff_role() = 'admin';
$function$
;

CREATE OR REPLACE FUNCTION public.is_billing_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_staff_role() in ('receptionist','cashier');
$function$
;

CREATE OR REPLACE FUNCTION public.is_clinical_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_staff_role() in
    ('doctor','nurse','lab_tech','lab_supervisor','radiologist','theatre_nurse');
$function$
;

CREATE OR REPLACE FUNCTION public.is_inventory_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_staff_role() in
    ('nurse','lab_tech','lab_supervisor','theatre_nurse','radiologist');
$function$
;

CREATE OR REPLACE FUNCTION public.is_lab_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_staff_role() in ('lab_tech','lab_supervisor');
$function$
;

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(p_patient_id uuid, p_type text, p_amount numeric, p_reference_invoice_id uuid DEFAULT NULL::uuid, p_shift_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS wallet_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wallet public.patient_wallets;
  v_new_balance numeric(14,2);
  v_txn public.wallet_transactions;
  v_staff_id uuid;
  v_staff_name text;
begin
  if p_amount <= 0 then
    raise exception 'Wallet transaction amount must be positive';
  end if;
  if p_type not in ('credit','debit','refund') then
    raise exception 'Invalid wallet transaction type: %', p_type;
  end if;

  select id, full_name into v_staff_id, v_staff_name
  from public.staff where user_id = auth.uid();

  select * into v_wallet from public.patient_wallets
    where patient_id = p_patient_id for update;

  if not found then
    insert into public.patient_wallets (patient_id, balance)
    values (p_patient_id, 0)
    returning * into v_wallet;
  end if;

  if p_type = 'debit' then
    if v_wallet.balance < p_amount then
      raise exception 'Insufficient wallet balance: available %, requested %', v_wallet.balance, p_amount;
    end if;
    v_new_balance := v_wallet.balance - p_amount;
  else
    v_new_balance := v_wallet.balance + p_amount;
  end if;

  update public.patient_wallets
    set balance = v_new_balance, updated_at = now()
    where id = v_wallet.id;

  insert into public.wallet_transactions (
    wallet_id, patient_id, type, amount, balance_after,
    reference_invoice_id, shift_id, performed_by, performed_by_name, notes
  ) values (
    v_wallet.id, p_patient_id, p_type, p_amount, v_new_balance,
    p_reference_invoice_id, p_shift_id, v_staff_id, v_staff_name, p_notes
  ) returning * into v_txn;

  return v_txn;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_result_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  acting_role text;
begin
  if (old.is_verified is true or old.is_released is true) then
    select role into acting_role from staff where user_id = auth.uid();
    if acting_role is distinct from 'admin' and acting_role is distinct from 'lab_supervisor' then
      raise exception 'This result has been % and is locked. Only an Admin or Department Head can edit it.',
        case when old.is_released then 'released' else 'verified' end
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_shift_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  if new.shift_id is null then
    return new;
  end if;
  select status into v_status from public.reception_shifts where id = new.shift_id;
  if v_status = 'closed' then
    raise exception 'Shift % is closed — no further billing entries may be added to it', new.shift_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_next_id(id_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  seq_name text;
  cur_val bigint;
  data_max int;
  next_val bigint;
begin
  seq_name := case id_type
      when 'opd' then 'opd_seq'
      when 'ip'  then 'ip_seq'
      when 'lab_number' then 'lab_seq'
      when 'radiology_number' then 'rad_seq'
      when 'mrn' then 'mrn_seq'
      else null
    end;
  if seq_name is null then
    raise exception 'Unknown id_type: %', id_type;
  end if;

  data_max := case id_type
      when 'opd' then (
        select coalesce(max(visit_no::int),0) from patients
        where visit_no ~ '^[0-9]+$' and visit_no::int < 1000000 and patient_type <> 'Inpatient')
      when 'ip' then (
        select coalesce(max(v),0) from (
          select visit_no::int as v from patients
          where visit_no ~ '^[0-9]+$' and visit_no::int < 1000000 and patient_type = 'Inpatient'
          union all
          select ip_no::int as v from admissions
          where ip_no ~ '^[0-9]+$' and ip_no::int < 1000000
        ) x)
      when 'lab_number' then (
        select coalesce(max(lab_no::int),0) from patients
        where lab_no ~ '^[0-9]+$' and lab_no::int < 1000000)
      when 'radiology_number' then (
        select coalesce(max(radiology_no::int),0) from radiology_requests
        where radiology_no ~ '^[0-9]+$' and radiology_no::int < 1000000)
      when 'mrn' then (
        select coalesce(max(mrn::int),0) from patients_master
        where mrn ~ '^[0-9]+$' and mrn::int < 1000000)
      else 0
    end;

  select last_value into cur_val from pg_sequences where schemaname='public' and sequencename=seq_name;
  if data_max > cur_val then
    perform setval(seq_name, data_max, true);
  end if;

  next_val := nextval(seq_name);
  return next_val::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_queue_token(p_prefix text DEFAULT 'LAB'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_num int;
begin
  insert into public.queue_token_counters (token_date, prefix, last_number)
  values (current_date, p_prefix, 1)
  on conflict (token_date, prefix)
  do update set last_number = public.queue_token_counters.last_number + 1
  returning last_number into v_num;

  return p_prefix || '-' || lpad(v_num::text, 3, '0');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_audit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;

  insert into public.audit_logs (
    table_name, record_id, patient_id, action,
    changed_by, changed_by_role, old_data, new_data
  ) values (
    TG_TABLE_NAME,
    v_row ->> 'id',
    v_row ->> 'patient_id',
    TG_OP,
    auth.uid(),
    public.current_staff_role(),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP = 'UPDATE' then to_jsonb(NEW) end
  );

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_override_pin(p_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff_id uuid;
  v_role text;
begin
  select id, role into v_staff_id, v_role from public.staff where user_id = auth.uid();
  if v_staff_id is null then
    raise exception 'No staff record linked to this account';
  end if;
  if v_role <> 'admin' then
    raise exception 'Only an admin may set an override PIN';
  end if;
  if p_pin is null or length(p_pin) < 6 then
    raise exception 'PIN must be at least 6 digits';
  end if;
  if p_pin !~ '^[0-9]+$' then
    raise exception 'PIN must be numeric only';
  end if;

  update public.staff set override_pin_hash = crypt(p_pin, gen_salt('bf')) where id = v_staff_id;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_override_pin(p_pin text)
 RETURNS TABLE(admin_id uuid, admin_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
    select s.id, s.full_name
    from public.staff s
    where s.role = 'admin'
      and s.override_pin_hash is not null
      and s.override_pin_hash = crypt(p_pin, s.override_pin_hash)
    limit 1;
end;
$function$
;

CREATE TRIGGER audit_doctor_consultations AFTER DELETE OR UPDATE ON public.doctor_consultations FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_results_chemistry AFTER DELETE OR UPDATE ON public.results_chemistry FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_results_cytology AFTER DELETE OR UPDATE ON public.results_cytology FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_results_hematology AFTER DELETE OR UPDATE ON public.results_hematology FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_results_histopathology AFTER DELETE OR UPDATE ON public.results_histopathology FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_results_microbiology AFTER DELETE OR UPDATE ON public.results_microbiology FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_results_pcr AFTER DELETE OR UPDATE ON public.results_pcr FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_results_serology AFTER DELETE OR UPDATE ON public.results_serology FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER trg_invoices_shift_lock BEFORE INSERT OR UPDATE OF shift_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION enforce_shift_lock();
CREATE TRIGGER trg_lock_results_chemistry BEFORE UPDATE ON public.results_chemistry FOR EACH ROW EXECUTE FUNCTION enforce_result_lock();
CREATE TRIGGER trg_lock_results_cytology BEFORE UPDATE ON public.results_cytology FOR EACH ROW EXECUTE FUNCTION enforce_result_lock();
CREATE TRIGGER trg_lock_results_hematology BEFORE UPDATE ON public.results_hematology FOR EACH ROW EXECUTE FUNCTION enforce_result_lock();
CREATE TRIGGER trg_lock_results_histopathology BEFORE UPDATE ON public.results_histopathology FOR EACH ROW EXECUTE FUNCTION enforce_result_lock();
CREATE TRIGGER trg_lock_results_microbiology BEFORE UPDATE ON public.results_microbiology FOR EACH ROW EXECUTE FUNCTION enforce_result_lock();
CREATE TRIGGER trg_lock_results_pcr BEFORE UPDATE ON public.results_pcr FOR EACH ROW EXECUTE FUNCTION enforce_result_lock();
CREATE TRIGGER trg_lock_results_serology BEFORE UPDATE ON public.results_serology FOR EACH ROW EXECUTE FUNCTION enforce_result_lock();
CREATE TRIGGER trg_payments_shift_lock BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION enforce_shift_lock();

-- Defensive: some Supabase Dashboard options create an event trigger of
-- this same name before this file ever runs, which would otherwise fail
-- the CREATE EVENT TRIGGER below with "event trigger ensure_rls already
-- exists" (confirmed live 2026-08-26 on a genuinely new project where a
-- Dashboard option had been toggled before running this schema). Dropping
-- it first makes this file idempotent regardless of what a project's
-- Dashboard already set up.
DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') EXECUTE FUNCTION rls_auto_enable();
CREATE POLICY admissions_delete ON public.admissions AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY admissions_insert ON public.admissions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY admissions_select ON public.admissions AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY admissions_update ON public.admissions AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY auth_all_admissions ON public.admissions AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY app_audit_logs_insert ON public.app_audit_logs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff() OR is_lab_staff()));
CREATE POLICY app_audit_logs_select ON public.app_audit_logs AS PERMISSIVE FOR SELECT TO public USING (is_admin());
CREATE POLICY appointments_delete ON public.appointments AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY appointments_insert ON public.appointments AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = 'receptionist'::text)));
CREATE POLICY appointments_select ON public.appointments AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = 'receptionist'::text)));
CREATE POLICY appointments_update ON public.appointments AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = 'receptionist'::text))) WITH CHECK ((is_admin() OR (current_staff_role() = 'receptionist'::text)));
CREATE POLICY auth_all_appointments ON public.appointments AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY audit_logs_admin_select ON public.audit_logs AS PERMISSIVE FOR SELECT TO public USING (is_admin());
CREATE POLICY bed_transfers_insert ON public.bed_transfers AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY bed_transfers_select ON public.bed_transfers AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY auth_all_beds ON public.beds AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY beds_delete ON public.beds AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY beds_insert ON public.beds AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_admin());
CREATE POLICY beds_select ON public.beds AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY beds_update ON public.beds AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY billing_audit_insert ON public.billing_audit_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY billing_audit_select ON public.billing_audit_logs AS PERMISSIVE FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY blood_donations_insert ON public.blood_donations AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY blood_donations_select ON public.blood_donations AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY blood_donations_update ON public.blood_donations AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY blood_donors_insert ON public.blood_donors AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY blood_donors_select ON public.blood_donors AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY blood_donors_update ON public.blood_donors AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY blood_issue_log_insert ON public.blood_issue_log AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY blood_issue_log_select ON public.blood_issue_log AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY blood_requests_insert ON public.blood_requests AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY blood_requests_select ON public.blood_requests AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY blood_requests_update ON public.blood_requests AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY blood_transfusions_insert ON public.blood_transfusions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY blood_transfusions_select ON public.blood_transfusions AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY blood_transfusions_update ON public.blood_transfusions AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_clinical_staff())) WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY blood_units_insert ON public.blood_units AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY blood_units_select ON public.blood_units AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY blood_units_update ON public.blood_units AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_clinical_staff())) WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY consent_forms_insert ON public.consent_forms AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY consent_forms_select ON public.consent_forms AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY auth_all_criticals ON public.critical_values AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY critical_values_delete ON public.critical_values AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY critical_values_insert ON public.critical_values AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY critical_values_select ON public.critical_values AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'lab_tech'::text, 'lab_supervisor'::text, 'theatre_nurse'::text]))));
CREATE POLICY critical_values_update ON public.critical_values AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'lab_tech'::text, 'lab_supervisor'::text, 'theatre_nurse'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'lab_tech'::text, 'lab_supervisor'::text, 'theatre_nurse'::text]))));
CREATE POLICY delta_check_log_insert ON public.delta_check_log AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['lab_tech'::text, 'lab_supervisor'::text]))));
CREATE POLICY delta_check_log_select ON public.delta_check_log AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['lab_tech'::text, 'lab_supervisor'::text]))));
CREATE POLICY auth_all_discharge ON public.discharge_summaries AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY discharge_summaries_delete ON public.discharge_summaries AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY discharge_summaries_insert ON public.discharge_summaries AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY discharge_summaries_select ON public.discharge_summaries AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY discharge_summaries_update ON public.discharge_summaries AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY auth_all_consult ON public.doctor_consultations AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_consultations ON public.doctor_consultations AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY doctor_consultations_delete ON public.doctor_consultations AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY doctor_consultations_insert ON public.doctor_consultations AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = 'doctor'::text)));
CREATE POLICY doctor_consultations_select ON public.doctor_consultations AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY doctor_consultations_update ON public.doctor_consultations AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = 'doctor'::text))) WITH CHECK ((is_admin() OR (current_staff_role() = 'doctor'::text)));
CREATE POLICY auth_all_orders ON public.doctor_orders AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY doctor_orders_delete ON public.doctor_orders AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY doctor_orders_insert ON public.doctor_orders AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = 'doctor'::text)));
CREATE POLICY doctor_orders_select ON public.doctor_orders AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY doctor_orders_update ON public.doctor_orders AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text]))));
CREATE POLICY auth_all_doctors ON public.doctors AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY doctors_delete ON public.doctors AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY doctors_insert ON public.doctors AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = 'lab_supervisor'::text)));
CREATE POLICY doctors_select ON public.doctors AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff() OR is_billing_staff()));
CREATE POLICY doctors_update ON public.doctors AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = 'lab_supervisor'::text))) WITH CHECK ((is_admin() OR (current_staff_role() = 'lab_supervisor'::text)));
CREATE POLICY follow_ups_insert ON public.follow_ups AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = 'doctor'::text)));
CREATE POLICY follow_ups_select ON public.follow_ups AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff() OR is_billing_staff()));
CREATE POLICY follow_ups_update ON public.follow_ups AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_billing_staff())) WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY id_counters_delete ON public.id_counters AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY id_counters_insert ON public.id_counters AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff() OR (current_staff_role() = 'receptionist'::text)));
CREATE POLICY id_counters_select ON public.id_counters AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff() OR (current_staff_role() = 'receptionist'::text)));
CREATE POLICY id_counters_update ON public.id_counters AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_clinical_staff() OR (current_staff_role() = 'receptionist'::text))) WITH CHECK ((is_admin() OR is_clinical_staff() OR (current_staff_role() = 'receptionist'::text)));
CREATE POLICY auth_all_infection ON public.infection_flags AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY infection_flags_delete ON public.infection_flags AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY infection_flags_insert ON public.infection_flags AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['nurse'::text, 'receptionist'::text]))));
CREATE POLICY infection_flags_select ON public.infection_flags AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['nurse'::text, 'receptionist'::text])) OR is_clinical_staff()));
CREATE POLICY infection_flags_update ON public.infection_flags AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['nurse'::text, 'receptionist'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['nurse'::text, 'receptionist'::text]))));
CREATE POLICY instrument_messages_insert ON public.instrument_messages AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['lab_tech'::text, 'lab_supervisor'::text]))));
CREATE POLICY instrument_messages_select ON public.instrument_messages AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['lab_tech'::text, 'lab_supervisor'::text]))));
CREATE POLICY instrument_messages_update ON public.instrument_messages AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['lab_tech'::text, 'lab_supervisor'::text]))));
CREATE POLICY inventory_batches_insert ON public.inventory_batches AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY inventory_batches_select ON public.inventory_batches AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY inventory_batches_update ON public.inventory_batches AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY auth_all_invoice_items ON public.invoice_items AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_all_invoices ON public.invoices AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY invoices_delete ON public.invoices AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY invoices_insert ON public.invoices AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY invoices_select ON public.invoices AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_billing_staff()));
CREATE POLICY invoices_update ON public.invoices AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_billing_staff())) WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY lab_reference_ranges_delete ON public.lab_reference_ranges AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY lab_reference_ranges_insert ON public.lab_reference_ranges AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_admin());
CREATE POLICY lab_reference_ranges_select ON public.lab_reference_ranges AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff() OR is_billing_staff()));
CREATE POLICY lab_reference_ranges_update ON public.lab_reference_ranges AS PERMISSIVE FOR UPDATE TO public USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY lab_result_history_insert ON public.lab_result_history AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY lab_result_history_select ON public.lab_result_history AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY auth_all_shifts ON public.lab_shifts AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY wallets_select ON public.patient_wallets AS PERMISSIVE FOR SELECT TO authenticated USING ((is_admin() OR is_billing_staff()));
CREATE POLICY auth_all_patients ON public.patients AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY patients_master_delete ON public.patients_master AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY patients_master_insert ON public.patients_master AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY patients_master_select ON public.patients_master AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_billing_staff()));
CREATE POLICY patients_master_update ON public.patients_master AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_billing_staff())) WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY patients_delete ON public.patients AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY patients_insert ON public.patients AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY patients_select ON public.patients AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff() OR is_billing_staff()));
CREATE POLICY patients_update ON public.patients AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_billing_staff() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text])))) WITH CHECK ((is_admin() OR is_billing_staff() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY payments_delete ON public.payments AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY payments_insert ON public.payments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY payments_select ON public.payments AS PERMISSIVE FOR SELECT TO authenticated USING ((is_admin() OR is_billing_staff()));
CREATE POLICY payments_update ON public.payments AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_admin() OR is_billing_staff())) WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY auth_all_preop ON public.pre_op_assessments AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY pre_op_assessments_delete ON public.pre_op_assessments AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY pre_op_assessments_insert ON public.pre_op_assessments AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'theatre_nurse'::text]))));
CREATE POLICY pre_op_assessments_select ON public.pre_op_assessments AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'theatre_nurse'::text]))));
CREATE POLICY pre_op_assessments_update ON public.pre_op_assessments AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'theatre_nurse'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'theatre_nurse'::text]))));
CREATE POLICY auth_all_rx ON public.prescriptions AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_prescriptions ON public.prescriptions AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY prescriptions_delete ON public.prescriptions AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY prescriptions_insert ON public.prescriptions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = 'doctor'::text)));
CREATE POLICY prescriptions_select ON public.prescriptions AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY prescriptions_update ON public.prescriptions AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = 'doctor'::text))) WITH CHECK ((is_admin() OR (current_staff_role() = 'doctor'::text)));
CREATE POLICY auth_all_prices ON public.price_list AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY price_list_delete ON public.price_list AS PERMISSIVE FOR DELETE TO public USING ((is_admin() OR is_billing_staff()));
CREATE POLICY price_list_insert ON public.price_list AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY price_list_select ON public.price_list AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff() OR is_billing_staff()));
CREATE POLICY price_list_update ON public.price_list AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_billing_staff())) WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY purchase_order_items_insert ON public.purchase_order_items AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY purchase_order_items_select ON public.purchase_order_items AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY purchase_orders_insert ON public.purchase_orders AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY purchase_orders_select ON public.purchase_orders AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY purchase_orders_update ON public.purchase_orders AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_qclots ON public.qc_lots AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY qc_lots_delete ON public.qc_lots AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY qc_lots_insert ON public.qc_lots AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY qc_lots_select ON public.qc_lots AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY qc_lots_update ON public.qc_lots AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_qcresults ON public.qc_results AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY qc_results_delete ON public.qc_results AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY qc_results_insert ON public.qc_results AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY qc_results_select ON public.qc_results AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY qc_results_update ON public.qc_results AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY queue_counters_select ON public.queue_token_counters AS PERMISSIVE FOR SELECT TO authenticated USING ((is_admin() OR is_billing_staff()));
CREATE POLICY auth_all_radiology ON public.radiology_requests AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY radiology_requests_delete ON public.radiology_requests AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY radiology_requests_insert ON public.radiology_requests AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'radiologist'::text]))));
CREATE POLICY radiology_requests_select ON public.radiology_requests AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY radiology_requests_update ON public.radiology_requests AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'radiologist'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'radiologist'::text]))));
CREATE POLICY auth_all_inventory ON public.reagent_inventory AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY reagent_inventory_delete ON public.reagent_inventory AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY reagent_inventory_insert ON public.reagent_inventory AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_inventory_staff()));
CREATE POLICY reagent_inventory_select ON public.reagent_inventory AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff() OR is_billing_staff()));
CREATE POLICY reagent_inventory_update ON public.reagent_inventory AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_inventory_staff())) WITH CHECK ((is_admin() OR is_inventory_staff()));
CREATE POLICY shifts_delete ON public.reception_shifts AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY shifts_insert ON public.reception_shifts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_admin() OR is_billing_staff()));
CREATE POLICY shifts_select ON public.reception_shifts AS PERMISSIVE FOR SELECT TO authenticated USING ((is_admin() OR is_billing_staff()));
CREATE POLICY shifts_update ON public.reception_shifts AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_admin() OR (is_billing_staff() AND (staff_id IN ( SELECT staff.id FROM staff WHERE (staff.user_id = auth.uid())))))) WITH CHECK ((is_admin() OR (is_billing_staff() AND (staff_id IN ( SELECT staff.id FROM staff WHERE (staff.user_id = auth.uid()))))));
CREATE POLICY auth_all_chem ON public.results_chemistry AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY results_chemistry_history_insert ON public.results_chemistry_history AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY results_chemistry_history_select ON public.results_chemistry_history AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY results_chemistry_delete ON public.results_chemistry AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY results_chemistry_insert ON public.results_chemistry AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY results_chemistry_select ON public.results_chemistry AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY results_chemistry_update ON public.results_chemistry AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_cyto ON public.results_cytology AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY results_cytology_delete ON public.results_cytology AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY results_cytology_insert ON public.results_cytology AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY results_cytology_select ON public.results_cytology AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY results_cytology_update ON public.results_cytology AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_hem ON public.results_hematology AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY results_hematology_history_insert ON public.results_hematology_history AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY results_hematology_history_select ON public.results_hematology_history AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY results_hematology_delete ON public.results_hematology AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY results_hematology_insert ON public.results_hematology AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY results_hematology_select ON public.results_hematology AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY results_hematology_update ON public.results_hematology AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_histo ON public.results_histopathology AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY results_histopathology_delete ON public.results_histopathology AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY results_histopathology_insert ON public.results_histopathology AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY results_histopathology_select ON public.results_histopathology AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY results_histopathology_update ON public.results_histopathology AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_micro ON public.results_microbiology AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY results_microbiology_delete ON public.results_microbiology AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY results_microbiology_insert ON public.results_microbiology AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY results_microbiology_select ON public.results_microbiology AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY results_microbiology_update ON public.results_microbiology AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_pcr ON public.results_pcr AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY results_pcr_delete ON public.results_pcr AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY results_pcr_insert ON public.results_pcr AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY results_pcr_select ON public.results_pcr AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY results_pcr_update ON public.results_pcr AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_sero ON public.results_serology AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY results_serology_delete ON public.results_serology AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY results_serology_insert ON public.results_serology AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY results_serology_select ON public.results_serology AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY results_serology_update ON public.results_serology AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_samples ON public.sample_records AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY sample_records_delete ON public.sample_records AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY sample_records_insert ON public.sample_records AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'lab_tech'::text, 'lab_supervisor'::text]))));
CREATE POLICY sample_records_select ON public.sample_records AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff() OR (current_staff_role() = 'receptionist'::text)));
CREATE POLICY sample_records_update ON public.sample_records AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'lab_tech'::text, 'lab_supervisor'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'lab_tech'::text, 'lab_supervisor'::text]))));
CREATE POLICY auth_all_settings ON public.settings AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY sms_log_delete ON public.sms_log AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY sms_log_insert ON public.sms_log AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff() OR is_billing_staff()));
CREATE POLICY sms_log_select ON public.sms_log AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['lab_tech'::text, 'lab_supervisor'::text]))));
CREATE POLICY auth_all_staff ON public.staff AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY staff_admin_all ON public.staff AS PERMISSIVE FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_self_select ON public.staff AS PERMISSIVE FOR SELECT TO public USING ((user_id = auth.uid()));
CREATE POLICY staff_supervisor_select ON public.staff AS PERMISSIVE FOR SELECT TO public USING ((current_staff_role() = 'lab_supervisor'::text));
CREATE POLICY stock_requisitions_insert ON public.stock_requisitions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY stock_requisitions_select ON public.stock_requisitions AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY stock_requisitions_update ON public.stock_requisitions AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = 'lab_supervisor'::text)));
CREATE POLICY auth_all_theatre ON public.theatre_bookings AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY theatre_bookings_delete ON public.theatre_bookings AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY theatre_bookings_insert ON public.theatre_bookings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'theatre_nurse'::text]))));
CREATE POLICY theatre_bookings_select ON public.theatre_bookings AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'theatre_nurse'::text]))));
CREATE POLICY theatre_bookings_update ON public.theatre_bookings AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'theatre_nurse'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'theatre_nurse'::text]))));
CREATE POLICY validation_results_insert ON public.validation_results AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY validation_results_select ON public.validation_results AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY validation_results_update ON public.validation_results AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY validation_samples_insert ON public.validation_samples AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY validation_samples_select ON public.validation_samples AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY validation_studies_insert ON public.validation_studies AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY validation_studies_select ON public.validation_studies AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_lab_staff()));
CREATE POLICY validation_studies_update ON public.validation_studies AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_lab_staff())) WITH CHECK ((is_admin() OR is_lab_staff()));
CREATE POLICY auth_all_vital_signs ON public.vital_signs AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY vital_signs_delete ON public.vital_signs AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY vital_signs_insert ON public.vital_signs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY vital_signs_select ON public.vital_signs AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY vital_signs_update ON public.vital_signs AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text])))) WITH CHECK ((is_admin() OR (current_staff_role() = ANY (ARRAY['doctor'::text, 'nurse'::text, 'theatre_nurse'::text]))));
CREATE POLICY wallet_txn_select ON public.wallet_transactions AS PERMISSIVE FOR SELECT TO authenticated USING ((is_admin() OR is_billing_staff()));
CREATE POLICY auth_all_handover ON public.ward_handover_notes AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY ward_handover_notes_delete ON public.ward_handover_notes AS PERMISSIVE FOR DELETE TO public USING (is_admin());
CREATE POLICY ward_handover_notes_insert ON public.ward_handover_notes AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR (current_staff_role() = 'nurse'::text)));
CREATE POLICY ward_handover_notes_select ON public.ward_handover_notes AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (current_staff_role() = 'nurse'::text)));
CREATE POLICY ward_handover_notes_update ON public.ward_handover_notes AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR (current_staff_role() = 'nurse'::text))) WITH CHECK ((is_admin() OR (current_staff_role() = 'nurse'::text)));
CREATE POLICY who_safety_checklist_insert ON public.who_safety_checklist AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_admin() OR is_clinical_staff()));
CREATE POLICY who_safety_checklist_select ON public.who_safety_checklist AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR is_clinical_staff()));
CREATE POLICY who_safety_checklist_update ON public.who_safety_checklist AS PERMISSIVE FOR UPDATE TO public USING ((is_admin() OR is_clinical_staff())) WITH CHECK ((is_admin() OR is_clinical_staff()));


-- #############################################################################
-- ## migration_v2.8_rls_security.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.8_rls_security.sql
-- Row-Level Security hardening + audit logging
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHO THIS IS FOR
--   Run this in the Supabase SQL editor against a project that already has
--   the v1 base schema + migration_v2 / v2.2 / v2.4 / v2.5 / v2.6 changes
--   applied (see CHANGELOG.md). This migration assumes those tables exist
--   with (at minimum) the columns the app reads/writes — this file was
--   written by reverse-engineering every sb.from(...) call in index.html,
--   since no schema .sql files ship in this checkout (see CLAUDE.md).
--
-- WHY THIS MATTERS
--   index.html enforces role access (ROLE_PAGES / goPage / filterSidebar)
--   entirely client-side, for UX only. Anyone with the anon key (which is
--   public by design — it ships in every deployment's localStorage) can
--   call the Supabase REST API directly and bypass every client-side
--   check. RLS is the ONLY real access boundary for this app. Before this
--   migration, none of the tables below have RLS enabled, so ANY
--   authenticated user (any staff login) can read/write ANY row in ANY
--   of them.
--
-- SCOPE
--   RLS is enabled on the tables explicitly requested:
--     patients_master, patients, admissions, results_hematology,
--     results_chemistry, results_serology, results_microbiology,
--     results_pcr, results_histopathology, results_cytology,
--     invoices, doctor_consultations, critical_values, radiology_requests
--
--   Two tables NOT on that list are also locked down here, and flagged
--   clearly below, because leaving them open defeats the point of doing
--   this at all:
--     - staff:          this is the table every policy in this file reads
--                        (staff.role where staff.user_id = auth.uid()).
--                        Without RLS on staff itself, any logged-in user
--                        could UPDATE their own row and grant themselves
--                        role='admin', or read every other staff member's
--                        row. This is not optional.
--     - sample_records:  holds patient_id + specimen collection status,
--                        read across nearly every lab/nursing page and
--                        written during sample collection/order placement.
--                        Left it open == an unauth'd gap right next to the
--                        results_* tables it feeds. If you'd rather ship
--                        this migration without touching it, delete
--                        Section 6 below; nothing else in this file
--                        depends on it.
--
-- ROLE MODEL
--   This is a staff-only system — patients never authenticate against
--   Supabase, so there is no "patient self-access" policy anywhere here.
--   Every policy below resolves the acting user's role via:
--       staff.role where staff.user_id = auth.uid()
--   using the public.current_staff_role() helper defined in Section 1.
--   The 9 roles match ROLE_PAGES in index.html exactly: admin, doctor,
--   nurse, lab_tech, lab_supervisor, receptionist, cashier,
--   theatre_nurse, radiologist.
--
-- DESIGN NOTES / JUDGMENT CALLS (read before you apply this)
--   1. "Relevant to their department" was interpreted using the app's own
--      ROLE_PAGES access matrix, not a stricter per-lab-department split.
--      lab_tech and lab_supervisor already get the cross-department
--      "All Results" viewer and doctor/nurse/radiologist/theatre_nurse
--      already get the cross-department "Patient History Timeline" —
--      so all six clinical roles get SELECT across all results_*,
--      critical_values (except radiologist — see #2), doctor_consultations,
--      and radiology_requests. What's actually fenced off is the
--      billing/front-desk boundary the requirements called out explicitly:
--      receptionist/cashier get zero access to any of that clinical
--      content, full stop.
--   2. critical_values SELECT deliberately excludes radiologist — ROLE_PAGES
--      does not grant radiologist the 'criticals' page; a radiologist's own
--      critical findings live on radiology_requests.is_critical instead.
--   3. WRITE access to results_*/critical_values/sample_records is
--      restricted to lab_tech + lab_supervisor + admin, matching who
--      ROLE_PAGES actually grants the *-entry / unified-entry pages to.
--      doctor_consultations WRITE is doctor + admin only (ROLE_PAGES:
--      only 'doctor' and 'admin' have the 'consultation' page).
--      radiology_requests WRITE is doctor + radiologist + admin (order
--      placement + report authoring).
--   4. DELETE on every clinical table is admin-only everywhere in this
--      file. This mirrors the app's own deletePatientRecord() guard
--      (currentProfile?.role !== 'admin' → refused client-side) — RLS now
--      backs that up server-side instead of trusting the client.
--   5. patients / patients_master intermix demographic AND clinical
--      fields (patients has diagnosis, tests_requested, etc. right next
--      to phone/name). Table-level RLS cannot separate "billing may see
--      the phone number but not the diagnosis" within the same row — the
--      requirement explicitly grants receptionist/cashier read/write on
--      `patients`, so that limitation is accepted here as a known gap.
--      If column-level separation ever becomes a hard compliance
--      requirement, the fix is a view or a table split, not RLS.
--   6. README.md's role/page table and the actual ROLE_PAGES object in
--      index.html have already drifted (e.g. README lists Nurse with
--      Samples/Handover/Infection access that ROLE_PAGES does not grant
--      today). This migration follows ROLE_PAGES (the code that's
--      actually enforced client-side) as the source of truth, not
--      README.md. Worth reconciling separately — not a schema problem.
--   7. `enforce_result_lock` (mentioned in the request) already exists on
--      the results_* tables per the project's own migration history.
--      This file does not read, replace, or depend on its definition —
--      Section 7 adds a separate, independent AFTER trigger per table for
--      audit logging, following the same "one small trigger function,
--      reused via CREATE TRIGGER per table" convention rather than
--      touching the existing lock trigger at all.
--
-- This migration is idempotent — every statement can be re-run safely.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — Role-lookup helper functions
-- ───────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER is required here: once RLS is enabled on `staff`
-- (Section 2), a plain `select role from staff where user_id = auth.uid()`
-- run from inside another table's policy would itself be subject to
-- staff's RLS policies — which would in turn call this function again,
-- recursing. SECURITY DEFINER makes the lookup run as the function owner
-- (bypassing RLS on staff for this one read), breaking that cycle. The
-- pinned search_path prevents the classic SECURITY DEFINER hijack via a
-- shadowing object earlier in a caller's search_path.

create or replace function public.current_staff_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.staff where user_id = auth.uid() limit 1;
$$;

comment on function public.current_staff_role() is
  'Returns the role of the currently authenticated staff member (staff.role where staff.user_id = auth.uid()), or NULL if unauthenticated / not linked to a staff row. SECURITY DEFINER to safely bypass RLS on staff for this single lookup.';

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() = 'admin';
$$;

create or replace function public.is_clinical_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() in
    ('doctor','nurse','lab_tech','lab_supervisor','radiologist','theatre_nurse');
$$;

create or replace function public.is_lab_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() in ('lab_tech','lab_supervisor');
$$;

create or replace function public.is_billing_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() in ('receptionist','cashier');
$$;

revoke execute on function public.current_staff_role() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_clinical_staff() from public;
revoke execute on function public.is_lab_staff() from public;
revoke execute on function public.is_billing_staff() from public;

grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_clinical_staff() to authenticated;
grant execute on function public.is_lab_staff() to authenticated;
grant execute on function public.is_billing_staff() to authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — staff  (not explicitly requested — see header note above)
-- ───────────────────────────────────────────────────────────────────────
-- Every other policy in this file depends on staff being readable enough
-- to resolve current_staff_role(), but NOT writable by non-admins — a
-- non-admin who could update their own `role` column would be a one-row
-- UPDATE away from becoming admin.
--
-- Critical: loadProfile() in index.html does
--   sb.from('staff').select('*').eq('user_id', currentUser.id).maybeSingle()
-- and FALLS BACK TO role:'admin' if that query errors or returns nothing.
-- If self-select were blocked, every login would silently become admin.
-- The staff_self_select policy below exists specifically to keep that
-- query working for every role.

alter table public.staff enable row level security;

drop policy if exists staff_self_select on public.staff;
create policy staff_self_select on public.staff
  for select
  using (user_id = auth.uid());

drop policy if exists staff_supervisor_select on public.staff;
create policy staff_supervisor_select on public.staff
  for select
  using (public.current_staff_role() = 'lab_supervisor');

drop policy if exists staff_admin_all on public.staff;
create policy staff_admin_all on public.staff
  for all
  using (public.is_admin())
  with check (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — patients_master  (registration / master identity index)
-- ───────────────────────────────────────────────────────────────────────
-- Only touched by the registration flow (dedup-by-mrn) and the admin
-- patient-deletion cascade. Clinical pages read `patients`, not this
-- table, day-to-day — so clinical roles get no access here at all.

alter table public.patients_master enable row level security;

drop policy if exists patients_master_select on public.patients_master;
create policy patients_master_select on public.patients_master
  for select
  using (public.is_admin() or public.is_billing_staff());

drop policy if exists patients_master_insert on public.patients_master;
create policy patients_master_insert on public.patients_master
  for insert
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists patients_master_update on public.patients_master;
create policy patients_master_update on public.patients_master
  for update
  using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists patients_master_delete on public.patients_master;
create policy patients_master_delete on public.patients_master
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 4 — patients  (per-visit record: read by virtually every page)
-- ───────────────────────────────────────────────────────────────────────
-- SELECT is intentionally broad: every department's worklist/queue/print
-- view joins this table for name/mrn/ward/etc. WRITE is scoped to the
-- roles that actually call .insert()/.update() on it in index.html:
-- registration + billing (receptionist/cashier/admin), and admission/
-- consultation updates (doctor/nurse/theatre_nurse). lab_tech,
-- lab_supervisor and radiologist never write to `patients` directly in
-- the app (they write results_*/radiology_requests instead), so they get
-- read-only here.

alter table public.patients enable row level security;

drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients
  for select
  using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients
  for insert
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists patients_update on public.patients;
create policy patients_update on public.patients
  for update
  using (
    public.is_admin() or public.is_billing_staff()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin() or public.is_billing_staff()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists patients_delete on public.patients;
create policy patients_delete on public.patients
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 5 — admissions
-- ───────────────────────────────────────────────────────────────────────
-- ROLE_PAGES grants the 'admission'/'theatre' pages only to admin,
-- doctor, nurse, theatre_nurse. Lab/radiology/billing roles get nothing.

alter table public.admissions enable row level security;

drop policy if exists admissions_select on public.admissions;
create policy admissions_select on public.admissions
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists admissions_insert on public.admissions;
create policy admissions_insert on public.admissions
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists admissions_update on public.admissions;
create policy admissions_update on public.admissions
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists admissions_delete on public.admissions;
create policy admissions_delete on public.admissions
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 6 — sample_records  (not explicitly requested — see header note)
-- ───────────────────────────────────────────────────────────────────────
-- Feeds the worklist (including receptionist's read-only worklist view),
-- nursing/lab collection screens, and TAT tracking. Write access mirrors
-- who actually calls .insert()/.update() on it: doctor (placing orders),
-- nurse (collection), lab_tech/lab_supervisor (receipt/rejection/status).

alter table public.sample_records enable row level security;

drop policy if exists sample_records_select on public.sample_records;
create policy sample_records_select on public.sample_records
  for select
  using (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  );

drop policy if exists sample_records_insert on public.sample_records;
create policy sample_records_insert on public.sample_records
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor')
  );

drop policy if exists sample_records_update on public.sample_records;
create policy sample_records_update on public.sample_records
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor')
  );

drop policy if exists sample_records_delete on public.sample_records;
create policy sample_records_delete on public.sample_records
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 7 — results_* (hematology, chemistry, serology, microbiology,
--                         pcr, histopathology, cytology)
-- ───────────────────────────────────────────────────────────────────────
-- SELECT: all six clinical roles (see Design Note #1) — never billing.
-- WRITE:  lab_tech + lab_supervisor + admin only, matching the app's own
--         ROLE_PAGES grants for the *-entry / unified-entry pages.
-- DELETE: admin only.
-- Note: enforce_result_lock (pre-existing) is untouched by this section.

do $$
declare
  t text;
  results_tables text[] := array[
    'results_hematology','results_chemistry','results_serology',
    'results_microbiology','results_pcr','results_histopathology',
    'results_cytology'
  ];
begin
  foreach t in array results_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select
        using (public.is_admin() or public.is_clinical_staff())
    $f$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($f$
      create policy %I on public.%I
        for insert
        with check (public.is_admin() or public.is_lab_staff())
    $f$, t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($f$
      create policy %I on public.%I
        for update
        using (public.is_admin() or public.is_lab_staff())
        with check (public.is_admin() or public.is_lab_staff())
    $f$, t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($f$
      create policy %I on public.%I
        for delete
        using (public.is_admin())
    $f$, t || '_delete', t);
  end loop;
end $$;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 8 — critical_values
-- ───────────────────────────────────────────────────────────────────────
-- SELECT excludes radiologist (see Design Note #2). INSERT is lab-only
-- (auto-flagged from results_hematology/results_chemistry saves via
-- logCriticalValues()). UPDATE covers acknowledgement, which any of the
-- clinical roles that can see the criticals page/banner may perform.

alter table public.critical_values enable row level security;

drop policy if exists critical_values_select on public.critical_values;
create policy critical_values_select on public.critical_values
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor','theatre_nurse')
  );

drop policy if exists critical_values_insert on public.critical_values;
create policy critical_values_insert on public.critical_values
  for insert
  with check (public.is_admin() or public.is_lab_staff());

drop policy if exists critical_values_update on public.critical_values;
create policy critical_values_update on public.critical_values
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','lab_tech','lab_supervisor','theatre_nurse')
  );

drop policy if exists critical_values_delete on public.critical_values;
create policy critical_values_delete on public.critical_values
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 9 — invoices  (billing only — zero clinical-role access)
-- ───────────────────────────────────────────────────────────────────────

alter table public.invoices enable row level security;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select
  using (public.is_admin() or public.is_billing_staff());

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update
  using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 10 — doctor_consultations  (SOAP notes — zero billing access)
-- ───────────────────────────────────────────────────────────────────────
-- WRITE is doctor + admin only — ROLE_PAGES grants the 'consultation'
-- page to no other role. SELECT is the broader clinical group because
-- the Patient History Timeline (pt-history), which every clinical role
-- has, surfaces these notes for continuity of care.

alter table public.doctor_consultations enable row level security;

drop policy if exists doctor_consultations_select on public.doctor_consultations;
create policy doctor_consultations_select on public.doctor_consultations
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists doctor_consultations_insert on public.doctor_consultations;
create policy doctor_consultations_insert on public.doctor_consultations
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists doctor_consultations_update on public.doctor_consultations;
create policy doctor_consultations_update on public.doctor_consultations
  for update
  using (public.is_admin() or public.current_staff_role() = 'doctor')
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists doctor_consultations_delete on public.doctor_consultations;
create policy doctor_consultations_delete on public.doctor_consultations
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 11 — radiology_requests
-- ───────────────────────────────────────────────────────────────────────
-- WRITE is doctor (order placement) + radiologist (report authoring) +
-- admin — matching ROLE_PAGES' 'radiology' page grant. SELECT is the
-- broader clinical group for the same pt-history continuity-of-care
-- reason as doctor_consultations above.

alter table public.radiology_requests enable row level security;

drop policy if exists radiology_requests_select on public.radiology_requests;
create policy radiology_requests_select on public.radiology_requests
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists radiology_requests_insert on public.radiology_requests;
create policy radiology_requests_insert on public.radiology_requests
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','radiologist')
  );

drop policy if exists radiology_requests_update on public.radiology_requests;
create policy radiology_requests_update on public.radiology_requests
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','radiologist')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','radiologist')
  );

drop policy if exists radiology_requests_delete on public.radiology_requests;
create policy radiology_requests_delete on public.radiology_requests
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 12 — Defense-in-depth: make sure `anon` has nothing here
-- ───────────────────────────────────────────────────────────────────────
-- No policy above grants anon anything (current_staff_role() is NULL for
-- an unauthenticated caller, so every "in (...)"/"= 'x'" check is false
-- and every USING/WITH CHECK clause evaluates to false or null). This is
-- an explicit belt-and-suspenders revoke on top of that, so a future
-- policy change can't accidentally open these tables to the anon key.

revoke all on
  public.staff, public.patients_master, public.patients, public.admissions,
  public.sample_records, public.results_hematology, public.results_chemistry,
  public.results_serology, public.results_microbiology, public.results_pcr,
  public.results_histopathology, public.results_cytology,
  public.critical_values, public.invoices, public.doctor_consultations,
  public.radiology_requests
from anon;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 13 — audit_logs + audit triggers
-- ───────────────────────────────────────────────────────────────────────
-- Logs every UPDATE/DELETE on doctor_consultations and every results_*
-- table: who (auth.uid() + resolved role), when, and the before/after
-- row as jsonb. record_id is stored as text so this works regardless of
-- whether a given table's primary key is uuid, bigint, or serial.
--
-- This is intentionally a separate AFTER trigger, not a modification of
-- enforce_result_lock (a pre-existing BEFORE trigger per the project's
-- migration history that this file was told not to replace). AFTER
-- trigger return values are ignored by Postgres, so this can never
-- interfere with whatever enforce_result_lock decides to allow or block.

create table if not exists public.audit_logs (
  id            bigint generated always as identity primary key,
  table_name    text not null,
  record_id     text,
  patient_id    text,
  action        text not null check (action in ('UPDATE','DELETE')),
  changed_by    uuid,
  changed_by_role text,
  old_data      jsonb,
  new_data      jsonb,
  changed_at    timestamptz not null default now()
);

create index if not exists audit_logs_table_record_idx
  on public.audit_logs (table_name, record_id);
create index if not exists audit_logs_patient_idx
  on public.audit_logs (patient_id);
create index if not exists audit_logs_changed_at_idx
  on public.audit_logs (changed_at desc);

alter table public.audit_logs enable row level security;

-- Read-only, admin-only. Deliberately NO insert/update/delete policy for
-- any role — the only path into this table is the SECURITY DEFINER
-- trigger function below, which bypasses RLS as the function owner. If
-- application code ever needs to insert/update/delete this table
-- directly, that's a bug, not a missing policy.
drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs
  for select
  using (public.is_admin());

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;

  insert into public.audit_logs (
    table_name, record_id, patient_id, action,
    changed_by, changed_by_role, old_data, new_data
  ) values (
    TG_TABLE_NAME,
    v_row ->> 'id',
    v_row ->> 'patient_id',
    TG_OP,
    auth.uid(),
    public.current_staff_role(),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP = 'UPDATE' then to_jsonb(NEW) end
  );

  -- AFTER trigger: return value is ignored by Postgres either way.
  return null;
end;
$$;

comment on function public.log_audit_event() is
  'Generic AFTER UPDATE/DELETE audit trigger — logs actor, role, and before/after row to audit_logs. Attached individually per table below, following the same one-function/many-tables convention as enforce_result_lock.';

do $$
declare
  t text;
  audited_tables text[] := array[
    'doctor_consultations',
    'results_hematology','results_chemistry','results_serology',
    'results_microbiology','results_pcr','results_histopathology',
    'results_cytology'
  ];
begin
  foreach t in array audited_tables loop
    execute format('drop trigger if exists audit_%s on public.%I', t, t);
    execute format($f$
      create trigger audit_%s
      after update or delete on public.%I
      for each row execute function public.log_audit_event()
    $f$, t, t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.8_rls_security.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' order by tablename, cmd;
--   select tgname, tgrelid::regclass from pg_trigger
--     where tgname like 'audit_%';
--
-- Then re-test a login as each role (or query via a service_role-signed
-- JWT with the relevant staff row) to confirm nobody lost access they
-- actually need before rolling this out to the live project.
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.9_sample_source.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.9_sample_source.sql
-- Adds sample source tracking to sample_records (Phase 1 of the
-- barcode-scanning / sample-source feature pass)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- sample_source records where a sample was collected from (ICU, Phlebotomy,
-- Theatre/OT, Room 1-4, or a free-text "Other Departments" value), set via
-- the required "Sample Source" dropdown on the Sample Collection page and
-- surfaced as a filterable/sortable column on the Lab Worklist. Plain text
-- column, matching how sample_records.status and every other
-- dropdown-driven field in this schema is stored (no CHECK constraint —
-- validation happens client-side, consistent with the rest of the app).

alter table public.sample_records add column if not exists sample_source text;

comment on column public.sample_records.sample_source is
  'Where the sample was collected from: ICU, Phlebotomy, Theatre/OT, Room 1-4, or a free-text value when "Other Departments" was picked. Set at collection via the Sample Collection page; shown as a filterable/sortable column on the Lab Worklist.';

-- No RLS policy changes needed: this is a new column on an existing table,
-- and sample_records' existing INSERT/UPDATE policies (see
-- migration_v2.8_rls_security.sql) already cover row-level access —
-- RLS does not do column-level restriction, so nothing to update there.

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.9_sample_source.sql
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.10_sms_log.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.10_sms_log.sql
-- Adds sms_log for the SMS reminders / result-ready notifications feature
-- (Phase 8 of the feature-development pass)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in the Supabase SQL editor, after migration_v2.8_rls_security.sql
-- (this migration depends on the public.current_staff_role()/is_admin()/
-- is_clinical_staff()/is_billing_staff() helper functions that one defines).
-- Idempotent — safe to re-run.
--
-- Every sendSms() call (index.html) logs one row here regardless of
-- whether the send itself succeeded — status/error record the outcome —
-- so there's always a record of what was attempted, not just what worked.

create table if not exists public.sms_log (
  id            bigint generated always as identity primary key,
  patient_id    uuid,
  phone         text not null,
  message       text not null,
  purpose       text not null default 'other' check (purpose in ('appointment_reminder','result_ready','other')),
  status        text not null check (status in ('sent','failed')),
  error         text,
  sent_by       uuid,
  sent_by_name  text,
  created_at    timestamptz not null default now()
);

create index if not exists sms_log_patient_idx on public.sms_log (patient_id);
create index if not exists sms_log_created_at_idx on public.sms_log (created_at desc);

alter table public.sms_log enable row level security;

-- SELECT matches ROLE_PAGES' actual grant of the 'delivery' page (Result/
-- Reminder Delivery Log): admin, lab_tech, lab_supervisor.
drop policy if exists sms_log_select on public.sms_log;
create policy sms_log_select on public.sms_log
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('lab_tech','lab_supervisor')
  );

-- INSERT is broader than SELECT on purpose: sendSms() is called from two
-- different pages with two different role sets (Appointments — reception/
-- billing roles send reminders; All Results — clinical/lab roles send
-- result-ready notices), so any authenticated staff role may log a send.
-- Sending a message isn't especially privileged; reviewing the accumulated
-- log of patient phone numbers is what's restricted above.
drop policy if exists sms_log_insert on public.sms_log;
create policy sms_log_insert on public.sms_log
  for insert
  with check (
    public.is_admin() or public.is_clinical_staff() or public.is_billing_staff()
  );

-- No UPDATE policy for any role — a log entry reflects what was actually
-- attempted at send time and shouldn't be editable after the fact.
drop policy if exists sms_log_delete on public.sms_log;
create policy sms_log_delete on public.sms_log
  for delete
  using (public.is_admin());

revoke all on public.sms_log from anon;
-- Table-level GRANTs, not just RLS policies: a fresh table created outside
-- Supabase's dashboard table editor does not automatically pick up
-- PostgREST-usable privileges for `authenticated` just because RLS
-- policies exist — RLS narrows what a grant already allows, it doesn't
-- substitute for the grant. Explicit here rather than assuming this
-- project's ALTER DEFAULT PRIVILEGES setup covers it (confirmed by testing
-- this migration against a bare Postgres instance with no Supabase
-- provisioning: policies alone produced "permission denied for table
-- sms_log", not the empty-result-set behavior a policy denial gives).
grant select, insert, delete on public.sms_log to authenticated;
grant usage, select on sequence sms_log_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.10_sms_log.sql
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.11_shift_billing_engine.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.11_shift_billing_engine.sql
-- Reception Shift Management + Split Payments + Patient Wallet +
-- Anti-Fraud Audit Engine
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHO THIS IS FOR
--   Run this in the Supabase SQL editor against a project that already has
--   migration_v2.8_rls_security.sql applied — every policy below reuses
--   the public.current_staff_role() / public.is_admin() / public.is_billing_staff()
--   helper functions defined there rather than redefining them. If v2.8
--   hasn't been applied yet, apply it first or these policies will fail
--   with "function does not exist".
--
--   As with every migration in this repo (see CLAUDE.md), this does not
--   get run automatically — review it, then apply it manually in the
--   Supabase SQL editor. Nothing in index.html runs this for you.
--
-- WHAT THIS ADDS
--   1. reception_shifts       — one row per open/close cycle at a reception
--                                counter (the "cash drawer session").
--   2. payments                — itemised, possibly-split payments against
--                                an invoice (cash + card + wallet in one
--                                checkout), each tagged to the shift that
--                                took it. Existing single-method fields on
--                                invoices (payment_method/payment_status)
--                                are left untouched for backward
--                                compatibility — see Section 3 note.
--   3. patient_wallets /
--      wallet_transactions     — pre-paid deposit / advance balance per
--                                patient, debited as a payment method.
--   4. billing_audit_logs      — anti-fraud trail: voids, refunds,
--                                discount overrides above threshold, and
--                                shift open/close events, each recording
--                                who performed it and (where relevant) who
--                                authorised it.
--   5. queue_token_counters +
--      generate_queue_token()  — daily-resetting sequential token numbers
--                                (e.g. "LAB-042"), generated the same
--                                optimistic-concurrency way the app's
--                                existing generate_next_id() RPC generates
--                                file/lab numbers (see CLAUDE.md) — a
--                                dedicated table+RPC rather than reusing
--                                generate_next_id() since that function's
--                                source isn't part of this checkout to
--                                extend safely.
--   6. Columns added to the existing invoices table: shift_id, queue_token,
--      reprint_count, voided, voided_reason, voided_at, insurance_covered,
--      patient_payable, copay_percent, copay_fixed, wallet_amount.
--
-- DESIGN NOTES
--   - payments is intentionally additive, not a replacement for
--     invoices.payment_status/payment_method. Existing code
--     (loadBilling/renderBillTable/paymentTag/saveInvoice) keeps working
--     unmodified against those two columns; the new split-payment UI
--     writes rows into `payments` AND keeps invoices.payment_status in
--     sync (paid/partial/unpaid) so every existing read path stays
--     correct without being rewritten.
--   - A patient's wallet is looked up/created lazily — there's no
--     "register a wallet" step; ensure_patient_wallet() below creates a
--     zero-balance row on first use.
--   - Anti-fraud thresholds (discount % requiring override) are a client-
--     side config value (Settings page), NOT enforced in SQL — RLS can't
--     see the discount-vs-threshold math short of duplicating business
--     logic into a trigger. What IS enforced here is that VOID/REFUND
--     writes to billing_audit_logs are never optional: the shift-lock
--     trigger below blocks payment writes against a closed shift
--     regardless of what the client does or doesn't check.
--
-- ═══════════════════════════════════════════════════════════════════════

-- ── SECTION 1: reception_shifts ──────────────────────────────────────────

create table if not exists public.reception_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_no text unique not null,
  staff_id uuid references public.staff(id),
  staff_name text not null,
  station_id text not null default 'Reception-1',
  shift_type text not null check (shift_type in ('morning','evening','night')),
  status text not null default 'active' check (status in ('active','closed')),
  currency text not null default 'SDG',
  opening_float numeric(14,2) not null default 0,
  opened_at timestamptz not null default now(),
  opened_by uuid references public.staff(id),
  -- Populated at close time — a snapshot of the reconciliation, not a
  -- live-computed view, so a closed shift's report never silently changes
  -- if later corrections touch invoices/payments dated during the shift.
  closed_at timestamptz,
  closed_by uuid references public.staff(id),
  total_patients int,
  gross_revenue numeric(14,2),
  total_cash numeric(14,2),
  total_card numeric(14,2),
  total_insurance numeric(14,2),
  total_wallet numeric(14,2),
  total_online numeric(14,2),
  total_refunds numeric(14,2),
  cash_expected numeric(14,2),
  cash_actual numeric(14,2),
  cash_variance numeric(14,2),
  variance_reason text check (
    variance_reason is null or variance_reason in (
      'counter_change_shortage','unprocessed_refund','bank_deposit_variance',
      'counterfeit_note','miscount','other'
    )
  ),
  closing_notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reception_shifts_status on public.reception_shifts(status);
create index if not exists idx_reception_shifts_staff on public.reception_shifts(staff_id);
create index if not exists idx_reception_shifts_opened_at on public.reception_shifts(opened_at desc);

-- One active shift per staff member at a time — prevents a receptionist
-- from opening a second shift while forgetting to close the first, which
-- would otherwise silently split their transactions across two shift_ids.
create unique index if not exists idx_reception_shifts_one_active_per_staff
  on public.reception_shifts(staff_id) where (status = 'active');

comment on table public.reception_shifts is
  'One row per reception cash-drawer session (open → close). All invoices/payments taken during a shift are tagged with its id.';

-- ── SECTION 2: patient_wallets / wallet_transactions ─────────────────────

create table if not exists public.patient_wallets (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  balance numeric(14,2) not null default 0,
  currency text not null default 'SDG',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.patient_wallets(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  type text not null check (type in ('credit','debit','refund')),
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null,
  reference_invoice_id uuid references public.invoices(id),
  shift_id uuid references public.reception_shifts(id),
  performed_by uuid references public.staff(id),
  performed_by_name text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_txn_wallet on public.wallet_transactions(wallet_id);
create index if not exists idx_wallet_txn_patient on public.wallet_transactions(patient_id);

comment on table public.patient_wallets is
  'Pre-paid deposit / advance balance per patient. Credited by reception, debited as a "Patient Wallet" payment method at checkout.';

-- Server-side balance mutation, not a bare UPDATE from the client — keeps
-- balance_after always consistent with balance and rejects a debit that
-- would take the wallet negative, even if two devices race to spend the
-- same balance offline-first.
create or replace function public.apply_wallet_transaction(
  p_patient_id uuid, p_type text, p_amount numeric,
  p_reference_invoice_id uuid default null, p_shift_id uuid default null,
  p_notes text default null
) returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.patient_wallets;
  v_new_balance numeric(14,2);
  v_txn public.wallet_transactions;
  v_staff_id uuid;
  v_staff_name text;
begin
  if p_amount <= 0 then
    raise exception 'Wallet transaction amount must be positive';
  end if;
  if p_type not in ('credit','debit','refund') then
    raise exception 'Invalid wallet transaction type: %', p_type;
  end if;

  select id, full_name into v_staff_id, v_staff_name
  from public.staff where user_id = auth.uid();

  -- Lock the wallet row for the duration of this transaction so concurrent
  -- debits from two devices can't both read the same starting balance.
  select * into v_wallet from public.patient_wallets
    where patient_id = p_patient_id for update;

  if not found then
    insert into public.patient_wallets (patient_id, balance)
    values (p_patient_id, 0)
    returning * into v_wallet;
  end if;

  if p_type = 'debit' then
    if v_wallet.balance < p_amount then
      raise exception 'Insufficient wallet balance: available %, requested %', v_wallet.balance, p_amount;
    end if;
    v_new_balance := v_wallet.balance - p_amount;
  else
    v_new_balance := v_wallet.balance + p_amount;
  end if;

  update public.patient_wallets
    set balance = v_new_balance, updated_at = now()
    where id = v_wallet.id;

  insert into public.wallet_transactions (
    wallet_id, patient_id, type, amount, balance_after,
    reference_invoice_id, shift_id, performed_by, performed_by_name, notes
  ) values (
    v_wallet.id, p_patient_id, p_type, p_amount, v_new_balance,
    p_reference_invoice_id, p_shift_id, v_staff_id, v_staff_name, p_notes
  ) returning * into v_txn;

  return v_txn;
end;
$$;

revoke execute on function public.apply_wallet_transaction(uuid,text,numeric,uuid,uuid,text) from public;
grant execute on function public.apply_wallet_transaction(uuid,text,numeric,uuid,uuid,text) to authenticated;

-- ── SECTION 3: payments (split-payment ledger) ────────────────────────────

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  method text not null check (method in ('cash','card','insurance','wallet','online','bank_transfer','mobile_money')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'SDG',
  shift_id uuid references public.reception_shifts(id),
  received_by uuid references public.staff(id),
  received_by_name text,
  reference_no text,
  voided boolean not null default false,
  voided_by uuid references public.staff(id),
  voided_reason text,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_invoice on public.payments(invoice_id);
create index if not exists idx_payments_shift on public.payments(shift_id);

comment on table public.payments is
  'Itemised payment lines against an invoice — supports splitting one invoice across cash/card/insurance/wallet in a single checkout. Additive to invoices.payment_status, which stays the source of truth for "is this invoice paid".';

-- ── SECTION 4: billing_audit_logs (anti-fraud trail) ──────────────────────

create table if not exists public.billing_audit_logs (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'shift_open','shift_close','void_invoice','refund','discount_override',
    'wallet_credit','wallet_debit','reprint'
  )),
  invoice_id uuid references public.invoices(id),
  shift_id uuid references public.reception_shifts(id),
  amount numeric(14,2),
  reason text,
  authorized_by uuid references public.staff(id),
  authorized_by_name text,
  performed_by uuid references public.staff(id),
  performed_by_name text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_audit_invoice on public.billing_audit_logs(invoice_id);
create index if not exists idx_billing_audit_event on public.billing_audit_logs(event_type);

comment on table public.billing_audit_logs is
  'Anti-fraud trail for voids, refunds, discount overrides, reprints, and shift open/close — mirrors the audit_logs pattern from migration_v2.8 but scoped to billing events that are not plain UPDATE/DELETE on an audited table.';

-- ── SECTION 5: invoices — new columns ──────────────────────────────────────

alter table public.invoices add column if not exists shift_id uuid references public.reception_shifts(id);
alter table public.invoices add column if not exists queue_token text;
alter table public.invoices add column if not exists reprint_count int not null default 0;
alter table public.invoices add column if not exists voided boolean not null default false;
alter table public.invoices add column if not exists voided_reason text;
alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists insurance_covered numeric(14,2) default 0;
alter table public.invoices add column if not exists patient_payable numeric(14,2);
alter table public.invoices add column if not exists copay_percent numeric(5,2);
alter table public.invoices add column if not exists copay_fixed numeric(14,2);
alter table public.invoices add column if not exists wallet_amount numeric(14,2) default 0;

create index if not exists idx_invoices_shift on public.invoices(shift_id);

-- Shift lock: once a shift is closed, reject any new payment or any invoice
-- write that tags it to that shift. This is the actual "shift lock"
-- guarantee — a client-side disabled button is only ever advisory,
-- someone hitting the REST API directly with a valid session must be
-- stopped here too.
create or replace function public.enforce_shift_lock() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if new.shift_id is null then
    return new;
  end if;
  select status into v_status from public.reception_shifts where id = new.shift_id;
  if v_status = 'closed' then
    raise exception 'Shift % is closed — no further billing entries may be added to it', new.shift_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_shift_lock on public.invoices;
create trigger trg_invoices_shift_lock
  before insert or update of shift_id on public.invoices
  for each row execute function public.enforce_shift_lock();

drop trigger if exists trg_payments_shift_lock on public.payments;
create trigger trg_payments_shift_lock
  before insert on public.payments
  for each row execute function public.enforce_shift_lock();

-- ── SECTION 6: queue tokens ────────────────────────────────────────────────

create table if not exists public.queue_token_counters (
  token_date date not null,
  prefix text not null,
  last_number int not null default 0,
  primary key (token_date, prefix)
);

-- Optimistic-concurrency sequential counter, same pattern as the app's
-- existing generate_next_id() RPC (see CLAUDE.md) — an UPSERT with
-- RETURNING rather than SELECT-then-UPDATE, so two simultaneous checkouts
-- can never be handed the same token number.
create or replace function public.generate_queue_token(p_prefix text default 'LAB')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num int;
begin
  insert into public.queue_token_counters (token_date, prefix, last_number)
  values (current_date, p_prefix, 1)
  on conflict (token_date, prefix)
  do update set last_number = public.queue_token_counters.last_number + 1
  returning last_number into v_num;

  return p_prefix || '-' || lpad(v_num::text, 3, '0');
end;
$$;

revoke execute on function public.generate_queue_token(text) from public;
grant execute on function public.generate_queue_token(text) to authenticated;

-- ── SECTION 7: RLS — reception_shifts ───────────────────────────────────────

alter table public.reception_shifts enable row level security;

drop policy if exists shifts_select on public.reception_shifts;
create policy shifts_select on public.reception_shifts for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

drop policy if exists shifts_insert on public.reception_shifts;
create policy shifts_insert on public.reception_shifts for insert to authenticated
  with check (public.is_admin() or public.is_billing_staff());

-- Only the receptionist/cashier who opened it (or an admin) may update
-- their own shift — one cashier cannot close or edit another's drawer.
drop policy if exists shifts_update on public.reception_shifts;
create policy shifts_update on public.reception_shifts for update to authenticated
  using (
    public.is_admin()
    or (public.is_billing_staff() and staff_id in (select id from public.staff where user_id = auth.uid()))
  )
  with check (
    public.is_admin()
    or (public.is_billing_staff() and staff_id in (select id from public.staff where user_id = auth.uid()))
  );

drop policy if exists shifts_delete on public.reception_shifts;
create policy shifts_delete on public.reception_shifts for delete to authenticated
  using (public.is_admin());

-- ── SECTION 8: RLS — payments ────────────────────────────────────────────

alter table public.payments enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert to authenticated
  with check (public.is_admin() or public.is_billing_staff());

-- Void/refund is an update (voided=true), not a delete — deletion of a
-- payment row is never allowed, even by admins, to keep the ledger intact;
-- corrections happen via a new offsetting 'refund' row instead.
drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments for update to authenticated
  using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments for delete to authenticated
  using (public.is_admin());

-- ── SECTION 9: RLS — patient_wallets / wallet_transactions ────────────────

alter table public.patient_wallets enable row level security;
alter table public.wallet_transactions enable row level security;

drop policy if exists wallets_select on public.patient_wallets;
create policy wallets_select on public.patient_wallets for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

-- Direct client writes to patient_wallets are intentionally NOT granted —
-- balance must only ever change via apply_wallet_transaction() (SECURITY
-- DEFINER), so no policy below permits insert/update/delete from the
-- client role; the function performs those writes under its own
-- definer privileges regardless of the caller's RLS grants.

drop policy if exists wallet_txn_select on public.wallet_transactions;
create policy wallet_txn_select on public.wallet_transactions for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

-- ── SECTION 10: RLS — billing_audit_logs ──────────────────────────────────

alter table public.billing_audit_logs enable row level security;

drop policy if exists billing_audit_select on public.billing_audit_logs;
create policy billing_audit_select on public.billing_audit_logs for select to authenticated
  using (public.is_admin());

drop policy if exists billing_audit_insert on public.billing_audit_logs;
create policy billing_audit_insert on public.billing_audit_logs for insert to authenticated
  with check (public.is_admin() or public.is_billing_staff());

-- No update/delete policy on billing_audit_logs for anyone, admins
-- included — an audit trail that can be edited after the fact is not one.

-- ── SECTION 11: RLS — queue_token_counters ────────────────────────────────

alter table public.queue_token_counters enable row level security;

drop policy if exists queue_counters_select on public.queue_token_counters;
create policy queue_counters_select on public.queue_token_counters for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

-- No insert/update/delete policy — all writes to this table happen only
-- through generate_queue_token(), a SECURITY DEFINER function.

-- ── SECTION 12: GRANTs ────────────────────────────────────────────────────
-- RLS policies alone are not sufficient — Postgres also requires a
-- table-level GRANT before `authenticated` can touch these tables at all
-- (a bare Postgres instance without Supabase's default-privilege
-- provisioning returns "permission denied for table X" independent of any
-- RLS policy; confirmed the hard way while testing migration_v2.10).

grant select, insert, update on public.reception_shifts to authenticated;
grant select, insert, update on public.payments to authenticated;
grant select on public.patient_wallets to authenticated;
grant select on public.wallet_transactions to authenticated;
grant select, insert on public.billing_audit_logs to authenticated;
grant select on public.queue_token_counters to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.11_shift_billing_engine.sql
--
-- AFTER APPLYING, in the Supabase SQL editor, verify:
--   select * from public.reception_shifts limit 1;
--   select public.generate_queue_token('LAB');   -- should return 'LAB-001' the first time today
--   select public.apply_wallet_transaction('<a real patient uuid>', 'credit', 100, null, null, 'test credit');
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.12_override_pin.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.12_override_pin.sql
-- Adds an optional fast "Quick PIN" path to the anti-fraud admin
-- override flow (void/refund/discount-above-threshold), alongside the
-- existing full email+password re-authentication.
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--   The override flow (see requireOverride()/submitOverride() in
--   index.html) originally only supported full admin re-authentication
--   against Supabase Auth — deliberately, since a short static PIN is
--   weaker than a real password (shared between staff, rarely rotated,
--   easy to observe over someone's shoulder at a counter). That trade-off
--   is still true. This migration adds a PIN as an OPTIONAL faster path
--   for counter-speed approvals, not a replacement — full re-auth remains
--   available and is still the stronger option for high-value actions.
--
-- HOW THE PIN IS KEPT SAFE
--   1. Stored bcrypt-hashed (pgcrypto's crypt()/gen_salt('bf')), never
--      plaintext.
--   2. The hash is NEVER returned to any client. Both reading (to verify)
--      and writing (to set) happen exclusively inside SECURITY DEFINER
--      functions that return only a boolean or an admin's identity — the
--      hash itself never crosses the wire.
--   3. Column-level REVOKE on staff.override_pin_hash means even a query
--      like `select * from staff` from an ordinary authenticated session
--      cannot see this column at all, regardless of whatever row-level
--      staff-directory read policies already exist (e.g. for populating
--      doctor dropdowns). The two functions below still work because a
--      SECURITY DEFINER function executes with the DEFINER's privileges
--      (the role that ran this migration), not the caller's — so it
--      bypasses the column-level revoke placed on `authenticated`/`anon`
--      while ordinary queries from any role other than the definer stay
--      blocked from ever selecting the column.
--   4. An admin may only ever set/change their OWN PIN
--      (set_override_pin() resolves the caller's own staff row via
--      auth.uid() — there is no "set someone else's PIN" path at all).
--
-- KNOWN LIMITATION (documented, not silently ignored): there is no
-- failed-attempt lockout/rate-limit on verify_override_pin() in this
-- pass. A 6+ digit numeric PIN has a large enough space that casual
-- guessing isn't practical, but a scripted brute-force against the RPC
-- itself isn't blocked at the database layer. If that matters for your
-- deployment, consider adding a failed-attempts counter + temporary
-- lockout as a follow-up — flagging it explicitly rather than pretending
-- this closes that gap.
--
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.

create extension if not exists pgcrypto;

alter table public.staff add column if not exists override_pin_hash text;

comment on column public.staff.override_pin_hash is
  'Bcrypt hash of this admin''s optional Quick-PIN for the anti-fraud override flow. Never selected directly by client code — only read/written inside set_override_pin()/verify_override_pin(), both SECURITY DEFINER. See migration_v2.12 for the full security rationale.';

-- Lock the raw hash column away from ordinary row-level access, even
-- though existing staff-directory SELECT policies (from migration_v2.8)
-- may otherwise let any authenticated user read other columns on other
-- staff rows (e.g. for doctor-name dropdowns).
revoke select (override_pin_hash) on public.staff from authenticated;
revoke select (override_pin_hash) on public.staff from anon;

-- An admin sets/changes ONLY their own PIN — resolved via auth.uid(),
-- never trusts a client-supplied staff id.
create or replace function public.set_override_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_role text;
begin
  select id, role into v_staff_id, v_role from public.staff where user_id = auth.uid();
  if v_staff_id is null then
    raise exception 'No staff record linked to this account';
  end if;
  if v_role <> 'admin' then
    raise exception 'Only an admin may set an override PIN';
  end if;
  if p_pin is null or length(p_pin) < 6 then
    raise exception 'PIN must be at least 6 digits';
  end if;
  if p_pin !~ '^[0-9]+$' then
    raise exception 'PIN must be numeric only';
  end if;

  update public.staff set override_pin_hash = crypt(p_pin, gen_salt('bf')) where id = v_staff_id;
  return true;
end;
$$;

revoke execute on function public.set_override_pin(text) from public;
grant execute on function public.set_override_pin(text) to authenticated;

-- Verifies a PIN against every admin's stored hash and returns the
-- matching admin's identity (or zero rows if no match) — this is the
-- ONLY way the hash is ever read, and it never leaves this function.
create or replace function public.verify_override_pin(p_pin text)
returns table(admin_id uuid, admin_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select s.id, s.full_name
    from public.staff s
    where s.role = 'admin'
      and s.override_pin_hash is not null
      and s.override_pin_hash = crypt(p_pin, s.override_pin_hash)
    limit 1;
end;
$$;

revoke execute on function public.verify_override_pin(text) from public;
grant execute on function public.verify_override_pin(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.12_override_pin.sql
--
-- AFTER APPLYING, verify with:
--   select public.set_override_pin('123456');           -- run while logged in as an admin (via SQL editor this runs as postgres, not a real admin session — real verification happens from the app itself, see below)
--   select * from public.verify_override_pin('123456');  -- should return 0 rows unless called by/for a real admin session
-- Real end-to-end verification happens from the app: an admin sets their
-- PIN via Settings, then a cashier triggers a void/refund and picks
-- "Quick PIN" in the authorization modal.
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.13_delta_and_instrument_log.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.13_delta_and_instrument_log.sql
-- Adds audit-log tables for two new Laboratory features in index.html:
--   1. Delta Checking (safety alerts when a new result swings wildly from
--      the patient's last on-file result)
--   2. Instrument Interfacing / Middleware message log (ASTM/HL7 message
--      ingestion + auto-verification decisions)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in the Supabase SQL editor, after migration_v2.8_rls_security.sql
-- (depends on public.current_staff_role()/is_admin()/is_clinical_staff()).
-- Idempotent — safe to re-run.
--
-- WHY A NEW delta_check_log TABLE (not new columns on results_hematology/
-- results_chemistry):
--   Those two tables upsert with onConflict:'patient_id' — there is only
--   ever ONE row per patient in each (a running "current CBC"/"current
--   chemistry panel" snapshot, not a visit history). That means delta
--   checking cannot compare against "the row before this one" by querying
--   history from those tables — index.html instead reads the existing row
--   immediately before it gets overwritten, compares it to the incoming
--   save, and if a safety threshold is breached, writes a row here BEFORE
--   the overwrite happens. This table is therefore the only place a delta
--   breach and its resolution (reason code, who overrode it) are durably
--   recorded — an audit trail that would otherwise be destroyed by the
--   next upsert.
--
-- WHY A NEW instrument_messages TABLE:
--   The existing Analyzer Interface page (#page-analyzer) only ever stored
--   *configuration* (protocol/host/port) — it never persisted actual
--   incoming messages. This table gives the new Instrument Data Stream /
--   Middleware panel a real backing store for parsed ASTM/HL7 messages
--   (simulated or pasted in — see the panel's own note about why a live
--   TCP/MLLP listener isn't possible from a static client-side app) and
--   their sync/mapping status.

create table if not exists public.delta_check_log (
  id                bigint generated always as identity primary key,
  patient_id        uuid not null,
  result_table      text not null,                 -- e.g. 'results_hematology'
  department        text not null,                 -- e.g. 'Haematology'
  field             text not null,                 -- e.g. 'hgb'
  field_label       text not null,                 -- e.g. 'Haemoglobin'
  previous_value    numeric,
  previous_date     timestamptz,
  current_value     numeric not null,
  delta_type        text not null check (delta_type in ('pct','abs')),
  delta_value       numeric not null,               -- computed % change or absolute shift
  threshold         numeric not null,
  direction         text not null check (direction in ('drop','rise','either')),
  auto_verify_blocked boolean not null default true,
  reason_code       text,                           -- required before save proceeds
  reason_note       text,
  resolved_by       uuid,
  resolved_by_name  text,
  created_at        timestamptz not null default now()
);

create index if not exists delta_check_log_patient_idx on public.delta_check_log (patient_id);
create index if not exists delta_check_log_created_at_idx on public.delta_check_log (created_at desc);

alter table public.delta_check_log enable row level security;

drop policy if exists delta_check_log_select on public.delta_check_log;
create policy delta_check_log_select on public.delta_check_log
  for select
  using (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

drop policy if exists delta_check_log_insert on public.delta_check_log;
create policy delta_check_log_insert on public.delta_check_log
  for insert
  with check (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

-- No UPDATE/DELETE policy for any role — a flagged delta event and its
-- recorded resolution shouldn't be editable or removable after the fact,
-- same rationale as sms_log/critical_values.

revoke all on public.delta_check_log from anon;
grant select, insert on public.delta_check_log to authenticated;
grant usage, select on sequence delta_check_log_id_seq to authenticated;


create table if not exists public.instrument_messages (
  id                bigint generated always as identity primary key,
  machine_id        text not null,                 -- e.g. 'Sysmex XN-1000'
  protocol          text not null check (protocol in ('ASTM','HL7')),
  raw_message       text not null,
  sample_barcode    text,
  patient_id        uuid,
  test_parameter    text,
  raw_value         text,
  parsed_value      numeric,
  sync_status       text not null default 'pending_mapping'
                      check (sync_status in ('auto_mapped','pending_mapping','error')),
  error_detail      text,
  mapped_table      text,                          -- e.g. 'results_hematology'
  mapped_field      text,                          -- e.g. 'hgb'
  imported_by       uuid,
  imported_by_name  text,
  imported_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists instrument_messages_created_at_idx on public.instrument_messages (created_at desc);
create index if not exists instrument_messages_patient_idx on public.instrument_messages (patient_id);

alter table public.instrument_messages enable row level security;

drop policy if exists instrument_messages_select on public.instrument_messages;
create policy instrument_messages_select on public.instrument_messages
  for select
  using (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

drop policy if exists instrument_messages_insert on public.instrument_messages;
create policy instrument_messages_insert on public.instrument_messages
  for insert
  with check (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

drop policy if exists instrument_messages_update on public.instrument_messages;
create policy instrument_messages_update on public.instrument_messages
  for update
  using (public.is_admin() or public.current_staff_role() in ('lab_tech','lab_supervisor'));

revoke all on public.instrument_messages from anon;
grant select, insert, update on public.instrument_messages to authenticated;
grant usage, select on sequence instrument_messages_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.13_delta_and_instrument_log.sql
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.14_inventory_upgrade.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.14_inventory_upgrade.sql
-- Upgrades the existing single-table Inventory module (reagent_inventory)
-- into a departmental, batch-tracked, requisition-capable system.
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in the Supabase SQL editor, after migration_v2.8_rls_security.sql
-- (depends on public.is_admin()/is_clinical_staff()/is_lab_staff()/
-- current_staff_role()). Idempotent — safe to re-run.
--
-- WHAT WAS AUDITED FIRST (per the request that triggered this migration):
-- index.html already had a working Inventory page (#page-inventory) backed
-- by reagent_inventory — item_name/category/analyzer/current_stock/unit/
-- min_level/lot_no/expiry_date/supplier, with low-stock notifications
-- already wired in refreshNotifications(). That table supports exactly
-- ONE lot/expiry per item, one flat category, no barcode, no department
-- taxonomy, and no requisition/transfer workflow — this migration adds
-- those on top of it rather than replacing it, and existing rows/queries
-- (including the low-stock notification) keep working unchanged.
--
-- DESIGN DECISIONS
--   1. reagent_inventory.current_stock stays the source of truth read by
--      existing code (notifications, dashboards) — it's now an aggregate
--      kept in sync by inventory_batches operations (receive/dispense/
--      adjust all update it), rather than something the new batch table
--      replaces.
--   2. Multiple batches per item (inventory_batches) is the actual fix for
--      "Batch & Expiry Management" — the old schema could only ever
--      remember one lot/expiry per item, which breaks FEFO by definition
--      (you need >1 batch on hand to have a "first" one to expire).
--   3. Department taxonomy (reagent_inventory.department) is a fixed set
--      matching the request's 5 categories; sub-category stays in the
--      existing `category` column, now populated from a per-department
--      list client-side (see INVENTORY_TAXONOMY in index.html) rather than
--      a fixed global enum, since sub-categories genuinely differ by dept.

-- ── 1. Extend reagent_inventory ─────────────────────────────────────────
alter table public.reagent_inventory add column if not exists department text;
alter table public.reagent_inventory add column if not exists barcode text;
alter table public.reagent_inventory add column if not exists onboard_stability_days integer;
comment on column public.reagent_inventory.department is
  'One of: Laboratory, Radiology & Imaging, Surgical & OT Supplies, General Medical & Nursing, Equipment & Maintenance. NULL for pre-existing rows created before this migration — the UI treats NULL as "Uncategorized" until edited.';
comment on column public.reagent_inventory.onboard_stability_days is
  'For liquid reagents only: how many days the item remains usable after being opened, independent of its printed/unopened expiry_date. NULL = not tracked for this item. See inventory_batches.opened_date for the per-batch open date this is measured from.';

create index if not exists reagent_inventory_department_idx on public.reagent_inventory (department);
create index if not exists reagent_inventory_barcode_idx on public.reagent_inventory (barcode);

-- ── 2. Batch tracking (the real fix for FEFO) ───────────────────────────
create table if not exists public.inventory_batches (
  id              bigint generated always as identity primary key,
  item_id         uuid not null references public.reagent_inventory(id) on delete cascade,
  batch_no        text,
  quantity        numeric not null default 0 check (quantity >= 0),
  unit_cost       numeric,
  received_date   date not null default current_date,
  expiry_date     date,
  is_opened       boolean not null default false,
  opened_date     date,
  is_active       boolean not null default true,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists inventory_batches_item_idx on public.inventory_batches (item_id);
create index if not exists inventory_batches_expiry_idx on public.inventory_batches (expiry_date);

alter table public.inventory_batches enable row level security;

drop policy if exists inventory_batches_select on public.inventory_batches;
create policy inventory_batches_select on public.inventory_batches
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists inventory_batches_insert on public.inventory_batches;
create policy inventory_batches_insert on public.inventory_batches
  for insert with check (public.is_admin() or public.is_clinical_staff());

drop policy if exists inventory_batches_update on public.inventory_batches;
create policy inventory_batches_update on public.inventory_batches
  for update using (public.is_admin() or public.is_clinical_staff());

revoke all on public.inventory_batches from anon;
grant select, insert, update on public.inventory_batches to authenticated;
grant usage, select on sequence inventory_batches_id_seq to authenticated;

-- ── 3. Departmental Requisition & Transfer workflow ─────────────────────
create table if not exists public.stock_requisitions (
  id                    bigint generated always as identity primary key,
  requesting_department text not null,   -- e.g. 'ICU', 'Radiology', 'Theatre' — free text, the requesting ward/unit, distinct from reagent_inventory.department (the item's own catalog department)
  item_id               uuid not null references public.reagent_inventory(id),
  qty_requested         numeric not null check (qty_requested > 0),
  status                text not null default 'pending' check (status in ('pending','approved','rejected','fulfilled')),
  notes                 text,
  requested_by          uuid,
  requested_by_name     text,
  decided_by            uuid,
  decided_by_name       text,
  decision_note         text,
  decided_at            timestamptz,
  fulfilled_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists stock_requisitions_status_idx on public.stock_requisitions (status);
create index if not exists stock_requisitions_created_at_idx on public.stock_requisitions (created_at desc);

alter table public.stock_requisitions enable row level security;

-- Any clinical/lab/admin staff can see the requisition queue (a ward needs
-- to see its own request's status; central store needs to see everyone's).
drop policy if exists stock_requisitions_select on public.stock_requisitions;
create policy stock_requisitions_select on public.stock_requisitions
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists stock_requisitions_insert on public.stock_requisitions;
create policy stock_requisitions_insert on public.stock_requisitions
  for insert with check (public.is_admin() or public.is_clinical_staff());

-- Approve/reject/fulfill is a Central Store (admin/lab_supervisor) action,
-- not something the requesting ward can do to its own request.
drop policy if exists stock_requisitions_update on public.stock_requisitions;
create policy stock_requisitions_update on public.stock_requisitions
  for update using (public.is_admin() or public.current_staff_role() = 'lab_supervisor');

revoke all on public.stock_requisitions from anon;
grant select, insert, update on public.stock_requisitions to authenticated;
grant usage, select on sequence stock_requisitions_id_seq to authenticated;

-- ── 4. Purchase Orders (Reorder / Par Stock alerts → PO) ────────────────
create table if not exists public.purchase_orders (
  id          bigint generated always as identity primary key,
  po_no       text not null,
  supplier    text,
  status      text not null default 'draft' check (status in ('draft','sent','received','cancelled')),
  notes       text,
  created_by  uuid,
  created_by_name text,
  created_at  timestamptz not null default now()
);
create table if not exists public.purchase_order_items (
  id                bigint generated always as identity primary key,
  po_id             bigint not null references public.purchase_orders(id) on delete cascade,
  item_id           uuid references public.reagent_inventory(id),
  item_name_snapshot text not null,   -- kept even if the catalog item is later renamed/removed
  qty_ordered       numeric not null check (qty_ordered > 0),
  unit_cost_estimate numeric
);

create index if not exists purchase_order_items_po_idx on public.purchase_order_items (po_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select using (public.is_admin() or public.is_lab_staff());
drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders
  for insert with check (public.is_admin() or public.is_lab_staff());
drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders
  for update using (public.is_admin() or public.is_lab_staff());

drop policy if exists purchase_order_items_select on public.purchase_order_items;
create policy purchase_order_items_select on public.purchase_order_items
  for select using (public.is_admin() or public.is_lab_staff());
drop policy if exists purchase_order_items_insert on public.purchase_order_items;
create policy purchase_order_items_insert on public.purchase_order_items
  for insert with check (public.is_admin() or public.is_lab_staff());

revoke all on public.purchase_orders from anon;
revoke all on public.purchase_order_items from anon;
grant select, insert, update on public.purchase_orders to authenticated;
grant select, insert on public.purchase_order_items to authenticated;
grant usage, select on sequence purchase_orders_id_seq to authenticated;
grant usage, select on sequence purchase_order_items_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.14_inventory_upgrade.sql
--
-- NOTE ON A PRE-EXISTING GAP (not introduced by this migration, flagging
-- rather than silently leaving it): reagent_inventory itself was never
-- listed in migration_v2.8_rls_security.sql's scope and has no RLS policy
-- of its own — any authenticated user can currently read/write any row.
-- The new tables above ARE properly locked down. If you want
-- reagent_inventory itself locked down to match, that's a small follow-up
-- migration (same pattern as this file's Section 2) rather than something
-- folded in here silently.
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.15_radiology_safety_upgrade.sql
-- #############################################################################

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


-- #############################################################################
-- ## migration_v2.16_reagent_inventory_rls.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.16_reagent_inventory_rls.sql
-- Closes the reagent_inventory RLS gap flagged in migration_v2.14's
-- closing note.
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--   migration_v2.8_rls_security.sql locked down 16 tables but never
--   included reagent_inventory — it predates that migration and was
--   simply missed. Every inventory table added afterwards in
--   migration_v2.14_inventory_upgrade.sql (inventory_batches,
--   stock_requisitions, purchase_orders, purchase_order_items) IS
--   properly locked down. reagent_inventory itself is the one gap left:
--   right now any authenticated user (any staff login, via the public
--   anon key) can read or write any row in it directly through the
--   PostgREST API, regardless of role.
--
-- THIS FILE DOES NOT REPLACE OR MODIFY migration_v2.8 OR migration_v2.14.
-- It depends on the helper functions migration_v2.8 already created
-- (public.is_admin(), public.is_clinical_staff(), public.is_billing_staff())
-- and adds one new helper in the same style for the one role grouping
-- that doesn't already have a helper matching it.
--
-- WHO ACTUALLY READS/WRITES reagent_inventory TODAY (from index.html)
--   1. Every authenticated session, regardless of role, reads it once per
--      notification-bell refresh — refreshNotifications() unconditionally
--      queries reagent_inventory for low-stock items and shows them to
--      whoever is logged in; it has no role check at all (see the
--      'Phase 6' notification-bell code, ~line 7017 in index.html). So
--      empirically, SELECT is used by all 9 roles today, not just the
--      ones with the Inventory page.
--   2. Full read/write via the Inventory page itself (loadInventory(),
--      editInventoryItem()/saveInventoryItem(), receiveBatchStock(),
--      dispenseFromInventoryFefo(), markBatchOpened()) is only reachable
--      by roles ROLE_PAGES grants the 'inventory' page to: admin, nurse,
--      lab_tech, lab_supervisor, theatre_nurse, radiologist. Doctor,
--      receptionist, and cashier have no 'inventory' entry in ROLE_PAGES
--      and no UI path to reach these functions.
--   3. There is no hard .delete() call on reagent_inventory anywhere in
--      index.html — "removing" an item is a soft-delete
--      (.update({is_active:false})). DELETE is still locked to admin-only
--      below, matching every other table in this project (defense in
--      depth, same as migration_v2.8/v2.14's convention).
--
-- DESIGN DECISION
--   SELECT is granted broadly (every role) to match what the app already
--   does today (#1 above) — tightening it to inventory-page roles only
--   would silently break the low-stock notification bell for doctor/
--   receptionist/cashier sessions, which is a behavior change outside
--   this migration's scope. INSERT/UPDATE is scoped to the roles that
--   actually have a UI path to mutate this table (#2 above), via a new
--   public.is_inventory_staff() helper — none of migration_v2.8's
--   existing helpers match this exact role set (is_clinical_staff()
--   includes doctor, who has no inventory access; is_lab_staff() is
--   narrower than the app's actual inventory-page grant).
--
-- Run this in the Supabase SQL editor, after migration_v2.8 and
-- migration_v2.14. Idempotent — safe to re-run. This file only produces
-- SQL for review; it is not applied automatically.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — new helper: public.is_inventory_staff()
-- ───────────────────────────────────────────────────────────────────────
-- Matches ROLE_PAGES['inventory'] in index.html exactly, minus admin
-- (admin is always checked separately via is_admin() alongside this, same
-- convention as every other policy in migration_v2.8): nurse, lab_tech,
-- lab_supervisor, theatre_nurse, radiologist. Deliberately excludes
-- doctor, receptionist, cashier — none of those roles have the
-- 'inventory' page in ROLE_PAGES today.

create or replace function public.is_inventory_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() in
    ('nurse','lab_tech','lab_supervisor','theatre_nurse','radiologist');
$$;

comment on function public.is_inventory_staff() is
  'Roles ROLE_PAGES grants the Inventory page to, excluding admin (checked separately): nurse, lab_tech, lab_supervisor, theatre_nurse, radiologist. Used to scope reagent_inventory writes to roles with an actual UI path to mutate it.';

revoke execute on function public.is_inventory_staff() from public;
grant execute on function public.is_inventory_staff() to authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — reagent_inventory
-- ───────────────────────────────────────────────────────────────────────

alter table public.reagent_inventory enable row level security;

drop policy if exists reagent_inventory_select on public.reagent_inventory;
create policy reagent_inventory_select on public.reagent_inventory
  for select
  using (
    public.is_admin() or public.is_clinical_staff() or public.is_billing_staff()
  );

drop policy if exists reagent_inventory_insert on public.reagent_inventory;
create policy reagent_inventory_insert on public.reagent_inventory
  for insert
  with check (public.is_admin() or public.is_inventory_staff());

drop policy if exists reagent_inventory_update on public.reagent_inventory;
create policy reagent_inventory_update on public.reagent_inventory
  for update
  using (public.is_admin() or public.is_inventory_staff())
  with check (public.is_admin() or public.is_inventory_staff());

drop policy if exists reagent_inventory_delete on public.reagent_inventory;
create policy reagent_inventory_delete on public.reagent_inventory
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — Defense-in-depth: make sure `anon` has nothing here
-- ───────────────────────────────────────────────────────────────────────
-- Same belt-and-suspenders revoke migration_v2.8's Section 12 applies to
-- its own table list — reagent_inventory was left out of that list since
-- it wasn't in scope there, so it gets its own copy of the same revoke.

revoke all on public.reagent_inventory from anon;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.16_reagent_inventory_rls.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'reagent_inventory'
--     order by cmd;
--
-- Then re-test the low-stock notification bell for a receptionist/cashier/
-- doctor login (should still show low-stock counts — SELECT is broad) and
-- the Inventory page's add/edit/receive-stock/dispense flows for
-- nurse/lab_tech/lab_supervisor/theatre_nurse/radiologist/admin logins
-- (should still work) before rolling this out to the live project.
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.17_lab_result_history.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.17_lab_result_history.sql
-- Append-only Haematology/Chemistry result history
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--   results_hematology and results_chemistry are upserted with
--   {onConflict:'patient_id'} — there is at most ONE row per patient EVER
--   in either table. A second visit's results silently overwrite the
--   first visit's. Two consequences, both real:
--     1. Trend charts (Doctor Consultation's Last Vitals tab, Patient
--        History Timeline's trend card) query these tables expecting
--        multiple points, but can structurally never get more than one
--        row back per patient — so a "trend" has always been a single dot.
--     2. Delta-checking (runDeltaCheck() in index.html) compares the
--        incoming save against this same current-panel row. That row
--        still holds the true prior value at compare-time (the upsert
--        hasn't happened yet), so the individual comparison is correct —
--        but the value it's compared against is about to be destroyed,
--        so there is no way to compare against anything OLDER than one
--        save back, and no durable record of what the delta check saw.
--
-- WHAT THIS MIGRATION ADDS (additive only — nothing existing is touched)
--   results_hematology_history and results_chemistry_history: one row
--   per SAVE (not per patient), written in addition to the existing
--   upsert every time saveHemEntry()/saveChemEntry() saves — see
--   logResultHistory() in index.html, called from
--   saveResultWithSafetyChecks()'s doFinalize(). The current-panel
--   tables (results_hematology/results_chemistry) are NOT modified,
--   dropped, or repurposed — every existing read of them (printed
--   reports, the unified "All Results" viewer, critical-value flagging)
--   keeps working exactly as before, off the same "current panel" row.
--
--   Column lists below are reverse-engineered from the payload objects
--   saveHemEntry()/saveChemEntry() build in index.html (~line 9396 and
--   ~9408) — same approach migration_v2.8's header used, since no schema
--   .sql files ship in this checkout (see CLAUDE.md).
--
-- WHAT READS FROM THE NEW TABLES (see index.html changes in the same
-- commit as this migration)
--   - runDeltaCheck(): now reads the *_history table's most recent row
--     (ordered by recorded_at desc) as "the previous value", falling
--     back to the current-panel table if a patient has no history rows
--     yet (pre-migration data, or a deployment that hasn't applied this
--     migration yet — the client checks for that and degrades gracefully
--     rather than throwing).
--   - loadDocVitalsTrend() (Doctor Consultation → Last Vitals tab):
--     glucose sparkline now reads results_chemistry_history instead of
--     results_chemistry.
--   - loadPthTimeline() (Patient History Timeline trend card): hgb/wbc/
--     plt/creat/urea/fbs/alt/ast/alp/ggt trend now reads
--     results_hematology_history / results_chemistry_history instead of
--     the single-row current-panel tables.
--
-- RLS — same protection level as the source tables (migration_v2.8),
-- using its existing helper functions. These are new tables, so they get
-- their own policies here rather than being silently left open.
--
-- Idempotent — safe to re-run. This file only produces SQL for review;
-- it is not applied automatically. Run after migration_v2.8.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — results_hematology_history
-- ───────────────────────────────────────────────────────────────────────

create table if not exists public.results_hematology_history (
  id              bigint generated always as identity primary key,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  analyzer        text,
  analysis_date   date,
  notes           text,
  specimen        text,
  performed_by    uuid,
  has_critical    boolean,
  wbc numeric, rbc numeric, hgb numeric, hct numeric, mcv numeric, mch numeric,
  mchc numeric, rdw numeric, nrbc numeric, plt numeric, mpv numeric, pdw numeric,
  neut numeric, lymph numeric, mono numeric, eosi numeric, baso numeric,
  neut_abs numeric, lymph_abs numeric, mono_abs numeric, eosi_abs numeric, baso_abs numeric,
  pt numeric, inr numeric, aptt numeric, tt numeric, fibg numeric, ddimer numeric, esr numeric,
  blood_group     text,
  rh_factor       text,
  film_result     text,
  film_comment    text,
  is_verified     boolean,
  verified_at     timestamptz,
  recorded_at     timestamptz not null default now()
);

create index if not exists results_hematology_history_patient_idx
  on public.results_hematology_history (patient_id, recorded_at desc);

alter table public.results_hematology_history enable row level security;

drop policy if exists results_hematology_history_select on public.results_hematology_history;
create policy results_hematology_history_select on public.results_hematology_history
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists results_hematology_history_insert on public.results_hematology_history;
create policy results_hematology_history_insert on public.results_hematology_history
  for insert with check (public.is_admin() or public.is_lab_staff());

-- No update/delete policy anywhere in this file, on purpose — this table is
-- append-only by design. If a bad row needs correcting, that's a new
-- corrective row + admin-only manual cleanup, not an app-level update path.

revoke all on public.results_hematology_history from anon;
grant select, insert on public.results_hematology_history to authenticated;
grant usage, select on sequence results_hematology_history_id_seq to authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — results_chemistry_history
-- ───────────────────────────────────────────────────────────────────────

create table if not exists public.results_chemistry_history (
  id              bigint generated always as identity primary key,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  analyzer        text,
  analysis_date   date,
  notes           text,
  specimen        text,
  performed_by    uuid,
  has_critical    boolean,
  tbil numeric, dbil numeric, ibil numeric, alt numeric, ast numeric, alp numeric, ggt numeric,
  tp numeric, alb numeric, creat numeric, urea numeric, ua numeric, egfr numeric,
  na numeric, k numeric, cl numeric, co2 numeric, ca numeric, phos numeric, mg numeric,
  fbs numeric, rbs numeric, ppbs numeric, hba1c numeric, ins numeric, cpep numeric,
  tchol numeric, ldl numeric, hdl numeric, trig numeric,
  troponin_i numeric, hs_tnt numeric, ck numeric, ckmb numeric, nt_probnp numeric,
  hs_crp numeric, ldh numeric,
  is_verified     boolean,
  verified_at     timestamptz,
  recorded_at     timestamptz not null default now()
);

create index if not exists results_chemistry_history_patient_idx
  on public.results_chemistry_history (patient_id, recorded_at desc);

alter table public.results_chemistry_history enable row level security;

drop policy if exists results_chemistry_history_select on public.results_chemistry_history;
create policy results_chemistry_history_select on public.results_chemistry_history
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists results_chemistry_history_insert on public.results_chemistry_history;
create policy results_chemistry_history_insert on public.results_chemistry_history
  for insert with check (public.is_admin() or public.is_lab_staff());

revoke all on public.results_chemistry_history from anon;
grant select, insert on public.results_chemistry_history to authenticated;
grant usage, select on sequence results_chemistry_history_id_seq to authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — one-time backfill (optional but recommended)
-- ───────────────────────────────────────────────────────────────────────
-- Seeds one history row per existing patient from whatever is currently
-- sitting in the current-panel tables, so trend charts and delta-checking
-- have at least one real historical point immediately instead of staying
-- empty until each patient's next save. Guarded by NOT EXISTS so re-running
-- this migration never double-inserts. Safe to delete this section if you
-- would rather start history clean from the next save onward.

insert into public.results_hematology_history (
  patient_id, analyzer, analysis_date, notes, specimen, performed_by, has_critical,
  wbc, rbc, hgb, hct, mcv, mch, mchc, rdw, nrbc, plt, mpv, pdw,
  neut, lymph, mono, eosi, baso, neut_abs, lymph_abs, mono_abs, eosi_abs, baso_abs,
  pt, inr, aptt, tt, fibg, ddimer, esr,
  blood_group, rh_factor, film_result, film_comment, is_verified, verified_at, recorded_at
)
select
  r.patient_id, r.analyzer, r.analysis_date, r.notes, r.specimen, r.performed_by, r.has_critical,
  r.wbc, r.rbc, r.hgb, r.hct, r.mcv, r.mch, r.mchc, r.rdw, r.nrbc, r.plt, r.mpv, r.pdw,
  r.neut, r.lymph, r.mono, r.eosi, r.baso, r.neut_abs, r.lymph_abs, r.mono_abs, r.eosi_abs, r.baso_abs,
  r.pt, r.inr, r.aptt, r.tt, r.fibg, r.ddimer, r.esr,
  r.blood_group, r.rh_factor, r.film_result, r.film_comment, r.is_verified, r.verified_at,
  coalesce(r.created_at, now())
from public.results_hematology r
where not exists (
  select 1 from public.results_hematology_history h where h.patient_id = r.patient_id
);

insert into public.results_chemistry_history (
  patient_id, analyzer, analysis_date, notes, specimen, performed_by, has_critical,
  tbil, dbil, ibil, alt, ast, alp, ggt, tp, alb, creat, urea, ua, egfr,
  na, k, cl, co2, ca, phos, mg,
  fbs, rbs, ppbs, hba1c, ins, cpep,
  tchol, ldl, hdl, trig,
  troponin_i, hs_tnt, ck, ckmb, nt_probnp, hs_crp, ldh,
  is_verified, verified_at, recorded_at
)
select
  r.patient_id, r.analyzer, r.analysis_date, r.notes, r.specimen, r.performed_by, r.has_critical,
  r.tbil, r.dbil, r.ibil, r.alt, r.ast, r.alp, r.ggt, r.tp, r.alb, r.creat, r.urea, r.ua, r.egfr,
  r.na, r.k, r.cl, r.co2, r.ca, r.phos, r.mg,
  r.fbs, r.rbs, r.ppbs, r.hba1c, r.ins, r.cpep,
  r.tchol, r.ldl, r.hdl, r.trig,
  r.troponin_i, r.hs_tnt, r.ck, r.ckmb, r.nt_probnp, r.hs_crp, r.ldh,
  r.is_verified, r.verified_at,
  coalesce(r.created_at, now())
from public.results_chemistry r
where not exists (
  select 1 from public.results_chemistry_history h where h.patient_id = r.patient_id
);

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.17_lab_result_history.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select count(*) from public.results_hematology_history;
--   select count(*) from public.results_chemistry_history;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public'
--     and tablename in ('results_hematology_history','results_chemistry_history')
--     order by tablename, cmd;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.18_payment_deferral.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.18_payment_deferral.sql
-- STAT payment deferral columns for doctor-placed orders
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   checkPaymentGate()/isPaymentCleared() (index.html) already gate Lab
--   Order, Radiology Order, standalone Radiology Request, and Sample
--   Collection actions — but as a hard block for unpaid/insurance_pending,
--   with no way for a doctor to proceed on a genuinely urgent (STAT) order
--   while payment is still outstanding. Nursing/Diet/Physio/Other order
--   submission (submitNursingOrder/submitDietOrder/submitPhysioOrder/
--   submitOtherOrder) had NO payment gate at all. Sample Collection's own
--   queue (loadSampleQueue) and Radiology's request queue (loadRadRequests)
--   show every order regardless of payment status today, just visually
--   tagged unpaid.
--
-- WHAT THIS MIGRATION ADDS
--   Four columns, added identically to sample_records, radiology_requests,
--   and doctor_orders — the STAT PAYMENT DEFERRAL audit trail. This is a
--   deferral, not a bypass: the invoice/patient payment_status is
--   completely untouched by granting one; these columns only record that a
--   specific order was allowed to proceed anyway, by whom, and when.
--     payment_deferred          boolean default false
--     payment_deferred_by       uuid          — currentProfile.id of the doctor who granted it
--     payment_deferred_by_name  text          — denormalized display name (staff rows can be deleted/renamed later; this is what was true at the time)
--     payment_deferred_at       timestamptz
--
-- WHY doctor_orders TOO, EVEN THOUGH IT HAS NO RLS OF ITS OWN
--   (See the standalone note at the end of this file — doctor_orders was
--   never covered by migration_v2.8 and still has row level security
--   disabled. Not fixed here; flagging rather than silently leaving it,
--   same as migration_v2.14 did for reagent_inventory before its own
--   follow-up migration_v2.16.) The columns are added anyway because
--   loadActiveOrders() (the doctor's own order list, inside Doctor
--   Consultation) reads doctor_orders directly and is where the ordering
--   doctor sees the "⚠ Payment Deferred — STAT" flag on their own order.
--
-- WHAT READS/WRITES THESE COLUMNS (see index.html changes in the same
-- commit as this migration)
--   - checkPaymentGate() gains an opts.isStat/opts.onDeferred path: for an
--     unpaid/insurance_pending patient on a STAT order, the doctor is asked
--     to explicitly grant a deferral (confirm dialog) instead of a flat
--     block.
--   - submitLabOrder()/_submitLabOrder(), submitRadOrder()/_submitRadOrder(),
--     submitRadRequest()/_doSubmitRadRequest() set these columns on the
--     doctor_orders row and (for Lab) the sample_records row / (for
--     Radiology) the radiology_requests row.
--   - submitNursingOrder/submitDietOrder/submitPhysioOrder/submitOtherOrder
--     now also go through checkPaymentGate (previously ungated) — they have
--     no STAT/urgency field in their forms today, so they get the existing
--     hard-block/partial-confirm behaviour, not the deferral path.
--   - loadSampleQueue() (Sample Collection) and loadRadRequests() (Radiology
--     Requests) now hide a row entirely when its patient is unpaid/
--     insurance_pending UNLESS payment_deferred is true, in which case it
--     still shows with a distinct "⚠ Payment Deferred — STAT" badge.
--   - refreshNotifications() (notification bell) gains a new category:
--     any payment_deferred order whose result is now done (sample_records
--     status='Released' / radiology_requests status='Reported') while the
--     patient is STILL unpaid/insurance_pending resurfaces there
--     immediately, not just once the existing time-based unpaid-invoice
--     threshold passes.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.8 (sample_records/
-- radiology_requests RLS) and migration_v2.17.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.sample_records add column if not exists payment_deferred boolean default false;
alter table public.sample_records add column if not exists payment_deferred_by uuid;
alter table public.sample_records add column if not exists payment_deferred_by_name text;
alter table public.sample_records add column if not exists payment_deferred_at timestamptz;

alter table public.radiology_requests add column if not exists payment_deferred boolean default false;
alter table public.radiology_requests add column if not exists payment_deferred_by uuid;
alter table public.radiology_requests add column if not exists payment_deferred_by_name text;
alter table public.radiology_requests add column if not exists payment_deferred_at timestamptz;

alter table public.doctor_orders add column if not exists payment_deferred boolean default false;
alter table public.doctor_orders add column if not exists payment_deferred_by uuid;
alter table public.doctor_orders add column if not exists payment_deferred_by_name text;
alter table public.doctor_orders add column if not exists payment_deferred_at timestamptz;

comment on column public.sample_records.payment_deferred is
  'True when a doctor granted an explicit STAT payment deferral at order time (see checkPaymentGate() in index.html) — the specimen/order was allowed to proceed to the lab queue despite the patient being unpaid/insurance_pending. Does not affect the invoice or patient.payment_status in any way; this is audit/visibility only.';
comment on column public.radiology_requests.payment_deferred is
  'Same STAT payment deferral flag as sample_records.payment_deferred, for radiology orders/requests.';
comment on column public.doctor_orders.payment_deferred is
  'Same STAT payment deferral flag as sample_records.payment_deferred — set here too so the ordering doctor sees it on their own active-orders list (loadActiveOrders() in index.html), regardless of order_type.';

-- ═══════════════════════════════════════════════════════════════════════
-- NOTE ON A PRE-EXISTING GAP (not introduced by this migration, flagging
-- rather than silently leaving it, same convention migration_v2.14 used
-- for reagent_inventory): doctor_orders has never had row level security
-- enabled — it was not in migration_v2.8's scope and no later migration
-- has covered it either. Any authenticated user can currently read/write
-- any row in it, including the payment-deferral audit columns this
-- migration adds. If you want it locked down, that's a small follow-up
-- migration in the same style as migration_v2.16_reagent_inventory_rls.sql
-- (SELECT broad to whoever currently reads it — clinical staff via
-- loadActiveOrders() — WRITE scoped to doctor + admin, matching who the
-- app's own submit*Order() functions actually call .insert() as), not
-- something to fold in here silently.
-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.18_payment_deferral.sql
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.19_visit_status_and_followup.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.19_visit_status_and_followup.sql
-- Visit-level status tracking, consultation sign-off lock, follow-up
-- scheduling
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   sample_records.status tracks ONE specimen's collection state
--   (Pending/Collected/Received/Processing/Completed/Released) — it says
--   nothing about the visit as a whole (a visit might have no lab orders
--   at all, or a Nursing/Radiology order with no sample_records row
--   involved). There was no visit-level status anywhere. doctor_consultations
--   had no lock/attestation mechanism at all — a saved consultation note
--   could be edited indefinitely, unlike the existing verify/release lock
--   on lab results (applyResultLock()/canOverrideResultLock() in
--   index.html). There was no follow-up-visit concept anywhere in the
--   schema.
--
-- SECTION 1 — patients.visit_status
--   Six states were specified, but only FIVE are stored:
--     Registered -> With Doctor -> Orders Pending -> Results Ready -> Visit Complete
--   "Payment Pending" is deliberately NOT a sixth stored value — it's
--   computed client-side (effectiveVisitStatus() in index.html) as an
--   overlay whenever the stored status is still 'Registered' AND
--   patient.payment_status is unpaid/insurance_pending. Storing it as a
--   real transition would need an explicit trigger to leave it (nothing
--   in the spec says what un-sticks a visit from "Payment Pending" other
--   than payment itself, which is already tracked by payment_status) —
--   computing it avoids a second source of truth that could drift out of
--   sync with payment_status.
--
-- SECTION 2 — doctor_consultations sign-off columns
--   Mirrors results_hematology/results_chemistry's is_verified pattern
--   exactly (same idea: signed_off_by/_by_name/_at is the audit trail),
--   read/written by index.html's applyConsultationNotesLock()/
--   completeAndSignOffVisit() — same "lock the form once attested, only
--   admin can override" convention as applyResultLock()/
--   canOverrideResultLock() use for lab results.
--
-- SECTION 3 — follow_ups
--   One row per scheduled follow-up. Keyed by patient_mrn (the permanent,
--   cross-visit identity — patients.id is regenerated fresh every visit
--   per submitRegistration(), so a follow-up scheduled during visit A has
--   to be found again during visit B by mrn, not by patients.id).
--   origin_patient_id keeps a reference to the visit it was scheduled
--   from, for display; used/used_at/used_patient_id record when/if
--   Phase 5's reception-side follow-up-pricing prompt was actually
--   confirmed and applied to a later registration, so the same follow-up
--   can never be applied twice.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.8.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — patients.visit_status
-- ───────────────────────────────────────────────────────────────────────

alter table public.patients add column if not exists visit_status text default 'Registered'
  check (visit_status in ('Registered','With Doctor','Orders Pending','Results Ready','Visit Complete'));

comment on column public.patients.visit_status is
  'Visit-level status, distinct from sample_records.status (which tracks one specimen, not the whole visit). Advances automatically (see advanceVisitStatus() in index.html) except the final Visit Complete transition, which only completeAndSignOffVisit() (doctor-only, via "Complete & Sign Off") ever sets. "Payment Pending" is a computed display-only overlay, not a stored value here — see effectiveVisitStatus().';


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — doctor_consultations sign-off / lock columns
-- ───────────────────────────────────────────────────────────────────────

alter table public.doctor_consultations add column if not exists is_signed_off boolean default false;
alter table public.doctor_consultations add column if not exists signed_off_by uuid;
alter table public.doctor_consultations add column if not exists signed_off_by_name text;
alter table public.doctor_consultations add column if not exists signed_off_at timestamptz;

comment on column public.doctor_consultations.is_signed_off is
  'Set by completeAndSignOffVisit() in index.html (the Consultation workspace''s "Complete & Sign Off" action) — a clinical attestation, same seriousness as the existing is_verified lock on lab results. Once true, applyConsultationNotesLock() disables every field in the Notes tab; only an admin (canOverrideConsultationLock()) can unlock it to edit.';


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — follow_ups
-- ───────────────────────────────────────────────────────────────────────

create table if not exists public.follow_ups (
  id                  bigint generated always as identity primary key,
  patient_mrn         text not null,
  origin_patient_id   uuid references public.patients(id) on delete set null,
  scheduled_by        uuid,
  scheduled_by_name   text,
  target_date         date not null,
  reason              text,
  created_at          timestamptz not null default now(),
  used                boolean not null default false,
  used_at             timestamptz,
  used_patient_id     uuid references public.patients(id) on delete set null
);

create index if not exists follow_ups_mrn_idx on public.follow_ups (patient_mrn, used);

comment on table public.follow_ups is
  'Created by completeAndSignOffVisit()''s "Schedule a follow-up?" prompt in Doctor Consultation. Read at Registration (submitRegistration() in index.html) to offer follow-up pricing (see migration_v2.20 / Phase 5) — patient_mrn is the lookup key since patients.id is a fresh uuid every visit. used/used_at/used_patient_id are set the moment a registration actually applies the follow-up pricing, so the same scheduled follow-up can never be reused for an unrelated later visit.';

alter table public.follow_ups enable row level security;

drop policy if exists follow_ups_select on public.follow_ups;
create policy follow_ups_select on public.follow_ups
  for select using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

drop policy if exists follow_ups_insert on public.follow_ups;
create policy follow_ups_insert on public.follow_ups
  for insert with check (public.is_admin() or public.current_staff_role()='doctor');

drop policy if exists follow_ups_update on public.follow_ups;
create policy follow_ups_update on public.follow_ups
  for update using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

revoke all on public.follow_ups from anon;
grant select, insert, update on public.follow_ups to authenticated;
grant usage, select on sequence follow_ups_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.19_visit_status_and_followup.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select visit_status, count(*) from public.patients group by visit_status;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'follow_ups' order by cmd;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.20_bed_status_expansion.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.20_bed_status_expansion.sql
-- Bed Management (IPD) overhaul, Phase 2 — expand beds.status beyond
-- Available/Occupied so the visual ward bed-grid can show four states.
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   public.beds (id, ward, room, bed_number, status, current_patient_id,
--   current_admission_id) is a pre-existing table (older than the
--   numbered migration_v2.x series — no migration file in this repo
--   created it). Every place in index.html that writes beds.status today
--   only ever writes 'Available' or 'Occupied':
--     addBedConfig()      -> insert status:'Available'
--     submitAdmission()   -> update status:'Occupied' (on admit)
--     saveDischarge()     -> update status:'Available' (on discharge)
--     (bulk cleanup path) -> update status:'Available'
--   There is no evidence beds.status currently has a check constraint at
--   all (nothing in this repo defines one), but since the column has only
--   ever been written as one of those two literal strings, whatever
--   constraint (if any) exists in the live database was likely never
--   exercised beyond them. This migration is defensive either way: it
--   drops any existing check constraint by name (if present) and adds a
--   new one covering all five values, which is a no-op for existing rows
--   since 'Available'/'Occupied' are both still included.
--
-- WHAT THIS ADDS
--   Two more states so the bed-grid (Phase 2) can render:
--     Available        (green)  — unchanged, already exists
--     Occupied          (red)   — unchanged, already exists
--     Cleaning          (amber) — bed vacated, being turned over
--     Maintenance       (amber) — bed out of service (repair, etc.)
--     Discharge Pending (blue)  — patient still physically in the bed,
--                                  discharge process started but the bed
--                                  is not free yet
--   'Cleaning' and 'Maintenance' are kept as two distinct values (not
--   collapsed into one "Cleaning/Maintenance" string) because Phase 5b's
--   turnaround SLA timer needs to know which one it's timing, even though
--   both currently render with the same amber tile treatment in the grid.
--
-- Nothing in this file touches current_patient_id/current_admission_id
-- semantics or any existing row's status value — purely additive.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.19.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.beds drop constraint if exists beds_status_check;

alter table public.beds add constraint beds_status_check
  check (status in ('Available','Occupied','Cleaning','Maintenance','Discharge Pending'));

alter table public.beds alter column status set default 'Available';

comment on column public.beds.status is
  'Bed-grid status (Bed Management / IPD, index.html). Available/Occupied are the original two values, written by submitAdmission()/saveDischarge(). Cleaning, Maintenance and Discharge Pending are set manually from the bed-grid tile menu (setBedStatus() in index.html) — Cleaning/Maintenance block new admissions client-side; Discharge Pending is informational only (the bed frees for real when saveDischarge() actually runs).';

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.20_bed_status_expansion.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, count(*) from public.beds group by status;
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.beds'::regclass;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.21_bed_transfers.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.21_bed_transfers.sql
-- Bed Management (IPD) overhaul, Phase 3 — ward/bed transfer log
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   Nothing like a ward/bed transfer existed anywhere in the schema or
--   index.html before this. admissions.ward/room/bed are plain free-text
--   columns (not FKs) that submitAdmission() sets once at admission and
--   saveDischarge() never touches again — there was no path that updated
--   them mid-stay, and no record of a bed having changed hands.
--
-- WHAT THIS ADDS
--   One row per transfer, written by submitBedTransfer() (index.html, the
--   per-bed drawer's new Transfer tab) — logs the timestamp, who did it,
--   why, and both the old and new ward/room/bed, then the same function
--   updates admissions.ward/room/bed to the new location and re-points
--   the beds table (frees the old bed, occupies the new one) using the
--   exact same two beds writes submitAdmission()/saveDischarge() already
--   make elsewhere — no new bed-linking convention introduced.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.20.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.bed_transfers (
  id                  bigint generated always as identity primary key,
  admission_id        uuid not null references public.admissions(id) on delete cascade,
  patient_id          uuid references public.patients(id) on delete set null,
  from_ward           text,
  from_room           text,
  from_bed            text,
  to_ward             text not null,
  to_room             text not null,
  to_bed              text not null,
  reason              text not null,
  transferred_by      uuid,
  transferred_by_name text,
  transferred_at      timestamptz not null default now()
);

create index if not exists bed_transfers_admission_idx on public.bed_transfers (admission_id, transferred_at);

comment on table public.bed_transfers is
  'Ward/bed transfer log, written by submitBedTransfer() (index.html, per-bed drawer Transfer tab). One row per transfer; admissions.ward/room/bed always reflects the CURRENT location, this table is the history.';

alter table public.bed_transfers enable row level security;

drop policy if exists bed_transfers_select on public.bed_transfers;
create policy bed_transfers_select on public.bed_transfers
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists bed_transfers_insert on public.bed_transfers;
create policy bed_transfers_insert on public.bed_transfers
  for insert with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.bed_transfers from anon;
grant select, insert on public.bed_transfers to authenticated;
grant usage, select on sequence bed_transfers_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.21_bed_transfers.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'bed_transfers' order by cmd;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.22_bed_status_changed_at.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.22_bed_status_changed_at.sql
-- Bed Management (IPD) overhaul, Phase 5b — bed-turnaround SLA timer
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   public.beds has no timestamp column at all today, so there was no way
--   to know how long a bed had been sitting in any given status. This
--   codebase never uses database triggers for timestamp bookkeeping —
--   every other "when did this last change" field (e.g. results_*.
--   verified_at, doctor_consultations.signed_off_at) is set explicitly by
--   the client at write time, not by a trigger — so this migration keeps
--   that same convention rather than introducing the first trigger.
--
-- WHAT THIS ADDS
--   beds.status_changed_at, set by index.html on every write that changes
--   beds.status: submitAdmission() (Available -> Occupied), saveDischarge()
--   and submitBedTransfer() (-> Available / -> Occupied), setBedStatus()
--   (the bed-grid tile's manual status menu — Cleaning/Maintenance/
--   Discharge Pending), and addBedConfig() (initial insert). The bed-grid
--   tile (renderBedGrid() / bedTurnaroundMinutes() in index.html) reads
--   this to show elapsed time on Cleaning/Maintenance beds and escalate
--   the tile's colour past the two admin-configurable thresholds
--   (Settings -> Bed Turnaround SLA card).
--
-- Existing rows get status_changed_at backfilled to now() (Section 2) —
-- there's no earlier truth to backfill from, so "as of when this
-- migration ran" is the only honest starting point; every write after
-- that keeps it accurate going forward.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.21.
-- ═══════════════════════════════════════════════════════════════════════

-- SECTION 1 — add the column
alter table public.beds add column if not exists status_changed_at timestamptz;

comment on column public.beds.status_changed_at is
  'When beds.status last changed, set explicitly by index.html on every status-changing write (never a trigger — see migration file header). Drives the bed-grid turnaround SLA timer for Cleaning/Maintenance tiles.';

-- SECTION 2 — one-time backfill for existing rows only (does not touch
-- rows that already have a value, e.g. from a re-run of this migration)
update public.beds set status_changed_at = now() where status_changed_at is null;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.22_bed_status_changed_at.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, count(*), min(status_changed_at), max(status_changed_at)
--     from public.beds group by status;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.23_discharge_planning_started_at.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.23_discharge_planning_started_at.sql
-- Bed Management (IPD) overhaul, Phase 5c — discharge-readiness flag
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   The spec's second trigger condition ("a discharge summary exists in
--   draft but hasn't been finalized") assumes draft semantics that do not
--   exist in this schema: discharge_summaries has no status/draft column
--   at all, and saveDischarge() (index.html) is atomic — filling in the
--   discharge form and submitting it inserts the summary, marks the
--   admission Discharged, AND frees the bed all in one action. There is
--   no half-finished state a discharge summary can be left in today, and
--   building one (a real "Save Draft" vs "Finalize Discharge" split)
--   would restructure a working, tested flow far beyond what a tile badge
--   calls for.
--
--   The honest, low-risk equivalent implemented instead: track when
--   discharge PLANNING started (the Discharge form was opened for this
--   admission) via one new nullable timestamp column, set once by
--   openDischarge() and left alone afterward. If the admission is still
--   Active despite that timestamp being set, discharge was started but
--   never completed — the same practical signal the spec's condition was
--   after, without inventing draft-state schema/UI nothing else asked for.
--
-- WHAT THIS ADDS
--   admissions.discharge_planning_started_at, read by
--   dischargeReadinessFlag() in index.html (bed-grid tile badge, Occupied/
--   Discharge Pending beds only) alongside the LOS-vs-ward-average
--   condition — either is sufficient to show the "🏁 Check discharge?"
--   badge. Purely a prompt for the charge nurse; nothing reads or writes
--   this column to change behavior automatically.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.22.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.admissions add column if not exists discharge_planning_started_at timestamptz;

comment on column public.admissions.discharge_planning_started_at is
  'Set once, the first time openDischarge() (index.html) opens the discharge form for this admission. Read by dischargeReadinessFlag() as one of two rule-based, non-predictive triggers for the bed-grid "Check discharge?" badge — the other is LOS exceeding the ward''s own current average. Never cleared, but only matters while admissions.status is still Active (a Discharged admission is no longer shown as an Occupied bed-grid tile at all).';

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.23_discharge_planning_started_at.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, count(*) filter (where discharge_planning_started_at is not null)
--     from public.admissions group by status;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.24_blood_bank_units.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.24_blood_bank_units.sql
-- Blood Bank / Transfusion Services, Phase 1 — blood unit inventory
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   reagent_inventory + inventory_batches (migration_v2.14) already give
--   this app a working FEFO (First-Expiry-First-Out) engine —
--   computeExpiryStatus()/dispenseFromInventoryFefo() in index.html. That
--   engine models an ITEM (e.g. "Glucose Reagent") with many interchangeable
--   BATCHES, each just an aggregate quantity + one shared expiry date —
--   perfectly right for reagent stock, wrong for blood units. A blood unit
--   is not fungible: unit BB-2026-0001 is a specific bag with its own
--   barcode, its own individual lifecycle (Quarantined -> Available ->
--   Crossmatched -> Issued, or Expired/Discarded), and it gets reserved
--   against ONE specific patient's request, never "any 2 of this batch."
--   So this is a new table, not a reuse of inventory_batches — but it
--   deliberately mirrors that engine's SHAPE (expiry_date, status,
--   FEFO-style sorted allocation) and reuses computeExpiryStatus()'s exact
--   colour thresholds/logic directly (called client-side against
--   blood_units.expiry_date, not duplicated) so units and reagents look
--   and behave the same way in the UI.
--
--   Blood group/Rh already exists per-patient on results_hematology
--   (blood_group/rh_factor columns, one row per patient) — Blood Bank
--   reads that as the source of truth for a PATIENT's type (see Phase 3's
--   crossmatch check) rather than storing it a second time anywhere
--   patient-side; blood_units.blood_group/rh_factor below is the UNIT's
--   own type, a completely different thing (donor/supplier-typed), and
--   both must independently be on file before Phase 3 can crossmatch them
--   against each other.
--
-- WHAT THIS ADDS
--   blood_units — one row per physical unit. source/donor-linkage fields
--   (donor_id, external receipt fields) are deliberately NOT added here —
--   Phase 2's own migration adds those once the donor-registration and
--   external-receipt tables exist, keeping each migration scoped to what
--   its own phase actually needs, same discipline as every prior phased
--   migration in this repo.
--
--   unit_no is generated client-side the same simple way admissions.
--   admission_no already is (index.html's submitAdmission(): a
--   count-based 'BB-<year>-<seq>' format) rather than wiring it into the
--   generate_next_id()/COUNTER_TO_ID_TYPE system used for
--   MRN/OPD/IP/lab/radiology numbers — those are patient-identity numbers
--   where a collision is a much more serious safety issue than here, and
--   admission_no already establishes this simpler pattern is an accepted
--   choice in this codebase for a non-patient-identity sequence.
--
-- Component-specific default shelf-life (AABB standard, days) is a
-- client-side Settings default (CFG.bloodShelfLife*), not stored here —
-- same pattern as every other admin-configurable numeric threshold in
-- this app (e.g. CFG.bedTurnaroundAmberMin). expiry_date itself is always
-- an explicit, staff-entered value at intake (Phase 2), never silently
-- computed and hidden from the person recording the unit.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.23.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.blood_units (
  id               uuid primary key default gen_random_uuid(),
  unit_no          text not null unique,
  blood_group      text not null check (blood_group in ('A','B','AB','O')),
  rh_factor        text not null check (rh_factor in ('Positive','Negative')),
  component_type   text not null check (component_type in ('Whole Blood','Packed RBC','FFP','Platelets','Cryoprecipitate')),
  collection_date  date,
  expiry_date      date not null,
  volume_ml        numeric,
  source           text not null check (source in ('In-House Donation','Received - External Supply')),
  status           text not null default 'Quarantined' check (status in ('Quarantined','Available','Crossmatched','Issued','Expired','Discarded')),
  discard_reason   text,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now()
);

create index if not exists blood_units_status_idx on public.blood_units (status);
create index if not exists blood_units_expiry_idx on public.blood_units (expiry_date);
create index if not exists blood_units_group_idx on public.blood_units (blood_group, rh_factor, component_type, status);

comment on table public.blood_units is
  'One row per physical blood unit (Blood Bank / Transfusion Services module, index.html). Deliberately separate from reagent_inventory/inventory_batches — see migration file header for why. status lifecycle: Quarantined (just intaken, screening/verification not yet cleared) -> Available (cleared, in general stock) -> Crossmatched (reserved against one specific blood_requests row, Phase 3) -> Issued (handed over via the mandatory two-person verification, Phase 4) — or Expired/Discarded at any point before Issued, always with discard_reason set (no silent removals).';
comment on column public.blood_units.source is
  'Provenance tracking only, per spec — does not fork downstream behaviour. In-House Donation units additionally link to a donor/collection record (Phase 2 migration adds donor_id once that table exists); External Supply units additionally record the supplying organisation''s own reference (Phase 2 migration adds those columns too).';

alter table public.blood_units enable row level security;

drop policy if exists blood_units_select on public.blood_units;
create policy blood_units_select on public.blood_units
  for select using (public.is_admin() or public.is_clinical_staff());

-- Update is intentionally broader than just lab staff: Phase 4's mandatory
-- two-person issue verification requires a RECEIVING nurse/doctor
-- (is_clinical_staff(), not just is_lab_staff()) to also be able to write
-- their own independent confirmation onto the same unit row — scoping
-- this now avoids a second migration just to widen the policy later.
drop policy if exists blood_units_insert on public.blood_units;
create policy blood_units_insert on public.blood_units
  for insert with check (public.is_admin() or public.is_lab_staff());

drop policy if exists blood_units_update on public.blood_units;
create policy blood_units_update on public.blood_units
  for update using (public.is_admin() or public.is_clinical_staff())
  with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.blood_units from anon;
grant select, insert, update on public.blood_units to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.24_blood_bank_units.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, component_type, count(*) from public.blood_units
--     group by status, component_type order by status, component_type;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'blood_units' order by cmd;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.25_blood_bank_intake.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.25_blood_bank_intake.sql
-- Blood Bank / Transfusion Services, Phase 2 — dual-source unit intake
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   migration_v2.24 (Phase 1) deliberately left blood_units' source-
--   specific linkage out — this migration adds exactly what each of the
--   two intake paths needs, nothing added speculatively.
--
-- WHAT THIS ADDS
--   Path A (In-House Donation):
--     blood_donors      — one row per donor, reusable across repeat
--                          donations (donation history = every
--                          blood_donations row with this donor_id).
--     blood_donations    — one row per collection EVENT. Carries the
--                          eligibility screening questionnaire answers
--                          and the mandatory infectious-disease screening
--                          results (HIV/HBV/HCV/Syphilis/Malaria). A
--                          donation only becomes `cleared` once every
--                          result is recorded Negative — clearDonation()
--                          in index.html is the only thing allowed to move
--                          its linked blood_units out of Quarantined.
--     blood_units.donation_id — added by this migration, links a unit
--                          back to the donation event that produced it (a
--                          single collection can produce more than one
--                          unit, e.g. several identical-expiry bags from
--                          one donation — they all share one donation_id).
--
--   Path B (External Receipt) — lighter-weight, no donor/donation
--   records at all (there is no local donor); everything it needs is
--   columns added directly to blood_units: which organisation supplied
--   it, their own unit reference, what they attest about their own
--   screening (recorded as their attestation, never re-derived or
--   verified beyond that — per spec, "record what they attest"), and the
--   mandatory (not skippable) "Verified on Receipt" confirmation that the
--   physical unit's own label matches what was recorded, before the unit
--   can leave Quarantined.
--
-- Both paths still converge on the exact same blood_units row/status
-- lifecycle from Phase 1 — this migration only adds how a unit GOT there,
-- never a second status system.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.24.
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — Path A: donors + donations
-- ───────────────────────────────────────────────────────────────────────

create table if not exists public.blood_donors (
  id                    uuid primary key default gen_random_uuid(),
  donor_no              text not null unique,
  full_name             text not null,
  age                   integer,
  sex                   text,
  phone                 text,
  blood_group           text check (blood_group in ('A','B','AB','O')),
  rh_factor             text check (rh_factor in ('Positive','Negative')),
  address               text,
  created_by            uuid,
  created_by_name       text,
  created_at            timestamptz not null default now()
);

comment on table public.blood_donors is
  'One row per donor (Blood Bank Phase 2, In-House Donation path). Donation history = every blood_donations row with this donor_id — nothing here is duplicated per-donation.';

create table if not exists public.blood_donations (
  id                       uuid primary key default gen_random_uuid(),
  donor_id                 uuid not null references public.blood_donors(id) on delete cascade,
  collection_date          date not null default current_date,
  -- Eligibility screening questionnaire (basic deferral criteria)
  recent_illness           boolean not null default false,
  on_medication             boolean not null default false,
  recent_travel             boolean not null default false,
  prior_deferral             boolean not null default false,
  deferral_notes            text,
  -- Mandatory infectious-disease screening — each starts Pending; a
  -- donation is only `cleared` once every one of these is 'Negative'.
  hiv_result                text not null default 'Pending' check (hiv_result in ('Pending','Negative','Positive')),
  hbv_result                text not null default 'Pending' check (hbv_result in ('Pending','Negative','Positive')),
  hcv_result                text not null default 'Pending' check (hcv_result in ('Pending','Negative','Positive')),
  syphilis_result           text not null default 'Pending' check (syphilis_result in ('Pending','Negative','Positive')),
  malaria_result            text not null default 'Pending' check (malaria_result in ('Pending','Negative','Positive')),
  cleared                   boolean not null default false,
  screened_by               text,
  screened_at               timestamptz,
  created_by                uuid,
  created_by_name           text,
  created_at                timestamptz not null default now()
);

create index if not exists blood_donations_donor_idx on public.blood_donations (donor_id);
create index if not exists blood_donations_cleared_idx on public.blood_donations (cleared);

comment on table public.blood_donations is
  'One row per collection event (Blood Bank Phase 2). cleared is set true only when every one of hiv_result/hbv_result/hcv_result/syphilis_result/malaria_result is Negative — clearDonation() (index.html) is the only path that sets it, and it is the only thing that moves this donation''s linked blood_units out of Quarantined.';

alter table public.blood_units add column if not exists donation_id uuid references public.blood_donations(id) on delete set null;
comment on column public.blood_units.donation_id is
  'Links a unit back to the In-House Donation collection event that produced it (Path A only — null for externally-received units). A single donation can produce more than one unit; all share the same donation_id.';

alter table public.blood_donors enable row level security;
drop policy if exists blood_donors_select on public.blood_donors;
create policy blood_donors_select on public.blood_donors for select using (public.is_admin() or public.is_lab_staff());
drop policy if exists blood_donors_insert on public.blood_donors;
create policy blood_donors_insert on public.blood_donors for insert with check (public.is_admin() or public.is_lab_staff());
drop policy if exists blood_donors_update on public.blood_donors;
create policy blood_donors_update on public.blood_donors for update using (public.is_admin() or public.is_lab_staff()) with check (public.is_admin() or public.is_lab_staff());
revoke all on public.blood_donors from anon;
grant select, insert, update on public.blood_donors to authenticated;

alter table public.blood_donations enable row level security;
drop policy if exists blood_donations_select on public.blood_donations;
create policy blood_donations_select on public.blood_donations for select using (public.is_admin() or public.is_lab_staff());
drop policy if exists blood_donations_insert on public.blood_donations;
create policy blood_donations_insert on public.blood_donations for insert with check (public.is_admin() or public.is_lab_staff());
drop policy if exists blood_donations_update on public.blood_donations;
create policy blood_donations_update on public.blood_donations for update using (public.is_admin() or public.is_lab_staff()) with check (public.is_admin() or public.is_lab_staff());
revoke all on public.blood_donations from anon;
grant select, insert, update on public.blood_donations to authenticated;

-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — Path B: external receipt fields directly on blood_units
-- ───────────────────────────────────────────────────────────────────────

alter table public.blood_units add column if not exists external_source_org text;
alter table public.blood_units add column if not exists external_unit_ref text;
alter table public.blood_units add column if not exists external_screening_attested text;
alter table public.blood_units add column if not exists received_by text;
alter table public.blood_units add column if not exists receipt_date date;
alter table public.blood_units add column if not exists verified_on_receipt boolean not null default false;
alter table public.blood_units add column if not exists verified_by text;
alter table public.blood_units add column if not exists verified_at timestamptz;

comment on column public.blood_units.external_screening_attested is
  'What the SUPPLYING organisation attests about their own screening (e.g. "Screened per national blood safety protocol, certificate #1234") — recorded as their claim, never re-derived or independently verified here. verified_on_receipt below is a separate, lighter check: does the physical unit''s own label match what was recorded at intake.';

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.25_blood_bank_intake.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select cleared, count(*) from public.blood_donations group by cleared;
--   select verified_on_receipt, count(*) from public.blood_units
--     where source = 'Received - External Supply' group by verified_on_receipt;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.26_blood_bank_requests.sql
-- #############################################################################

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


-- #############################################################################
-- ## migration_v2.27_blood_bank_issue.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.27_blood_bank_issue.sql
-- Blood Bank / Transfusion Services, Phase 4 — MANDATORY two-person
-- verified issue workflow
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   Existing Critical Values "acknowledge with read-back confirmation"
--   (acknowledgeCritical()/submitCritAck() in index.html) turned out, on
--   inspection, to only capture a clinician's NAME via a bare prompt() —
--   neither implementation makes anyone actually re-type/confirm the
--   value itself. That is not sufficient for handing over blood, so this
--   phase does NOT reuse that function as-is: instead it builds a real
--   typed re-entry confirmation (each confirmer re-types the patient MRN
--   and the unit number, compared against the actual values) for BOTH of
--   the two required confirmations.
--
--   The existing Anti-Fraud "Quick-PIN override" (requireOverride()/
--   submitOverridePassword() in index.html, migration_v2.12) already
--   solved a closely related problem — proving a SPECIFIC staff member's
--   identity, independent of who is currently logged in, without forcing
--   a full logout/login cycle — via a throwaway Supabase client
--   (`window.supabase.createClient(...)`) that signs in, reads the staff
--   row, and immediately signs out again, never disturbing the primary
--   session. This migration/phase reuses that exact TECHNIQUE for the
--   second (receiving) confirmer's identity check, but as a new,
--   non-admin-restricted function (verifyStaffCredentials() in
--   index.html) — the existing one is hardcoded to role='admin' only,
--   and a receiving nurse/doctor is very much not required to be an
--   admin.
--
-- WHAT THIS ADDS
--   blood_units gains crossmatch-attribution columns (who reserved it,
--   when) — crossmatchUnit() (Phase 3) is updated to stamp these, so the
--   full chain (reserved -> issued -> received) has a start.
--
--   blood_issue_log — one row per completed issue, APPEND-ONLY (no
--   update/delete policy granted at all, same durability posture as this
--   app's other audit-log tables) — reserved_by/issued_by/received_by
--   with names and timestamps for all three. This is the durable
--   traceability record; blood_units.status/issued_at etc. reflect
--   current state but this table is the permanent chain-of-custody log.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.26.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.blood_units add column if not exists crossmatched_by uuid;
alter table public.blood_units add column if not exists crossmatched_by_name text;
alter table public.blood_units add column if not exists crossmatched_at timestamptz;
alter table public.blood_units add column if not exists issued_by uuid;
alter table public.blood_units add column if not exists issued_by_name text;
alter table public.blood_units add column if not exists issued_at timestamptz;
alter table public.blood_units add column if not exists received_by uuid;
alter table public.blood_units add column if not exists received_by_name text;
alter table public.blood_units add column if not exists received_at timestamptz;

create table if not exists public.blood_issue_log (
  id                    uuid primary key default gen_random_uuid(),
  unit_id               uuid not null references public.blood_units(id) on delete restrict,
  request_id            uuid references public.blood_requests(id) on delete set null,
  patient_id            uuid not null references public.patients(id) on delete restrict,
  reserved_by           uuid,
  reserved_by_name      text,
  reserved_at           timestamptz,
  issued_by             uuid not null,
  issued_by_name        text not null,
  issued_at             timestamptz not null default now(),
  received_by           uuid not null,
  received_by_name      text not null,
  received_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint blood_issue_log_two_person check (issued_by is distinct from received_by)
);

create index if not exists blood_issue_log_unit_idx on public.blood_issue_log (unit_id);
create index if not exists blood_issue_log_patient_idx on public.blood_issue_log (patient_id);

comment on table public.blood_issue_log is
  'Permanent, append-only chain-of-custody record — who reserved (crossmatched) each issued unit, who issued it, who received it, and every timestamp. Written once by issueBloodUnit() (index.html) at the moment BOTH required independent confirmations (issuing staff + receiving staff, re-typed patient MRN + unit number each) succeed. blood_issue_log_two_person enforces at the database level that the same staff member cannot be both the issuer and the receiver — belt-and-braces alongside the client-side check.';

alter table public.blood_issue_log enable row level security;

drop policy if exists blood_issue_log_select on public.blood_issue_log;
create policy blood_issue_log_select on public.blood_issue_log
  for select using (public.is_admin() or public.is_clinical_staff());

-- Insert-only — no update/delete policy is granted to anyone (not even
-- admin), matching this table's append-only, permanent-record purpose.
drop policy if exists blood_issue_log_insert on public.blood_issue_log;
create policy blood_issue_log_insert on public.blood_issue_log
  for insert with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.blood_issue_log from anon;
grant select, insert on public.blood_issue_log to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.27_blood_bank_issue.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select count(*) from public.blood_issue_log where issued_by = received_by; -- must always be 0
--   select bu.unit_no, bil.issued_by_name, bil.received_by_name, bil.issued_at
--     from public.blood_issue_log bil join public.blood_units bu on bu.id = bil.unit_id
--     order by bil.issued_at desc limit 20;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.28_blood_bank_transfusion.sql
-- #############################################################################

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


-- #############################################################################
-- ## migration_v2.29_blood_bank_access.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.29_blood_bank_access.sql
-- Blood Bank / Transfusion Services, Phase 6 — access control
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   Every blood_* table added in Phases 1-5 already got its own RLS
--   policies in its own migration file (migration_v2.24 blood_units,
--   v2.25 blood_donors/blood_donations, v2.26 blood_requests, v2.27
--   blood_issue_log), reusing the existing helper functions from
--   migration_v2.8_rls_security.sql (is_admin(), is_clinical_staff(),
--   is_lab_staff()) throughout — no new helper function was needed, since
--   the Blood Bank role set (admin, lab_supervisor, lab_tech, doctor,
--   nurse) is already exactly covered by composing is_admin() and
--   is_clinical_staff() (which already includes doctor/nurse/lab_tech/
--   lab_supervisor/radiologist/theatre_nurse).
--
--   ONE genuine gap found on re-review: migration_v2.28 created
--   blood_transfusions but never enabled row level security on it or
--   added policies — this migration closes that gap. Every other
--   blood_* table's RLS is unchanged; nothing here duplicates or
--   contradicts an earlier phase's policy.
--
-- ROLE_PAGES (index.html) — client-side UX only, not a security boundary
-- (RLS below is) — now grants 'bloodbank' to: admin, lab_supervisor,
-- lab_tech (fulfil requests, manage inventory/intake/issue), doctor
-- (place requests), nurse (administer transfusions, record vitals,
-- report reactions). receptionist/cashier/theatre_nurse/radiologist are
-- deliberately not granted the page — none of their existing
-- responsibilities touch blood products.
--
-- WHAT THIS ADDS
--   blood_transfusions RLS (the gap above) — select/insert for
--   is_admin() or is_clinical_staff() (matches blood_requests, the
--   closest-shaped existing table: any clinical role can read and any
--   clinical role can start a transfusion or record vitals against one),
--   update likewise (stopping a transfusion, marking Reaction Reported).
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.28.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.blood_transfusions enable row level security;

drop policy if exists blood_transfusions_select on public.blood_transfusions;
create policy blood_transfusions_select on public.blood_transfusions
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists blood_transfusions_insert on public.blood_transfusions;
create policy blood_transfusions_insert on public.blood_transfusions
  for insert with check (public.is_admin() or public.is_clinical_staff());

drop policy if exists blood_transfusions_update on public.blood_transfusions;
create policy blood_transfusions_update on public.blood_transfusions
  for update using (public.is_admin() or public.is_clinical_staff())
  with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.blood_transfusions from anon;
grant select, insert, update on public.blood_transfusions to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Full Blood Bank RLS summary (for review — every policy already exists
-- as of the migration noted; nothing below is created by THIS file
-- except blood_transfusions, listed here only for a single reference
-- point across the whole module):
--
--   blood_units          (migration_v2.24) select: admin/clinical · insert: admin/lab · update: admin/clinical
--   blood_donors         (migration_v2.25) select/insert/update: admin/lab
--   blood_donations      (migration_v2.25) select/insert/update: admin/lab
--   blood_requests       (migration_v2.26) select/insert: admin/clinical · update: admin/lab
--   blood_issue_log      (migration_v2.27) select/insert: admin/clinical · NO update/delete (permanent record)
--   blood_transfusions   (this migration)  select/insert/update: admin/clinical
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename like 'blood_%'
--     order by tablename, cmd;
--   -- Confirm every blood_* table has rowsecurity enabled:
--   select relname, relrowsecurity from pg_class
--     where relname like 'blood_%' and relnamespace = 'public'::regnamespace;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.30_handover_notes_fields.sql
-- #############################################################################

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


-- #############################################################################
-- ## migration_v2.31_discharge_summary_fields.sql
-- #############################################################################

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


-- #############################################################################
-- ## migration_v2.32_lab_phase1_fields.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.32_lab_phase1_fields.sql
-- Documentation/Logbook expansion, Phase 1 (Laboratory)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1. qc_lots.analyte — required to compute a Six Sigma metric (Sigma =
--    (TEa - |Bias|) / %CV), since TEa is analyte-specific (a TEa
--    reference table lives client-side in index.html as
--    TEA_REFERENCE_DEFAULTS, editable via Settings). control_name is a
--    free-text product name (e.g. "Bio-Rad Level 1") and is NOT reliably
--    matchable to an analyte, so this is a genuinely new column, not a
--    rename.
--
-- 2. critical_values.mrn / critical_values.lab_no — snapshot the
--    patient's identifiers onto the row at the moment a critical value is
--    logged. Before this, MRN/Lab No were only ever available via a live
--    join to `patients` at read time — the panic log itself carried no
--    identifying snapshot of its own, which is a real deficiency for a
--    log whose whole purpose is being an durable, self-contained record
--    of what was reported and to whom.
--
-- 3. critical_values.read_back_confirmed — the acknowledge flow
--    previously (openCritAck()/submitCritAck() in index.html, replacing
--    the removed acknowledgeCritical() bare-prompt() flow) required only
--    a free-text clinician name via prompt(), with placeholder text
--    claiming "(read-back confirmed)" that captured nothing. The new flow
--    requires the acknowledging user to re-type the actual reported value
--    — a real read-back, compared against the true stored value client-
--    side before the acknowledge is allowed to submit — mirroring the
--    genuine two-person MRN/unit re-entry pattern already used by Blood
--    Bank's confirmIssueStep1()/confirmIssueStep2(). This column records
--    that the check was actually performed, not just claimed.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.qc_lots
  add column if not exists analyte text;

alter table public.critical_values
  add column if not exists mrn text,
  add column if not exists lab_no text,
  add column if not exists read_back_confirmed boolean not null default false;

comment on column public.qc_lots.analyte is 'Analyte this control lot measures (e.g. Glucose, Sodium, Haemoglobin) — keys into the client-side TEa reference table for Six Sigma metric calculation. Distinct from control_name (a free-text product name).';
comment on column public.critical_values.mrn is 'Patient MRN, snapshotted at the moment the critical value was logged — not solely reliant on a live join to patients.';
comment on column public.critical_values.lab_no is 'Patient Lab No, snapshotted at the moment the critical value was logged — not solely reliant on a live join to patients.';
comment on column public.critical_values.read_back_confirmed is 'True only when the acknowledging user re-typed the actual reported value and it matched (openCritAck()/submitCritAck() in index.html) — a real read-back, not a name-only acknowledgement.';


-- #############################################################################
-- ## migration_v2.33_consent_forms.sql
-- #############################################################################

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
  performed_by uuid,
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


-- #############################################################################
-- ## migration_v2.34_nursing_phase3_fields.sql
-- #############################################################################

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


-- #############################################################################
-- ## migration_v2.35_inventory_phase5_fields.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.35_inventory_phase5_fields.sql
-- Documentation/Logbook expansion, Phase 5 (Inventory)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1. inventory_batches wastage/discard columns — ports Blood Bank's
--    existing discard pattern (reason code + mandatory notes, no silent
--    removals) to general Inventory. Before this, general Inventory had
--    no discard flow at all: expired batches were only ever visually
--    flagged (computeExpiryStatus()), never formally written off with a
--    reason. Discarding sets is_active=false (already used everywhere
--    else in the code as the "exclude from active FEFO pool" flag) plus
--    these new attribution columns.
--
-- 2. stock_requisitions.status gets a new terminal state, 'received',
--    confirmed by the ORIGINAL REQUESTER (not the admin/lab_supervisor
--    who approved+fulfilled it) — closing a gap the Phase 0 audit found:
--    the pipeline previously ended at 'fulfilled' with no step for the
--    requesting department to confirm the stock actually arrived in the
--    expected quantity.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.inventory_batches
  add column if not exists discard_reason_code text
    check (discard_reason_code in ('Expired','Damaged','Contaminated','Other')),
  add column if not exists discard_notes text,
  add column if not exists discarded_by uuid,
  add column if not exists discarded_by_name text,
  add column if not exists discarded_at timestamptz;

comment on column public.inventory_batches.discard_reason_code is 'Closed-enum reason for discard — mirrors blood_units.discard_reason_code. Set only via index.html submitDiscardBatch(), never a plain delete.';
comment on column public.inventory_batches.discard_notes is 'Mandatory free-text detail for the discard — submitDiscardBatch() blocks saving without it, same rule as Blood Bank''s unit discard flow.';

-- Widen the existing status check constraint (added in migration_v2.14)
-- to include the new 'received' terminal state. Drops and recreates by
-- name so this is safe to re-run even if the constraint name differs
-- slightly in your instance — adjust the constraint name below to match
-- your actual schema if `stock_requisitions_status_check` isn't it.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'stock_requisitions' and constraint_name = 'stock_requisitions_status_check'
  ) then
    alter table public.stock_requisitions drop constraint stock_requisitions_status_check;
  end if;
end $$;
alter table public.stock_requisitions
  add constraint stock_requisitions_status_check
  check (status in ('pending','approved','rejected','fulfilled','received'));

alter table public.stock_requisitions
  add column if not exists received_confirmed_by uuid,
  add column if not exists received_confirmed_by_name text,
  add column if not exists received_confirmed_at timestamptz;

comment on column public.stock_requisitions.received_confirmed_by is 'The ORIGINAL REQUESTER (requested_by) confirming the stock arrived — a distinct actor from decided_by/whoever fulfilled it. Set via index.html confirmRequisitionReceipt().';


-- #############################################################################
-- ## migration_v2.36_bed_theatre_phase6.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.36_bed_theatre_phase6.sql
-- Documentation/Logbook expansion, Phase 6 (Bed Management & Theatre)
-- ═══════════════════════════════════════════════════════════════════════
--
-- No schema changes needed for the Bed Transfer Register or Daily Bed
-- Census — both are pure reporting layers over existing data
-- (bed_transfers, admissions, beds), confirmed by the Phase 0 audit to
-- already exist; only the register/report VIEW was missing.
--
-- who_safety_checklist is genuinely new — the WHO Surgical Safety
-- Checklist's three sequential stages (Sign In/Time Out/Sign Out), one
-- row per theatre_bookings row, each stage independently timestamped and
-- attributed. The existing pre_op_assessments/pre_op_checklist is a
-- single flat form completed once before the OT day (closest to a
-- "Sign In" equivalent in spirit, but not the same intra-operative
-- three-phase team check this models) and is left untouched.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.who_safety_checklist (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.theatre_bookings(id) on delete cascade,
  signin_items jsonb, signin_completed_by uuid, signin_completed_by_name text, signin_completed_at timestamptz,
  timeout_items jsonb, timeout_completed_by uuid, timeout_completed_by_name text, timeout_completed_at timestamptz,
  signout_items jsonb, signout_completed_by uuid, signout_completed_by_name text, signout_completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.who_safety_checklist enable row level security;

-- Same admin/clinical-staff shape as the rest of the Theatre workflow
-- (theatre_bookings/pre_op_assessments). No delete policy — a completed
-- stage is a permanent record, matching blood_issue_log's precedent.
drop policy if exists who_safety_checklist_select on public.who_safety_checklist;
create policy who_safety_checklist_select on public.who_safety_checklist
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists who_safety_checklist_insert on public.who_safety_checklist;
create policy who_safety_checklist_insert on public.who_safety_checklist
  for insert with check (public.is_admin() or public.is_clinical_staff());

drop policy if exists who_safety_checklist_update on public.who_safety_checklist;
create policy who_safety_checklist_update on public.who_safety_checklist
  for update using (public.is_admin() or public.is_clinical_staff())
  with check (public.is_admin() or public.is_clinical_staff());

revoke all on public.who_safety_checklist from anon;
grant select, insert, update on public.who_safety_checklist to authenticated;

comment on table public.who_safety_checklist is 'WHO Surgical Safety Checklist — one row per theatre_bookings row, three independently-gated sequential stages (Sign In / Time Out / Sign Out). Each stage requires every item checked plus a signing staff name (index.html completeWhoStage()) before the next stage unlocks (openWhoChecklist()/renderWhoStage()).';


-- #############################################################################
-- ## migration_v2.37_app_audit_logs.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.37_app_audit_logs.sql
-- Documentation/Logbook expansion — cross-cutting audit table
-- ═══════════════════════════════════════════════════════════════════════
--
-- The existing audit_logs table (migration_v2.8) is a DB-trigger-driven
-- table covering exactly 8 tables (7 lab result tables + doctor_
-- consultations), UPDATE/DELETE only, never written from client JS.
-- billing_audit_logs is a separate, app-level, JS-driven table but is
-- billing-only. Neither reaches Nursing, Radiology, Bed Management,
-- Theatre, or Blood Bank. Per the Phase 0 audit's own guidance, most
-- individual actions in this app already carry a strong "digital
-- signature" via performed_by/verified_at columns directly on their own
-- rows (lab results, discharge summaries, consent forms, blood_issue_log,
-- bed_transfers, who_safety_checklist, etc.) — this table is NOT meant to
-- duplicate all of that. It exists as a single, queryable, cross-module
-- place to see "what safety-relevant actions happened across the whole
-- hospital", for the specific handful of actions that didn't already
-- have an audit trail of their own (see index.html logAppAudit() call
-- sites: Radiology report verification, manual bed status changes,
-- high-alert MAR second-staff verification, Theatre WHO Checklist stage
-- completions, Blood Bank unit discards).
--
-- Follows billing_audit_logs' exact shape/insert-and-forget pattern
-- (dbWrite('app_audit_logs','insert',{...}) in logAppAudit()), just
-- generalized with a `module` column instead of being billing-specific.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.app_audit_logs (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  action text not null,
  record_id text,
  performed_by uuid,
  performed_by_name text,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_audit_logs_module on public.app_audit_logs(module, created_at desc);

alter table public.app_audit_logs enable row level security;

-- Admin-read (matches audit_logs' own admin-only select policy), any
-- authenticated clinical/admin write — a logging failure must never be
-- what blocks the underlying clinical action, so this stays permissive
-- on insert. No update/delete policy: append-only, same as
-- blood_issue_log and billing_audit_logs.
drop policy if exists app_audit_logs_select on public.app_audit_logs;
create policy app_audit_logs_select on public.app_audit_logs
  for select using (public.is_admin());

drop policy if exists app_audit_logs_insert on public.app_audit_logs;
create policy app_audit_logs_insert on public.app_audit_logs
  for insert with check (public.is_admin() or public.is_clinical_staff() or public.is_lab_staff());

revoke all on public.app_audit_logs from anon;
grant select, insert on public.app_audit_logs to authenticated;

comment on table public.app_audit_logs is 'Cross-module audit trail for Nursing/Radiology/Bed Management/Theatre/Blood Bank actions that did not already have a strong audit trail of their own via performed_by/verified_at columns on their own tables. Written via index.html logAppAudit(). Append-only, admin-read.';

-- ── Radiology verify-step attribution (closes a confirmed Phase 0 gap:
--    updateRadStatus(id,'Verified') previously only flipped the status
--    string, capturing no verifier identity or timestamp at all) ──
alter table public.radiology_requests
  add column if not exists verified_by uuid,
  add column if not exists verified_by_name text,
  add column if not exists verified_at timestamptz;

comment on column public.radiology_requests.verified_by_name is 'Set only when status transitions to Verified (index.html updateRadStatus()) — brings radiology''s Verify step in line with the same is_verified/verified_at pattern already used throughout Lab.';


-- #############################################################################
-- ## migration_v2.38_analyzer_validation.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.38_analyzer_validation.sql
-- Analyzer Validation & Verification (CLSI EP15-A3 precision verification,
-- EP09-A3 method comparison, EP06-A linearity — EP06-A UI/statistics are
-- not implemented in this first pass; the schema below is shaped to hold
-- its results later without another migration, but nothing writes to the
-- EP06-A-specific columns yet).
--
-- Phase 0 overlap check (see index.html investigation): this is
-- deliberately NOT layered onto qc_lots/qc_results. QC (Levey-Jennings,
-- Westgard, Six Sigma) monitors an instrument that is already in
-- service, ongoing, indefinitely. A validation study CERTIFIES an
-- instrument before it goes into service (or after a major change — new
-- lot, new instrument, method change), is bounded (a fixed number of
-- runs/replicates), and produces a one-time PASS/FAIL determination that
-- a Quality Manager and Laboratory Director sign off on. Distinct
-- purpose, distinct lifecycle, distinct table — no duplication risk.
--
-- Two things this migration deliberately does NOT introduce, because
-- reusing something that doesn't exist would be worse than not having it:
--   1. No instrument/analyzer registry FK. The Analyzer Interface page's
--      "Registered Analyzers" table (index.html addAnalyzerRow()) is
--      pure client-side DOM state with no backing Supabase table at all
--      today — it doesn't even survive a page reload. There is nothing
--      to foreign-key validation_studies.instrument_id against, so
--      instrument identity is plain text (name + serial) here, matching
--      how "analyzer" is already handled everywhere else in this app
--      (free-text fields on results_hematology/results_chemistry/etc.,
--      never a normalized instruments table).
--   2. No DB-side TEa table/join. The existing TEa reference data
--      (TEA_REFERENCE_DEFAULTS / teaFor(analyte) in index.html) is a
--      client-side JS object with per-analyte localStorage overrides,
--      not a database table. validation_studies.tea_limit stores the
--      value teaFor(analyte) resolved to at study-creation time, so the
--      historical record stays accurate even if the reference value is
--      edited later — not a live join to something that doesn't exist
--      server-side.
--
-- Digital-signature attribution reuses this app's existing performed_by/
-- verified_by/verified_at pattern (see consent_forms, radiology_requests)
-- rather than inventing a new one — extended to two named sign-off
-- stages (Quality Manager review, Laboratory Director approval) the same
-- way who_safety_checklist already models multiple independently-signed
-- stages on one row, rather than a single generic "verified" flag.
--
-- Actor columns (created_by/entered_by/performed_by/verified_by/
-- approved_by) are plain uuid, NOT `references auth.users(id)`. The app
-- writes currentProfile?.id to these — the `staff` table's own row id,
-- not the Supabase Auth user id (that's currentProfile.user_id) — and
-- this codebase never enforces that FK anywhere else (see
-- migration_v2.14/24/25/26). Constraining it here (an earlier version of
-- this migration did) broke every save for any staff account whose row
-- wasn't created with id==auth uid, which is not guaranteed for accounts
-- set up before the one-step staff-creation flow existed.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.validation_studies (
  id uuid primary key default gen_random_uuid(),
  analyte text not null,
  instrument_name text not null,
  instrument_serial text,
  protocol_type text not null check (protocol_type in ('EP15-A3','EP09-A3','EP06-A')),
  unit text,
  tea_limit numeric,
  claimed_cv_pct numeric,
  status text not null default 'Draft' check (status in ('Draft','In Progress','Completed')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_validation_studies_analyte on public.validation_studies(analyte, created_at desc);

comment on table public.validation_studies is 'One row per validation study (header/metadata) — CLSI EP15-A3 precision verification, EP09-A3 method comparison, or EP06-A linearity (schema-ready, not yet implemented in the UI). status tracks data-entry workflow, distinct from the PASS/FAIL clinical determination which lives per-calculation-run on validation_results.';
comment on column public.validation_studies.instrument_name is 'Free text — no instrument registry exists in this app to foreign-key against (see migration header note).';
comment on column public.validation_studies.tea_limit is 'Total allowable error %, resolved from index.html teaFor(analyte) at study-creation time and stored here so the historical record is stable even if the reference value is edited later.';
comment on column public.validation_studies.claimed_cv_pct is 'Manufacturer/method-claimed %CV being verified against (EP15-A3).';

create table if not exists public.validation_samples (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.validation_studies(id) on delete cascade,
  run_number integer not null,
  replicate_number integer not null,
  target_level text,
  method text check (method in ('X','Y')),
  result_value numeric not null,
  entered_by uuid,
  entered_by_name text,
  entered_at timestamptz not null default now()
);

create index if not exists idx_validation_samples_study on public.validation_samples(study_id, run_number, replicate_number);

comment on table public.validation_samples is 'Raw replicate run data entered against a validation_studies row. target_level is the EP15-A3 concentration level label (e.g. Low/Normal/High), not a fixed enum since labs use different level naming. method (X/Y) is only populated for EP09-A3 method-comparison studies — null for EP15-A3.';

create table if not exists public.validation_results (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.validation_studies(id) on delete cascade,
  -- EP15-A3 (precision verification)
  grand_mean numeric,
  ms_within numeric,
  ms_between numeric,
  cv_within_pct numeric,
  cv_total_pct numeric,
  uvl numeric,
  -- EP09-A3 (method comparison)
  regression_method text check (regression_method in ('Deming','OLS')),
  slope numeric,
  intercept numeric,
  r_squared numeric,
  bias_pct numeric,
  sd_differences numeric,
  -- Shared determination + two-stage sign-off, mirroring
  -- who_safety_checklist's multiple-independently-signed-stages pattern.
  -- 'Pending Review' covers EP09-A3 studies where no TEa is on file to
  -- auto-judge bias% against -- EP15-A3 always resolves to Pass/Fail
  -- (claimed-CV/UVL is always evaluable once claimed_cv_pct is entered).
  result_status text not null check (result_status in ('Pass','Fail','Pending Review')),
  calculated_at timestamptz not null default now(),
  performed_by uuid,
  performed_by_name text,
  verified_by uuid,
  verified_by_name text,
  verified_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz
);

create index if not exists idx_validation_results_study on public.validation_results(study_id, calculated_at desc);

comment on table public.validation_results is 'One row per calculation run against a validation_studies row (re-running after adding more samples creates a new row rather than overwriting — the most recent row by calculated_at is current). regression_method records whether slope/intercept/r_squared came from true Deming regression or OLS (labeled explicitly per the requirement to never present OLS output as if it were Deming). verified_by/verified_at = Quality Manager review; approved_by/approved_at = Laboratory Director approval — both optional/nullable until actually signed, printed as blank signature lines on the report until then.';

alter table public.validation_studies enable row level security;
alter table public.validation_samples enable row level security;
alter table public.validation_results enable row level security;

-- Same admin/lab-staff shape as qc_lots/qc_results — this is lab
-- instrument validation, not general clinical data, so is_lab_staff()
-- rather than is_clinical_staff(). validation_studies allows update (the
-- header/status can be edited while a study is still in Draft/In
-- Progress); samples and results are append-only, matching this app's
-- existing precedent for entered data and calculated/signed results
-- (blood_issue_log, consent_forms) — a correction is a new row, not an
-- edit to history.
drop policy if exists validation_studies_select on public.validation_studies;
create policy validation_studies_select on public.validation_studies
  for select using (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_studies_insert on public.validation_studies;
create policy validation_studies_insert on public.validation_studies
  for insert with check (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_studies_update on public.validation_studies;
create policy validation_studies_update on public.validation_studies
  for update using (public.is_admin() or public.is_lab_staff())
  with check (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_samples_select on public.validation_samples;
create policy validation_samples_select on public.validation_samples
  for select using (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_samples_insert on public.validation_samples;
create policy validation_samples_insert on public.validation_samples
  for insert with check (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_results_select on public.validation_results;
create policy validation_results_select on public.validation_results
  for select using (public.is_admin() or public.is_lab_staff());

drop policy if exists validation_results_insert on public.validation_results;
create policy validation_results_insert on public.validation_results
  for insert with check (public.is_admin() or public.is_lab_staff());

-- Sign-off stages (verified_by/approved_by) ARE written after the initial
-- insert (a Quality Manager/Lab Director signs off some time after the
-- calculation itself), so validation_results needs a scoped update policy
-- for that specific purpose — same shape as the others.
drop policy if exists validation_results_update on public.validation_results;
create policy validation_results_update on public.validation_results
  for update using (public.is_admin() or public.is_lab_staff())
  with check (public.is_admin() or public.is_lab_staff());

revoke all on public.validation_studies from anon;
revoke all on public.validation_samples from anon;
revoke all on public.validation_results from anon;
grant select, insert, update on public.validation_studies to authenticated;
grant select, insert on public.validation_samples to authenticated;
grant select, insert, update on public.validation_results to authenticated;


-- #############################################################################
-- ## migration_v2.39_fix_actor_fk_constraints.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.39_fix_actor_fk_constraints.sql
-- Fixes a real bug in migrations v2.33/v2.35/v2.36/v2.37/v2.38: their
-- *_by actor columns (performed_by, discarded_by, received_confirmed_by,
-- signin/timeout/signout_completed_by, verified_by, created_by,
-- entered_by, approved_by) were declared `references auth.users(id)`.
--
-- The app writes currentProfile?.id to every one of these columns
-- throughout index.html — and currentProfile is the `staff` table row
-- (loadProfile() does `select('*') from staff`), so currentProfile.id is
-- the STAFF row's own primary key, not the Supabase Auth user id (that's
-- currentProfile.user_id). This codebase's older tables (see
-- migration_v2.14/24/25/26) never enforce a FK on these actor columns at
-- all — that's why saving elsewhere in the app has always worked. Only
-- the five migrations above (all from recent sessions) added the stricter
-- constraint, which fails for any staff account whose row's `id` doesn't
-- happen to equal its `user_id` (e.g. an admin account created directly
-- in the Supabase table editor, before the one-step staff-creation Edge
-- Function existed) — confirmed live via:
--   insert or update on table "validation_studies" violates foreign key
--   constraint "validation_studies_created_by_fkey"
--
-- This migration drops those FK constraints, restoring the same
-- (unenforced, plain-uuid) convention used everywhere else in the app.
-- The source .sql files for v2.33/35/36/37/38 have also been corrected
-- so a fresh database setup doesn't reintroduce this.
--
-- Idempotent — every DROP CONSTRAINT IF EXISTS is safe to re-run, and
-- safe even if you never hit this bug (a constraint that isn't there is
-- simply skipped). For manual review and application in the Supabase SQL
-- editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.consent_forms
  drop constraint if exists consent_forms_performed_by_fkey;

alter table public.inventory_batches
  drop constraint if exists inventory_batches_discarded_by_fkey;

alter table public.stock_requisitions
  drop constraint if exists stock_requisitions_received_confirmed_by_fkey;

alter table public.who_safety_checklist
  drop constraint if exists who_safety_checklist_signin_completed_by_fkey,
  drop constraint if exists who_safety_checklist_timeout_completed_by_fkey,
  drop constraint if exists who_safety_checklist_signout_completed_by_fkey;

alter table public.app_audit_logs
  drop constraint if exists app_audit_logs_performed_by_fkey;

alter table public.radiology_requests
  drop constraint if exists radiology_requests_verified_by_fkey;

alter table public.validation_studies
  drop constraint if exists validation_studies_created_by_fkey;

alter table public.validation_samples
  drop constraint if exists validation_samples_entered_by_fkey;

alter table public.validation_results
  drop constraint if exists validation_results_performed_by_fkey,
  drop constraint if exists validation_results_verified_by_fkey,
  drop constraint if exists validation_results_approved_by_fkey;

-- Optional diagnostic — run this separately to see whether your staff
-- accounts' id happens to equal their Auth user_id (informational only,
-- doesn't affect anything now that the FK constraints above are gone):
--   select id as staff_id, user_id as auth_user_id, full_name, role,
--          (id = user_id) as ids_match
--   from public.staff order by full_name;


-- #############################################################################
-- ## migration_v2.40_nursing_safety_ext_phase1.sql
-- #############################################################################

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


-- #############################################################################
-- ## migration_v2.41_nursing_safety_ext_phase2.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.41_nursing_safety_ext_phase2.sql
-- Nursing Safety Extension, Phase 2 (NEWS2 escalation)
-- ═══════════════════════════════════════════════════════════════════════
--
-- NEWS2 >=7 opens a blocking "Strike Rapid Response Team (RRT)" modal
-- (index.html: openRrtAck()/submitRrtAck()), reusing the same acknowledge-
-- with-real-read-back discipline as Critical Values acknowledgement
-- (openCritAck()/submitCritAck()) rather than a bare confirm(). These
-- columns record that acknowledgement on the same vital_signs row the
-- NEWS2 score itself lives on.
--
-- No schema change for the NEWS2 3-6 "hourly monitoring" flag on the
-- Nursing Queue -- it's computed live from the existing news2_score column,
-- no new state to persist for a visible-flag-only feature (explicitly no
-- notification-bell integration in this pass).
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.vital_signs
  add column if not exists rrt_acknowledged boolean,
  add column if not exists rrt_acknowledged_by text,
  add column if not exists rrt_acknowledged_at timestamptz,
  add column if not exists rrt_notified_to text,
  add column if not exists rrt_notes text;

comment on column public.vital_signs.rrt_acknowledged is 'Set true once the nurse confirms Rapid Response Team activation for a NEWS2 >=7 reading (index.html submitRrtAck()) — a real re-typed-score read-back, not a bare confirmation.';
comment on column public.vital_signs.rrt_notified_to is 'Name of the RRT / on-call doctor notified for this escalation.';


-- #############################################################################
-- ## migration_v2.42_nursing_safety_ext_phase3.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.42_nursing_safety_ext_phase3.sql
-- Nursing Safety Extension, Phase 3 (Turning Clock, Post-Analgesia,
-- MAR overdue status)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Both new flags are timestamp-anchored, matching the project-wide rule
-- that no timer/countdown may live only in client memory (a page refresh
-- or a device losing power must never reset it) -- overdue state is always
-- recalculated from Date.now() minus the stored timestamp below, on every
-- render (index.html: renderTurningStatus(), renderPostAnalgesiaStatus(),
-- and their re-derivation on the Nursing Queue via nursingQueueAlertBadges()).
--
-- turning_position is set by logTurningPosition() each time a nurse logs a
-- repositioning; the Turning Clock reads the most recent row where this is
-- non-null. analgesia_administered_at is stamped by saveMAR() when an
-- IV/Oral analgesic is marked Given; the post-analgesia flag clears once a
-- vital_signs row with a newer pain_score exists (pain_score already
-- existed on this table before this migration).
--
-- No schema change needed for the MAR overdue (on-time/due/overdue) badge
-- -- it's derived live from each MAR row's existing "Time Due" field
-- (mar_entries[].time, a jsonb value), not persisted separately.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.vital_signs
  add column if not exists turning_position text,
  add column if not exists analgesia_administered_at timestamptz;

comment on column public.vital_signs.turning_position is 'Turning Clock (Nursing Safety Ext. Phase 3) — Left/Right/Supine/Prone, set by logTurningPosition(). The most recent non-null row is the current anchor; overdue = now - that row''s recorded_at >= 2 hours.';
comment on column public.vital_signs.analgesia_administered_at is 'Post-Analgesia Reassessment (Nursing Safety Ext. Phase 3) — stamped by saveMAR() when an IV/Oral analgesic is marked Given. Flag clears once a vital_signs row with a newer pain_score exists.';


-- #############################################################################
-- ## migration_v2.43_lab_verification_scoping.sql
-- #############################################################################

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


-- #############################################################################
-- ## migration_v2.44_xss_test_data_cleanup.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.44_xss_test_data_cleanup.sql
-- Cleanup for the live XSS test payload accepted into a patient name
-- field during an earlier security-testing pass (MRN 522), plus a
-- general sweep for any other row carrying the same class of payload.
-- ═══════════════════════════════════════════════════════════════════════
--
-- CONTEXT: an earlier session confirmed the app's registration form
-- accepted `<img src="x" onerror="stealCookies()" />` (and similar) into
-- a patient name field, and that this rendered as live markup in some
-- (now-fixed) display locations. That test record is still sitting in the
-- live database under MRN 522. index.html now has both defenses in place:
--   - Root-cause: registration blocks HTML metacharacters (< > & " ') in
--     name fields outright (regValidate()/submitRegistration()).
--   - Defense-in-depth: every display location that renders a patient name
--     into HTML now escapes it (escapeHtml()/escAttr()).
-- Neither of those retroactively cleans up data already sitting in the
-- database from BEFORE those fixes existed — that's what this file does.
--
-- SAFE BY DESIGN: this is a two-step, review-first process.
--   Step 1 (SELECT) — run this first and actually look at the results.
--     It finds every row in patients / patients_master / follow_ups whose
--     name-ish fields contain HTML metacharacters, not just MRN 522 --
--     there may be other rows from the same testing session.
--   Step 2 (UPDATE) — commented out by default. Only run it after you've
--     reviewed Step 1's output and confirmed every listed row really is
--     test/poisoned data, not a real patient whose name happens to
--     contain an apostrophe or similar. It does NOT delete anything --
--     it strips HTML metacharacters from the affected text fields in
--     place, preserving the row, its MRN/File/Lab numbers, and every
--     other field untouched.
--
-- Idempotent — safe to re-run; rows already clean simply won't match.
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- STEP 1 — locate every affected row. RUN THIS FIRST AND REVIEW IT.
-- ───────────────────────────────────────────────────────────────────────

select 'patients' as table_name, id, mrn, visit_no, first_name, middle_name, last_name, name, next_of_kin_name, created_at
from public.patients
where first_name ~ '[<>&"'']' or middle_name ~ '[<>&"'']' or last_name ~ '[<>&"'']'
   or name ~ '[<>&"'']' or next_of_kin_name ~ '[<>&"'']'
order by created_at desc;

select 'patients_master' as table_name, mrn, first_name, middle_name, last_name, name
from public.patients_master
where first_name ~ '[<>&"'']' or middle_name ~ '[<>&"'']' or last_name ~ '[<>&"'']' or name ~ '[<>&"'']';

select 'follow_ups' as table_name, id, patient_mrn, scheduled_by_name, reason
from public.follow_ups
where scheduled_by_name ~ '[<>&"'']' or reason ~ '[<>&"'']';

-- Specifically confirm MRN 522's current state:
select id, mrn, visit_no, first_name, middle_name, last_name, name, next_of_kin_name
from public.patients
where mrn = '522';

select mrn, first_name, middle_name, last_name, name
from public.patients_master
where mrn = '522';


-- ───────────────────────────────────────────────────────────────────────
-- STEP 2 — sanitize the affected fields. REVIEW STEP 1's OUTPUT FIRST.
-- Uncomment and run only once you've confirmed these are test/poisoned
-- rows, not a real patient's data. Strips HTML metacharacters ( < > & " ' )
-- from each affected column; every other field on the row is untouched.
-- ───────────────────────────────────────────────────────────────────────

-- update public.patients set
--   first_name       = regexp_replace(first_name, '[<>&"'']', '', 'g'),
--   middle_name      = regexp_replace(middle_name, '[<>&"'']', '', 'g'),
--   last_name        = regexp_replace(last_name, '[<>&"'']', '', 'g'),
--   name             = regexp_replace(name, '[<>&"'']', '', 'g'),
--   next_of_kin_name = regexp_replace(next_of_kin_name, '[<>&"'']', '', 'g')
-- where first_name ~ '[<>&"'']' or middle_name ~ '[<>&"'']' or last_name ~ '[<>&"'']'
--    or name ~ '[<>&"'']' or next_of_kin_name ~ '[<>&"'']';

-- update public.patients_master set
--   first_name  = regexp_replace(first_name, '[<>&"'']', '', 'g'),
--   middle_name = regexp_replace(middle_name, '[<>&"'']', '', 'g'),
--   last_name   = regexp_replace(last_name, '[<>&"'']', '', 'g'),
--   name        = regexp_replace(name, '[<>&"'']', '', 'g')
-- where first_name ~ '[<>&"'']' or middle_name ~ '[<>&"'']' or last_name ~ '[<>&"'']' or name ~ '[<>&"'']';

-- update public.follow_ups set
--   scheduled_by_name = regexp_replace(scheduled_by_name, '[<>&"'']', '', 'g'),
--   reason             = regexp_replace(reason, '[<>&"'']', '', 'g')
-- where scheduled_by_name ~ '[<>&"'']' or reason ~ '[<>&"'']';

-- If, after reviewing Step 1, MRN 522 turns out to be a pure test
-- registration with no real downstream clinical/billing data you need to
-- keep (no genuine orders, results, or invoices attached), you may prefer
-- to delete it outright instead of sanitizing it in place. Left as a
-- manual decision -- deliberately not scripted here, since deleting a
-- patient record is not reversible and this migration can't know whether
-- other tables (results_*, invoices, doctor_orders, etc.) reference it.


-- #############################################################################
-- ## migration_v2.45_lab_reference_ranges.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.45_lab_reference_ranges.sql
-- Lab Reference Ranges — admin-managed ranges/units + SI/Conventional
-- unit-system toggle
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   Every department's reference range (lo/hi) and unit was hardcoded in
--   RESULT_META (index.html), SI units only, read directly by
--   flagHem()/flagChem()/etc. and by every department's print*Report()
--   function (e.g. printChemReport()'s row('Creatinine',r.creat,'µmol/L',
--   62,106,RFT)). There was no admin UI to view or change a range, and no
--   way to display a Conventional/US-unit lab report at all. RESULT_META
--   only has entries for the four NUMERIC-panel departments (hem, chem,
--   sero, immuno) — micro/pcr/histo/cyto are narrative/qualitative
--   reports with no fixed numeric ranges, so they are correctly not
--   represented here either, matching how RESULT_META itself is scoped.
--
-- WHAT THIS ADDS
--   lab_reference_ranges — one row per (dept_key, field_code), i.e. one
--   row per RESULT_META entry. si_unit/si_lo/si_hi are seeded directly
--   from RESULT_META's current values below (this lab's existing, correct
--   default — SI stays unchanged by this migration or the feature it
--   enables). conventional_unit/conventional_lo/conventional_hi/
--   conversion_factor are seeded for a small set of analytes with a
--   single, unambiguous, textbook-standard SI<->Conventional conversion
--   (creatinine, glucose, urea/BUN, cholesterol group, triglycerides,
--   bilirubin group, calcium, uric acid, total protein/albumin,
--   magnesium, phosphorus, and the electrolytes — the latter needing only
--   a unit relabel to mEq/L, not a numeric change, for monovalent ions).
--   Every other field is left with conventional_* NULL on purpose — most
--   remaining fields (enzyme activities in U/L, hormones, tumour markers,
--   vitamins, eGFR, INR, HbA1c%) are either already unit-identical between
--   SI and US-conventional reporting, or have no single universally-agreed
--   conversion factor worth guessing at — an admin fills these in via the
--   new Reference Ranges page once a real conventional-unit reporting
--   need is confirmed for that analyte, rather than this migration
--   guessing and shipping a wrong clinical range.
--
--   conversion_factor is the SI -> Conventional multiplier:
--     conventional_value = si_value * conversion_factor
--   Applied by the client only to DISPLAY/PRINT — the stored result value
--   in results_hematology/results_chemistry/etc. always stays the real SI
--   value entered by the tech; nothing downstream (Delta Check, critical
--   thresholds, auto-verify range checks, eGFR calc) ever reads from this
--   table or needs to change.
--
-- Idempotent — safe to re-run: the table/policies use IF NOT EXISTS /
-- CREATE OR REPLACE, and the seed INSERT uses ON CONFLICT (dept_key,
-- field_code) DO NOTHING so re-running this file never clobbers
-- conventional-unit values an admin has since filled in via the UI. Not
-- applied automatically; for manual review and application in the
-- Supabase SQL editor. Run after migration_v2.44.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.lab_reference_ranges (
  id                  uuid primary key default gen_random_uuid(),
  dept_key            text not null check (dept_key in ('hem','chem','sero','immuno')),
  field_code          text not null,
  label               text not null,
  si_unit             text not null,
  si_lo               numeric,
  si_hi               numeric,
  conventional_unit   text,
  conventional_lo     numeric,
  conventional_hi     numeric,
  conversion_factor   numeric,
  updated_by          uuid,
  updated_by_name     text,
  updated_at          timestamptz not null default now(),
  unique (dept_key, field_code)
);

create index if not exists lab_reference_ranges_dept_idx on public.lab_reference_ranges (dept_key);

comment on table public.lab_reference_ranges is
  'Admin-managed reference range + unit per (dept_key, field_code), one row per RESULT_META entry (index.html). Seeded from RESULT_META''s existing SI values below. conventional_* columns are the optional Conventional/US-unit equivalent, filled in by an admin via the Reference Ranges page (or pre-seeded here for a small set of well-known conversions) — a NULL conventional_unit means the client falls back to displaying the SI value/unit for that field, which is also correct for fields that are already unit-identical between systems (e.g. most enzyme U/L values).';
comment on column public.lab_reference_ranges.conversion_factor is
  'SI -> Conventional multiplier: conventional_value = si_value * conversion_factor. Never applied to the stored result value itself, only to what the client displays/prints when CFG.labUnitSystem is ''conventional''.';

alter table public.lab_reference_ranges enable row level security;

drop policy if exists lab_reference_ranges_select on public.lab_reference_ranges;
create policy lab_reference_ranges_select on public.lab_reference_ranges
  for select using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

-- Write access is admin-only, same as Price List (price_list) — reference
-- ranges are a clinical-governance setting, not something lab_supervisor
-- (or any other role) should be able to change day-to-day.
drop policy if exists lab_reference_ranges_insert on public.lab_reference_ranges;
create policy lab_reference_ranges_insert on public.lab_reference_ranges
  for insert with check (public.is_admin());

drop policy if exists lab_reference_ranges_update on public.lab_reference_ranges;
create policy lab_reference_ranges_update on public.lab_reference_ranges
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists lab_reference_ranges_delete on public.lab_reference_ranges;
create policy lab_reference_ranges_delete on public.lab_reference_ranges
  for delete using (public.is_admin());

revoke all on public.lab_reference_ranges from anon;
grant select, insert, update, delete on public.lab_reference_ranges to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- SEED — SI values copied verbatim from RESULT_META (index.html). Every
-- field RESULT_META defines gets a row; conventional_* filled in only for
-- the well-known conversions described above.
-- ═══════════════════════════════════════════════════════════════════════

insert into public.lab_reference_ranges
  (dept_key, field_code, label, si_unit, si_lo, si_hi, conventional_unit, conventional_lo, conventional_hi, conversion_factor)
values
  -- ── Haematology ──────────────────────────────────────────────────
  ('hem','wbc','WBC','×10³/µL',4.0,10.0,null,null,null,null),
  ('hem','rbc','RBC','×10⁶/µL',3.9,5.9,null,null,null,null),
  ('hem','hgb','HGB — Haemoglobin','g/dL',12.0,17.5,null,null,null,null),
  ('hem','hct','HCT','%',37,52,null,null,null,null),
  ('hem','mcv','MCV','fL',80,100,null,null,null,null),
  ('hem','mch','MCH','pg',27,33,null,null,null,null),
  ('hem','mchc','MCHC','g/dL',31.5,36,null,null,null,null),
  ('hem','rdw','RDW','%',11.5,14.5,null,null,null,null),
  ('hem','nrbc','NRBC','/100 WBC',0,0,null,null,null,null),
  ('hem','plt','PLT — Platelets','×10³/µL',150,400,null,null,null,null),
  ('hem','mpv','MPV','fL',7.5,12.5,null,null,null,null),
  ('hem','pdw','PDW','%',9,17,null,null,null,null),
  ('hem','neut','Neutrophils','%',50,70,null,null,null,null),
  ('hem','lymph','Lymphocytes','%',20,40,null,null,null,null),
  ('hem','mono','Monocytes','%',2,10,null,null,null,null),
  ('hem','eosi','Eosinophils','%',1,6,null,null,null,null),
  ('hem','baso','Basophils','%',0,1,null,null,null,null),
  ('hem','pt','PT','sec',11,14,null,null,null,null),
  ('hem','inr','INR','',0.8,1.2,null,null,null,null),
  ('hem','aptt','aPTT','sec',25,35,null,null,null,null),
  ('hem','tt','Thrombin Time (TT)','sec',10,17,null,null,null,null),
  ('hem','fibg','Fibrinogen','g/L',2.0,4.0,null,null,null,null),
  ('hem','ddimer','D-Dimer','mg/L FEU',0,0.5,null,null,null,null),
  ('hem','esr','ESR','mm/hr',0,20,null,null,null,null),
  -- ── Chemistry ────────────────────────────────────────────────────
  ('chem','tbil','T. Bilirubin','µmol/L',0,17,'mg/dL',0,0.99,0.0585),
  ('chem','dbil','D. Bilirubin','µmol/L',0,5,'mg/dL',0,0.29,0.0585),
  ('chem','ibil','I. Bilirubin','µmol/L',0,12,'mg/dL',0,0.70,0.0585),
  ('chem','alt','ALT (SGPT)','U/L',7,56,null,null,null,null),
  ('chem','ast','AST (SGOT)','U/L',10,40,null,null,null,null),
  ('chem','alp','ALP','U/L',44,147,null,null,null,null),
  ('chem','ggt','GGT','U/L',0,51,null,null,null,null),
  ('chem','tp','Total Protein','g/L',60,83,'g/dL',6.0,8.3,0.1),
  ('chem','alb','Albumin','g/L',35,50,'g/dL',3.5,5.0,0.1),
  ('chem','creat','Creatinine','µmol/L',62,106,'mg/dL',0.70,1.20,0.0113),
  ('chem','urea','Urea','mmol/L',2.5,7.8,'BUN mg/dL',7,22,2.8),
  ('chem','ua','Uric Acid','mmol/L',0.20,0.42,'mg/dL',3.4,7.1,16.85),
  ('chem','egfr','eGFR','mL/min/1.73m²',60,999,null,null,null,null),
  ('chem','na','Sodium (Na)','mmol/L',136,145,'mEq/L',136,145,1),
  ('chem','k','Potassium (K)','mmol/L',3.5,5.1,'mEq/L',3.5,5.1,1),
  ('chem','cl','Chloride','mmol/L',98,107,'mEq/L',98,107,1),
  ('chem','co2','CO₂ / Bicarbonate','mmol/L',22,29,'mEq/L',22,29,1),
  ('chem','ca','Calcium','mmol/L',2.1,2.6,'mg/dL',8.4,10.4,4.0),
  ('chem','phos','Phosphorus','mmol/L',0.8,1.5,'mg/dL',2.5,4.6,3.097),
  ('chem','mg','Magnesium','mmol/L',0.7,1.1,'mg/dL',1.7,2.7,2.431),
  ('chem','fbs','Fasting Blood Sugar','mmol/L',3.9,6.1,'mg/dL',70,110,18.0),
  ('chem','rbs','Random Blood Sugar','mmol/L',3.9,11.1,'mg/dL',70,200,18.0),
  ('chem','ppbs','2hr Post-Prandial','mmol/L',3.9,7.8,'mg/dL',70,140,18.0),
  ('chem','hba1c','HbA1c','%',4,5.7,null,null,null,null),
  ('chem','ins','Insulin','µIU/mL',2.6,25,null,null,null,null),
  ('chem','cpep','C-Peptide','ng/mL',0.5,2.7,null,null,null,null),
  ('chem','tchol','Total Cholesterol','mmol/L',0,5.2,'mg/dL',0,201,38.67),
  ('chem','ldl','LDL Cholesterol','mmol/L',0,3.4,'mg/dL',0,131,38.67),
  -- HDL's si_hi=99 is RESULT_META's existing sentinel for "no real upper
  -- bound" (HDL only has a clinically meaningful LOWER limit) -- left
  -- untouched on the SI side per instruction, but NOT blindly multiplied
  -- through to a nonsensical conventional_hi; conventional_hi is null here
  -- (no upper bound), not a converted sentinel.
  ('chem','hdl','HDL Cholesterol','mmol/L',1.0,99,'mg/dL',39,null,38.67),
  ('chem','trig','Triglycerides','mmol/L',0,1.7,'mg/dL',0,151,88.57),
  ('chem','troponin_i','Troponin I','ng/mL',0,0.04,null,null,null,null),
  ('chem','hs_tnt','hs-TnT','ng/L',0,14,null,null,null,null),
  ('chem','ck','CK Total','U/L',30,200,null,null,null,null),
  ('chem','ckmb','CK-MB','U/L',0,25,null,null,null,null),
  ('chem','nt_probnp','NT-proBNP','pg/mL',0,125,null,null,null,null),
  ('chem','hs_crp','hs-CRP','mg/L',0,5,null,null,null,null),
  ('chem','ldh','LDH','U/L',140,280,null,null,null,null),
  -- ── Serology ─────────────────────────────────────────────────────
  ('sero','rf','RF','IU/mL',0,14,null,null,null,null),
  ('sero','aso','ASO','IU/mL',0,200,null,null,null,null),
  ('sero','ige','IgE (Total)','IU/mL',0,100,null,null,null,null),
  -- ── Immunology (Hormones / Tumour Markers / Vitamins) ───────────
  ('immuno','tsh','TSH','mIU/L',0.4,4.0,null,null,null,null),
  ('immuno','ft4','Free T4','pmol/L',9,25,null,null,null,null),
  ('immuno','ft3','Free T3','pmol/L',3.5,7.8,null,null,null,null),
  ('immuno','t3','Total T3','nmol/L',1.2,2.7,null,null,null,null),
  ('immuno','t4','Total T4','nmol/L',55,161,null,null,null,null),
  ('immuno','fsh','FSH','IU/L',1,12,null,null,null,null),
  ('immuno','lh','LH','IU/L',1,12,null,null,null,null),
  ('immuno','estradiol','Oestradiol','pmol/L',0,999,null,null,null,null),
  ('immuno','prog','Progesterone','nmol/L',0,89,null,null,null,null),
  ('immuno','testosterone','Testosterone','nmol/L',0,31,null,null,null,null),
  ('immuno','prolactin','Prolactin','mIU/L',72,511,null,null,null,null),
  ('immuno','psa','PSA','ng/mL',0,4,null,null,null,null),
  ('immuno','afp','AFP','IU/mL',0,5.8,null,null,null,null),
  ('immuno','cea','CEA','ng/mL',0,5,null,null,null,null),
  ('immuno','ca125','CA-125','U/mL',0,35,null,null,null,null),
  ('immuno','ca199','CA 19-9','U/mL',0,37,null,null,null,null),
  ('immuno','vit_d','Vitamin D','nmol/L',50,250,null,null,null,null),
  ('immuno','vit_b12','Vitamin B12','pmol/L',145,637,null,null,null,null),
  ('immuno','folate','Folate','nmol/L',7,46,null,null,null,null),
  ('immuno','ferritin','Ferritin','µg/L',15,200,null,null,null,null)
on conflict (dept_key, field_code) do nothing;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.45_lab_reference_ranges.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select dept_key, count(*), count(conventional_unit) as has_conventional
--     from public.lab_reference_ranges group by dept_key order by dept_key;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'lab_reference_ranges' order by cmd;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.45_followup_reminders.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- migration_v2.45_followup_reminders.sql
--
-- Adds reminder_sent_at to follow_ups, so the new "Follow-Ups Due Soon"
-- panel on the Appointments page (loadFollowUpsDue()/sendFollowUpReminder()
-- in index.html) can record when an SMS reminder was last sent for a
-- scheduled follow-up, same idea as sms_log but scoped to this one flag
-- so the due-list can show "already reminded" without a join.
--
-- No RLS change needed — follow_ups_update (migration_v2.19) already
-- allows admin/billing-staff (receptionist, cashier — see is_billing_staff()
-- in migration_v2.8) to update rows in this table, which covers the new
-- reminder_sent_at write from the Appointments page.
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.follow_ups add column if not exists reminder_sent_at timestamptz;

comment on column public.follow_ups.reminder_sent_at is
  'Set by sendFollowUpReminder() in index.html when an SMS reminder is sent for this scheduled follow-up (Follow-Ups Due Soon panel, Appointments page). Null = never reminded.';


-- #############################################################################
-- ## migration_v2.46_backup_verify_cron.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- migration_v2.46_backup_verify_cron.sql
--
-- Schedules a daily call to the backup-verify Edge Function (see
-- supabase/functions/backup-verify/index.ts) via pg_cron + pg_net, so the
-- automated backup-verification alert (Tier 2 proposed feature) actually
-- runs without anyone needing to remember to trigger it. The function
-- itself only emails the admin on FAILURE (see that file's comments) —
-- this migration is purely "make it run once a day," nothing more.
--
-- BEFORE RUNNING THIS FILE:
--   1. Deploy the function and set its secrets (see the deploy comment
--      block at the top of supabase/functions/backup-verify/index.ts).
--   2. Replace the two placeholders below:
--        <YOUR-PROJECT-REF>   — your Supabase project ref (from its URL,
--                                https://<ref>.supabase.co)
--        <YOUR-CRON-SECRET>   — the exact same value you set via
--                                `supabase secrets set BACKUP_VERIFY_SECRET=...`
--      This file is not auto-templated — hand-edit those two placeholders
--      before pasting into the SQL editor, the same manual-setup pattern
--      already used for every other Edge Function in this repo.
--
-- Idempotent — safe to re-run (cron.schedule with the same job name
-- replaces the existing schedule rather than duplicating it).
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- >>>>>>>>>>>>>>>>>>>> COMMENTED OUT -- SEE NOTE ABOVE <<<<<<<<<<<<<<<<<<<<
-- Uncomment this block AFTER deploying backup-verify and replacing both
-- <YOUR-PROJECT-REF> and <YOUR-CRON-SECRET> with your real values.
-- select cron.schedule(
--   'backup-verify-daily',
--   '0 2 * * *', -- 02:00 UTC daily — low-traffic hours, adjust to taste
--   $$
--   select net.http_post(
--     url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/backup-verify',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', '<YOUR-CRON-SECRET>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
-- >>>>>>>>>>>>>>>>>>>> END COMMENTED-OUT BLOCK <<<<<<<<<<<<<<<<<<<<

-- To check the job is registered:
--   select * from cron.job where jobname = 'backup-verify-daily';
-- To see recent run results:
--   select * from cron.job_run_details where jobname = 'backup-verify-daily' order by start_time desc limit 10;
-- To remove the schedule entirely:
--   select cron.unschedule('backup-verify-daily');


-- #############################################################################
-- ## migration_v2.47_sample_records_per_order.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.47_sample_records_per_order.sql
-- sample_records: allow one row per SPECIMEN/ORDER-BATCH, not one row
-- forced to be unique per patient
-- ═══════════════════════════════════════════════════════════════════════
--
-- ROOT CAUSE: sample_records has always been written and read as exactly
-- ONE row per patient_id (every insert path in index.html uses
-- .upsert(..., {onConflict:'patient_id'}), which only works against a real
-- unique constraint/index on that column). That's fine for a visit with a
-- single lab order, but a SECOND, later lab order for a DIFFERENT test
-- (e.g. the doctor adds an RFT mid-visit after the original CBC was
-- already collected, received, verified and released) had nowhere to go:
-- the existing row was already Released, and the app deliberately never
-- overwrites an in-progress/finished row's status (see the ignoreDuplicates
-- comment this replaces in _submitLabOrder(), index.html) -- so the new
-- test silently inherited the FIRST order's Released status and skipped
-- Sample Collection/Receipt entirely, becoming directly enterable in
-- Result Entry the moment payment cleared.
--
-- FIX: drop the unique constraint/index on sample_records(patient_id) so a
-- patient can have more than one row -- one per specimen/order-batch, the
-- same way a real lab issues a new accession per draw. index.html's
-- _submitLabOrder() now INSERTs a genuinely new Pending row whenever the
-- patient's most recent specimen has already moved past collection,
-- instead of upserting onto (and thereby either corrupting or being
-- silently ignored by) the existing one.
--
-- "Most recent row" identifies the CURRENT specimen (index.html's
-- getCurrentSampleRecord()/mostRecentSampleByPatient(), used consistently
-- by Worklist, Doctor's View Result gate, the Results Ready notification,
-- Release, and Sample Collection/Receipt) rather than adding a new
-- doctor_orders-batch foreign key column. Deliberate choice: one specimen
-- routinely satisfies SEVERAL simultaneously-ordered tests that share a
-- collection tube (see index.html's getRequiredTubes() -- e.g. CBC + ESR +
-- Blood Film all draw from one EDTA tube), so a rigid one-row-per-order FK
-- would misrepresent the real collection model; created_at ordering is
-- already the established pattern this codebase uses elsewhere for "the
-- current row" once a table can have more than one per patient (see
-- results_*_history tables, migration_v2.17).
--
-- A plain (non-unique) index on patient_id is added back so every existing
-- .eq('patient_id', ...) read stays fast now that the implicit unique
-- index is gone.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor. Apply AFTER
-- migration_v2.8 (sample_records RLS) and migration_v2.18 (payment
-- deferral columns), which this doesn't touch.
-- ═══════════════════════════════════════════════════════════════════════

-- Drop whatever unique constraint or unique index currently enforces
-- one-row-per-patient_id on sample_records, regardless of its name (the
-- base schema that created it isn't part of this checkout — see
-- CLAUDE.md — so its exact name can't be assumed). Only ever touches a
-- unique constraint/index whose columns are EXACTLY {patient_id}; a
-- composite or differently-scoped constraint is left alone.
do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.sample_records'::regclass
      and contype = 'u'
      and (select array_agg(attname::text order by attname)
           from pg_attribute
           where attrelid = conrelid and attnum = any(conkey)) = array['patient_id']
  loop
    execute format('alter table public.sample_records drop constraint %I', con.conname);
  end loop;

  for con in
    select indexrelid::regclass::text as indexname
    from pg_index
    where indrelid = 'public.sample_records'::regclass
      and indisunique
      and not indisprimary
      and (select array_agg(a.attname::text order by a.attname)
           from pg_attribute a
           where a.attrelid = indrelid and a.attnum = any(indkey::int[])) = array['patient_id']
  loop
    execute format('drop index if exists %s', con.indexname);
  end loop;
end $$;

create index if not exists sample_records_patient_id_idx on public.sample_records (patient_id);
create index if not exists sample_records_patient_id_created_at_idx on public.sample_records (patient_id, created_at desc);

comment on table public.sample_records is 'One row PER SPECIMEN/ORDER-BATCH (not per patient) — a patient with multiple lab orders across a visit has multiple rows. "Current" status for a patient is always the most recently created row; see index.html getCurrentSampleRecord()/mostRecentSampleByPatient().';


-- #############################################################################
-- ## migration_v2.48_result_tables_unique_patient_id.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.48_result_tables_unique_patient_id.sql
-- Diagnose + (conditionally) restore the unique constraint on patient_id
-- for the 7 lab results_* tables that every save*Entry() function in
-- index.html upserts against with .upsert(payload, {onConflict:'patient_id'})
-- ═══════════════════════════════════════════════════════════════════════
--
-- CONTEXT: index.html's saveResultWithSafetyChecks() (Haematology/
-- Chemistry) and the six per-department save*Entry() functions (Serology,
-- Immunology, Microbiology, PCR, Histopathology, Cytology) all write via
-- .upsert(payload, {onConflict:'patient_id'}) — every one of these tables
-- is designed and documented throughout this codebase as ONE ROW PER
-- PATIENT. That upsert only works against a REAL unique constraint or
-- unique index on exactly {patient_id}; if the base schema (not part of
-- this checkout — see CLAUDE.md) never created one, or a prior manual
-- change to the database removed it, Postgrest throws
-- "no unique or exclusion constraint matching the ON CONFLICT
-- specification" for that upsert — the exact class of failure already
-- confirmed live on sample_records before its own redesign
-- (migration_v2.47, a DIFFERENT fix — that table intentionally moved to
-- MULTIPLE rows per patient and had its unique constraint dropped; this
-- migration does the opposite check for a different set of tables that
-- are intentionally still one-row-per-patient).
--
-- Paired with an index.html code fix (this same round) that makes a
-- failed .upsert() actually throw and show an error toast instead of
-- being silently swallowed — this migration is the other half: if the
-- constraint itself is missing, that fix will now correctly SURFACE the
-- failure, but the underlying save will still not work until the
-- constraint exists.
--
-- WHAT THIS MIGRATION DOES (all read-only reporting except the final
-- conditional ADD CONSTRAINT):
--   1. For each of the 7 tables, checks whether a unique constraint/index
--      on exactly {patient_id} already exists. If so: reports it and
--      skips (idempotent, safe to re-run).
--   2. If missing, first checks for duplicate patient_id rows (the same
--      pre-check migration_v2.47 used before altering sample_records).
--      If duplicates are found, reports every duplicated patient_id and
--      its row count via RAISE NOTICE and DOES NOT add the constraint for
--      that table — adding a unique constraint over duplicate data would
--      simply fail, and which duplicate row is "correct" to keep is a
--      clinical-data decision this migration will not guess at.
--   3. Only when a table has NO existing patient_id-only unique
--      constraint AND NO duplicate patient_id rows does it add
--      `unique (patient_id)`.
--
-- HOW TO READ THE OUTPUT: run this in the Supabase SQL editor and read
-- the NOTICE messages in the output pane (or Postgres log) — every table
-- gets exactly one of: "already has unique(patient_id) — skipping",
-- "added unique(patient_id)", or "HAS N DUPLICATE PATIENT_ID ROW(S) —
-- NOT adding constraint, needs manual review" followed by one line per
-- duplicated patient_id.
--
-- NOT applied automatically — for manual review and application in the
-- Supabase SQL editor, same as every other migration in this repo.
-- Idempotent — safe to re-run after resolving any reported duplicates.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  tbl text;
  has_constraint boolean;
  dup_count integer;
  dup_row record;
  tables text[] := array[
    'results_hematology','results_chemistry','results_serology',
    'results_microbiology','results_pcr','results_histopathology','results_cytology'
  ];
begin
  foreach tbl in array tables loop
    -- 1. Does a unique constraint/index on exactly {patient_id} already exist?
    select exists (
      select 1
      from pg_constraint
      where conrelid = ('public.'||tbl)::regclass
        and contype = 'u'
        and (select array_agg(attname::text order by attname)
             from pg_attribute
             where attrelid = conrelid and attnum = any(conkey)) = array['patient_id']
    ) or exists (
      select 1
      from pg_index
      where indrelid = ('public.'||tbl)::regclass
        and indisunique
        and (select array_agg(a.attname::text order by a.attname)
             from pg_attribute a
             where a.attrelid = indrelid and a.attnum = any(indkey::int[])) = array['patient_id']
    ) into has_constraint;

    if has_constraint then
      raise notice '%: already has unique(patient_id) — skipping', tbl;
      continue;
    end if;

    -- 2. Pre-check for duplicate patient_id rows before proposing the constraint.
    execute format('select count(*) from (select patient_id from %I group by patient_id having count(*) > 1) d', tbl)
      into dup_count;

    if dup_count > 0 then
      raise notice '%: HAS % DUPLICATE PATIENT_ID ROW(S) — NOT adding constraint, needs manual review', tbl, dup_count;
      for dup_row in execute format('select patient_id, count(*) as n from %I group by patient_id having count(*) > 1 order by n desc', tbl)
      loop
        raise notice '  %: patient_id=% has % rows', tbl, dup_row.patient_id, dup_row.n;
      end loop;
      continue;
    end if;

    -- 3. No existing constraint, no duplicates — safe to add.
    execute format('alter table public.%I add constraint %I unique (patient_id)', tbl, tbl||'_patient_id_key');
    raise notice '%: added unique(patient_id)', tbl;
  end loop;
end $$;


-- #############################################################################
-- ## migration_v2.49_add_missing_is_released_columns.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.49_add_missing_is_released_columns.sql
-- Add the release-tracking columns that enforce_result_lock() expects but
-- the results_* tables never actually had
-- ═══════════════════════════════════════════════════════════════════════
--
-- ROOT CAUSE (confirmed live, via the reviewer running the diagnostic
-- queries from the prior message — not guessed):
--
--   public.enforce_result_lock() (a pre-existing BEFORE UPDATE trigger on
--   the results_* tables, not defined in any migration file in this
--   checkout — see migration_v2.8_rls_security.sql's own comments about
--   it) contains:
--
--     if (old.is_verified is true or old.is_released is true) then ...
--
--   `select table_name, column_name, data_type, column_default from
--   information_schema.columns where table_name like 'results_%' and
--   column_name in ('is_verified','is_released')` came back with
--   is_verified present (boolean, default false — NULL on the two
--   *_history tables) on every results_% table, but is_released absent
--   from ALL of them. Referencing old.is_released against a row type that
--   has no such column is exactly what raises Postgres's
--   "record 'old' has no field 'is_released'" — reproduced by entering a
--   fresh result (INSERT succeeds — the trigger only fires on UPDATE, so
--   a brand-new row's own insert never touches this code path) and then
--   clicking Verify (an UPDATE via .upsert(...,{onConflict:'patient_id'}),
--   which does fire the trigger and immediately fails).
--
--   This matches the FIRST fix option from the task, not the other two:
--   the column is genuinely missing, not a case of a generically-shared
--   trigger attached to a table it was never meant to run on (the app's
--   own JS code — releaseResults(), releaseAllUnifiedEntry(),
--   printAllReports(), DEPT_LOAD_MAP — has always read and written
--   is_released/released_at/released_by on all 7 of these tables; the
--   database just never actually had the columns for it to persist to),
--   and not a typo/name-mismatch (is_verified, the sibling column the
--   trigger also checks, exists and works correctly under that exact
--   name).
--
-- SCOPE: the 7 "live" results_* tables the app's Unified Results Entry /
-- Release workflow actually reads and writes per-patient
-- (results_hematology, results_chemistry, results_serology,
-- results_microbiology, results_pcr, results_histopathology,
-- results_cytology) — the same list migration_v2.8_rls_security.sql's
-- audited_tables array uses for the results_* portion of its audit
-- trigger. Deliberately NOT extended to results_hematology_history /
-- results_chemistry_history (the only two *_history tables that matched
-- table_name like 'results_%' in the diagnostic query, which is why they
-- showed up with a NULL is_verified default rather than false): those are
-- written INSERT-only (see logResultHistory() / migration_v2.17 — one row
-- per SAVE, an append-only audit trail, never updated after the fact), so
-- a BEFORE UPDATE trigger never fires against them regardless of which
-- columns they have, and no JS code anywhere reads or writes is_released
-- on either history table. Adding it there would be unused schema, not a
-- fix for anything.
--
-- Types/defaults: is_released matches is_verified's own pattern on these
-- same 7 tables exactly (boolean, not null, default false — a fresh row
-- is never released). released_at/released_by match the existing
-- verified_at/performed_by sibling columns' conventions already used
-- everywhere else in this schema (timestamptz set from the client's
-- new Date().toISOString(), uuid set from currentProfile.id / auth.uid()).
--
-- Uses ADD COLUMN IF NOT EXISTS throughout — idempotent and additive
-- only; safe to re-run, and safe even if a column turns out to already
-- exist under this exact name on some table for a reason this diagnostic
-- pass didn't catch. This migration does not touch enforce_result_lock()
-- itself, any other function, or any existing migration file — once these
-- columns exist, the trigger's existing logic (unmodified) resolves
-- old.is_released correctly on its own.
--
-- NOT applied automatically — for manual review and application in the
-- Supabase SQL editor, per our normal process.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  tbl text;
  tables text[] := array[
    'results_hematology','results_chemistry','results_serology',
    'results_microbiology','results_pcr','results_histopathology','results_cytology'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I add column if not exists is_released boolean not null default false', tbl);
    execute format('alter table public.%I add column if not exists released_at timestamptz', tbl);
    execute format('alter table public.%I add column if not exists released_by uuid', tbl);
    raise notice '%: is_released/released_at/released_by present (added if missing)', tbl;
  end loop;
end $$;


-- #############################################################################
-- ## migration_v2.50_doctor_specialty_routing.sql
-- #############################################################################

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


-- #############################################################################
-- ## migration_v2.51_lab_investigation_history.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.51_lab_investigation_history.sql
-- Patient Lab Investigation History — unified append-only EAV table
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST (see PR description / commit message for the full
-- write-up)
--   migration_v2.17_lab_result_history.sql already added
--   results_hematology_history / results_chemistry_history — append-only,
--   one WIDE row per save (same columns as the current-panel table), fed
--   by logResultHistory() from saveResultWithSafetyChecks()'s doFinalize().
--   BUT that shared save pipeline is only used by Haematology and
--   Chemistry — Serology, Immunology, Microbiology, PCR, Histopathology,
--   and Cytology each upsert directly in their own save*Entry() with no
--   history write at all. And critically: NO browsable UI exists anywhere
--   for either of the two history tables that DO exist today — they're
--   only ever read by runDeltaCheck() and two narrow sparkline widgets
--   (Doctor Consultation's glucose trend, Patient History Timeline's
--   hgb/wbc/plt/creat/urea/fbs/alt/ast/alp/ggt trend card).
--
-- WHY A NEW UNIFIED TABLE, NOT "extend the existing per-department wide
-- tables to the other 5 departments" (my first-draft answer to the user)
--   The requested browser (Phase 3) needs, in one query per patient:
--   "every test this patient has ever had, browsable BY TEST NAME across
--   all departments, or BY DATE across all departments." A per-department
--   WIDE table (one column per analyte) is the right shape for
--   runDeltaCheck()'s actual question — "what was THIS patient's last
--   Creatinine" — but it is the wrong shape for "list every test type
--   this patient has ever had, with every date it was performed," which
--   would otherwise mean querying 7 differently-shaped tables and
--   reassembling them client-side. This table is EAV (one row per
--   test/analyte per save), matching Phase 3's own browsing shape
--   directly. It does NOT replace or duplicate results_hematology_history/
--   results_chemistry_history — those keep serving Delta Check exactly as
--   before, untouched. Going forward, a Haematology/Chemistry save writes
--   to BOTH: its existing wide history row (Delta Check) AND rows here
--   (the investigation browser) — two different shapes because they serve
--   two genuinely different questions, not two competing mechanisms for
--   the same one.
--
-- WHAT THIS MIGRATION ADDS (additive only — nothing existing is touched,
-- migration_v2.17's tables are NOT modified)
--   lab_result_history: one row per (patient, test/analyte, save), written
--   by a new logLabResultHistory() in index.html, called from all 7
--   department save functions (Phase 2 — separate commit, not in this
--   migration). Current-panel tables (results_hematology etc.) and
--   migration_v2.17's two history tables are entirely unaffected.
--
-- COLUMN CHOICES
--   department: DEPT_META's short key ('hem','chem','sero','immuno',
--     'micro','pcr','histo','cyto') — same vocabulary index.html already
--     uses everywhere else, not the raw results_* table name.
--   test_code: the underlying field code (e.g. 'hgb','creat') where one
--     exists — lets the browser/trend-chart re-resolve RESULT_META/
--     getLabRefRange() for a field later (unit-system conversion etc.)
--     without re-deriving it from the label text. Null for narrative
--     fields (e.g. Histopathology's free-text diagnosis) that have no
--     underlying analyte code.
--   value / value_numeric: value is always populated (text, so a
--     qualitative result like "Reactive" or a narrative diagnosis fits
--     the same column as a numeric one); value_numeric is populated in
--     parallel whenever the result is actually numeric, so trend charts
--     and sorting never need to parse the text column.
--   ref_range_lo / ref_range_hi: numeric bounds for flagging, mirroring
--     RESULT_META's own {lo,hi} shape (getLabRefRange() in index.html) —
--     null for qualitative/narrative fields where a numeric range makes
--     no sense.
--   ref_range_text: a freeform display string for cases where lo/hi don't
--     apply (e.g. "Negative", "Non-reactive") or as a human-readable
--     mirror of lo–hi for numeric fields, computed at write time so the
--     browser never needs to re-derive it.
--   flag: 'H'/'L'/'N', null when not applicable. Computed and stored at
--     write time (not recomputed at read time) so a later reference-range
--     edit in the Reference Ranges admin page never silently re-flags
--     historical results that were never actually re-evaluated.
--   sample_id: this app's Lab No. (patients.lab_no) at time of save, not
--     a separate specimen-tracking id (this app doesn't have one).
--   mrn: denormalized snapshot from patients.mrn at insert time — lets the
--     browser query "every result for this person across every visit"
--     directly by mrn (same allIdsForMrn pattern runDeltaCheck()/
--     loadPthTimeline() already use, just avoiding that extra patients
--     lookup on every read of this table).
--   source_table: which current-panel table this row was derived from
--     (e.g. 'results_hematology') — audit/debugging trail back to the
--     row that was actually upserted.
--
-- NO BACKFILL IN THIS MIGRATION (unlike migration_v2.17, which backfilled
-- one row per patient from the then-current single-row tables). Unpacking
-- 7 structurally different current-panel tables (flat numeric columns,
-- qualitative text columns, and two genuinely nested jsonb shapes — PCR's
-- targets array, Histopathology's ihc_results object) into EAV rows via
-- one SQL script is materially riskier to get right blind than
-- migration_v2.17's straight column-for-column copy was. History starts
-- accumulating from the next save once Phase 2 wires each department's
-- save*Entry() to logLabResultHistory(). If a backfill of EXISTING
-- current-panel data is wanted, say so and it'll be scoped as its own
-- reviewed migration rather than folded in here.
--
-- RLS — same protection level and helper functions as migration_v2.17.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.50.
-- ═══════════════════════════════════════════════════════════════════════


create table if not exists public.lab_result_history (
  id               bigint generated always as identity primary key,
  patient_id       uuid not null references public.patients(id) on delete cascade,
  mrn              text,
  department       text not null,
  source_table     text,
  test_code        text,
  test_name        text not null,
  value            text,
  value_numeric    numeric,
  unit             text,
  ref_range_lo     numeric,
  ref_range_hi     numeric,
  ref_range_text   text,
  flag             text check (flag in ('H','L','N') or flag is null),
  is_verified      boolean not null default false,
  verified_by      uuid,
  verified_at      timestamptz,
  sample_id        text,
  created_by       uuid,
  saved_at         timestamptz not null default now()
);

-- Every read this feature does is scoped to one patient (test-type tree),
-- one patient+date (the detail table), or one mrn across visits — these
-- three indexes cover all three access patterns without a sequential scan.
create index if not exists lab_result_history_patient_idx
  on public.lab_result_history (patient_id, saved_at desc);

create index if not exists lab_result_history_patient_test_idx
  on public.lab_result_history (patient_id, test_code, saved_at desc);

create index if not exists lab_result_history_mrn_idx
  on public.lab_result_history (mrn, saved_at desc);

alter table public.lab_result_history enable row level security;

drop policy if exists lab_result_history_select on public.lab_result_history;
create policy lab_result_history_select on public.lab_result_history
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists lab_result_history_insert on public.lab_result_history;
create policy lab_result_history_insert on public.lab_result_history
  for insert with check (public.is_admin() or public.is_lab_staff());

-- No update/delete policy anywhere in this file, on purpose — this table
-- is append-only by design, same convention as migration_v2.17's two
-- history tables. A bad row is corrected with a new row, not an edit.

revoke all on public.lab_result_history from anon;
grant select, insert on public.lab_result_history to authenticated;
grant usage, select on sequence lab_result_history_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.51_lab_investigation_history.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select count(*) from public.lab_result_history;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'lab_result_history'
--     order by cmd;
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.52_rls_gap_closure.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.52_rls_gap_closure.sql
-- Row-Level Security for the 15 tables migration_v2.8 (and everything
-- since) never covered
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHO THIS IS FOR
--   Run this in the Supabase SQL editor against a project that already has
--   migration_v2.8_rls_security.sql applied (this file depends on its
--   helper functions: current_staff_role(), is_admin(), is_clinical_staff(),
--   is_lab_staff(), is_billing_staff() — all reused here unchanged, none
--   redefined). Written the same way v2.8 was: by reverse-engineering
--   every sb.from(...) call in index.html against these 15 tables, since
--   no schema .sql files ship in this checkout (see CLAUDE.md).
--
-- WHY THIS MATTERS
--   A design audit of the whole app's RLS coverage found 60 tables in use
--   by index.html. 49 already have RLS (41 explicit + the 7 results_*
--   tables covered by v2.8's dynamic loop, plus a handful added by later
--   migrations). These 15 do not have ANY RLS policy — not "wrong role
--   scoping," genuinely zero access control beyond "authenticated." Any
--   staff login (any role) can currently read or write every row in every
--   one of them via the Supabase REST API directly, same class of gap
--   v2.8 closed for its 14 tables, just never extended to these:
--     appointments, beds, discharge_summaries, doctor_orders, doctors,
--     id_counters, infection_flags, pre_op_assessments, prescriptions,
--     price_list, qc_lots, qc_results, theatre_bookings, vital_signs,
--     ward_handover_notes
--
-- SCOPE
--   RLS enabled + scoped policies for exactly the 15 tables above. Nothing
--   else touched — no changes to any table v2.8 or a later migration
--   already covers.
--
-- ROLE MODEL
--   Identical to v2.8: staff-only system, no patient self-access, every
--   policy resolves the caller via current_staff_role() /
--   staff.user_id = auth.uid(). Same 9 roles: admin, doctor, nurse,
--   lab_tech, lab_supervisor, receptionist, cashier, theatre_nurse,
--   radiologist.
--
-- DESIGN NOTES / JUDGMENT CALLS (read before you apply this)
--   1. Role sets below come from TWO sources cross-checked against each
--      other, same discipline as v2.8: (a) ROLE_PAGES in index.html — which
--      roles can reach the page a table belongs to, and (b) actually
--      grepping every .insert()/.update()/.delete()/.select() call site on
--      each table to confirm which roles' code paths actually touch it.
--      Where they agreed, that's the policy. Where they didn't, the
--      disagreement is called out explicitly per table below.
--   2. price_list is the one place this migration deliberately does NOT
--      follow a stale precedent already in the codebase:
--      migration_v2.45_lab_reference_ranges.sql's own comment says
--      "Write access is admin-only, same as Price List" — but price_list
--      itself was never actually given RLS until now, and the app's real
--      Price List page renders Edit/Delete/Save buttons for admin,
--      receptionist, AND cashier with no client-side admin gate (ROLE_PAGES
--      grants all three the 'prices' page). Making price_list admin-only
--      here would silently break existing receptionist/cashier
--      functionality the app has always allowed. Write access below
--      matches what the app actually lets those roles do, not the other
--      migration's aspirational comment.
--   3. doctor_orders splits INSERT from UPDATE: only doctor + admin ever
--      call .insert() (order placement lives on the doctor-only
--      'consultation' page), but nurse legitimately calls .update() too —
--      loadNursingOrders()'s "Mark Done" is the missing write-back side of
--      doctor-placed Nursing-type orders (see that function's own comment
--      in index.html) and cancelOrder() is reachable from more than one
--      page. SELECT is broader still (is_clinical_staff()) because a STAT/
--      Urgent orders banner and admission-detail views read this table
--      from pages beyond just Consultation and Nursing.
--   4. beds splits the same way for a different reason: INSERT/DELETE are
--      the "add/remove a physical bed" config actions (admin-only, a
--      Settings-style action) — UPDATE is bed *status* changes
--      (Occupied/Available/transfer), which admission/discharge/transfer
--      flows perform from doctor, nurse, and theatre_nurse contexts, not
--      just admin. RLS can't distinguish "config edit" from "status
--      update" by call site, only by policy — so INSERT/DELETE stay
--      narrow and UPDATE stays as broad as the roles that actually
--      legitimately change a bed's status.
--   5. pre_op_assessments and theatre_bookings are doctor + theatre_nurse +
--      admin, NOT nurse — ROLE_PAGES does not grant plain 'nurse' the
--      'theatre' page (theatre_nurse and doctor have it, nurse does not).
--      Easy to get wrong by pattern-matching "clinical staff usually
--      includes nurse" — checked ROLE_PAGES directly instead of assuming.
--   6. ward_handover_notes is nurse + admin only, matching ROLE_PAGES'
--      'handover' page grant exactly (not doctor, not theatre_nurse).
--   7. doctors and id_counters both need much broader SELECT than their
--      own "management" pages suggest, because they're read as reference/
--      infrastructure data from many other pages: doctors.name/specialty
--      feeds the registration doctor picker (receptionist) and consultation
--      fee lookups (billing), so SELECT is effectively every staff role;
--      id_counters is read/incremented by getNextNumber() from every role
--      that ever registers a patient, places an order, or admits someone
--      — only cashier never touches it. WRITE to both stays narrow
--      (doctors: admin + lab_supervisor, matching the 'doctors' page
--      exactly; id_counters: same broad set as its SELECT, since
--      getNextNumber()'s self-healing path and the admin-only
--      correctIdCounter() panel both issue the exact same shaped UPDATE
--      statement and RLS can't tell them apart by call site).
--   8. infection_flags has no .insert() call site anywhere in index.html
--      today — rows likely arrive via a mechanism outside this checkout
--      (a trigger or manual entry not present here). INSERT policy below
--      still matches the 'infection' page's role grant (admin, nurse,
--      receptionist) as the safe default, rather than leaving it
--      admin-only and potentially blocking a legitimate path this
--      migration's author couldn't see.
--   9. DELETE on every table below is admin-only, matching v2.8's Design
--      Note #4 and deletePatientRecord()'s own admin-only guard — none of
--      these 15 tables have an app-level DELETE call site for any
--      non-admin role except beds (bed config removal) and price_list
--      (admin/receptionist/cashier per Note #2), both handled in their own
--      sections.
--
-- This migration is idempotent — every statement can be re-run safely.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — appointments
-- ───────────────────────────────────────────────────────────────────────
-- ROLE_PAGES grants 'appointments' to admin + receptionist only. Confirmed
-- against call sites: bookAppointment()/updateAppointmentStatus() are only
-- reachable from the Appointments page.

alter table public.appointments enable row level security;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select
  using (public.is_admin() or public.current_staff_role() = 'receptionist');

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'receptionist');

drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments
  for update
  using (public.is_admin() or public.current_staff_role() = 'receptionist')
  with check (public.is_admin() or public.current_staff_role() = 'receptionist');

drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — beds  (see Design Note #4 — INSERT/DELETE vs UPDATE split)
-- ───────────────────────────────────────────────────────────────────────

alter table public.beds enable row level security;

drop policy if exists beds_select on public.beds;
create policy beds_select on public.beds
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists beds_insert on public.beds;
create policy beds_insert on public.beds
  for insert
  with check (public.is_admin());

drop policy if exists beds_update on public.beds;
create policy beds_update on public.beds
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists beds_delete on public.beds;
create policy beds_delete on public.beds
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — discharge_summaries  (mirrors admissions' own role set)
-- ───────────────────────────────────────────────────────────────────────

alter table public.discharge_summaries enable row level security;

drop policy if exists discharge_summaries_select on public.discharge_summaries;
create policy discharge_summaries_select on public.discharge_summaries
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists discharge_summaries_insert on public.discharge_summaries;
create policy discharge_summaries_insert on public.discharge_summaries
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists discharge_summaries_update on public.discharge_summaries;
create policy discharge_summaries_update on public.discharge_summaries
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists discharge_summaries_delete on public.discharge_summaries;
create policy discharge_summaries_delete on public.discharge_summaries
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 4 — doctor_orders  (see Design Note #3 — INSERT narrower than UPDATE)
-- ───────────────────────────────────────────────────────────────────────

alter table public.doctor_orders enable row level security;

drop policy if exists doctor_orders_select on public.doctor_orders;
create policy doctor_orders_select on public.doctor_orders
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists doctor_orders_insert on public.doctor_orders;
create policy doctor_orders_insert on public.doctor_orders
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists doctor_orders_update on public.doctor_orders;
create policy doctor_orders_update on public.doctor_orders
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse')
  );

drop policy if exists doctor_orders_delete on public.doctor_orders;
create policy doctor_orders_delete on public.doctor_orders
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 5 — doctors  (see Design Note #7 — broad SELECT, narrow WRITE)
-- ───────────────────────────────────────────────────────────────────────

alter table public.doctors enable row level security;

drop policy if exists doctors_select on public.doctors;
create policy doctors_select on public.doctors
  for select
  using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

drop policy if exists doctors_insert on public.doctors;
create policy doctors_insert on public.doctors
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'lab_supervisor');

drop policy if exists doctors_update on public.doctors;
create policy doctors_update on public.doctors
  for update
  using (public.is_admin() or public.current_staff_role() = 'lab_supervisor')
  with check (public.is_admin() or public.current_staff_role() = 'lab_supervisor');

drop policy if exists doctors_delete on public.doctors;
create policy doctors_delete on public.doctors
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 6 — id_counters  (see Design Note #7 — infrastructure, not clinical)
-- ───────────────────────────────────────────────────────────────────────
-- Every role except cashier can trigger a getNextNumber() call somewhere
-- in the app (registration, admission, lab/radiology ordering). The admin-
-- only correctIdCounter() panel issues the identical UPDATE shape as the
-- routine self-healing path, so one shared policy covers both correctly.

alter table public.id_counters enable row level security;

drop policy if exists id_counters_select on public.id_counters;
create policy id_counters_select on public.id_counters
  for select
  using (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  );

drop policy if exists id_counters_insert on public.id_counters;
create policy id_counters_insert on public.id_counters
  for insert
  with check (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  );

drop policy if exists id_counters_update on public.id_counters;
create policy id_counters_update on public.id_counters
  for update
  using (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  )
  with check (
    public.is_admin() or public.is_clinical_staff()
    or public.current_staff_role() = 'receptionist'
  );

drop policy if exists id_counters_delete on public.id_counters;
create policy id_counters_delete on public.id_counters
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 7 — infection_flags  (see Design Note #8 — no current INSERT call site)
-- ───────────────────────────────────────────────────────────────────────

alter table public.infection_flags enable row level security;

drop policy if exists infection_flags_select on public.infection_flags;
create policy infection_flags_select on public.infection_flags
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('nurse','receptionist')
    or public.is_clinical_staff()
  );

drop policy if exists infection_flags_insert on public.infection_flags;
create policy infection_flags_insert on public.infection_flags
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('nurse','receptionist')
  );

drop policy if exists infection_flags_update on public.infection_flags;
create policy infection_flags_update on public.infection_flags
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('nurse','receptionist')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('nurse','receptionist')
  );

drop policy if exists infection_flags_delete on public.infection_flags;
create policy infection_flags_delete on public.infection_flags
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 8 — pre_op_assessments  (see Design Note #5 — no plain 'nurse')
-- ───────────────────────────────────────────────────────────────────────

alter table public.pre_op_assessments enable row level security;

drop policy if exists pre_op_assessments_select on public.pre_op_assessments;
create policy pre_op_assessments_select on public.pre_op_assessments
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists pre_op_assessments_insert on public.pre_op_assessments;
create policy pre_op_assessments_insert on public.pre_op_assessments
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists pre_op_assessments_update on public.pre_op_assessments;
create policy pre_op_assessments_update on public.pre_op_assessments
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists pre_op_assessments_delete on public.pre_op_assessments;
create policy pre_op_assessments_delete on public.pre_op_assessments
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 9 — prescriptions
-- ───────────────────────────────────────────────────────────────────────
-- WRITE is doctor + admin only (Rx tab lives on the doctor-only
-- 'consultation' page, same as doctor_consultations in v2.8). SELECT is
-- the broader clinical group — Patient History Timeline surfaces past
-- prescriptions to every clinical role for continuity of care, same
-- reasoning v2.8 used for doctor_consultations/radiology_requests SELECT.

alter table public.prescriptions enable row level security;

drop policy if exists prescriptions_select on public.prescriptions;
create policy prescriptions_select on public.prescriptions
  for select
  using (public.is_admin() or public.is_clinical_staff());

drop policy if exists prescriptions_insert on public.prescriptions;
create policy prescriptions_insert on public.prescriptions
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists prescriptions_update on public.prescriptions;
create policy prescriptions_update on public.prescriptions
  for update
  using (public.is_admin() or public.current_staff_role() = 'doctor')
  with check (public.is_admin() or public.current_staff_role() = 'doctor');

drop policy if exists prescriptions_delete on public.prescriptions;
create policy prescriptions_delete on public.prescriptions
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 10 — price_list  (see Design Note #2 — deliberately NOT admin-only write)
-- ───────────────────────────────────────────────────────────────────────

alter table public.price_list enable row level security;

drop policy if exists price_list_select on public.price_list;
create policy price_list_select on public.price_list
  for select
  using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

drop policy if exists price_list_insert on public.price_list;
create policy price_list_insert on public.price_list
  for insert
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists price_list_update on public.price_list;
create policy price_list_update on public.price_list
  for update
  using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists price_list_delete on public.price_list;
create policy price_list_delete on public.price_list
  for delete
  using (public.is_admin() or public.is_billing_staff());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 11 — qc_lots / qc_results  (identical role sets — matches
-- ROLE_PAGES 'qc' page grant exactly: admin, lab_tech, lab_supervisor)
-- ───────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  qc_tables text[] := array['qc_lots','qc_results'];
begin
  foreach t in array qc_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select
        using (public.is_admin() or public.is_lab_staff())
    $f$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($f$
      create policy %I on public.%I
        for insert
        with check (public.is_admin() or public.is_lab_staff())
    $f$, t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($f$
      create policy %I on public.%I
        for update
        using (public.is_admin() or public.is_lab_staff())
        with check (public.is_admin() or public.is_lab_staff())
    $f$, t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($f$
      create policy %I on public.%I
        for delete
        using (public.is_admin())
    $f$, t || '_delete', t);
  end loop;
end $$;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 12 — theatre_bookings  (see Design Note #5 — no plain 'nurse')
-- ───────────────────────────────────────────────────────────────────────

alter table public.theatre_bookings enable row level security;

drop policy if exists theatre_bookings_select on public.theatre_bookings;
create policy theatre_bookings_select on public.theatre_bookings
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists theatre_bookings_insert on public.theatre_bookings;
create policy theatre_bookings_insert on public.theatre_bookings
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists theatre_bookings_update on public.theatre_bookings;
create policy theatre_bookings_update on public.theatre_bookings
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','theatre_nurse')
  );

drop policy if exists theatre_bookings_delete on public.theatre_bookings;
create policy theatre_bookings_delete on public.theatre_bookings
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 13 — vital_signs  (matches ROLE_PAGES 'nursing'/'fluid-chart')
-- ───────────────────────────────────────────────────────────────────────

alter table public.vital_signs enable row level security;

drop policy if exists vital_signs_select on public.vital_signs;
create policy vital_signs_select on public.vital_signs
  for select
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists vital_signs_insert on public.vital_signs;
create policy vital_signs_insert on public.vital_signs
  for insert
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists vital_signs_update on public.vital_signs;
create policy vital_signs_update on public.vital_signs
  for update
  using (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  )
  with check (
    public.is_admin()
    or public.current_staff_role() in ('doctor','nurse','theatre_nurse')
  );

drop policy if exists vital_signs_delete on public.vital_signs;
create policy vital_signs_delete on public.vital_signs
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 14 — ward_handover_notes  (see Design Note #6 — nurse + admin only)
-- ───────────────────────────────────────────────────────────────────────

alter table public.ward_handover_notes enable row level security;

drop policy if exists ward_handover_notes_select on public.ward_handover_notes;
create policy ward_handover_notes_select on public.ward_handover_notes
  for select
  using (public.is_admin() or public.current_staff_role() = 'nurse');

drop policy if exists ward_handover_notes_insert on public.ward_handover_notes;
create policy ward_handover_notes_insert on public.ward_handover_notes
  for insert
  with check (public.is_admin() or public.current_staff_role() = 'nurse');

drop policy if exists ward_handover_notes_update on public.ward_handover_notes;
create policy ward_handover_notes_update on public.ward_handover_notes
  for update
  using (public.is_admin() or public.current_staff_role() = 'nurse')
  with check (public.is_admin() or public.current_staff_role() = 'nurse');

drop policy if exists ward_handover_notes_delete on public.ward_handover_notes;
create policy ward_handover_notes_delete on public.ward_handover_notes
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 15 — Defense-in-depth: make sure `anon` has nothing here
-- ───────────────────────────────────────────────────────────────────────

revoke all on
  public.appointments, public.beds, public.discharge_summaries,
  public.doctor_orders, public.doctors, public.id_counters,
  public.infection_flags, public.pre_op_assessments, public.prescriptions,
  public.price_list, public.qc_lots, public.qc_results,
  public.theatre_bookings, public.vital_signs, public.ward_handover_notes
from anon;

grant select, insert, update, delete on
  public.appointments, public.beds, public.discharge_summaries,
  public.doctor_orders, public.doctors, public.id_counters,
  public.infection_flags, public.pre_op_assessments, public.prescriptions,
  public.price_list, public.qc_lots, public.qc_results,
  public.theatre_bookings, public.vital_signs, public.ward_handover_notes
to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.52_rls_gap_closure.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public'
--       and tablename in (
--         'appointments','beds','discharge_summaries','doctor_orders',
--         'doctors','id_counters','infection_flags','pre_op_assessments',
--         'prescriptions','price_list','qc_lots','qc_results',
--         'theatre_bookings','vital_signs','ward_handover_notes'
--       )
--     order by tablename, cmd;
--
-- Then re-test a login as each role (or query via a service_role-signed
-- JWT with the relevant staff row) to confirm nobody lost access they
-- actually need before rolling this out to the live project — in
-- particular: receptionist/cashier on Price List (Note #2), nurse on
-- "Mark Done" for doctor-placed Nursing orders (Note #3), and the
-- ID Counters admin panel under Settings (Note #7).
-- ═══════════════════════════════════════════════════════════════════════


-- #############################################################################
-- ## migration_v2.53_beds_realtime_publication.sql
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- migration_v2.53_beds_realtime_publication.sql
--
-- Wires the `beds` table into the `supabase_realtime` publication so the
-- bed-grid's Postgres Changes subscription actually receives live updates.
--
-- index.html's loadBedGrid() multi-device sync (sb.channel('beds-grid-
-- realtime').on('postgres_changes', {event:'*', schema:'public',
-- table:'beds'}, ...)) has been in the app since the bed-grid feature was
-- built, but no migration ever added `beds` to the `supabase_realtime`
-- publication — the one piece of DB-level config Supabase's Postgres
-- Changes feature actually requires per table. Confirmed via a live
-- introspection diff (2026-08-26) against both Friendship Hospital's real
-- production project and a fresh throwaway project: `select * from
-- pg_publication_tables where pubname = 'supabase_realtime'` returns zero
-- rows on BOTH — so this has never worked on production either, not just
-- on fresh projects. Not a fresh-vs-real gap; a standalone bug.
--
-- Idempotent — ADD TABLE IF NOT EXISTS wasn't available for publications
-- until relatively recent Postgres versions, so this guards manually via
-- pg_publication_tables instead of assuming a bare ADD TABLE won't error
-- on a second run.
-- ═══════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'beds'
  ) then
    alter publication supabase_realtime add table public.beds;
  end if;
end $$;

-- To confirm it's now live:
--   select * from pg_publication_tables where pubname = 'supabase_realtime';
-- Should include a row for schemaname='public', tablename='beds'.

-- =============================================================================
-- Done. Every table, function, trigger, RLS policy, and index through
-- v2.53 now exists on this project. Next steps (see SETUP.md steps 4-10):
--   4. Deploy the Edge Functions (supabase/functions/) and set their
--      secrets, including uncommenting + filling in the cron.schedule
--      block above for backup-verify once that function is deployed.
--   5. Deploy the whole app folder (index.html + assets/ + sw.js) to your
--      static host.
--   6. Enter your Supabase URL/anon key in the app's login screen.
--   7. Create your first admin staff account directly in Supabase.
--   8. Sign in as that admin and fill in Hospital Name/Address/Currency
--      etc. under Settings.
--   9. Optionally load default prices from the Price List page.
-- =============================================================================
