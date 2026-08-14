// Covers reported confusion around the lab verify/release gate. Live
// investigation found:
//   1. The specific "Cannot verify — missing results for: eGFR" ->
//      "Results must be verified before they can be released" sequence for
//      RFT was the missing-calcEgfr() bug, already fixed earlier this
//      session (calcEgfr() is wired to #ce-creat's oninput). TEST 1 below
//      proves the RFT verify-then-release flow now works end-to-end.
//   2. A full sweep of every RESULT_TAGS field (hem/chem/sero/immuno)
//      against the actual entry-form inputs found no other structurally-
//      unpopulatable required field — every field either has a plain
//      manual input or a working auto-calc, confirming the earlier
//      "Part A" sweep already closed this class of bug. (Not separately
//      tested here since it's a static mapping check, not behavior —
//      see the PR description for the sweep methodology/result.)
//   3. Verification is per DEPARTMENT-ROW, not per-parameter:
//      checkVerificationComplete() requires every RESULT_TAGS field tagged
//      to a currently-ordered test to have a value, gating the WHOLE row's
//      is_verified flag in one Save & Verify action — not one field at a
//      time. TEST 2 proves this directly (a row with one of two ordered
//      panels' fields filled cannot verify; filling both allows it).
//   4. results_serology is one shared row for Serology AND Immunology.
//      checkSeroRowVerification() merges the existing DB row with the
//      in-flight payload and requires BOTH sub-departments' currently-
//      ordered fields together — TEST 3 proves saving only the Immunology
//      side (with an ordered Serology test still empty) does not verify.
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

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('lab-verify-release-gate');

  // --- TEST 1: RFT verify-then-release works end-to-end now that eGFR auto-calculates ---
  {
    const page = await context.newPage();
    const patient = { id: 'p1', name: 'Test Patient', mrn: 'M1', lab_no: 'L1', age: 50, age_unit: 'Years', sex: 'Male', tests_requested: ['RFT (Renal Function)'], payment_status: 'paid' };
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { savedRow: null, released: false };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech', role: 'lab_tech' }, []);
          if (table === 'patients') return chainable(${JSON.stringify(patient)}, []);
          if (table === 'results_chemistry') {
            const c = chainable(null, []);
            c.upsert = (payload) => { window.__mock.savedRow = { ...(window.__mock.savedRow||{}), ...payload }; return Promise.resolve({data:[payload],error:null}); };
            // After the Verify upsert, releaseResults() re-selects the row via .select().eq().order().limit().maybeSingle().
            c.select = function(cols){ this.__select = true; return this; };
            c.eq = function(){ return this; };
            c.order = function(){ return this; };
            c.limit = function(){ return this; };
            c.maybeSingle = () => Promise.resolve({ data: window.__mock.savedRow, error: null });
            c.update = (payload) => ({ eq: () => { window.__mock.released = true; Object.assign(window.__mock.savedRow, payload); return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          // status:'Received' -- Unified Results Entry now gates on the
          // current specimen's status (must be Received/Processing/
          // Completed/Released) before opening; this test's patient has
          // already had their sample received, matching the pre-verify
          // Section 8 golden-path point this test starts from.
          if (table === 'sample_records') return chainable({ payment_deferred: false, status: 'Received', created_at: new Date().toISOString() }, []);
          const c = chainable(null, []);
          c.insert = (payload) => Promise.resolve({data:[payload],error:null});
          c.update = () => ({ eq: () => Promise.resolve({data:null,error:null}) });
          return c;
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Test Patient'));
    await page.waitForTimeout(200);
    await page.fill('#ce-creat', '88');
    await page.fill('#ce-urea', '5');
    await page.fill('#ce-ua', '300');
    await page.waitForTimeout(100);
    const egfrValue = await page.evaluate(() => document.getElementById('ce-egfr')?.value);
    t.check('eGFR auto-calculates from Creatinine once age/sex are on file (the original root cause, already fixed)', !!egfrValue && egfrValue !== '');

    const toasts = [];
    await page.exposeFunction('__captVerify', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function(msg,kind){ window.__captVerify(msg); return orig?orig(msg,kind):undefined; }; });
    await page.evaluate(() => saveChemEntry(true));
    await page.waitForTimeout(200);
    t.check('Save & Verify for RFT no longer blocks on "missing results for: eGFR"', !toasts.some(m => m.includes('missing results for') && m.includes('eGFR')));
    t.check('Save & Verify succeeds', toasts.some(m => m.includes('verified')));

    await page.evaluate(() => releaseResults('chem'));
    await page.waitForTimeout(200);
    t.check('Release no longer blocks with "must be verified before they can be released"', !toasts.some(m => m.includes('must be verified')));
    const released = await page.evaluate(() => window.__mock.released);
    t.check('the result was actually released', released === true);
    await page.close();
  }

  // --- TEST 2: verification gates the WHOLE department-row, not one parameter at a time ---
  {
    const page = await context.newPage();
    // Two panels ordered (Serum Electrolytes needs na/k/cl/co2; RFT needs creat/urea/ua/egfr) —
    // only filling Electrolytes' fields must NOT be enough to verify, since RFT's fields are still empty.
    const patient = { id: 'p2', name: 'Two Panel Patient', mrn: 'M2', lab_no: 'L2', age: 40, age_unit: 'Years', sex: 'Female', tests_requested: ['Serum Electrolytes', 'RFT (Renal Function)'], payment_status: 'paid' };
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech', role: 'lab_tech' }, []);
          if (table === 'patients') return chainable(${JSON.stringify(patient)}, []);
          const c = chainable(null, []);
          c.insert = (payload) => Promise.resolve({data:[payload],error:null});
          c.update = () => ({ eq: () => Promise.resolve({data:null,error:null}) });
          c.upsert = (payload) => Promise.resolve({data:[payload],error:null});
          return c;
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p2', 'L2', 'Two Panel Patient'));
    await page.waitForTimeout(200);
    // Set ONLY the Electrolytes panel's values directly (not page.fill(),
    // since with two panels ordered on one department page, the Unified
    // Entry UI only keeps one panel's card in the currently-active tab —
    // a UI/navigation detail unrelated to what this test is actually
    // checking: the save-time verification-completeness logic itself).
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('ce-na', '140'); set('ce-k', '4'); set('ce-cl', '100'); set('ce-co2', '24');
    });
    const toasts = [];
    await page.exposeFunction('__captPartial', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function(msg,kind){ window.__captPartial(msg); return orig?orig(msg,kind):undefined; }; });
    await page.evaluate(() => saveChemEntry(true));
    await page.waitForTimeout(200);
    t.check('verifying with only one of two ordered panels filled is blocked (per-row, not per-parameter)', toasts.some(m => m.includes('Cannot verify')));
    t.check('the missing-fields message names the still-empty RFT fields, not the filled Electrolytes ones', toasts.some(m => /Creatinine|Urea|eGFR/i.test(m)) && !toasts.some(m => /Sodium|Potassium/i.test(m)));
    await page.close();
  }

  // --- TEST 3: results_serology is one shared row — verifying Immunology alone doesn't bypass a still-empty ordered Serology field ---
  {
    const page = await context.newPage();
    const patient = { id: 'p3', name: 'Shared Row Patient', mrn: 'M3', lab_no: 'L3', age: 35, age_unit: 'Years', sex: 'Male', tests_requested: ['HIV Ag/Ab', '🔹 Thyroid Profile (TSH+FT3+FT4)'], payment_status: 'paid' };
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech', role: 'lab_tech' }, []);
          if (table === 'patients') return chainable(${JSON.stringify(patient)}, []);
          if (table === 'results_serology') return chainable(null, []); // no existing row yet -- nothing saved on either side
          const c = chainable(null, []);
          c.insert = (payload) => Promise.resolve({data:[payload],error:null});
          c.update = () => ({ eq: () => Promise.resolve({data:null,error:null}) });
          c.upsert = (payload) => Promise.resolve({data:[payload],error:null});
          return c;
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p3', 'L3', 'Shared Row Patient'));
    await page.waitForTimeout(200);
    // Set ONLY the Thyroid (Immunology) fields directly; HIV (Serology) is
    // ordered but left empty (same page.fill()-vs-visibility reasoning as
    // TEST 2 above — this is checking save-time gating, not UI tab state).
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('se-tsh', '2.0'); set('se-ft3', '4.5'); set('se-ft4', '15');
    });
    const toasts = [];
    await page.exposeFunction('__captShared', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function(msg,kind){ window.__captShared(msg); return orig?orig(msg,kind):undefined; }; });
    await page.evaluate(() => saveSeroEntry(true));
    await page.waitForTimeout(200);
    t.check('verifying with the Immunology panel filled but an ordered Serology test (HIV) still empty is blocked', toasts.some(m => m.includes('Cannot verify')));
    t.check('the missing-fields message names HIV, confirming the shared-row check considers both sub-departments together', toasts.some(m => /HIV/i.test(m)));
    await page.close();
  }

  return t;
};
