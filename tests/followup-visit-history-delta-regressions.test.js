// Regression coverage for the four "real clinical use, follow-up patient"
// fixes: (A) follow-up pricing's phone-based fallback when no MRN was
// manually matched at registration, (B)/(C) fetchPatientHistoryEvents()'s
// MRN-merge (shared by Consultation's History tab and the Lab Worklist
// Quick History panel) actually pulling in a PRIOR visit's events under a
// brand-new patient_id, and (D) runDeltaCheck() comparing a follow-up's
// first result against the prior visit's value instead of finding nothing.
//
// All four bugs shared the same root shape: a follow-up/re-registration
// under the same MRN gets a genuinely NEW patients row every visit (see
// submitRegistration()), and code that filtered strictly by the CURRENT
// visit's own patient_id could never see a prior visit's data. That's a
// real-filtering concern (`.eq('patient_id', ptId)` vs `.in('patient_id',
// [...allVisitIds])` must behave differently) — CHAINABLE_MOCK_SRC's
// filter methods are deliberate no-ops (by design, for single-call
// assertions) and can't distinguish "found via broken same-visit-only
// scoping" from "found via the correct MRN-merged scoping," so this file
// uses STATEFUL_MOCK_SRC (real per-table filtering) throughout instead.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(seedOverrides) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Test User', role: 'receptionist' }] },
    users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    idStart: { mrn: 500 },
    ...seedOverrides,
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
    window.__confirmCalls = [];
    window.confirm = (msg) => { window.__confirmCalls.push(msg); return true; };
  `;
}

async function login(page, baseUrl, email) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('followup-visit-history-delta-regressions');

  // ═══════════════════════════════════════════════════════════════════
  // PART A — checkAndApplyFollowUpPricing()'s phone-based fallback: a
  // returning patient registered WITHOUT the receptionist clicking the
  // duplicate-match row must still be offered the follow-up pricing, via
  // a distinctly-worded confirm(), never silently.
  // ═══════════════════════════════════════════════════════════════════
  {
    const today = new Date().toISOString().slice(0, 10);
    const PHONE = '0912345678';
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Reception Test', role: 'receptionist' }],
        patients_master: [{ mrn: 'MRN-100', first_name: 'Fatima', last_name: 'Existing', phone: PHONE }],
        follow_ups: [{ id: 'fu1', patient_mrn: 'MRN-100', used: false, target_date: today, reason: 'Review labs', scheduled_by_name: 'Dr. Ahmed' }],
      },
      users: [{ id: 'u1', email: 'reception@example.com', password: 'whatever' }],
      idStart: { mrn: 500 },
    };

    {
      const page = await context.newPage();
      await page.addInitScript(initScript(seed));
      await login(page, baseUrl, 'reception@example.com');
      const result = await page.evaluate(async (phone) => await checkAndApplyFollowUpPricing('501', { wasManualMatch: false, phone }), PHONE);
      const confirmCalls = await page.evaluate(() => window.__confirmCalls);
      t.check('a fresh mrn with no manual match still finds a different known mrn\'s open follow-up by phone', result?.followUpId === 'fu1');
      t.check('the fallback prompt names the discovered mrn and asks whether it\'s the same patient', confirmCalls[0]?.includes('MRN-100') && /same patient/i.test(confirmCalls[0] || ''));
      await page.close();
    }
    {
      // wasManualMatch:true means the direct-match path already handled it (or
      // deliberately didn't match) -- the phone fallback must not double-prompt.
      const page = await context.newPage();
      await page.addInitScript(initScript(seed));
      await login(page, baseUrl, 'reception@example.com');
      const result = await page.evaluate(async (phone) => await checkAndApplyFollowUpPricing('999-not-real', { wasManualMatch: true, phone }), PHONE);
      const confirmCalls = await page.evaluate(() => window.__confirmCalls);
      t.check('wasManualMatch:true suppresses the phone fallback entirely', result === null && confirmCalls.length === 0);
      await page.close();
    }
    {
      // Phone matches nobody -> stays a silent no-op, exactly like before.
      const page = await context.newPage();
      await page.addInitScript(initScript(seed));
      await login(page, baseUrl, 'reception@example.com');
      const result = await page.evaluate(async () => await checkAndApplyFollowUpPricing('501', { wasManualMatch: false, phone: '0900000000' }));
      const confirmCalls = await page.evaluate(() => window.__confirmCalls);
      t.check('an unmatched phone number stays a silent no-op (no false positive)', result === null && confirmCalls.length === 0);
      await page.close();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART B/C — fetchPatientHistoryEvents()'s MRN-merge: the shared helper
  // behind both Consultation's rebuilt History tab and the Lab Worklist's
  // new Quick History panel. A brand-new visit (fresh patient_id) under an
  // existing mrn must still surface the PRIOR visit's consultation,
  // prescription, radiology, and lab-result events.
  // ═══════════════════════════════════════════════════════════════════
  {
    const OLD_ID = 'pt-old', NEW_ID = 'pt-new', MRN = 'MRN-200';
    const oldDate = new Date(Date.now() - 30 * 864e5).toISOString();
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Test User', role: 'doctor' }],
        patients: [
          { id: OLD_ID, mrn: MRN, name: 'Repeat Patient', created_at: oldDate, visit_status: 'Visit Complete', tests_requested: ['CBC'] },
          { id: NEW_ID, mrn: MRN, name: 'Repeat Patient', created_at: new Date().toISOString(), visit_status: 'Registered', tests_requested: [] },
        ],
        doctor_consultations: [{ id: 'c1', patient_id: OLD_ID, consultation_date: oldDate, primary_diagnosis: 'Malaria', chief_complaint: 'Fever' }],
        prescriptions: [{ id: 'rx1', patient_id: OLD_ID, prescribed_date: oldDate.slice(0, 10), items: [{ drug: 'Artesunate', dose: '100mg' }] }],
        radiology_requests: [{ id: 'r1', patient_id: OLD_ID, created_at: oldDate, imaging_type: 'Chest X-Ray', status: 'Verified' }],
        results_hematology: [{ id: 'h1', patient_id: OLD_ID, hgb: 9.5, is_verified: true, created_at: oldDate, analysis_date: oldDate.slice(0, 10) }],
      },
      users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl, 'test@example.com');
    const result = await page.evaluate(async (newId) => {
      const pt = { id: newId, mrn: 'MRN-200' };
      return await fetchPatientHistoryEvents(pt);
    }, NEW_ID);
    t.check('a brand-new visit resolves both patient_id rows sharing the mrn', result.counts.visits === 2);
    const types = result.events.map(e => e.type);
    t.check('the prior visit\'s consultation is included', types.includes('consultation'));
    t.check('the prior visit\'s prescription is included (previously missing entirely from loadPatientHistory)', types.includes('prescription'));
    t.check('the prior visit\'s radiology request is included', types.includes('radiology'));
    t.check('the prior visit\'s lab result is included, across departments (not just Haematology)', types.includes('lab') && result.events.some(e => e.icon === '🩸'));
    // Detail renderer proof — reused by both Consultation and Worklist panels.
    const radEvent = result.events.find(e => e.type === 'radiology');
    const detailHtml = await page.evaluate((e) => renderHistoryEventDetail(e), radEvent);
    t.check('renderHistoryEventDetail() renders a structured detail view for a radiology event', detailHtml.includes('Chest X-Ray'));
    await page.close();
  }
  {
    // Failure path: one failing table must not blank the whole result, and
    // callers (loadPatientHistory/openWlQuickHistory) must surface a visible
    // error rather than doing nothing.
    const NEW_ID = 'pt-err';
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Test User', role: 'doctor' }],
        patients: [{ id: NEW_ID, mrn: 'MRN-ERR', name: 'Err Patient', created_at: new Date().toISOString() }],
      },
      users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl, 'test@example.com');
    await page.evaluate(() => {
      const origFrom = sb.from.bind(sb);
      sb.from = (t) => { if (t === 'admissions') throw new Error('Simulated DB error'); return origFrom(t); };
    });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(async (newId) => { await loadPatientHistory(newId); }, NEW_ID);
    await page.waitForTimeout(100);
    const html = await page.evaluate(() => document.getElementById('doc-history-body').innerHTML);
    t.check('loadPatientHistory() shows a visible "Could not load history" error instead of failing silently', html.includes('Could not load history'));
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART D — runDeltaCheck()'s MRN-merge: a follow-up visit's first result
  // entry (brand-new patient_id, no history of its own yet) must be
  // compared against the PRIOR visit's on-file value, not silently find
  // nothing.
  // ═══════════════════════════════════════════════════════════════════
  {
    const OLD_ID = 'pt-delta-old', NEW_ID = 'pt-delta-new', MRN = 'MRN-300';
    const oldDate = new Date(Date.now() - 10 * 864e5).toISOString();
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }],
        patients: [
          { id: OLD_ID, mrn: MRN, name: 'Delta Patient', created_at: oldDate },
          { id: NEW_ID, mrn: MRN, name: 'Delta Patient', created_at: new Date().toISOString() },
        ],
        results_hematology_history: [
          { id: 'hh1', patient_id: OLD_ID, hgb: 14, analysis_date: oldDate.slice(0, 10), recorded_at: oldDate, is_verified: true },
        ],
      },
      users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl, 'test@example.com');
    const breaches = await page.evaluate(async (newId) => await runDeltaCheck('results_hematology', newId, { hgb: 9 }), NEW_ID);
    t.check('runDeltaCheck() on a brand-new follow-up visit id finds the PRIOR visit\'s hgb=14 and flags the drop to 9 (was silently empty before the mrn-merge fix)', breaches.length === 1 && breaches[0].field === 'hgb');
    const noBreach = await page.evaluate(async (newId) => await runDeltaCheck('results_hematology', newId, { hgb: 13.5 }), NEW_ID);
    t.check('a clinically insignificant change across the same two visits still does not breach', noBreach.length === 0);
    await page.close();
  }
  {
    // Sanity: no mrn at all (walk-in) falls back to the single patient_id,
    // matching the pre-fix behaviour exactly -- the mrn-merge must never
    // regress the no-mrn case.
    const PT_ID = 'pt-no-mrn';
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }],
        patients: [{ id: PT_ID, mrn: null, name: 'Walk-in Patient', created_at: new Date().toISOString() }],
        results_hematology: [{ id: 'h1', patient_id: PT_ID, hgb: 14, analysis_date: new Date().toISOString().slice(0, 10) }],
      },
      users: [{ id: 'u1', email: 'test@example.com', password: 'whatever' }],
    };
    const page = await context.newPage();
    await page.addInitScript(initScript(seed));
    await login(page, baseUrl, 'test@example.com');
    const breaches = await page.evaluate(async (ptId) => await runDeltaCheck('results_hematology', ptId, { hgb: 9 }), PT_ID);
    t.check('a patient with no mrn still compares correctly against their own current-panel row (no-mrn fallback preserved)', breaches.length === 1 && breaches[0].field === 'hgb');
    await page.close();
  }

  return t;
};
