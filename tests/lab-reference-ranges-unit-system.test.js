// Covers the new Lab Reference Ranges admin feature + SI/Conventional unit
// system toggle:
//   1. lab_reference_ranges admin CRUD (list/filter/add/edit/delete),
//      modeled on the Price List module.
//   2. getLabRefRange()/convertLabValueForDisplay() resolving correctly
//      against CFG.labUnitSystem, with a graceful RESULT_META fallback for
//      any field with no lab_reference_ranges row yet.
//   3. The Chemistry result-entry page (creatinine) and printChemReport()
//      both showing SI by default (byte-identical to the pre-existing
//      hardcoded text), switching to Conventional units/ranges/values when
//      toggled, and falling back to SI for an unmigrated field (ALT) --
//      with the underlying stored result value always staying SI either
//      way.
//   4. calcGlobAG()'s auto-calculated Globulin display converting via the
//      same mechanism (reusing Albumin's conversion factor), while its
//      unitless A/G Ratio never converts.
//
// Uses STATEFUL_MOCK_SRC (real per-table filtering) throughout — this
// feature is fundamentally about resolving a MATCHING row for a given
// dept_key+field_code and reacting differently depending on what's found,
// which CHAINABLE_MOCK_SRC's no-op filters cannot distinguish (see the
// project's other STATEFUL_MOCK_SRC-based test file for the same reasoning).
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(seedOverrides) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Test User', role: 'lab_tech' }] },
    users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    ...seedOverrides,
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
    window.__printedDocs = [];
    window.open = function() {
      return { document: { write: (html) => { window.__printedDocs.push(html); }, close: () => {}, title: '' }, focus: () => {}, print: () => {}, close: () => {} };
    };
  `;
}

async function login(page, baseUrl, role) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'test@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('lab-reference-ranges-unit-system');

  // ═══════════════════════════════════════════════════════════════════
  // PART 1 — Reference Ranges admin CRUD (admin role)
  // ═══════════════════════════════════════════════════════════════════
  {
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }],
        lab_reference_ranges: [
          { id: 'r1', dept_key: 'chem', field_code: 'creat', label: 'Creatinine', si_unit: 'µmol/L', si_lo: 62, si_hi: 106, conventional_unit: 'mg/dL', conventional_lo: 0.70, conventional_hi: 1.20, conversion_factor: 0.0113 },
          { id: 'r2', dept_key: 'hem', field_code: 'hgb', label: 'HGB — Haemoglobin', si_unit: 'g/dL', si_lo: 12.0, si_hi: 17.5, conventional_unit: null, conventional_lo: null, conventional_hi: null, conversion_factor: null },
        ],
      },
      users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('reference-ranges'));
    await page.waitForTimeout(200);
    const tableHtml = await page.evaluate(() => document.getElementById('refrange-table-body').innerHTML);
    t.check('seeded reference ranges render, grouped by department', tableHtml.includes('Creatinine') && tableHtml.includes('HGB'));
    t.check('a row with Conventional data shows its converted range', tableHtml.includes('mg/dL'));
    t.check('a row with no Conventional data shows the SI-fallback note', tableHtml.includes('falls back to SI'));

    await page.selectOption('#rr-dept-filter', 'hem');
    await page.waitForTimeout(50);
    const filtered = await page.evaluate(() => document.getElementById('refrange-table-body').innerHTML);
    t.check('department filter narrows the list correctly', filtered.includes('HGB') && !filtered.includes('Creatinine'));
    await page.selectOption('#rr-dept-filter', '');

    await page.evaluate(() => editRefRange('r1'));
    await page.fill('#rr-si-hi', '110');
    await page.evaluate(() => saveRefRange());
    await page.waitForTimeout(150);
    const updated = await page.evaluate(() => sb.__db.lab_reference_ranges.find(r => r.id === 'r1'));
    t.check('editing an existing range persists the change', updated?.si_hi == 110);

    await page.evaluate(() => openRefRangeForm());
    await page.selectOption('#rr-dept', 'sero');
    await page.fill('#rr-field-code', 'newmarker');
    await page.fill('#rr-label', 'New Marker');
    await page.fill('#rr-si-unit', 'IU/mL');
    await page.fill('#rr-si-lo', '0');
    await page.fill('#rr-si-hi', '10');
    await page.evaluate(() => saveRefRange());
    await page.waitForTimeout(150);
    const created = await page.evaluate(() => sb.__db.lab_reference_ranges.find(r => r.field_code === 'newmarker'));
    t.check('adding a brand-new reference range row works', !!created);

    await page.evaluate(() => { window.confirm = () => true; });
    await page.evaluate(() => deleteRefRange('r2'));
    await page.waitForTimeout(150);
    const afterDelete = await page.evaluate(() => sb.__db.lab_reference_ranges.find(r => r.id === 'r2'));
    t.check('deleting a reference range row works', !afterDelete);
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 2 — getLabRefRange() / convertLabValueForDisplay() resolution
  // ═══════════════════════════════════════════════════════════════════
  {
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Test User', role: 'lab_tech' }],
        lab_reference_ranges: [
          { id: 'r1', dept_key: 'chem', field_code: 'creat', label: 'Creatinine', si_unit: 'µmol/L', si_lo: 62, si_hi: 106, conventional_unit: 'mg/dL', conventional_lo: 0.70, conventional_hi: 1.20, conversion_factor: 0.0113 },
        ],
      },
      users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl);
    await page.evaluate(() => loadRefRanges());
    await page.waitForTimeout(100);

    const siDefault = await page.evaluate(() => getLabRefRange('chem', 'creat'));
    t.check('getLabRefRange() defaults to SI', siDefault.unit === 'µmol/L' && siDefault.lo === 62 && siDefault.hi === 106);

    await page.evaluate(() => { CFG.labUnitSystem = 'conventional'; });
    const convResolved = await page.evaluate(() => getLabRefRange('chem', 'creat'));
    t.check('getLabRefRange() returns Conventional data when toggled and a matching row exists', convResolved.unit === 'mg/dL' && convResolved.lo === 0.70 && convResolved.hi === 1.20);

    const unmigrated = await page.evaluate(() => getLabRefRange('chem', 'alt'));
    t.check('getLabRefRange() falls back to hardcoded RESULT_META for a field with no matching row, even in Conventional mode', unmigrated.unit === 'U/L' && unmigrated.lo === 7 && unmigrated.hi === 56);

    const converted = await page.evaluate(() => convertLabValueForDisplay('chem', 'creat', 88));
    t.check('convertLabValueForDisplay() applies the conversion factor correctly (88 * 0.0113 ≈ 0.9944)', Math.abs(converted - 0.9944) < 0.001);

    await page.evaluate(() => { CFG.labUnitSystem = 'si'; });
    const noopConversion = await page.evaluate(() => convertLabValueForDisplay('chem', 'creat', 88));
    t.check('convertLabValueForDisplay() is a no-op in SI mode', noopConversion === 88);
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 3 — End-to-end: Chemistry entry page + printChemReport()
  // ═══════════════════════════════════════════════════════════════════
  {
    const PT_ID = 'pt-unit-e2e';
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Test User', role: 'lab_tech' }],
        patients: [{ id: PT_ID, mrn: 'MRN-900', name: 'Unit Test Patient', age: 45, age_unit: 'Years', sex: 'Male', tests_requested: ['RFT (Renal Function)'], payment_status: 'paid' }],
        lab_reference_ranges: [
          { id: 'r1', dept_key: 'chem', field_code: 'creat', label: 'Creatinine', si_unit: 'µmol/L', si_lo: 62, si_hi: 106, conventional_unit: 'mg/dL', conventional_lo: 0.70, conventional_hi: 1.20, conversion_factor: 0.0113 },
        ],
        results_chemistry: [{ id: 'res1', patient_id: PT_ID, creat: 88, urea: 5, ua: 0.3, egfr: 90, analysis_date: '2026-01-01', created_at: '2026-01-01' }],
      },
      users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl);
    await page.evaluate(() => loadRefRanges());
    await page.waitForTimeout(100);

    await page.evaluate((ptId) => openUnifiedResultsEntry(ptId, 'L1', 'Unit Test Patient'), PT_ID);
    await page.waitForTimeout(300);
    const siRange = await page.evaluate(() => document.getElementById('ce-creat-range')?.textContent);
    t.check('SI mode (default): entry-page range text is byte-identical to the original hardcoded value', siRange === '62–106 µmol/L');

    await page.evaluate(() => setLabUnitSystem('conventional'));
    await page.waitForTimeout(50);
    const convRange = await page.evaluate(() => document.getElementById('ce-creat-range')?.textContent);
    t.check('toggling to Conventional immediately updates the already-open entry page range display', convRange === '0.7–1.2 mg/dL');

    await page.evaluate(() => printChemReport());
    await page.waitForTimeout(200);
    const printed = await page.evaluate(() => window.__printedDocs[window.__printedDocs.length - 1] || '');
    t.check('printed Chemistry report shows the Conventional unit', printed.includes('mg/dL'));
    const creatCell = printed.match(/Creatinine<\/td><td[^>]*>([^<]*)</);
    t.check('printed Chemistry report shows the CONVERTED value, not the raw SI value', creatCell && Math.abs(parseFloat(creatCell[1]) - 0.9944) < 0.001);

    const storedRow = await page.evaluate(() => sb.__db.results_chemistry.find(r => r.patient_id === 'pt-unit-e2e'));
    t.check('the underlying stored result value is untouched (still the original SI value)', storedRow.creat === 88);

    await page.evaluate(() => setLabUnitSystem('si'));
    await page.waitForTimeout(50);
    const backToSi = await page.evaluate(() => document.getElementById('ce-creat-range')?.textContent);
    t.check('toggling back to SI restores the exact original display (no regression)', backToSi === '62–106 µmol/L');

    const altRangeConventional = await page.evaluate(() => { CFG.labUnitSystem='conventional'; refreshAllRangeDisplays(); return document.getElementById('ce-alt-range')?.textContent; });
    t.check('a field with no Conventional data on file (ALT) still shows SI even while the toggle is on Conventional', altRangeConventional === '7–56 U/L');
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 4 — calcGlobAG()'s auto-calculated Globulin respects the toggle
  // ═══════════════════════════════════════════════════════════════════
  {
    const PT_ID = 'pt-glob-e2e';
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Test User', role: 'lab_tech' }],
        patients: [{ id: PT_ID, mrn: 'MRN-950', name: 'Glob Test Patient', age: 40, age_unit: 'Years', sex: 'Female', tests_requested: ['LFT (Liver Function)'], payment_status: 'paid' }],
        lab_reference_ranges: [
          { id: 'ralb', dept_key: 'chem', field_code: 'alb', label: 'Albumin', si_unit: 'g/L', si_lo: 35, si_hi: 50, conventional_unit: 'g/dL', conventional_lo: 3.5, conventional_hi: 5.0, conversion_factor: 0.1 },
        ],
      },
      users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl);
    // localStorage (and therefore CFG.labUnitSystem) persists across
    // newPage() within the same browser context — reset explicitly rather
    // than assuming a clean default, since an earlier Part in this same
    // file may have left it on 'conventional'.
    await page.evaluate(() => { CFG.labUnitSystem = 'si'; });
    await page.evaluate(() => loadRefRanges());
    await page.waitForTimeout(100);
    await page.evaluate((ptId) => openUnifiedResultsEntry(ptId, 'L1', 'Glob Test Patient'), PT_ID);
    await page.waitForTimeout(300);

    await page.fill('#ce-tp', '70');
    await page.dispatchEvent('#ce-tp', 'input');
    await page.fill('#ce-alb', '40');
    await page.dispatchEvent('#ce-alb', 'input');
    await page.waitForTimeout(50);
    const globSi = await page.evaluate(() => document.getElementById('ce-glob').value);
    t.check('Globulin computes correctly in SI (TP 70 - Alb 40 = 30.0 g/L)', globSi === '30.0');

    await page.evaluate(() => { CFG.labUnitSystem = 'conventional'; });
    await page.dispatchEvent('#ce-tp', 'input');
    await page.waitForTimeout(50);
    const globConv = await page.evaluate(() => document.getElementById('ce-glob').value);
    t.check('Globulin display converts to Conventional (30.0 g/L * 0.1 = 3.00 g/dL), reusing Albumin\'s factor', globConv === '3.00');
    const agVal = await page.evaluate(() => document.getElementById('ce-ag').value);
    t.check('A/G Ratio (unitless) never converts, in either unit system', agVal === '1.33');
    await page.close();
  }

  return t;
};
