// Follow-up bug report (after the MRN-reuse + History-tab fixes shipped in
// PR #90): Clinical Notes, Diagnosis, and Prescription still didn't appear
// in the History tab for a patient's past visits.
//
// Phase 0 diagnosis (driving the REAL saveConsultation()/savePrescription()
// functions, not synthetic seed rows, then opening History from a second,
// genuinely same-mrn visit):
//   - Diagnosis and Prescription reproduced CORRECTLY -- the general
//     MRN-merge mechanism from the prior fix works. Not a bug.
//   - The consultation's actual clinical narrative (HPI, PMH, drug/family/
//     social history, allergies, physical exam findings, ICD-10,
//     differential diagnosis, prognosis) was captured on save but NEVER
//     rendered anywhere in the History tab -- not the list summary, not
//     even the event's own detail click-through panel. renderHistoryEventDetail()'s
//     consultation branch only ever surfaced 7 of ~24 saved fields.
// Fixed by extending that branch to show every field saveConsultation()
// actually persists, reusing the same kvTable renderer already used for
// the fields that did show.
//
// Uses STATEFUL_MOCK_SRC and drives the real save functions (not seeded
// rows) so this test exercises the exact save-to-display pipeline a real
// doctor uses, not just the read side.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr. Ahmed', role: 'doctor' }],
      patients: [
        { id: 'visit1', mrn: '700', name: 'Test Patient', created_at: '2026-08-15T09:00:00Z', tests_requested: [], priority: 'Routine', diagnosis: '—', visit_status: 'Registered' },
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
  const t = makeSuite('history-tab-clinical-notes-display');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  // Drive the REAL consultation-save flow for a past visit, exactly as a
  // doctor genuinely would -- not a synthetic seed row.
  await page.evaluate(() => {
    _docPt = { id: 'visit1', mrn: '700', name: 'Test Patient' };
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('doc-date', '2026-08-15');
    set('doc-doctor-name', 'Dr. Ahmed');
    set('doc-complaint', 'Fever and headache');
    set('doc-hpi', 'Onset 3 days ago, gradual, associated with chills and sweating, worse in the evenings.');
    set('doc-dx1', 'Malaria (P. falciparum)');
    set('doc-plan', 'Start Artemether-Lumefantrine, hydration, review in 3 days.');
  });
  const saved = await page.evaluate(() => saveConsultation());
  t.check('saveConsultation() genuinely succeeds', saved === true);

  await page.evaluate(() => { addRxRow(); });
  await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('rx-drug-0', 'Artemether-Lumefantrine');
    set('rx-freq-0', 'BD');
  });
  await page.evaluate(() => savePrescription());
  await page.waitForTimeout(150);

  await page.evaluate(async () => { await sb.from('patients').update({ visit_status: 'Visit Complete' }).eq('id', 'visit1'); });

  // Confirm the data genuinely persisted (rules out a save-side bug).
  const dbState = await page.evaluate(() => ({
    consultCount: sb.__db.doctor_consultations.length,
    rxCount: sb.__db.prescriptions.length,
  }));
  t.check('the consultation genuinely persisted to the database', dbState.consultCount === 1);
  t.check('the prescription genuinely persisted to the database', dbState.rxCount === 1);

  // A genuinely NEW patients row sharing the SAME mrn -- exactly what a
  // real returning-patient registration produces.
  await page.evaluate(async () => {
    await sb.from('patients').insert({ id: 'visit2', mrn: '700', name: 'Test Patient', created_at: '2026-08-20T09:00:00Z', tests_requested: [], priority: 'Routine', diagnosis: '—', visit_status: 'Registered' });
  });
  await page.evaluate(() => loadPatientHistory('visit2'));
  await page.waitForTimeout(300);
  const historyText = await page.evaluate(() => document.getElementById('doc-history-body')?.textContent || '');
  t.check('Diagnosis from the past visit appears in the History list', historyText.includes('Malaria'));
  t.check('Prescription from the past visit appears in the History list', historyText.includes('Artemether'));

  // Click into the consultation event's own detail panel -- this is where
  // the Clinical Notes narrative was completely missing before the fix.
  await page.evaluate(() => {
    const idx = _docHistoryEvents.findIndex(e => e.type === 'consultation');
    showDocHistoryDetail(idx);
  });
  await page.waitForTimeout(150);
  const detailText = await page.evaluate(() => document.getElementById('doc-history-detail')?.textContent || '');
  t.check('Clinical Notes (HPI narrative) now appears in the consultation detail panel', detailText.includes('gradual, associated with chills'));
  t.check('the detail panel still shows the diagnosis it always showed (no regression)', detailText.includes('Malaria (P. falciparum)'));

  await page.close();
  return t;
};
