// supabase/functions/backup-verify/index.ts
//
// Automated backup-verification alert (Tier 2 proposed feature). Runs on a
// schedule (see migration_v2.46_backup_verify_cron.sql — pg_cron + pg_net
// calling this function daily) and does a lightweight read-check against
// the database. Alerts the admin by email ONLY on failure — a daily
// "backups are fine" email nobody reads doesn't fit a low-attention,
// one-admin operational model (see docs/proposed-features.md item 8).
//
// WHAT "verification" MEANS HERE: Supabase itself manages the actual
// backup/restore mechanism on paid tiers — this function cannot trigger or
// inspect an actual restore. What it CAN meaningfully check, on a schedule,
// without any new infrastructure: the database is reachable via
// service_role, a small set of core tables actually contain rows (an
// empty `staff` table on a live deployment is itself a strong signal
// something is badly wrong, restore-related or not), and the query
// completes within a sane time budget. That's "is the data still there
// and readable" — a real, if partial, substitute for "did the backup
// actually work" in an environment with no access to the backup system
// itself.
//
// AUTH: unlike the other Edge Functions in this repo, this one is never
// called from index.html with a logged-in user's session — it's invoked
// by pg_cron on a schedule with no human present. It's instead gated by a
// shared secret (BACKUP_VERIFY_SECRET) passed as the x-cron-secret header,
// set once in both the Edge Function secrets and the cron job's HTTP call
// (see the migration). This keeps the endpoint from being callable by
// anyone who finds the URL, without requiring a real user JWT that no
// scheduled job has.
//
// DEPLOY:
//   supabase functions deploy backup-verify
//   supabase secrets set BACKUP_VERIFY_SECRET=some_long_random_string
//   supabase secrets set RESEND_API_KEY=re_your_key_here        (same as reception-shift-notify/send-email, if not already set)
//   supabase secrets set EMAIL_FROM="Friendship Hospital HIS <noreply@yourdomain.com>"
//   supabase secrets set ADMIN_EMAIL=admin@hospital.com
// Then run migration_v2.46_backup_verify_cron.sql in the Supabase SQL
// editor to schedule the daily call (it needs the same
// BACKUP_VERIFY_SECRET value and this function's URL filled in — see that
// file's own comments).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Cheap, load-bearing tables whose emptiness on a live deployment is
// itself a strong anomaly signal — not an exhaustive list, just enough to
// catch "the database came back empty" without a heavy full-schema scan.
const CHECK_TABLES = ["staff", "patients"];

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const CRON_SECRET = Deno.env.get("BACKUP_VERIFY_SECRET");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "Friendship Hospital HIS <noreply@friendshiphospital.example>";
  const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured: missing Supabase environment" }, 500);
  }
  if (!CRON_SECRET) {
    return json({ error: "Server misconfigured: BACKUP_VERIFY_SECRET not set" }, 500);
  }
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const checkedAt = new Date().toISOString();
  const failures: string[] = [];

  for (const table of CHECK_TABLES) {
    try {
      const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
      if (error) failures.push(`${table}: query error — ${error.message}`);
      else if (!count || count < 1) failures.push(`${table}: table is empty (count=${count ?? 0})`);
    } catch (e) {
      failures.push(`${table}: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  if (!failures.length) {
    // Silent success by design — see the file header comment.
    return json({ ok: true, checked_at: checkedAt, tables: CHECK_TABLES });
  }

  // Failure path: alert the admin, but never let a missing/broken email
  // setup mask the underlying failure result — the alert is best-effort,
  // the {ok:false} response is the actual signal a monitoring caller (or
  // a human checking the Edge Function logs) relies on either way.
  let alerted = false;
  if (RESEND_API_KEY && ADMIN_EMAIL) {
    try {
      const html = `<p>Friendship Hospital HIS backup-verification check failed at ${checkedAt}:</p>
        <ul>${failures.map((f) => `<li>${f.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))}</li>`).join("")}</ul>
        <p>This does not necessarily mean a backup failed — Supabase manages backups directly — but the database did not pass its routine readability check and should be investigated.</p>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: EMAIL_FROM, to: [ADMIN_EMAIL], subject: "⚠️ Backup Verification Failed — Friendship Hospital HIS", html }),
      });
      alerted = res.ok;
    } catch {
      alerted = false;
    }
  }

  return json({ ok: false, checked_at: checkedAt, failures, alerted }, 200);
});
