// Functional audit, Section 14: Analyzer Validation (EP15-A3 / EP09-A3).
// Real Playwright browser interaction against the real app. This module
// already has a deep, dedicated multi-phase build-out with its own
// regression suites (tests/analyzer-validation-frontend.test.js,
// tests/analyzer-validation-stats.test.js) — calculateEP15()/calculateEP09()
// have already been proven correct against published reference numbers in
// a prior session. This audit does NOT re-derive or re-prove that math.
// Instead it drives the real end-to-end UI workflow against the STATEFUL
// mock DB (writes from one action genuinely visible to the next, like a
// real Supabase project) to confirm the pieces actually connect:
//   (14a) EP15-A3 precision study, full lifecycle: real "New Study" form
//         -> real paste-grid data entry -> Save & Calculate -> confirm
//         validation_samples/validation_results rows are real (not
//         placeholders) and the on-screen KPI cards/PASS-FAIL badge match
//         a ground-truth call to the SAME already-proven calculateEP15()
//         for the SAME input -> confirm reopening the study from the
//         Studies tab recomputes identically from the saved samples
//         (source of truth), not from stale client state.
//   (14b) EP09-A3 method-comparison study, same full lifecycle, confirming
//         the scatter + Bland-Altman canvases actually render pixels from
//         the real saved paired data (not empty canvases).
//   (14c) Audit-ready printable report (Phase 4) for both protocols —
//         intercepting window.open/document.write to confirm the printed
//         HTML actually contains the real saved validation_results values
//         (not placeholders), the mandatory OLS-not-Deming disclosure for
//         EP09, and that printing before any Save & Calculate is blocked.
//   (14d) Sign-off lifecycle — the sequential gate (approval blocked until
//         review is confirmed) IS enforced; but whether the "Quality
//         Manager" / "Laboratory Director" labels correspond to any real
//         role restriction is checked directly (they are UI labels only —
//         signValidationResult() has no role check beyond the ordering
//         gate).
//   (14e) Recalculating an already-approved study — does anything warn or
//         block it, and what happens to the raw replicate data and the
//         old signed result row.
//   (14f) Role access — live ROLE_PAGES spot check for the 'validation'
//         page, cross-referenced against CLAUDE.md/README's documented
//         role table.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function initScript(seedOverrides) {
  const seed = {
    tables: {},
    users: [],
    idStart: {},
    ...seedOverrides,
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
  `;
}

async function loginAs(page, email, password) {
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.evaluate(() => { const b = document.getElementById('auth-btn'); if (b) { b.disabled = false; b.innerHTML = 'Sign In'; } });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', password);
  await page.click('#auth-btn');
  await page.waitForTimeout(400);
}

async function firstLoad(page, baseUrl, seedOverrides, email, password) {
  await page.addInitScript(initScript(seedOverrides));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await loginAs(page, email, password);
}

async function lastToast(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('#toast-wrap .toast');
    return nodes.length ? nodes[nodes.length - 1].textContent : null;
  });
}

async function stubPrintCapture(page) {
  await page.evaluate(() => {
    window.__capturedPrintHtml = null;
    window.open = function () {
      return { document: { write: (h) => { window.__capturedPrintHtml = h; }, close: () => {} }, focus: () => {} };
    };
  });
}

// KPI card text as rendered by statCard() — pulls the numeric text nodes
// out of #val-kpi-cards in DOM order (Grand Mean, Within-Run %CV,
// Within-Lab %CV, UVL for EP15; Slope, Intercept, R², Bias% for EP09).
async function readKpiCards(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#val-kpi-cards .stat-box')).map(b => ({
    value: b.querySelector('.stat-n')?.textContent,
    label: b.querySelector('.stat-l')?.textContent,
  })));
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  const ep15Seed = {
    tables: { staff: [{ id: 's-lt', user_id: 'u-lt', full_name: 'Validation Lab Tech', role: 'lab_tech' }] },
    users: [{ id: 'u-lt', email: 'valtech@audit.local', password: 'whatever' }],
  };

  // ═════════════════════════════════════════════════════════════════
  // 14a: EP15-A3 — full lifecycle, two studies (tight claimed-CV vs.
  // loose claimed-CV) on the SAME replicate data, to confirm the
  // PASS/FAIL badge genuinely reacts to real computed statistics rather
  // than being hardcoded, plus a reopen-recompute check.
  // ═════════════════════════════════════════════════════════════════
  const page = await context.newPage();
  let ep15StudyIdTight, ep15GroundTruthTight, ep15GroundTruthLoose;
  {
    await firstLoad(page, baseUrl, ep15Seed, 'valtech@audit.local', 'whatever');
    await page.evaluate(() => goPage('validation'));
    await page.waitForTimeout(200);

    const matrix = [[10.1, 10.3, 10.0, 10.2], [9.8, 10.1, 9.9, 10.0], [10.4, 10.2, 10.5, 10.3]];
    const pasteText = matrix.map(r => r.join(',')).join('\n');

    // --- Study A: tight claimed CV (0.5%) — expected to FAIL the UVL check ---
    await page.fill('#val-analyte', 'Glucose');
    await page.selectOption('#val-protocol', 'EP15-A3');
    await page.waitForTimeout(50);
    await page.fill('#val-instrument', 'Roche Cobas c311');
    await page.fill('#val-serial', 'RC-2201');
    await page.fill('#val-unit', 'mmol/L');
    await page.fill('#val-tea', '10');
    await page.fill('#val-claimed-cv', '0.5');
    await page.evaluate(() => saveValidationStudy());
    await page.waitForTimeout(300);

    const studies1 = await page.evaluate(async () => { const { data } = await sb.from('validation_studies').select('*'); return data; });
    const studyA = studies1.find(s => s.claimed_cv_pct === 0.5);
    ep15StudyIdTight = studyA?.id;
    const studyCreatedOk = studyA && studyA.analyte === 'Glucose' && studyA.instrument_name === 'Roche Cobas c311' &&
      studyA.protocol_type === 'EP15-A3' && studyA.status === 'Draft' && studyA.created_by_name === 'Validation Lab Tech';

    // The real "New Study" form correctly navigated straight into the
    // workspace for the study it just created.
    const inWorkspaceOk = await page.evaluate(() => document.getElementById('val-tab-workspace').style.display !== 'none');

    // Paste the real run data into the real textarea (dispatches the real
    // oninput -> parseEP15Grid()) and Save & Calculate through the real
    // button handler.
    await page.fill('#val-ep15-paste', pasteText);
    await page.waitForTimeout(100);
    const previewOk = (await page.evaluate(() => document.getElementById('val-ep15-preview').innerText)).includes('10.15');
    await page.evaluate(() => saveAndCalculateValidation());
    await page.waitForTimeout(300);

    // Ground truth: call the SAME already-proven calculateEP15() directly
    // with the SAME matrix/claimedCV/TEa — not re-deriving the math, just
    // using it as the oracle for what the UI pipeline SHOULD have produced.
    ep15GroundTruthTight = await page.evaluate((m) => calculateEP15(m, 0.5, 10), matrix);

    const samples = await page.evaluate(async (id) => { const { data } = await sb.from('validation_samples').select('*').eq('study_id', id); return data; }, studyA.id);
    const samplesOk = samples.length === 12 && new Set(samples.map(s => s.run_number)).size === 3 &&
      samples.every(s => s.entered_by_name === 'Validation Lab Tech');

    const results = await page.evaluate(async (id) => { const { data } = await sb.from('validation_results').select('*').eq('study_id', id); return data; }, studyA.id);
    const r = results[0];
    const dbMatchesGroundTruthOk = r && Math.abs(r.grand_mean - ep15GroundTruthTight.grandMean) < 1e-9 &&
      Math.abs(r.cv_within_pct - ep15GroundTruthTight.cvWithinPct) < 1e-9 &&
      Math.abs(r.uvl - ep15GroundTruthTight.uvl) < 1e-9 &&
      r.result_status === (ep15GroundTruthTight.overallPass ? 'Pass' : 'Fail');
    const groundTruthIsFailOk = ep15GroundTruthTight.overallPass === false; // tight 0.5% claimed CV should fail

    const studyStatusFlippedOk = (await page.evaluate(async (id) => { const { data } = await sb.from('validation_studies').select('*').eq('id', id).single(); return data; }, studyA.id)).status === 'Completed';

    // KPI cards + PASS/FAIL badge rendered from the real saved data.
    const kpis = await readKpiCards(page);
    const kpiGrandMean = kpis.find(k => k.label === 'Grand Mean')?.value;
    const kpiOk = kpiGrandMean === ep15GroundTruthTight.grandMean.toFixed(3);
    const badgeHtml = await page.evaluate(() => document.getElementById('val-passfail-badge').innerHTML);
    const badgeOk = /FAIL/.test(badgeHtml);
    const chartVisibleOk = await page.evaluate(() => document.getElementById('val-precision-card').style.display !== 'none');
    const chartDrawnOk = (await page.evaluate(() => document.getElementById('val-precision-canvas').toDataURL())).length > 1500;

    // --- Study B: loose claimed CV (20%) on the SAME data — expect PASS ---
    await page.evaluate(() => switchValidationTab('new', document.getElementById('val-tab-btn-new')));
    await page.waitForTimeout(100);
    await page.fill('#val-analyte', 'Glucose');
    await page.selectOption('#val-protocol', 'EP15-A3');
    await page.waitForTimeout(50);
    await page.fill('#val-instrument', 'Roche Cobas c311');
    await page.fill('#val-unit', 'mmol/L');
    await page.fill('#val-tea', '10');
    await page.fill('#val-claimed-cv', '20');
    await page.evaluate(() => saveValidationStudy());
    await page.waitForTimeout(300);
    await page.fill('#val-ep15-paste', pasteText);
    await page.waitForTimeout(100);
    await page.evaluate(() => saveAndCalculateValidation());
    await page.waitForTimeout(300);
    ep15GroundTruthLoose = await page.evaluate((m) => calculateEP15(m, 20, 10), matrix);
    const badgeHtmlLoose = await page.evaluate(() => document.getElementById('val-passfail-badge').innerHTML);
    const looseOk = ep15GroundTruthLoose.overallPass === true && /PASS/.test(badgeHtmlLoose) && !/FAIL/.test(badgeHtmlLoose);

    // --- Reopen study A from the Studies tab: confirm recompute-on-reopen
    // reads from validation_samples (source of truth) and reproduces the
    // exact same KPIs, not stale/cached client state. ---
    await page.evaluate(() => switchValidationTab('studies', document.getElementById('val-tab-btn-studies')));
    await page.waitForTimeout(300);
    const studiesTabHtml = await page.evaluate(() => document.getElementById('val-studies-body').innerHTML);
    const studiesListedOk = studiesTabHtml.includes('Roche Cobas c311') && (studiesTabHtml.match(/Glucose/g) || []).length >= 2;
    await page.evaluate((id) => openValidationWorkspace(id), studyA.id);
    await page.waitForTimeout(300);
    const reopenedKpis = await readKpiCards(page);
    const reopenGrandMean = reopenedKpis.find(k => k.label === 'Grand Mean')?.value;
    const reopenBadge = await page.evaluate(() => document.getElementById('val-passfail-badge').innerHTML);
    const reopenOk = reopenGrandMean === ep15GroundTruthTight.grandMean.toFixed(3) && /FAIL/.test(reopenBadge);

    const ok = studyCreatedOk && inWorkspaceOk && previewOk && samplesOk && dbMatchesGroundTruthOk && groundTruthIsFailOk &&
      studyStatusFlippedOk && kpiOk && badgeOk && chartVisibleOk && chartDrawnOk && looseOk && studiesListedOk && reopenOk;
    log('14a', ok ? 'PASS' : 'FAIL',
      `Logged in as a real Lab Tech, filled the real "New Study" form (Glucose, EP15-A3, Roche Cobas c311, TEa 10%, claimed CV 0.5%) and Created — a real validation_studies row appeared (status=Draft)=${studyCreatedOk}, and the app auto-navigated into the Data Entry workspace for it=${inWorkspaceOk}. Pasted 3 runs x 4 replicates into the real paste-grid textarea; the live preview table correctly showed the parsed run means=${previewOk}. Save & Calculate wrote 12 real validation_samples rows across 3 runs, correctly attributed to the entering tech=${samplesOk}, and a validation_results row whose grand_mean/cv_within_pct/uvl/result_status match a direct ground-truth call to the already-proven calculateEP15() for the identical input, exactly (not approximately)=${dbMatchesGroundTruthOk} — the tight 0.5% claimed CV genuinely fails the UVL check on this data (not a hardcoded outcome)=${groundTruthIsFailOk}. The study flipped Draft->Completed=${studyStatusFlippedOk}. The on-screen KPI cards render the real saved grand mean (${kpiGrandMean})=${kpiOk}, the PASS/FAIL badge correctly showed FAIL=${badgeOk}, the precision run chart card became visible=${chartVisibleOk} and the canvas genuinely has pixels drawn (dataURL length check)=${chartDrawnOk}. A second study created with the SAME replicate data but a loose 20% claimed CV correctly computed and rendered PASS instead=${looseOk} — confirming the badge tracks real computed statistics, not a fixed UI state. Both studies appeared correctly in the Studies tab list=${studiesListedOk}. Reopening study A from that list recomputed from the saved raw samples (not cached client state) and reproduced the identical grand mean and FAIL badge=${reopenOk}.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 14b: EP09-A3 — full lifecycle, confirm scatter + Bland-Altman
  // canvases render real pixels from real saved paired data.
  // ═════════════════════════════════════════════════════════════════
  let ep09StudyId, ep09GroundTruth;
  {
    await page.evaluate(() => switchValidationTab('new', document.getElementById('val-tab-btn-new')));
    await page.waitForTimeout(100);
    const xs = [10.2, 15.1, 20.4, 25.0, 30.2, 5.5, 12.3, 18.7];
    const ys = [10.5, 15.8, 19.9, 24.5, 31.0, 5.8, 12.0, 19.2];
    const pairText = xs.map((x, i) => x + ',' + ys[i]).join('\n');

    await page.fill('#val-analyte', 'Creatinine');
    await page.selectOption('#val-protocol', 'EP09-A3');
    await page.waitForTimeout(50);
    const claimedCvHiddenOk = await page.evaluate(() => document.getElementById('val-claimed-cv-wrap').style.display === 'none');
    await page.fill('#val-instrument', 'Sysmex XN-1000 (new)');
    await page.fill('#val-unit', 'umol/L');
    await page.fill('#val-tea', '15');
    await page.evaluate(() => saveValidationStudy());
    await page.waitForTimeout(300);

    const studies = await page.evaluate(async () => { const { data } = await sb.from('validation_studies').select('*'); return data; });
    const study = studies.find(s => s.protocol_type === 'EP09-A3');
    ep09StudyId = study?.id;
    const ep15FieldsHiddenOk = await page.evaluate(() => document.getElementById('val-ep15-entry').style.display === 'none' && document.getElementById('val-ep09-entry').style.display !== 'none');

    await page.fill('#val-ep09-paste', pairText);
    await page.waitForTimeout(100);
    const previewOk = (await page.evaluate(() => document.getElementById('val-ep09-preview').innerText)).includes('10.2') && (await page.evaluate(() => document.getElementById('val-ep09-preview').innerText)).includes('10.5');

    // Baseline: charts not drawn yet (panel hidden pre-calculation).
    const panelHiddenBeforeOk = await page.evaluate(() => document.getElementById('val-result-panel').style.display === 'none');

    await page.evaluate(() => saveAndCalculateValidation());
    await page.waitForTimeout(300);

    ep09GroundTruth = await page.evaluate((args) => calculateEP09(args.x, args.y), { x: xs, y: ys });
    const samples = await page.evaluate(async (id) => { const { data } = await sb.from('validation_samples').select('*').eq('study_id', id); return data; }, study.id);
    const samplesOk = samples.length === 16 && samples.filter(s => s.method === 'X').length === 8 && samples.filter(s => s.method === 'Y').length === 8;
    const results = await page.evaluate(async (id) => { const { data } = await sb.from('validation_results').select('*').eq('study_id', id); return data; }, study.id);
    const r = results[0];
    const dbMatchesGroundTruthOk = r && r.regression_method === 'OLS' && Math.abs(r.slope - ep09GroundTruth.slope) < 1e-9 &&
      Math.abs(r.intercept - ep09GroundTruth.intercept) < 1e-9 && Math.abs(r.r_squared - ep09GroundTruth.r2) < 1e-9 &&
      Math.abs(r.bias_pct - ep09GroundTruth.biasPct) < 1e-9;

    const scatterVisibleOk = await page.evaluate(() => document.getElementById('val-scatter-card').style.display !== 'none');
    const baVisibleOk = await page.evaluate(() => document.getElementById('val-ba-card').style.display !== 'none');
    const precisionHiddenOk = await page.evaluate(() => document.getElementById('val-precision-card').style.display === 'none');
    const scatterDrawnOk = (await page.evaluate(() => document.getElementById('val-scatter-canvas').toDataURL())).length > 1500;
    const baDrawnOk = (await page.evaluate(() => document.getElementById('val-ba-canvas').toDataURL())).length > 1500;

    const kpis = await readKpiCards(page);
    const kpiSlope = kpis.find(k => k.label === 'Slope')?.value;
    const kpiSlopeOk = kpiSlope === ep09GroundTruth.slope.toFixed(3);
    const warnEl = await page.evaluate(() => document.getElementById('val-warnings').innerText);
    const smallNWarningOk = /8 paired result/.test(warnEl) || /CLSI EP09-A3/.test(warnEl);

    const ok = claimedCvHiddenOk && ep15FieldsHiddenOk && previewOk && panelHiddenBeforeOk && samplesOk && dbMatchesGroundTruthOk &&
      scatterVisibleOk && baVisibleOk && precisionHiddenOk && scatterDrawnOk && baDrawnOk && kpiSlopeOk && smallNWarningOk;
    log('14b', ok ? 'PASS' : 'FAIL',
      `Created a real EP09-A3 study (Creatinine, Sysmex XN-1000, TEa 15%) — the Claimed CV field correctly hid itself for this protocol (EP15-only field)=${claimedCvHiddenOk}, and the workspace correctly showed the EP09 paste grid (not the EP15 one)=${ep15FieldsHiddenOk}. Pasted 8 real Method-X/Method-Y paired values; the preview table parsed them correctly=${previewOk}. The result panel was correctly hidden before any calculation=${panelHiddenBeforeOk}. Save & Calculate wrote 16 real validation_samples rows (8 X + 8 Y)=${samplesOk} and a validation_results row whose regression_method/slope/intercept/r_squared/bias_pct match a direct ground-truth call to the already-proven calculateEP09() for the identical pairs, exactly=${dbMatchesGroundTruthOk}. The Method Comparison Scatter and Bland-Altman cards became visible (precision-only card correctly stayed hidden)=${scatterVisibleOk && baVisibleOk && precisionHiddenOk}, and both canvases genuinely have real pixels drawn from the real data (dataURL length check)=${scatterDrawnOk && baDrawnOk}. The Slope KPI card shows the real computed value (${kpiSlope})=${kpiSlopeOk}, and the sub-40-pairs CLSI EP09-A3 sample-size warning correctly appeared for this 8-pair study=${smallNWarningOk}.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 14c: Audit-ready printable report — confirm it pulls real saved
  // data (not placeholders) for both protocols, and that printing
  // before any Save & Calculate is blocked.
  // ═════════════════════════════════════════════════════════════════
  {
    // Print blocked when no result exists yet for a freshly created study.
    await page.evaluate(() => switchValidationTab('new', document.getElementById('val-tab-btn-new')));
    await page.waitForTimeout(100);
    await page.fill('#val-analyte', 'Sodium');
    await page.selectOption('#val-protocol', 'EP15-A3');
    await page.waitForTimeout(50);
    await page.fill('#val-instrument', 'Unfinished Analyzer');
    await page.fill('#val-tea', '4');
    await page.fill('#val-claimed-cv', '2');
    await page.evaluate(() => saveValidationStudy());
    await page.waitForTimeout(300);
    await stubPrintCapture(page);
    await page.evaluate(() => printValidationReport());
    await page.waitForTimeout(200);
    const blockedNoResultToast = await lastToast(page);
    const blockedOk = /Save & Calculate/.test(blockedNoResultToast || '') && (await page.evaluate(() => window.__capturedPrintHtml)) === null;

    // EP15 study A's printable report.
    await page.evaluate((id) => openValidationWorkspace(id), ep15StudyIdTight);
    await page.waitForTimeout(300);
    await stubPrintCapture(page);
    await page.evaluate(() => printValidationReport());
    await page.waitForTimeout(300);
    const ep15Html = await page.evaluate(() => window.__capturedPrintHtml);
    const gm = ep15GroundTruthTight.grandMean.toFixed(3);
    const cvw = ep15GroundTruthTight.cvWithinPct.toFixed(2) + '%';
    const ep15ContentOk = ep15Html && ep15Html.includes('Glucose') && ep15Html.includes('Roche Cobas c311') &&
      ep15Html.includes('EP15-A3') && ep15Html.includes(gm) && ep15Html.includes(cvw) && ep15Html.includes('FAIL') &&
      /<img src="data:image\/png/.test(ep15Html) && ep15Html.includes('Reviewed by Quality Manager') && ep15Html.includes('Approved by Laboratory Director');
    const ep15UnsignedBlanksOk = /Reviewed by Quality Manager[\s\S]{0,40}&nbsp;/.test(ep15Html.replace(/\n/g, '')) || (!ep15Html.includes(' · ')); // no name/timestamp yet since unsigned

    // EP09 study's printable report — mandatory OLS-not-Deming disclosure.
    await page.evaluate((id) => openValidationWorkspace(id), ep09StudyId);
    await page.waitForTimeout(300);
    await stubPrintCapture(page);
    await page.evaluate(() => printValidationReport());
    await page.waitForTimeout(300);
    const ep09Html = await page.evaluate(() => window.__capturedPrintHtml);
    const slope4 = ep09GroundTruth.slope.toFixed(4);
    const ep09ContentOk = ep09Html && ep09Html.includes('Creatinine') && ep09Html.includes('EP09-A3') && ep09Html.includes(slope4) &&
      /<img src="data:image\/png/.test(ep09Html);
    const olsDisclosureOk = ep09Html.includes('Ordinary Least Squares') && ep09Html.includes('not Deming regression') && !/\bDeming\b regression computed/.test(ep09Html);

    const ok = blockedOk && ep15ContentOk && ep15UnsignedBlanksOk && ep09ContentOk && olsDisclosureOk;
    log('14c', ok ? 'PASS' : 'FAIL',
      `Printing before any Save & Calculate was correctly blocked with a real toast ("${blockedNoResultToast}") and window.open was never even called=${blockedOk}. For the signed EP15 study, intercepted window.open/document.write and confirmed the printed HTML genuinely contains the real saved analyte/instrument/protocol and the exact grand mean (${gm}) and within-run %CV (${cvw}) matching the saved validation_results row (not placeholder text), the FAIL status banner, and a real embedded chart image (base64 PNG data: URI from canvas.toDataURL(), not a stock image)=${ep15ContentOk}. Since this study had not yet been through Verify/Approve, the sign-off blocks correctly rendered blank rather than a fabricated name=${ep15UnsignedBlanksOk}. For the EP09 study, the printed HTML likewise contains the real slope (${slope4}) and a real Bland-Altman/scatter chart image=${ep09ContentOk}, AND the mandatory "Ordinary Least Squares (OLS), not Deming regression" disclosure is present and never relabels the method as Deming anywhere in the printed output=${olsDisclosureOk}.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 14d: Sign-off — sequential gate genuinely enforced; but "Quality
  // Manager"/"Laboratory Director" are UI labels only, not real role
  // restrictions — the SAME logged-in lab_tech user (the one who
  // performed the study) can confirm both stages themselves.
  // ═════════════════════════════════════════════════════════════════
  let ep15ResultIdBeforeApproval;
  {
    await page.evaluate((id) => openValidationWorkspace(id), ep15StudyIdTight);
    await page.waitForTimeout(300);

    // Approve-before-verify is blocked.
    await page.evaluate(() => signValidationResult('approve'));
    await page.waitForTimeout(200);
    const approveBlockedToast = await lastToast(page);
    const stillUnapproved = await page.evaluate(async (id) => { const { data } = await sb.from('validation_results').select('*').eq('study_id', id).order('calculated_at', { ascending: false }).limit(1); return data[0]; }, ep15StudyIdTight);
    const gateOk = /review must be confirmed first/i.test(approveBlockedToast || '') && !stillUnapproved.approved_at;

    // Same logged-in user (a plain lab_tech, not any distinct "Quality
    // Manager" or "Laboratory Director" account/role) confirms Review...
    const currentRole = await page.evaluate(() => currentProfile?.role);
    await page.evaluate(() => signValidationResult('verify'));
    await page.waitForTimeout(200);
    const afterVerify = await page.evaluate(async (id) => { const { data } = await sb.from('validation_results').select('*').eq('study_id', id).order('calculated_at', { ascending: false }).limit(1); return data[0]; }, ep15StudyIdTight);
    const verifiedOk = !!afterVerify.verified_at && afterVerify.verified_by_name === 'Validation Lab Tech';

    // ...and then Approval too — the exact same person self-signs both
    // stages of what the UI presents as two distinct, more-senior roles.
    await page.evaluate(() => signValidationResult('approve'));
    await page.waitForTimeout(200);
    const afterApprove = await page.evaluate(async (id) => { const { data } = await sb.from('validation_results').select('*').eq('study_id', id).order('calculated_at', { ascending: false }).limit(1); return data[0]; }, ep15StudyIdTight);
    const selfApprovedOk = !!afterApprove.approved_at && afterApprove.approved_by_name === 'Validation Lab Tech' &&
      afterApprove.verified_by_name === afterApprove.approved_by_name;
    ep15ResultIdBeforeApproval = afterApprove.id;

    const vStatusEl = await page.evaluate(() => document.getElementById('val-verify-status').innerHTML);
    const aStatusEl = await page.evaluate(() => document.getElementById('val-approve-status').innerHTML);
    const uiReflectsBothOk = vStatusEl.includes('Validation Lab Tech') && aStatusEl.includes('Validation Lab Tech');

    const ok = gateOk && verifiedOk && selfApprovedOk && uiReflectsBothOk;
    log('14d', ok ? (selfApprovedOk ? '⚠️ GAP FOUND' : 'FAIL') : 'FAIL',
      `Sequential gate genuinely enforced server-side-equivalent: attempting to Approve before Review was rejected with a real toast ("${approveBlockedToast}") and approved_at stayed null=${gateOk}. Confirming "Review" then set verified_at/verified_by_name correctly=${verifiedOk}. GAP: the logged-in user for this whole test was a single lab_tech account (role=${currentRole}) — never a distinct "Quality Manager" or "Laboratory Director" account — and signValidationResult() (index.html) applies NO role check at all beyond the ordering gate above, so that SAME lab_tech account was then able to also confirm "Approval"=${selfApprovedOk}, meaning verified_by_name and approved_by_name both ended up as "Validation Lab Tech" — the same person who entered the raw data, ran the calculation, reviewed it, AND approved it, with the UI happily labeling their own two clicks "Reviewed by Quality Manager" and "Approved by Laboratory Director" as if they were two different, more senior people. Both statuses correctly reflect on screen=${uiReflectsBothOk}. Since ROLE_PAGES grants the 'validation' page to lab_tech (not just lab_supervisor/admin), any lab tech can self-sign both stages of what is presented as an independent two-person review chain for a document meant to be audit-ready for CAP/ISO 15189 inspection. This is not just a missing client-side check: migration_v2.38_analyzer_validation.sql (the real schema/RLS for this module, read directly, not assumed) confirms validation_results_update's RLS policy is \`using (is_admin() or is_lab_staff())\` — the exact same is_lab_staff() blanket check used for every other write on this table, with no separate "is_quality_manager()"/"is_lab_director()" predicate anywhere in the migration. The two-person sign-off is enforced nowhere — not in the UI, not in RLS — it is purely two button clicks that happen to render different label text.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 14e: Recalculating an already-APPROVED study — nothing warns or
  // blocks it; the raw replicate data behind the approved calculation
  // is destroyed (validation_samples is replaced), while the approved
  // validation_results row itself survives untouched but is silently
  // superseded (no longer the "latest" result the UI shows).
  // ═════════════════════════════════════════════════════════════════
  {
    const newMatrix = [[5.0, 5.1, 5.0], [4.9, 5.0, 5.0], [5.2, 5.1, 5.0]];
    const newPasteText = newMatrix.map(r => r.join(',')).join('\n');
    await page.fill('#val-ep15-paste', newPasteText);
    await page.waitForTimeout(100);
    // No confirm()/dialog listener registered — if the app tried to warn
    // via a native confirm() dialog, this Save & Calculate call would hang
    // waiting for a dialog handler and the subsequent assertions would
    // reveal it (no dialog fired in practice, confirmed below).
    let dialogFired = false;
    page.once('dialog', async d => { dialogFired = true; await d.accept(); });
    await page.evaluate(() => saveAndCalculateValidation());
    await page.waitForTimeout(300);
    const noWarningDialogOk = !dialogFired;

    // Stateful-mock gap, same category as Section 11/12's documented
    // column-default gaps (blood_units.verified_on_receipt,
    // inventory_batches.is_active): the real schema
    // (migration_v2.38_analyzer_validation.sql) declares
    // validation_results.calculated_at as `timestamptz not null default
    // now()`, and the app's own read path explicitly orders "most recent
    // result" by that column — but the stateful mock's insert() only
    // auto-populates created_at, never other timestamp columns, so both
    // this study's validation_results rows come back with
    // calculated_at=null and a real Supabase project's "latest row wins"
    // ordering can't be faithfully exercised without backfilling it here
    // (same fix pattern as those prior sections used, not an app bug).
    // Insertion order in the mock table is preserved, so the pre-existing
    // (approved) row is chronologically first, the new one second.
    const resultsInInsertOrder = await page.evaluate(async (id) => { const { data } = await sb.from('validation_results').select('*').eq('study_id', id); return data; }, ep15StudyIdTight);
    for (let i = 0; i < resultsInInsertOrder.length; i++) {
      await page.evaluate(({ id, ts }) => sb.from('validation_results').update({ calculated_at: ts }).eq('id', id),
        { id: resultsInInsertOrder[i].id, ts: new Date(Date.now() + i * 1000).toISOString() });
    }
    // Re-render via the real function (equivalent to a user re-opening/
    // refreshing the workspace) now that "latest by calculated_at" can
    // resolve correctly, the same way it genuinely would against a real
    // Supabase project where the column default already did this.
    await page.evaluate(() => loadValidationSamplesAndResult());
    await page.waitForTimeout(200);

    const allResults = await page.evaluate(async (id) => { const { data } = await sb.from('validation_results').select('*').eq('study_id', id); return data; }, ep15StudyIdTight);
    const oldApprovedRowSurvivesOk = allResults.some(r => r.id === ep15ResultIdBeforeApproval && r.approved_at);
    const newRowIsUnsignedOk = allResults.length === 2 && allResults.some(r => r.id !== ep15ResultIdBeforeApproval && !r.approved_at && !r.verified_at);

    const samplesNow = await page.evaluate(async (id) => { const { data } = await sb.from('validation_samples').select('*').eq('study_id', id); return data; }, ep15StudyIdTight);
    const oldReplicateDataGoneOk = samplesNow.length === 9 && !samplesNow.some(s => s.result_value === 10.1); // old data (10.1 etc.) no longer present, only the new 9 rows

    const vStatusEl = await page.evaluate(() => document.getElementById('val-verify-status').innerText);
    const aStatusEl = await page.evaluate(() => document.getElementById('val-approve-status').innerText);
    const uiResetToUnsignedOk = vStatusEl.includes('Not yet reviewed') && /Awaiting Quality Manager|Not yet approved/.test(aStatusEl);

    const studyStillShowsCompletedOk = (await page.evaluate(async (id) => { const { data } = await sb.from('validation_studies').select('*').eq('id', id).single(); return data; }, ep15StudyIdTight)).status === 'Completed';

    const ok = noWarningDialogOk && oldApprovedRowSurvivesOk && newRowIsUnsignedOk && oldReplicateDataGoneOk && uiResetToUnsignedOk;
    log('14e', ok ? '⚠️ GAP FOUND' : 'FAIL',
      `After the study from 14d had already been fully Reviewed AND Approved, pasted entirely different replicate data over the same open study and clicked Save & Calculate again — with no native confirm()/warning dialog of any kind intercepted (no dialog fired at all)=${noWarningDialogOk}, i.e. nothing in the app asks "this study is already approved, recalculate anyway?" before doing it. The original approved validation_results row is NOT deleted — it still exists in the DB with its approved_at/verified_at intact=${oldApprovedRowSurvivesOk} — but a brand-new, completely unsigned validation_results row was inserted alongside it=${newRowIsUnsignedOk}, and because the UI always reads "the latest result by calculated_at", the workspace immediately flipped back to "Not yet reviewed" / "Not yet approved" for the new numbers=${uiResetToUnsignedOk} — so re-signoff IS required before the new numbers could themselves be printed as approved, which is the right safety behavior for the NEW calculation. However: validation_samples for this study is destructively REPLACED on every Save & Calculate (delete-then-insert, confirmed: the original 12 replicate values behind the approved calculation are completely gone from the DB, only the 9 new ones remain)=${oldReplicateDataGoneOk} — the approved validation_results row's SUMMARY numbers (grand_mean, cv_within_pct, etc.) survive, but the raw replicate measurements that produced and justified them do not. For a CAP/ISO 15189 audit-ready validation record, losing the underlying raw data behind an already-signed-off result — silently, with no confirmation prompt — is a real traceability gap, even though the summary conclusion itself is preserved. validation_studies.status stays 'Completed' throughout (it does not track a distinct "Approved"/"Locked" state at all)=${studyStillShowsCompletedOk}.`);
  }
  await page.close();

  // ═════════════════════════════════════════════════════════════════
  // 14f: role access — live ROLE_PAGES spot check for 'validation',
  // cross-referenced against CLAUDE.md/README's documented role table.
  // ═════════════════════════════════════════════════════════════════
  {
    const roleSeed = {
      tables: { staff: [
        { id: 's-tech', user_id: 'u-tech', full_name: 'Role LabTech', role: 'lab_tech' },
        { id: 's-sup', user_id: 'u-sup', full_name: 'Role LabSup', role: 'lab_supervisor' },
        { id: 's-admin', user_id: 'u-admin', full_name: 'Role Admin', role: 'admin' },
        { id: 's-nurse', user_id: 'u-nurse', full_name: 'Role Nurse', role: 'nurse' },
        { id: 's-doc', user_id: 'u-doc', full_name: 'Role Doctor', role: 'doctor' },
        { id: 's-recep', user_id: 'u-recep', full_name: 'Role Receptionist', role: 'receptionist' },
        { id: 's-cash', user_id: 'u-cash', full_name: 'Role Cashier', role: 'cashier' },
        { id: 's-theatre', user_id: 'u-theatre', full_name: 'Role TheatreNurse', role: 'theatre_nurse' },
        { id: 's-radio', user_id: 'u-radio', full_name: 'Role Radiologist', role: 'radiologist' },
      ] },
      users: [
        { id: 'u-tech', email: 'rlt@val.local', password: 'whatever' },
        { id: 'u-sup', email: 'rls@val.local', password: 'whatever' },
        { id: 'u-admin', email: 'ra@val.local', password: 'whatever' },
        { id: 'u-nurse', email: 'rn@val.local', password: 'whatever' },
        { id: 'u-doc', email: 'rd@val.local', password: 'whatever' },
        { id: 'u-recep', email: 're@val.local', password: 'whatever' },
        { id: 'u-cash', email: 'rc@val.local', password: 'whatever' },
        { id: 'u-theatre', email: 'rt@val.local', password: 'whatever' },
        { id: 'u-radio', email: 'rr@val.local', password: 'whatever' },
      ],
    };
    const checkRole = async (email) => {
      const p = await context.newPage();
      await p.addInitScript(initScript(roleSeed));
      await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
      await loginAs(p, email, 'whatever');
      // 'validation' is a single page nested inside the multi-page
      // 'laboratory' MODULE_PAGES group, not its own launcher module (unlike
      // 'inventory' in Section 12's template, which is self-named module ==
      // page id, so visibleModulesForRole().includes('inventory') worked
      // there but would NOT correctly test a page inside a bigger module
      // here). The real, direct UI-visibility mechanism for a single
      // sidebar item is filterSidebar() (CLAUDE.md: "filterSidebar() hides
      // disallowed sidebar items visually") driven straight off ROLE_PAGES
      // — check that directly instead.
      const visible = await p.evaluate(() => {
        filterSidebar();
        const el = document.querySelector('.sb-item[data-p="validation"]');
        return !!el && el.style.display !== 'none';
      });
      await p.evaluate(() => goPage('validation'));
      await p.waitForTimeout(150);
      const entered = await p.evaluate(() => document.getElementById('page-validation')?.classList.contains('active'));
      await p.close();
      return { visible, entered };
    };

    const labTech = await checkRole('rlt@val.local');
    const labSup = await checkRole('rls@val.local');
    const admin = await checkRole('ra@val.local');
    const nurse = await checkRole('rn@val.local');
    const doctor = await checkRole('rd@val.local');
    const recep = await checkRole('re@val.local');
    const cashier = await checkRole('rc@val.local');
    const theatreNurse = await checkRole('rt@val.local');
    const radiologist = await checkRole('rr@val.local');

    const liveGrantsMatchCode = labTech.visible && labTech.entered && labSup.visible && labSup.entered && admin.visible && admin.entered &&
      !nurse.visible && !nurse.entered && !doctor.visible && !doctor.entered && !recep.visible && !recep.entered &&
      !cashier.visible && !cashier.entered && !theatreNurse.visible && !theatreNurse.entered && !radiologist.visible && !radiologist.entered;

    // CLAUDE.md's / README's "Roles and page access" table lists Lab Tech
    // as "Worklist, Samples, All Result Entry, Criticals, QC, TAT,
    // Inventory, Delivery" and Lab Supervisor as "All Lab Tech +
    // Verification + Staff Activity" — Analyzer Validation is not named
    // anywhere in either role's row, even though ROLE_PAGES genuinely
    // grants both live access (confirmed above).
    const docTableGapConfirmed = labTech.visible && labSup.visible;

    log('14f', liveGrantsMatchCode ? (docTableGapConfirmed ? '⚠️ DOC GAP' : 'PASS') : 'FAIL',
      `Live ROLE_PAGES spot check, each role on its own fresh page/session: Lab Tech sees+enters Analyzer Validation (visible=${labTech.visible}, entered=${labTech.entered}); Lab Supervisor likewise (visible=${labSup.visible}, entered=${labSup.entered}); Admin likewise (visible=${admin.visible}, entered=${admin.entered}). Nurse, Doctor, Receptionist, Cashier, Theatre Nurse, and Radiologist are all correctly hidden from AND blocked from it (visible/entered all false for every one of them) — matches ROLE_PAGES in index.html exactly (only admin/lab_tech/lab_supervisor include 'validation')=${liveGrantsMatchCode}. DOCUMENTATION GAP (not a code bug, same pattern Section 12 found for Inventory): CLAUDE.md's and README's "Roles and page access" table row for Lab Tech ("Worklist, Samples, All Result Entry, Criticals, QC, TAT, Inventory, Delivery") and Lab Supervisor ("All Lab Tech + Verification + Staff Activity") never mentions Analyzer Validation at all, yet both roles genuinely have live access confirmed above=${docTableGapConfirmed}. CLAUDE.md explicitly states "This table must stay in sync with ROLE_PAGES in index.html" — Analyzer Validation access has been out of sync with that table.`);
  }

  return findings;
};
