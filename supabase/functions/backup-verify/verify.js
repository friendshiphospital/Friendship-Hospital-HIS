// supabase/functions/backup-verify/verify.js
//
// Standalone end-to-end check for the automated backup-verification
// pipeline — same purpose as reception-shift-notify/verify.js, adapted
// for this function's different auth model (a shared cron secret, not a
// staff login, since pg_cron calls this with no human session — see the
// AUTH comment at the top of index.ts). Calls the deployed function
// exactly like the scheduled cron job does and prints its JSON response.
//
// No new dependency: plain Node 18+ fetch(), matching this repo's
// zero-npm-dependency convention (see CLAUDE.md).
//
// USAGE:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   BACKUP_VERIFY_SECRET=same-value-as-the-deployed-secret \
//   node supabase/functions/backup-verify/verify.js
//
// SUPABASE_URL: same value entered in the app's own "⚙ Supabase
//   Configuration" panel (localStorage sb_url).
// BACKUP_VERIFY_SECRET: the exact value set via
//   `supabase secrets set BACKUP_VERIFY_SECRET=...` — this script sends it
//   as the x-cron-secret header, same as migration_v2.46's pg_cron job.

const SUPABASE_URL = process.env.SUPABASE_URL;
const BACKUP_VERIFY_SECRET = process.env.BACKUP_VERIFY_SECRET;

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

if (!SUPABASE_URL) fail('Set SUPABASE_URL (same value as the app\'s ⚙ Supabase Configuration panel).');
if (!BACKUP_VERIFY_SECRET) fail('Set BACKUP_VERIFY_SECRET to the exact value configured via `supabase secrets set BACKUP_VERIFY_SECRET=...`.');

async function main() {
  console.log('Invoking backup-verify …');
  const res = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/backup-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': BACKUP_VERIFY_SECRET },
    body: '{}',
  });
  const bodyText = await res.text();
  console.log('  HTTP ' + res.status);
  console.log('  ' + bodyText + '\n');

  if (res.status === 404) {
    fail('404 — the function is not deployed. Run:\n     supabase functions deploy backup-verify');
  }
  if (res.status === 403) {
    fail('403 Forbidden — BACKUP_VERIFY_SECRET here does not match the value set via `supabase secrets set BACKUP_VERIFY_SECRET=...` on the deployed function.');
  }
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch { parsed = null; }
  if (parsed && parsed.ok === true) {
    console.log('✓ Backup verification check passed (tables checked: ' + (parsed.tables || []).join(', ') + '). No email is sent on success by design.');
    return;
  }
  if (parsed && parsed.ok === false) {
    console.log('⚠️  The check itself ran and reported a failure (this may be exactly what you\'re testing for):');
    console.log('   ' + JSON.stringify(parsed.failures, null, 2));
    console.log('   alerted=' + parsed.alerted + (parsed.alerted ? ' — an email should have been sent to ADMIN_EMAIL.' : ' — no email was sent; check RESEND_API_KEY/EMAIL_FROM/ADMIN_EMAIL secrets are set.'));
    return;
  }
  fail('Unexpected response — see the HTTP status and body printed above.');
}

main().catch((e) => fail('Script error: ' + (e && e.message || e)));
