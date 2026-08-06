// Covers a live-reported case, distinct from patient-history-mrn-aggregation
// (which fixed Patient History Timeline / pth-timeline): this is the
// SEPARATE inline "History" tab inside Doctor Consultation itself
// (loadPatientHistory() -> #doc-history-body), reached via Consultation's
// own sub-nav, not the top-banner History/Timeline buttons. It had the
// identical MRN-scoping gap -- confirmed still broken after the first fix
// because it's a completely different function/code path. Opening it from
// a fresh follow-up registration (same MRN, new patients row) must still
// surface the prior visit's consultation.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const oldConsult = { id:'c1', patient_id:'pOld', consultation_date:'2026-08-05T14:30:00Z', chief_complaint:'Fever', primary_diagnosis:'Malaria', consulting_doctor:'Dr. Ahmed' };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Doctor Test', role:'doctor' }, []);
        if (table === 'patients') {
          const c = chainable(null, []);
          c.select = () => c;
          c.eq = (field, val) => {
            if (field === 'id') return { maybeSingle: () => Promise.resolve({ data: { mrn: '515' }, error: null }) };
            if (field === 'mrn') return Promise.resolve({ data: [{ id:'pOld' }, { id:'pNew' }], error: null });
            return c;
          };
          return c;
        }
        if (table === 'doctor_consultations') { const c = chainable(null, [oldConsult]); c.in = () => c; c.order = () => c; c.limit = () => c; return c; }
        if (table === 'results_hematology') { const c = chainable(null, []); c.in = () => c; c.limit = () => c; return c; }
        if (table === 'vital_signs') { const c = chainable(null, []); c.in = () => c; c.order = () => c; c.limit = () => c; return c; }
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
  const t = makeSuite('doctor-consultation-history-mrn');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  // Open the inline History tab from the NEW (today) visit's id.
  await page.evaluate(() => loadPatientHistory('pNew'));
  await page.waitForTimeout(200);
  const historyText = await page.evaluate(() => document.getElementById('doc-history-body')?.textContent || '');
  t.check('the inline Consultation History tab surfaces the PRIOR visit\'s consultation (Malaria) from a different patients row sharing the same MRN', historyText.includes('Malaria'));
  t.check('it does not fall back to "No previous history found" when a prior visit exists under the same MRN', !historyText.includes('No previous history found'));

  await page.close();
  return t;
};
