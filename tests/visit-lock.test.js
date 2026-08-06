// Covers Six-issues Phase 6: once a doctor signs off a visit
// (patients.visit_status === 'Visit Complete', set by
// _finalizeVisitComplete()), the patient must become read-only across
// Doctor/Nursing/Lab/Radiology — write actions must refuse with a clear
// message — except via the existing follow-up mechanism, which
// re-registers the same MRN as a brand-new patients row rather than
// un-completing this one. Read access (Patient History Timeline,
// printing) is untouched since it never calls guardVisitNotLocked().
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(visitStatus) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { orderInserts: [], vitalsInserts: [], patientsUpdates: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Doctor Test', role:'doctor' }, []);
        if (table === 'patients') {
          const c = chainable({ id:'pLocked', visit_status:'${visitStatus}' }, []);
          c.eq = () => ({ ...c, maybeSingle: () => Promise.resolve({ data: { visit_status: '${visitStatus}' }, error: null }) });
          c.update = (payload) => { window.__mock.patientsUpdates.push(payload); return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
        if (table === 'doctor_orders') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.orderInserts.push(payload); return Promise.resolve({ data: null, error: null }); };
          return c;
        }
        if (table === 'vital_signs') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.vitalsInserts.push(payload); return Promise.resolve({ data: null, error: null }); };
          return c;
        }
        if (table === 'sample_records') return chainable(null, []);
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
  const t = makeSuite('visit-lock');

  // --- The guard itself: refuses on Visit Complete, allows otherwise ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('Visit Complete'));
    await login(page, baseUrl);
    const blocked = await page.evaluate(() => guardVisitNotLocked('pLocked', 'Test action'));
    t.check('guardVisitNotLocked() returns false for a Visit Complete patient', blocked === false);
    await page.close();
  }
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('With Doctor'));
    await login(page, baseUrl);
    const allowed = await page.evaluate(() => guardVisitNotLocked('pOpen', 'Test action'));
    t.check('guardVisitNotLocked() returns true for a visit that is not yet complete', allowed === true);
    await page.close();
  }

  // --- Doctor: placing a lab order is refused on a signed-off visit ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('Visit Complete'));
    await login(page, baseUrl);
    await page.evaluate(() => { _docPt = { id:'pLocked', name:'Locked Patient', payment_status:'paid' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    // Check a test box so submitLabOrder() has something to try to submit
    await page.evaluate(() => {
      const cb = document.querySelector('.order-test-chk');
      if (cb) cb.checked = true;
    });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(200);
    const orderInserted = await page.evaluate(() => window.__mock.orderInserts.length > 0);
    t.check('submitLabOrder() does NOT insert a doctor_orders row for a Visit Complete patient', orderInserted === false);
    await page.close();
  }

  // --- Doctor: the same action succeeds normally on an open visit ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('With Doctor'));
    await login(page, baseUrl);
    await page.evaluate(() => { _docPt = { id:'pOpen', name:'Open Patient', payment_status:'paid' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const cb = document.querySelector('.order-test-chk');
      if (cb) cb.checked = true;
    });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(200);
    const orderInserted = await page.evaluate(() => window.__mock.orderInserts.length > 0);
    t.check('submitLabOrder() still works normally for a visit that is not complete', orderInserted === true);
    await page.close();
  }

  // --- Nursing: recording vitals is refused on a signed-off visit ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('Visit Complete'));
    await login(page, baseUrl);
    await page.evaluate(() => { _vsPt = { id:'pLocked' }; });
    await page.evaluate(() => saveVitals());
    await page.waitForTimeout(200);
    const vitalsInserted = await page.evaluate(() => window.__mock.vitalsInserts.length > 0);
    t.check('saveVitals() does NOT insert a vital_signs row for a Visit Complete patient', vitalsInserted === false);
    await page.close();
  }

  // --- Lab: the shared saveResultWithSafetyChecks() pipeline is gated too ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('Visit Complete'));
    await login(page, baseUrl);
    const finalized = await page.evaluate(async () => {
      window.__saveResultReached = false;
      const origFrom = sb.from.bind(sb);
      sb.from = (t) => { if (t === 'results_hematology') window.__saveResultReached = true; return origFrom(t); };
      await saveResultWithSafetyChecks({ table:'results_hematology', deptLabel:'Haematology', pageId:'page-hem-entry', ptId:'pLocked', payload:{patient_id:'pLocked'}, hasCrit:false, verify:false, successLabel:'CBC' });
      return window.__saveResultReached;
    });
    t.check('saveResultWithSafetyChecks() never reaches the results table upsert for a Visit Complete patient', finalized === false);
    await page.close();
  }

  return t;
};
