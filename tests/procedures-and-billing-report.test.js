// Covers two additive features (Price Visibility Phase, Part A.4 + Part B):
//
// 1. Procedures ordering — a new orderable-procedures catalog
//    (PROCEDURE_PRICE_CODE) reachable from BOTH the Doctor Orders
//    "Procedure" tab and a new Nursing "Procedures" tab, sharing one
//    buildOrderProcedurePanel()/_submitProcedureOrderFor() implementation
//    so both callers write the same doctor_orders shape and go through the
//    same chargeForNewOrder()/payment-gate logic instead of two drifting
//    copies.
// 2. Billing Report — a date-range report on the Billing page itself
//    (reachable by receptionist/cashier, who do NOT have 'statistics' in
//    ROLE_PAGES) that reuses computeBillingStats(), the calculation
//    extracted out of the existing (admin-only) renderStatsBilling(), so
//    both surfaces always agree on the same numbers.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

const PROC_PRICES = [
  { code:'NRS010', name:'Wound Dressing — Simple', price:1500, category:'nursing' },
  { code:'NRS026', name:'Blood Glucose Point-of-Care Test', price:1000, category:'nursing' },
];

function initScript(role, extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { doctorOrderInserts: [], invoiceInserts: [], patientUpdates: [] };
    const procPrices = ${JSON.stringify(PROC_PRICES)};
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'${role === 'doctor' ? 'Doctor Test' : 'Nurse Test'}', role:'${role}' }, []);
        if (table === 'doctor_orders') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.doctorOrderInserts.push(...(Array.isArray(payload)?payload:[payload])); return Promise.resolve({ data: null, error: null }); };
          return c;
        }
        if (table === 'price_list') { const c = chainable(null, procPrices); c.select = () => c; c.in = () => c; c.eq = () => c; return c; }
        if (table === 'invoices') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.invoiceInserts.push(payload); return { select: () => Promise.resolve({ data: [{ id: 'inv-new' }], error: null }) }; };
          return c;
        }
        if (table === 'patients') {
          const c = chainable(null, []);
          c.update = (payload) => { window.__mock.patientUpdates.push(payload); return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          c.eq = () => c;
          c.or = () => c;
          c.order = () => c;
          c.limit = () => c;
          return c;
        }
        ${extra||''}
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function login(page, baseUrl, email) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('procedures-and-billing-report');

  // --- Doctor Orders "Procedure" tab: panel renders with price hints ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('doctor'));
    await login(page, baseUrl, 'doctor@example.com');
    await page.evaluate(() => { _docPt = { id:'p1', name:'Test Patient', payment_status:'paid' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(150);
    const panelHtml = await page.evaluate(() => document.getElementById('doc-order-procedures')?.innerHTML || '');
    t.check('the Doctor Orders Procedure panel lists Wound Dressing — Simple', panelHtml.includes('Wound Dressing'));
    t.check('the Doctor Orders Procedure panel shows its price (1500)', panelHtml.includes('1500') || panelHtml.includes('1,500'));
    t.check('the new NRS026 procedure (Blood Glucose POC Test) is also listed', panelHtml.includes('Blood Glucose'));
    await page.close();
  }

  // --- Doctor: placing a procedure order charges the real price and logs doctor_orders ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('doctor'));
    await login(page, baseUrl, 'doctor@example.com');
    await page.evaluate(() => { _docPt = { id:'p1', name:'Test Patient', payment_status:'paid' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('#doc-order-procedures .order-proc-chk')].find(c => c.value === 'Wound Dressing — Simple');
      if (cb) cb.checked = true;
    });
    await page.evaluate(() => submitProcedureOrder());
    await page.waitForTimeout(200);
    const orders = await page.evaluate(() => window.__mock.doctorOrderInserts);
    const inv = await page.evaluate(() => window.__mock.invoiceInserts[0]);
    t.check('a doctor_orders row is inserted with order_type Procedure', orders.some(o => o.order_type === 'Procedure' && o.order_detail === 'Wound Dressing — Simple'));
    t.check('the order is attributed to the doctor', orders[0]?.ordered_by === 'Doctor Test');
    t.check('the procedure is billed at its real price_list price (1500), not 0', inv?.line_items?.[0]?.total_price === 1500);
    await page.close();
  }

  // --- Doctor: an unpaid patient is hard-blocked (no order, no charge) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('doctor'));
    await login(page, baseUrl, 'doctor@example.com');
    await page.evaluate(() => { _docPt = { id:'p2', name:'Unpaid Patient', payment_status:'unpaid' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('#doc-order-procedures .order-proc-chk')].find(c => c.value === 'Wound Dressing — Simple');
      if (cb) cb.checked = true;
    });
    await page.evaluate(() => submitProcedureOrder());
    await page.waitForTimeout(200);
    const orders = await page.evaluate(() => window.__mock.doctorOrderInserts);
    t.check('an unpaid patient is blocked — no doctor_orders row is inserted', orders.length === 0);
    await page.close();
  }

  // --- Nursing "Procedures" tab: nurse can search, select a patient (with real payment_status), and place a procedure order ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('nurse', `
        if (table === 'patients') {
          const c = chainable(null, [{ id:'p3', name:'Ward Patient', mrn:'MRN-3', payment_status:'paid', ward:'Medical' }]);
          c.select = () => c; c.or = () => c; c.order = () => c; c.limit = () => c; c.eq = () => c;
          c.update = (payload) => { window.__mock.patientUpdates.push(payload); return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
    `));
    await login(page, baseUrl, 'nurse@example.com');
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(100);
    await page.evaluate(() => switchNurseTab('procedures', null));
    await page.waitForTimeout(150);
    const panelHtml = await page.evaluate(() => document.getElementById('nrs-order-procedures')?.innerHTML || '');
    t.check('the Nursing Procedures panel also lists the same catalog', panelHtml.includes('Wound Dressing'));
    await page.evaluate(() => searchNrsProcPatient('Ward'));
    await page.waitForTimeout(150);
    const foundResult = await page.evaluate(() => document.getElementById('nrs-proc-search-results')?.innerHTML.includes('Ward Patient'));
    t.check('searching finds the ward patient', foundResult === true);
    await page.evaluate(() => selectNrsProcPatient({ id:'p3', name:'Ward Patient', mrn:'MRN-3', payment_status:'paid', ward:'Medical' }));
    const selectedName = await page.evaluate(() => document.getElementById('nrs-proc-pt-name')?.textContent);
    t.check('selecting the patient sets the visible patient banner', selectedName === 'Ward Patient');
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('#nrs-order-procedures .order-proc-chk')].find(c => c.value === 'Blood Glucose Point-of-Care Test');
      if (cb) cb.checked = true;
    });
    await page.evaluate(() => submitNrsProcedureOrder());
    await page.waitForTimeout(200);
    const orders = await page.evaluate(() => window.__mock.doctorOrderInserts);
    const inv = await page.evaluate(() => window.__mock.invoiceInserts.find(i => i.line_items?.[0]?.name === 'Blood Glucose Point-of-Care Test'));
    t.check('the nurse-placed procedure order is logged in doctor_orders', orders.some(o => o.order_type === 'Procedure' && o.order_detail === 'Blood Glucose Point-of-Care Test'));
    t.check('it is attributed to the nurse, not a doctor', orders.find(o => o.order_detail === 'Blood Glucose Point-of-Care Test')?.ordered_by === 'Nurse Test');
    t.check('it is billed at the new NRS026 price (1000)', inv?.line_items?.[0]?.total_price === 1000);
    await page.close();
  }

  // --- Billing Report: computeBillingStats() aggregates correctly and the Billing page report reuses it ---
  {
    const invoiceRows = [
      { invoice_no:'INV1', payment_status:'paid', net_amount:1000, currency:'SDG', created_at:'2026-01-05T00:00:00Z' },
      { invoice_no:'INV2', payment_status:'unpaid', net_amount:500, currency:'SDG', created_at:'2026-01-10T00:00:00Z' },
      { invoice_no:'INV3', payment_status:'insurance_pending', net_amount:2000, currency:'SDG', created_at:'2026-01-15T00:00:00Z' },
    ];
    const page = await context.newPage();
    await page.addInitScript(initScript('receptionist', `
        if (table === 'invoices') { const c = chainable(null, ${JSON.stringify(invoiceRows)}); c.select = () => c; c.gte = () => c; c.lte = () => c; c.order = () => c; return c; }
    `));
    await login(page, baseUrl, 'reception@example.com');

    const stats = await page.evaluate(async () => computeBillingStats('2026-01-01', '2026-01-31'));
    t.check('computeBillingStats counts all 3 invoices', stats.rows.length === 3);
    t.check('computeBillingStats sums total revenue correctly (3500)', stats.revenue === 3500);
    t.check('computeBillingStats isolates paid (1000)', stats.paid === 1000);
    t.check('computeBillingStats isolates unpaid (500)', stats.unpaid === 500);
    t.check('computeBillingStats isolates insurance pending (2000)', stats.insPending === 2000);

    await page.evaluate(() => goPage('billing'));
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.getElementById('bill-rpt-from').value = '2026-01-01'; document.getElementById('bill-rpt-to').value = '2026-01-31'; });
    await page.evaluate(() => runBillingReport());
    await page.waitForTimeout(150);
    const bodyHtml = await page.evaluate(() => document.getElementById('bill-rpt-body')?.innerHTML || '');
    t.check('the Billing Report card (on the Billing page, reachable by receptionist) renders the total invoice count', bodyHtml.includes('3'));
    t.check('the Billing Report card renders the revenue figure', bodyHtml.includes('3500'));

    // Quick-range button fills in dates and re-runs the report without manual input
    await page.evaluate(() => { document.getElementById('bill-rpt-from').value=''; document.getElementById('bill-rpt-to').value=''; });
    await page.evaluate(() => billingReportQuickRange('month'));
    await page.waitForTimeout(150);
    const fromVal = await page.evaluate(() => document.getElementById('bill-rpt-from').value);
    const toVal = await page.evaluate(() => document.getElementById('bill-rpt-to').value);
    t.check('"Last Month" quick range fills in both date inputs', !!fromVal && !!toVal);
    await page.close();
  }

  return t;
};
