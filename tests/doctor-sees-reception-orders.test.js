// Covers Phase 2: loadActiveOrders() (Doctor Consultation's Orders tab)
// merging reception-placed tests/studies (from Registration) with
// doctor-placed doctor_orders rows into one list, without duplicating a
// study that has both a radiology_requests row AND a doctor_orders row.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript({ doctorOrders, radRequests, testsRequested, patientCreatedAt }) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: 'doctor' }, []);
        if (table === 'doctor_orders') return chainable(null, ${JSON.stringify(doctorOrders || [])});
        if (table === 'radiology_requests') return chainable(null, ${JSON.stringify(radRequests || [])});
        if (table === 'patients') return chainable({ tests_requested: ${JSON.stringify(testsRequested || [])}, created_at: ${JSON.stringify(patientCreatedAt || '2026-01-01T08:00:00Z')} }, []);
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function loginAndOpenOrders(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'doc@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
  await page.evaluate(() => { _docPt = { id: 'p1', name: 'Test Patient' }; });
  await page.evaluate(() => goPage('consultation'));
  await page.waitForTimeout(100);
  await page.evaluate(() => loadActiveOrders());
  await page.waitForTimeout(150);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('doctor-sees-reception-orders');

  // --- TEST 1: a lab test requested at registration (no doctor_orders row) shows up, tagged as Reception ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      doctorOrders: [],
      radRequests: [],
      testsRequested: ['CBC', 'ESR'],
      patientCreatedAt: '2026-01-01T08:00:00Z',
    }));
    await loginAndOpenOrders(page, baseUrl);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    t.check('registration-time lab test (CBC) appears in the doctor\'s Orders tab', html.includes('CBC'));
    t.check('it is tagged as ordered by Reception, not a doctor', html.includes('Reception'));
    await page.close();
  }

  // --- TEST 2: a radiology study requested at registration (requesting_doctor blank) shows up tagged Reception ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      doctorOrders: [],
      radRequests: [{ imaging_type: 'X-Ray — Chest PA', urgency: 'Routine', status: 'Requested', requesting_doctor: '', created_at: '2026-01-01T08:05:00Z', payment_deferred: false }],
      testsRequested: [],
    }));
    await loginAndOpenOrders(page, baseUrl);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    t.check('registration-time radiology study appears in the Orders tab', html.includes('X-Ray'));
    t.check('it is tagged as ordered by Reception', html.includes('Reception'));
    await page.close();
  }

  // --- TEST 3: a doctor-placed lab test (has a doctor_orders row) is NOT duplicated as a Reception row ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      doctorOrders: [{ id: 'o1', order_type: 'Lab', order_detail: 'CBC', status: 'Pending', ordered_by: 'Dr Jones', ordered_at: '2026-01-02T10:00:00Z' }],
      radRequests: [],
      testsRequested: ['CBC'], // same test also merged onto patients.tests_requested by _submitLabOrder()
    }));
    await loginAndOpenOrders(page, baseUrl);
    const cbcCount = await page.evaluate(() => (document.getElementById('active-orders-list').textContent.match(/CBC/g) || []).length);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    t.check('a doctor-ordered test appearing in both doctor_orders AND tests_requested is listed exactly once', cbcCount === 1);
    t.check('it is attributed to the ordering doctor, not Reception', html.includes('Dr Jones'));
    await page.close();
  }

  // --- TEST 4: a doctor-placed radiology study (has BOTH a doctor_orders row AND a radiology_requests row) is not duplicated ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      doctorOrders: [{ id: 'o2', order_type: 'Radiology', order_detail: 'CT — Head', status: 'Pending', ordered_by: 'Dr Jones', ordered_at: '2026-01-02T11:00:00Z' }],
      radRequests: [{ imaging_type: 'CT — Head', urgency: 'STAT', status: 'Requested', requesting_doctor: 'Dr Jones', created_at: '2026-01-02T11:00:00Z', payment_deferred: false }],
      testsRequested: [],
    }));
    await loginAndOpenOrders(page, baseUrl);
    const ctCount = await page.evaluate(() => (document.getElementById('active-orders-list').textContent.match(/CT — Head/g) || []).length);
    t.check('a doctor-placed radiology study (present in both doctor_orders and radiology_requests) is listed exactly once', ctCount === 1);
    await page.close();
  }

  // --- TEST 5: mixed list sorts by time and shows both sources together ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      doctorOrders: [{ id: 'o3', order_type: 'Nursing', order_detail: 'Turn 2-hourly', status: 'Pending', ordered_by: 'Dr Jones', ordered_at: '2026-01-02T12:00:00Z' }],
      radRequests: [{ imaging_type: 'Ultrasound — Abdomen', urgency: 'Routine', status: 'Requested', requesting_doctor: '', created_at: '2026-01-01T08:00:00Z', payment_deferred: false }],
      testsRequested: ['Fasting Blood Sugar'],
      patientCreatedAt: '2026-01-01T08:00:00Z',
    }));
    await loginAndOpenOrders(page, baseUrl);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    t.check('unified list includes the reception lab test', html.includes('Fasting Blood Sugar'));
    t.check('unified list includes the reception radiology study', html.includes('Ultrasound'));
    t.check('unified list includes the doctor-placed Nursing order', html.includes('Turn 2-hourly'));
    await page.close();
  }

  return t;
};
