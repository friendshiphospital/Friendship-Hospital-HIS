// Covers a live-reported case: patient "Saha", MRN 515, had a completed
// visit on 5 Aug (results finished) and was re-registered under the SAME
// MRN on 6 Aug (follow-up mechanism: a brand-new patients row, same mrn,
// per submitRegistration()). Two things went wrong:
//   1. Doctor's queue showed both visits as identical-looking cards (same
//      name/MRN, and the closed visit's "Visit Complete" badge was the
//      same green as the still-actionable "Results Ready" badge) --
//      confirmed source of staff clicking into the wrong (already
//      signed-off, now locked) visit and hitting guardVisitNotLocked()'s
//      block, misread as "error in save consultation note".
//   2. Patient History Timeline, opened from the fresh 6 Aug row, showed
//      nothing from the 5 Aug visit at all -- loadPthTimeline() only ever
//      queried by the single clicked patient_id, never by MRN, so a
//      person's clinical history was invisibly split across separate
//      patients rows the moment they had a follow-up visit.
// Both are fixed here: statusBadge() gives Visit Complete a visually
// distinct dark/locked badge (not bdg-g), and loadPthTimeline() resolves
// every patients.id sharing the clicked patient's MRN and merges all of
// their events into one combined timeline.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const oldVisit = { id:'pOld', mrn:'515', name:'Saha', created_at:'2026-08-05T14:21:00Z', tests_requested:['CBC (Full Blood Count)'], priority:'Routine', diagnosis:'—', visit_status:'Visit Complete' };
    const newVisit = { id:'pNew', mrn:'515', name:'Saha', created_at:'2026-08-06T09:00:00Z', tests_requested:[], priority:'Routine', diagnosis:'—', visit_status:'Registered' };
    const consult = { id:'c1', patient_id:'pOld', consultation_date:'2026-08-05T14:30:00Z', chief_complaint:'Fever', primary_diagnosis:'Malaria', consulting_doctor:'Dr. Ahmed' };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Doctor Test', role:'doctor' }, []);
        if (table === 'patients') {
          const c = chainable(null, []);
          c.select = () => c;
          c.eq = (field, val) => {
            if (field === 'id') return { single: () => Promise.resolve({ data: val === 'pOld' ? oldVisit : newVisit, error: null }) };
            if (field === 'mrn') return Promise.resolve({ data: [oldVisit, newVisit], error: null });
            return c;
          };
          return c;
        }
        if (table === 'doctor_consultations') { const c = chainable(null, [consult]); c.in = () => c; return c; }
        if (table === 'admissions') { const c = chainable(null, []); c.in = () => c; return c; }
        if (table === 'critical_values') { const c = chainable(null, []); c.in = () => c; return c; }
        if (table === 'radiology_requests') { const c = chainable(null, []); c.in = () => c; return c; }
        if (table === 'invoices') { const c = chainable(null, []); c.in = () => c; return c; }
        if (table === 'results_hematology_history') { const c = chainable(null, []); c.in = () => c; return c; }
        if (table === 'results_chemistry_history') { const c = chainable(null, []); c.in = () => c; return c; }
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
  const t = makeSuite('patient-history-mrn-aggregation');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  // Open History from the NEW (6 Aug) row -- the old visit's consultation must still appear.
  await page.evaluate(() => openPatientHistoryTimeline('pNew'));
  await page.waitForTimeout(300);
  const tl = await page.evaluate(() => document.getElementById('pth-timeline')?.textContent || '');
  t.check('opening History from the NEW visit still surfaces the PRIOR visit\'s consultation (Malaria, Dr. Ahmed)', tl.includes('Malaria'));
  t.check('both visits are counted (not just the one clicked)', await page.evaluate(() => document.getElementById('pths-visits')?.textContent) === '2');
  const closedEventShown = tl.includes('Visit Complete');
  t.check('the prior, already-closed registration is explicitly labelled Visit Complete in the timeline', closedEventShown);

  // The badge: Visit Complete must not look like Results Ready (both used to be the same green).
  const visitCompleteBadge = await statusBadgeHtml(page, 'Visit Complete');
  const resultsReadyBadge = await statusBadgeHtml(page, 'Results Ready');
  t.check('Visit Complete no longer shares Results Ready\'s badge class (bdg-g)', !visitCompleteBadge.includes('bdg-g'));
  t.check('Results Ready itself is unchanged (still bdg-g)', resultsReadyBadge.includes('bdg-g'));
  t.check('Visit Complete is visually marked as locked (🔒 in the label)', visitCompleteBadge.includes('🔒'));

  await page.close();
  return t;
};

async function statusBadgeHtml(page, status) {
  return page.evaluate((s) => statusBadge(s), status);
}
