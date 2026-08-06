// Covers the root cause behind two reported issues at once: "old results
// disappear when a new test is ordered" and "many registered patients
// disappear from Lab/Doctor interface". Both trace to the same bug:
// _submitLabOrder() used to upsert sample_records with status:'Pending'
// on EVERY new lab order, unconditionally overwriting an already
// Collected/Received/Processing/Completed sample back to square one --
// since sample_records is one row per PATIENT, not per order, this
// silently regressed a patient who already had released results back to
// looking like nothing had been done at all: the Doctor's View Result
// gate (labResultsReady) and the Lab Worklist's RECEIVABLE_STATUSES
// filter both read this exact same column. Fixed via
// upsert(..., {onConflict:'patient_id', ignoreDuplicates:true}) --
// creates the row if missing, never touches it if it already exists.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { sampleUpserts: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Doctor Test', role:'doctor' }, []);
        if (table === 'doctor_orders') { const c = chainable(null, []); c.insert = () => Promise.resolve({ data: null, error: null }); return c; }
        if (table === 'patients') { const c = chainable(null, []); c.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) }); c.eq = () => c; return c; }
        if (table === 'sample_records') {
          const c = chainable(null, []);
          c.upsert = (payload, opts) => { window.__mock.sampleUpserts.push({ payload, opts }); return Promise.resolve({ data: null, error: null }); };
          return c;
        }
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
  const t = makeSuite('sample-records-no-regression');

  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);
  await page.evaluate(() => { _docPt = { id:'p1', name:'Test Patient', payment_status:'paid', tests_requested:['CBC (Full Blood Count)'], lab_no:'L100' }; });
  await page.evaluate(() => goPage('consultation'));
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const cb = document.querySelector('.order-test-chk');
    if (cb) cb.checked = true;
  });
  await page.evaluate(() => submitLabOrder());
  await page.waitForTimeout(200);

  const upsertCall = await page.evaluate(() => window.__mock.sampleUpserts[0]);
  t.check('sample_records upsert is called on new lab order', !!upsertCall);
  t.check('the upsert uses ignoreDuplicates so an existing (already-advanced) row is never overwritten', upsertCall?.opts?.ignoreDuplicates === true);
  t.check('the upsert still targets onConflict:patient_id (one row per patient)', upsertCall?.opts?.onConflict === 'patient_id');
  t.check('a fresh row would still be created as Pending (only matters when none exists yet)', upsertCall?.payload?.status === 'Pending');

  await page.close();
  return t;
};
