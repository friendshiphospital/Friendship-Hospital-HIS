// Functional audit, Section 6: Doctor Consultation.
// Real Playwright browser interaction: a doctor opens a patient from the
// queue, writes a consultation note, orders a lab test AND a radiology
// study, writes a prescription, completes & signs off the visit, then a
// battery of edge cases — empty-order validation, the post-signoff visit
// lock, the unpaid-patient payment gate (hard block + STAT deferral), and
// role-based access enforcement for a non-doctor role.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function initScript(seedOverrides) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Doctor', role: 'doctor' }] },
    users: [{ id: 'u1', email: 'doctor@audit.local', password: 'whatever' }],
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

// Reads the most recently rendered toast's text (toast() appends a div to
// #toast-wrap and only removes it after ~3.2s), without waiting for it to
// disappear.
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
  // 6a–6g: golden-path visit for one patient, followed by the two
  // edge cases that naturally continue the same visit (empty-order
  // validation, and the post-signoff lock) — mirrors a real doctor's
  // continuous workflow through one consultation.
  // ─────────────────────────────────────────────────────────────
  const goldenPatient = {
    id: 'p1', name: 'Golden Path Patient', mrn: '501', age: 34, age_unit: 'y', sex: 'F',
    priority: 'Routine', diagnosis: '', source: 'OPD', payment_status: 'paid',
    visit_destination: 'Doctor', visit_status: 'Registered', tests_requested: [],
    created_at: new Date().toISOString(),
  };
  const page = await context.newPage();
  page.on('dialog', async d => {
    // completeAndSignOffVisit() asks to schedule a follow-up; decline it
    // so the flow goes straight to _finalizeVisitComplete() without
    // opening the follow-up-schedule .ov modal.
    if (d.message().includes('Schedule a follow-up')) await d.dismiss();
    else await d.dismiss();
  });
  await login(page, baseUrl, 'doctor@audit.local', 'whatever', {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Doctor', role: 'doctor' }], patients: [goldenPatient] },
  });
  await page.evaluate(() => goPage('consultation'));
  await page.waitForTimeout(150);
  await page.evaluate((p) => selectDocPatient(p), goldenPatient);
  await page.waitForTimeout(150);

  // --- 6a: save a consultation note with real clinical content ---
  {
    await page.fill('#doc-doctor-name', 'Dr. Audit Doctor');
    await page.fill('#doc-complaint', 'Fever and headache');
    await page.fill('#doc-duration', '3 days');
    await page.fill('#doc-hpi', 'Gradual onset fever with associated headache, no rash.');
    await page.fill('#doc-dx1', 'Malaria (Suspected)');
    await page.fill('#doc-icd', 'B54');
    await page.fill('#doc-plan', 'Malaria screen, antipyretics, review in 2 days.');
    await page.selectOption('#doc-disposition', 'Discharge with Rx');
    await page.evaluate(() => saveConsultation());
    await page.waitForTimeout(200);
    const consults = await page.evaluate(async () => { const { data } = await sb.from('doctor_consultations').select('*'); return data; });
    const c = consults[0];
    const pt = await page.evaluate(async () => { const { data } = await sb.from('patients').select('diagnosis').eq('id', 'p1').maybeSingle(); return data; });
    const ok = c && c.patient_id === 'p1' && c.chief_complaint === 'Fever and headache' && c.primary_diagnosis === 'Malaria (Suspected)' && c.icd10 === 'B54' && pt?.diagnosis === 'Malaria (Suspected)';
    log('6a', ok ? 'PASS' : 'FAIL',
      `Filled and saved a consultation note (complaint, HPI, primary diagnosis "Malaria (Suspected)", ICD-10 B54, management plan). Real doctor_consultations row created: chief_complaint="${c?.chief_complaint}", primary_diagnosis="${c?.primary_diagnosis}", icd10="${c?.icd10}". Patient's diagnosis field back-filled to "${pt?.diagnosis}" for queue-card display.`);
  }

  // --- 6f: Orders tab, lab order with NO test checked is rejected ---
  {
    await page.evaluate(() => switchDocTab('orders', document.querySelectorAll('#doc-tabs .tab')[2]));
    await page.waitForTimeout(100);
    const before = await page.evaluate(async () => { const { data } = await sb.from('doctor_orders').select('*'); return data.length; });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(150);
    const after = await page.evaluate(async () => { const { data } = await sb.from('doctor_orders').select('*'); return data.length; });
    const t = await lastToast(page);
    const ok = before === after && /select at least one test/i.test(t || '');
    log('6f', ok ? 'PASS' : 'FAIL',
      `Clicked "Place Lab Order" with zero test checkboxes ticked. doctor_orders row count unchanged (${before} → ${after}); toast shown: "${t}".`);
  }

  // --- 6b: place a real lab order (test checkbox + priority + notes) ---
  {
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('.order-test-chk')].find(c => c.value === 'CBC (Full Blood Count)');
      if (cb) cb.checked = true;
    });
    await page.selectOption('#ord-lab-priority', 'Routine');
    await page.fill('#ord-lab-notes', 'Rule out malaria, check for anaemia');
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(250);
    const orders = await page.evaluate(async () => { const { data } = await sb.from('doctor_orders').select('*').eq('order_type', 'Lab'); return data; });
    const pt = await page.evaluate(async () => { const { data } = await sb.from('patients').select('lab_no,tests_requested').eq('id', 'p1').maybeSingle(); return data; });
    const o = orders[0];
    const ok = orders.length === 1 && o.order_detail === 'CBC (Full Blood Count)' && o.priority === 'Routine' && o.status === 'Pending' && !!pt?.lab_no && Array.isArray(pt?.tests_requested) && pt.tests_requested.includes('CBC (Full Blood Count)');
    log('6b', ok ? 'PASS' : 'FAIL',
      `Checked "CBC (Full Blood Count)" and placed a real lab order. doctor_orders row: order_detail="${o?.order_detail}", priority="${o?.priority}", status="${o?.status}". Patient auto-assigned Lab No. "${pt?.lab_no}" and tests_requested merged to include the ordered test: ${JSON.stringify(pt?.tests_requested)}.`);
  }

  // --- 6b-cascade: chargeForNewOrder() auto-generates an invoice for the new order
  // and flips the patient back to payment_status="unpaid" -- confirming the app's own
  // documented design (index.html ~12903-12917): every order after registration is
  // its own billing event, re-arming the payment gate for whatever the doctor orders
  // next in the SAME visit, not just future visits. Billing then needs to clear it
  // again before the next order (simulated below) exactly as a cashier would. ---
  {
    const invoices = await page.evaluate(async () => { const { data } = await sb.from('invoices').select('*'); return data; });
    const pt = await page.evaluate(async () => { const { data } = await sb.from('patients').select('payment_status').eq('id', 'p1').maybeSingle(); return data; });
    const inv = invoices.find(i => i.invoice_type === 'lab');
    const ok = !!inv && inv.line_items?.[0]?.name === 'CBC (Full Blood Count)' && pt?.payment_status === 'unpaid';
    log('6b-cascade', ok ? 'PASS' : 'FAIL',
      `The lab order in 6b auto-generated its own invoice (invoice_type="${inv?.invoice_type}", line item "${inv?.line_items?.[0]?.name}") and flipped patients.payment_status to "${pt?.payment_status}" — even though this patient started the visit already "paid". This re-arms the payment gate for the doctor's NEXT order in the same visit, matching the app's own documented intent (a per-order charge, not a per-visit one).`);
    // Simulate billing clearing this new charge, the way a cashier would, so the
    // golden-path story can continue to place the radiology order below.
    await page.evaluate(async () => { await sb.from('patients').update({ payment_status: 'paid' }).eq('id', 'p1'); _docPt.payment_status = 'paid'; });
  }

  // --- 6c-guard: X-Ray for a childbearing-age female is blocked until pregnancy status is confirmed ---
  {
    await page.evaluate(() => switchOrderType('radiology', document.querySelectorAll('#doc-tab-orders .tabs .tab')[1]));
    await page.waitForTimeout(100);
    await page.selectOption('#ord-rad-type', 'X-Ray — Chest PA');
    await page.evaluate(() => updateOrdRadSafetyFields());
    const pregWrapShown = await page.evaluate(() => document.getElementById('ord-rad-pregnancy-wrap')?.style.display !== 'none');
    const before = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*'); return data.length; });
    await page.evaluate(() => submitRadOrder());
    await page.waitForTimeout(150);
    const after = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*'); return data.length; });
    const t = await lastToast(page);
    const ok = pregWrapShown && before === after && /pregnancy status must be confirmed/i.test(t || '');
    log('6c-guard', ok ? 'PASS' : 'FAIL',
      `For this female, age-34 patient + an X-Ray study, the pregnancy-status field appeared (shown=${pregWrapShown}) and submitting with it left unconfirmed was blocked: radiology_requests count unchanged (${before} → ${after}); toast: "${t}".`);
  }

  // --- 6c: place a real radiology order with clinical indication ---
  {
    await page.selectOption('#ord-rad-urgency', 'Routine');
    await page.fill('#ord-rad-indication', 'Persistent fever, rule out pneumonia');
    // Patient is female, age 34 (childbearing range per isFemaleChildbearing())
    // and an X-Ray was selected, so the safety-field parity gate
    // (updateOrdRadSafetyFields()) requires pregnancy status to be
    // explicitly confirmed before submission — this is real app behaviour
    // being exercised here, not a workaround for one.
    const pregWrapShown = await page.evaluate(() => document.getElementById('ord-rad-pregnancy-wrap')?.style.display !== 'none');
    if (pregWrapShown) await page.selectOption('#ord-rad-pregnancy-status', 'confirmed_not_pregnant');
    await page.evaluate(() => submitRadOrder());
    await page.waitForTimeout(250);
    const radReqs = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*'); return data; });
    const radDocOrders = await page.evaluate(async () => { const { data } = await sb.from('doctor_orders').select('*').eq('order_type', 'Radiology'); return data; });
    const r = radReqs[0];
    const ok = radReqs.length === 1 && r?.imaging_type === 'X-Ray — Chest PA' && r?.status === 'Requested' && !!r?.radiology_no && r?.pregnancy_status === 'confirmed_not_pregnant' && radDocOrders.length === 1;
    log('6c', ok ? 'PASS' : 'FAIL',
      `Switched to the Radiology order tab, requested "X-Ray — Chest PA" (Routine, with a clinical indication). The pregnancy-status safety gate correctly appeared for this female age-34 patient + X-Ray combination and was confirmed. radiology_requests row created: imaging_type="${r?.imaging_type}", status="${r?.status}", radiology_no="${r?.radiology_no}", pregnancy_status="${r?.pregnancy_status}". A mirrored doctor_orders row was also created (count=${radDocOrders.length}) so it appears in the unified Active Orders list.`);
  }

  // --- 6d: save a prescription (Rx tab) ---
  {
    await page.evaluate(() => switchDocTab('rx', document.querySelectorAll('#doc-tabs .tab')[3]));
    await page.waitForTimeout(100);
    await page.evaluate(() => addRxRow());
    await page.fill('#rx-drug-0', 'Paracetamol');
    await page.fill('#rx-dose-0', '500mg');
    await page.selectOption('#rx-route-0', 'PO');
    await page.fill('#rx-freq-0', 'QDS');
    await page.fill('#rx-dur-0', '5 days');
    await page.evaluate(() => savePrescription());
    await page.waitForTimeout(200);
    const rx = await page.evaluate(async () => { const { data } = await sb.from('prescriptions').select('*'); return data; });
    const item = rx[0]?.items?.[0];
    const ok = rx.length === 1 && item?.drug === 'Paracetamol' && item?.dose === '500mg' && item?.route === 'PO' && item?.freq === 'QDS';
    log('6d', ok ? 'PASS' : 'FAIL',
      `Added Paracetamol 500mg PO QDS x5 days on the Prescription tab and saved. Real prescriptions row created with items[0]=${JSON.stringify(item)}.`);
  }

  // --- 6e: Complete & Sign Off (declining the follow-up prompt) ---
  {
    await page.evaluate(() => switchDocTab('notes', document.querySelectorAll('#doc-tabs .tab')[0]));
    await page.waitForTimeout(100);
    await page.evaluate(() => completeAndSignOffVisit());
    await page.waitForTimeout(300);
    const consult = await page.evaluate(async () => { const { data } = await sb.from('doctor_consultations').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(); return data; });
    const pt = await page.evaluate(async () => { const { data } = await sb.from('patients').select('visit_status').eq('id', 'p1').maybeSingle(); return data; });
    const notesLocked = await page.evaluate(() => document.getElementById('doc-complaint')?.disabled === true);
    const badge = await page.evaluate(() => document.getElementById('doc-signoff-badge')?.textContent || '');
    const ok = consult?.is_signed_off === true && !!consult?.signed_off_by_name && pt?.visit_status === 'Visit Complete' && notesLocked && /Signed Off/i.test(badge);
    log('6e', ok ? 'PASS' : 'FAIL',
      `Clicked "Complete & Sign Off", declined the follow-up-scheduling prompt. doctor_consultations.is_signed_off=${consult?.is_signed_off} (signed_off_by_name="${consult?.signed_off_by_name}"), patients.visit_status="${pt?.visit_status}". Notes tab fields disabled after sign-off=${notesLocked}, badge text="${badge.trim()}".`);
  }

  // --- 6g: post-signoff visit lock — a further save is blocked, not silently accepted ---
  {
    const before = await page.evaluate(async () => { const { data } = await sb.from('doctor_consultations').select('*'); return data.length; });
    await page.evaluate(() => saveConsultation());
    await page.waitForTimeout(200);
    const after = await page.evaluate(async () => { const { data } = await sb.from('doctor_consultations').select('*'); return data.length; });
    const t = await lastToast(page);
    const ok = before === after && /signed off and locked/i.test(t || '');
    log('6g', ok ? 'PASS' : 'FAIL',
      `After sign-off, called saveConsultation() again on the same locked visit (fields are disabled in the real UI, so this simulates a stale/bypassed client attempt). doctor_consultations row count unchanged (${before} → ${after}); toast shown: "${t}" — guardVisitNotLocked() correctly re-checks the DB visit_status rather than trusting cached client state.`);
  }
  await page.close();

  // ─────────────────────────────────────────────────────────────
  // 6h: payment gate hard-blocks a Routine lab order for an unpaid patient
  // ─────────────────────────────────────────────────────────────
  {
    const page2 = await context.newPage();
    const unpaidPatient = {
      id: 'p2', name: 'Unpaid Patient', mrn: '502', age: 40, age_unit: 'y', sex: 'M',
      priority: 'Routine', source: 'OPD', payment_status: 'unpaid',
      visit_destination: 'Doctor', visit_status: 'Registered', tests_requested: [],
      created_at: new Date().toISOString(),
    };
    page2.on('dialog', async d => d.dismiss());
    await login(page2, baseUrl, 'doctor@audit.local', 'whatever', {
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Doctor', role: 'doctor' }], patients: [unpaidPatient] },
    });
    await page2.evaluate(() => goPage('consultation'));
    await page2.waitForTimeout(150);
    await page2.evaluate((p) => selectDocPatient(p), unpaidPatient);
    await page2.waitForTimeout(150);
    await page2.evaluate(() => switchDocTab('orders', document.querySelectorAll('#doc-tabs .tab')[2]));
    await page2.waitForTimeout(100);
    await page2.evaluate(() => {
      const cb = [...document.querySelectorAll('.order-test-chk')].find(c => c.value === 'CBC (Full Blood Count)');
      if (cb) cb.checked = true;
    });
    await page2.selectOption('#ord-lab-priority', 'Routine');
    await page2.evaluate(() => submitLabOrder());
    await page2.waitForTimeout(200);
    const orders = await page2.evaluate(async () => { const { data } = await sb.from('doctor_orders').select('*'); return data; });
    const t = await lastToast(page2);
    const ok = orders.length === 0 && /blocked/i.test(t || '') && /payment/i.test(t || '');
    log('6h', ok ? 'PASS' : 'FAIL',
      `Patient with payment_status="unpaid", Routine-priority lab order. No doctor_orders row was created (count=${orders.length}); toast shown: "${t}" — the hard payment-gate block (no STAT deferral offered for a Routine order) correctly prevented the order.`);
    await page2.close();
  }

  // ─────────────────────────────────────────────────────────────
  // 6i: STAT payment deferral lets the same unpaid patient's URGENT order
  // through, explicitly flagged rather than silently bypassing the gate
  // ─────────────────────────────────────────────────────────────
  {
    const page3 = await context.newPage();
    const unpaidStatPatient = {
      id: 'p3', name: 'Unpaid STAT Patient', mrn: '503', age: 55, age_unit: 'y', sex: 'F',
      priority: 'Routine', source: 'OPD', payment_status: 'unpaid',
      visit_destination: 'Doctor', visit_status: 'Registered', tests_requested: [],
      created_at: new Date().toISOString(),
    };
    let deferralPromptSeen = false;
    page3.on('dialog', async d => {
      if (d.message().includes('Grant payment deferral')) { deferralPromptSeen = true; await d.accept(); }
      else await d.dismiss();
    });
    await login(page3, baseUrl, 'doctor@audit.local', 'whatever', {
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Doctor', role: 'doctor' }], patients: [unpaidStatPatient] },
    });
    await page3.evaluate(() => goPage('consultation'));
    await page3.waitForTimeout(150);
    await page3.evaluate((p) => selectDocPatient(p), unpaidStatPatient);
    await page3.waitForTimeout(150);
    await page3.evaluate(() => switchDocTab('orders', document.querySelectorAll('#doc-tabs .tab')[2]));
    await page3.waitForTimeout(100);
    await page3.evaluate(() => {
      const cb = [...document.querySelectorAll('.order-test-chk')].find(c => c.value === 'CBC (Full Blood Count)');
      if (cb) cb.checked = true;
    });
    await page3.selectOption('#ord-lab-priority', 'STAT');
    await page3.evaluate(() => submitLabOrder());
    await page3.waitForTimeout(250);
    const orders = await page3.evaluate(async () => { const { data } = await sb.from('doctor_orders').select('*'); return data; });
    const o = orders[0];
    const ptAfter = await page3.evaluate(async () => { const { data } = await sb.from('patients').select('payment_status').eq('id', 'p3').maybeSingle(); return data; });
    const ok = deferralPromptSeen && orders.length === 1 && o?.payment_deferred === true && o?.payment_deferred_by_name === 'Dr. Audit Doctor' && ptAfter?.payment_status === 'unpaid';
    log('6i', ok ? 'PASS' : 'FAIL',
      `Same unpaid patient, this time STAT priority. The "Grant payment deferral?" confirm was shown (seen=${deferralPromptSeen}) and accepted; the order proceeded — doctor_orders row: payment_deferred=${o?.payment_deferred}, payment_deferred_by_name="${o?.payment_deferred_by_name}". Patient's own payment_status was correctly left untouched ("${ptAfter?.payment_status}") — a deferral, not a silent payment-status bypass.`);
    await page3.close();
  }

  // ─────────────────────────────────────────────────────────────
  // 6j: role access enforcement — a non-doctor role cannot reach Consultation
  // ─────────────────────────────────────────────────────────────
  {
    const page4 = await context.newPage();
    await login(page4, baseUrl, 'cashier@audit.local', 'whatever', {
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Cashier', role: 'cashier' }] },
      users: [{ id: 'u1', email: 'cashier@audit.local', password: 'whatever' }],
    });
    await page4.evaluate(() => goPage('consultation'));
    await page4.waitForTimeout(200);
    const consultActive = await page4.evaluate(() => document.getElementById('page-consultation')?.classList.contains('active'));
    const t = await lastToast(page4);
    const ok = consultActive === false && /access denied/i.test(t || '');
    log('6j', ok ? 'PASS' : 'FAIL',
      `Logged in as role="cashier" (not in ROLE_PAGES.cashier) and called goPage('consultation') directly. Page did NOT become active (active=${consultActive}); toast shown: "${t}" — client-side role gate correctly refused navigation (note per CLAUDE.md this is UX only, RLS is the real boundary).`);
    await page4.close();
  }

  return findings;
};
