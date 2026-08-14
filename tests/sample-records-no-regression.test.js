// Covers the root cause behind two separate generations of the same class
// of bug:
//   1. (original) "old results disappear when a new test is ordered" /
//      "many registered patients disappear from Lab/Doctor interface" --
//      _submitLabOrder() used to upsert sample_records with status:'Pending'
//      on EVERY new lab order, unconditionally overwriting an already
//      Collected/Received/Processing/Completed sample back to square one.
//      Fixed (previous round) via upsert(...,{onConflict:'patient_id',
//      ignoreDuplicates:true}) -- create the row if missing, never touch it
//      if it already exists.
//   2. (this round) that ignoreDuplicates fix traded one bug for another:
//      since sample_records was still exactly ONE row per patient, a
//      SECOND, later lab order for a genuinely different test had nowhere
//      to go -- the existing (already-Released) row was correctly left
//      alone, but that meant the new order silently inherited the old
//      order's finished status and skipped Sample Collection/Receipt
//      entirely. Fixed by making sample_records one row PER SPECIMEN/
//      ORDER-BATCH (migration_v2.47 drops the patient_id uniqueness) --
//      _submitLabOrder() now INSERTs a genuinely new Pending row whenever
//      the patient's current specimen has already moved past collection,
//      via getCurrentSampleRecord(), instead of upserting onto it.
//
// This file locks in the underlying safety property both fixes were
// protecting -- an existing Collected/Received/Processing/Completed/
// Released row is NEVER regressed back to Pending -- against the CURRENT
// mechanism. See sample-records-per-order.test.js for the full live,
// stateful, end-to-end two-order scenario this was originally reproduced
// against.
const { makeSuite } = require('./helpers/test-kit');

function initScript(currentSampleRow) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    window.__mock = { sampleInserts: [], sampleUpdates: [] };
    function chainable(single, arr) {
      return {
        eq(){ return chainable(single, arr); },
        in(){ return chainable(single, arr); },
        or(){ return chainable(single, arr); },
        not(){ return chainable(single, arr); },
        ilike(){ return chainable(single, arr); },
        like(){ return chainable(single, arr); },
        order(){ return chainable(single, arr); },
        limit(){ return chainable(single, arr); },
        gte(){ return chainable(single, arr); },
        lte(){ return chainable(single, arr); },
        gt(){ return chainable(single, arr); },
        lt(){ return chainable(single, arr); },
        neq(){ return chainable(single, arr); },
        select(){ return chainable(single, arr); },
        maybeSingle(){ return Promise.resolve({ data: single, error: null }); },
        single(){ return Promise.resolve({ data: single, error: null }); },
        then(resolve){ return resolve({ data: arr, error: null }); },
        insert(){ return chainable(null, []); },
        update(){ return { eq: () => Promise.resolve({ data: null, error: null }) }; },
      };
    }
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Doctor Test', role:'doctor' }, []);
        if (table === 'doctor_orders') { const c = chainable(null, []); c.insert = () => Promise.resolve({ data: null, error: null }); return c; }
        if (table === 'patients') { const c = chainable(null, []); c.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) }); c.eq = () => c; return c; }
        if (table === 'sample_records') {
          // getCurrentSampleRecord() reads via .select().eq().order().limit().maybeSingle()
          // -- returns whichever row this scenario configured as "current".
          const c = chainable(${JSON.stringify(currentSampleRow)}, []);
          c.insert = (payload) => { window.__mock.sampleInserts.push(payload); return Promise.resolve({ data: [payload], error: null }); };
          c.update = (payload) => { window.__mock.sampleUpdates.push(payload); return { eq: () => Promise.resolve({ data: null, error: null }) }; };
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

async function placeOrder(context, baseUrl, currentSampleRow) {
  const page = await context.newPage();
  await page.addInitScript(initScript(currentSampleRow));
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
  const result = await page.evaluate(() => ({ inserts: window.__mock.sampleInserts, updates: window.__mock.sampleUpdates }));
  await page.close();
  return result;
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('sample-records-no-regression');

  // --- No sample_records row exists yet for this patient (a first-ever order) ---
  {
    const { inserts, updates } = await placeOrder(context, baseUrl, null);
    t.check('no existing row -> a fresh sample_records row is created', inserts.length === 1);
    t.check('the fresh row is created as Pending', inserts[0]?.status === 'Pending');
    t.check('no existing row -> nothing is ever updated', updates.length === 0);
  }

  // --- An existing row is still Pending (not yet collected) -- must not duplicate it ---
  {
    const { inserts, updates } = await placeOrder(context, baseUrl, { id: 'sr1', status: 'Pending' });
    t.check('an existing still-Pending row -> no duplicate Pending row is created for the same uncollected specimen', inserts.length === 0);
    t.check('an existing still-Pending row -> it is never touched/regressed either', updates.length === 0);
  }

  // --- An existing row has already moved past collection (Collected/Received/
  // Processing/Completed/Released) -- the ORIGINAL bug this file protects
  // against: that row must NEVER be regressed back to Pending, but a
  // genuinely NEW order now correctly gets its own fresh row instead of
  // silently inheriting the old (finished) one's status. ---
  for (const priorStatus of ['Collected', 'Received', 'Processing', 'Completed', 'Released']) {
    const { inserts, updates } = await placeOrder(context, baseUrl, { id: 'sr1', status: priorStatus });
    t.check(`an existing ${priorStatus} row is never updated/regressed by a new order`, updates.length === 0);
    t.check(`an existing ${priorStatus} row -> the new order gets a genuinely NEW Pending row instead`, inserts.length === 1 && inserts[0]?.status === 'Pending');
  }

  return t;
};
