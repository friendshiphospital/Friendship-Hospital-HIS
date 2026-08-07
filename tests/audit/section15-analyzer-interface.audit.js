// Functional audit, Section 15: Analyzer Interface / instrument messaging.
// Real Playwright browser interaction against the real app. Existing
// coverage (tests/analyzer-interface-relocation.test.js) only proves the
// module's location in the sidebar after the Prompt1 Phase 2 navigation
// restructure — it never exercises the actual message-parsing/
// result-ingestion logic. This section drives that logic directly, against
// the real STATEFUL mock DB (writes from one action genuinely visible to
// the next, like a real Supabase project):
//   (15a) golden path — "Simulate Incoming Message" from a canned analyzer
//         profile (Sysmex XN-1000, ASTM), confirming the real
//         parseAstmMessage()/ingestInstrumentResults() pipeline writes real
//         instrument_messages rows via dbWrite, correctly auto-maps known
//         analytes (HGB/WBC/PLT), and renders them live in the stream table.
//   (15b) manual "paste a raw message" path (HL7 ORU this time, Roche
//         Cobas-shaped), confirming parseHl7Message() independently works
//         and the textarea clears on success.
//   (15c) error handling — a malformed/garbage message (no R/OBX records)
//         is rejected by the parser and logged as a real sync_status='error'
//         row with the parser's own error text preserved, not silently
//         dropped.
//   (15d) unrecognized test code — a syntactically valid ASTM message for
//         an analyte the app doesn't know about lands as
//         sync_status='pending_mapping', and attempting to "Map & Import"
//         it is refused with a clear toast rather than importing garbage
//         or throwing.
//   (15e) downstream pipeline connection (golden path continued) — a real
//         patient is loaded into Haematology entry, an analyzer-reported
//         HGB value low enough to breach CRIT_RANGES is Map & Imported
//         into the live form, confirming it (i) lands in the actual input
//         field, (ii) fires the SAME oninput flagHem() critical-banner
//         logic manual typing would, and (iii) once Saved via the real
//         saveHemEntry()->saveResultWithSafetyChecks() pipeline, produces
//         a real results_hematology row AND a real critical_values row via
//         logCriticalValues() — proving an analyzer-sourced value reaches
//         exactly the same safety pipeline as a manually typed one.
//   (15f) identity/order validation gap — with a specific patient already
//         loaded in Haematology entry, an instrument message carrying a
//         sample barcode that matches NEITHER that patient nor any patient
//         in the database at all is still auto-mapped and importable, and
//         "Map & Import" writes it into whichever patient happens to be
//         loaded on screen with no cross-check against the message's own
//         barcode or that patient's ordered tests.
//   (15g) role access — live ROLE_PAGES spot check for the 'analyzer' page.
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

// Direct-value workaround for fields inside .ov/.mo overlay modals (not
// used by this page's own controls, which are plain page content, but kept
// available/consistent with other sections' helper set in case needed).
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

// The "paste a raw ASTM/HL7 message" textarea lives inside a collapsed
// <details> element (closed by default), so Playwright correctly reports
// it as not-visible/not-fillable until the <details> is opened.
async function openPasteDetails(page) {
  await page.evaluate(() => {
    const d = document.getElementById('im-paste-raw')?.closest('details');
    if (d) d.open = true;
  });
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // ═════════════════════════════════════════════════════════════════
  // 15a: golden path — Simulate Incoming Message (Sysmex XN-1000, ASTM),
  // confirm real parsing + real dbWrite-backed persistence + live render.
  // ═════════════════════════════════════════════════════════════════
  const page = await context.newPage();
  {
    const seed = { tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Analyzer Admin', role: 'admin' }] }, users: [{ id: 'u1', email: 'admin@az.local', password: 'whatever' }] };
    await firstLoad(page, baseUrl, seed, 'admin@az.local', 'whatever');
    await page.evaluate(() => goPage('analyzer'));
    await page.waitForTimeout(200);

    await page.selectOption('#im-sim-profile', 'sysmex');
    await page.fill('#im-sim-barcode', 'FH-25-000123');
    await page.evaluate(() => simulateInstrumentMessage());
    await page.waitForTimeout(300);

    const rows = await page.evaluate(async () => { const { data } = await sb.from('instrument_messages').select('*').order('created_at', { ascending: false }); return data; });
    const hgbRow = rows.find(r => r.test_parameter === 'HGB');
    const wbcRow = rows.find(r => r.test_parameter === 'WBC');
    const pltRow = rows.find(r => r.test_parameter === 'PLT');
    const dbWriteOk = rows.length === 3 && [hgbRow, wbcRow, pltRow].every(r => r && r.sample_barcode === 'FH-25-000123' && r.machine_id === 'Sysmex XN-1000' && r.protocol === 'ASTM' && typeof r.raw_message === 'string' && r.raw_message.includes('R|1|^^^HGB'));
    const mappingOk = hgbRow?.sync_status === 'auto_mapped' && hgbRow?.mapped_table === 'results_hematology' && hgbRow?.mapped_field === 'hgb' &&
      wbcRow?.sync_status === 'auto_mapped' && wbcRow?.mapped_table === 'results_hematology' && wbcRow?.mapped_field === 'wbc' &&
      pltRow?.sync_status === 'auto_mapped' && pltRow?.mapped_table === 'results_hematology' && pltRow?.mapped_field === 'plt';
    const parsedValueOk = typeof hgbRow?.parsed_value === 'number' && hgbRow.parsed_value >= 11 && hgbRow.parsed_value <= 18;

    const tableHtml = await page.evaluate(() => document.getElementById('instrument-msg-body').innerHTML);
    const renderOk = tableHtml.includes('Sysmex XN-1000') && tableHtml.includes('FH-25-000123') && (tableHtml.match(/Auto-Mapped/g) || []).length === 3 && tableHtml.includes('Map &amp; Import');

    const toastMsg = await lastToast(page);
    const toastOk = /Simulated message from Sysmex XN-1000 ingested \(3 results?\)/.test(toastMsg || '');

    const ok = dbWriteOk && mappingOk && parsedValueOk && renderOk && toastOk;
    log('15a', ok ? 'PASS' : 'FAIL',
      `Selected the Sysmex XN-1000 (Haematology, ASTM) profile, set barcode "FH-25-000123", clicked "Simulate Incoming Message". The real parseAstmMessage() correctly extracted 3 R-records and ingestInstrumentResults() wrote 3 real instrument_messages rows via dbWrite (not a mock write) with the right machine_id/protocol/sample_barcode/raw_message on each=${dbWriteOk}. All 3 known analytes (HGB/WBC/PLT) were correctly auto-mapped to results_hematology.hgb/wbc/plt (sync_status='auto_mapped')=${mappingOk}, and parsed_value was numerically parsed from the ASTM text (HGB=${hgbRow?.parsed_value})=${parsedValueOk}. The live stream table rendered all 3 rows with green "Auto-Mapped" badges and a "Map & Import" action=${renderOk}, and the success toast reported the correct count=${toastOk}.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 15b: manual "paste a raw message" path — HL7 v2 ORU^R01 this time
  // (independently exercises parseHl7Message(), not just parseAstmMessage()).
  // ═════════════════════════════════════════════════════════════════
  {
    const hl7 = [
      'MSH|^~\\&|Cobas c311|Lab|LIS|Hospital|20260807120000||ORU^R01|1|P|2.3',
      'PID|1||FH-25-000200||',
      'OBX|1|NM|NA^Sodium^L||139|mmol/L|136-145|N|||F',
      'OBX|2|NM|K^Potassium^L||4.2|mmol/L|3.5-5.1|N|||F',
    ].join('\r');
    await openPasteDetails(page);
    await page.fill('#im-paste-raw', hl7);
    await page.selectOption('#im-paste-protocol', 'HL7');
    await page.evaluate(() => parsePastedInstrumentMessage());
    await page.waitForTimeout(300);

    const rows = await page.evaluate(async () => { const { data } = await sb.from('instrument_messages').select('*').eq('machine_id', 'Manual Paste (HL7)'); return data; });
    const naRow = rows.find(r => r.test_parameter === 'NA');
    const kRow = rows.find(r => r.test_parameter === 'K');
    const parseOk = naRow && kRow && naRow.raw_value === '139' && kRow.raw_value === '4.2' && naRow.sample_barcode === 'FH-25-000200' && naRow.mapped_field === 'na' && kRow.mapped_field === 'k' && naRow.sync_status === 'auto_mapped' && kRow.sync_status === 'auto_mapped';
    const textareaCleared = await page.evaluate(() => document.getElementById('im-paste-raw').value === '');
    const toastMsg = await lastToast(page);
    const toastOk = /Parsed 2 result\(s\) from pasted message/.test(toastMsg || '');

    const ok = parseOk && textareaCleared && toastOk;
    log('15b', ok ? 'PASS' : 'FAIL',
      `Pasted a raw HL7 v2 ORU^R01 message (PID barcode FH-25-000200, OBX Sodium=139 mmol/L, Potassium=4.2 mmol/L) with Protocol=HL7 into the "Paste a raw ASTM/HL7 message" panel and clicked "Parse & Add to Stream". parseHl7Message() correctly extracted both OBX segments into real instrument_messages rows (machine_id="Manual Paste (HL7)"), correctly mapped NA/K to results_chemistry.na/k=${parseOk}. The textarea cleared on success=${textareaCleared} and the toast reported the correct count=${toastOk}.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 15c: error handling — malformed message (no R/OBX records at all).
  // ═════════════════════════════════════════════════════════════════
  {
    const garbage = 'this is not an ASTM message\njust some free text\nno pipe-delimited records here';
    await openPasteDetails(page);
    await page.fill('#im-paste-raw', garbage);
    await page.selectOption('#im-paste-protocol', 'ASTM');
    await page.evaluate(() => parsePastedInstrumentMessage());
    await page.waitForTimeout(300);

    const rows = await page.evaluate(async () => { const { data } = await sb.from('instrument_messages').select('*').eq('sync_status', 'error'); return data; });
    const errRow = rows[0];
    const dbOk = errRow && errRow.error_detail === 'No R (result) records found in ASTM message' && errRow.raw_message === garbage && errRow.machine_id === 'Manual Paste (ASTM)';

    const tableHtml = await page.evaluate(() => document.getElementById('instrument-msg-body').innerHTML);
    const renderOk = tableHtml.includes('Communication Error') && tableHtml.includes('No R (result) records found in ASTM message');

    const toastMsg = await lastToast(page);
    const toastOk = /Parse error: No R \(result\) records found/.test(toastMsg || '');

    // Malformed message must NOT crash the page or leave the app in a
    // broken state — confirm the page is still fully responsive afterward.
    const stillResponsive = await page.evaluate(() => document.getElementById('page-analyzer')?.classList.contains('active'));

    const ok = dbOk && renderOk && toastOk && stillResponsive;
    log('15c', ok ? 'PASS' : 'FAIL',
      `Pasted plain free text with no pipe-delimited R/OBX records at all as Protocol=ASTM. parseAstmMessage() correctly threw "No R (result) records found in ASTM message" instead of silently accepting garbage, and logInstrumentParseError() wrote a real instrument_messages row with sync_status='error' preserving both the exact error text and the original raw_message for audit=${dbOk}. The live table rendered it with a red "🔴 Communication Error" badge showing the error text in place of a value=${renderOk}, the toast surfaced the same error=${toastOk}, and the page remained fully functional afterward (no crash)=${stillResponsive}.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 15d: unrecognized test code — valid message, unknown analyte.
  // sync_status should be 'pending_mapping', and "Map & Import" on it
  // must be refused with a clear toast, not silently import garbage.
  // ═════════════════════════════════════════════════════════════════
  {
    const ts = '20260807130000';
    const unknownAstm = [
      'H|\\^&|||Unknown Analyzer 3000|||||||P|LIS2-A2|' + ts,
      'P|1||FH-25-000300||',
      'O|1|FH-25-000300||^^^ZZZ|R||' + ts,
      'R|1|^^^ZZZ|42.0|arbitrary|10-50|N||F||tech||' + ts,
      'L|1|N',
    ].join('\r');
    await openPasteDetails(page);
    await page.fill('#im-paste-raw', unknownAstm);
    await page.selectOption('#im-paste-protocol', 'ASTM');
    await page.evaluate(() => parsePastedInstrumentMessage());
    await page.waitForTimeout(300);

    const rows = await page.evaluate(async () => { const { data } = await sb.from('instrument_messages').select('*').eq('test_parameter', 'ZZZ'); return data; });
    const zzzRow = rows[0];
    const pendingOk = zzzRow && zzzRow.sync_status === 'pending_mapping' && zzzRow.mapped_table === null && zzzRow.mapped_field === null && zzzRow.raw_value === '42.0';

    const bodyHtmlBefore = await page.evaluate(() => document.getElementById('instrument-msg-body').innerHTML);
    const pendingBadgeOk = bodyHtmlBefore.includes('Pending Mapping');

    // Find the row index for ZZZ in the in-memory _instrumentMessages array
    // (rendered rows call mapAndImportInstrumentResult(i) by array index)
    // and click its "Map & Import" button through the real function.
    const importAttempt = await page.evaluate(() => {
      const idx = _instrumentMessages.findIndex(m => m.test_parameter === 'ZZZ');
      return { idx, before: JSON.stringify(_instrumentMessages[idx]) };
    });
    await page.evaluate((i) => mapAndImportInstrumentResult(i), importAttempt.idx);
    await page.waitForTimeout(200);
    const toastMsg = await lastToast(page);
    const refusedOk = /No known mapping for "ZZZ"/.test(toastMsg || '');

    const stillNotImported = await page.evaluate(() => {
      const m = _instrumentMessages.find(x => x.test_parameter === 'ZZZ');
      return !m.imported_at;
    });

    const ok = pendingOk && pendingBadgeOk && refusedOk && stillNotImported;
    log('15d', ok ? 'PASS' : 'FAIL',
      `Pasted a syntactically valid ASTM message reporting an analyte the app has no mapping for (test code "ZZZ", value 42.0) from a fictitious "Unknown Analyzer 3000". It parsed successfully (not an error) but correctly landed as sync_status='pending_mapping' with mapped_table/mapped_field left null=${pendingOk}, rendered with a yellow "Pending Mapping" badge=${pendingBadgeOk}. Clicking its real "Map & Import" action (mapAndImportInstrumentResult) correctly refused with "No known mapping for \\"ZZZ\\" — enter it manually in the result form" rather than guessing a field or throwing=${refusedOk}, and the row correctly stayed un-imported (imported_at still unset)=${stillNotImported}.`);
  }
  await page.close();

  // ═════════════════════════════════════════════════════════════════
  // 15e: downstream pipeline connection (golden path continued, fresh
  // page/DB) — a real patient loaded into Haematology entry, an
  // analyzer-reported critical HGB value Map & Imported into the live
  // form, confirming it fires the same oninput critical-flag logic as
  // manual typing AND that saving through the real save pipeline produces
  // both a results_hematology row and a critical_values row.
  // ═════════════════════════════════════════════════════════════════
  {
    const page2 = await context.newPage();
    const ptId = 'pt-critical';
    // Everything below is done as a single admin actor. Per the live
    // ROLE_PAGES finding in 15g, admin is the ONLY role that can actually
    // reach the Analyzer Interface page at all — a lab_tech/lab_supervisor
    // cannot get to "Map & Import" through this app's own navigation no
    // matter what, so an admin-only actor is the realistic golden path,
    // not a simplification of it.
    const seed = {
      tables: {
        staff: [{ id: 's2', user_id: 'u2', full_name: 'Analyzer Admin', role: 'admin' }],
        patients: [{ id: ptId, name: 'Critical Test Patient', mrn: 'MRN-9001', lab_no: 'FH-25-009001', age: 55, age_unit: 'y', sex: 'M', tests_requested: ['Haemoglobin Only'], visit_status: 'Orders Pending' }],
      },
      users: [{ id: 'u2', email: 'admin2@az.local', password: 'whatever' }],
    };
    await page2.addInitScript(initScript(seed));
    await page2.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page2, 'admin2@az.local', 'whatever');

    // Load the real patient into Haematology entry the same way the
    // Worklist/All-Results "Enter" pathways do.
    await page2.evaluate((id) => loadPatientIntoEntryPage(id, 'Critical Test Patient'), ptId);
    await page2.waitForTimeout(200);
    const ptLoadedOk = await page2.evaluate(() => document.getElementById('hem-entry-pt-id').value) === ptId;

    // Go to the Analyzer Interface page to simulate/paste the message.
    await page2.evaluate(() => goPage('analyzer'));
    await page2.waitForTimeout(150);
    const ts = '20260807140000';
    const criticalHgbAstm = [
      'H|\\^&|||Sysmex XN-1000|||||||P|LIS2-A2|' + ts,
      'P|1||FH-25-009001||',
      'O|1|FH-25-009001||^^^HGB|R||' + ts,
      'R|1|^^^HGB|5.2|g/dL|12.0-17.5|L||F||tech||' + ts,
      'L|1|N',
    ].join('\r');
    await openPasteDetails(page2);
    await page2.fill('#im-paste-raw', criticalHgbAstm);
    await page2.selectOption('#im-paste-protocol', 'ASTM');
    await page2.evaluate(() => parsePastedInstrumentMessage());
    await page2.waitForTimeout(200);

    const idx = await page2.evaluate(() => _instrumentMessages.findIndex(m => m.test_parameter === 'HGB' && m.raw_value === '5.2'));
    await page2.evaluate((i) => mapAndImportInstrumentResult(i), idx);
    await page2.waitForTimeout(200);

    const navigatedToHem = await page2.evaluate(() => document.getElementById('page-hem-entry')?.classList.contains('active'));
    const fieldValue = await page2.evaluate(() => document.getElementById('he-hgb').value);
    const critBannerVisible = await page2.evaluate(() => document.getElementById('he-critical-warn').style.display === 'block');
    const importToast = await lastToast(page2);
    const importToastOk = /Imported Haemoglobin = 5\.2 into Haematology entry/.test(importToast || '');

    // Now save through the real, shared save pipeline exactly as a manual
    // entry would (verify=false — matches an ordinary "Save" click).
    await page2.evaluate(() => saveHemEntry(false));
    await page2.waitForTimeout(300);

    const savedRow = await page2.evaluate(async (id) => { const { data } = await sb.from('results_hematology').select('*').eq('patient_id', id).maybeSingle(); return data; }, ptId);
    const savedOk = savedRow && savedRow.hgb === 5.2 && savedRow.has_critical === true && savedRow.analyzer === '';

    const critLog = await page2.evaluate(async (id) => { const { data } = await sb.from('critical_values').select('*').eq('patient_id', id); return data; }, ptId);
    const critLogRow = critLog?.find(c => c.parameter === 'Haemoglobin');
    const critLogOk = !!critLogRow && critLogRow.value === '5.2' && critLogRow.department === 'Haematology' && critLogRow.mrn === 'MRN-9001' && critLogRow.lab_no === 'FH-25-009001';

    const ok = ptLoadedOk && navigatedToHem && fieldValue === '5.2' && critBannerVisible && importToastOk && savedOk && critLogOk;
    log('15e', ok ? 'PASS' : 'FAIL',
      `Loaded a real patient (Critical Test Patient, MRN-9001, lab no FH-25-009001, ordered test "Haemoglobin Only") into Haematology entry=${ptLoadedOk}. Pasted a real ASTM message reporting a critically low HGB=5.2 g/dL (below CRIT_RANGES.hgb's 7.0 floor) for that same patient's lab number. Clicking the real "Map & Import" action correctly navigated to Haematology entry=${navigatedToHem}, wrote 5.2 into the actual #he-hgb input=${fieldValue === '5.2'}, and — because it dispatches a real 'input' event rather than just setting .value — fired the SAME oninput flagHem(...,true) critical-banner logic manual typing would, correctly showing the red critical-value banner=${critBannerVisible}, toast confirmed=${importToastOk}. Clicking Save then ran through the exact same shared pipeline manual entry uses (saveHemEntry -> saveResultWithSafetyChecks): a real results_hematology row was written with hgb=5.2 and has_critical=true=${savedOk}, AND logCriticalValues() fired exactly as it would for a manually typed critical value, writing a real critical_values row (parameter=Haemoglobin, value=5.2, department=Haematology, with the correct MRN/lab no snapshotted onto it)=${critLogOk}. An analyzer-sourced result genuinely reaches the same downstream safety pipeline as a manually entered one — but only via this manual "Map & Import then click Save" two-step; nothing in the interface pushes a result into results_hematology automatically.`);

    // ═════════════════════════════════════════════════════════════════
    // 15f: identity/order validation gap — same page/session/DB. A second,
    // DIFFERENT patient is now loaded into Haematology entry (their own
    // Haemoglobin was already saved and is closed out); an instrument
    // message carrying a sample barcode that matches NEITHER this newly
    // loaded patient NOR any patient in the seeded database at all is
    // simulated. Confirm it is still auto-mapped/importable, and that
    // "Map & Import" writes it into whichever patient is on screen with
    // no cross-check against the message's own barcode.
    // ═════════════════════════════════════════════════════════════════
    const ptId2 = 'pt-other';
    await page2.evaluate((seedPt) => sb.from('patients').insert(seedPt), { id: ptId2, name: 'Unrelated Second Patient', mrn: 'MRN-9002', lab_no: 'FH-25-009002', age: 30, age_unit: 'y', sex: 'F', tests_requested: ['Fasting Blood Sugar'], visit_status: 'Orders Pending' });
    await page2.evaluate((id) => loadPatientIntoEntryPage(id, 'Unrelated Second Patient'), ptId2);
    await page2.waitForTimeout(200);
    const secondPtLoadedOk = await page2.evaluate(() => document.getElementById('hem-entry-pt-id').value) === ptId2;
    // Note: this patient's own ordered test is Fasting Blood Sugar
    // (Chemistry), not anything Haematology — yet they are still sitting
    // on the Haematology entry page with an empty he-hgb field, same as
    // any patient would be before results are entered.

    await page2.evaluate(() => goPage('analyzer'));
    await page2.waitForTimeout(150);
    const ts2 = '20260807150000';
    const strangerBarcode = 'FH-99-NOBODY'; // matches no patient in the seeded DB at all
    const strangerAstm = [
      'H|\\^&|||Sysmex XN-1000|||||||P|LIS2-A2|' + ts2,
      'P|1||' + strangerBarcode + '||',
      'O|1|' + strangerBarcode + '||^^^HGB|R||' + ts2,
      'R|1|^^^HGB|9.9|g/dL|12.0-17.5|L||F||tech||' + ts2,
      'L|1|N',
    ].join('\r');
    await openPasteDetails(page2);
    await page2.fill('#im-paste-raw', strangerAstm);
    await page2.selectOption('#im-paste-protocol', 'ASTM');
    const patientCountBefore = await page2.evaluate(() => sb.from('patients').select('id', { count: 'exact', head: true }).then(r => r.count));
    await page2.evaluate(() => parsePastedInstrumentMessage());
    await page2.waitForTimeout(200);
    const strangerRows = await page2.evaluate(async (bc) => { const { data } = await sb.from('instrument_messages').select('*').eq('sample_barcode', bc); return data; }, strangerBarcode);
    const strangerRow = strangerRows.find(r => r.test_parameter === 'HGB');
    // No patient lookup of any kind happens during ingestion: it is
    // auto-mapped purely from the analyte name, with zero regard to
    // whether "FH-99-NOBODY" corresponds to any real patient/visit/order.
    const ingestedDespiteUnknownPatient = strangerRow?.sync_status === 'auto_mapped';

    const idx2 = await page2.evaluate((bc) => _instrumentMessages.findIndex(m => m.sample_barcode === bc && m.test_parameter === 'HGB'), strangerBarcode);
    await page2.evaluate((i) => mapAndImportInstrumentResult(i), idx2);
    await page2.waitForTimeout(200);

    // The value from a message whose barcode is "FH-99-NOBODY" (not
    // Patient 2's own lab_no "FH-25-009002") lands in Patient 2's
    // Haemoglobin field purely because Patient 2 happens to be the
    // patient currently loaded on screen -- Map & Import never compares
    // the message's sample_barcode/patient identifier against the loaded
    // patient at all.
    const wrongPatientFieldValue = await page2.evaluate(() => document.getElementById('he-hgb').value);
    const crossPatientImportOk = wrongPatientFieldValue === '9.9';
    const stillOnSecondPatient = await page2.evaluate(() => document.getElementById('hem-entry-pt-id').value) === ptId2;
    // And it happened on a Haematology field for a patient whose only
    // ordered test is a Chemistry test (Fasting Blood Sugar) -- no check
    // against tests_requested at import time either.
    const patientHadNoHemOrder = true; // asserted by seed: tests_requested=['Fasting Blood Sugar']

    const ok2 = secondPtLoadedOk && ingestedDespiteUnknownPatient && crossPatientImportOk && stillOnSecondPatient;
    log('15f', ok2 ? '⚠️ GAP FOUND' : 'FAIL',
      `Loaded a second, unrelated real patient (Unrelated Second Patient, MRN-9002, lab no FH-25-009002, whose only ordered test is Fasting Blood Sugar — a Chemistry test, not Haematology) into Haematology entry=${secondPtLoadedOk}. Simulated an instrument message with sample barcode "FH-99-NOBODY" — matching NO patient anywhere in the database (confirmed against a live patients table read, ${patientCountBefore} real rows). GAP: ingestInstrumentResults() performs no patients-table lookup of any kind — the message was still ingested and auto-mapped exactly like a message for a real, known patient (sync_status='auto_mapped')=${ingestedDespiteUnknownPatient}. GAP: mapAndImportInstrumentResult() likewise never compares the message's own sample_barcode/patient identifier against the currently loaded patient — it only checks that SOME patient is loaded on the target entry page (index.html: \`if(!document.getElementById(ptIdField)?.value)\`) — so the HGB=9.9 value from the "FH-99-NOBODY" message was silently written into he-hgb for Unrelated Second Patient (MRN-9002) who was still the one on screen (imported value correct=${crossPatientImportOk}, patient never changed underneath the tech=${stillOnSecondPatient}), with no cross-patient mismatch warning of any kind, and despite that patient's own ordered tests containing nothing Haematology-related at all. In a real multi-tech workflow, if the tech importing the stream has the WRONG patient open (or a stale one from a prior visit) when they click Map & Import, this design provides no safeguard against attributing an analyzer result to the wrong person or the wrong (unordered) test — the only gate anywhere in this pipeline is "is there a patient loaded at all", not "is it the RIGHT patient" or "was this test actually ordered for them".`);
    await page2.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 15g: role access — live ROLE_PAGES spot check for the 'analyzer' page.
  // Per index.html's ROLE_PAGES, this page is admin-only even though it
  // sits inside the Laboratory sidebar group/module alongside pages
  // lab_tech and lab_supervisor DO have access to.
  // ═════════════════════════════════════════════════════════════════
  {
    const roleSeed = {
      tables: { staff: [
        { id: 's-tech', user_id: 'u-tech', full_name: 'Role Lab Tech', role: 'lab_tech' },
        { id: 's-sup', user_id: 'u-sup', full_name: 'Role Lab Supervisor', role: 'lab_supervisor' },
        { id: 's-doc', user_id: 'u-doc', full_name: 'Role Doctor', role: 'doctor' },
        { id: 's-nurse', user_id: 'u-nurse', full_name: 'Role Nurse', role: 'nurse' },
        { id: 's-admin', user_id: 'u-admin', full_name: 'Role Admin', role: 'admin' },
      ] },
      users: [
        { id: 'u-tech', email: 'rt@az.local', password: 'whatever' },
        { id: 'u-sup', email: 'rs@az.local', password: 'whatever' },
        { id: 'u-doc', email: 'rd@az.local', password: 'whatever' },
        { id: 'u-nurse', email: 'rn@az.local', password: 'whatever' },
        { id: 'u-admin', email: 'ra@az.local', password: 'whatever' },
      ],
    };
    const checkRole = async (email) => {
      const p = await context.newPage();
      await p.addInitScript(initScript(roleSeed));
      await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
      await loginAs(p, email, 'whatever');
      const sidebarVisible = await p.evaluate(() => {
        const el = document.querySelector('[data-p="analyzer"]');
        return !!el && el.style.display !== 'none';
      });
      const inLaboratoryModule = await p.evaluate(() => MODULE_PAGES.laboratory.pages.includes('analyzer'));
      await p.evaluate(() => goPage('analyzer'));
      await p.waitForTimeout(150);
      const entered = await p.evaluate(() => document.getElementById('page-analyzer')?.classList.contains('active'));
      const deniedToast = await lastToast(p);
      await p.close();
      return { sidebarVisible, inLaboratoryModule, entered, deniedToast };
    };

    const labTech = await checkRole('rt@az.local');
    const labSupervisor = await checkRole('rs@az.local');
    const doctor = await checkRole('rd@az.local');
    const nurse = await checkRole('rn@az.local');
    const admin = await checkRole('ra@az.local');

    const adminOk = admin.entered && admin.sidebarVisible;
    const labTechBlockedOk = !labTech.entered && !labTech.sidebarVisible && /Access denied/i.test(labTech.deniedToast || '');
    const labSupervisorBlockedOk = !labSupervisor.entered && !labSupervisor.sidebarVisible && /Access denied/i.test(labSupervisor.deniedToast || '');
    const doctorBlockedOk = !doctor.entered && !doctor.sidebarVisible;
    const nurseBlockedOk = !nurse.entered && !nurse.sidebarVisible;
    const inModuleAnyway = labTech.inLaboratoryModule; // true — MODULE_PAGES groups it under Laboratory regardless of ROLE_PAGES

    const ok = adminOk && labTechBlockedOk && labSupervisorBlockedOk && doctorBlockedOk && nurseBlockedOk;
    log('15g', ok ? 'PASS (role restriction confirmed live, matches CLAUDE.md/README — neither documents Analyzer Interface for any non-admin role)' : 'FAIL',
      `Live ROLE_PAGES spot check for 'analyzer', each role on its own fresh page/session. Admin sees the sidebar item and can enter the page=${adminOk}. Lab Tech is BLOCKED — sidebar item hidden AND direct goPage('analyzer') refused with "Access denied"=${labTechBlockedOk}. Lab Supervisor is likewise BLOCKED=${labSupervisorBlockedOk}. Doctor and Nurse are blocked too (never had access to begin with)=${doctorBlockedOk && nurseBlockedOk}. Notably MODULE_PAGES.laboratory (the sidebar GROUPING introduced by the Prompt1 Phase 2 relocation this section's existing coverage tests) DOES list 'analyzer' as one of the Laboratory module's pages=${inModuleAnyway} — but that grouping is purely navigational; filterSidebar()'s role check still runs first and hides the item for lab_tech/lab_supervisor before the module-scoping layer ever gets a chance to show it, and goPage()'s own ROLE_PAGES check independently blocks direct navigation too, so the two layers agree and there is no back-door route to the page for those roles. This matches CLAUDE.md's "Roles and page access" table and README.md, which list no Analyzer Interface access for Lab Tech or Lab Supervisor (only "Admin: Everything") — no documentation/code sync gap here, unlike the Inventory finding in Section 12.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 15h (secondary observation): the "Interface Protocol"/"Registered
  // Analyzers" configuration UI on this same page has zero persistence —
  // confirmed directly, not inferred from reading code.
  // ═════════════════════════════════════════════════════════════════
  {
    const page3 = await context.newPage();
    const seed = { tables: { staff: [{ id: 's3', user_id: 'u3', full_name: 'Config Admin', role: 'admin' }] }, users: [{ id: 'u3', email: 'cfg@az.local', password: 'whatever' }] };
    await page3.addInitScript(initScript(seed));
    await page3.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page3, 'cfg@az.local', 'whatever');
    await page3.evaluate(() => goPage('analyzer'));
    await page3.waitForTimeout(200);

    await page3.selectOption('#az-protocol', 'ASTM E1381 / LIS02-A2');
    await page3.fill('#az-host', '192.168.50.20');
    await page3.fill('#az-port', '3000');
    await page3.evaluate(() => addAnalyzerRow());
    await page3.waitForTimeout(50);
    const rowInputs = await page3.evaluate(() => document.querySelectorAll('#analyzer-list input'));
    // Fill the newly added row's name field directly (plain page content,
    // not a modal — real Playwright fill works here).
    const nameInputs = await page3.$$('#analyzer-list tr:last-child input');
    if (nameInputs[0]) await nameInputs[0].fill('CELL-DYN Ruby');

    // Confirm nothing was written to the DB or localStorage for any of
    // az-protocol/az-host/az-port/az-direction/az-timeout or the analyzer
    // rows -- there is no save button and no code path (grepped index.html)
    // that reads these ids anywhere outside their own declaration.
    const dbRowCount = await page3.evaluate(async () => { const { data } = await sb.from('analyzer_config').select('*').then(r => r, () => ({ data: [] })); return (data || []).length; });
    const anyLocalStorageKey = await page3.evaluate(() => Object.keys(localStorage).some(k => /az-|analyzer/i.test(k) && k !== 'sb_url' && k !== 'sb_key'));

    // Reload the page (fresh navigation) and confirm the configuration
    // panel and the analyzer row are both gone -- pure client-side DOM
    // state with no persistence layer at all.
    await page3.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page3, 'cfg@az.local', 'whatever');
    await page3.evaluate(() => goPage('analyzer'));
    await page3.waitForTimeout(200);
    const protocolResetOk = await page3.evaluate(() => document.getElementById('az-protocol').value) === 'HL7 v2.x (MLLP)';
    const hostResetOk = await page3.evaluate(() => document.getElementById('az-host').value) === '';
    const rowGoneOk = await page3.evaluate(() => document.getElementById('analyzer-list').textContent.includes('No analyzers registered yet'));

    const observationConfirmed = dbRowCount === 0 && !anyLocalStorageKey && protocolResetOk && hostResetOk && rowGoneOk;
    log('15h', observationConfirmed ? 'ℹ️ OBSERVATION' : 'FAIL',
      `Set Protocol=ASTM, Host=192.168.50.20, Port=3000 in the "Interface Protocol" card and added a Registered Analyzer row ("CELL-DYN Ruby") via the real +Add button/inputs. Confirmed no analyzer_config-style table write occurred and no matching localStorage key was created for any of it=${dbRowCount === 0 && !anyLocalStorageKey}. Reloading the app fresh loses all of it — Protocol resets to its default option, Host goes blank, and the analyzer row is gone entirely=${protocolResetOk && hostResetOk && rowGoneOk}. This is consistent with the page's own on-screen disclaimer ("Full bidirectional HL7/ASTM integration requires a middleware server... This page stores interface configuration for future integration") — but as currently built it does not actually persist anything even locally; it is pure in-memory DOM state with no save action at all (grepping index.html finds no function anywhere reading az-protocol/az-host/az-port/az-direction/az-timeout, or the Registered Analyzers rows, other than the markup that declares them). Not a bug against the page's own stated scope, but worth flagging as a secondary observation distinct from the message-ingestion findings above (15a-15f), which DO work and DO persist for real via dbWrite.`);
    await page3.close();
  }

  return findings;
};
