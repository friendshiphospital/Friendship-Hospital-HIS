// Covers Six-issues Phase 3: a completed lab test showing no "View Result"
// link at all (repro: "Haemoglobin Only" — only a remove/✕ button was
// offered). Root cause: resolveDeptFullNameForTest() matched order_detail
// against DEPT_META's keyword lists only, and 13 of the 68 catalog test
// names (across Haematology/Chemistry/Endocrine) don't happen to contain
// any of their own department's keyword substrings. Fixed by adding an
// exact-match lookup built from the authoritative TEST_CATALOG, checked
// before the keyword fallback -- this test exhaustively walks every test
// name in TEST_CATALOG (not just the one reported name) to prove none of
// them are unresolvable, and separately proves the Worklist department
// filter (testMatchesDept(), the same underlying weakness) is fixed too.
const { makeSuite } = require('./helpers/test-kit');

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('lab-result-view-link-audit');
  const page = await context.newPage();
  await login(page, baseUrl);

  // --- Exhaustive audit: every test name in TEST_CATALOG must resolve to a department ---
  const unresolvable = await page.evaluate(() => {
    const missing = [];
    Object.entries(TEST_CATALOG).forEach(([catKey, tests]) => {
      (tests || []).forEach(testName => {
        if (!resolveDeptFullNameForTest(testName)) missing.push(catKey + ' -> ' + testName);
      });
    });
    return missing;
  });
  t.check('every TEST_CATALOG test name resolves to a department (no missing View Result link)', unresolvable.length === 0);
  if (unresolvable.length) t.check('unresolvable tests: ' + unresolvable.join(', '), false);

  // --- The exact reported repro case ---
  const hgbDept = await page.evaluate(() => resolveDeptFullNameForTest('Haemoglobin Only'));
  t.check('"Haemoglobin Only" specifically resolves to haematology (the reported repro)', hgbDept === 'haematology');

  // --- A sample of the other previously-broken names found in the same audit ---
  const otherBroken = await page.evaluate(() => ({
    ptinr: resolveDeptFullNameForTest('PT / INR'),
    aptt: resolveDeptFullNameForTest('aPTT'),
    ddimer: resolveDeptFullNameForTest('D-Dimer'),
    crossmatch: resolveDeptFullNameForTest('Cross-Match'),
    postprandial: resolveDeptFullNameForTest('2hr Post Prandial'),
    ironstudies: resolveDeptFullNameForTest('Iron Studies'),
    cortisol: resolveDeptFullNameForTest('Cortisol'),
  }));
  t.check('"PT / INR" resolves to haematology', otherBroken.ptinr === 'haematology');
  t.check('"aPTT" resolves to haematology', otherBroken.aptt === 'haematology');
  t.check('"D-Dimer" resolves to haematology', otherBroken.ddimer === 'haematology');
  t.check('"Cross-Match" resolves to haematology', otherBroken.crossmatch === 'haematology');
  t.check('"2hr Post Prandial" resolves to chemistry', otherBroken.postprandial === 'chemistry');
  t.check('"Iron Studies" resolves to chemistry', otherBroken.ironstudies === 'chemistry');
  t.check('"Cortisol" (an endo/immuno catalog test) resolves to immunology', otherBroken.cortisol === 'immunology');

  // --- The same underlying weakness, fixed at the Worklist department-filter call sites too ---
  const wlDeptMatches = await page.evaluate(() => ({
    hgbMatchesHem: testMatchesDept('Haemoglobin Only', 'hem'),
    hgbMatchesChem: testMatchesDept('Haemoglobin Only', 'chem'),
    cortisolMatchesImmuno: testMatchesDept('Cortisol', 'immuno'),
  }));
  t.check('Worklist department filter: "Haemoglobin Only" matches the Haematology filter', wlDeptMatches.hgbMatchesHem === true);
  t.check('Worklist department filter: "Haemoglobin Only" does NOT match an unrelated department', wlDeptMatches.hgbMatchesChem === false);
  t.check('Worklist department filter: "Cortisol" matches the Immunology filter', wlDeptMatches.cortisolMatchesImmuno === true);

  // --- Freeform/legacy test names outside the catalog still fall back to keyword matching ---
  const legacyStillWorks = await page.evaluate(() => resolveDeptFullNameForTest('Random Glucose Test'));
  t.check('a freeform test name outside the catalog still resolves via the keyword fallback', legacyStillWorks === 'chemistry');

  await page.close();
  return t;
};
