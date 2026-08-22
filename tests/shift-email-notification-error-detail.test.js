// Bug report: "Open Shift/Close Shift email notification to admin fails
// with an error" -- clarified scope: the shift record itself opens/closes
// fine, the email notification piece is the only problem.
//
// Phase 0 (live diagnosis): reproduced Open Shift, simulating the exact
// failure mode reception-shift-notify/index.ts's own code anticipates
// (RESEND_API_KEY not set in the Edge Function's secrets -- see that
// file's header comment and its returned {"error":"Email provider not
// configured..."} on a 500). Two things confirmed:
//   1. The shift STILL opens successfully -- dispatchShiftEmail() is
//      fire-and-forget (never awaited at the submitOpenShift()/
//      submitCloseShift() call sites) and its own try/catch never
//      rethrows, so this was already correctly non-blocking. No fix
//      needed here.
//   2. The toast shown to the user was a USELESS GENERIC MESSAGE --
//      "Edge Function returned a non-2xx status code" -- not the
//      function's actual, actionable diagnostic. supabase-js shapes a
//      non-2xx functions.invoke() error with a fixed generic .message;
//      the real detail only reaches error.context.json(). This exact
//      extraction already existed elsewhere in this file
//      (runEdgeFunctionHealthCheck(), Settings page) -- dispatchShiftEmail()
//      just never adopted the same pattern.
//
// Fix: dispatchShiftEmail() now reads error.context.json() the same way
// runEdgeFunctionHealthCheck() already does, so the toast surfaces the
// function's real diagnostic (e.g. "set RESEND_API_KEY via `supabase
// secrets set`") instead of a dead end.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(functionHandler) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Reception Test', role: 'receptionist' }], reception_shifts: [] },
    users: [{ id: 'u1', email: 'reception@example.com', password: 'whatever' }],
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.__seed.functionHandlers = { 'reception-shift-notify': ${functionHandler} };
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

async function captureToasts(page) {
  const toasts = [];
  await page.exposeFunction('__captureToast', (msg, kind) => toasts.push({ msg, kind }));
  await page.evaluate(() => {
    const orig = window.toast;
    window.toast = function (msg, kind) { window.__captureToast(msg, kind); return orig.apply(this, arguments); };
  });
  return toasts;
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('shift-email-notification-error-detail');

  // --- The exact reported failure mode: RESEND_API_KEY not configured ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
      () => ({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: { status: 500, json: async () => ({ error: "Email provider not configured — set RESEND_API_KEY via \\\`supabase secrets set\\\`" }) },
        },
      })
    `));
    await login(page, baseUrl);
    const toasts = await captureToasts(page);
    await page.evaluate(() => { openShiftModal(); });
    await page.waitForTimeout(100);
    await page.evaluate(() => submitOpenShift());
    await page.waitForTimeout(300);

    const shiftOpened = await page.evaluate(() => typeof _activeShift !== 'undefined' && !!_activeShift);
    t.check('the shift opens successfully despite the email failure (non-blocking)', shiftOpened);
    t.check('an "ok" toast confirms the shift opened', toasts.some(x => x.kind === 'ok' && x.msg.includes('Shift opened')));
    const warnToast = toasts.find(x => x.kind === 'warn');
    t.check('a warning toast fires for the email failure', !!warnToast);
    t.check('the warning shows the REAL diagnostic (RESEND_API_KEY), not the generic "non-2xx" message', warnToast?.msg.includes('RESEND_API_KEY') && !warnToast?.msg.includes('non-2xx'));
    await page.close();
  }

  // --- A different real failure (provider rejection) also surfaces correctly, not just the RESEND_API_KEY case ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
      () => ({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: { status: 502, json: async () => ({ error: 'Email provider returned HTTP 403: domain not verified' }) },
        },
      })
    `));
    await login(page, baseUrl);
    const toasts = await captureToasts(page);
    await page.evaluate(() => { openShiftModal(); });
    await page.waitForTimeout(100);
    await page.evaluate(() => submitOpenShift());
    await page.waitForTimeout(300);
    const warnToast = toasts.find(x => x.kind === 'warn');
    t.check('a provider-rejection error also surfaces its real detail, not just the RESEND_API_KEY case', warnToast?.msg.includes('domain not verified'));
    await page.close();
  }

  // --- Phase 2 hardening: even if the error-detail extraction ITSELF
  // misbehaves (malformed/unreadable context.json(), simulating some
  // future bug in the diagnostic path added above), the shift workflow
  // must still never be blocked -- the outer try/catch in
  // dispatchShiftEmail() must swallow that too and still produce a
  // (fallback) toast, never an uncaught exception. ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
      () => ({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: { status: 500, json: async () => { throw new Error('body already consumed'); } },
        },
      })
    `));
    await login(page, baseUrl);
    let pageError = null;
    page.on('pageerror', e => { pageError = e.message; });
    const toasts = await captureToasts(page);
    await page.evaluate(() => { openShiftModal(); });
    await page.waitForTimeout(100);
    await page.evaluate(() => submitOpenShift());
    await page.waitForTimeout(300);
    const shiftOpened = await page.evaluate(() => typeof _activeShift !== 'undefined' && !!_activeShift);
    t.check('a malformed/throwing error.context.json() still never blocks the shift from opening', shiftOpened);
    t.check('no uncaught page error is thrown even when the diagnostic extraction itself fails', !pageError);
    t.check('a warning toast still fires (falls back to the generic message rather than crashing silently)', toasts.some(x => x.kind === 'warn'));
    await page.close();
  }

  // --- The success path is unaffected ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`() => ({ data: { ok: true }, error: null })`));
    await login(page, baseUrl);
    const toasts = await captureToasts(page);
    await page.evaluate(() => { openShiftModal(); });
    await page.waitForTimeout(100);
    await page.evaluate(() => submitOpenShift());
    await page.waitForTimeout(300);
    t.check('no warning toast fires when the email genuinely sends successfully', !toasts.some(x => x.kind === 'warn'));
    await page.close();
  }

  return t;
};
