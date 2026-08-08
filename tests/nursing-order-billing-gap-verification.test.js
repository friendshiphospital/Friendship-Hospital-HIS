// Phase 4 verification (pricing audit): confirms the Phase 3 finding live --
// unlike lab and radiology orders, a Nursing order placed from Doctor
// Consultation never calls any pricing/invoicing function at all.
// _submitNursingOrder() (index.html) inserts straight into doctor_orders
// with no price_list lookup and no invoice insert, regardless of the
// buildAutoInvoiceLines()/chargeForNewOrder() fix in this same PR -- this is
// not a matching bug the code-based lookup could fix, it's a missing
// integration that needs a product decision (see PR description). This test
// exists so a future change that wires up Nursing billing has something to
// flip from failing to passing, instead of the gap silently persisting.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { invoiceInserts: [], doctorOrderInserts: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Doctor Test', role:'doctor' }, []);
        if (table === 'doctor_orders') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.doctorOrderInserts.push(payload); return Promise.resolve({ data: null, error: null }); };
          return c;
        }
        if (table === 'price_list') { const c = chainable(null, [{ code:'NRS001', name:'IV Cannula Insertion', price:2000 }]); c.select = () => c; c.in = () => c; return c; }
        if (table === 'invoices') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.invoiceInserts.push(payload); return { select: () => Promise.resolve({ data: [{ id: 'inv-new' }], error: null }) }; };
          return c;
        }
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: 900, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'doctor@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('nursing-order-billing-gap-verification');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  await page.evaluate(() => { _docPt = { id:'p1', name:'Test Patient', payment_status:'paid' }; });
  await page.evaluate(() => goPage('consultation'));
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const el = document.getElementById('ord-nrs-type');
    if (el) el.value = 'IV Access — Insert cannula';
  });
  await page.evaluate(() => submitNursingOrder());
  await page.waitForTimeout(200);

  const mock = await page.evaluate(() => window.__mock);
  t.check('the nursing order itself is still recorded in doctor_orders (order placement is not broken)', mock.doctorOrderInserts.length === 1);
  t.check('KNOWN GAP (Phase 3, not fixed by this PR): no invoice is created for a nursing order -- confirms this is a missing-integration gap, not a lookup bug', mock.invoiceInserts.length === 0);

  await page.close();
  return t;
};
