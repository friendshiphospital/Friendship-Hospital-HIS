// Covers a live bug: doctor_orders.status was written once at order
// placement ('Pending') and only ever updated again on cancellation —
// nothing ever advanced it when the underlying lab results were actually
// verified/released, so a Lab order stayed stuck showing "Pending" forever
// in both Doctor Consultation's Active Orders list and the per-admission
// Orders tab (Bed Management drawer), even long after results were
// released. Fixed at the shared choke point every department's
// verify/release flow already calls: updateSampleStatus().
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { sampleRecordUpdates: [], doctorOrdersUpdates: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []);
        if (table === 'sample_records') {
          const c = chainable(null, []);
          c.update = (payload) => {
            window.__mock.sampleRecordUpdates.push(payload);
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          };
          return c;
        }
        if (table === 'doctor_orders') {
          const c = chainable(null, []);
          c.update = (payload) => {
            const eqs = [];
            const chain = { eq(field, val) { eqs.push([field, val]); return chain; }, then(resolve) { return resolve({ data: null, error: null }); } };
            window.__mock.doctorOrdersUpdates.push({ payload, eqs });
            return chain;
          };
          return c;
        }
        if (table === 'admissions') return chainable(null, []);
        if (table === 'patients') return chainable(null, []);
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
  await page.fill('#auth-email', 'labtech@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('lab-order-status-sync');

  // --- Releasing results advances the matching Lab doctor_orders row to Completed ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => updateSampleStatus('p1', 'Released'));
    await page.waitForTimeout(100);
    const updates = await page.evaluate(() => window.__mock.doctorOrdersUpdates);
    t.check('updateSampleStatus("Released") fires exactly one doctor_orders update', updates.length === 1);
    t.check('the update sets status:Completed', updates[0]?.payload?.status === 'Completed');
    const eqFields = await page.evaluate(() => window.__mock.doctorOrdersUpdates[0].eqs.map(e => e[0]));
    t.check('the update is scoped by patient_id, order_type, and only Pending rows (never touches Cancelled/already-Completed)',
      eqFields.includes('patient_id') && eqFields.includes('order_type') && eqFields.includes('status'));
    const eqValues = await page.evaluate(() => window.__mock.doctorOrdersUpdates[0].eqs);
    const orderTypeEq = eqValues.find(e => e[0] === 'order_type');
    const statusEq = eqValues.find(e => e[0] === 'status');
    t.check('scoped to order_type Lab specifically (not Radiology/Nursing/etc.)', orderTypeEq?.[1] === 'Lab');
    t.check('scoped to currently-Pending rows only', statusEq?.[1] === 'Pending');
    await page.close();
  }

  // --- Verifying (not just releasing) also advances it, since verify already called this with 'Completed' ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => updateSampleStatus('p2', 'Completed'));
    await page.waitForTimeout(100);
    const updates = await page.evaluate(() => window.__mock.doctorOrdersUpdates);
    t.check('updateSampleStatus("Completed") (verify) also advances the Lab order to Completed', updates.length === 1 && updates[0]?.payload?.status === 'Completed');
    await page.close();
  }

  // --- Unrelated sample_records status transitions (Collected, Processing, Pending) never touch doctor_orders ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => Promise.all([
      updateSampleStatus('p3', 'Collected'),
      updateSampleStatus('p3', 'Processing'),
      updateSampleStatus('p3', 'Pending'),
    ]));
    await page.waitForTimeout(100);
    const updates = await page.evaluate(() => window.__mock.doctorOrdersUpdates);
    t.check('non-completion sample status changes never fire a doctor_orders update', updates.length === 0);
    await page.close();
  }

  return t;
};
