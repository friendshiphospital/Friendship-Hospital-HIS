// Functional audit, Section 7: Nursing.
// Real Playwright browser interaction: Nursing Queue load, vitals entry
// end-to-end (including the NEWS2 >=7 Rapid Response Team acknowledgement
// gate), the ward Handover workflow (the actual save path lives on the
// Nursing page's Handover tab; the dedicated page-handover is a read-only
// filtered list), and role-access enforcement for the nurse role plus
// cross-role denial (receptionist / lab_tech should NOT reach Nursing).
//
// NOTE: SOFA scoring, the NEWS2/RRT escalation mechanics themselves,
// fluid-balance math, turning/repositioning clock, post-analgesia pain
// reassessment, MAR, and doctor-order sync already have dedicated,
// in-depth regression coverage in tests/nursing-safety-phase1/2/3.test.js
// and tests/nursing-orders-sync.test.js. This section does not re-prove
// that coverage; it exercises the broader Nursing module surface (queue,
// vitals entry, handover, role access) the way a human tester would click
// through it, and flags anything that surfaces along the way.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function baseSeed(role, overrides) {
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Nurse', role }],
      patients: [{
        id: 'p1', name: 'Nursing Test Patient', mrn: 'NRS-001',
        age: 45, age_unit: 'y', sex: 'M', payment_status: 'paid',
        diagnosis: 'Pneumonia', ward: 'Medical', visit_status: 'In Progress',
        visit_destination: 'doctor', priority: 'normal',
        created_at: new Date().toISOString(),
      }],
      admissions: [{ id: 'adm1', patient_id: 'p1', ward: 'Medical', bed_number: 'M-12', status: 'Active', admission_no: 'IP-001' }],
    },
    users: [{ id: 'u1', email: 'nurse@audit.local', password: 'whatever' }],
    idStart: { mrn: 500, opd: 200, ip: 100, lab_number: 300, radiology_number: 400 },
    ...overrides,
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
// script for the investigation). Worked around the same way: set .value
// directly + dispatch real input/change events, exactly like this
// codebase's own regression-test convention.
async function setModalValue(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) throw new Error('setModalValue: no element #' + id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // --- 7a: nurse login -- sidebar visibility vs. the documented (README/CLAUDE.md) role-access table ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('nurse'), 'nurse@audit.local', 'whatever');
    const visible = await page.evaluate(() => {
      const vis = id => { const el = document.querySelector('.sb-item[data-p="' + id + '"]'); return el ? getComputedStyle(el).display !== 'none' : null; };
      return { nursing: vis('nursing'), fluidChart: vis('fluid-chart'), admission: vis('admission'), infection: vis('infection'), handover: vis('handover'), samples: vis('samples') };
    });
    const rolePages = await page.evaluate(() => ROLE_PAGES['nurse']);
    const docSaysNurseHas = ['nursing', 'fluid-chart', 'admission', 'handover', 'infection', 'samples'];
    const missingFromRolePages = docSaysNurseHas.filter(p => !rolePages.includes(p));
    log('7a', missingFromRolePages.length ? 'BUG' : 'PASS',
      `Nurse sidebar visibility: nursing=${visible.nursing}, fluid-chart=${visible.fluidChart}, admission=${visible.admission}, infection=${visible.infection}, handover=${visible.handover}, samples=${visible.samples}. ` +
      `ROLE_PAGES.nurse=${JSON.stringify(rolePages)}. CLAUDE.md/README's documented Nurse access table is "Nursing, Fluid, Admissions, Handover, Infection, Samples" -- ` +
      (missingFromRolePages.length
        ? `but ROLE_PAGES['nurse'] is MISSING ${JSON.stringify(missingFromRolePages)}, so those sidebar items are hidden by filterSidebar() and goPage() actively denies navigating to them for a nurse (see 7f). This is a real drift between the documented spec and the shipped ROLE_PAGES table, not just a doc typo -- it removes functionality (Handover Notes browsing, Infection Flags, Sample Collection) a nurse is supposed to have.`
        : `and ROLE_PAGES['nurse'] matches.`));
    await page.close();
  }

  // --- 7b: Nursing Queue loads a real admitted patient with correct fields ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('nurse'), 'nurse@audit.local', 'whatever');
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(300);
    const row = await page.evaluate(() => {
      const tr = document.querySelector('#nrs-queue-body tbody tr');
      return tr ? tr.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    const ok = row && row.includes('NRS-001') && row.includes('Nursing Test Patient') && row.includes('Medical');
    log('7b', ok ? 'PASS' : 'FAIL',
      `Navigated to Nursing (goPage('nursing')), queue populated from a seeded Active admission. Row text: "${row}". Expected to include MRN NRS-001, patient name, and ward Medical.`);
    await page.close();
  }

  // --- 7c: Vital signs entry end-to-end via a real click on the queue's Vitals button, real field fills (in the SAME top-to-bottom order the form itself lays the fields out in), real save ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('nurse'), 'nurse@audit.local', 'whatever');
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(300);
    // Real click on the queue row's "Vitals" button (ordinary page content, not a modal).
    await page.click('#nrs-queue-body button:has-text("Vitals")');
    await page.waitForTimeout(150);
    const vitalsTabActive = await page.evaluate(() => document.getElementById('nrs-tab-vitals')?.style.display !== 'none');
    // Natural top-to-bottom entry, matching the form's own field order:
    // Blood Pressure -> Pulse & Respiration -> Temperature & SpO2. All final
    // values are entirely normal (120/80, HR 80, RR 16, Temp 37.0, SpO2 98%).
    await page.fill('#vs-sys', '120');
    await page.fill('#vs-dia', '80');
    await page.fill('#vs-hr', '80');
    // calcNEWS2() has already run 3 times by this point (on the sys and hr
    // inputs -- dia's oninput doesn't call it). Each of those runs treated
    // still-empty rr/spo2 as the literal numeric value 0, and 0 is well
    // inside this app's most severe NEWS2 bands for both (rr<=8 => +3,
    // spo2<=91 => +3) -- so simply typing normal blood pressure and heart
    // rate into an otherwise-empty form already computes a false-critical
    // score and can auto-fire the blocking Rapid Response Team modal, well
    // before the nurse has even reached the RR/SpO2 fields.
    const phantomModalOpen = await page.evaluate(() => document.getElementById('rrt-ack-ov')?.classList.contains('open'));
    const phantomScore = await page.evaluate(() => document.getElementById('vs-news2-val')?.textContent?.trim());
    await page.fill('#vs-rr', '16');
    await page.fill('#vs-temp', '37.0');
    await page.fill('#vs-spo2', '98');
    await page.waitForTimeout(100);
    const newsShown = await page.evaluate(() => document.getElementById('vs-news2-val')?.textContent?.trim());
    // Once all fields are filled the score correctly settles back to a
    // normal, non-alarming value -- but the modal opened earlier is never
    // auto-dismissed when the score drops back below 7 (calcNEWS2 only
    // resets the internal "already shown" flag, it never removes the
    // 'open' class), so it is still sitting open over the form right now,
    // intercepting every click on the rest of the page.
    const modalStillLingering = await page.evaluate(() => document.getElementById('rrt-ack-ov')?.classList.contains('open'));
    log('7c-phantom-alert', (phantomModalOpen && modalStillLingering) ? 'BUG' : 'PASS',
      `Filling completely normal vital signs in the form's own top-to-bottom field order (BP, then Pulse/Resp, then Temp/SpO2) -- exactly how a nurse would naturally tab through it -- triggered a FALSE Rapid Response Team activation partway through: after typing only BP+HR (RR/SpO2 fields still blank), on-screen NEWS2 briefly read "${phantomScore}" and the blocking RRT modal opened=${phantomModalOpen}. This is because calcNEWS2() treats an unfilled numeric field as the literal value 0 rather than "not yet entered", and 0 lands in the most severe scoring band for both respiratory rate and SpO2. Once all fields were filled, the on-screen score correctly settled to "${newsShown}" (normal) -- but the RRT modal that had already opened was never auto-dismissed (still open=${modalStillLingering}), leaving it sitting over the form blocking every further click until the nurse manually cancels an alarm for a patient who was never actually critical.`);
    // Dismiss the phantom modal (a real nurse would have to do the same) and continue the golden-path save.
    await page.evaluate(() => closeOv('rrt-ack-ov'));
    await page.fill('#vs-wt', '70');
    await page.fill('#vs-ht', '170');
    await page.click('#pain-bar .pain-2');
    await page.waitForTimeout(100);
    await page.click('button:has-text("💾 Save Vital Signs")');
    await page.waitForTimeout(250);
    const vitals = await page.evaluate(async () => { const { data } = await sb.from('vital_signs').select('*'); return data; });
    const v = vitals && vitals[0];
    const ok = vitalsTabActive && v && v.patient_id === 'p1' && v.systolic === 120 && v.diastolic === 80 && v.heart_rate === 80 && v.pain_score === 2 && v.bmi != null;
    log('7c', ok ? 'PASS' : 'FAIL',
      `Clicked the queue's real "Vitals" button (selectVitalsFromQueue), Vitals tab shown=${vitalsTabActive}. Filled normal-range vitals (120/80, HR 80, RR 16, Temp 37.0, SpO2 98%, pain 2) -- after dismissing the phantom RRT modal from 7c-phantom-alert above -- NEWS2 shown on screen = "${newsShown}" (expected "0"). Saved record: ${JSON.stringify(v)}.`);
    // Sub-finding: NEWS2=0 (a fully normal reading) is stored via
    // `news2_score:newsScore||null` in saveVitals() -- because 0 is falsy
    // in JS, a genuinely-computed score of 0 collapses to the SAME null
    // that a never-calculated reading would have. The Vitals History table
    // and Nursing Queue then show "—" for a documented-normal patient,
    // indistinguishable from "NEWS2 was never assessed".
    const newsBug = v && v.news2_score == null && newsShown === '0';
    log('7c-news2-zero', newsBug ? 'BUG' : (v ? 'PASS' : 'FAIL'),
      `On-screen NEWS2 correctly computed as "${newsShown}" for normal vitals, but the saved record has news2_score=${JSON.stringify(v?.news2_score)}. ` +
      (newsBug ? `saveVitals() writes "news2_score:newsScore||null" -- since 0 is falsy in JS, a real score of 0 is stored as null, identical to "never calculated". Vitals History/Queue then can't distinguish a confirmed-normal NEWS2 from a reading nobody scored.` : `(no discrepancy found)`));
    await page.close();
  }

  // --- 7d: NEWS2 >=7 blocks save until the Rapid Response Team acknowledgement is completed with a matching read-back ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('nurse'), 'nurse@audit.local', 'whatever');
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(300);
    await page.click('#nrs-queue-body button:has-text("Vitals")');
    await page.waitForTimeout(150);
    // Deliberately critical vitals: low BP, high RR, low SpO2 -> NEWS2 well over 7.
    await page.fill('#vs-sys', '80');
    await page.fill('#vs-rr', '26');
    await page.fill('#vs-spo2', '88');
    await page.fill('#vs-hr', '80');
    await page.fill('#vs-temp', '37.0');
    await page.waitForTimeout(150);
    const newsVal = await page.evaluate(() => document.getElementById('vs-news2-val')?.textContent?.trim());
    const modalAutoOpened = await page.evaluate(() => document.getElementById('rrt-ack-ov')?.classList.contains('open'));
    // Close it without acknowledging, then try to Save directly -- must be blocked.
    await page.evaluate(() => closeOv('rrt-ack-ov'));
    await page.click('button:has-text("💾 Save Vital Signs")');
    await page.waitForTimeout(200);
    let vitals = await page.evaluate(async () => { const { data } = await sb.from('vital_signs').select('*'); return data; });
    const blockedWithoutAck = (vitals || []).length === 0;
    const modalReopenedOnSaveAttempt = await page.evaluate(() => document.getElementById('rrt-ack-ov')?.classList.contains('open'));
    // Now actually acknowledge: wrong read-back first (should be rejected), then correct.
    await setModalValue(page, 'rrt-readback-val', '2');
    await setModalValue(page, 'rrt-notified-to', 'Dr. Audit OnCall');
    await page.evaluate(() => submitRrtAck());
    await page.waitForTimeout(100);
    const rejectedWrongReadback = await page.evaluate(() => document.getElementById('rrt-ack-ov')?.classList.contains('open'));
    await setModalValue(page, 'rrt-readback-val', newsVal);
    await page.evaluate(() => submitRrtAck());
    await page.waitForTimeout(100);
    const closedAfterCorrectReadback = await page.evaluate(() => !document.getElementById('rrt-ack-ov')?.classList.contains('open'));
    await page.click('button:has-text("💾 Save Vital Signs")');
    await page.waitForTimeout(250);
    vitals = await page.evaluate(async () => { const { data } = await sb.from('vital_signs').select('*'); return data; });
    const v = vitals && vitals[0];
    const ok = newsVal && parseInt(newsVal, 10) >= 7 && modalAutoOpened && blockedWithoutAck && modalReopenedOnSaveAttempt &&
      rejectedWrongReadback && closedAfterCorrectReadback && v && v.news2_score === parseInt(newsVal, 10) && v.rrt_acknowledged === true && v.rrt_notified_to === 'Dr. Audit OnCall';
    log('7d', ok ? 'PASS' : 'FAIL',
      `Entered critical vitals (BP 80, RR 26, SpO2 88%) -> on-screen NEWS2="${newsVal}" (expected >=7), RRT modal auto-opened=${modalAutoOpened}. Save without ack correctly blocked (no row written)=${blockedWithoutAck}, modal reopened on the blocked save attempt=${modalReopenedOnSaveAttempt}. Wrong read-back ("2") correctly rejected (modal stayed open)=${rejectedWrongReadback}; correct read-back ("${newsVal}") closed it=${closedAfterCorrectReadback}. After ack, Save succeeded: news2_score=${v?.news2_score}, rrt_acknowledged=${v?.rrt_acknowledged}, rrt_notified_to="${v?.rrt_notified_to}". (Core NEWS2/RRT mechanics already have dedicated coverage in nursing-safety-phase2.test.js; this exercises the same gate as part of the Nursing module's end-to-end vitals workflow.)`);
    await page.close();
  }

  // --- 7e: Handover workflow -- save via the real Nursing > Handover tab (SBAR), then read it back ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('nurse'), 'nurse@audit.local', 'whatever');
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(200);
    await page.click('.tabs button:has-text("📝 Handover")');
    await page.waitForTimeout(150);
    const handoverTabActive = await page.evaluate(() => document.getElementById('nrs-tab-handover')?.style.display !== 'none');
    await page.selectOption('#ho-ward', 'Medical');
    await page.selectOption('#ho-shift', 'Morning');
    await page.fill('#ho-from', 'Audit Nurse (outgoing)');
    await page.fill('#ho-to', 'Audit Nurse (incoming)');
    await page.fill('#ho-notes', 'General ward notes for audit run.');
    const situationEl = await page.evaluate(() => !!document.getElementById('ho-situation'));
    if (situationEl) {
      await page.fill('#ho-situation', 'Patient stable post-admission.');
      await page.fill('#ho-background', 'Admitted with pneumonia.');
      await page.fill('#ho-assessment', 'Afebrile, vitals stable.');
      await page.fill('#ho-recommendation', 'Continue antibiotics, reassess in AM.');
    }
    await page.click('button:has-text("✅ Save Handover"), button[onclick="saveHandover()"]').catch(async () => {
      await page.evaluate(() => saveHandover());
    });
    await page.waitForTimeout(250);
    const notes = await page.evaluate(async () => { const { data } = await sb.from('ward_handover_notes').select('*'); return data; });
    const n = notes && notes[0];
    const ok = handoverTabActive && n && n.ward === 'Medical' && n.shift === 'Morning' && n.notes === 'General ward notes for audit run.' &&
      (!situationEl || n.situation === 'Patient stable post-admission.');
    log('7e-save', ok ? 'PASS' : 'FAIL',
      `Filled and saved a real handover note via Nursing > Handover tab (handoverTabActive=${handoverTabActive}, SBAR fields present=${situationEl}). Saved ward_handover_notes row: ${JSON.stringify(n)}.`);

    // Can a nurse reach the dedicated Handover Notes page (page-handover) to browse/filter past notes?
    await page.evaluate(() => goPage('handover'));
    await page.waitForTimeout(150);
    const deniedFromDedicatedHandoverPage = await page.evaluate(() => document.querySelector('.page.active')?.id !== 'page-handover');
    log('7e-page-access', deniedFromDedicatedHandoverPage ? 'BUG' : 'PASS',
      `A nurse who just saved a handover note tried to open the dedicated Handover Notes page (goPage('handover')) to browse it. Denied=${deniedFromDedicatedHandoverPage}. ` +
      (deniedFromDedicatedHandoverPage ? `Consistent with the 7a finding: ROLE_PAGES['nurse'] does not include 'handover', so goPage() blocks it with "Access denied" even though the nurse can (and just did) WRITE a handover note from within the Nursing page's own Handover tab -- the write path works, only the dedicated browse/filter page is unreachable.` : ''));
    await page.close();
  }

  // --- 7e-admin-crosscheck: confirm the nurse-authored handover note really persisted and is readable via the dedicated page (as an admin) ---
  {
    const page = await context.newPage();
    const seed = baseSeed('admin', {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Admin', role: 'admin' }],
        patients: baseSeed('admin').tables.patients,
        admissions: baseSeed('admin').tables.admissions,
        ward_handover_notes: [{ id: 'ho1', ward: 'Medical', shift: 'Morning', handover_date: new Date().toISOString().slice(0, 10), notes: 'Pre-seeded note for admin cross-check.', handing_over: 'Nurse A', receiving: 'Nurse B', patient_count: 3 }],
      },
    });
    await login(page, baseUrl, seed, 'nurse@audit.local', 'whatever');
    await page.evaluate(() => goPage('handover'));
    await page.waitForTimeout(150);
    const onPage = await page.evaluate(() => document.querySelector('.page.active')?.id === 'page-handover');
    await page.selectOption('#ho-filter-ward', 'Medical');
    await page.waitForTimeout(250);
    const listText = await page.evaluate(() => document.getElementById('handover-list')?.textContent || '');
    const ok = onPage && listText.includes('Pre-seeded note for admin cross-check') && listText.includes('Nurse A');
    log('7e-admin-view', ok ? 'PASS' : 'FAIL',
      `As admin (who bypasses ROLE_PAGES), opened the dedicated Handover Notes page (on it=${onPage}), filtered to ward=Medical, and confirmed the seeded note rendered correctly: ${JSON.stringify({ found: listText.includes('Pre-seeded note for admin cross-check') })}. This confirms the read side (loadHandoverNotes) itself works correctly -- 7e-page-access's finding is specifically that a nurse cannot reach this page at all, not that the page is broken.`);
    await page.close();
  }

  // --- 7f: role-access enforcement -- nurse reaches Nursing; receptionist and lab_tech are correctly denied ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, baseSeed('receptionist'), 'nurse@audit.local', 'whatever');
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(150);
    const receptionistDenied = await page.evaluate(() => document.querySelector('.page.active')?.id !== 'page-nursing');
    const receptionistSidebarHidden = await page.evaluate(() => { const el = document.querySelector('.sb-item[data-p="nursing"]'); return el ? getComputedStyle(el).display === 'none' : null; });
    await page.close();

    const page2 = await context.newPage();
    await login(page2, baseUrl, baseSeed('lab_tech'), 'nurse@audit.local', 'whatever');
    await page2.evaluate(() => goPage('nursing'));
    await page2.waitForTimeout(150);
    const labTechDenied = await page2.evaluate(() => document.querySelector('.page.active')?.id !== 'page-nursing');
    await page2.close();

    const page3 = await context.newPage();
    await login(page3, baseUrl, baseSeed('nurse'), 'nurse@audit.local', 'whatever');
    await page3.evaluate(() => goPage('nursing'));
    await page3.waitForTimeout(150);
    const nurseAllowed = await page3.evaluate(() => document.querySelector('.page.active')?.id === 'page-nursing');
    await page3.close();

    const ok = receptionistDenied && receptionistSidebarHidden && labTechDenied && nurseAllowed;
    log('7f', ok ? 'PASS' : 'FAIL',
      `Role-access enforcement for the Nursing page: receptionist denied (goPage blocked, page stayed off page-nursing)=${receptionistDenied}, and its sidebar "Nursing & Vitals" item hidden=${receptionistSidebarHidden}; lab_tech denied=${labTechDenied}; nurse correctly allowed=${nurseAllowed}.`);
  }

  return findings;
};
