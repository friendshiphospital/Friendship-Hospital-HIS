// Part B Phase 2: re-verify (live, not assumed) that Doctor Consultation's
// History tab (loadPatientHistory() -> #doc-history-body) correctly
// aggregates across ALL of a patient's past visits once those visits
// genuinely share one MRN -- which Part B Phase 1 now guarantees for a
// returning patient registered via the fixed submitRegistration() safety
// net. loadPatientHistory() shares fetchPatientHistoryEvents() with the
// full Patient History Timeline (already covered by
// patient-history-mrn-aggregation.test.js) and the Lab Worklist quick-view
// panel, so this test is deliberately scoped to the one entry point not yet
// exercised live: the Consultation module's own History tab.
//
// Scenario: "Farah ahmed", MRN 542 -- a completed visit on 19 Aug with a
// signed consultation (diagnosis: Malaria) and a released Haematology
// result, followed by a genuinely-MRN-reused follow-up visit on 20 Aug with
// its own consultation (diagnosis: Follow-up review) and a radiology order.
// Opening the History tab from the NEW (20 Aug) visit must show BOTH
// consultations, the lab result, and the radiology entry -- not just
// today's.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Doctor Test', role: 'doctor' }],
      patients: [
        { id: 'visitOld', mrn: '542', name: 'Farah ahmed', created_at: '2026-08-19T09:00:00Z', tests_requested: ['CBC (Full Blood Count)'], priority: 'Routine', diagnosis: 'Malaria', visit_status: 'Visit Complete' },
        { id: 'visitNew', mrn: '542', name: 'Farah ahmed', created_at: '2026-08-20T10:00:00Z', tests_requested: [], priority: 'Routine', diagnosis: '—', visit_status: 'Registered' },
      ],
      doctor_consultations: [
        { id: 'c1', patient_id: 'visitOld', consultation_date: '2026-08-19T09:30:00Z', chief_complaint: 'Fever', primary_diagnosis: 'Malaria', consulting_doctor: 'Dr. Ahmed' },
        { id: 'c2', patient_id: 'visitNew', consultation_date: '2026-08-20T10:15:00Z', chief_complaint: 'Follow-up', primary_diagnosis: 'Follow-up review', consulting_doctor: 'Dr. Ahmed' },
      ],
      results_hematology: [
        { id: 'h1', patient_id: 'visitOld', hgb: 11.2, wbc: 6.1, plt: 210, is_released: true, analysis_date: '2026-08-19T12:00:00Z' },
      ],
      radiology_requests: [
        { id: 'r1', patient_id: 'visitNew', imaging_type: 'Chest X-ray', urgency: 'Routine', status: 'Requested', created_at: '2026-08-20T10:20:00Z' },
      ],
    },
    users: [{ id: 'u1', email: 'doctor@example.com', password: 'whatever' }],
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
  await page.fill('#auth-email', 'doctor@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('consultation-history-tab-multi-visit');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  // Open the History tab from the NEW (20 Aug) visit -- the prior visit's
  // consultation, lab result, and today's own consultation + radiology must
  // all appear in one merged list.
  await page.evaluate(() => loadPatientHistory('visitNew'));
  await page.waitForTimeout(300);
  const body = await page.evaluate(() => document.getElementById('doc-history-body')?.textContent || '');

  t.check('the PRIOR visit\'s consultation (Malaria, Dr. Ahmed) appears', body.includes('Malaria'));
  t.check('the CURRENT visit\'s own consultation (Follow-up review) appears', body.includes('Follow-up review'));
  t.check('the PRIOR visit\'s released Haematology result appears', body.includes('Haematology'));
  t.check('the CURRENT visit\'s radiology order appears', body.includes('Chest X-ray'));
  t.check('the header reports events across 2 visits, not just today\'s', body.includes('2 visit'));

  await page.close();
  return t;
};
