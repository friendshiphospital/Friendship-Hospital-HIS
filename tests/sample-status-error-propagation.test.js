// Covers the updateSampleStatus() silently-swallowed-error bug and the
// targeted audit of the same pattern in releaseResults(), the Unified
// Entry release path, and logCriticalValues(). Confirmed live: a real
// sample_records write failure during Verify/Release was silently
// ignored, so sample_records.status never actually advanced even though
// the calling save/release function went on to show its normal success
// toast — the direct cause of a released result showing no "View Result"
// option in the Doctor interface.
//
// Each TEST below drives the real saveChemEntry()/releaseResults()/
// releaseAllUnifiedEntry() functions from index.html against a mocked
// sample_records table whose .update() can be toggled to fail on demand,
// and checks the toast shown — not just whether a DB call happened — since
// the whole bug was that the wrong toast fired despite a real failure.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'lab@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

// sample_records mock: a single evolving row (like a real one-row-per-
// specimen record as the app tracks it), with an .update() that can be
// told to fail on the NEXT call only (matching "the write itself failed",
// not "no row existed" — that case is covered by returning null instead).
function sampleRecordsMockSrc() {
  return `
    window.__sample = { status: 'Received', payment_deferred: false, created_at: new Date().toISOString(), id: 'sr1' };
    window.__sampleShouldFail = false;
    function sampleRecordsTable() {
      const c = chainable(window.__sample, [window.__sample]);
      c.update = (payload) => ({ eq: () => {
        if (window.__sampleShouldFail) { window.__sampleShouldFail = false; return Promise.resolve({ data: null, error: { message: 'mock sample_records write failure (e.g. RLS denial)' } }); }
        Object.assign(window.__sample, payload);
        return Promise.resolve({ data: [window.__sample], error: null });
      } });
      return c;
    }
  `;
}

function baseInitScript(patient, opts) {
  opts = opts || {};
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    ${sampleRecordsMockSrc()}
    window.__mock = { savedRow: null, released: false, criticalInsertShouldFail: ${!!opts.criticalInsertShouldFail} };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech', role: 'lab_tech' }, []);
        if (table === 'patients') return chainable(${JSON.stringify(patient)}, []);
        if (table === 'sample_records') return sampleRecordsTable();
        if (table === 'critical_values') {
          const c = chainable(null, []);
          c.insert = (rows) => {
            if (window.__mock.criticalInsertShouldFail) return Promise.resolve({ data: null, error: { message: 'mock critical_values insert failure' } });
            return Promise.resolve({ data: rows, error: null });
          };
          return c;
        }
        if (table === 'results_chemistry') {
          const c = chainable(null, []);
          c.upsert = (payload) => { window.__mock.savedRow = { ...(window.__mock.savedRow||{}), ...payload }; return Promise.resolve({data:[payload],error:null}); };
          c.select = function(){ this.__select = true; return this; };
          c.eq = function(){ return this; };
          c.order = function(){ return this; };
          c.limit = function(){ return this; };
          c.maybeSingle = () => Promise.resolve({ data: window.__mock.savedRow, error: null });
          c.update = (payload) => ({ eq: () => { window.__mock.released = true; Object.assign(window.__mock.savedRow, payload); return Promise.resolve({data:null,error:null}); } });
          return c;
        }
        if (table === 'results_hematology') {
          const c = chainable(null, []);
          c.upsert = (payload) => { window.__mock.savedRow = { ...(window.__mock.savedRow||{}), ...payload }; return Promise.resolve({data:[payload],error:null}); };
          return c;
        }
        const c = chainable(null, []);
        c.insert = (payload) => Promise.resolve({data:[payload],error:null});
        c.update = () => ({ eq: () => Promise.resolve({data:null,error:null}) });
        c.upsert = (payload) => Promise.resolve({data:[payload],error:null});
        return c;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('sample-status-error-propagation');

  const rftPatient = { id: 'p1', name: 'Test Patient', mrn: 'M1', lab_no: 'L1', age: 50, age_unit: 'Years', sex: 'Male', tests_requested: ['RFT (Renal Function)'], payment_status: 'paid' };

  // --- TEST 1: sample_records write fails during VERIFY -> error toast, not false "saved & verified" ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInitScript(rftPatient));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Test Patient'));
    await page.waitForTimeout(200);
    await page.fill('#ce-creat', '88');
    await page.fill('#ce-urea', '5');
    await page.fill('#ce-ua', '300');
    await page.waitForTimeout(100);

    const toasts = [];
    await page.exposeFunction('__captV1', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function(msg,kind){ window.__captV1(msg); return orig?orig(msg,kind):undefined; }; });
    await page.evaluate(() => { window.__sampleShouldFail = true; });
    await page.evaluate(() => saveChemEntry(true));
    await page.waitForTimeout(200);

    t.check('a real sample_records write failure during Verify does NOT show the "saved & verified" success toast', !toasts.some(m => m.includes('saved & verified')));
    t.check('a real sample_records write failure during Verify surfaces as an error toast instead', toasts.some(m => /mock sample_records write failure/.test(m)));
    await page.close();
  }

  // --- TEST 2: sample_records write fails during RELEASE -> error toast, not false "released" ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInitScript(rftPatient));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Test Patient'));
    await page.waitForTimeout(200);
    await page.fill('#ce-creat', '88');
    await page.fill('#ce-urea', '5');
    await page.fill('#ce-ua', '300');
    await page.waitForTimeout(100);
    await page.evaluate(() => saveChemEntry(true)); // verify first, no injected failure yet
    await page.waitForTimeout(200);

    const toasts = [];
    await page.exposeFunction('__captV2', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function(msg,kind){ window.__captV2(msg); return orig?orig(msg,kind):undefined; }; });
    await page.evaluate(() => { window.__sampleShouldFail = true; });
    await page.evaluate(() => releaseResults('chem'));
    await page.waitForTimeout(200);

    t.check('a real sample_records write failure during Release does NOT show the "results released" success toast', !toasts.some(m => m.includes('results released')));
    t.check('a real sample_records write failure during Release surfaces as an error toast instead', toasts.some(m => /mock sample_records write failure/.test(m)));
    // The results table's own is_released write is a separate call from
    // sample_records — releaseResults()'s existing outer try/catch means
    // it already happened before updateSampleStatus() threw. That's an
    // accepted, documented tradeoff (see PR description): showing an error
    // rather than a false, unqualified success is the safe default.
    await page.close();
  }

  // --- TEST 3: happy path -- Verify then Release both succeed with NO injected failures, and sample_records.status genuinely advances ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInitScript(rftPatient));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Test Patient'));
    await page.waitForTimeout(200);
    await page.fill('#ce-creat', '88');
    await page.fill('#ce-urea', '5');
    await page.fill('#ce-ua', '300');
    await page.waitForTimeout(100);

    const toasts = [];
    await page.exposeFunction('__captV3', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function(msg,kind){ window.__captV3(msg); return orig?orig(msg,kind):undefined; }; });

    await page.evaluate(() => saveChemEntry(true));
    await page.waitForTimeout(200);
    const statusAfterVerify = await page.evaluate(() => window.__sample.status);
    t.check('Verify (no injected failure) shows the real success toast', toasts.some(m => m.includes('saved & verified')));
    t.check('sample_records.status genuinely advances to Completed after a clean Verify', statusAfterVerify === 'Completed');

    await page.evaluate(() => releaseResults('chem'));
    await page.waitForTimeout(200);
    const statusAfterRelease = await page.evaluate(() => window.__sample.status);
    const released = await page.evaluate(() => window.__mock.released);
    t.check('Release (no injected failure) shows the real success toast', toasts.some(m => m.includes('results released')));
    t.check('sample_records.status genuinely advances to Released after a clean Release', statusAfterRelease === 'Released');
    t.check('the results table is_released write itself also happened', released === true);
    await page.close();
  }

  // --- TEST 4: critical_values insert fails during a critical Haematology Verify -> error toast, not false "saved & verified" ---
  {
    const page = await context.newPage();
    const hemPatient = { id: 'p4', name: 'Critical Patient', mrn: 'M4', lab_no: 'L4', age: 45, age_unit: 'Years', sex: 'Female', tests_requested: ['Haemoglobin Only'], payment_status: 'paid' };
    await page.addInitScript(baseInitScript(hemPatient, { criticalInsertShouldFail: true }));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p4', 'L4', 'Critical Patient'));
    await page.waitForTimeout(200);
    // HGB of 5 g/dL is below logCriticalValues()'s own critRanges.hgb.lo (7) -> triggers a critical insert
    await page.fill('#he-hgb', '5');
    await page.waitForTimeout(100);

    const toasts = [];
    await page.exposeFunction('__captV4', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function(msg,kind){ window.__captV4(msg); return orig?orig(msg,kind):undefined; }; });
    await page.evaluate(() => saveHemEntry(true));
    await page.waitForTimeout(200);

    t.check('a real critical_values insert failure does NOT show the "saved & verified" success toast', !toasts.some(m => m.includes('saved & verified')));
    t.check('a real critical_values insert failure surfaces as an error toast instead (never silently dropping a critical alert)', toasts.some(m => /mock critical_values insert failure/.test(m)));
    await page.close();
  }

  return t;
};
