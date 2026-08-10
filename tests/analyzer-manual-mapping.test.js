// Covers a real bug report: clicking "Map & Import" on an Analyzer
// Interface instrument-message row whose test code isn't in the hardcoded
// INSTRUMENT_FIELD_MAP (e.g. an HCT result from an HL7 feed) used to just
// toast "No known mapping..." and dead-end -- there was no way to route
// the value anywhere short of retyping it by hand from the raw message.
// mapAndImportInstrumentResult() now opens an interactive Manual Mapping
// picker (openManualMapPicker()) instead, letting a tech choose the
// department + result field once; confirmManualMap() then writes the raw
// value into that field's real entry-page input (via DEPT_LOAD_MAP) and
// marks the message sync_status:'manually_mapped', reusing the same
// sample-barcode and ordered-test safety checks the auto-mapped path uses.
const path = require('path');
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(seedOverrides) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }] },
    users: [{ id: 'u1', email: 'admin@example.com', password: 'whatever' }],
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

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'admin@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

// HCT has no entry in INSTRUMENT_FIELD_MAP -- WBC does, so this message
// mixes one auto-mappable analyte with one that requires manual mapping.
const HL7_CBC = [
  'MSH|^~\\&|LabAnalyzer|Haematology|LIS|Friendship Hospital|20260810093000||ORU^R01|MSG0000327|P|2.3',
  'PID|1||327||Doe^Jane^^^||19900101|F',
  'OBX|1|NM|WBC^White Blood Cell Count^L||7.2|10*3/uL|4.0-10.0|N|||F',
  'OBX|2|NM|HCT^Haematocrit^L||43.0|%|37-52|N|||F',
].join('\n');

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('analyzer-manual-mapping');
  const PT_ID = 'pt-327';
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }],
      patients: [{ id: PT_ID, mrn: 'MRN-327', lab_no: '327', name: 'Jane Doe', age: 36, age_unit: 'Years', sex: 'Female', tests_requested: ['CBC (Full Blood Count)'], payment_status: 'paid' }],
    },
    users: [{ id: 'u1', email: 'admin@example.com', password: 'whatever' }],
  };

  const page = await context.newPage();
  await page.addInitScript(initScript(seed));
  await login(page, baseUrl);

  await page.evaluate(() => goPage('analyzer'));
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('im-paste-raw').closest('details').open = true; });
  await page.fill('#im-paste-raw', HL7_CBC);
  await page.selectOption('#im-paste-protocol', 'HL7');
  await page.evaluate(() => parsePastedInstrumentMessage());
  await page.waitForTimeout(200);

  const tableHtml = await page.evaluate(() => document.getElementById('instrument-msg-body').innerHTML);
  t.check('WBC (in INSTRUMENT_FIELD_MAP) auto-maps on parse', tableHtml.includes('Auto-Mapped'));
  t.check('HCT (not in INSTRUMENT_FIELD_MAP) is left Pending Mapping', tableHtml.includes('Pending Mapping'));

  const hctIdx = await page.evaluate(() => _instrumentMessages.findIndex(m => m.test_parameter === 'HCT'));

  const toasts = [];
  await page.exposeFunction('__captureToast', (msg) => toasts.push(msg));
  await page.evaluate(() => { const orig = window.toast; window.toast = function(msg, kind) { window.__captureToast(msg); return orig ? orig(msg, kind) : undefined; }; });

  await page.evaluate((idx) => mapAndImportInstrumentResult(idx), hctIdx);
  await page.waitForTimeout(150);

  const modalOpen = await page.evaluate(() => document.getElementById('manual-map-ov')?.classList.contains('open'));
  t.check('clicking Map & Import on an unmapped code opens the Manual Mapping picker instead of dead-ending', modalOpen === true);
  t.check('no error toast fires when the picker opens', toasts.length === 0);

  const testCodeShown = await page.evaluate(() => document.getElementById('mm-test-code')?.textContent);
  const rawValShown = await page.evaluate(() => document.getElementById('mm-raw-value')?.textContent);
  t.check('the picker shows the correct analyzer test code and raw value', testCodeShown === 'HCT' && rawValShown === '43.0');

  await page.selectOption('#mm-dept', 'hem');
  await page.waitForTimeout(50);
  const fieldOptions = await page.evaluate(() => [...document.getElementById('mm-field').options].map(o => o.value));
  t.check('picking Haematology populates its result-field options, including hct', fieldOptions.includes('hct'));

  // Loading the target patient into the entry page is required before
  // confirming, same precondition the auto-mapped import path has.
  await page.evaluate((ptId) => openUnifiedResultsEntry(ptId, '327', 'Jane Doe'), PT_ID);
  await page.waitForTimeout(300);
  await page.evaluate(() => openManualMapPicker(_instrumentMessages.findIndex(m => m.test_parameter === 'HCT')));
  await page.selectOption('#mm-dept', 'hem');
  await page.selectOption('#mm-field', 'hct');
  await page.evaluate(() => confirmManualMap());
  await page.waitForTimeout(200);

  const hctInputVal = await page.evaluate(() => document.getElementById('he-hct')?.value);
  t.check('confirming the mapping writes the raw value into the real Haematology HCT input', hctInputVal === '43.0');

  const finalStatus = await page.evaluate(() => document.getElementById('instrument-msg-body').innerHTML);
  t.check('the message row now shows a Manually Mapped status instead of Pending Mapping', finalStatus.includes('Manually Mapped'));

  await page.close();
  return t;
};
