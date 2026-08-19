// Covers the fix that consolidated the standalone "Lab Investigation
// History" page (added in PR #86) into Patient History Timeline, plus the
// one-time admin backfill for lab_result_history that shipped alongside it.
//
// Background: migration_v2.51 (lab_result_history, the EAV table behind
// this feature) deliberately shipped with no backfill -- history only
// accumulates from the first save after the migration ran. A live
// diagnostic against a real patient confirmed both the write path
// (logLabResultHistory, all 7 departments) and the read path
// (selectInvHistoryPatient/loadInvHistoryData) were already correct; the
// "shows empty" symptom the user hit was pre-existing results never having
// been backfilled. Separately, the standalone page duplicated Patient
// History Timeline's own patient search -- two entry points into the same
// data -- so it was folded into a new "Lab Investigation Browser" card
// inside page-pt-history instead, and the standalone page removed.
//
// Uses STATEFUL_MOCK_SRC (not CHAINABLE_MOCK_SRC) throughout: backfill's
// idempotency and the Timeline's mrn-merge queries both depend on real
// per-table filtering, which the chainable mock's no-op filters can't tell
// apart from a broken same-visit-only query.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(seedOverrides) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Test User', role: 'admin' }] },
    users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    ...seedOverrides,
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
    window.confirm = () => true;
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
  const t = makeSuite('lab-investigation-history-consolidation');

  // --- Backfill: pre-migration-style data (results exist, lab_result_history empty) ---
  {
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }],
        patients: [{ id: 'pt-old', mrn: 'MRN-OLD', lab_no: 'L-OLD', name: 'Old Patient', age: 40, age_unit: 'y', sex: 'M' }],
        results_hematology: [{ patient_id: 'pt-old', wbc: 11.2, hgb: 9.5, analysis_date: '2026-06-01', is_verified: true, verified_at: '2026-06-01T10:00:00Z', performed_by: 's1' }],
        results_chemistry: [{ patient_id: 'pt-old', creat: 130, urea: 9.2, analysis_date: '2026-06-01', is_verified: false, performed_by: 's1' }],
        lab_result_history: [],
      },
      users: [{ id: 'u1', email: 'admin@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl, 'admin@example.com');

    const before = await page.evaluate(() => sb.__db.lab_result_history.length);
    t.check('before backfill, lab_result_history is empty (the exact symptom being fixed)', before === 0);

    await page.evaluate(async () => { await backfillLabResultHistory(); });
    await page.waitForTimeout(150);
    const afterRows = await page.evaluate(() => sb.__db.lab_result_history);
    t.check('backfill adds 4 rows (2 Hem + 2 Chem fields)', afterRows.length === 4);
    t.check('backfilled rows use the historical analysis_date, not "now"', afterRows.every(r => r.saved_at.startsWith('2026-06-01')));
    t.check('a high WBC (11.2 > 10) is correctly flagged H', afterRows.find(r => r.test_code === 'wbc')?.flag === 'H');
    t.check('a low HGB (9.5 < 12) is correctly flagged L', afterRows.find(r => r.test_code === 'hgb')?.flag === 'L');
    t.check('mrn is resolved from the patients row', afterRows.every(r => r.mrn === 'MRN-OLD'));

    // Idempotency: re-running must not duplicate
    await page.evaluate(async () => { await backfillLabResultHistory(); });
    await page.waitForTimeout(150);
    const secondCount = await page.evaluate(() => sb.__db.lab_result_history.length);
    t.check('re-running backfill is a true no-op (idempotent, no duplicates)', secondCount === 4);
    await page.close();
  }

  // --- Consolidation: Timeline shows the Lab Investigation Browser card for a patient WITH history ---
  {
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Doctor Test', role: 'doctor' }],
        patients: [
          { id: 'pt-with', mrn: 'MRN-500', lab_no: 'L-500', name: 'Has History', age: 30, age_unit: 'y', sex: 'F' },
          { id: 'pt-none', mrn: 'MRN-600', lab_no: 'L-600', name: 'No History', age: 25, age_unit: 'y', sex: 'M' },
        ],
        lab_result_history: [
          { id: 'h1', patient_id: 'pt-with', mrn: 'MRN-500', department: 'hem', test_code: 'wbc', test_name: 'WBC', value: '6.5', unit: '10^3/uL', ref_range_lo: 4, ref_range_hi: 10, flag: 'N', saved_at: '2026-06-01T09:00:00Z' },
          { id: 'h2', patient_id: 'pt-with', mrn: 'MRN-500', department: 'chem', test_code: 'creat', test_name: 'Creatinine', value: '130', unit: 'umol/L', ref_range_lo: 62, ref_range_hi: 106, flag: 'H', saved_at: '2026-07-15T09:00:00Z' },
        ],
      },
      users: [{ id: 'u1', email: 'doc@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl, 'doc@example.com');
    await page.evaluate(() => goPage('pt-history'));
    await page.waitForTimeout(100);

    await page.evaluate(async () => { await selectPthPatient({ id: 'pt-with', name: 'Has History', mrn: 'MRN-500', lab_no: 'L-500', age: 30, age_unit: 'y', sex: 'F' }); });
    await page.waitForTimeout(200);
    let cardVisible = await page.evaluate(() => document.getElementById('pth-labhist-card')?.style.display !== 'none');
    let listHtml = await page.evaluate(() => document.getElementById('invh-list')?.innerHTML || '');
    t.check('a patient with lab_result_history shows the Lab Investigation Browser card', cardVisible);
    t.check('the card lists WBC', listHtml.includes('WBC'));
    t.check('the card lists Creatinine', listHtml.includes('Creatinine'));

    await page.evaluate(() => selectInvHistoryTest('Creatinine'));
    const detailHtml = await page.evaluate(() => document.getElementById('invh-detail')?.innerHTML || '');
    t.check('selecting a test shows its value', detailHtml.includes('130'));
    t.check('an out-of-range value is flagged H using the existing colour convention', detailHtml.includes('▲ H'));

    // Switch to a patient with no lab_result_history -- card must hide, not error
    await page.evaluate(async () => { await selectPthPatient({ id: 'pt-none', name: 'No History', mrn: 'MRN-600', lab_no: 'L-600', age: 25, age_unit: 'y', sex: 'M' }); });
    await page.waitForTimeout(200);
    cardVisible = await page.evaluate(() => document.getElementById('pth-labhist-card')?.style.display !== 'none');
    t.check('a patient with no lab_result_history keeps the card hidden (not an error)', !cardVisible);

    // Doctor "Full History ->" deep-link
    await page.evaluate(() => { _docPt = { id: 'pt-with', name: 'Has History', mrn: 'MRN-500', lab_no: 'L-500', age: 30, age_unit: 'y', sex: 'F' }; });
    await page.evaluate(() => openLabHistoryFromDoctor());
    await page.waitForTimeout(500);
    const onTimeline = await page.evaluate(() => document.getElementById('page-pt-history')?.classList.contains('active'));
    cardVisible = await page.evaluate(() => document.getElementById('pth-labhist-card')?.style.display !== 'none');
    const bannerName = await page.evaluate(() => document.getElementById('pth-pt-name')?.textContent);
    t.check('Doctor "Full History" button lands on Patient History Timeline', onTimeline === true);
    t.check('...with the same patient pre-selected', bannerName === 'Has History');
    t.check('...and the Lab Investigation Browser card populated', cardVisible);

    // Stale-reference sweep
    const stale = await page.evaluate(() => ({
      rolePages: Object.values(ROLE_PAGES).some(arr => arr.includes('investigation-history')),
      modulePages: Object.values(MODULE_PAGES).some(m => (m.pages || []).includes('investigation-history')),
      sidebar: document.querySelectorAll('[data-p="investigation-history"]').length,
      pageDiv: !!document.getElementById('page-investigation-history'),
    }));
    t.check('no ROLE_PAGES entry still grants the removed page', !stale.rolePages);
    t.check('no MODULE_PAGES entry still links the removed page', !stale.modulePages);
    t.check('no sidebar item still points at the removed page', stale.sidebar === 0);
    t.check('the removed page\'s DOM element no longer exists', !stale.pageDiv);
    await page.close();
  }

  // --- Brand-new registration: zero visits/history of any kind, whole Timeline still renders sensibly ---
  {
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Nurse Test', role: 'nurse' }],
        patients: [{ id: 'pt-new', mrn: 'MRN-999', lab_no: null, name: 'Brand New', age: 5, age_unit: 'y', sex: 'M', tests_requested: [], visit_status: 'Registered' }],
      },
      users: [{ id: 'u1', email: 'nurse@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl, 'nurse@example.com');
    await page.evaluate(() => goPage('pt-history'));
    await page.waitForTimeout(100);
    await page.evaluate(async () => { await selectPthPatient({ id: 'pt-new', name: 'Brand New', mrn: 'MRN-999', lab_no: null, age: 5, age_unit: 'y', sex: 'M' }); });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => ({
      statsVisible: document.getElementById('pth-stats')?.style.display,
      mainGridVisible: document.getElementById('pth-main-grid')?.style.display,
      labhistCardVisible: document.getElementById('pth-labhist-card')?.style.display,
      bannerName: document.getElementById('pth-pt-name')?.textContent,
    }));
    t.check('a brand-new registration still renders the Timeline stats/grid', result.statsVisible === 'grid' && result.mainGridVisible === 'grid');
    t.check('...with the Lab Investigation Browser card hidden, not broken', result.labhistCardVisible === 'none');
    t.check('...and the correct patient banner', result.bannerName === 'Brand New');
    await page.close();
  }

  return t;
};
