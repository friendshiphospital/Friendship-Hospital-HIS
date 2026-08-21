// Part B Phase 3: doctors/lab staff don't need billing info in the
// read-only inline "History tab" summaries -- Doctor Consultation's
// loadPatientHistory() (#doc-history-body) and the Lab Worklist's Quick
// History panel (openWlQuickHistory, #wl-qh-body). Both now call the
// shared fetchPatientHistoryEvents() with {includeBilling:false}. The full
// Patient History Timeline page (loadPthTimeline / openPatientHistoryTimeline)
// is a separate, full-featured page with its own explicit "Billing" filter
// tab and must be completely unaffected by this -- it still gets every
// invoice event, same as before this change.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Doctor Test', role: 'doctor' }],
      patients: [
        { id: 'visit1', mrn: '542', name: 'Farah ahmed', created_at: '2026-08-19T09:00:00Z', tests_requested: [], priority: 'Routine', diagnosis: '—', visit_status: 'Visit Complete' },
      ],
      invoices: [
        { id: 'inv1', patient_id: 'visit1', invoice_no: 'INV-0001', net_amount: 1500, currency: 'SDG', payment_status: 'paid', created_at: '2026-08-19T09:10:00Z' },
      ],
    },
    users: [{ id: 'u1', email: 'doctor@example.com', password: 'whatever' }],
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
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
  const t = makeSuite('history-tab-billing-exclusion');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  // Doctor Consultation's History tab must NOT show the invoice.
  await page.evaluate(() => loadPatientHistory('visit1'));
  await page.waitForTimeout(300);
  const docHistoryBody = await page.evaluate(() => document.getElementById('doc-history-body')?.textContent || '');
  t.check('Consultation History tab does NOT show the Invoice line item', !docHistoryBody.includes('INV-0001'));

  // Lab Worklist Quick History must NOT show the invoice either.
  await page.evaluate(() => openWlQuickHistory('visit1'));
  await page.waitForTimeout(300);
  const wlQhBody = await page.evaluate(() => document.getElementById('wl-qh-body')?.textContent || '');
  t.check('Lab Worklist Quick History does NOT show the Invoice line item', !wlQhBody.includes('INV-0001'));
  await page.evaluate(() => closeOv('wl-quick-history-ov'));

  // The full Patient History Timeline page is untouched -- still shows the invoice.
  await page.evaluate(() => openPatientHistoryTimeline('visit1'));
  await page.waitForTimeout(300);
  const timelineBody = await page.evaluate(() => document.getElementById('pth-timeline')?.textContent || '');
  t.check('the full Patient History Timeline page STILL shows the Invoice (unaffected)', timelineBody.includes('INV-0001'));
  const invoiceCount = await page.evaluate(() => document.getElementById('pths-invoices')?.textContent);
  t.check('the Timeline\'s own invoice count stat is unaffected', invoiceCount === '1');

  await page.close();
  return t;
};
