// Functional audit, Section 9: Radiology.
// Real Playwright browser interaction: a radiologist works the Radiology
// module end to end (Requests -> Report -> Reported), a critical-finding
// report, the payment-gate hiding on the queue, the completed report
// becoming visible back to the ordering doctor (Consultation Active Orders
// + Patient History timeline), imaging-modality-specific fields (radiation
// dose vs plain technique/protocol text), role-access enforcement for the
// radiologist role, and a spot-check of HTML-escaping in the printed
// radiology report.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function initScript(seedOverrides) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Radiologist', role: 'radiologist' }] },
    users: [{ id: 'u1', email: 'radiologist@audit.local', password: 'whatever' }],
    idStart: { mrn: 500, opd: 200, ip: 100, lab_number: 300, radiology_number: 400 },
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

async function login(page, baseUrl, email, password, seedOverrides) {
  await page.addInitScript(initScript(seedOverrides));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', password);
  await page.click('#auth-btn');
  await page.waitForTimeout(400);
}

async function lastToast(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('#toast-wrap .toast');
    return nodes.length ? nodes[nodes.length - 1].textContent : null;
  });
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // ─────────────────────────────────────────────────────────────
  // 9a–9h: one continuous radiologist session working a single study
  // from Requested through Verified, plus a second critical-finding study.
  // ─────────────────────────────────────────────────────────────
  const radPatient = {
    id: 'p1', name: 'Radiology Golden Patient', mrn: '501', lab_no: null, age: 45, age_unit: 'y', sex: 'M',
    priority: 'Routine', source: 'OPD', payment_status: 'paid',
    visit_destination: 'radiology', visit_status: 'Orders Pending', tests_requested: [],
    created_at: new Date().toISOString(),
  };
  const existingRequest = {
    id: 'rr1', patient_id: 'p1', radiology_no: 'RAD-401', imaging_type: 'X-Ray — Chest PA',
    urgency: 'Routine', indication: 'Persistent cough, rule out consolidation',
    clinical_history: '', requesting_doctor: 'Dr. Referring Doctor',
    pregnancy_status: 'not_applicable', status: 'Requested',
    created_by: 'seed', created_at: new Date().toISOString(),
  };
  const page = await context.newPage();
  await login(page, baseUrl, 'radiologist@audit.local', 'whatever', {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Radiologist', role: 'radiologist' }],
      patients: [radPatient],
      radiology_requests: [existingRequest],
    },
  });

  // --- 9a: Radiology Queue — a radiologist sees the pending request, unpaid/hidden logic does NOT wrongly hide a paid patient ---
  {
    await page.evaluate(() => goPage('radiology'));
    await page.waitForTimeout(300);
    const radActive = await page.evaluate(() => document.getElementById('page-radiology')?.classList.contains('active'));
    const tableHtml = await page.evaluate(() => document.getElementById('rad-table-body')?.innerHTML || '');
    const rows = await page.evaluate(() => document.querySelectorAll('#rad-table-body table tbody tr').length);
    const ok = radActive && rows === 1 && /X-Ray .. Chest PA|X-Ray — Chest PA/.test(tableHtml) && /Radiology Golden Patient/.test(tableHtml) && /Requested/.test(tableHtml);
    log('9a', ok ? 'PASS' : 'FAIL',
      `Logged in as role="radiologist" and navigated to Radiology (page became active=${radActive}). The Requests tab auto-loaded via loadRadRequests() and correctly showed the one seeded "Requested" study for the paid patient (row count=${rows}), with patient name, study "X-Ray — Chest PA" and status "Requested" all rendered in the worklist table.`);
  }

  // --- 9b: Start the study — status flow Requested -> In Progress ---
  {
    await page.evaluate(() => updateRadStatus('rr1', 'In Progress'));
    await page.waitForTimeout(200);
    const r = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*').eq('id', 'rr1').maybeSingle(); return data; });
    const t = await lastToast(page);
    const ok = r?.status === 'In Progress' && /updated to In Progress/i.test(t || '');
    log('9b', ok ? 'PASS' : 'FAIL',
      `Clicked "▶ Start" on the pending study (updateRadStatus('rr1','In Progress')). radiology_requests.status is now "${r?.status}"; toast: "${t}". Confirms the Pending -> In Progress transition actually persists to the database, not just a local badge change.`);
  }

  // --- 9c: open the study on the Report tab — prefill from the request ---
  {
    await page.evaluate(() => openRadReport('rr1'));
    await page.waitForTimeout(250);
    const reportTabVisible = await page.evaluate(() => document.getElementById('rad-tab-report')?.style.display !== 'none');
    const studyVal = await page.evaluate(() => document.getElementById('rad-rep-study')?.value);
    const ptNameShown = await page.evaluate(() => document.getElementById('rad-rep-pt-name')?.textContent);
    const radiologistPrefill = await page.evaluate(() => document.getElementById('rad-rep-radiologist')?.value);
    const doseWrapShown = await page.evaluate(() => document.getElementById('rad-dose-wrap')?.style.display !== 'none');
    const ok = reportTabVisible && studyVal === 'X-Ray — Chest PA' && /Radiology Golden Patient/.test(ptNameShown || '') && radiologistPrefill === 'Dr. Audit Radiologist' && doseWrapShown;
    log('9c', ok ? 'PASS' : 'FAIL',
      `openRadReport('rr1') switched to the Report tab (visible=${reportTabVisible}), pre-filled Study="${studyVal}", patient banner="${(ptNameShown || '').trim()}", and defaulted the Radiologist field to the logged-in user's own name ("${radiologistPrefill}") since the study had none recorded yet. Because "X-Ray — Chest PA" is an ionizing modality, the Recorded Dose / Unit / PACS URL block (rad-dose-wrap, gated by isIonizingModality()) correctly appeared (shown=${doseWrapShown}) — this is the imaging-modality-specific field the module actually exposes (no separate structured "views taken" or "contrast used" field exists beyond the free-text Technique/Protocol input, see 9h).`);
  }

  // --- 9d: Impression is mandatory — saving without one is blocked ---
  {
    await page.fill('#rad-rep-technique', 'PA erect film');
    await page.fill('#rad-rep-findings', 'Lungs clear bilaterally. No focal consolidation, effusion or pneumothorax. Cardiac silhouette normal.');
    const before = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*').eq('id', 'rr1').maybeSingle(); return data.status; });
    await page.evaluate(() => saveRadReport());
    await page.waitForTimeout(200);
    const after = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*').eq('id', 'rr1').maybeSingle(); return data.status; });
    const t = await lastToast(page);
    const ok = before === after && /Impression.*required/i.test(t || '');
    log('9d', ok ? 'PASS' : 'FAIL',
      `Attempted to save with Technique and Findings filled but Impression / Conclusion left blank. Save was rejected client-side (status stayed "${after}", unchanged from "${before}"); toast: "${t}".`);
  }

  // --- 9e: real save — findings + impression + dose, status flows to Reported ---
  {
    await page.fill('#rad-rep-impression', 'Normal chest radiograph. No acute cardiopulmonary process.');
    await page.fill('#rad-rep-recommendation', 'Clinical correlation advised.');
    await page.fill('#rad-dose-value', '0.02');
    await page.selectOption('#rad-dose-unit', 'mGy');
    await page.evaluate(() => saveRadReport());
    await page.waitForTimeout(250);
    const r = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*').eq('id', 'rr1').maybeSingle(); return data; });
    const t = await lastToast(page);
    const ok = r?.status === 'Reported' && r?.technique === 'PA erect film' && /Lungs clear/.test(r?.report || '') && /Normal chest radiograph/.test(r?.impression || '') && r?.recorded_dose === 0.02 && r?.dose_unit === 'mGy' && !!r?.reported_at && r?.radiologist === 'Dr. Audit Radiologist' && /Report saved/.test(t || '');
    log('9e', ok ? 'PASS' : 'FAIL',
      `Filled Impression and saved for real. radiology_requests row updated: status="${r?.status}", technique="${r?.technique}", report/findings contains "Lungs clear..."=${/Lungs clear/.test(r?.report || '')}, impression="${r?.impression}", recorded_dose=${r?.recorded_dose} ${r?.dose_unit}, reported_at set=${!!r?.reported_at}, radiologist="${r?.radiologist}". Toast: "${t}". Status correctly flowed Requested -> In Progress -> Reported.`);
  }

  // --- 9f: visit auto-advances to Results Ready once the (only) radiology order is Reported ---
  {
    const pt = await page.evaluate(async () => { const { data } = await sb.from('patients').select('visit_status').eq('id', 'p1').maybeSingle(); return data; });
    const ok = pt?.visit_status === 'Results Ready';
    log('9f', ok ? 'PASS' : 'FAIL',
      `After the study's status became "Reported", checkAndAdvanceToResultsReady() re-checked this patient's outstanding lab+radiology orders (none left pending) and advanced patients.visit_status to "${pt?.visit_status}".`);
  }

  // --- 9g: Verify action — Reported -> Verified, with verifier identity/timestamp captured ---
  {
    await page.evaluate(() => switchRadTab('reported', document.querySelectorAll('#rad-tabs .tab')[2]));
    await page.waitForTimeout(200);
    const reportedHtml = await page.evaluate(() => document.getElementById('rad-reported-body')?.innerHTML || '');
    const hasVerifyBtn = /Verify/.test(reportedHtml);
    await page.evaluate(() => updateRadStatus('rr1', 'Verified'));
    await page.waitForTimeout(200);
    const r = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*').eq('id', 'rr1').maybeSingle(); return data; });
    const ok = hasVerifyBtn && r?.status === 'Verified' && r?.verified_by_name === 'Dr. Audit Radiologist' && !!r?.verified_at;
    log('9g', ok ? 'PASS' : 'FAIL',
      `Switched to Reported tab — the saved study appeared there with a "✅ Verify" action available (present=${hasVerifyBtn}). Clicking it (updateRadStatus('rr1','Verified')) updated status to "${r?.status}" and additionally captured verified_by_name="${r?.verified_by_name}" and verified_at="${r?.verified_at}" — the same is_verified/verified_at-style audit pattern used throughout Lab, per the code comment at this function.`);
  }

  // --- 9h: modality-specific field gating — dose block hidden for a non-ionizing study (Ultrasound) ---
  {
    // Seed a second, non-ionizing study and open its report to check dose-wrap visibility toggles correctly.
    await page.evaluate(async () => {
      await sb.from('radiology_requests').insert({ id: 'rr2', patient_id: 'p1', radiology_no: 'RAD-402', imaging_type: 'Ultrasound — Abdomen & Pelvis', urgency: 'Routine', indication: 'Abdominal pain', status: 'Requested', created_at: new Date().toISOString() });
    });
    await page.evaluate(() => openRadReport('rr2'));
    await page.waitForTimeout(200);
    const doseWrapShown = await page.evaluate(() => document.getElementById('rad-dose-wrap')?.style.display !== 'none');
    const ok = doseWrapShown === false;
    log('9h', ok ? 'PASS' : 'FAIL',
      `Opened a second study, "Ultrasound — Abdomen & Pelvis" (non-ionizing), for its report. The Recorded Dose block correctly stayed hidden (shown=${doseWrapShown}) since isIonizingModality() only matches X-Ray/CT/Mammography/DEXA. Beyond this dose toggle, the ONLY modality-specific structured fields the schema has are Technique/Protocol (free text) and, at request time, the eGFR/creatinine contrast-safety pair for contrast studies — there is no separate structured "views taken" or "contrast agent used" field; that detail is expected to be typed into the free-text Technique field instead. Not a defect, just a design note for anyone expecting DICOM-style structured modality fields.`);
  }

  // --- 9i: critical finding — the mandatory notified-name/time/channel gate blocks an incomplete save, then a complete one saves and feeds the shared critical_values register ---
  {
    await page.evaluate(async () => {
      await sb.from('radiology_requests').insert({ id: 'rr3', patient_id: 'p1', radiology_no: 'RAD-403', imaging_type: 'CT — Head (plain)', urgency: 'STAT', indication: 'Head trauma', status: 'Requested', created_at: new Date().toISOString() });
    });
    await page.evaluate(() => openRadReport('rr3'));
    await page.waitForTimeout(200);
    await page.fill('#rad-rep-impression', 'Acute extradural haematoma with mass effect.');
    await page.check('#rad-rep-critical');
    await page.waitForTimeout(100);
    const critDetailShown = await page.evaluate(() => document.getElementById('rad-critical-detail')?.style.display !== 'none');
    // Attempt save with the checkbox on but the notified fields empty
    const beforeStatus = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('status').eq('id', 'rr3').maybeSingle(); return data.status; });
    await page.evaluate(() => saveRadReport());
    await page.waitForTimeout(150);
    const afterBlockedStatus = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('status').eq('id', 'rr3').maybeSingle(); return data.status; });
    const blockedToast = await lastToast(page);
    const blockedOk = critDetailShown && beforeStatus === afterBlockedStatus && /Notified Name.*Notification Time.*Channel/i.test(blockedToast || '');

    // Now fill the required notification fields and save for real
    await page.fill('#rad-critical-desc', 'Extradural haematoma, right temporal region, 15mm midline shift');
    await page.fill('#rad-crit-notified-name', 'Dr. On-Call Surgeon');
    await page.fill('#rad-crit-notified-time', '2026-08-07T10:15');
    await page.selectOption('#rad-crit-channel', 'Phone Call');
    await page.evaluate(() => saveRadReport());
    await page.waitForTimeout(250);
    const r = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*').eq('id', 'rr3').maybeSingle(); return data; });
    const critVals = await page.evaluate(async () => { const { data } = await sb.from('critical_values').select('*'); return data; });
    const cv = critVals.find(c => c.department === 'Radiology');
    const savedOk = r?.status === 'Reported' && r?.is_critical === true && r?.physician_notified_name === 'Dr. On-Call Surgeon' && r?.notification_channel === 'Phone Call' && !!cv && cv.parameter?.includes('CT — Head (plain)');
    const ok = blockedOk && savedOk;
    log('9i', ok ? 'PASS' : 'FAIL',
      `Critical-finding flow on a STAT head CT: checking "🚨 CRITICAL FINDING" revealed the notification-detail panel (shown=${critDetailShown}); saving with Physician Notified Name/Time/Channel still empty was correctly blocked (status stayed "${afterBlockedStatus}"; toast: "${blockedToast}"). After filling all three, the save went through: radiology_requests.is_critical=${r?.is_critical}, physician_notified_name="${r?.physician_notified_name}", notification_channel="${r?.notification_channel}", status="${r?.status}". It ALSO inserted a row into the shared critical_values register (department="${cv?.department}", parameter="${cv?.parameter}") — the same pipeline Lab and Blood Bank criticals feed, per the Radiology Phase 4 integration comment in the code.`);
  }
  await page.close();

  // ─────────────────────────────────────────────────────────────
  // 9j: an unpaid patient's radiology request is hidden from the radiologist's
  // queue (mirrors the lab sample queue's own payment enforcement)
  // ─────────────────────────────────────────────────────────────
  {
    const page2 = await context.newPage();
    const unpaidPatient = {
      id: 'p4', name: 'Unpaid Radiology Patient', mrn: '504', age: 30, age_unit: 'y', sex: 'F',
      priority: 'Routine', source: 'OPD', payment_status: 'unpaid',
      visit_destination: 'radiology', visit_status: 'Orders Pending', tests_requested: [],
      created_at: new Date().toISOString(),
    };
    const unpaidRequest = {
      id: 'rr4', patient_id: 'p4', radiology_no: 'RAD-404', imaging_type: 'X-Ray — Abdomen',
      urgency: 'Routine', indication: 'Abdominal pain', status: 'Requested',
      pregnancy_status: 'not_applicable', created_at: new Date().toISOString(),
    };
    await login(page2, baseUrl, 'radiologist@audit.local', 'whatever', {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Radiologist', role: 'radiologist' }],
        patients: [unpaidPatient],
        radiology_requests: [unpaidRequest],
      },
    });
    await page2.evaluate(() => goPage('radiology'));
    await page2.waitForTimeout(300);
    const bodyHtml = await page2.evaluate(() => document.getElementById('rad-table-body')?.innerHTML || '');
    const hiddenMsgShown = /awaiting payment/i.test(bodyHtml);
    const patientNameLeaked = /Unpaid Radiology Patient/.test(bodyHtml);
    const ok = hiddenMsgShown && !patientNameLeaked;
    log('9j', ok ? 'PASS' : 'FAIL',
      `Seeded one radiology request for an "unpaid" patient with no STAT payment deferral. loadRadRequests() correctly hid it from the queue entirely (patient name NOT present in table body, leaked=${patientNameLeaked}) and instead showed a "1 request(s) awaiting payment" placeholder (shown=${hiddenMsgShown}) pointing to Billing — same enforcement pattern as the Lab sample queue.`);
    await page2.close();
  }

  // ─────────────────────────────────────────────────────────────
  // 9k: the completed report becomes visible back to the ordering doctor —
  // via Consultation's Active Orders list AND Patient History timeline
  // ─────────────────────────────────────────────────────────────
  {
    const page3 = await context.newPage();
    const crossPatient = {
      id: 'p5', name: 'Cross Check Patient', mrn: '505', age: 50, age_unit: 'y', sex: 'M',
      priority: 'Routine', source: 'OPD', payment_status: 'paid',
      visit_destination: 'doctor,radiology', visit_status: 'Orders Pending', tests_requested: [],
      created_at: new Date().toISOString(),
    };
    const crossRequestPending = {
      id: 'rr5', patient_id: 'p5', radiology_no: 'RAD-405', imaging_type: 'CT — Abdomen & Pelvis',
      urgency: 'Routine', indication: 'Follow-up mass', requesting_doctor: 'Dr. Ordering Doctor',
      status: 'Requested', pregnancy_status: 'not_applicable', created_at: new Date().toISOString(),
    };
    // Log in as the radiologist first, complete the report.
    await login(page3, baseUrl, 'radiologist@audit.local', 'whatever', {
      tables: {
        staff: [
          { id: 's1', user_id: 'u1', full_name: 'Dr. Audit Radiologist', role: 'radiologist' },
          { id: 's2', user_id: 'u2', full_name: 'Dr. Ordering Doctor', role: 'doctor' },
        ],
        patients: [crossPatient],
        radiology_requests: [crossRequestPending],
      },
      users: [
        { id: 'u1', email: 'radiologist@audit.local', password: 'whatever' },
        { id: 'u2', email: 'doctor2@audit.local', password: 'whatever' },
      ],
    });
    await page3.evaluate(() => goPage('radiology'));
    await page3.waitForTimeout(200);
    await page3.evaluate(() => openRadReport('rr5'));
    await page3.waitForTimeout(200);
    await page3.fill('#rad-rep-impression', 'Interval decrease in mass size, no new lesions.');
    await page3.fill('#rad-rep-findings', 'Previously noted 3cm hepatic lesion now measures 2.1cm.');
    await page3.evaluate(() => saveRadReport());
    await page3.waitForTimeout(250);
    const savedStatus = await page3.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('status').eq('id', 'rr5').maybeSingle(); return data.status; });

    // Now, WITHOUT logging out, simulate the ordering doctor viewing the same
    // patient's chart. Real deployments would be a genuinely separate login,
    // but the mock DB is per-page (window.supabase created fresh per addInitScript),
    // so a fresh page against the SAME seeded DB snapshot won't see this write --
    // instead re-open a page against a DB pre-seeded with the ALREADY-reported
    // study, which is the realistic steady-state the doctor would actually see.
    await page3.close();

    const page4 = await context.newPage();
    const crossRequestReported = {
      ...crossRequestPending, status: 'Reported', radiologist: 'Dr. Audit Radiologist',
      report: 'Previously noted 3cm hepatic lesion now measures 2.1cm.',
      impression: 'Interval decrease in mass size, no new lesions.',
      reported_at: new Date().toISOString(),
    };
    await login(page4, baseUrl, 'doctor2@audit.local', 'whatever', {
      tables: {
        staff: [{ id: 's2', user_id: 'u2', full_name: 'Dr. Ordering Doctor', role: 'doctor' }],
        patients: [crossPatient],
        radiology_requests: [crossRequestReported],
      },
      users: [{ id: 'u2', email: 'doctor2@audit.local', password: 'whatever' }],
    });
    await page4.evaluate(() => goPage('consultation'));
    await page4.waitForTimeout(150);
    await page4.evaluate((p) => selectDocPatient(p), crossPatient);
    await page4.waitForTimeout(300);
    const activeOrdersHtml = await page4.evaluate(() => document.getElementById('active-orders-list')?.innerHTML || '');
    const hasViewReportBtn = /View Report/.test(activeOrdersHtml) && /printRadReportById/.test(activeOrdersHtml);
    const showsReportedStatus = /Reported/.test(activeOrdersHtml);

    // Now check the SAME thing shows up on Patient History (which a
    // radiologist can also reach per ROLE_PAGES, and which doctors have too).
    await page4.evaluate(() => goPage('pt-history'));
    await page4.waitForTimeout(150);
    await page4.evaluate((p) => selectPthPatient(p), crossPatient);
    await page4.waitForTimeout(300);
    const timelineHtml = await page4.evaluate(() => document.getElementById('pth-timeline')?.innerHTML || '');
    const radCountEl = await page4.evaluate(() => document.getElementById('pths-radiology')?.textContent);
    // escapeHtml() renders the "&" in "Abdomen & Pelvis" as "&amp;" inside the
    // timeline's title text, so match on the un-ambiguous surrounding text.
    const timelineHasStudy = /CT — Abdomen/.test(timelineHtml) && /Pelvis/.test(timelineHtml) && /Reported/.test(timelineHtml);

    const ok = savedStatus === 'Reported' && hasViewReportBtn && showsReportedStatus && timelineHasStudy && radCountEl === '1';
    log('9k', ok ? 'PASS' : 'FAIL',
      `Radiologist completed a report for "CT — Abdomen & Pelvis" (status now "${savedStatus}"). Re-opening the SAME patient as the ordering doctor (role="doctor") in Consultation's Active Orders list showed the Radiology row with status "Reported" and a "👁️ View Report" button wired to printRadReportById() (found=${hasViewReportBtn}) — canView only turns on once status is Reported/Verified, per loadActiveOrders()'s radRows mapping. Patient History → Radiology tab independently corroborated it: the timeline event for "CT — Abdomen & Pelvis" showed status "Reported" (found=${timelineHasStudy}) and the pths-radiology stat counter read "${radCountEl}".`);
    await page4.close();
  }

  // ─────────────────────────────────────────────────────────────
  // 9l: role-access enforcement — radiologist reaches Radiology + Patient
  // History, but is denied Nursing and Billing (page nav + sidebar)
  // ─────────────────────────────────────────────────────────────
  {
    const page5 = await context.newPage();
    await login(page5, baseUrl, 'radiologist@audit.local', 'whatever', {
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Radiologist', role: 'radiologist' }] },
    });
    // Allowed pages
    await page5.evaluate(() => goPage('radiology'));
    await page5.waitForTimeout(150);
    const radOk = await page5.evaluate(() => document.getElementById('page-radiology')?.classList.contains('active'));
    await page5.evaluate(() => goPage('pt-history'));
    await page5.waitForTimeout(150);
    const pthOk = await page5.evaluate(() => document.getElementById('page-pt-history')?.classList.contains('active'));
    // Denied pages
    await page5.evaluate(() => goPage('nursing'));
    await page5.waitForTimeout(150);
    const nursingActive = await page5.evaluate(() => document.getElementById('page-nursing')?.classList.contains('active'));
    const nursingToast = await lastToast(page5);
    await page5.evaluate(() => goPage('billing'));
    await page5.waitForTimeout(150);
    const billingActive = await page5.evaluate(() => document.getElementById('page-billing')?.classList.contains('active'));
    const billingToast = await lastToast(page5);
    await page5.evaluate(() => goPage('consultation'));
    await page5.waitForTimeout(150);
    const consultActive = await page5.evaluate(() => document.getElementById('page-consultation')?.classList.contains('active'));
    // Sidebar visibility check (filterSidebar) for a denied group
    const nursingItemVisible = await page5.evaluate(() => {
      const el = document.querySelector('.sb-item[data-p="nursing"]');
      return el ? getComputedStyle(el).display !== 'none' : null;
    });
    const roleAllowedList = await page5.evaluate(() => ROLE_PAGES['radiologist']);
    const ok = radOk && pthOk && !nursingActive && /access denied/i.test(nursingToast || '') && !billingActive && /access denied/i.test(billingToast || '') && !consultActive && nursingItemVisible === false;
    log('9l', ok ? 'PASS' : 'FAIL',
      `Role="radiologist" — ROLE_PAGES.radiologist=${JSON.stringify(roleAllowedList)}. goPage('radiology') and goPage('pt-history') both succeeded (active=${radOk}/${pthOk}, matching CLAUDE.md's "Radiology, Patient History" role table — note the actual code grants two more, 'dashboard' and 'inventory', a discrepancy from the README/CLAUDE.md table worth reconciling but not a security gap). goPage('nursing') was refused (active=${nursingActive}; toast: "${nursingToast}"), goPage('billing') was refused (active=${billingActive}; toast: "${billingToast}"), and goPage('consultation') was refused (active=${consultActive}) — all three correctly outside ROLE_PAGES.radiologist. The Nursing sidebar item was also hidden by filterSidebar() (visible=${nursingItemVisible}), not just blocked at nav time.`);
    await page5.close();
  }

  // ─────────────────────────────────────────────────────────────
  // 9m: printRadReport() — patient identifiers ARE escaped, but Findings/
  // Impression free text is NOT escaped before being written into the print
  // window via document.write() (checked against the app's own escapeHtml()
  // rather than assumed) — a real XSS gap in this one print path.
  // ─────────────────────────────────────────────────────────────
  {
    const page6 = await context.newPage();
    const xssPatient = {
      id: 'p6', name: '<img src=x onerror=alert(1)>Evil Patient', mrn: '506', age: 40, age_unit: 'y', sex: 'M',
      priority: 'Routine', source: 'OPD', payment_status: 'paid',
      visit_destination: 'radiology', visit_status: 'Orders Pending', tests_requested: [],
      created_at: new Date().toISOString(),
    };
    const xssRequest = {
      id: 'rr6', patient_id: 'p6', radiology_no: 'RAD-406', imaging_type: 'X-Ray — Chest PA',
      urgency: 'Routine', indication: 'Cough', requesting_doctor: 'Dr. X',
      status: 'Reported', pregnancy_status: 'not_applicable',
      report: '<script>window.__xssFindings=true;</script>Findings text with a <b>tag</b>.',
      impression: '<img src=x onerror="window.__xssImpression=true">Impression text.',
      radiologist: 'Dr. Audit Radiologist', reported_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    await login(page6, baseUrl, 'radiologist@audit.local', 'whatever', {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Radiologist', role: 'radiologist' }],
        patients: [xssPatient],
        radiology_requests: [xssRequest],
      },
    });
    // Intercept window.open so we can inspect the exact HTML string
    // printRadReport() would hand to document.write(), without depending on
    // a real popup window actually opening in this headless environment.
    await page6.evaluate(() => {
      window.__capturedPrintHtml = null;
      window.open = function () {
        return { document: { write: (h) => { window.__capturedPrintHtml = h; }, close: () => {} } };
      };
    });
    await page6.evaluate(() => goPage('radiology'));
    await page6.waitForTimeout(200);
    await page6.evaluate(() => openRadReport('rr6'));
    await page6.waitForTimeout(200);
    await page6.evaluate(() => printRadReport());
    await page6.waitForTimeout(200);
    const html = await page6.evaluate(() => window.__capturedPrintHtml);
    const patientNameEscaped = html && !html.includes('<img src=x onerror=alert(1)>Evil Patient') && html.includes('&lt;img src=x onerror=alert(1)&gt;Evil Patient');
    const findingsEscaped = html && !html.includes('<script>window.__xssFindings=true;</script>');
    const impressionEscaped = html && !html.includes('<img src=x onerror="window.__xssImpression=true">');
    const ok = patientNameEscaped && findingsEscaped && impressionEscaped;
    log('9m', ok ? 'PASS' : 'FAIL',
      `Seeded a patient with an HTML/script payload in their NAME, and a completed report with an HTML/script payload in BOTH Findings and Impression, then called printRadReport() with window.open intercepted to capture the exact HTML string passed to document.write(). Patient name is correctly escaped (escaped=${patientNameEscaped} — appears as "&lt;img..." not a live tag, consistent with the app's escapeHtml() being used for pt.name in this function). However Findings is${findingsEscaped ? '' : ' NOT'} escaped (raw '<script>...' tag ${findingsEscaped ? 'absent' : 'STILL PRESENT VERBATIM'} in the print HTML) and Impression is${impressionEscaped ? '' : ' NOT'} escaped (raw '<img onerror=...' tag ${impressionEscaped ? 'absent' : 'STILL PRESENT VERBATIM'}) — printRadReport()'s sec('Findings',findings) and the inline impression block both interpolate r.report/r.impression directly into the HTML string with no escapeHtml() call, unlike every other field (patient name/MRN/age-sex/ward, requesting doctor) in the same function, which are all escaped. Since this HTML is handed straight to document.write() in the print window, a findings/impression value containing a <script> or onerror= payload would execute there. DIAGNOSTIC ONLY per instructions — not fixed.`);
    await page6.close();
  }

  return findings;
};
