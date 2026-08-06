// Covers a live-reported bug: Close Shift / End-of-Day Reconciliation showed
// 0 patients, 0 gross revenue, 0 net cash collected -- all zero -- despite
// real paid invoices created during the shift. Root cause: computeShiftTotals()
// filters both `invoices` and `payments` by shift_id, but the registration
// invoice-creation path (submitRegistration()) never stamped shift_id on the
// invoice, and never wrote a `payments` ledger row at all -- unlike the
// manual Billing page's finalizeSaveInvoice(), which always does both. Since
// registration is the primary source of hospital revenue, the shift report
// was blind to almost everything. Fixed by stamping shift_id on the
// registration invoice and writing a matching payments row whenever money
// actually changed hands.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { insertedInvoice: null, insertedPayments: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Reception Sara', role: 'receptionist' }, []);
        if (table === 'invoices') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.insertedInvoice = payload; return { select: () => Promise.resolve({ data: [{ ...payload, id: 'inv1' }], error: null }) }; };
          return c;
        }
        if (table === 'payments') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.insertedPayments.push(payload); return { select: () => Promise.resolve({ data: [payload], error: null }) }; };
          return c;
        }
        const c = chainable(null, []);
        c.insert = (payload) => Promise.resolve({ data: [payload], error: null });
        c.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
        return c;
      },
      rpc: () => Promise.resolve({ data: 'ID-1', error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
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
  const t = makeSuite('registration-shift-revenue');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);
  await page.evaluate(() => { _activeShift = { id: 'shift-1', status: 'active' }; });
  await page.evaluate(() => goPage('register'));
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('r-fname', 'Test'); set('r-sex', 'Male'); set('r-phone', '0912345678');
    set('r-pay-method', 'cash'); set('r-pay-status', 'paid'); set('r-pay-amount', '550');
    const consent = document.getElementById('r-consent'); if (consent) consent.checked = true;
    if (typeof _regDestinations !== 'undefined') _regDestinations.add('lab');
    const testChk = document.querySelector('.test-chk'); if (testChk) testChk.checked = true;
  });
  await page.evaluate(() => submitRegistration());
  await page.waitForTimeout(400);

  const invoice = await page.evaluate(() => window.__mock.insertedInvoice);
  const payments = await page.evaluate(() => window.__mock.insertedPayments);
  t.check('the registration invoice is stamped with the active shift_id', invoice?.shift_id === 'shift-1');
  t.check('a payments ledger row is written when money was actually collected', payments.length === 1);
  if (payments.length) {
    t.check('the payment amount matches what was entered', payments[0].amount === 550);
    t.check('the payment method matches what was selected', payments[0].method === 'cash');
    t.check('the payment is stamped with the active shift_id too (same filter computeShiftTotals() uses)', payments[0].shift_id === 'shift-1');
  }

  await page.close();
  return t;
};
