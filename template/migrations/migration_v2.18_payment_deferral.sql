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
