// Covers a reported gap: a doctor's Nursing order (submitNursingOrder(),
// order_type='Nursing' in doctor_orders) had nowhere in the Nursing
// module that ever read it back -- the Nursing page's "Queue" tab was
// purely a patient roster with no doctor_orders integration at all, so a
// nurse had no way to see what a doctor had ordered for a patient short
// of the doctor telling them directly. Also nothing ever marked a
// Nursing order Completed, so it stayed "Pending" forever on the
// doctor's own Active Orders list even after being carried out. Fixed
// with loadNursingOrders() (a "Pending Nursing Orders" card on the Queue
// tab) and completeNursingOrder() (writes doctor_orders.status back).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { updates: [] };
    let orders = [{ id:'o1', patient_id:'p1', order_detail:'Vitals q4h', ordered_by:'Dr. Smith', ordered_at:new Date().toISOString(), status:'Pending',
      patients: { name:'Nursing Order Patient', mrn:'M900', lab_no:'L900', ward:'Medical' } }];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Nurse Test', role:'nurse' }, []);
        if (table === 'doctor_orders') {
          const c = chainable(null, orders.filter(o => o.status === 'Pending'));
          c.update = (payload) => { window.__mock.updates.push(payload); return { eq: (field, val) => { orders = orders.map(o => o.id === val ? { ...o, ...payload } : o); return Promise.resolve({ data: null, error: null }); } }; };
          return c;
        }
        if (table === 'patients') return chainable(null, []);
        if (table === 'admissions') return chainable(null, []);
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
  await page.fill('#auth-email', 'nurse@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('nursing-orders-sync');

  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);
  await page.evaluate(() => goPage('nursing'));
  await page.waitForTimeout(200);

  const ordersBodyText = await page.evaluate(() => document.getElementById('nrs-orders-body')?.textContent || '');
  t.check('the doctor-placed Nursing order ("Vitals q4h") is visible on the Nursing Queue tab', ordersBodyText.includes('Vitals q4h'));
  t.check('the patient it belongs to is shown', ordersBodyText.includes('Nursing Order Patient'));
  t.check('who ordered it is shown', ordersBodyText.includes('Dr. Smith'));

  await page.click('button[onclick*="completeNursingOrder"]');
  await page.waitForTimeout(200);

  const updateCall = await page.evaluate(() => window.__mock.updates[0]);
  t.check('marking it done writes status:Completed back to doctor_orders (visible again on the Doctor side)', updateCall?.status === 'Completed');
  const ordersBodyAfter = await page.evaluate(() => document.getElementById('nrs-orders-body')?.textContent || '');
  t.check('the completed order no longer shows in the Pending list', !ordersBodyAfter.includes('Vitals q4h'));

  await page.close();
  return t;
};
