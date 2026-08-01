// Covers the loadProfile()/doLogin()/restoreSession() admin-fallback bug
// fixed earlier in this project's history (commit "Fix loadProfile()
// silently granting admin on missing/errored staff lookup") plus ROLE_PAGES
// enforcement in goPage() — two of the four highest-value regression areas
// per this project's own bug history.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScriptFor(staffRow, { throwOnStaffLookup = false } = {}) {
  const staffMockLine = throwOnStaffLookup
    ? `return { select:()=>({ eq:()=>({ maybeSingle:()=>Promise.reject(new Error('network down')) }) }) };`
    : `return chainable(${JSON.stringify(staffRow)}, ${staffRow ? '[' + JSON.stringify(staffRow) + ']' : '[]'});`;
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { signedOut: false };
    window.supabase = {
      createClient: () => ({
        auth: {
          signInWithPassword: async () => ({ data: { user: { id: 'u1', email: 'test@example.com' } }, error: null }),
          getSession: async () => ({ data: { session: null } }),
          signOut: async () => { window.__mock.signedOut = true; return { error: null }; },
        },
        from: (table) => {
          if (table === 'staff') { ${staffMockLine} }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: () => Promise.resolve({ data: { ok: true }, error: null }) },
      }),
    };
  `;
}

async function login(page, baseUrl, initScript, email) {
  await page.addInitScript(initScript);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(400);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('auth-role-access');

  // --- Scenario 1: linked staff row -> logs in as its real role ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, initScriptFor({ id: 's1', user_id: 'u1', full_name: 'Nurse Amal', role: 'nurse' }), 'nurse@example.com');
    const role = await page.evaluate(() => currentProfile && currentProfile.role);
    const appVisible = await page.evaluate(() => !!document.getElementById('app')?.classList.contains('visible'));
    t.check('linked staff row logs in with its real role (nurse)', role === 'nurse');
    t.check('app becomes visible after a successful linked-staff login', appVisible);
    await page.close();
  }

  // --- Scenario 2: no staff row found -> must NOT fall back to admin ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, initScriptFor(null), 'nobody@example.com');
    const role = await page.evaluate(() => currentProfile && currentProfile.role);
    const appVisible = await page.evaluate(() => !!document.getElementById('app')?.classList.contains('visible'));
    const signedOut = await page.evaluate(() => window.__mock.signedOut);
    t.check('no staff row found -> currentProfile never becomes admin (or anything)', role == null);
    t.check('no staff row found -> app is never shown', !appVisible);
    t.check('no staff row found -> session is signed back out (denyUnlinkedAccount)', !!signedOut);
    await page.close();
  }

  // --- Scenario 3: staff lookup throws -> same deny behaviour, not admin ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, initScriptFor(null, { throwOnStaffLookup: true }), 'broken@example.com');
    const role = await page.evaluate(() => currentProfile && currentProfile.role);
    const appVisible = await page.evaluate(() => !!document.getElementById('app')?.classList.contains('visible'));
    t.check('staff lookup throwing -> currentProfile never becomes admin (or anything)', role == null);
    t.check('staff lookup throwing -> app is never shown', !appVisible);
    await page.close();
  }

  // --- Scenario 4: ROLE_PAGES enforcement in goPage() ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, initScriptFor({ id: 's2', user_id: 'u1', full_name: 'Cashier Sara', role: 'cashier' }), 'cashier@example.com');
    await page.evaluate(() => goPage('billing'));
    const billingActive = await page.evaluate(() => !!document.getElementById('page-billing')?.classList.contains('active'));
    t.check('cashier CAN reach billing (granted by ROLE_PAGES)', billingActive);
    await page.evaluate(() => goPage('consultation'));
    const consultActive = await page.evaluate(() => !!document.getElementById('page-consultation')?.classList.contains('active'));
    t.check('cashier CANNOT reach consultation (not granted by ROLE_PAGES)', !consultActive);
    await page.close();
  }

  return t;
};
