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
