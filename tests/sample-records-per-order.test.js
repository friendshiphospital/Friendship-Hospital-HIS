// Covers a workflow-integrity bug: a second lab order placed mid-visit
// (after the first was already fully processed) skipped Sample Collection
// and Sample Receipt entirely and became directly enterable in Result
// Entry as soon as payment cleared. Root cause: sample_records was written
// and read everywhere as exactly ONE row per patient_id (every insert path
// used .upsert(...,{onConflict:'patient_id'})); a new order's status
// update was a no-op against the already-Released row from the first
// order (deliberately, to avoid regressing it — see _submitLabOrder()),
// but that also meant the new specimen inherited the old row's Released
// status and was never gated through Collection/Receipt.
//
// Fixed by making sample_records one row PER SPECIMEN/ORDER-BATCH
// (migration_v2.47 drops the patient_id uniqueness so a patient can have
// more than one row) — _submitLabOrder() now INSERTs a genuinely new
// Pending row whenever the patient's current specimen has already moved
// past collection, and every reader (Worklist, Doctor's View Result gate,
// Results Ready notification, Release, Unreceive, and Unified Results
// Entry itself) was audited to resolve "this patient's CURRENT status" as
// the most recently created row rather than an arbitrary/blind
// patient_id match. Unified Results Entry additionally now gates on the
// current specimen's status the same way Worklist does, so a fresh order
// is genuinely unenterable (not just miscategorized) until it's actually
// received in the lab.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function seedFor(patient) {
  const now = new Date().toISOString();
  return {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Lab Tech', role: 'lab_tech' }],
      patients: [patient],
      sample_records: [{ id: 'sr1', patient_id: patient.id, status: 'Pending', created_at: '2026-01-01T00:00:00Z' }],
    },
    users: [{ id: 'u1', email: 'lab@example.com', password: 'whatever' }],
  };
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'lab@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

const CBC_FIELDS = { 'he-wbc':'7','he-rbc':'4.8','he-hgb':'14','he-hct':'42','he-mcv':'88','he-mch':'29','he-mchc':'33','he-rdw':'13','he-nrbc':'0','he-plt':'250','he-mpv':'9','he-pdw':'12','he-neut':'60','he-lymph':'30','he-mono':'5','he-eosi':'3','he-baso':'2' };

async function collectAndReceive(page, ptId) {
  await page.evaluate((id) => selectScPt(id), ptId);
  await page.waitForTimeout(100);
  await page.evaluate(() => { document.getElementById('sc-source').value = 'Ward'; document.getElementById('sc-specimen').value = 'EDTA Blood'; });
  await page.evaluate(() => _doMarkSampleCollected());
  await page.waitForTimeout(100);
  await page.evaluate(() => { const el = document.getElementById('sc-recv-pt-id'); if (el) el.value = ''; });
  await page.evaluate((id) => { document.getElementById('sc-recv-pt-id').value = id; }, ptId);
  await page.evaluate(() => markSampleReceived());
  await page.waitForTimeout(100);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('sample-records-per-order');

  // ═══════════════════════════════════════════════════════════════════
  // TEST 1: the exact reported two-order scenario, end to end.
  // ═══════════════════════════════════════════════════════════════════
  {
    const page = await context.newPage();
    const patient = { id: 'p1', name: 'Two Order Patient', mrn: 'M1', lab_no: 'L1', age: 40, age_unit: 'Years', sex: 'Male', tests_requested: ['CBC (Full Blood Count)'], payment_status: 'paid' };
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${STATEFUL_MOCK_SRC}
      window.__seed = ${JSON.stringify(seedFor(patient))};
      window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
    `);
    await login(page, baseUrl);

    // Order 1 (CBC): full golden path -- Collect -> Receive -> Enter -> Verify -> Release.
    await collectAndReceive(page, 'p1');
    await page.evaluate((p) => openUnifiedResultsEntry(p.id, p.lab_no, p.name), patient);
    await page.waitForTimeout(150);
    for (const [id, val] of Object.entries(CBC_FIELDS)) await page.fill('#' + id, val);
    await page.evaluate(() => saveHemEntry(true));
    await page.waitForTimeout(150);
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(150);
    const afterOrder1 = await page.evaluate(() => sb.__db.sample_records.map(r => ({ id: r.id, status: r.status })));
    t.check('order 1 fully released: exactly one sample_records row, status Released', afterOrder1.length === 1 && afterOrder1[0].status === 'Released');

    // Doctor orders a DIFFERENT test (RFT) mid-visit, after order 1 finished.
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Two Order Patient', mrn: 'M1', lab_no: 'L1', tests_requested: ['CBC (Full Blood Count)'], payment_status: 'paid' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => buildOrderTestPanel());
    await page.evaluate(() => {
      const chk = [...document.querySelectorAll('.order-test-chk')].find(c => c.value.includes('RFT'));
      if (chk) chk.checked = true;
    });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(200);

    const afterOrder2 = await page.evaluate(() => sb.__db.sample_records.map(r => ({ id: r.id, status: r.status })));
    t.check('order 2 (RFT) creates a genuinely NEW sample_records row (not a second patient-only row merged into the first)', afterOrder2.length === 2);
    const order1Row = afterOrder2.find(r => r.id === 'sr1');
    t.check("order 1's row is completely untouched -- still Released, never regressed back to Pending", order1Row && order1Row.status === 'Released');
    const order2Row = afterOrder2.find(r => r.id !== 'sr1');
    t.check("order 2's new row starts at Pending, exactly like a first-ever order would", order2Row && order2Row.status === 'Pending');

    const ptAfter = await page.evaluate(() => sb.__db.patients.find(p => p.id === 'p1'));
    t.check('both tests are merged into tests_requested', ptAfter.tests_requested.includes('CBC (Full Blood Count)') && ptAfter.tests_requested.includes('RFT (Renal Function)'));

    // Cashier collects payment for the new order.
    await page.evaluate(() => { sb.__db.patients.find(p => p.id === 'p1').payment_status = 'paid'; });

    // THE BUG: RFT must NOT be directly enterable yet -- Unified Entry
    // should refuse until the new specimen is actually received.
    const toasts = [];
    await page.exposeFunction('__captSRPO', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function (msg, kind) { window.__captSRPO(msg); return orig ? orig(msg, kind) : undefined; }; });
    await page.evaluate((p) => openUnifiedResultsEntry(p.id, p.lab_no, p.name), patient);
    await page.waitForTimeout(150);
    t.check('Unified Results Entry refuses to open while the new specimen is still Pending (not yet collected)', toasts.some(m => m.includes('Sample not yet received')));
    toasts.length = 0;

    // And the patient must reappear in the Sample Collection queue for the new specimen.
    await page.evaluate(() => loadSampleQueue());
    await page.waitForTimeout(100);
    const queueHtml = await page.evaluate(() => document.getElementById('sc-queue-body')?.innerHTML || '');
    t.check('the patient reappears in the Sample Collection pending queue for the new specimen', queueHtml.includes('Two Order Patient'));

    // Now actually collect and receive the SECOND specimen...
    await collectAndReceive(page, 'p1');
    const afterOrder2Received = await page.evaluate(() => sb.__db.sample_records.find(r => r.id !== 'sr1'));
    t.check("order 2's specimen is now Received", afterOrder2Received.status === 'Received');
    const order1StillReleased = await page.evaluate(() => sb.__db.sample_records.find(r => r.id === 'sr1'));
    t.check("collecting/receiving order 2's specimen never touched order 1's row", order1StillReleased.status === 'Released');

    // ...and only THEN does RFT become enterable.
    await page.evaluate((p) => openUnifiedResultsEntry(p.id, p.lab_no, p.name), patient);
    await page.waitForTimeout(150);
    t.check('Unified Results Entry now opens once the new specimen is actually received', !toasts.some(m => m.includes('Sample not yet received')));
    const sectionsShown = await page.evaluate(() => document.getElementById('ue-pt-info')?.innerHTML || '');
    t.check('both Haematology and Chemistry sections are now available', sectionsShown.includes('Haematology') && sectionsShown.includes('Chemistry'));

    // Order 1's already-verified CBC data must remain completely untouched throughout.
    const hemRow = await page.evaluate(() => sb.__db.results_hematology[0]);
    t.check("order 1's CBC result row is unchanged (still verified/released) after all of this", hemRow.wbc === 7 && hemRow.is_verified === true);

    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // TEST 2: regression -- a normal single-order-per-visit patient (the
  // vast majority of patients) still golden-paths cleanly, unaffected.
  // ═══════════════════════════════════════════════════════════════════
  {
    const page = await context.newPage();
    const patient = { id: 'p2', name: 'Single Order Patient', mrn: 'M2', lab_no: 'L2', age: 30, age_unit: 'Years', sex: 'Female', tests_requested: ['CBC (Full Blood Count)'], payment_status: 'paid' };
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${STATEFUL_MOCK_SRC}
      window.__seed = ${JSON.stringify(seedFor(patient))};
      window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
    `);
    await login(page, baseUrl);

    await collectAndReceive(page, 'p2');
    const rec = await page.evaluate(() => sb.__db.sample_records[0]);
    t.check('single order: Collect -> Receive still works exactly as before (status Received)', rec.status === 'Received');

    await page.evaluate((p) => openUnifiedResultsEntry(p.id, p.lab_no, p.name), patient);
    await page.waitForTimeout(150);
    for (const [id, val] of Object.entries(CBC_FIELDS)) await page.fill('#' + id, val);
    const toasts2 = [];
    await page.exposeFunction('__captSRPO2', (m) => toasts2.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function (msg, kind) { window.__captSRPO2(msg); return orig ? orig(msg, kind) : undefined; }; });
    await page.evaluate(() => saveHemEntry(true));
    await page.waitForTimeout(150);
    t.check('single order: Save & Verify succeeds with no error', toasts2.includes('✅ CBC saved & verified'));
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(150);
    t.check('single order: Release succeeds with no error', toasts2.includes('📤 Haematology results released'));
    const finalRec = await page.evaluate(() => sb.__db.sample_records[0]);
    t.check('single order: exactly one sample_records row throughout, now Released', finalRec.status === 'Released');

    await page.close();
  }

  return t;
};
