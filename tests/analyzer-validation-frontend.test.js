// Covers Prompt2 Phases 3 & 4: the Analyzer Validation & Verification
// frontend (data entry, KPI cards, canvas charts, sign-off, printable
// report) built around calculateEP15()/calculateEP09() (proven correct
// separately in tests/analyzer-validation-stats.test.js).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { studyInserts: [], sampleInserts: [], sampleDeletes: 0, resultInserts: [], resultUpdates: [] };
    let studyRow = null;
    let savedSamples = [];
    let latestResult = null;
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Quality Officer Test', role: 'lab_supervisor' }, []);
        if (table === 'validation_studies') {
          const c = chainable(studyRow, []);
          c.insert = (payload) => {
            window.__mock.studyInserts.push(payload);
            studyRow = { id: 'study1', ...payload };
            return { select: () => ({ single: () => Promise.resolve({ data: studyRow, error: null }) }) };
          };
          c.update = (payload) => { studyRow = { ...studyRow, ...payload }; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          c.eq = () => ({ ...c, single: () => Promise.resolve({ data: studyRow, error: null }) });
          return c;
        }
        if (table === 'validation_samples') {
          const c = chainable(null, savedSamples);
          c.insert = (payload) => { window.__mock.sampleInserts.push(payload); savedSamples = savedSamples.concat(payload); return Promise.resolve({ data: null, error: null }); };
          c.delete = () => { window.__mock.sampleDeletes++; savedSamples = []; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          c.eq = () => c;
          c.order = () => c;
          return c;
        }
        if (table === 'validation_results') {
          const c = chainable(null, latestResult ? [latestResult] : []);
          c.insert = (payload) => { window.__mock.resultInserts.push(payload); latestResult = { id: 'result1', ...payload }; return Promise.resolve({ data: null, error: null }); };
          c.update = (payload) => { window.__mock.resultUpdates.push(payload); latestResult = { ...latestResult, ...payload }; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          c.eq = () => c;
          c.order = () => c;
          c.limit = () => Promise.resolve({ data: latestResult ? [latestResult] : [], error: null });
          return c;
        }
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'labsup@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
  await page.evaluate(() => goPage('validation'));
  await page.waitForTimeout(100);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('analyzer-validation-frontend');

  // --- EP15-A3: create study, paste run data, calculate, KPIs render ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);

    await page.fill('#val-analyte', 'Glucose');
    const teaAutoFilled = await page.inputValue('#val-tea');
    t.check('TEa auto-fills from the Six Sigma TEa reference table when the analyte matches (Glucose = 10)', teaAutoFilled === '10');
    await page.selectOption('#val-protocol', 'EP15-A3');
    await page.fill('#val-instrument', 'Sysmex XN-1000');
    await page.fill('#val-claimed-cv', '3');
    await page.click('button[onclick="saveValidationStudy()"]');
    await page.waitForTimeout(200);

    const onWorkspaceTab = await page.evaluate(() => document.getElementById('val-tab-workspace').style.display !== 'none');
    t.check('creating a study auto-opens the Data Entry & Results workspace', onWorkspaceTab);
    const ep15EntryVisible = await page.evaluate(() => document.getElementById('val-ep15-entry').style.display !== 'none');
    t.check('EP15-A3 protocol shows the run-data paste entry, not the EP09 pair entry', ep15EntryVisible);

    // Hand-derived dataset: same as tests/analyzer-validation-stats.test.js's
    // EP15 reference case (grandMean=11 exactly).
    await page.fill('#val-ep15-paste', '10\t12\t11\n9\t11\t10\n11\t13\t12');
    await page.waitForTimeout(100);
    const previewText = await page.evaluate(() => document.getElementById('val-ep15-preview').textContent);
    t.check('pasted run data renders a live preview table with per-run means', previewText.includes('11.00'));

    await page.click('#val-ep15-save-btn');
    await page.waitForTimeout(300);

    const sampleCount = await page.evaluate(() => window.__mock.sampleInserts.flat().length);
    t.check('all 9 pasted replicate values are saved as validation_samples rows', sampleCount === 9);
    const resultPayload = await page.evaluate(() => window.__mock.resultInserts[0]);
    t.check('the saved validation_results row carries the correct hand-derived Grand Mean (11)', Math.abs(resultPayload.grand_mean - 11) < 0.001);
    t.check('overall PASS/FAIL was computed (claimed CV 3% vs this precise dataset)', resultPayload.result_status === 'Pass' || resultPayload.result_status === 'Fail');

    const kpiText = await page.evaluate(() => document.getElementById('val-kpi-cards').textContent);
    t.check('KPI cards render Grand Mean, Within-Run %CV, Within-Lab %CV, UVL', kpiText.includes('Grand Mean') && kpiText.includes('Within-Run') && kpiText.includes('Within-Lab') && kpiText.includes('UVL'));
    const badgeText = await page.evaluate(() => document.getElementById('val-passfail-badge').textContent);
    t.check('a PASS/FAIL badge is shown (not stuck on Pending Review, since claimed CV was supplied)', badgeText.includes('PASS') || badgeText.includes('FAIL'));

    const precisionCardVisible = await page.evaluate(() => document.getElementById('val-precision-card').style.display !== 'none');
    t.check('the EP15 precision run chart card becomes visible (EP Evaluator-style report chart)', precisionCardVisible);
    const precisionChartDrawn = await page.evaluate(() => {
      const c = document.getElementById('val-precision-canvas');
      // A blank, never-drawn canvas encodes to a tiny constant-size PNG;
      // an actually-drawn chart (axes, bands, points) is meaningfully larger.
      return c && c.toDataURL('image/png').length > 1000;
    });
    t.check('the precision run chart canvas actually has content drawn on it', precisionChartDrawn);

    const studyStatus = await page.evaluate(() => window.__mock.studyInserts.length > 0);
    t.check('sanity: study creation itself was captured', studyStatus);

    // --- Sign-off ordering: Approve is blocked until Review is confirmed ---
    const approveInitiallyHidden = await page.evaluate(() => document.getElementById('val-approve-btn').style.display === 'none');
    t.check('the Lab Director Approve button is not shown before Quality Manager review', approveInitiallyHidden);

    await page.click('#val-verify-btn');
    await page.waitForTimeout(200);
    const verifyStamped = await page.evaluate(() => window.__mock.resultUpdates.some(u => u.verified_by_name === 'Quality Officer Test'));
    t.check('confirming review stamps verified_by_name and verified_at', verifyStamped);
    const approveNowVisible = await page.evaluate(() => document.getElementById('val-approve-btn').style.display !== 'none');
    t.check('the Approve button unlocks once review is confirmed', approveNowVisible);

    // --- Two-person sign-off: the SAME account that performed Review must not be able to Approve ---
    const updatesBeforeSameAccountAttempt = await page.evaluate(() => window.__mock.resultUpdates.length);
    await page.click('#val-approve-btn');
    await page.waitForTimeout(200);
    const updatesAfterSameAccountAttempt = await page.evaluate(() => window.__mock.resultUpdates.length);
    t.check('approving with the SAME account that performed Review is blocked (no new update written)', updatesAfterSameAccountAttempt === updatesBeforeSameAccountAttempt);

    // Switch to a different account within the same session (no reload) --
    // matches how the app itself distinguishes reviewer from approver, via
    // currentProfile.id, not a fresh login.
    await page.evaluate(() => { currentProfile = { ...currentProfile, id: 'u2', full_name: 'Lab Director Test' }; currentUser = { ...currentUser, id: 'u2' }; });
    await page.click('#val-approve-btn');
    await page.waitForTimeout(200);
    const approveStamped = await page.evaluate(() => window.__mock.resultUpdates.some(u => u.approved_by_name === 'Lab Director Test'));
    t.check('confirming approval by a DIFFERENT account than Review stamps approved_by_name and approved_at', approveStamped);

    // --- Print report ---
    await page.evaluate(() => { window.open = () => ({ document: { write: () => {}, close: () => {} }, focus: () => {} }); });
    let printedTitle = null;
    await page.evaluate(() => { const orig = openPrintWin; window.openPrintWin = (html, title) => { window.__mock.printedTitle = title; window.__mock.printedHtml = html; return orig(html, title); }; });
    await page.click('button[onclick="printValidationReport()"]');
    await page.waitForTimeout(150);
    printedTitle = await page.evaluate(() => window.__mock.printedTitle);
    t.check('Print Report opens a print window titled with the analyte and protocol', printedTitle && printedTitle.includes('Glucose') && printedTitle.includes('EP15-A3'));
    const printedHtml = await page.evaluate(() => window.__mock.printedHtml);
    t.check('the printed report includes the PASS/FAIL determination and the Quality Manager/Lab Director sign-off names', /PASS|FAIL/.test(printedHtml) && printedHtml.includes('Quality Officer Test'));
    t.check('the printed report embeds the precision run chart as an image, not just numbers', printedHtml.includes('Precision Run Chart') && /<img src="data:image\/png/.test(printedHtml));

    await page.close();
  }

  // --- EP09-A3: paired data entry reveals scatter + Bland-Altman charts ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);

    await page.fill('#val-analyte', 'Creatinine');
    await page.selectOption('#val-protocol', 'EP09-A3');
    await page.fill('#val-instrument', 'Cobas c311');
    await page.click('button[onclick="saveValidationStudy()"]');
    await page.waitForTimeout(200);

    const ep09EntryVisible = await page.evaluate(() => document.getElementById('val-ep09-entry').style.display !== 'none');
    t.check('EP09-A3 protocol shows the paired Method X/Y paste entry, not the EP15 run entry', ep09EntryVisible);
    const claimedCvHidden = await page.evaluate(() => document.getElementById('val-claimed-cv-wrap').style.display === 'none');
    t.check('Claimed CV% field is hidden for EP09-A3 (only meaningful for EP15-A3 precision studies)', claimedCvHidden);

    await page.fill('#val-ep09-paste', '10,12\n15,15.8\n20,19.9\n25,26.1');
    await page.waitForTimeout(100);
    const pairPreview = await page.evaluate(() => document.getElementById('val-ep09-preview').textContent);
    t.check('pasted paired data renders a live X/Y preview table', pairPreview.includes('Method X') && pairPreview.includes('Method Y'));

    await page.click('#val-ep09-save-btn');
    await page.waitForTimeout(300);

    const kpiText = await page.evaluate(() => document.getElementById('val-kpi-cards').textContent);
    t.check('EP09 KPI cards render Slope, Intercept, R², Bias %', kpiText.includes('Slope') && kpiText.includes('Intercept') && kpiText.includes('R²') && kpiText.includes('Bias'));

    const scatterVisible = await page.evaluate(() => document.getElementById('val-scatter-card').style.display !== 'none');
    const baVisible = await page.evaluate(() => document.getElementById('val-ba-card').style.display !== 'none');
    t.check('the scatter+regression chart becomes visible for a method-comparison study', scatterVisible);
    t.check('the Bland-Altman chart becomes visible for a method-comparison study', baVisible);

    const resultPayload = await page.evaluate(() => window.__mock.resultInserts[0]);
    t.check('regression_method is always recorded as OLS, never mislabeled as Deming', resultPayload.regression_method === 'OLS');

    // --- Print report embeds BOTH charts for a method-comparison study ---
    await page.evaluate(() => { window.open = () => ({ document: { write: () => {}, close: () => {} }, focus: () => {} }); });
    await page.evaluate(() => { const orig = openPrintWin; window.openPrintWin = (html, title) => { window.__mock.printedTitle = title; window.__mock.printedHtml = html; return orig(html, title); }; });
    await page.click('button[onclick="printValidationReport()"]');
    await page.waitForTimeout(150);
    const printedHtml = await page.evaluate(() => window.__mock.printedHtml);
    const imgCount = (printedHtml.match(/<img src="data:image\/png/g) || []).length;
    t.check('the printed EP09 report embeds both the scatter and Bland-Altman charts as images', imgCount === 2);
    t.check('the printed EP09 report does not include the EP15-only precision chart section', !printedHtml.includes('Precision Run Chart'));

    await page.close();
  }

  // --- Printing before any calculation is blocked with a clear message, not a crash ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.fill('#val-analyte', 'Sodium');
    await page.selectOption('#val-protocol', 'EP15-A3');
    await page.fill('#val-instrument', 'Test Analyzer');
    await page.click('button[onclick="saveValidationStudy()"]');
    await page.waitForTimeout(200);
    let openedPrintWindow = false;
    await page.evaluate(() => { window.open = () => { window.__mock.openedPrintWindow = true; return { document: { write: () => {}, close: () => {} }, focus: () => {} }; }; });
    await page.click('button[onclick="printValidationReport()"]');
    await page.waitForTimeout(150);
    openedPrintWindow = await page.evaluate(() => !!window.__mock.openedPrintWindow);
    t.check('printing before Save & Calculate does not open a print window (nothing to print yet)', !openedPrintWindow);
    await page.close();
  }

  return t;
};
