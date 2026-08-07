// Functional audit, Section 13: Documentation/Logbook.
// Real Playwright browser interaction against the real app. This module was
// already built out across 6 dedicated phases with their own regression
// suites (tests/doclogbook-*.test.js) and several pieces were already
// exercised in depth by other sections (Section 7: SBAR handover save,
// Section 9: Radiology reports, Section 10: Theatre/WHO checklist,
// Section 12: Inventory wastage/transfer). Per the audit brief, this
// section focuses on the one piece nothing else has driven end-to-end yet:
//   (13a) the doctor's real search->select->Consent-tab path, PLUS a real
//         bug discovered while building that path: the Consultation page's
//         search box wires its result rows to selectDocPatient() with only
//         a bare id STRING (not the patient object every other call site
//         passes), and #doc-search-results — the element the function
//         checks for first — does not exist anywhere in the DOM, so the
//         search path silently falls back onto the shared #doc-queue-body
//         list and overwrites it with the broken-argument rendering;
//   (13b) the full Digital Informed Consent golden path (validation order,
//         canvas e-signature, save, list, print) via the WORKING path
//         (the default patient queue, whose cards do pass the full object);
//   (13c) a second real bug this surfaced: consent_forms.admission_id is
//         populated from the shared global _currentAdmId, which nothing
//         resets when switching patients within Consultation — so a
//         consent form signed for Patient B can silently record Patient
//         A's admission if the doctor merely glanced at Patient A's
//         Admissions detail drawer earlier in the same session;
//   (13d) cross-cutting: does a consent form show "who created it and
//         when" consistently (own performed_by/performed_by_name columns,
//         same as everywhere else) and does it appear in the one place a
//         hospital record's whole history is meant to be visible — the
//         Patient History Timeline (pth-timeline) — which aggregates
//         admissions/criticals/radiology/invoices/consultations/labs but,
//         confirmed live below, never queries consent_forms at all;
//   (13e) cross-cutting: consent's print output shares the exact same
//         printHeader()/printFooter()/openPrintWin() chrome as another
//         Documentation/Logbook document type (Nursing's SBAR handover
//         note), confirming one consistent print/export convention;
//   (13f) there is no dedicated "Documentation/Logbook" landing/index page
//         anywhere in the sidebar — confirmed live, not just by grep — the
//         various document types (Consent, SBAR handover, WHO checklist,
//         wastage log, etc.) are genuinely embedded inside their owning
//         modules, matching what the CLAUDE.md role table implies;
//   (13g) light corroborating role-access spot check (nurse role cannot
//         reach Consultation, so cannot reach Consent, at all);
//   (13h) printing a nonexistent consent id fails gracefully.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function initScript(seedOverrides) {
  const seed = {
    tables: {},
    users: [],
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

// Same signature-pad driving technique as the doclogbook-doctor-phase2.test.js
// regression suite this section deliberately does not re-run.
async function drawSignature(page) {
  const pad = page.locator('#con-sig-pad');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 60, { steps: 5 });
  await page.mouse.move(box.x + 180, box.y + 30, { steps: 5 });
  await page.mouse.up();
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  const patientB = { id: 'pB', name: 'Zephyr Consent Patient', first_name: 'Zephyr', last_name: 'Consent Patient', mrn: 'ZC-2001', age: 34, age_unit: 'y', sex: 'F', source: 'OPD', payment_status: 'paid', visit_destination: 'Doctor', visit_status: 'Registered', tests_requested: [], diagnosis: 'Suspected appendicitis', created_at: new Date().toISOString() };
  const patientA = { id: 'pA', name: 'Admitted Leak Patient A', first_name: 'Admitted', last_name: 'Leak Patient A', mrn: 'AL-3001', age: 50, age_unit: 'y', sex: 'M', source: 'IP', payment_status: 'paid', visit_destination: 'Admission', visit_status: 'Registered', tests_requested: [], created_at: new Date().toISOString() };
  const admissionA = { id: 'adm-A', patient_id: 'pA', ward: 'Male Ward', room: '1', bed: 'B1', admission_no: 'IP-3001', admission_date: new Date().toISOString(), admission_type: 'Emergency', admitting_doctor: 'Dr. Consent Flow', primary_diagnosis: 'Pneumonia', status: 'Active', notes: '' };

  const seed = {
    tables: {
      staff: [{ id: 's-doc', user_id: 'u-doc', full_name: 'Dr. Consent Flow', role: 'doctor' }],
      patients: [patientB, patientA],
      admissions: [admissionA],
    },
    users: [{ id: 'u-doc', email: 'doctor@doclog.local', password: 'whatever' }],
  };

  const page = await context.newPage();
  await firstLoad(page, baseUrl, seed, 'doctor@doclog.local', 'whatever');

  // ═════════════════════════════════════════════════════════════════
  // 13a: real search->select path (BUG discovered by driving it for real)
  // ═════════════════════════════════════════════════════════════════
  let searchResultAttr = null, docPtAfterSearchClick = null;
  {
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(200);
    const noResultsElExists = await page.evaluate(() => !!document.getElementById('doc-search-results'));
    await page.fill('#doc-search', 'Zephyr');
    await page.waitForTimeout(400);
    const queueHtml = await page.evaluate(() => document.getElementById('doc-queue-body').innerHTML);
    const rowFound = queueHtml.includes(patientB.mrn) || queueHtml.includes('Zephyr');
    const onclickMatch = queueHtml.match(/onclick="selectDocPatient\(([^)]*)\)"/);
    searchResultAttr = onclickMatch ? onclickMatch[1] : null;
    const passesBareIdString = !!searchResultAttr && /^'[^']*'$/.test(searchResultAttr) && !searchResultAttr.includes('{');

    // Real DOM click, not an evaluate() shortcut — this is exactly what a
    // doctor typing a search query and clicking the result actually does.
    // (targets a tbody row specifically — the rendered table's first <tr>
    // in document order is actually the <thead> header row, which has no
    // onclick handler at all)
    await page.click('#doc-queue-body tbody tr');
    await page.waitForTimeout(150);
    docPtAfterSearchClick = await page.evaluate(() => ({
      type: typeof _docPt,
      value: _docPt,
      idViaOptionalChain: _docPt?.id,
      bannerDisplay: document.getElementById('doc-pt-banner').style.display,
      nameShown: document.getElementById('doc-pt-name').textContent,
      hiddenIdField: document.getElementById('doc-pt-id').value,
    }));
    const bugReproduced = docPtAfterSearchClick.type === 'string' && docPtAfterSearchClick.idViaOptionalChain === undefined && docPtAfterSearchClick.hiddenIdField === '';

    log('13a', bugReproduced ? '🚫 BUG FOUND' : 'PASS',
      `Confirmed live (not just by reading code): #doc-search-results — the element searchDocPatient() looks for first — does not exist in the DOM (found=${noResultsElExists}), so it falls back to the SAME #doc-queue-body the normal patient queue renders into. Typing "Zephyr" into the real #doc-search box (oninput->searchDocPatient) correctly found and rendered "${patientB.name}" (${rowFound}), but the rendered row's onclick handler is "selectDocPatient(${searchResultAttr})" — a bare id STRING, unlike every other patient-card render site in this app (doctor queue, blood bank, etc.) which JSON.stringify()s the whole patient object (bareIdString=${passesBareIdString}). Actually clicking that row with a real mouse click reproduces the break: _docPt becomes typeof "${docPtAfterSearchClick.type}" holding just the raw id (${JSON.stringify(docPtAfterSearchClick.value)}), so _docPt?.id is ${docPtAfterSearchClick.idViaOptionalChain} and the hidden #doc-pt-id field is left empty ("${docPtAfterSearchClick.hiddenIdField}") even though the patient banner still visually shows (display=${docPtAfterSearchClick.bannerDisplay}, name shown="${docPtAfterSearchClick.nameShown}") — giving the doctor no visual sign anything is wrong. Every downstream Consultation feature keyed off _docPt.id (Consent, Orders, Rx, Sick Leave, Referral, Discharge) silently no-ops or shows "Select a patient first" from this point on. index.html ~line 14117 (searchDocPatient's row render) is the one call site out of step with ~line 9776's correct pattern.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 13b: the actual Digital Informed Consent golden path, via the WORKING
  // selection path (the default/unfiltered patient queue card, whose
  // onclick correctly passes the full JSON patient object).
  // ═════════════════════════════════════════════════════════════════
  let consentIdSaved = null;
  {
    await page.reload({ waitUntil: 'load' });
    await loginAs(page, 'doctor@doclog.local', 'whatever');
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(250);
    // Click the real queue card for Patient B (not the search box this time).
    const clicked = await page.evaluate((mrn) => {
      const cards = [...document.querySelectorAll('#doc-queue-body .doc-queue-card')];
      const card = cards.find(c => c.textContent.includes(mrn));
      if (card) { card.click(); return true; }
      return false;
    }, patientB.mrn);
    await page.waitForTimeout(200);
    const docPtOk = await page.evaluate(() => typeof _docPt === 'object' && _docPt?.id === 'pB');

    await page.evaluate(() => switchDocTab('consent', null));
    await page.waitForTimeout(150);
    const canvasVisible = await page.evaluate(() => getComputedStyle(document.getElementById('doc-tab-consent')).display !== 'none' && !!document.getElementById('con-sig-pad'));

    // Validation order: procedure -> signee name -> signature, each blocking a real insert.
    await page.evaluate(() => saveConsentForm());
    await page.waitForTimeout(100);
    const rowsAfterEmpty = await page.evaluate(async () => (await sb.from('consent_forms').select('*')).data.length);
    const blockedEmpty = rowsAfterEmpty === 0;

    await page.fill('#con-procedure', 'Appendectomy under general anaesthesia');
    await page.evaluate(() => saveConsentForm());
    await page.waitForTimeout(100);
    const blockedNoSignee = (await page.evaluate(async () => (await sb.from('consent_forms').select('*')).data.length)) === 0;

    await page.fill('#con-signee-name', 'Patient Self');
    await page.evaluate(() => saveConsentForm());
    await page.waitForTimeout(100);
    const blockedNoSignature = (await page.evaluate(async () => (await sb.from('consent_forms').select('*')).data.length)) === 0;

    log('13b-validation', (clicked && docPtOk && canvasVisible && blockedEmpty && blockedNoSignee && blockedNoSignature) ? 'PASS' : 'FAIL',
      `Clicked "${patientB.name}"'s real queue card (full-object onclick path, not the broken search one)=${clicked}, correctly populated _docPt as a real object=${docPtOk}. Switched to the Consent tab: canvas-based signature pad rendered=${canvasVisible}. Saving with nothing filled in was blocked (0 rows)=${blockedEmpty}; with only the procedure filled, still blocked pending signee name=${blockedNoSignee}; with procedure+signee filled but no signature drawn, still blocked=${blockedNoSignature} — confirms the three required-field guards (procedure, signee name, signature) all genuinely gate the real insert, not just show a toast alongside a save that happens anyway.`);

    // Now complete it properly.
    await page.selectOption('#con-type', 'Anaesthesia');
    await page.fill('#con-risks', 'Nausea, sore throat, rare cardiac/respiratory risk — discussed with patient.');
    await page.fill('#con-relationship', 'Self');
    await page.fill('#con-witness', 'Nurse Witness Test');
    await drawSignature(page);
    const sigCaptured = await page.evaluate(() => _consentHasSignature === true && document.getElementById('con-sig-status').textContent.includes('captured'));
    await page.evaluate(() => saveConsentForm());
    await page.waitForTimeout(200);

    const rows = await page.evaluate(async () => (await sb.from('consent_forms').select('*')).data);
    const row = rows[0];
    consentIdSaved = row?.id;
    const fieldsOk = row && row.patient_id === 'pB' && row.admission_id === null &&
      row.consent_type === 'Anaesthesia' && row.procedure_description === 'Appendectomy under general anaesthesia' &&
      row.risks_explained.includes('Nausea') && row.signee_name === 'Patient Self' && row.signee_relationship === 'Self' &&
      row.witnessed_by === 'Nurse Witness Test' &&
      typeof row.signature_data_url === 'string' && row.signature_data_url.startsWith('data:image/png') &&
      row.performed_by_name === 'Dr. Consent Flow' && !!row.created_at;
    const clearedAfterSave = await page.evaluate(() => _consentHasSignature === false && document.getElementById('con-procedure').value === '');

    await page.waitForTimeout(200);
    const listHtml = await page.evaluate(() => document.getElementById('con-list-body').innerHTML);
    const listOk = listHtml.includes('Anaesthesia') && listHtml.includes('Signed') && listHtml.includes('Dr. Consent Flow') && listHtml.includes('Patient Self');

    log('13b-save', (sigCaptured && fieldsOk && clearedAfterSave && listOk) ? 'PASS' : 'FAIL',
      `Drew a real mouse signature on the canvas (captured=${sigCaptured}). Filled consent type "Anaesthesia", risks, relationship "Self", witness "Nurse Witness Test" and saved. The real consent_forms row: patient_id=${row?.patient_id}, admission_id=${JSON.stringify(row?.admission_id)} (correctly null — Patient B has no active admission), consent_type=${row?.consent_type}, signature_data_url is a real captured PNG=${typeof row?.signature_data_url === 'string' && row?.signature_data_url.startsWith('data:image/png')}, performed_by_name=${row?.performed_by_name}, created_at=${row?.created_at} — all fields correct=${fieldsOk}. Form + pad reset after save=${clearedAfterSave}. The "Signed Consent Forms — This Patient" list re-rendered with a "✓ Signed" badge, the consent type, signer, and the recording doctor's name=${listOk}.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // print the just-saved consent form and inspect the real print window
  // content, and compare its chrome against another Doc/Logbook document
  // type (SBAR handover note) for a consistent export/print convention.
  // ═════════════════════════════════════════════════════════════════
  {
    let capturedHtml = null, capturedTitle = null;
    await page.evaluate(() => {
      window.__capturedPrint = null;
      window.open = (url, name, feat) => {
        const fakeDoc = { write: (h) => { window.__capturedPrint = h; }, close: () => {} };
        return { document: fakeDoc, focus: () => {} };
      };
    });
    await page.evaluate((id) => printConsentForm(id), consentIdSaved);
    await page.waitForTimeout(150);
    capturedHtml = await page.evaluate(() => window.__capturedPrint);

    const printContentOk = capturedHtml && [patientB.name, patientB.mrn, 'Anaesthesia', 'Appendectomy under general anaesthesia', 'Nausea', 'Patient Self', 'Self', 'Nurse Witness Test', 'data:image/png', 'Dr. Consent Flow'].every(s => capturedHtml.includes(s));
    const sharedChromeOk = capturedHtml && capturedHtml.includes('FRIENDSHIP HOSPITAL') && capturedHtml.includes('Digital Informed Consent') && /Printed:.*By:/s.test(capturedHtml.replace(/\n/g,' '));

    log('13b-print', (printContentOk && sharedChromeOk) ? 'PASS' : 'FAIL',
      `Stubbed window.open to capture what printConsentForm() actually writes. The printed document includes the patient name+MRN, consent type, procedure description, risks text, signee name+relationship, witness, the recorded doctor, AND the real captured signature image (an embedded data:image/png, not a placeholder)=${printContentOk}. It uses the same shared printHeader()/printFooter() hospital letterhead + "Printed: … | By: …" chrome as every other document in the app=${sharedChromeOk}.`);

    // Compare against the Nursing Phase 3 SBAR handover note's print output
    // (a different Documentation/Logbook document type, different module,
    // different author role) to confirm one consistent export convention.
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      ['ho-ward','ho-shift','ho-date','ho-from','ho-to','ho-situation','ho-background','ho-assessment','ho-recommendation','ho-notes'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value = id==='ho-date' ? new Date().toISOString().slice(0,10) : ('Test '+id); });
    });
    await page.evaluate(() => { window.__capturedPrint = null; });
    await page.evaluate(() => printHandoverNote());
    await page.waitForTimeout(150);
    const handoverHtml = await page.evaluate(() => window.__capturedPrint);
    const sameFooterMarker = handoverHtml && /Printed:.*By:/s.test(handoverHtml.replace(/\n/g,' '));
    // Extract just the shared printHeader() markup itself (the hospital
    // name/address/contact block, which is identical regardless of
    // docType) out of each captured document — rather than comparing the
    // two captured HTML strings from their start, which would also (and
    // irrelevantly) diff on openPrintWin()'s own per-call <title> tag text.
    const extractHeaderBlock = (html) => { const m = html && html.match(/<div style="border-bottom:2px solid #0b7a75[\s\S]*?Blue Nile State, Sudan<\/div>/); return m ? m[0] : null; };
    const consentHeaderBlock = extractHeaderBlock(capturedHtml);
    const handoverHeaderBlock = extractHeaderBlock(handoverHtml);
    const bothIdenticalHeaderStructure = !!consentHeaderBlock && consentHeaderBlock === handoverHeaderBlock;
    const sameHeaderMarker = handoverHtml && handoverHtml.includes('FRIENDSHIP HOSPITAL') && handoverHtml.includes('border-bottom:2px solid #0b7a75');

    log('13e', (sameHeaderMarker && sameFooterMarker && bothIdenticalHeaderStructure) ? 'PASS' : 'FAIL',
      `Printed a second, unrelated Documentation/Logbook document type from a different module/role — Nursing's SBAR handover note (printHandoverNote()) — and compared its captured output against the consent form's. Both share the exact same hospital-letterhead header markup byte-for-byte up to the doc-type label=${bothIdenticalHeaderStructure}, and both carry the same "Printed: <timestamp> | By: <staff>" footer convention=${sameFooterMarker}. Confirms one consistent printHeader()/printFooter()/openPrintWin() export convention across Documentation/Logbook document types authored by different roles (Doctor vs Nurse), not a one-off for consent.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 13c: BUG — consent_forms.admission_id leaks a DIFFERENT patient's
  // admission via the shared _currentAdmId global, which nothing resets
  // when Consultation switches to a new patient (unlike the Discharge tab,
  // which was already fixed to resolve its own admission per Phase 0).
  // ═════════════════════════════════════════════════════════════════
  {
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(150);
    // A doctor merely opening Patient A's admission detail drawer (a
    // completely ordinary, read-heavy action) sets the shared global.
    await page.evaluate((admId) => openAdmDetail(admId), admissionA.id);
    await page.waitForTimeout(250);
    const admIdSetTo = await page.evaluate(() => _currentAdmId);
    // Close the drawer normally, as any real doctor would once done
    // reviewing it — closeAdmDetail() only clears its own local UI state
    // (_admDetailCtx, the LOS timer, the .open overlay class); it does NOT
    // reset _currentAdmId, which is the entire point being tested here.
    await page.evaluate(() => closeAdmDetail());
    await page.waitForTimeout(100);

    // Doctor moves on to Consultation and picks a DIFFERENT, non-admitted
    // patient (B) — never touching the Discharge tab (the only tab that
    // resolves _currentAdmId for itself).
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(200);
    await page.evaluate((mrn) => {
      const cards = [...document.querySelectorAll('#doc-queue-body .doc-queue-card')];
      const card = cards.find(c => c.textContent.includes(mrn));
      if (card) card.click();
    }, patientB.mrn);
    await page.waitForTimeout(150);
    await page.evaluate(() => switchDocTab('consent', null));
    await page.waitForTimeout(150);

    await page.fill('#con-procedure', 'Wound debridement');
    await page.fill('#con-signee-name', 'Patient Self');
    await drawSignature(page);
    await page.evaluate(() => saveConsentForm());
    await page.waitForTimeout(200);

    const rows = await page.evaluate(async () => (await sb.from('consent_forms').select('*')).data);
    const leakRow = rows.find(r => r.procedure_description === 'Wound debridement');
    const leaked = leakRow && leakRow.patient_id === 'pB' && leakRow.admission_id === admissionA.id;

    log('13c', leaked ? '🚫 BUG FOUND' : 'PASS (not reproduced)',
      `Opened Patient A's ("${patientA.name}") admission detail drawer from the Admissions page (an ordinary read action) — this set the shared global _currentAdmId="${admIdSetTo}" (index.html openAdmDetail(), ~line 8974). Without ever visiting the Discharge tab (the only Consent-adjacent tab that resolves _currentAdmId for the CURRENT patient — see the Phase 0 bug-fix comment at ~line 10189), navigated to Consultation and signed a new consent form for a completely different, non-admitted patient, "${patientB.name}". The saved row: patient_id=${leakRow?.patient_id}, admission_id=${leakRow?.admission_id} — recorded against Patient A's admission (${admissionA.id}) even though the consent is for Patient B and Patient B has no admission at all. saveConsentForm() (index.html ~line 14047) reads admission_id:_currentAdmId||null directly rather than resolving it for _docPt the same way loadDischargeTabAdmission() now does — a real cross-patient data-integrity bug in a legally significant document, reachable via an entirely ordinary sequence of clicks a busy doctor could plausibly make on a shared workstation.`);
  }

  await page.close();

  // ═════════════════════════════════════════════════════════════════
  // 13d: cross-cutting — does the signed consent form surface in the
  // Patient History Timeline (the one place a patient's whole record is
  // meant to be visible), and does it double-log into app_audit_logs?
  // ═════════════════════════════════════════════════════════════════
  {
    const page2 = await context.newPage();
    const pt = { id: 'p-th', name: 'Timeline Consent Patient', mrn: 'TH-4001', age: 40, age_unit: 'y', sex: 'M', created_at: new Date().toISOString(), visit_status: 'Registered', tests_requested: [] };
    const consentRow = { id: 'cf-th', patient_id: 'p-th', consent_type: 'Surgical Procedure', consent_date: new Date().toISOString().slice(0, 10), procedure_description: 'Herniorrhaphy', signee_name: 'Patient Self', performed_by_name: 'Dr. Timeline Test', created_at: new Date().toISOString() };
    const admissionRow = { id: 'adm-th', patient_id: 'p-th', ward: 'Surgical', room: '2', bed: 'B2', admission_no: 'IP-4001', admission_date: new Date().toISOString(), status: 'Active', admitting_doctor: 'Dr. Timeline Test' };
    const invoiceRow = { id: 'inv-th', patient_id: 'p-th', invoice_no: 'INV-4001', net_amount: 500, currency: 'SDG', payment_status: 'paid', created_at: new Date().toISOString() };
    await page2.addInitScript(initScript({
      tables: {
        staff: [{ id: 's-adm', user_id: 'u-adm', full_name: 'Audit Admin', role: 'admin' }],
        patients: [pt],
        consent_forms: [consentRow],
        admissions: [admissionRow],
        invoices: [invoiceRow],
        app_audit_logs: [],
      },
      users: [{ id: 'u-adm', email: 'admin@doclog.local', password: 'whatever' }],
    }));
    await page2.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page2, 'admin@doclog.local', 'whatever');
    await page2.evaluate(() => goPage('pt-history'));
    await page2.waitForTimeout(150);
    await page2.evaluate((p) => selectPthPatient(p), pt);
    await page2.waitForTimeout(400);
    const timelineHtml = await page2.evaluate(() => document.getElementById('pth-timeline').innerHTML);
    const invoiceShown = timelineHtml.includes('INV-4001') || /invoice/i.test(timelineHtml);
    const admissionShown = /admit/i.test(timelineHtml);
    const consentShown = timelineHtml.includes('Herniorrhaphy') || /consent/i.test(timelineHtml);

    // Cross-check: did saving a consent form ALSO write to app_audit_logs
    // (the cross-cutting log used by Bed Management/Theatre/Nursing/
    // Radiology/Blood Bank), or does it rely solely on its own
    // performed_by/performed_by_name/created_at columns (same convention,
    // per the code's own design-intent comment at ~line 6577)?
    const auditLogRows = await page2.evaluate(async () => (await sb.from('app_audit_logs').select('*')).data);

    log('13d', (invoiceShown && admissionShown && !consentShown) ? '⚠️ GAP FOUND' : (invoiceShown && admissionShown && consentShown ? 'PASS' : 'FAIL'),
      `Seeded one patient with a signed consent form, an active admission, and a paid invoice, then opened the real Patient History Timeline page (loadPthTimeline(), index.html ~line 11630) — the one page whose entire job is aggregating a patient's full record. The admission correctly appears (${admissionShown}) and the invoice correctly appears (${invoiceShown}), confirming the aggregator itself works and rendered live — but the signed consent form never appears anywhere in the timeline (consentShown=${consentShown}): loadPthTimeline()'s Promise.all() queries admissions/critical_values/radiology_requests/invoices/doctor_consultations/results_*_history but never consent_forms. A legally significant signed document is invisible from the one screen (Doctor and Lab Supervisor and Admin all have 'pt-history' access) meant to show a patient's whole record at a glance. Separately, the consent save does NOT also write to the cross-cutting app_audit_logs table (rows=${auditLogRows.length}) — but per the code's own documented design intent this is by choice, not a gap: consent_forms already carries its own performed_by/performed_by_name/created_at directly on the row (same pattern WHO Checklist and Radiology Verify use), which is exactly the "already do [have an audit trail], via performed_by/verified_at columns directly on their own rows" case app_audit_logs was deliberately NOT extended to duplicate.`);
    await page2.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 13f: confirm live there is genuinely no dedicated "Documentation" /
  // "Logbook" landing page anywhere in the sidebar for any role — the
  // various document types are embedded inside their owning modules.
  // ═════════════════════════════════════════════════════════════════
  {
    const page3 = await context.newPage();
    await page3.addInitScript(initScript({
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Sidebar Check Admin', role: 'admin' }] },
      users: [{ id: 'u1', email: 'admin2@doclog.local', password: 'whatever' }],
    }));
    await page3.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page3, 'admin2@doclog.local', 'whatever');
    const sidebarText = await page3.evaluate(() => document.getElementById('sidebar')?.innerText || '');
    const hasLogbookOrDocPage = /logbook|documentation\s*module|documentation\s*center/i.test(sidebarText);
    const consentReachableFromConsultation = await page3.evaluate(() => {
      const items = [...document.querySelectorAll('#sidebar .sb-item')].map(e => e.getAttribute('data-p'));
      return items.includes('consultation');
    });
    log('13f', (!hasLogbookOrDocPage && consentReachableFromConsultation) ? 'PASS (confirmed, informational)' : 'FAIL',
      `Live sidebar scan (admin role, sees every module) confirms there is no standalone "Documentation" / "Logbook" landing page — the sidebar has no such entry=${!hasLogbookOrDocPage}. Each document type audited across this whole effort lives inside its owning workflow instead: Digital Informed Consent inside Consultation (confirmed reachable via the real 'consultation' sidebar item=${consentReachableFromConsultation}), SBAR Handover inside Nursing, WHO Checklist inside Theatre, Wastage Log/Transfer Approval inside Inventory. This matches CLAUDE.md's role/page table, which likewise has no "Documentation/Logbook" row — nothing to reconcile here, unlike the Blood Bank documentation gap Section 11 found.`);
    await page3.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 13g: light corroborating role-access spot check — a role without
  // 'consultation' (nurse) cannot reach the Consent tab at all.
  // ═════════════════════════════════════════════════════════════════
  {
    const page4 = await context.newPage();
    await page4.addInitScript(initScript({
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Nurse Access Test', role: 'nurse' }] },
      users: [{ id: 'u1', email: 'nurse@doclog.local', password: 'whatever' }],
    }));
    await page4.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page4, 'nurse@doclog.local', 'whatever');
    const nurseCanSeeConsultation = await page4.evaluate(() => (typeof visibleModulesForRole === 'function' ? visibleModulesForRole().includes('consultation') : (ROLE_PAGES['nurse'] || []).includes('consultation')));
    await page4.evaluate(() => goPage('consultation'));
    await page4.waitForTimeout(150);
    const nurseBlocked = !(await page4.evaluate(() => document.getElementById('page-consultation')?.classList.contains('active')));
    log('13g', (!nurseCanSeeConsultation && nurseBlocked) ? 'PASS' : 'FAIL',
      `Live ROLE_PAGES spot check matches CLAUDE.md's role table (Doctor has Consultation; Nurse does not): nurse role does not see 'consultation' in its module list=${!nurseCanSeeConsultation}, and a direct goPage('consultation') attempt is correctly blocked=${nurseBlocked} — so Digital Informed Consent (nested inside Consultation) is correctly unreachable for a nurse.`);
    await page4.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 13h: printing a nonexistent consent id fails gracefully (toast, no
  // thrown exception / blank popup).
  // ═════════════════════════════════════════════════════════════════
  {
    const page5 = await context.newPage();
    await page5.addInitScript(initScript({
      tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Print Error Test', role: 'doctor' }], consent_forms: [] },
      users: [{ id: 'u1', email: 'doc2@doclog.local', password: 'whatever' }],
    }));
    await page5.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page5, 'doc2@doclog.local', 'whatever');
    let threw = false;
    try { await page5.evaluate(() => printConsentForm('does-not-exist')); } catch (e) { threw = true; }
    await page5.waitForTimeout(150);
    const toastMsg = await page5.evaluate(() => { const n = document.querySelectorAll('#toast-wrap .toast'); return n.length ? n[n.length - 1].textContent : null; });
    log('13h', (!threw && toastMsg && /not found/i.test(toastMsg)) ? 'PASS' : 'FAIL',
      `Called printConsentForm('does-not-exist') for an id with no matching row. No exception thrown=${!threw}, and a clear toast was shown: "${toastMsg}" — no blank/broken print popup opened.`);
    await page5.close();
  }

  return findings;
};
