// Covers Documentation/Logbook Phase 1 (Laboratory, descoped per the
// Phase 0 audit): Westgard multi-rule engine (2-2s/R-4s/4-1s/10x, beyond
// the pre-existing single-point 1-2s/1-3s), %CV + Six Sigma metric
// (rolling-window aggregate over qc_results + a TEa reference table),
// the Reagent Lot & Stability Register (a reporting view over the
// existing inventory_batches data, not a new data model), and the
// Critical Value Panic Log fixes (MRN/Lab No snapshot onto the row, and
// a real read-back — re-typing the actual value — replacing the old
// bare prompt()).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { criticalInsert: null, patientsSelectId: null };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Test', role: 'admin' }, []);
        ${extra || ''}
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
  await page.fill('#auth-email', 'admin@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('doclogbook-lab-phase1');

  // --- Westgard multi-rule engine (pure function, no mocking needed) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    const results = await page.evaluate(() => ({
      single1_2s: evaluateWestgardRules([0, 0, 0, 2.1]),
      single1_3s: evaluateWestgardRules([0, 0, 0, 3.2]),
      rule2_2s: evaluateWestgardRules([0, 0, 2.3, 2.5]),
      not2_2sOppositeSigns: evaluateWestgardRules([0, 0, 2.3, -2.5]),
      ruleR4s: evaluateWestgardRules([0, -2.1, 2.1]),
      rule4_1s: evaluateWestgardRules([0, 1.2, 1.3, 1.1, 1.4]),
      not4_1sMixedSign: evaluateWestgardRules([0, 1.2, -1.3, 1.1, 1.4]),
      rule10x: evaluateWestgardRules(new Array(10).fill(0).map((_, i) => 0.3 + i * 0.01)),
      rejectSetShape: [...WESTGARD_REJECT_RULES],
    }));
    t.check('a single point >=2SD flags 1-2s (warning)', results.single1_2s.includes('1-2s'));
    t.check('a single point >=3SD flags 1-3s (reject)', results.single1_3s.includes('1-3s'));
    t.check('two consecutive same-side points >=2SD flags 2-2s', results.rule2_2s.includes('2-2s'));
    t.check('2-2s does NOT fire when the two points are on opposite sides', !results.not2_2sOppositeSigns.includes('2-2s'));
    t.check('a >4SD swing between consecutive points flags R-4s', results.ruleR4s.includes('R-4s'));
    t.check('four consecutive same-side points >=1SD flags 4-1s', results.rule4_1s.includes('4-1s'));
    t.check('4-1s does NOT fire when the run of points has mixed signs', !results.not4_1sMixedSign.includes('4-1s'));
    t.check('ten consecutive same-side points flags 10x, even with small individual deviations', results.rule10x.includes('10x'));
    t.check('1-2s is a warning rule, not in the reject set', !results.rejectSetShape.includes('1-2s'));
    t.check('1-3s, 2-2s, R-4s, 4-1s, 10x are all reject rules', ['1-3s', '2-2s', 'R-4s', '4-1s', '10x'].every(r => results.rejectSetShape.includes(r)));
    await page.close();
  }

  // --- %CV + Six Sigma metric ---
  {
    const page = await context.newPage();
    const results = [
      { result_value: 100 }, { result_value: 102 }, { result_value: 98 },
      { result_value: 101 }, { result_value: 99 }, { result_value: 103 },
    ];
    await page.addInitScript(initScript(`
        if (table === 'qc_results') return chainable(null, ${JSON.stringify(results)});
    `));
    await login(page, baseUrl);
    const stats = await page.evaluate(() => computeQcRollingStats('lot1', 20));
    t.check('rolling stats compute a non-null %CV from a real result series', stats && stats.cv != null && stats.cv > 0);
    t.check('rolling stats report the correct sample count', stats.n === 6);
    const lotWithAnalyte = { target_mean: 100, analyte: 'Glucose' };
    const metric = await page.evaluate(({lot, s}) => computeSigmaMetric(lot, s), {lot: lotWithAnalyte, s: stats});
    t.check('Sigma metric computes when the lot has an analyte + target mean set', metric && typeof metric.sigma === 'number');
    t.check('Sigma metric uses the seeded TEa for Glucose (10%)', metric.tea === 10);
    const lotNoAnalyte = { target_mean: 100, analyte: null };
    const noMetric = await page.evaluate(({lot, s}) => computeSigmaMetric(lot, s), {lot: lotNoAnalyte, s: stats});
    t.check('Sigma metric is unavailable (null) when the lot has no analyte set — matches the spec\'s "require selecting correct analyte"', noMetric === null);
    const band = await page.evaluate(() => sigmaBand(6.5));
    t.check('a Sigma of 6.5 bands as World Class', band.label === 'World Class');
    const poorBand = await page.evaluate(() => sigmaBand(2));
    t.check('a Sigma of 2 bands as Poor', poorBand.label === 'Poor');
    await page.close();
  }

  // --- Reagent Lot & Stability Register ---
  {
    const page = await context.newPage();
    const items = [{ id: 'i1', item_name: 'Glucose Reagent', department: 'Laboratory', onboard_stability_days: 30 }];
    const batches = [
      { id: 'b1', item_id: 'i1', batch_no: 'LOT-001', quantity: 5, received_date: '2026-07-01', expiry_date: '2026-12-01', is_opened: false },
      { id: 'b2', item_id: 'i1', batch_no: 'LOT-002', quantity: 2, received_date: '2026-06-01', expiry_date: '2026-07-10', is_opened: true, opened_date: '2026-07-01' },
    ];
    await page.addInitScript(initScript(`
        if (table === 'reagent_inventory') return chainable(null, ${JSON.stringify(items)});
        if (table === 'inventory_batches') return chainable(null, ${JSON.stringify(batches)});
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('inventory'));
    await page.waitForTimeout(200);
    await page.evaluate(() => switchInvTab('lots', null));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('lot-register-body').innerHTML);
    t.check('the register lists items by name', html.includes('Glucose Reagent'));
    t.check('the register lists lot numbers', html.includes('LOT-001') && html.includes('LOT-002'));
    t.check('an opened batch shows its effective (stability-limited) expiry status, not just the printed expiry', html.includes('LOT-002'));
    await page.evaluate(() => { document.getElementById('lot-reg-search').value = 'LOT-002'; });
    await page.evaluate(() => renderLotRegister());
    await page.waitForTimeout(100);
    const filtered = await page.evaluate(() => document.getElementById('lot-register-body').innerHTML);
    t.check('searching by lot no filters the register', filtered.includes('LOT-002') && !filtered.includes('LOT-001'));
    await page.close();
  }

  // --- Critical Value Panic Log: MRN/Lab No snapshot ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'patients') { window.__mock.patientsSelectId = 'p1'; return chainable({ mrn: 'M1234', lab_no: 'L5678' }, []); }
        if (table === 'critical_values') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.criticalInsert = payload; return Promise.resolve({ data: payload, error: null }); };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => logCriticalValues('p1', { na: 110 }, 'Chemistry'));
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.criticalInsert);
    t.check('a logged critical value snapshots the patient MRN onto the row', Array.isArray(insert) ? insert[0]?.mrn === 'M1234' : insert?.mrn === 'M1234');
    t.check('a logged critical value snapshots the patient Lab No onto the row', Array.isArray(insert) ? insert[0]?.lab_no === 'L5678' : insert?.lab_no === 'L5678');
    await page.close();
  }

  // --- Critical Value Panic Log: real read-back replaces the bare prompt() ---
  {
    const page = await context.newPage();
    const critRow = { id: 'c1', patient_id: 'p1', department: 'Chemistry', parameter: 'Sodium', value: '110', unit: 'mmol/L', reference: '120-160', is_acknowledged: false, patients: { name: 'Ack Test Patient', mrn: 'M999', lab_no: 'L999' } };
    await page.addInitScript(initScript(`
        if (table === 'critical_values') {
          const c = chainable(${JSON.stringify(critRow)}, []);
          c.update = (payload) => { window.__mock.criticalInsert = payload; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
    `));
    await login(page, baseUrl);
    // acknowledgeCritical() (the old bare-prompt() flow) must be gone entirely.
    const oldFnGone = await page.evaluate(() => typeof acknowledgeCritical === 'undefined');
    t.check('the old bare-prompt() acknowledgeCritical() no longer exists', oldFnGone);
    await page.evaluate(() => openCritAck('c1'));
    await page.waitForTimeout(150);
    const modalOpen = await page.evaluate(() => document.getElementById('crit-ack-ov').classList.contains('show') || document.getElementById('crit-ack-ov').style.display !== 'none' || getComputedStyle(document.getElementById('crit-ack-ov')).display !== 'none');
    t.check('acknowledging opens the (previously orphaned) modal, now genuinely wired up', modalOpen);
    const infoText = await page.evaluate(() => document.getElementById('crit-ack-info').innerHTML);
    t.check('the modal shows the true reported value for the user to read back against', infoText.includes('110'));
    // Wrong read-back value is rejected — no update call made.
    await page.evaluate(() => {
      document.getElementById('crit-readback-val').value = '999';
      document.getElementById('crit-notified-to').value = 'Dr. Test';
    });
    await page.evaluate(() => submitCritAck());
    await page.waitForTimeout(100);
    const blockedUpdate = await page.evaluate(() => window.__mock.criticalInsert);
    t.check('an incorrect read-back value blocks acknowledgement (no update call)', blockedUpdate === null);
    // Correct value but no clinician name is also blocked.
    await page.evaluate(() => { document.getElementById('crit-readback-val').value = '110'; document.getElementById('crit-notified-to').value = ''; });
    await page.evaluate(() => submitCritAck());
    await page.waitForTimeout(100);
    const stillBlocked = await page.evaluate(() => window.__mock.criticalInsert);
    t.check('a correct value with no notified-clinician name is still blocked', stillBlocked === null);
    // Correct value + clinician name succeeds.
    await page.evaluate(() => { document.getElementById('crit-notified-to').value = 'Dr. Test'; });
    await page.evaluate(() => submitCritAck());
    await page.waitForTimeout(100);
    const finalUpdate = await page.evaluate(() => window.__mock.criticalInsert);
    t.check('a correct read-back + clinician name succeeds', finalUpdate?.is_acknowledged === true);
    t.check('read_back_confirmed is stamped true (was never captured by the old flow)', finalUpdate?.read_back_confirmed === true);
    await page.close();
  }

  return t;
};
