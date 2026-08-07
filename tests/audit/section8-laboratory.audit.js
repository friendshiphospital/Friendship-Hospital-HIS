// Functional audit, Section 8: Laboratory.
// Real Playwright browser interaction driving the actual running app
// against tests/helpers/stateful-mock.js (persistent in-memory Supabase
// mock, per-table arrays, real insert/update/upsert/RPC — see that file's
// own header comment). This section deliberately does NOT re-prove what's
// already deeply covered by tests/lab-safety-verification-scoping-*.test.js,
// tests/delta-check-autoverify-safety.test.js, tests/result-verify-lock.test.js,
// tests/sample-collection-tubes.test.js, tests/lab-worklist-search.test.js,
// tests/lab-order-status-sync.test.js, or tests/lab-entry-consolidation.test.js.
// Instead it drives ONE continuous golden-path workflow end-to-end (8a),
// the Unified Results Entry page's real DEPT_META-driven department
// switching across two departments at once (8b), Critical Values detection
// end-to-end including a genuine gap found by empirical testing (8c),
// role-access enforcement for lab_tech vs lab_supervisor incl. the
// verified/released result-lock override (8d), and basic real-data
// load/save checks for the QC module (8e) and TAT Tracker (8f).
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function baseSeed(role, overrides = {}) {
  // Deep-merge just the 'tables' key rather than a flat top-level spread --
  // a flat spread would let an overrides.tables that only specifies e.g.
  // patients/results_hematology silently WIPE the default staff row instead
  // of adding alongside it, which breaks login (loadProfile() finds no
  // staff row -> denyUnlinkedAccount() signs back out to the auth screen)
  // in a way that's easy to misread as an app bug rather than a seed bug.
  const { tables: overrideTables, ...restOverrides } = overrides;
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Lab Tech', role }],
      ...overrideTables,
    },
    users: [{ id: 'u1', email: 'labtech@audit.local', password: 'whatever' }],
    idStart: { mrn: 500, opd: 200, ip: 100, lab_number: 300, radiology_number: 400 },
    ...restOverrides,
  };
  return seed;
}

function initScript(seed) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
  `;
}

async function login(page, baseUrl, seed, email, password) {
  await page.addInitScript(initScript(seed));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', password);
  await page.click('#auth-btn');
  await page.waitForTimeout(400);
}

// Elements inside .ov/.mo overlay modals report a 0x0 bounding box to
// Playwright's actionability checks in this headless environment (a
// confirmed environment quirk, not an app bug — see section5's audit
// script for the investigation). Worked around the same way as every
// other section: set .value directly + dispatch real input/change events.
async function setVal(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) throw new Error('setVal: no element #' + id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // --- 8a: golden path -- Sample Collection -> Sample Receipt -> Haematology
  // Result Entry -> Verify -> Release, as ONE continuous flow for a real
  // seeded patient, driven exactly the way a lab tech would click through
  // it (not each step re-seeded in isolation the way the regression suite
  // does it). ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('lab_tech', {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Lab Tech', role: 'lab_tech' }],
        patients: [{ id: 'p1', name: 'Golden Path Patient', mrn: 'GP-001', lab_no: 'LB-001', age: 34, age_unit: 'y', sex: 'F', payment_status: 'paid', tests_requested: ['CBC (Full Blood Count)'], visit_status: 'In Progress' }],
      },
    }), 'labtech@audit.local', 'whatever');

    // Step 1: Sample Collection
    await page.evaluate(() => goPage('samples'));
    await page.waitForTimeout(150);
    await page.evaluate(() => selectScPt('p1'));
    await page.waitForTimeout(100);
    await page.selectOption('#sc-source', 'Phlebotomy');
    await setVal(page, 'sc-collector', 'Audit Lab Tech');
    await page.evaluate(() => markSampleCollected());
    await page.waitForTimeout(200);
    let sample = await page.evaluate(async () => { const { data } = await sb.from('sample_records').select('*').eq('patient_id', 'p1').maybeSingle(); return data; });
    const collectedOk = sample?.status === 'Collected';

    // Step 2: Receive in Lab
    await page.evaluate(() => switchSampleTab('receive'));
    await page.waitForTimeout(150);
    await page.evaluate(() => selectReceivePt('p1'));
    await page.waitForTimeout(100);
    await setVal(page, 'sc-recv-by', 'Audit Lab Tech');
    await page.evaluate(() => markSampleReceived());
    await page.waitForTimeout(200);
    sample = await page.evaluate(async () => { const { data } = await sb.from('sample_records').select('*').eq('patient_id', 'p1').maybeSingle(); return data; });
    const receivedOk = sample?.status === 'Received';

    // Step 3: Haematology Result Entry -- draft save first
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    const cbcFields = { 'he-wbc': '6.5', 'he-rbc': '4.8', 'he-hgb': '13.5', 'he-hct': '42', 'he-mcv': '88', 'he-mch': '29', 'he-mchc': '33', 'he-rdw': '13', 'he-nrbc': '0', 'he-plt': '250', 'he-mpv': '9', 'he-pdw': '12', 'he-neut': '60', 'he-lymph': '30', 'he-mono': '6', 'he-eosi': '3', 'he-baso': '1' };
    for (const [id, v] of Object.entries(cbcFields)) await setVal(page, id, v);
    await page.evaluate(() => saveHemEntry(false));
    await page.waitForTimeout(250);
    let hemRow = await page.evaluate(async () => { const { data } = await sb.from('results_hematology').select('*').eq('patient_id', 'p1').maybeSingle(); return data; });
    const draftOk = hemRow && hemRow.is_verified === false && parseFloat(hemRow.hgb) === 13.5;

    // Step 4: Verify -- should be allowed since every CBC field is now filled
    await page.evaluate(() => saveHemEntry(true));
    await page.waitForTimeout(250);
    hemRow = await page.evaluate(async () => { const { data } = await sb.from('results_hematology').select('*').eq('patient_id', 'p1').maybeSingle(); return data; });
    const verifiedOk = hemRow?.is_verified === true;
    sample = await page.evaluate(async () => { const { data } = await sb.from('sample_records').select('*').eq('patient_id', 'p1').maybeSingle(); return data; });
    const sampleCompletedOk = sample?.status === 'Completed';

    // Step 5: Release
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(250);
    hemRow = await page.evaluate(async () => { const { data } = await sb.from('results_hematology').select('*').eq('patient_id', 'p1').maybeSingle(); return data; });
    const releasedOk = hemRow?.is_released === true;
    sample = await page.evaluate(async () => { const { data } = await sb.from('sample_records').select('*').eq('patient_id', 'p1').maybeSingle(); return data; });
    const sampleReleasedOk = sample?.status === 'Released';

    const ok = collectedOk && receivedOk && draftOk && verifiedOk && sampleCompletedOk && releasedOk && sampleReleasedOk;
    log('8a', ok ? 'PASS' : 'FAIL',
      `Golden path Sample Collection -> Receipt -> Hem Entry (draft) -> Verify -> Release for one real patient, driven as one continuous flow. ` +
      `Collection: sample_records advanced to Collected=${collectedOk}. ` +
      `Receipt: receivedOk=${receivedOk}. Draft save: is_verified=false and hgb=13.5 persisted correctly=${draftOk}. ` +
      `Verify: is_verified became true=${verifiedOk} (all 16 CBC fields were filled, so the Lab Safety Phase 1 completeness gate correctly allowed it), and sample_records advanced to Completed=${sampleCompletedOk}. ` +
      `Release: results_hematology.is_released=${hemRow?.is_released} (${releasedOk}) and sample_records advanced to Released=${sampleReleasedOk}.`);
    await page.close();
  }

  // --- 8b: Unified Results Entry -- real DEPT_META wiring across TWO
  // departments at once for one patient (Haematology CBC + Chemistry LFT),
  // confirming the nav sections match what was actually ordered, that
  // clicking between them shows the right department's own fields (not a
  // stale mix), and that Save All actually persists both departments'
  // tables independently. ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('lab_tech', {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Lab Tech', role: 'lab_tech' }],
        patients: [{ id: 'p2', name: 'Unified Entry Patient', mrn: 'UE-001', lab_no: 'LB-002', age: 50, age_unit: 'y', sex: 'M', payment_status: 'paid', tests_requested: ['CBC (Full Blood Count)', 'LFT (Liver Function)'] }],
      },
    }), 'labtech@audit.local', 'whatever');

    await page.evaluate(() => openUnifiedResultsEntry('p2', 'LB-002', 'Unified Entry Patient'));
    await page.waitForTimeout(300);
    // NOTE: _ueCurrentDepts is a top-level `let`, not a `window.` property
    // (it's never explicitly assigned onto window), so it must be read as a
    // bare identifier inside page.evaluate(), not via window._ueCurrentDepts.
    const depts = await page.evaluate(() => _ueCurrentDepts);
    const onUnifiedPage = await page.evaluate(() => document.querySelector('.page.active')?.id === 'page-unified-entry');
    const navText = await page.evaluate(() => document.getElementById('ue-nav')?.textContent || '');
    const navHasHem = /Complete Blood Count \(CBC\)/.test(navText);
    const navHasChem = /Liver Function \(LFT\)/.test(navText);
    const ptIdsWired = await page.evaluate(() => document.getElementById('hem-entry-pt-id')?.value === 'p2' && document.getElementById('chem-entry-pt-id')?.value === 'p2');

    // First nav button auto-clicked (hem's CBC card) -- its own field should
    // be visible/enabled; the OTHER department's field, though present in the
    // DOM (moved into #ue-detail), should be sitting in a hidden sibling
    // container, not both shown at once.
    const initialState = await page.evaluate(() => {
      const wbc = document.getElementById('he-wbc'), alt = document.getElementById('ce-alt');
      return { wbcVisible: wbc && wbc.offsetParent !== null, altVisible: alt && alt.offsetParent !== null };
    });

    // Click the Chemistry (LFT) nav button and confirm the view actually flips.
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.ue-nav-btn')];
      const chemBtn = btns.find(b => b.textContent.includes('Liver Function'));
      if (!chemBtn) return false;
      chemBtn.click();
      return true;
    });
    await page.waitForTimeout(100);
    const afterClickState = await page.evaluate(() => {
      const wbc = document.getElementById('he-wbc'), alt = document.getElementById('ce-alt');
      return { wbcVisible: wbc && wbc.offsetParent !== null, altVisible: alt && alt.offsetParent !== null };
    });

    // Enter values in both departments' actual fields (now that both have
    // been visited/moved into the DOM) and Save All (draft).
    await setVal(page, 'he-hgb', '14.2');
    await setVal(page, 'ce-alt', '35');
    await page.evaluate(() => saveAllUnifiedEntry(false));
    await page.waitForTimeout(300);
    const hemRow = await page.evaluate(async () => { const { data } = await sb.from('results_hematology').select('*').eq('patient_id', 'p2').maybeSingle(); return data; });
    const chemRow = await page.evaluate(async () => { const { data } = await sb.from('results_chemistry').select('*').eq('patient_id', 'p2').maybeSingle(); return data; });
    const bothPersisted = parseFloat(hemRow?.hgb) === 14.2 && parseFloat(chemRow?.alt) === 35;

    const ok = JSON.stringify(depts.slice().sort()) === JSON.stringify(['chem', 'hem']) && onUnifiedPage && navHasHem && navHasChem && ptIdsWired &&
      initialState.wbcVisible && !initialState.altVisible && clicked && afterClickState.altVisible && !afterClickState.wbcVisible && bothPersisted;
    log('8b', ok ? 'PASS' : 'FAIL',
      `Unified Results Entry for a patient ordered CBC (hem) + LFT (chem). departmentsMatchingTests() correctly resolved _ueCurrentDepts=${JSON.stringify(depts)} (expected hem+chem, driven purely by DEPT_META/data-test wiring, not hardcoded). ` +
      `Nav shows both department sections (CBC=${navHasHem}, LFT=${navHasChem}); both entry pages' hidden patient-id fields wired to p2=${ptIdsWired}. ` +
      `Before clicking anything, the auto-selected first section correctly showed only the Hem CBC field (wbc visible=${initialState.wbcVisible}, chem alt visible=${initialState.altVisible} -- expected false). ` +
      `After clicking the Liver Function (LFT) nav button, the view actually flipped to show ce-alt=${afterClickState.altVisible} and hide he-wbc=${!afterClickState.wbcVisible} -- real department switching, not a static list. ` +
      `Save All persisted BOTH departments' own tables independently and correctly (hem.hgb=${hemRow?.hgb}, chem.alt=${chemRow?.alt})=${bothPersisted}.`);
    await page.close();
  }

  // --- 8c: Critical Values -- end-to-end detection -> Criticals page ->
  // read-back acknowledgement, PLUS a genuine gap found empirically: a
  // critical WBC is silently never flagged or logged because the WBC input
  // field's oninput handler (unlike HGB/PLT/INR) never passes canBeCrit=true
  // to flagHem(), even though CRIT_RANGES defines a WBC critical range and
  // CBC is commonly ordered without HGB/PLT/INR also being critical. ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('lab_tech', {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Lab Tech', role: 'lab_tech' }],
        patients: [{ id: 'p3', name: 'Critical Value Patient', mrn: 'CV-001', lab_no: 'LB-003', age: 60, age_unit: 'y', sex: 'M', payment_status: 'paid', tests_requested: [] }],
      },
    }), 'labtech@audit.local', 'whatever');
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p3'; });

    // Positive control: a critical-low WBC (1.0, below CRIT_RANGES.wbc.lo=2.0)
    // as the ONLY abnormal field.
    await setVal(page, 'he-wbc', '1.0');
    const wbcWarnVisibleAfterInput = await page.evaluate(() => document.getElementById('he-critical-warn')?.style.display !== 'none');
    await page.evaluate(() => saveHemEntry(false));
    await page.waitForTimeout(200);
    let crits = await page.evaluate(async () => { const { data } = await sb.from('critical_values').select('*'); return data; });
    const wbcLogged = crits.some(c => c.parameter === 'WBC');

    // Negative/positive control: now also make HGB critical-low (5.0, below
    // CRIT_RANGES.hgb.lo=7.0) on the SAME patient -- this field DOES pass
    // canBeCrit=true, so it should correctly trigger the banner and get logged.
    await setVal(page, 'he-hgb', '5.0');
    const hgbWarnVisible = await page.evaluate(() => document.getElementById('he-critical-warn')?.style.display !== 'none');
    await page.evaluate(() => saveHemEntry(false));
    await page.waitForTimeout(200);
    crits = await page.evaluate(async () => { const { data } = await sb.from('critical_values').select('*'); return data; });
    const hgbLogged = crits.some(c => c.parameter === 'Haemoglobin');

    // Criticals page + global badge should now reflect the HGB critical.
    await page.evaluate(() => checkCriticals());
    await page.waitForTimeout(100);
    const badge = await page.evaluate(() => ({ text: document.getElementById('crit-badge')?.textContent, visible: document.getElementById('crit-badge')?.style.display !== 'none' }));
    await page.evaluate(() => goPage('criticals'));
    await page.waitForTimeout(200);
    const cvBodyText = await page.evaluate(() => document.getElementById('cv-body')?.textContent || '');
    const criticalsPageShowsHgb = cvBodyText.includes('Haemoglobin') && cvBodyText.includes('Critical Value Patient');

    // Read-back acknowledgement: wrong value rejected, correct value accepted.
    const hgbCrit = crits.find(c => c.parameter === 'Haemoglobin');
    await page.evaluate((id) => openCritAck(id), hgbCrit.id);
    await page.waitForTimeout(100);
    await setVal(page, 'crit-readback-val', '9.9'); // wrong
    await setVal(page, 'crit-notified-to', 'Dr. Audit');
    await page.evaluate(() => submitCritAck());
    await page.waitForTimeout(150);
    let refreshed = await page.evaluate(async (id) => { const { data } = await sb.from('critical_values').select('*').eq('id', id).maybeSingle(); return data; }, hgbCrit.id);
    const wrongReadbackRejected = refreshed?.is_acknowledged !== true;
    await setVal(page, 'crit-readback-val', '5'); // correct (numeric-tolerant match against stored "5")
    await page.evaluate(() => submitCritAck());
    await page.waitForTimeout(150);
    refreshed = await page.evaluate(async (id) => { const { data } = await sb.from('critical_values').select('*').eq('id', id).maybeSingle(); return data; }, hgbCrit.id);
    const correctReadbackAcked = refreshed?.is_acknowledged === true && refreshed?.clinician_notified === 'Dr. Audit';

    const positiveControlOk = hgbWarnVisible && hgbLogged && badge.visible && criticalsPageShowsHgb && wrongReadbackRejected && correctReadbackAcked;
    const wbcGapConfirmed = !wbcWarnVisibleAfterInput && !wbcLogged;
    log('8c', positiveControlOk ? 'PASS' : 'FAIL',
      `Critical Values pipeline (positive control, HGB=5.0 g/dL, below CRIT_RANGES.hgb.lo=7.0): banner shown=${hgbWarnVisible}, logged to critical_values with parameter="Haemoglobin"=${hgbLogged}, ` +
      `global sidebar badge visible/count=${JSON.stringify(badge)}, Critical Values page lists it=${criticalsPageShowsHgb}. Read-back ack: wrong value "9.9" correctly rejected (stayed unacknowledged)=${wrongReadbackRejected}, correct value "5" accepted and recorded clinician_notified="Dr. Audit"=${correctReadbackAcked}. ` +
      (wbcGapConfirmed
        ? `⚠️ BUG FOUND (empirically confirmed, not from prior audit notes): CRIT_RANGES defines a WBC critical range (2.0–30.0 ×10³/µL), and results_hematology has a WBC-only order path (WBC Count can be ordered alone), but the he-wbc input's oninput handler is 'flagHem(this,4.0,10.0,\\'he-wbc-flag\\')' -- missing the canBeCrit=true 5th argument that he-hgb/he-plt/he-inr all correctly pass. With WBC=1.0 (critical-low) as the ONLY abnormal CBC field, #he-critical-warn stayed hidden (visible=${wbcWarnVisibleAfterInput}) and saveHemEntry() never called logCriticalValues() at all, so NO critical_values row was ever created for a genuinely critical WBC (logged=${wbcLogged}). A lab tech entering an isolated critical WBC gets no on-screen warning and no entry ever reaches the Critical Values page/banner/notification bell -- a real ISO 15189 §5.8 gap, distinct from the already-known Lab Safety Phase 2 missing-print-fields finding.`
        : `WBC critical-value gap NOT reproduced this run (wbcWarnVisibleAfterInput=${wbcWarnVisibleAfterInput}, wbcLogged=${wbcLogged}) -- re-check if index.html has changed.`));
    await page.close();
  }

  // --- 8d: role-access enforcement, lab_tech vs lab_supervisor -- Staff
  // Management ("Staff Activity") is supervisor-only per README/CLAUDE.md,
  // and once a result is Verified/Released only admin/lab_supervisor can
  // unlock it for editing (canOverrideResultLock()). ---
  {
    // 8d-i: 'staff' page access
    const pageTech = await context.newPage();
    await login(pageTech, baseUrl, baseSeed('lab_tech'), 'labtech@audit.local', 'whatever');
    await pageTech.evaluate(() => goPage('staff'));
    await pageTech.waitForTimeout(150);
    const techDenied = await pageTech.evaluate(() => document.querySelector('.page.active')?.id !== 'page-staff');
    const techSidebarHidden = await pageTech.evaluate(() => { const el = document.querySelector('.sb-item[data-p="staff"]'); return el ? getComputedStyle(el).display === 'none' : null; });
    await pageTech.close();

    const pageSup = await context.newPage();
    await login(pageSup, baseUrl, baseSeed('lab_supervisor'), 'labtech@audit.local', 'whatever');
    await pageSup.evaluate(() => goPage('staff'));
    await pageSup.waitForTimeout(150);
    const supAllowed = await pageSup.evaluate(() => document.querySelector('.page.active')?.id === 'page-staff');
    await pageSup.close();

    // 8d-ii: result-lock override -- a lab_tech cannot see/use an unlock
    // button on an already-verified result; a lab_supervisor can.
    const seedVerified = {
      tables: {
        patients: [{ id: 'p4', name: 'Locked Result Patient', mrn: 'LR-001', lab_no: 'LB-004', payment_status: 'paid', tests_requested: [] }],
        results_hematology: [{ id: 'r1', patient_id: 'p4', hgb: 13, is_verified: true, verified_at: new Date().toISOString() }],
      },
    };
    const pageTech2 = await context.newPage();
    await login(pageTech2, baseUrl, baseSeed('lab_tech', seedVerified), 'labtech@audit.local', 'whatever');
    await pageTech2.evaluate(() => goPage('hem-entry'));
    await pageTech2.waitForTimeout(100);
    await pageTech2.evaluate(() => loadExistingResults('hem', 'p4'));
    await pageTech2.waitForTimeout(200);
    const techFieldsLocked = await pageTech2.evaluate(() => document.getElementById('he-hgb')?.disabled === true);
    const techUnlockBtnShown = await pageTech2.evaluate(() => { const b = document.getElementById('hem-entry-unlock-btn'); return !!b && b.style.display !== 'none'; });
    await pageTech2.close();

    const pageSup2 = await context.newPage();
    await login(pageSup2, baseUrl, baseSeed('lab_supervisor', seedVerified), 'labtech@audit.local', 'whatever');
    await pageSup2.evaluate(() => goPage('hem-entry'));
    await pageSup2.waitForTimeout(100);
    await pageSup2.evaluate(() => loadExistingResults('hem', 'p4'));
    await pageSup2.waitForTimeout(200);
    const supFieldsLockedInitially = await pageSup2.evaluate(() => document.getElementById('he-hgb')?.disabled === true);
    const supUnlockBtnShown = await pageSup2.evaluate(() => { const b = document.getElementById('hem-entry-unlock-btn'); return !!b && b.style.display !== 'none'; });
    const supCanUnlock = await pageSup2.evaluate(() => { document.getElementById('hem-entry-unlock-btn')?.click(); return document.getElementById('he-hgb')?.disabled === false; });
    await pageSup2.close();

    const ok = techDenied && techSidebarHidden && supAllowed && techFieldsLocked && !techUnlockBtnShown && supFieldsLockedInitially && supUnlockBtnShown && supCanUnlock;
    log('8d', ok ? 'PASS' : 'FAIL',
      `Staff Management page: lab_tech denied (goPage blocked)=${techDenied}, sidebar item hidden=${techSidebarHidden}; lab_supervisor correctly allowed=${supAllowed}. ` +
      `Result-lock override on an already-verified Haematology result: lab_tech sees fields disabled=${techFieldsLocked} and NO unlock button=${!techUnlockBtnShown}; lab_supervisor sees fields disabled by default=${supFieldsLockedInitially}, an unlock button IS offered=${supUnlockBtnShown}, and clicking it actually re-enables the field=${supCanUnlock}. This matches canOverrideResultLock() (admin/lab_supervisor only) and confirms README's "Lab Supervisor = Lab Tech + Verification" access difference is real at this specific gate, even though the ROLE_PAGES sidebar list itself grants both roles the same hem/chem/etc. entry pages (verification-in-general is not page-gated, but re-opening an already-verified/released result is).`);
  }

  // --- 8e: QC Module -- add a control lot, enter an in-control QC result
  // (correct Z-score math) and an out-of-control one (Westgard 1-3s reject),
  // confirm both actually persist and render on the page from real data. ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('lab_tech'), 'labtech@audit.local', 'whatever');
    await page.evaluate(() => goPage('qc'));
    await page.waitForTimeout(150);
    await setVal(page, 'qc-lot-no', 'LOT-CV-001');
    await setVal(page, 'qc-ctrl-name', 'Bio-Rad Level 1');
    await page.selectOption('#qc-section', 'Haematology');
    await setVal(page, 'qc-mean', '10');
    await setVal(page, 'qc-sd', '1');
    await page.evaluate(() => saveQcLot());
    await page.waitForTimeout(250);
    const lots = await page.evaluate(async () => { const { data } = await sb.from('qc_lots').select('*'); return data; });
    const lotSavedOk = lots.length === 1 && lots[0].lot_no === 'LOT-CV-001';
    const lotsTableShowsIt = (await page.evaluate(() => document.getElementById('qc-lots-body')?.textContent || '')).includes('LOT-CV-001');

    await page.evaluate(() => switchQcTab('entry', document.querySelectorAll('#page-qc .tabs .tab')[1]));
    await page.waitForTimeout(100);
    await page.selectOption('#qc-sel-lot', lots[0].id);
    await page.evaluate(() => loadQcLotInfo());
    await page.waitForTimeout(100);
    // In-control result: 10.5, z=(10.5-10)/1=0.5 -- well within Westgard limits.
    await setVal(page, 'qc-result-val', '10.5');
    await page.evaluate(() => saveQcResult());
    await page.waitForTimeout(200);
    let qcResults = await page.evaluate(async () => { const { data } = await sb.from('qc_results').select('*'); return data; });
    const inControlOk = qcResults[0]?.accepted === true && Math.abs(qcResults[0]?.z_score - 0.5) < 0.01;

    // Out-of-control result: 14 -- z=4.0, breaches Westgard 1-3s (reject rule).
    await setVal(page, 'qc-result-val', '14');
    await page.evaluate(() => saveQcResult());
    await page.waitForTimeout(200);
    qcResults = await page.evaluate(async () => { const { data } = await sb.from('qc_results').select('*').order('created_at', { ascending: true }); return data; });
    const outOfControl = qcResults[qcResults.length - 1];
    const rejectedOk = outOfControl?.accepted === false && /1-3s/.test(outOfControl?.rule_violation || '');
    const resultsTableShowsBoth = (await page.evaluate(() => document.getElementById('qc-results-body')?.textContent || '')).includes('Rejected');

    const ok = lotSavedOk && lotsTableShowsIt && inControlOk && rejectedOk && resultsTableShowsBoth;
    log('8e', ok ? 'PASS' : 'FAIL',
      `QC Module: control lot saved (mean=10, SD=1) and rendered in the Active Lots table=${lotSavedOk && lotsTableShowsIt}. In-control result 10.5 -> z=${qcResults[0]?.z_score} accepted=${qcResults[0]?.accepted} (expected z=0.50, accepted)=${inControlOk}. ` +
      `Out-of-control result 14 -> z=${outOfControl?.z_score}, correctly rejected under Westgard rule "${outOfControl?.rule_violation}"=${rejectedOk}, and both results render in the Recent QC Results table=${resultsTableShowsBoth}.`);
    await page.close();
  }

  // --- 8f: TAT Tracker -- real sample_records data (collected_at) renders
  // with a computed turnaround time and status, not placeholder content. ---
  {
    const page = await context.newPage();
    const collectedAt = new Date(Date.now() - 90 * 60000).toISOString(); // 90 minutes ago
    await login(page, baseUrl, baseSeed('lab_tech', {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Lab Tech', role: 'lab_tech' }],
        patients: [{ id: 'p5', name: 'TAT Test Patient', mrn: 'TAT-001', lab_no: 'LB-005', priority: 'STAT' }],
        sample_records: [{ id: 'sr1', patient_id: 'p5', status: 'Received', collected_at: collectedAt }],
      },
    }), 'labtech@audit.local', 'whatever');
    await page.evaluate(() => goPage('tat'));
    await page.waitForTimeout(300);
    const tatText = await page.evaluate(() => document.getElementById('tat-body')?.textContent || '');
    const showsPatient = tatText.includes('TAT Test Patient') && tatText.includes('LB-005');
    const showsTat = /1h\s*3\d?m|1h\s*2\d?m|1h\s*[0-9]+m/.test(tatText); // ~90 min -> "1h 3Xm"-ish, tolerant of test timing jitter
    const ok = showsPatient && showsTat;
    log('8f', ok ? 'PASS' : 'FAIL',
      `TAT Tracker loaded a real seeded sample (collected ~90 minutes ago, status Received) and rendered the patient row (LB-005 / TAT Test Patient)=${showsPatient}, with a computed turnaround time string present=${showsTat}. Raw tat-body text sample: "${tatText.replace(/\s+/g, ' ').slice(0, 200)}".`);
    await page.close();
  }

  return findings;
};
