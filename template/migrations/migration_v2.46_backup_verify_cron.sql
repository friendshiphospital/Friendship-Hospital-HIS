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

select cron.schedule(
  'backup-verify-daily',
  '0 2 * * *', -- 02:00 UTC daily — low-traffic hours, adjust to taste
  $$
  select net.http_post(
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/backup-verify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<YOUR-CRON-SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check the job is registered:
--   select * from cron.job where jobname = 'backup-verify-daily';
-- To see recent run results:
--   select * from cron.job_run_details where jobname = 'backup-verify-daily' order by start_time desc limit 10;
-- To remove the schedule entirely:
--   select cron.unschedule('backup-verify-daily');
