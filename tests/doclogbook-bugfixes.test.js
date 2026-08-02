// Covers the 4 pre-existing bugs fixed during the Documentation/Logbook
// Phase 0 audit follow-up: (1) NEWS2 score was computed but never actually
// persisted (window._extra_news2 was read but never assigned), (2) the
// Handover Notes form silently dropped Critical Patients/Pending Tasks/
// Patient Count before saving, (3) the Consultation module's Discharge tab
// wrote to a different field-id namespace than it read from (so nothing
// it collected was ever actually saved or printed), (4) the dashboard
// recent-activity feed and patient-history timeline read critical_values
// columns (test_name/result_value/notified_at) that no insert anywhere
// ever wrote (every insert writes parameter/value/created_at instead).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { vitalsInsert: null, handoverInsert: null, dischargeInsert: null, admissionsUpdate: null };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Doc Test', role: 'admin' }, []);
        ${extra || ''}
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
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

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('doclogbook-bugfixes');

  // --- BUG 1: NEWS2 score persistence ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'vital_signs') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.vitalsInsert = payload; return { select: () => Promise.resolve({ data: [payload], error: null }) }; };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      _vsPt = { id: 'p1', name: 'NEWS2 Test Patient' };
      document.getElementById('vs-sys').value = 85;
      document.getElementById('vs-hr').value = 135;
      document.getElementById('vs-rr').value = 26;
      document.getElementById('vs-temp').value = 34;
      document.getElementById('vs-spo2').value = 90;
      document.getElementById('vs-by').value = 'Nurse Test';
    });
    // Live-wiring check: an oninput on a single vitals field alone (no pain click) should update the on-screen bar.
    await page.evaluate(() => document.getElementById('vs-sys').dispatchEvent(new Event('input')));
    await page.waitForTimeout(50);
    const liveVal = await page.evaluate(() => document.getElementById('vs-news2-val').textContent);
    t.check('NEWS2 bar updates live from a vitals field input, not just a pain-score click', liveVal && liveVal !== '' && liveVal !== '0');
    const expected = await page.evaluate(() => calcNEWS2());
    await page.evaluate(() => saveVitals());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.vitalsInsert);
    t.check('news2_score is no longer null on save (was previously always null)', insert?.news2_score !== null && insert?.news2_score !== undefined);
    t.check('the persisted news2_score matches the live-computed NEWS2 score', insert?.news2_score === expected);
    t.check('a severely deranged set of vitals produces a high NEWS2 score', expected >= 10);
    await page.close();
  }

  // --- BUG 2: Handover Notes dropped Critical Patients / Pending Tasks / Patient Count ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'ward_handover_notes') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.handoverInsert = payload; return chainable(null, []); };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.getElementById('ho-ward').value = 'ICU';
      document.getElementById('ho-shift').value = 'Night';
      document.getElementById('ho-from').value = 'Nurse A';
      document.getElementById('ho-to').value = 'Nurse B';
      document.getElementById('ho-count').value = '12';
      document.getElementById('ho-critical').value = 'Bed 3 — post-op bleed watch';
      document.getElementById('ho-pending').value = 'Bed 5 — awaiting CT result';
      document.getElementById('ho-notes').value = 'Quiet night otherwise.';
    });
    await page.evaluate(() => saveHandover());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.handoverInsert);
    t.check('patient_count is now saved (was previously collected but dropped)', insert?.patient_count === 12);
    t.check('critical_patients is now saved (was previously collected but dropped)', insert?.critical_patients === 'Bed 3 — post-op bleed watch');
    t.check('pending_tasks is now saved (was previously collected but dropped)', insert?.pending_tasks === 'Bed 5 — awaiting CT result');
    t.check('general notes still saves as before', insert?.notes === 'Quiet night otherwise.');
    await page.close();
  }

  // --- BUG 3: Consultation Discharge tab (dis-*) was wired to a Save function that only read disch-* ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'admissions') {
          const c = chainable({ id: 'adm1', patient_id: 'p1', admission_date: '2026-07-20T00:00:00Z', ward: 'Medical', room: '1', bed: '3' }, []);
          c.update = (payload) => { window.__mock.admissionsUpdate = payload; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
        if (table === 'discharge_summaries') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.dischargeInsert = payload; return chainable(null, []); };
          return c;
        }
        if (table === 'beds') { const c = chainable(null, []); c.update = () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }) }); return c; }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Discharge Test Patient' }; });
    // Opening the Discharge tab should resolve the active admission and auto-fill Admission Date.
    await page.evaluate(() => switchDocTab('discharge', null));
    await page.waitForTimeout(200);
    const admState = await page.evaluate(() => ({ admId: _currentAdmId, admitDate: document.getElementById('dis-admit-date').value, los: document.getElementById('dis-los').value }));
    t.check('opening the Discharge tab resolves the patient\'s active admission (was never set before)', admState.admId === 'adm1');
    t.check('Admission Date auto-fills from the resolved admission (was always blank before)', admState.admitDate === '2026-07-20');
    // Also pollute the OTHER (Admissions-modal) namespace with stale text, to verify no cross-contamination.
    await page.evaluate(() => {
      document.getElementById('disch-dx').value = 'STALE — should never be saved from this tab';
      document.getElementById('dis-reason').value = 'Fever and cough for 3 days';
      document.getElementById('dis-clinical').value = 'Crackles right base, SpO2 94% on air';
      document.getElementById('dis-investigations').value = 'CXR: right lower lobe consolidation';
      document.getElementById('dis-treatment').value = 'IV co-amoxiclav 5 days';
      document.getElementById('dis-dx').value = 'Community-acquired pneumonia';
      document.getElementById('dis-meds').value = 'Amoxicillin 500mg TDS x5d';
      document.getElementById('dis-followup').value = 'OPD review in 1 week';
      document.getElementById('dis-condition').value = 'Improved';
    });
    await page.evaluate(() => saveDischarge('consultation'));
    await page.waitForTimeout(150);
    const ins = await page.evaluate(() => window.__mock.dischargeInsert);
    t.check('reason_for_admission is now saved from the Consultation tab (was silently dropped before)', ins?.reason_for_admission === 'Fever and cough for 3 days');
    t.check('clinical_findings is now saved', ins?.clinical_findings === 'Crackles right base, SpO2 94% on air');
    t.check('investigations_summary is now saved', ins?.investigations_summary === 'CXR: right lower lobe consolidation');
    t.check('treatment_given is now saved', ins?.treatment_given === 'IV co-amoxiclav 5 days');
    t.check('discharge_medications is now saved', ins?.discharge_medications === 'Amoxicillin 500mg TDS x5d');
    t.check('followup_instructions is now saved', ins?.followup_instructions === 'OPD review in 1 week');
    t.check('final_diagnosis comes from the Consultation tab\'s own dis-dx field, not the stale disch-dx text', ins?.final_diagnosis === 'Community-acquired pneumonia');
    t.check('the correct admission_id (resolved automatically) is used, not left null', ins?.admission_id === 'adm1');
    t.check('the admission is still marked Discharged as before', (await page.evaluate(() => window.__mock.admissionsUpdate))?.status === 'Discharged');
    await page.close();
  }

  // --- BUG 4: dashboard recent-activity feed read columns (test_name/result_value/notified_at) that nothing writes ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'critical_values') return chainable(null, [{ id: 'c1', parameter: 'Potassium', value: '7.2', created_at: '2026-08-01T10:00:00Z' }]);
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('dashboard'));
    await page.waitForTimeout(300);
    const feedHtml = await page.evaluate(() => document.getElementById('dash-activity')?.innerHTML || '');
    t.check('the recent-activity feed shows the real parameter/value (Potassium = 7.2), not blanks', feedHtml.includes('Potassium') && feedHtml.includes('7.2'));
    t.check('the feed never renders the literal string "undefined" for a critical value entry', !feedHtml.includes('undefined'));
    await page.close();
  }

  return t;
};
