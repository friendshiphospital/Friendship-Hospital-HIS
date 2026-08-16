// Covers Phase 3: doctor click-through to verified/released results from
// the Orders tab and Patient Queue, and the notification bell's
// "Results Ready" category.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

// View Result gating moved off the single shared sample_records.status flag
// (one row per SPECIMEN/ORDER-BATCH, not per department) onto each
// department's own results_<dept>.is_released — the same signal
// releaseResults() itself writes. deptReleased is a short-key -> boolean
// map, e.g. { hem: true, chem: false }.
const TABLE_TO_DEPT = { results_hematology:'hem', results_chemistry:'chem', results_serology:'sero', results_microbiology:'micro', results_pcr:'pcr', results_histopathology:'histo', results_cytology:'cyto' };
function initScriptOrdersTab({ deptReleased, radRequests, testsRequested }) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { printCalls: [] };
    const __tableToDept = ${JSON.stringify(TABLE_TO_DEPT)};
    const __deptReleased = ${JSON.stringify(deptReleased || {})};
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: 'doctor' }, []);
        if (table === 'doctor_orders') return chainable(null, []);
        if (table === 'radiology_requests') return chainable(null, ${JSON.stringify(radRequests || [])});
        if (table === 'patients') return chainable({ tests_requested: ${JSON.stringify(testsRequested || [])}, created_at: '2026-01-01T08:00:00Z' }, []);
        if (__tableToDept[table]) return chainable({ is_released: !!__deptReleased[__tableToDept[table]] }, []);
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

function initScriptNotifBell() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const queuePatients = [{ id: 'qp1', name: 'Ready Patient', mrn: 'M9', visit_destination: 'doctor', created_at: '2026-01-01T08:00:00Z' }];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: 'doctor' }, []);
        if (table === 'patients') return chainable(null, queuePatients);
        // resultsReady now resolves each patient's CURRENT (most recently
        // created) specimen via mostRecentSampleByPatient() rather than
        // just checking whether any row was returned -- needs a real
        // Completed/Released status and a created_at to compare against.
        if (table === 'sample_records') return chainable(null, [{ patient_id: 'qp1', status: 'Completed', created_at: '2026-01-01T09:00:00Z' }]);
        if (table === 'radiology_requests') return chainable(null, []);
        if (table === 'invoices') return chainable(null, []);
        if (table === 'critical_values') return chainable(null, []);
        if (table === 'reagent_inventory') return chainable(null, []);
        if (table === 'admissions') return chainable(null, []);
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function loginAsDoctor(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'doc@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('doctor-view-results');

  // --- TEST 1: Lab result NOT yet ready -> no View Result button ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptOrdersTab({ deptReleased: { hem: false }, testsRequested: ['CBC'] }));
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Test Patient' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => loadActiveOrders());
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    t.check('lab order not yet completed shows no View Result button', !html.includes('View Result'));
    await page.close();
  }

  // --- TEST 2: Lab result ready -> View Result button calls printResultByDept with the right department ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptOrdersTab({ deptReleased: { hem: true }, testsRequested: ['CBC'] }));
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Test Patient' }; });
    // Override AFTER page load — index.html's own `function printResultByDept`
    // declaration would otherwise clobber a pre-load window.* mock.
    await page.evaluate(() => { window.printResultByDept = (ptId, dept) => { window.__mock.printCalls.push({type:'lab', ptId, dept}); }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => loadActiveOrders());
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    t.check('completed lab order shows a View Result button', html.includes('View Result'));
    await page.evaluate(() => document.querySelector('#active-orders-list button.btn-s')?.click());
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__mock.printCalls);
    t.check('clicking View Result calls printResultByDept with the resolved department (haematology, for CBC)', calls.length === 1 && calls[0].type === 'lab' && calls[0].dept === 'haematology' && calls[0].ptId === 'p1');
    await page.close();
  }

  // --- TEST 3: Radiology report Reported -> View Report button calls printRadReportById ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptOrdersTab({
      deptReleased: {},
      radRequests: [{ id: 'rr1', imaging_type: 'X-Ray — Chest PA', status: 'Reported', requesting_doctor: 'Dr Jones', created_at: '2026-01-01T09:00:00Z' }],
    }));
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Test Patient' }; });
    await page.evaluate(() => { window.printRadReportById = (id) => { window.__mock.printCalls.push({type:'rad', id}); }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => loadActiveOrders());
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    t.check('a Reported radiology study shows a View Report button', html.includes('View Report'));
    await page.evaluate(() => document.querySelector('#active-orders-list button.btn-s')?.click());
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__mock.printCalls);
    t.check('clicking View Report calls printRadReportById with the request id', calls.length === 1 && calls[0].type === 'rad' && calls[0].id === 'rr1');
    await page.close();
  }

  // --- TEST 4: Radiology study still Requested (not reported yet) -> no View Report button ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptOrdersTab({
      deptReleased: {},
      radRequests: [{ id: 'rr2', imaging_type: 'CT — Head', status: 'Requested', requesting_doctor: 'Dr Jones', created_at: '2026-01-01T09:00:00Z' }],
    }));
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Test Patient' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => loadActiveOrders());
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    t.check('a study still awaiting report shows no View Report button', !html.includes('View Report'));
    await page.close();
  }

  // --- TEST 5: notification bell surfaces "Results Ready" for a patient in the doctor's queue ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptNotifBell());
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => refreshNotifications());
    await page.waitForTimeout(150);
    const readyCount = await page.evaluate(() => _notifState?.resultsReady?.length);
    t.check('a doctor-routed patient with a completed sample surfaces in resultsReady', readyCount === 1);
    await page.close();
  }

  // --- TEST 6: an already-released Haematology result must stay viewable
  // even though a second, not-yet-released Chemistry order also exists on
  // the same patient. Confirmed live: gating View Result off the shared
  // sample_records.status (one row per SPECIMEN/ORDER-BATCH) meant a fresh
  // Pending row created for the NEW Chemistry order became "current" and
  // hid the View Result button for the already-released CBC too. ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptOrdersTab({ deptReleased: { hem: true, chem: false }, testsRequested: ['CBC', 'RFT (Renal Function)'] }));
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Test Patient' }; });
    await page.evaluate(() => { window.printResultByDept = (ptId, dept) => { window.__mock.printCalls.push({type:'lab', ptId, dept}); }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => loadActiveOrders());
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    const viewResultCount = (html.match(/View Result/g) || []).length;
    t.check('a released Haematology result stays viewable when an unrelated Chemistry order is still pending (exactly one View Result button)', viewResultCount === 1);
    await page.evaluate(() => document.querySelector('#active-orders-list button.btn-s')?.click());
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__mock.printCalls);
    t.check('the one View Result button that does show links to the released department (haematology), not the pending one', calls.length === 1 && calls[0].dept === 'haematology');
    await page.close();
  }

  // --- TEST 7: inverse of TEST 6 — a not-yet-released Chemistry result must
  // NOT become viewable just because Haematology was already released.
  // Confirmed live: releaseResults('hem') flipped the single shared
  // sample_records.status to 'Released', which used to make View Result
  // (and a real printResultByDept() call into printChemReport(), which has
  // no is_released check of its own) available for Chemistry results that
  // were still unverified/unreleased — a genuine premature-disclosure gap,
  // not just a cosmetic one. ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptOrdersTab({ deptReleased: { hem: true, chem: false }, testsRequested: ['RFT (Renal Function)'] }));
    await loginAsDoctor(page, baseUrl);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Test Patient' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    await page.evaluate(() => loadActiveOrders());
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('active-orders-list').innerHTML);
    t.check('an unreleased Chemistry order shows no View Result button even though Haematology was already released for this patient', !html.includes('View Result'));
    await page.close();
  }

  return t;
};
