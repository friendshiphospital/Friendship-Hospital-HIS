// Covers a reported bug: every printed document across the app used the
// same single, global CFG.footer setting (Settings' "Report Footer Text"),
// so a Prescription printout carried a lab-results disclaimer that made no
// sense on it. printFooter(section) now accepts 'lab' | 'radiology' |
// 'doctor' | 'nursing' | 'general', each with its own independently
// configurable Settings field/localStorage key/default text — every
// openPrintWin() caller across the file was swept and given the section
// matching what kind of document it actually prints (ambiguous ones, e.g.
// Blood Bank labels/slips, WHO Checklist, OT Schedule, Consent Form, Bed
// Transfer Register/Census, Insurance Claim, Stats PDF, default to
// 'general' — the pre-existing/unchanged text — and are listed in the PR
// description for confirmation rather than guessed into a specific bucket).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    localStorage.setItem('cfg_footer','GENERAL_FOOTER_TEXT');
    localStorage.setItem('cfg_lab_footer','LAB_FOOTER_TEXT');
    localStorage.setItem('cfg_rad_footer','RAD_FOOTER_TEXT');
    localStorage.setItem('cfg_doctor_footer','DOCTOR_FOOTER_TEXT');
    localStorage.setItem('cfg_nursing_footer','NURSING_FOOTER_TEXT');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => { if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []); return chainable(null, []); },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'admin@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('print-footer-sections');

  // --- TEST 1: printFooter(section) returns the correct per-section text, each independent of the others ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    const results = await page.evaluate(() => ({
      lab: printFooter('lab'),
      radiology: printFooter('radiology'),
      doctor: printFooter('doctor'),
      nursing: printFooter('nursing'),
      general: printFooter('general'),
      omitted: printFooter(),
      unknown: printFooter('bogus-section'),
    }));
    t.check("printFooter('lab') uses the Lab footer text", results.lab.includes('LAB_FOOTER_TEXT'));
    t.check("printFooter('radiology') uses the Radiology footer text", results.radiology.includes('RAD_FOOTER_TEXT'));
    t.check("printFooter('doctor') uses the Doctor footer text", results.doctor.includes('DOCTOR_FOOTER_TEXT'));
    t.check("printFooter('nursing') uses the Nursing footer text", results.nursing.includes('NURSING_FOOTER_TEXT'));
    t.check("printFooter('general') uses the General footer text", results.general.includes('GENERAL_FOOTER_TEXT'));
    t.check('calling printFooter() with no argument falls back to General (backward compatible)', results.omitted.includes('GENERAL_FOOTER_TEXT'));
    t.check('an unrecognized section also falls back to General rather than showing nothing', results.unknown.includes('GENERAL_FOOTER_TEXT'));
    t.check('each section is genuinely independent — none of the section texts leak into another',
      !results.lab.includes('DOCTOR_FOOTER_TEXT') && !results.doctor.includes('LAB_FOOTER_TEXT') && !results.nursing.includes('LAB_FOOTER_TEXT'));
    await page.close();
  }

  // --- TEST 2: a printed Prescription (doctor document) no longer shows the lab disclaimer, and shows the Doctor section text instead ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => {
      _docPt = { id: 'p1', name: 'Test Patient', mrn: 'M1', age: 30, age_unit: 'Years', sex: 'Male' };
    });
    // Capture what openPrintWin() would have written instead of actually opening a popup window.
    const html = await page.evaluate(() => {
      let captured = null;
      const orig = window.openPrintWin;
      window.openPrintWin = (h) => { captured = h; return { document: { write(){}, close(){} } }; };
      printPrescription();
      window.openPrintWin = orig;
      return captured;
    });
    t.check('a printed Prescription no longer carries the lab-results footer text', html && !html.includes('LAB_FOOTER_TEXT'));
    t.check('a printed Prescription shows the Doctor section footer text instead', html && html.includes('DOCTOR_FOOTER_TEXT'));
    await page.close();
  }

  // --- TEST 3: a printed Lab report (Haematology) is unchanged — still shows the Lab section text ---
  // Uses the stateful mock (not chainable) since printHemReport() does a
  // real .single() fetch of both patients and results_hematology and
  // early-returns with a toast if either is missing — needs actual seeded
  // rows, not just a DOM field, to reach the printFooter() call at all.
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      localStorage.setItem('cfg_lab_footer','LAB_FOOTER_TEXT');
      ${STATEFUL_MOCK_SRC}
      window.__seed = {
        tables: {
          staff: [{ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }],
          patients: [{ id: 'p1', name: 'Test Patient', mrn: 'M1', age: 30, age_unit: 'Years', sex: 'Male', tests_requested: ['CBC (Full Blood Count)'] }],
          results_hematology: [{ id: 'r1', patient_id: 'p1', wbc: 7.2, hgb: 14, is_verified: true, created_at: new Date().toISOString() }],
        },
        users: [{ id: 'u1', email: 'admin@example.com', password: 'whatever' }],
      };
      window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    const html = await page.evaluate(async () => {
      let captured = null;
      const orig = window.openPrintWin;
      window.openPrintWin = (h) => { captured = h; return { document: { write(){}, close(){} } }; };
      await printHemReport();
      window.openPrintWin = orig;
      return captured;
    });
    t.check('a printed Haematology report reaches the print step (real patient + result data was found)', !!html);
    t.check('a printed Haematology report still shows the Lab section footer text (unchanged from before)', html && html.includes('LAB_FOOTER_TEXT'));
    await page.close();
  }

  // --- TEST 4: a printed Radiology report shows the Radiology section text ---
  // printRadReport() takes no arguments — it reads #rad-rep-id from the DOM
  // and does its own embedded radiology_requests->patients select.
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      localStorage.setItem('cfg_rad_footer','RAD_FOOTER_TEXT');
      ${STATEFUL_MOCK_SRC}
      window.__seed = {
        tables: {
          staff: [{ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }],
          patients: [{ id: 'p1', name: 'Test Patient', mrn: 'M1', age: 30, age_unit: 'Years', sex: 'Male' }],
          radiology_requests: [{ id: 'rr1', patient_id: 'p1', imaging_type: 'X-Ray Chest', status: 'Reported', report: 'Normal', impression: 'No acute findings', reported_at: new Date().toISOString() }],
        },
        users: [{ id: 'u1', email: 'admin@example.com', password: 'whatever' }],
      };
      window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => { const el = document.getElementById('rad-rep-id'); if (el) el.value = 'rr1'; });
    const html = await page.evaluate(async () => {
      let captured = null;
      const orig = window.openPrintWin;
      window.openPrintWin = (h) => { captured = h; return { document: { write(){}, close(){} } }; };
      await printRadReport();
      window.openPrintWin = orig;
      return captured;
    });
    t.check('a printed Radiology report reaches the print step (the seeded request/patient was found)', !!html);
    t.check('a printed Radiology report shows the Radiology section footer text', html && html.includes('RAD_FOOTER_TEXT'));
    await page.close();
  }

  // --- TEST 5: a printed Nursing document (Fluid Chart) shows the Nursing section text ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => { _fcPt = { id: 'p1', name: 'Test Patient', mrn: 'M1', ward: 'Medical', bed: '3', age: 30, age_unit: 'Years', sex: 'Male' }; });
    const html = await page.evaluate(async () => {
      let captured = null;
      const orig = window.openPrintWin;
      window.openPrintWin = (h) => { captured = h; return { document: { write(){}, close(){} } }; };
      await printFluidChart();
      window.openPrintWin = orig;
      return captured;
    });
    t.check('a printed Fluid Chart (nursing document) shows the Nursing section footer text', html && html.includes('NURSING_FOOTER_TEXT'));
    await page.close();
  }

  // --- TEST 6: Settings round-trip persists all 5 footer fields independently ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('cfg-footer').value = 'New General';
      document.getElementById('cfg-lab-footer').value = 'New Lab';
      document.getElementById('cfg-rad-footer').value = 'New Rad';
      document.getElementById('cfg-doctor-footer').value = 'New Doctor';
      document.getElementById('cfg-nursing-footer').value = 'New Nursing';
      saveSettings();
    });
    const stored = await page.evaluate(() => ({
      general: localStorage.getItem('cfg_footer'), lab: localStorage.getItem('cfg_lab_footer'),
      rad: localStorage.getItem('cfg_rad_footer'), doctor: localStorage.getItem('cfg_doctor_footer'), nursing: localStorage.getItem('cfg_nursing_footer'),
    }));
    t.check('saveSettings() persists all 5 footer fields to their own distinct localStorage keys',
      stored.general === 'New General' && stored.lab === 'New Lab' && stored.rad === 'New Rad' && stored.doctor === 'New Doctor' && stored.nursing === 'New Nursing');
    await page.evaluate(() => loadSettings());
    const reloaded = await page.evaluate(() => document.getElementById('cfg-lab-footer').value);
    t.check('loadSettings() reflects the saved Lab footer text back into its own field', reloaded === 'New Lab');
    await page.close();
  }

  return t;
};
