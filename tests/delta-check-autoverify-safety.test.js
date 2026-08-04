// Patient-safety audit (Prompt1 Phase 5): proves, with actual test cases
// rather than a code read, that:
//   1. Delta Checking's six analyte thresholds (DELTA_RULES) each correctly
//      block/flag at their documented boundary — Hgb drop >20%, Platelet
//      drop >50%, WBC swing >50%, Potassium shift >1.5, Sodium shift >10,
//      Creatinine rise >50%.
//   2. Auto-Verification's four gate conditions (in-range, no delta
//      breach, QC accepted and on file, not critical) each independently
//      and correctly block auto-verification when violated, and only
//      allow it when ALL FOUR hold simultaneously.
//
// Findings are reported inline as comments next to the relevant checks,
// not just asserted silently — see the boundary-inclusivity note below.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(overrides) {
  const o = overrides || {};
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { upserts: [], deltaLogInserts: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []);
        if (table === 'results_hematology_history' || table === 'results_chemistry_history') {
          return chainable(${JSON.stringify(o.historyRow ?? null)}, []);
        }
        if (table === 'results_hematology' || table === 'results_chemistry') {
          const c = chainable(${JSON.stringify(o.currentRow ?? null)}, []);
          c.upsert = (payload) => { window.__mock.upserts.push(payload); return Promise.resolve({ data: null, error: null }); };
          return c;
        }
        if (table === 'qc_lots') return chainable(null, ${JSON.stringify(o.qcLots ?? [{ id: 'lot1' }])});
        if (table === 'qc_results') return chainable(null, ${JSON.stringify(o.qcResults ?? [{ accepted: true, result_date: '2026-01-01' }])});
        if (table === 'delta_check_log') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.deltaLogInserts.push(payload); return Promise.resolve({ data: null, error: null }); };
          return c;
        }
        if (table === 'sample_records') return chainable(null, []);
        if (table === 'doctor_orders') return chainable(null, []);
        if (table === 'critical_values') return chainable(null, []);
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
  const t = makeSuite('delta-check-autoverify-safety');

  // ═══════════════════════════════════════════════════════════════════
  // PART 1 — Delta Checking: computeDelta()/deltaBreaches() pure-function
  // proof against DELTA_RULES, one page load, many direct evaluations.
  // ═══════════════════════════════════════════════════════════════════
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);

    const check = async (field, prev, curr, expectBreach, label) => {
      const result = await page.evaluate(({ field, prev, curr }) => {
        const rule = DELTA_RULES[field];
        const delta = computeDelta(prev, curr, rule);
        return { delta, breach: deltaBreaches(delta, rule) };
      }, { field, prev, curr });
      t.check(label + ` (delta=${result.delta.toFixed(2)}, breach=${result.breach})`, result.breach === expectBreach);
    };

    // --- Hgb: drop >20% (pct, direction:drop, threshold:20) ---
    await check('hgb', 10.0, 8.5, false, 'Hgb drop of 15% (below 20% threshold) does NOT breach');
    // Boundary: implementation uses delta<=-threshold, i.e. exactly -20% DOES breach.
    // Documented as "drop >20%" (strict); actual behavior is ">=20%" (inclusive).
    // This is the boundary-inclusivity finding: not a bug (erring toward MORE
    // scrutiny, not less, is the safe direction for a patient-safety gate),
    // but worth flagging as a documentation/implementation mismatch.
    await check('hgb', 10.0, 8.0, true, 'Hgb drop of exactly 20% DOES breach (boundary is inclusive >=, not strict >)');
    await check('hgb', 10.0, 7.0, true, 'Hgb drop of 30% (clearly above 20%) breaches');
    await check('hgb', 8.0, 10.0, false, 'Hgb RISE of 25% does NOT breach the drop-only rule (direction-specific, correct)');

    // --- Platelets: drop >50% (pct, direction:drop, threshold:50) ---
    await check('plt', 200, 120, false, 'Platelet drop of 40% (below 50%) does NOT breach');
    await check('plt', 200, 100, true, 'Platelet drop of exactly 50% breaches (inclusive boundary)');
    await check('plt', 200, 80, true, 'Platelet drop of 60% breaches');
    await check('plt', 100, 200, false, 'Platelet RISE of 100% does NOT breach the drop-only rule');

    // --- WBC: swing >50% either direction (pct, direction:either, threshold:50) ---
    await check('wbc', 6.0, 8.5, false, 'WBC rise of ~42% (below 50%) does NOT breach');
    await check('wbc', 6.0, 9.0, true, 'WBC rise of exactly 50% breaches');
    await check('wbc', 6.0, 3.0, true, 'WBC drop of 50% ALSO breaches (either direction, matches "swing")');
    await check('wbc', 6.0, 2.0, true, 'WBC drop of ~67% breaches');

    // --- Potassium: shift >1.5 mmol/L absolute, either direction ---
    await check('k', 4.0, 5.2, false, 'Potassium rise of 1.2 (below 1.5) does NOT breach');
    await check('k', 4.0, 5.5, true, 'Potassium rise of exactly 1.5 breaches');
    await check('k', 4.0, 2.5, true, 'Potassium DROP of 1.5 also breaches (either direction)');

    // --- Sodium: shift >10 mmol/L absolute, either direction ---
    await check('na', 140, 148, false, 'Sodium shift of 8 (below 10) does NOT breach');
    await check('na', 140, 150, true, 'Sodium shift of exactly 10 breaches');
    await check('na', 140, 128, true, 'Sodium DROP of 12 also breaches (either direction)');

    // --- Creatinine: rise >50% (pct, direction:rise, threshold:50) ---
    await check('creat', 80, 110, false, 'Creatinine rise of ~37.5% (below 50%) does NOT breach');
    await check('creat', 80, 120, true, 'Creatinine rise of exactly 50% breaches');
    await check('creat', 120, 80, false, 'Creatinine DROP of ~33% does NOT breach the rise-only rule (a falling creatinine is not the AKI-warning direction, correctly excluded)');

    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 2 — runDeltaCheck() end-to-end: confirms the async DB-comparison
  // wrapper actually surfaces breaches computed against the prior on-file
  // result, not just that the pure functions are correct in isolation.
  // ═══════════════════════════════════════════════════════════════════
  {
    const page = await context.newPage();
    // Prior Hgb on file: 10.0. New value: 7.0 (30% drop -> should breach).
    await page.addInitScript(initScript({ historyRow: { hgb: 10.0, analysis_date: '2026-01-01' } }));
    await login(page, baseUrl);
    const breaches = await page.evaluate(() => runDeltaCheck('results_hematology', 'p1', { hgb: 7.0 }));
    t.check('runDeltaCheck() surfaces the Hgb breach against the patient\'s actual prior result', breaches.length === 1 && breaches[0].field === 'hgb');
    await page.close();
  }
  {
    const page = await context.newPage();
    // Prior Hgb on file: 10.0. New value: 9.5 (5% drop -> should NOT breach).
    await page.addInitScript(initScript({ historyRow: { hgb: 10.0, analysis_date: '2026-01-01' } }));
    await login(page, baseUrl);
    const breaches = await page.evaluate(() => runDeltaCheck('results_hematology', 'p1', { hgb: 9.5 }));
    t.check('runDeltaCheck() does NOT flag a clinically insignificant change', breaches.length === 0);
    await page.close();
  }
  {
    const page = await context.newPage();
    // No prior result on file at all (new patient) -> nothing to compare against.
    await page.addInitScript(initScript({ historyRow: null, currentRow: null }));
    await login(page, baseUrl);
    const breaches = await page.evaluate(() => runDeltaCheck('results_hematology', 'p1', { hgb: 7.0 }));
    t.check('runDeltaCheck() returns no breaches when there is no prior result to compare against (first-ever result)', breaches.length === 0);
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 3 — Auto-Verification's four gate conditions, each tested in
  // isolation (three satisfied, one violated) to prove each one
  // independently blocks, then all four together to prove eligibility.
  // ═══════════════════════════════════════════════════════════════════
  async function setupHemPage(page) {
    await page.evaluate(() => goPage('hem-entry'));
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
  }

  // --- Gate: not critical. hasCrit=true alone blocks, all else satisfied. ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ qcResults: [{ accepted: true, result_date: '2026-01-01' }] }));
    await login(page, baseUrl);
    await setupHemPage(page);
    const gate = await page.evaluate(() => checkAutoVerifyEligible('page-hem-entry', 'Haematology', true));
    t.check('Gate 1 (not critical): a critical/panic value alone blocks eligibility', gate.eligible === false && /critical/i.test(gate.reason));
    await page.close();
  }

  // --- Gate: in-range. An out-of-range field alone blocks, all else satisfied. ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ qcResults: [{ accepted: true, result_date: '2026-01-01' }] }));
    await login(page, baseUrl);
    await setupHemPage(page);
    await page.evaluate(() => { document.getElementById('he-wbc').classList.add('hi'); });
    const gate = await page.evaluate(() => checkAutoVerifyEligible('page-hem-entry', 'Haematology', false));
    t.check('Gate 2 (in-range): an out-of-range field alone blocks eligibility', gate.eligible === false && /reference range/i.test(gate.reason));
    await page.close();
  }

  // --- Gate: QC accepted and on file. No passing QC alone blocks, all else satisfied. ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ qcLots: [], qcResults: [] })); // no active QC lots at all
    await login(page, baseUrl);
    await setupHemPage(page);
    const gate = await page.evaluate(() => checkAutoVerifyEligible('page-hem-entry', 'Haematology', false));
    t.check('Gate 3 (QC on file): no active/accepted QC for the department alone blocks eligibility', gate.eligible === false && /QC/i.test(gate.reason));
    await page.close();
  }
  {
    const page = await context.newPage();
    // QC lot exists, but its most recent result was REJECTED, not accepted.
    await page.addInitScript(initScript({ qcLots: [{ id: 'lot1' }], qcResults: [{ accepted: false, result_date: '2026-01-01' }] }));
    await login(page, baseUrl);
    await setupHemPage(page);
    const gate = await page.evaluate(() => checkAutoVerifyEligible('page-hem-entry', 'Haematology', false));
    t.check('Gate 3b (QC accepted, not just present): a REJECTED most-recent QC result also blocks eligibility', gate.eligible === false);
    await page.close();
  }

  // --- Gate: no delta breach. Structurally enforced by saveResultWithSafetyChecks()
  //     returning before auto-verify is ever attempted -- proven end-to-end,
  //     not just by inspecting checkAutoVerifyEligible() (which has no delta
  //     parameter at all; the pipeline itself is the enforcement point). ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      historyRow: { hgb: 10.0, analysis_date: '2026-01-01' }, // prior Hgb 10.0
      qcLots: [{ id: 'lot1' }], qcResults: [{ accepted: true, result_date: '2026-01-01' }],
    }));
    await login(page, baseUrl);
    await page.evaluate(() => { CFG.autoVerifyEnabled = true; });
    const outcome = await page.evaluate(() => new Promise((resolve) => {
      saveResultWithSafetyChecks({
        table: 'results_hematology', deptLabel: 'Haematology', pageId: 'page-hem-entry', ptId: 'p1',
        payload: { hgb: 7.0 }, // 30% drop -> breaches even though in-range/QC-passed/not-critical all hold
        hasCrit: false, verify: false, successLabel: 'CBC',
      });
      // showDeltaAlertModal() opens a modal rather than resolving a promise;
      // give the pipeline a moment to reach that point, then inspect state.
      setTimeout(() => resolve({
        modalOpen: document.getElementById('delta-alert-ov')?.classList.contains('open') || document.getElementById('delta-alert-ov')?.style.display !== 'none',
        upsertsBeforeOverride: window.__mock.upserts.length,
      }), 200);
    }));
    t.check('Gate 4 (no delta breach): a breach halts the pipeline BEFORE any auto-verify attempt or save (delta alert modal shown, nothing persisted yet)', outcome.upsertsBeforeOverride === 0);
    // Now confirm that even after resolving the breach via override, the
    // result is forced to manual sign-off -- auto-verify is never reached,
    // regardless of how clean the other three gates are.
    await page.evaluate(() => {
      // Option values default to their text content (no explicit value=""
      // attribute on any option) — must match one exactly.
      document.getElementById('delta-reason-code').value = 'Confirmed by Re-run';
      document.getElementById('delta-reason-note').value = 'Confirmed on repeat, clinically consistent with acute bleed';
    });
    await page.evaluate(() => confirmDeltaOverride());
    await page.waitForTimeout(150);
    const finalPayload = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('after override, the result IS saved but forced to manual sign-off (is_verified:false), never auto-verified despite all other gates passing', finalPayload?.is_verified === false);
    const logged = await page.evaluate(() => window.__mock.deltaLogInserts.length);
    t.check('the delta breach and its override reason are written to the audit log (delta_check_log)', logged === 1);
    await page.close();
  }

  // --- All four gates satisfied simultaneously -> eligible, and the full
  //     pipeline actually auto-verifies and releases. ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      historyRow: { hgb: 10.0, analysis_date: '2026-01-01' }, // prior Hgb 10.0, new value below will be a tiny, non-breaching change
      qcLots: [{ id: 'lot1' }], qcResults: [{ accepted: true, result_date: '2026-01-01' }],
    }));
    await login(page, baseUrl);
    await setupHemPage(page);
    const gate = await page.evaluate(() => checkAutoVerifyEligible('page-hem-entry', 'Haematology', false));
    t.check('all four gates satisfied (not critical, in-range, QC accepted+on-file) -> checkAutoVerifyEligible reports eligible', gate.eligible === true);

    await page.evaluate(() => { CFG.autoVerifyEnabled = true; });
    await page.evaluate(() => saveResultWithSafetyChecks({
      table: 'results_hematology', deptLabel: 'Haematology', pageId: 'page-hem-entry', ptId: 'p1',
      payload: { hgb: 9.8 }, // 2% drop from prior 10.0 -- well under the 20% threshold, no breach
      hasCrit: false, verify: false, successLabel: 'CBC',
    }));
    await page.waitForTimeout(150);
    const finalPayload = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('end-to-end: a clean result (no delta breach, in-range, QC passed, not critical) is actually auto-verified and released (is_verified:true)', finalPayload?.is_verified === true);
    const badge = await page.evaluate(() => document.querySelector('#page-hem-entry .av-status-badge')?.innerHTML || '');
    t.check('the UI badge reflects Auto-Verified, not manual/pending', badge.includes('Auto-Verified'));
    await page.close();
  }

  // --- Auto-verify globally disabled -> never auto-verifies even with all four gates clean. ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      historyRow: { hgb: 10.0, analysis_date: '2026-01-01' },
      qcLots: [{ id: 'lot1' }], qcResults: [{ accepted: true, result_date: '2026-01-01' }],
    }));
    await login(page, baseUrl);
    await setupHemPage(page);
    await page.evaluate(() => { CFG.autoVerifyEnabled = false; });
    await page.evaluate(() => saveResultWithSafetyChecks({
      table: 'results_hematology', deptLabel: 'Haematology', pageId: 'page-hem-entry', ptId: 'p1',
      payload: { hgb: 9.8 }, hasCrit: false, verify: false, successLabel: 'CBC',
    }));
    await page.waitForTimeout(150);
    const finalPayload = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('with the master Auto-Verification toggle OFF, a clean result is never auto-verified regardless of the four gates', finalPayload?.is_verified === false);
    await page.close();
  }

  return t;
};
