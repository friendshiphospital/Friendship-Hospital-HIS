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
