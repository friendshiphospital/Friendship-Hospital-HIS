// Covers Phase 1: payment gate on order placement + STAT payment deferral.
// Not part of the original four highest-value regression areas, but
// written the same way and left here so it runs alongside them via
// tests/run.js.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { doctorOrderInserts: [], sampleRecordInserts: [], radInserts: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'doctor_orders') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.doctorOrderInserts.push(payload); return Promise.resolve({data:null,error:null}); };
          return c;
        }
        if (table === 'sample_records') {
          // No existing row (chainable(null,[])) -> getCurrentSampleRecord()
          // sees nothing, so _submitLabOrder() INSERTs a fresh Pending row
          // (see migration_v2.47 / sample-records-per-order.test.js).
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.sampleRecordInserts.push(payload); return Promise.resolve({data:[payload],error:null}); };
          return c;
        }
        if (table === 'radiology_requests') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.radInserts.push(payload); return Promise.resolve({data:null,error:null}); };
          return c;
        }
        if (table === 'patients') {
          const c = chainable({id:'p1'}, []);
          return c;
        }
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: 'LAB-1', error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

function initScriptQueueVisibility() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const sampleRows = [
      { patient_id: 'paid1', status: 'Pending', payment_deferred: false, patients: { name: 'Paid Patient', mrn: 'M1', payment_status: 'paid' } },
      { patient_id: 'unpaid1', status: 'Pending', payment_deferred: false, patients: { name: 'Unpaid NotDeferred', mrn: 'M2', payment_status: 'unpaid' } },
      { patient_id: 'deferred1', status: 'Pending', payment_deferred: true, patients: { name: 'Deferred STAT', mrn: 'M3', payment_status: 'unpaid' } },
    ];
    const radRows = [
      { id: 'r1', patient_id: 'paid1', urgency: 'Routine', status: 'Requested', payment_deferred: false, patients: { name: 'Paid Patient', mrn: 'M1', payment_status: 'paid' } },
      { id: 'r2', patient_id: 'unpaid1', urgency: 'Routine', status: 'Requested', payment_deferred: false, patients: { name: 'Unpaid NotDeferred', mrn: 'M2', payment_status: 'unpaid' } },
      { id: 'r3', patient_id: 'deferred1', urgency: 'STAT', status: 'Requested', payment_deferred: true, patients: { name: 'Deferred STAT', mrn: 'M3', payment_status: 'unpaid' } },
    ];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: 'doctor' }, []);
        if (table === 'sample_records') return chainable(null, sampleRows);
        if (table === 'radiology_requests') return chainable(null, radRows);
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

function initScriptNotificationBell() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const deferredReleasedSample = [
      { patient_id: 'deferred1', status: 'Released', payment_deferred: true, patients: { name: 'Deferred STAT', mrn: 'M3', lab_no: 'LAB-3', payment_status: 'unpaid' } },
    ];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: 'doctor' }, []);
        if (table === 'sample_records') return chainable(null, deferredReleasedSample);
        if (table === 'radiology_requests') return chainable(null, []);
        if (table === 'invoices') return chainable(null, []);
        if (table === 'critical_values') return chainable(null, []);
        if (table === 'patients') return chainable(null, []);
        if (table === 'reagent_inventory') return chainable(null, []);
        if (table === 'admissions') return chainable(null, []);
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function loginAsDoctor(page, baseUrl, patientOverrides) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'doc@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
  await page.evaluate((pt) => {
    currentProfile = { role: 'doctor', id: 'doc1', full_name: 'Dr Test' };
    _docPt = Object.assign({ id: 'p1', name: 'Test Patient', payment_status: 'unpaid' }, pt);
  }, patientOverrides || {});
  await page.evaluate(() => goPage('consultation'));
  await page.waitForTimeout(100);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('payment-deferral');

  // --- TEST 1: non-STAT lab order for unpaid patient is hard-blocked, no insert ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { document.getElementById('ord-lab-priority').value = 'Routine'; });
    await page.evaluate(() => document.querySelector('.order-test-chk')?.click());
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(150);
    const inserts = await page.evaluate(() => window.__mock.doctorOrderInserts.length);
    t.check('Routine lab order for unpaid patient is blocked (no doctor_orders insert)', inserts === 0);
    await page.close();
  }

  // --- TEST 2: STAT lab order for unpaid patient prompts deferral; granting it proceeds with the deferral stamp ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    page.on('dialog', d => d.accept());
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { document.getElementById('ord-lab-priority').value = 'STAT'; });
    await page.evaluate(() => { const c = document.querySelector('.order-test-chk'); if (c) c.checked = true; });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(200);
    const orderInserts = await page.evaluate(() => window.__mock.doctorOrderInserts);
    const sampleInserts = await page.evaluate(() => window.__mock.sampleRecordInserts);
    t.check('STAT lab order proceeds after deferral is granted (doctor_orders insert happens)', orderInserts.length === 1);
    t.check('doctor_orders row is stamped payment_deferred:true with the doctor identity', orderInserts[0]?.[0]?.payment_deferred === true && orderInserts[0]?.[0]?.payment_deferred_by_name === 'Dr Test');
    t.check('sample_records insert also carries the deferral stamp', sampleInserts.length === 1 && sampleInserts[0]?.payment_deferred === true);
    await page.close();
  }

  // --- TEST 3: STAT lab order for unpaid patient, doctor DECLINES deferral -> nothing inserted ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    page.on('dialog', d => d.dismiss());
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { document.getElementById('ord-lab-priority').value = 'STAT'; });
    await page.evaluate(() => { const c = document.querySelector('.order-test-chk'); if (c) c.checked = true; });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(150);
    const inserts = await page.evaluate(() => window.__mock.doctorOrderInserts.length);
    t.check('declining the STAT deferral prompt leaves the order unsubmitted', inserts === 0);
    await page.close();
  }

  // --- TEST 4: paid patient's STAT order is never even prompted (proceeds straight through) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    let dialogFired = false;
    page.on('dialog', d => { dialogFired = true; d.accept(); });
    await loginAsDoctor(page, baseUrl, { payment_status: 'paid' });
    await page.evaluate(() => { document.getElementById('ord-lab-priority').value = 'STAT'; });
    await page.evaluate(() => { const c = document.querySelector('.order-test-chk'); if (c) c.checked = true; });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(150);
    const inserts = await page.evaluate(() => window.__mock.doctorOrderInserts);
    t.check('paid patient never triggers the payment gate dialog at all', !dialogFired);
    t.check('paid patient order is not marked as deferred', inserts.length === 1 && inserts[0]?.[0]?.payment_deferred === false);
    await page.close();
  }

  // --- TEST 5: Nursing order (previously ungated) is now blocked for an unpaid patient ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { const el = document.getElementById('ord-nrs-type'); if (el) el.value = el.options?.[0]?.value || 'Turn 2-hourly'; });
    await page.evaluate(() => submitNursingOrder());
    await page.waitForTimeout(150);
    const inserts = await page.evaluate(() => window.__mock.doctorOrderInserts.length);
    t.check('Nursing order for unpaid patient is now blocked (previously had no gate at all)', inserts === 0);
    await page.close();
  }

  // --- TEST 6: STAT radiology order deferral stamps radiology_requests + doctor_orders ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    page.on('dialog', d => d.accept());
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => {
      document.getElementById('ord-rad-urgency').value = 'STAT';
      const t = document.getElementById('ord-rad-type'); if (t) t.value = t.options?.[0]?.value || 'X-Ray — Chest PA';
      const i = document.getElementById('ord-rad-indication'); if (i) i.value = 'Test indication';
    });
    await page.evaluate(() => submitRadOrder());
    await page.waitForTimeout(200);
    const radInserts = await page.evaluate(() => window.__mock.radInserts);
    t.check('STAT radiology order proceeds after deferral and stamps radiology_requests', radInserts.length === 1 && radInserts[0]?.payment_deferred === true);
    await page.close();
  }

  // --- TEST 7: loadSampleQueue() hides unpaid non-deferred rows, shows paid + deferred ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptQueueVisibility());
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.evaluate(() => goPage('samples'));
    await page.waitForTimeout(100);
    await page.evaluate(() => loadSampleQueue());
    await page.waitForTimeout(150);
    const bodyText = await page.evaluate(() => document.getElementById('sc-queue-body').textContent);
    t.check('Sample Collection queue shows the paid patient', bodyText.includes('Paid Patient'));
    t.check('Sample Collection queue shows the STAT-deferred unpaid patient', bodyText.includes('Deferred STAT'));
    t.check('Sample Collection queue hides the plain unpaid (non-deferred) patient', !bodyText.includes('Unpaid NotDeferred'));
    t.check('Sample Collection queue flags the deferred row', bodyText.includes('Payment Deferred'));
    await page.close();
  }

  // --- TEST 8: loadRadRequests() has the same hide/show behaviour ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptQueueVisibility());
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.evaluate(() => goPage('radiology'));
    await page.waitForTimeout(100);
    await page.evaluate(() => loadRadRequests());
    await page.waitForTimeout(150);
    const bodyText = await page.evaluate(() => document.getElementById('rad-table-body').textContent);
    t.check('Radiology Requests queue shows the paid patient', bodyText.includes('Paid Patient'));
    t.check('Radiology Requests queue shows the STAT-deferred unpaid patient', bodyText.includes('Deferred STAT'));
    t.check('Radiology Requests queue hides the plain unpaid (non-deferred) patient', !bodyText.includes('Unpaid NotDeferred'));
    await page.close();
  }

  // --- TEST 9: notification bell resurfaces a deferred payment once the result is released ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptNotificationBell());
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.waitForSelector('#auth-screen', { state: 'visible' });
    await page.fill('#auth-email', 'doc@example.com');
    await page.fill('#auth-pass', 'whatever');
    await page.click('#auth-btn');
    await page.waitForTimeout(400);
    await page.evaluate(() => refreshNotifications());
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => _notifState?.deferredDue?.length);
    const countVisible = await page.evaluate(() => document.getElementById('notif-bell-count')?.style.display);
    t.check('a released, still-unpaid deferred order surfaces in the deferredDue notification category', state === 1);
    t.check('the notification bell badge becomes visible', countVisible === 'block');
    await page.close();
  }

  return t;
};
