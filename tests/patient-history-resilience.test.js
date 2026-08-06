// Covers a reported gap: "click History, nothing appears." loadPthTimeline()
// fired 9+ independent Supabase queries inside one Promise.all; only two of
// them (results_hematology_history/results_chemistry_history) were
// individually caught. If ANY other single query rejected -- an RLS policy
// denying this role on one table, a migration not yet applied, anything --
// the whole Promise.all rejected, the outer catch only logged to console,
// and the timeline was left stuck on its "Loading…" spinner forever, with
// no visible error and no data, even though most of the patient's history
// was perfectly reachable. Every query is now independently caught.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(failTable) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Doctor Test', role:'doctor' }, []);
        if (table === '${failTable}') {
          // Simulates an RLS denial / missing table -- every chain method
          // returns this same always-rejecting object, so however many
          // .eq()/.order()/.select() calls the real code chains before
          // awaiting, the final await still rejects (delegating through
          // real Promise .then(onFulfilled, onRejected) semantics so the
          // source's own .then(r=>r, ()=>({data:[]})) fallback -- when
          // present -- is exercised exactly as it would be for real).
          const failing = {
            eq(){ return failing; }, order(){ return failing; }, select(){ return failing; }, limit(){ return failing; },
            then(onFulfilled, onRejected){ return Promise.reject(new Error('simulated failure on ${failTable}')).then(onFulfilled, onRejected); },
          };
          return failing;
        }
        if (table === 'patients') return chainable({ id:'p1', created_at:new Date().toISOString(), tests_requested:['CBC'], priority:'Routine', diagnosis:'—' }, []);
        if (table === 'admissions') return chainable(null, []);
        if (table === 'critical_values') return chainable(null, []);
        if (table === 'radiology_requests') return chainable(null, []);
        if (table === 'invoices') return chainable(null, []);
        if (table === 'results_hematology_history') return chainable(null, []);
        if (table === 'results_chemistry_history') return chainable(null, []);
        if (table === 'doctor_consultations') return chainable(null, [{ id:'c1', patient_id:'p1', consultation_date:new Date().toISOString(), chief_complaint:'Headache', primary_diagnosis:'Migraine', consulting_doctor:'Dr. Smith' }]);
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
  await page.fill('#auth-email', 'doctor@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('patient-history-resilience');

  // --- Baseline: everything works normally when nothing fails ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('nonexistent_table'));
    await login(page, baseUrl);
    await page.evaluate(() => openPatientHistoryTimeline('p1'));
    await page.waitForTimeout(300);
    const tl = await page.evaluate(() => document.getElementById('pth-timeline')?.textContent || '');
    t.check('baseline: the timeline renders the consultation event when every query succeeds', tl.includes('Migraine') || tl.includes('Doctor Visit'));
    await page.close();
  }

  // --- One table (radiology_requests) fails -- the rest of the timeline must still render ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('radiology_requests'));
    await login(page, baseUrl);
    await page.evaluate(() => openPatientHistoryTimeline('p1'));
    await page.waitForTimeout(300);
    const tl = await page.evaluate(() => document.getElementById('pth-timeline')?.textContent || '');
    t.check('a single failing table (radiology_requests) does not blank the whole timeline', tl.includes('Migraine') || tl.includes('Doctor Visit'));
    t.check('the timeline is not stuck on the loading spinner', !tl.includes('Loading'));
    await page.close();
  }

  // --- A more central table (patients itself) fails -- still no perpetual spinner ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('critical_values'));
    await login(page, baseUrl);
    await page.evaluate(() => openPatientHistoryTimeline('p1'));
    await page.waitForTimeout(300);
    const tl = await page.evaluate(() => document.getElementById('pth-timeline')?.textContent || '');
    t.check('a failing critical_values query does not blank the whole timeline either', tl.includes('Migraine') || tl.includes('Doctor Visit'));
    await page.close();
  }

  return t;
};
