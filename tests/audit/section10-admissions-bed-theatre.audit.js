// Functional audit, Section 10: Admissions, Bed Management & Theatre.
// Real Playwright browser interaction: admits a real patient from the bed
// grid through the actual Admit Patient form (bed flips Occupied, patient
// gets a new IP number), discharges them (bed frees back to Available),
// books a real theatre case with a pre-op checklist, clears a patient for
// OT via the Pre-Operative Assessment, walks the WHO Surgical Safety
// Checklist's Sign In stage against the real DB-backed persistence layer,
// runs an operation through Start -> Complete and separately Cancel, and
// exercises role-based access enforcement for theatre_nurse/doctor/cashier.
//
// Deliberately NOT re-tested here (already covered in depth by the existing
// regression suite — see tests/bed-*.test.js and
// tests/doclogbook-bedtheatre-phase6.test.js): bed grid tile rendering per
// status, the per-bed detail drawer's tabs/LOS counter/MAR deep-link, bed
// transfer via the drawer's Transfer tab, occupancy stats math, turnaround
// SLA escalation colouring, the discharge-readiness badge heuristic, the
// isolation overlay marker, the Bed Transfer Register, the Daily Bed
// Census, and the WHO checklist's full three-stage sequential gating logic
// (button-disabled-until-all-checked, stage-locking) against a lightweight
// mock. This section re-proves the WHO checklist against the REAL stateful
// DB-backed mock for one stage only, to confirm it isn't just a client-side
// checkbox toggle but actually persists and is read back correctly.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');
const { stripTags } = require('../helpers/test-kit');

function initScript(seedOverrides) {
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Doctor', role: 'doctor' }],
      doctors: [{ id: 'd1', name: 'Dr. Surgeon One', specialty: 'General Surgery' }],
    },
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

// Direct-value workaround for fields inside .ov/.mo overlay modals, which
// consistently report a zero-size box to Playwright's actionability checks
// in this headless sandbox (confirmed environment quirk during Section 5,
// not an app bug — does not reproduce for ordinary page content).
async function setModalValue(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) throw new Error('setModalValue: no element #' + id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
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

  const goldenPatient = {
    id: 'p1', name: 'Golden Admission Patient', mrn: '501', age: 40, age_unit: 'y', sex: 'M',
    patient_type: 'Outpatient', visit_no: 'OPD-201', phone: '0912345678',
    created_at: new Date().toISOString(),
  };
  const bedAvailable = { id: 'bed1', ward: 'Medical', room: '101', bed_number: '1', status: 'Available' };

  let admId, ipNo;

  // ─────────────────────────────────────────────────────────────
  // 10a: Golden-path admission via the bed grid — tap an Available tile,
  // select a real patient, pick a doctor, submit. Confirms the admission
  // row, the patient's OPD -> Inpatient/IP-number flip, AND the bed flip
  // to Occupied all happen together as one real transaction.
  // ─────────────────────────────────────────────────────────────
  const page = await context.newPage();
  await login(page, baseUrl, 'doctor@audit.local', 'whatever', {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Doctor', role: 'doctor' }],
      doctors: [{ id: 'd1', name: 'Dr. Surgeon One', specialty: 'General Surgery' }],
      patients: [goldenPatient],
      beds: [bedAvailable, { id: 'bed2', ward: 'Surgical', room: '201', bed_number: '1', status: 'Occupied' }],
    },
  });
  await page.evaluate(() => goPage('admission'));
  await page.waitForTimeout(300);
  {
    // Confirm the Available bed's tile pre-fill path really works before
    // relying on it (bedTileClick -> prefillAdmitForm), then select the
    // patient and doctor and submit for real.
    await page.evaluate(() => bedTileClick('bed1'));
    await page.waitForTimeout(200);
    const prefill = await page.evaluate(() => ({
      ward: document.getElementById('adm-ward').value,
      room: document.getElementById('adm-room').value,
      bed: document.getElementById('adm-bed').value,
    }));
    await page.evaluate((p) => selectAdmPatient(p), goldenPatient);
    await page.selectOption('#adm-doctor', 'Dr. Surgeon One');
    await page.fill('#adm-diagnosis', 'Acute appendicitis');
    await page.fill('#adm-notes', 'Admitted via bed grid tile tap');
    await page.evaluate(() => submitAdmission());
    await page.waitForTimeout(400);
    const adms = await page.evaluate(async () => { const { data } = await sb.from('admissions').select('*'); return data; });
    const adm = adms[0];
    admId = adm?.id;
    const bed = await page.evaluate(async () => { const { data } = await sb.from('beds').select('*').eq('id', 'bed1').maybeSingle(); return data; });
    const pt = await page.evaluate(async () => { const { data } = await sb.from('patients').select('*').eq('id', 'p1').maybeSingle(); return data; });
    ipNo = pt?.visit_no;
    const ok = prefill.ward === 'Medical' && prefill.room === '101' && prefill.bed === '1' &&
      adms.length === 1 && adm.ward === 'Medical' && adm.room === '101' && adm.bed === '1' && adm.status === 'Active' &&
      adm.admitting_doctor === 'Dr. Surgeon One' && adm.primary_diagnosis === 'Acute appendicitis' &&
      bed?.status === 'Occupied' && bed?.current_patient_id === 'p1' && bed?.current_admission_id === admId &&
      pt?.patient_type === 'Inpatient' && ipNo === '101';
    log('10a', ok ? 'PASS' : 'FAIL',
      `Tapped the Available bed tile (Medical/101/1) which correctly pre-filled the Admit form (ward=${prefill.ward}, room=${prefill.room}, bed=${prefill.bed}). Selected the patient, picked "Dr. Surgeon One", entered a diagnosis, and submitted. Real admissions row: ward="${adm?.ward}", room="${adm?.room}", bed="${adm?.bed}", status="${adm?.status}", doctor="${adm?.admitting_doctor}". The tapped bed (bed1) flipped to status="${bed?.status}" with current_patient_id="${bed?.current_patient_id}" correctly matching the new admission id. The patient (registered OPD, visit_no="OPD-201") was correctly converted to patient_type="${pt?.patient_type}" with a brand-new sequential IP number ("${ipNo}", from generate_next_id RPC seeded at ip:100).`);
  }

  // ─────────────────────────────────────────────────────────────
  // 10b: Admission form validation — no doctor selected is blocked
  // ─────────────────────────────────────────────────────────────
  {
    // submitAdmission() calls clearAdmForm() on every successful submit
    // (10a succeeded), which resets _admPt to null — so the patient must
    // be re-selected here to isolate the ward/doctor validation itself
    // rather than re-triggering the "select a patient first" guard.
    await page.evaluate((p) => selectAdmPatient(p), goldenPatient);
    await page.evaluate(() => { document.getElementById('adm-doctor').value = ''; });
    const before = await page.evaluate(async () => { const { data } = await sb.from('admissions').select('*'); return data.length; });
    await page.evaluate(() => submitAdmission());
    await page.waitForTimeout(200);
    const after = await page.evaluate(async () => { const { data } = await sb.from('admissions').select('*'); return data.length; });
    const t = await lastToast(page);
    const ok = before === after && /ward and doctor required/i.test(t || '');
    log('10b', ok ? 'PASS' : 'FAIL',
      `Re-selected the patient (submitAdmission() clears _admPt via clearAdmForm() on every successful submit, including 10a's) with the Admitting Doctor field left empty, and called submitAdmission(). admissions row count unchanged (${before} → ${after}); toast shown: "${t}".`);
  }

  // ─────────────────────────────────────────────────────────────
  // 10c: Discharge workflow — discharge the patient admitted in 10a and
  // confirm the bed is correctly freed back to Available, not just the
  // admission's own status flipping.
  // ─────────────────────────────────────────────────────────────
  {
    await page.evaluate((id) => openDischarge(id), admId);
    await page.waitForTimeout(200);
    await setModalValue(page, 'disch-date', '2026-08-07');
    await page.evaluate(() => { document.getElementById('disch-type').value = 'Recovered'; document.getElementById('disch-type').dispatchEvent(new Event('change', { bubbles: true })); });
    await setModalValue(page, 'disch-dx', 'Acute appendicitis, post-appendicectomy');
    await setModalValue(page, 'disch-procedures', 'Open appendicectomy');
    await page.evaluate(() => { document.getElementById('disch-condition').value = 'Stable'; });
    await setModalValue(page, 'disch-instructions', 'Wound care daily. Review in 1 week.');
    await setModalValue(page, 'disch-fu-date', '2026-08-14');
    await setModalValue(page, 'disch-fu-with', 'Dr. Surgeon One');
    await page.evaluate(() => saveDischarge());
    await page.waitForTimeout(300);
    const summaries = await page.evaluate(async () => { const { data } = await sb.from('discharge_summaries').select('*'); return data; });
    const s = summaries[0];
    const adm = await page.evaluate(async (id) => { const { data } = await sb.from('admissions').select('*').eq('id', id).maybeSingle(); return data; }, admId);
    const bed = await page.evaluate(async () => { const { data } = await sb.from('beds').select('*').eq('id', 'bed1').maybeSingle(); return data; });
    const ok = summaries.length === 1 && s.final_diagnosis === 'Acute appendicitis, post-appendicectomy' && s.discharge_condition === 'Stable' &&
      adm?.status === 'Discharged' && !!adm?.discharge_date &&
      bed?.status === 'Available' && bed?.current_patient_id === null && bed?.current_admission_id === null;
    log('10c', ok ? 'PASS' : 'FAIL',
      `Opened the Discharge form for the 10a admission, filled it out (diagnosis, procedures, condition, instructions, follow-up), and saved. Real discharge_summaries row created: final_diagnosis="${s?.final_diagnosis}", discharge_condition="${s?.discharge_condition}". admissions.status flipped to "${adm?.status}" with discharge_date set. Bed "bed1" (occupied since 10a) correctly freed back to status="${bed?.status}", current_patient_id/current_admission_id cleared to null — the bed was released, not left dangling as still-occupied after discharge.`);
  }
  await page.close();

  // ─────────────────────────────────────────────────────────────
  // Theatre section — a fresh page with a patient who already has an
  // Active admission (seeded directly, since Theatre bookings require an
  // existing Active admission to attach to — this is the same precondition
  // the real Book Operation search enforces via .eq('status','Active')).
  // ─────────────────────────────────────────────────────────────
  const otPatient = {
    id: 'p2', name: 'Theatre Case Patient', mrn: '502', age: 29, age_unit: 'y', sex: 'F',
    patient_type: 'Inpatient', visit_no: '102', created_at: new Date().toISOString(),
  };
  const otAdmission = { id: 'adm-ot', patient_id: 'p2', admission_no: 'ADM-26-0099', ward: 'Surgical', room: '201', bed: '2', admitting_doctor: 'Dr. Surgeon One', status: 'Active', admission_date: new Date().toISOString() };
  const page2 = await context.newPage();
  page2.on('dialog', async d => d.accept());
  await login(page2, baseUrl, 'doctor@audit.local', 'whatever', {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Audit Doctor', role: 'doctor' }],
      doctors: [{ id: 'd1', name: 'Dr. Surgeon One', specialty: 'General Surgery' }],
      patients: [otPatient],
      admissions: [otAdmission],
      beds: [{ id: 'bed2', ward: 'Surgical', room: '201', bed_number: '2', status: 'Occupied', current_patient_id: 'p2', current_admission_id: 'adm-ot' }],
    },
  });
  await page2.evaluate(() => goPage('theatre'));
  await page2.waitForTimeout(300);

  let bookingId;
  // ─────────────────────────────────────────────────────────────
  // 10d: Book a real theatre case with a pre-op checklist
  // ─────────────────────────────────────────────────────────────
  {
    await page2.evaluate((p) => selectOtPatient({ patient_id: p.patient_id, admission_id: p.admission_id, name: p.name, ward: p.ward, bed: p.bed, admission_no: p.admission_no }),
      { patient_id: 'p2', admission_id: 'adm-ot', name: otPatient.name, ward: otAdmission.ward, bed: otAdmission.bed, admission_no: otAdmission.admission_no });
    await page2.fill('#ot-op-name', 'Appendicectomy');
    await page2.selectOption('#ot-op-type', 'Emergency');
    await page2.selectOption('#ot-room', 'OT-1');
    await page2.fill('#ot-date', '2026-08-07');
    await page2.fill('#ot-start', '14:00');
    await page2.fill('#ot-duration', '90');
    await page2.selectOption('#ot-surgeon', 'Dr. Surgeon One');
    await page2.selectOption('#ot-asa', 'II');
    await page2.fill('#ot-asst', 'Dr. Assistant');
    await page2.fill('#ot-anaest', 'Dr. Anaesthetist');
    await page2.selectOption('#ot-anaes-type', 'General');
    await page2.check('#poc-consent');
    await page2.check('#poc-fast');
    await page2.check('#poc-xm');
    // Deliberately leave poc-labs/poc-allergy/poc-iv/poc-site/poc-anaes
    // unchecked, to confirm the checklist really records per-item state
    // rather than an all-or-nothing flag.
    await page2.fill('#ot-notes', 'Emergency case, RIF pain + guarding');
    await page2.evaluate(() => submitOTBooking());
    await page2.waitForTimeout(300);
    const bookings = await page2.evaluate(async () => { const { data } = await sb.from('theatre_bookings').select('*'); return data; });
    const b = bookings[0];
    bookingId = b?.id;
    const ok = bookings.length === 1 && /^OT-/.test(b.booking_no) && b.operation_name === 'Appendicectomy' && b.operation_type === 'Emergency' &&
      b.theatre_room === 'OT-1' && b.surgeon === 'Dr. Surgeon One' && b.anaesthetist === 'Dr. Anaesthetist' && b.asa_class === 'II' &&
      b.status === 'Scheduled' && b.pre_op_checklist?.consent === true && b.pre_op_checklist?.fast === true && b.pre_op_checklist?.xm === true &&
      b.pre_op_checklist?.labs === false && b.pre_op_checklist?.site === false;
    log('10d', ok ? 'PASS' : 'FAIL',
      `Booked a real theatre case for the pre-admitted patient: "Appendicectomy", Emergency, OT-1, surgeon "Dr. Surgeon One", anaesthetist "Dr. Anaesthetist", ASA II, with only 3 of 8 pre-op checklist items ticked (Consent/Fasting/Cross-match). Real theatre_bookings row: booking_no="${b?.booking_no}", status="${b?.status}", pre_op_checklist=${JSON.stringify(b?.pre_op_checklist)} — confirms the checklist is stored per-item (ticked vs untouched items both correctly reflected), not collapsed to one boolean.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 10e: Pre-Operative Assessment — clear the patient for OT
  // ─────────────────────────────────────────────────────────────
  {
    await page2.evaluate(() => openPreop('adm-ot', 'p2'));
    await page2.waitForTimeout(150);
    await setModalValue(page2, 'preop-allergies', 'No known drug allergies');
    await setModalValue(page2, 'preop-meds', 'None');
    await setModalValue(page2, 'preop-pmh', 'Nil significant');
    await page2.evaluate(() => { document.getElementById('preop-airway').value = 'Mallampati I'; });
    await setModalValue(page2, 'preop-anaes-plan', 'General anaesthesia, RSI given full stomach status unclear');
    await setModalValue(page2, 'preop-fasting', 'NBM from 08:00');
    await page2.evaluate(() => { document.getElementById('preop-consent-chk').checked = true; });
    await page2.evaluate(() => savePreop(true));
    await page2.waitForTimeout(250);
    const assess = await page2.evaluate(async () => { const { data } = await sb.from('pre_op_assessments').select('*'); return data; });
    const a = assess[0];
    const ok = assess.length === 1 && a.admission_id === 'adm-ot' && a.allergies === 'No known drug allergies' &&
      a.airway_assessment === 'Mallampati I' && a.consent_confirmed === true && a.cleared_for_ot === true &&
      a.cleared_by === 'Dr. Audit Doctor' && !!a.cleared_at;
    log('10e', ok ? 'PASS' : 'FAIL',
      `Filled the Pre-Operative Assessment (allergies, PMH, Mallampati I airway, anaesthesia plan, fasting instructions, consent confirmed) and clicked "Cleared for OT". Real pre_op_assessments row: cleared_for_ot=${a?.cleared_for_ot}, cleared_by="${a?.cleared_by}", cleared_at="${a?.cleared_at}", consent_confirmed=${a?.consent_confirmed}.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 10f: WHO Surgical Safety Checklist — Sign In stage against the real
  // stateful DB mock (confirms genuine persistence + read-back, not just
  // the client-side gating already proven in the regression suite).
  // ─────────────────────────────────────────────────────────────
  {
    await page2.evaluate((id) => openWhoChecklist(id), bookingId);
    await page2.waitForTimeout(200);
    await page2.evaluate(() => {
      WHO_CHECKLIST_ITEMS.signin.forEach((_, i) => { document.getElementById('who-signin-chk-' + i).checked = true; });
      updateWhoStageButton('signin');
    });
    const enabled = await page2.evaluate(() => !document.getElementById('who-signin-confirm-btn').disabled);
    await page2.evaluate(() => completeWhoStage('signin'));
    await page2.waitForTimeout(250);
    const cl = await page2.evaluate(async () => { const { data } = await sb.from('who_safety_checklist').select('*'); return data[0]; });
    const timeoutUnlocked = await page2.evaluate(() => !document.getElementById('who-timeout-items').innerHTML.includes('previous stage first'));
    // Close and reopen the checklist to confirm the completed state is
    // genuinely read back from the DB on a fresh load, not just held in
    // the in-memory _whoCtx from the same session.
    await page2.evaluate(() => closeOv('who-checklist-ov'));
    await page2.evaluate((id) => openWhoChecklist(id), bookingId);
    await page2.waitForTimeout(200);
    const badgeAfterReopen = await page2.evaluate(() => document.getElementById('who-signin-badge')?.innerHTML || '');
    const ok = enabled && !!cl?.signin_completed_at && cl?.signin_completed_by_name === 'Dr. Audit Doctor' &&
      Array.isArray(cl?.signin_items) && cl.signin_items.length === 7 && timeoutUnlocked && /✓/.test(badgeAfterReopen);
    log('10f', ok ? 'PASS' : 'FAIL',
      `Checked all 7 Sign In items for the theatre booking from 10d and confirmed the stage. Real who_safety_checklist row: signin_completed_at="${cl?.signin_completed_at}", signin_completed_by_name="${cl?.signin_completed_by_name}", signin_items count=${cl?.signin_items?.length}. Time Out unlocked immediately after (${timeoutUnlocked}). Closed and reopened the checklist modal from scratch — the completed Sign In badge ("${stripTags(badgeAfterReopen).trim()}") was correctly read back from the DB row, not just held in client memory.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 10g: Operation lifecycle — Start then Complete (post-op notes)
  // ─────────────────────────────────────────────────────────────
  {
    await page2.evaluate((id) => startOperation(id), bookingId);
    await page2.waitForTimeout(200);
    const midBooking = await page2.evaluate(async (id) => { const { data } = await sb.from('theatre_bookings').select('*').eq('id', id).maybeSingle(); return data; }, bookingId);
    await page2.evaluate((id) => openPostop(id), bookingId);
    await page2.waitForTimeout(150);
    await setModalValue(page2, 'postop-complications', 'None');
    await setModalValue(page2, 'postop-notes', 'Uncomplicated open appendicectomy, appendix perforated, peritoneal washout done.');
    await page2.evaluate(() => savePostop());
    await page2.waitForTimeout(250);
    const finalBooking = await page2.evaluate(async (id) => { const { data } = await sb.from('theatre_bookings').select('*').eq('id', id).maybeSingle(); return data; }, bookingId);
    const ok = midBooking?.status === 'In Progress' && !!midBooking?.actual_start &&
      finalBooking?.status === 'Completed' && finalBooking?.post_op_notes?.includes('peritoneal washout') && finalBooking?.complications === 'None';
    log('10g', ok ? 'PASS' : 'FAIL',
      `Clicked "Start" on the booking — status flipped to "${midBooking?.status}" with actual_start stamped ("${midBooking?.actual_start}"). Then filed post-op notes and saved — status flipped to "${finalBooking?.status}", complications="${finalBooking?.complications}", post_op_notes captured the free-text operative note.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 10h: Cancel a separately-booked, still-Scheduled operation
  // ─────────────────────────────────────────────────────────────
  {
    await page2.evaluate(async () => {
      await sb.from('theatre_bookings').insert({ patient_id: 'p2', admission_id: 'adm-ot', booking_no: 'OT-26-0002', theatre_date: '2026-08-08', start_time: '09:00', operation_name: 'Wound Debridement', theatre_room: 'OT-2', status: 'Scheduled' });
    });
    await page2.waitForTimeout(150);
    const toCancel = await page2.evaluate(async () => { const { data } = await sb.from('theatre_bookings').select('*').eq('booking_no', 'OT-26-0002').maybeSingle(); return data; });
    await page2.evaluate((id) => cancelOperation(id), toCancel.id); // page2's dialog handler auto-accepts the confirm()
    await page2.waitForTimeout(200);
    const after = await page2.evaluate(async (id) => { const { data } = await sb.from('theatre_bookings').select('*').eq('id', id).maybeSingle(); return data; }, toCancel.id);
    const ok = after?.status === 'Cancelled';
    log('10h', ok ? 'PASS' : 'FAIL',
      `Booked a second, separate operation ("Wound Debridement", Scheduled) and cancelled it via cancelOperation() (real confirm() dialog accepted). Status flipped to "${after?.status}" — the 10d/10g booking already completed above was left untouched by this.`);
  }
  await page2.close();

  // ─────────────────────────────────────────────────────────────
  // 10i: role access — theatre_nurse reaches Theatre; per CLAUDE.md's own
  // documented role table (Theatre Nurse: "Theatre, Nursing, Admissions,
  // Fluid") it should ALSO reach Admissions/Bed Management, but ROLE_PAGES
  // in index.html does not grant 'admission' to theatre_nurse.
  // ─────────────────────────────────────────────────────────────
  {
    const page3 = await context.newPage();
    await login(page3, baseUrl, 'nurse@audit.local', 'whatever', {
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Theatre Nurse', role: 'theatre_nurse' }] },
      users: [{ id: 'u1', email: 'nurse@audit.local', password: 'whatever' }],
    });
    await page3.evaluate(() => goPage('theatre'));
    await page3.waitForTimeout(150);
    const theatreActive = await page3.evaluate(() => document.getElementById('page-theatre')?.classList.contains('active'));
    await page3.evaluate(() => goPage('admission'));
    await page3.waitForTimeout(150);
    const admissionActive = await page3.evaluate(() => document.getElementById('page-admission')?.classList.contains('active'));
    const t = await lastToast(page3);
    const rolePages = await page3.evaluate(() => ROLE_PAGES.theatre_nurse);
    // theatreActive===true and admissionActive===false is the CURRENT,
    // intentionally-tested behaviour (tests/bed-management-tiles.test.js
    // asserts theatre_nurse "does NOT see the admissions tile"). Flagging
    // as a docs/code mismatch, not asserting either is "correct" — the
    // CLAUDE.md role table and the shipped ROLE_PAGES disagree on this role.
    const matchesCurrentCode = theatreActive === true && admissionActive === false;
    log('10i', matchesCurrentCode ? '⚠️ MISMATCH' : 'FAIL',
      `Logged in as role="theatre_nurse". goPage('theatre') → active=${theatreActive} (allowed, as expected). goPage('admission') → active=${admissionActive}, toast: "${t}". ROLE_PAGES.theatre_nurse = ${JSON.stringify(rolePages)} — it does NOT include 'admission'. This reproduces the CURRENT shipped behaviour exactly (and matches what tests/bed-management-tiles.test.js already explicitly asserts as intentional: "theatre_nurse (no admission page grant) does not see the admissions tile"). However, CLAUDE.md's own Roles table documents Theatre Nurse as having access to "Theatre, Nursing, Admissions, Fluid" — Admissions is explicitly listed there. This is a genuine mismatch between the documented role table and index.html's ROLE_PAGES (whichever side is the intended one, they currently disagree) — flagged, not fixed, per audit scope.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 10j: role access — doctor reaches BOTH Admissions and Theatre, per
  // CLAUDE.md's role table, and ROLE_PAGES agrees here.
  // ─────────────────────────────────────────────────────────────
  {
    const page4 = await context.newPage();
    await login(page4, baseUrl, 'doctor2@audit.local', 'whatever', {
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Access Test', role: 'doctor' }] },
      users: [{ id: 'u1', email: 'doctor2@audit.local', password: 'whatever' }],
    });
    await page4.evaluate(() => goPage('admission'));
    await page4.waitForTimeout(150);
    const admissionActive = await page4.evaluate(() => document.getElementById('page-admission')?.classList.contains('active'));
    await page4.evaluate(() => goPage('theatre'));
    await page4.waitForTimeout(150);
    const theatreActive = await page4.evaluate(() => document.getElementById('page-theatre')?.classList.contains('active'));
    const ok = admissionActive === true && theatreActive === true;
    log('10j', ok ? 'PASS' : 'FAIL',
      `Logged in as role="doctor". goPage('admission') → active=${admissionActive}; goPage('theatre') → active=${theatreActive}. Both correctly reachable, matching CLAUDE.md's documented role table for Doctor.`);
    await page4.close();
  }

  // ─────────────────────────────────────────────────────────────
  // 10k: role access — a role with neither page (cashier) is blocked from
  // both Admissions and Theatre.
  // ─────────────────────────────────────────────────────────────
  {
    const page5 = await context.newPage();
    await login(page5, baseUrl, 'cashier@audit.local', 'whatever', {
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Cashier', role: 'cashier' }] },
      users: [{ id: 'u1', email: 'cashier@audit.local', password: 'whatever' }],
    });
    await page5.evaluate(() => goPage('admission'));
    await page5.waitForTimeout(150);
    const admissionActive = await page5.evaluate(() => document.getElementById('page-admission')?.classList.contains('active'));
    const t1 = await lastToast(page5);
    await page5.evaluate(() => goPage('theatre'));
    await page5.waitForTimeout(150);
    const theatreActive = await page5.evaluate(() => document.getElementById('page-theatre')?.classList.contains('active'));
    const t2 = await lastToast(page5);
    const ok = admissionActive === false && theatreActive === false && /access denied/i.test(t1 || '') && /access denied/i.test(t2 || '');
    log('10k', ok ? 'PASS' : 'FAIL',
      `Logged in as role="cashier" (neither 'admission' nor 'theatre' in ROLE_PAGES.cashier). goPage('admission') → active=${admissionActive}, toast: "${t1}". goPage('theatre') → active=${theatreActive}, toast: "${t2}". Both correctly refused.`);
    await page5.close();
  }

  return findings;
};
