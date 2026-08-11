// supabase/functions/reception-shift-notify/verify.js
//
// Standalone end-to-end check for the Open/Close Shift email notification
// pipeline — answers "is this actually working right now?" with a real,
// machine-readable answer instead of "open a shift and hope an email
// shows up". It signs in as a real staff user, invokes the deployed
// reception-shift-notify Edge Function with a synthetic shift payload
// exactly like dispatchShiftEmail() does in index.html, and prints the
// function's own JSON response — which distinguishes every failure mode
// this pipeline can hit:
//   - function not deployed at all           -> HTTP 404
//   - not signed in / bad credentials         -> 401 from this script's own auth step
//   - RESEND_API_KEY not set                  -> {"error":"Email provider not configured..."}
//   - EMAIL_FROM not verified with the provider -> {"error":"Email provider returned HTTP ..."}
//   - everything actually works               -> {"ok":true}  (check the inbox for admin_email)
//
// No new dependency: plain Node 18+ fetch() against the REST endpoints
// directly, matching this repo's zero-npm-dependency convention (see
// CLAUDE.md) -- deliberately NOT using @supabase/supabase-js.
//
// USAGE:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//   STAFF_EMAIL=receptionist@example.com \
//   STAFF_PASSWORD=their-password \
//   ADMIN_EMAIL=admin@yourdomain.com \
//   node supabase/functions/reception-shift-notify/verify.js [open|close]
//
// SUPABASE_URL / SUPABASE_ANON_KEY: same values entered in the app's own
//   "⚙ Supabase Configuration" panel (localStorage sb_url / sb_key).
// STAFF_EMAIL / STAFF_PASSWORD: any real login for this project — the
//   function only requires *a* valid session, not a specific role.
// ADMIN_EMAIL: optional, defaults to admin@hospital.com (same default the
//   app itself falls back to when Settings -> Admin Notify Email is blank).
// Second arg: "open" (default) or "close" — which email template to test.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const STAFF_EMAIL = process.env.STAFF_EMAIL;
const STAFF_PASSWORD = process.env.STAFF_PASSWORD;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@hospital.com';
const kind = (process.argv[2] || 'open').trim();

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) fail('Set SUPABASE_URL and SUPABASE_ANON_KEY (same values as the app\'s ⚙ Supabase Configuration panel).');
if (!STAFF_EMAIL || !STAFF_PASSWORD) fail('Set STAFF_EMAIL and STAFF_PASSWORD for a real login on this project.');
if (kind !== 'open' && kind !== 'close') fail('Second argument must be "open" or "close".');

// A synthetic-but-complete shift row -- same shape reception_shifts rows
// actually have, so buildOpenEmail()/buildCloseEmail() render exactly as
// they would for a real shift.
const now = new Date();
const openedAt = new Date(now.getTime() - 8 * 3600000).toISOString();
const syntheticShift = {
  shift_no: 'SFT-VERIFY-TEST', staff_name: 'Verification Script', station_id: 'TEST-1',
  shift_type: 'morning', currency: 'SDG', opening_float: 5000, opened_at: openedAt,
  closed_at: now.toISOString(), total_patients: 42, gross_revenue: 128500,
  total_cash: 90000, total_card: 20000, total_insurance: 15000, total_wallet: 0,
  total_online: 3500, total_refunds: 1000, cash_expected: 90000, cash_actual: 89950,
  cash_variance: -50, variance_reason: 'Minor till discrepancy (verification test)',
  closing_notes: 'This is a test email sent by verify.js — safe to ignore.',
};

async function main() {
  console.log('1) Signing in as ' + STAFF_EMAIL + ' …');
  const authRes = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
  });
  const authBody = await authRes.json().catch(() => ({}));
  if (!authRes.ok || !authBody.access_token) {
    console.error(JSON.stringify(authBody, null, 2));
    fail('Sign-in failed (HTTP ' + authRes.status + ') — check STAFF_EMAIL/STAFF_PASSWORD/SUPABASE_URL/SUPABASE_ANON_KEY.');
  }
  console.log('   ✓ signed in\n');

  console.log('2) Invoking reception-shift-notify (kind="' + kind + '") …');
  const fnRes = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/reception-shift-notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + authBody.access_token,
    },
    body: JSON.stringify({ kind, shift: syntheticShift, admin_email: ADMIN_EMAIL }),
  });
  const fnBody = await fnRes.text();
  console.log('   HTTP ' + fnRes.status);
  console.log('   ' + fnBody + '\n');

  if (fnRes.status === 404) {
    fail('404 — the function is not deployed. Run:\n     supabase functions deploy reception-shift-notify');
  }
  let parsed;
  try { parsed = JSON.parse(fnBody); } catch { parsed = null; }
  if (fnRes.ok && parsed && parsed.ok) {
    console.log('✓ Function accepted the request and reports success — check ' + ADMIN_EMAIL + '\'s inbox (and spam folder) for a "' + (kind === 'open' ? '[Shift Opened]' : '[Shift Closed]') + '" email.');
    return;
  }
  if (parsed && typeof parsed.error === 'string' && parsed.error.includes('RESEND_API_KEY')) {
    fail('The function is deployed but has no email provider configured. Run:\n     supabase secrets set RESEND_API_KEY=re_your_key_here\n     supabase secrets set EMAIL_FROM="Friendship Hospital HIS <noreply@yourdomain.com>"\n   (EMAIL_FROM must be on a domain verified with Resend, or Resend will reject it — see step 3 below.)');
  }
  if (parsed && typeof parsed.error === 'string' && parsed.error.includes('Email provider returned HTTP')) {
    fail('The function IS deployed and RESEND_API_KEY IS set, but Resend itself rejected the send — usually an unverified EMAIL_FROM domain, or an invalid/revoked API key. Full provider response is printed above.');
  }
  fail('Unexpected response — see the HTTP status and body printed above.');
}

main().catch((e) => fail('Script error: ' + (e && e.message || e)));
