// Phase 3 verification: a full Open Shift + Close Shift cycle with the
// email notification genuinely succeeding (email provider working
// correctly), confirming the exact request shape dispatchShiftEmail()
// sends for both 'open' and 'close', and that no error/warning surfaces
// when the send actually works.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Reception Test', role: 'receptionist' }], reception_shifts: [], invoices: [], payments: [], billing_audit_logs: [] },
    users: [{ id: 'u1', email: 'reception@example.com', password: 'whatever' }],
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.__seed.functionHandlers = {
      'reception-shift-notify': (opts) => {
        window.__emailCalls = window.__emailCalls || [];
        window.__emailCalls.push(opts.body);
        return { data: { ok: true }, error: null };
      },
    };
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
  `;
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'reception@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('shift-email-full-cycle');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  const toasts = [];
  await page.exposeFunction('__captureToast', (msg, kind) => toasts.push({ msg, kind }));
  await page.evaluate(() => {
    const orig = window.toast;
    window.toast = function (msg, kind) { window.__captureToast(msg, kind); return orig.apply(this, arguments); };
  });

  await page.evaluate(() => { openShiftModal(); });
  await page.waitForTimeout(100);
  await page.evaluate(() => submitOpenShift());
  await page.waitForTimeout(300);

  await page.evaluate(() => openCloseShiftModal());
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('sfc-actual').value = String(window._shiftExpectedCash || 0); });
  await page.evaluate(() => submitCloseShift());
  await page.waitForTimeout(300);

  const emailCalls = await page.evaluate(() => window.__emailCalls || []);
  t.check('exactly 2 email dispatch calls fired (open + close)', emailCalls.length === 2);
  t.check('the open call carries kind:"open" and a real shift_no/admin_email', emailCalls[0]?.kind === 'open' && !!emailCalls[0]?.shift?.shift_no && !!emailCalls[0]?.admin_email);
  t.check('the close call carries kind:"close" for the SAME shift', emailCalls[1]?.kind === 'close' && emailCalls[1]?.shift?.shift_no === emailCalls[0]?.shift?.shift_no);
  t.check('the close call includes the closed_at timestamp', !!emailCalls[1]?.shift?.closed_at);
  t.check('no warning toast fires when both sends genuinely succeed', !toasts.some(x => x.kind === 'warn'));
  t.check('both shift-opened and shift-closed confirmations fire', toasts.filter(x => x.kind === 'ok').length === 2);

  await page.close();
  return t;
};
