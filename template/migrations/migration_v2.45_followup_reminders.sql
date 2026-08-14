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
