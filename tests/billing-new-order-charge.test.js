// Covers a live-reported gap: a doctor ordering MORE tests after
// registration (e.g. ESR + Platelet Count added on top of an already-paid
// visit) produced NO invoice line and NO charge anywhere -- the screenshot
// showed both going straight to "Completed" with no billing trace at all.
// Root cause: checkPaymentGate() only ever reads the single, already-"paid"
// patient.payment_status flag from the ORIGINAL registration -- it has no
// concept that a brand-new, never-billed order exists. Fixed by having
// _submitLabOrder()/_submitRadOrder() call chargeForNewOrder(), which
// creates a real invoice (price looked up from price_list, same as
// registration) and flips payment_status back to unpaid so every
// downstream gate (Sample Collection, and the new release-time gate) picks
// it up correctly. A blanket waiver is preserved, never downgraded back to
// unpaid.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { invoiceInserts: [], patientUpdates: [] };
    const priceRows = [{ code:'LC006', name:'ESR', price:1500 }, { code:'RAD001', name:'X-Ray — Chest PA', price:3000 }];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Doctor Test', role:'doctor' }, []);
        if (table === 'doctor_orders') { const c = chainable(null, []); c.insert = () => Promise.resolve({ data: null, error: null }); return c; }
        if (table === 'radiology_requests') { const c = chainable(null, []); c.insert = () => Promise.resolve({ error: null }); return c; }
        if (table === 'sample_records') { const c = chainable(null, []); c.upsert = () => Promise.resolve({ data: null, error: null }); return c; }
        if (table === 'price_list') { const c = chainable(null, priceRows); c.select = () => c; c.in = () => c; return c; }
        if (table === 'invoices') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.invoiceInserts.push(payload); return { select: () => Promise.resolve({ data: [{ id: 'inv-new' }], error: null }) }; };
          return c;
        }
        if (table === 'patients') {
          const c = chainable(null, []);
          c.update = (payload) => {
            window.__mock.patientUpdates.push(payload);
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
              match: () => ({ select: () => Promise.resolve({ data: null, error: null }) }),
            };
          };
          c.eq = () => c;
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
  const t = makeSuite('billing-new-order-charge');

  // --- Lab order placed for an already-"paid" patient must still generate a real charge ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => { _docPt = { id:'p1', name:'Test Patient', payment_status:'paid', tests_requested:[], lab_no:'L100' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('.order-test-chk')].find(c => c.value === 'ESR');
      if (cb) cb.checked = true;
    });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(200);
    const inv = await page.evaluate(() => window.__mock.invoiceInserts[0]);
    // patientUpdates[0] is _submitLabOrder()'s own tests_requested/lab_no
    // update (unrelated to billing) -- the payment-status flip from
    // chargeForNewOrder() is a separate, later call.
    const patUpd = await page.evaluate(() => window.__mock.patientUpdates.find(u => 'payment_status' in u));
    t.check('a new lab order for an already-paid patient generates a real invoice, not nothing', !!inv);
    t.check('the invoice uses the real price_list price (1500), not 0', inv?.line_items?.[0]?.total_price === 1500);
    t.check('the new invoice starts unpaid (it is a new, never-billed charge)', inv?.payment_status === 'unpaid');
    t.check('the patient payment_status is flipped back to unpaid so downstream gates re-block', patUpd?.payment_status === 'unpaid');
    await page.close();
  }

  // --- Radiology order: same mechanism ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => { _docPt = { id:'p2', name:'Rad Patient', payment_status:'paid', lab_no:'L200' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => { const el = document.getElementById('ord-rad-type'); if (el) el.value = 'X-Ray — Chest PA'; });
    await page.evaluate(() => submitRadOrder());
    await page.waitForTimeout(200);
    const inv = await page.evaluate(() => window.__mock.invoiceInserts[0]);
    t.check('a new radiology order also generates a real invoice with a real price (3000)', inv?.line_items?.[0]?.total_price === 3000);
    await page.close();
  }

  // --- A blanket waiver must never be downgraded back to unpaid ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => { _docPt = { id:'p3', name:'Waived Patient', payment_status:'waived', tests_requested:[], lab_no:'L300' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('.order-test-chk')].find(c => c.value === 'ESR');
      if (cb) cb.checked = true;
    });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(200);
    const inv = await page.evaluate(() => window.__mock.invoiceInserts[0]);
    const patUpdates = await page.evaluate(() => window.__mock.patientUpdates);
    t.check('the auto-generated invoice for a waived patient is itself marked waived, not unpaid', inv?.payment_status === 'waived');
    t.check('a waived patient is never flipped back to unpaid', !patUpdates.some(u => u.payment_status === 'unpaid'));
    await page.close();
  }

  return t;
};
