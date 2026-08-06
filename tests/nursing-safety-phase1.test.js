// Covers Nursing Safety Extension Phase 1: SOFA score (manual entry, six
// organ systems, correct clinical cutoffs, CNS reusing the existing GCS
// card instead of a duplicate entry) and the Fluid Balance chart's
// configurable dangerous-net-positive threshold.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { riskInsert: null };
    window.__mockFluidRows = [];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Nurse Test', role:'nurse' }, []);
        if (table === 'vital_signs') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.riskInsert = payload; return { select: () => Promise.resolve({ data: [payload], error: null }) }; };
          c.select = () => c; c.eq = () => c; c.gte = () => c; c.lte = () => c;
          c.order = () => ({ then: (resolve) => resolve({ data: window.__mockFluidRows, error: null }) });
          return c;
        }
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
  const t = makeSuite('nursing-safety-phase1');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);
  await page.evaluate(() => goPage('nursing'));
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('vs-pt-id').value = 'p1'; });

  // --- SOFA: healthy values across all six systems -> total 0 ---
  {
    const total = await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('sofa-pf-ratio', 450); set('sofa-platelets', 250); set('sofa-bilirubin', 10);
      set('sofa-map', 80); document.getElementById('sofa-vasopressor').value = 'none';
      set('vs-gcs-e', 4); set('vs-gcs-v', 5); set('vs-gcs-m', 6);
      set('sofa-creatinine', 80);
      return calcSOFA();
    });
    t.check('all-normal values score SOFA total 0', total === 0);
  }

  // --- SOFA: respiratory failure requires BOTH low ratio AND respiratory support to reach 3/4 ---
  {
    const withoutSupport = await page.evaluate(() => {
      document.getElementById('sofa-pf-ratio').value = 90;
      document.getElementById('sofa-resp-support').checked = false;
      calcSOFA();
      return document.getElementById('sofa-pt-resp').textContent;
    });
    t.check('PaO2/FiO2 < 100 WITHOUT respiratory support caps at 2, not 4 (support is required for 3/4)', withoutSupport === '2');
    const withSupport = await page.evaluate(() => {
      document.getElementById('sofa-resp-support').checked = true;
      calcSOFA();
      return document.getElementById('sofa-pt-resp').textContent;
    });
    t.check('PaO2/FiO2 < 100 WITH respiratory support scores 4', withSupport === '4');
  }

  // --- SOFA: coagulation cutoffs ---
  {
    const pts = await page.evaluate(() => {
      document.getElementById('sofa-platelets').value = 45;
      calcSOFA();
      return document.getElementById('sofa-pt-coag').textContent;
    });
    t.check('Platelets 45 (<50) scores coagulation 3', pts === '3');
  }

  // --- SOFA: liver (bilirubin) cutoffs, SI units (µmol/L) matching the rest of the app ---
  {
    const pts = await page.evaluate(() => {
      document.getElementById('sofa-bilirubin').value = 250;
      calcSOFA();
      return document.getElementById('sofa-pt-liver').textContent;
    });
    t.check('Bilirubin 250 µmol/L (>204) scores liver 4', pts === '4');
  }

  // --- SOFA: cardiovascular takes the WORSE of MAP and vasopressor category ---
  {
    const pts = await page.evaluate(() => {
      document.getElementById('sofa-map').value = 85; // normal MAP alone would be 0
      document.getElementById('sofa-vasopressor').value = 'high'; // but on high-dose vasopressors
      calcSOFA();
      return document.getElementById('sofa-pt-cvs').textContent;
    });
    t.check('a normal MAP does not mask a high vasopressor requirement — cardiovascular scores 4', pts === '4');
  }

  // --- SOFA: CNS reuses the GCS card, not a separate entry ---
  {
    const result = await page.evaluate(() => {
      const set = (id, v) => { document.getElementById(id).value = v; };
      set('vs-gcs-e', 1); set('vs-gcs-v', 1); set('vs-gcs-m', 4); // GCS total 6
      calcGCS(); // simulates the nurse typing into the GCS card, not a SOFA-specific field
      return { cns: document.getElementById('sofa-pt-cns').textContent, display: document.getElementById('sofa-gcs-display').textContent };
    });
    t.check('SOFA CNS display reflects the GCS card total (6), no separate GCS re-entry', result.display.includes('6'));
    t.check('GCS 6-9 scores CNS 3', result.cns === '3');
  }

  // --- SOFA: renal takes the worse of creatinine and urine output ---
  {
    const pts = await page.evaluate(() => {
      document.getElementById('sofa-creatinine').value = 90; // normal creatinine alone would be 0
      document.getElementById('sofa-urine-24h').value = 150; // but oliguric (<200 mL/24h)
      calcSOFA();
      return document.getElementById('sofa-pt-renal').textContent;
    });
    t.check('oliguria is not masked by a normal creatinine — renal scores 4', pts === '4');
  }

  // --- saveRiskAssessment() persists the SOFA total alongside Braden/Morse ---
  {
    await page.evaluate(() => saveRiskAssessment());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.riskInsert);
    t.check('saveRiskAssessment() persists sofa_score on the vital_signs row', typeof insert?.sofa_score === 'number');
  }

  // --- Fluid Balance: configurable dangerous-net-positive threshold ---
  {
    const belowBadge = await page.evaluate(async () => {
      CFG.fluidNetPositiveThreshold = 2000;
      _fcPt = { id: 'p1', name: 'Fluid Test', mrn: 'M1' };
      window.__mockFluidRows = [
        { recorded_at: new Date().toISOString(), fluid_in_ml: 1500, urine_output_ml: 1000, net_balance: 500, recorded_by_name: 'RN' },
      ];
      await loadFluidChart();
      return document.getElementById('fc-net-positive-badge').innerHTML;
    });
    t.check('a net balance BELOW the configured threshold shows no danger badge', belowBadge === '');

    const aboveBadge = await page.evaluate(async () => {
      window.__mockFluidRows = [
        { recorded_at: new Date().toISOString(), fluid_in_ml: 4000, urine_output_ml: 500, net_balance: 3500, recorded_by_name: 'RN' },
      ];
      await loadFluidChart();
      return document.getElementById('fc-net-positive-badge').innerHTML;
    });
    t.check('a net balance ABOVE the configured threshold shows the danger badge', aboveBadge.includes('Net-Positive'));

    const raisedThresholdBadge = await page.evaluate(async () => {
      CFG.fluidNetPositiveThreshold = 5000; // raise the admin-configured threshold above the same 3500 net
      await loadFluidChart();
      return document.getElementById('fc-net-positive-badge').innerHTML;
    });
    t.check('raising the admin-configured threshold above the same net balance clears the badge (genuinely configurable, not hardcoded)', raisedThresholdBadge === '');
  }

  // --- Settings round-trip ---
  {
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.getElementById('cfg-fluid-net-threshold').value = '3000'; saveNursingSafetySettings(); });
    t.check('saveNursingSafetySettings persists the threshold', await page.evaluate(() => CFG.fluidNetPositiveThreshold) === 3000);
    await page.evaluate(() => loadSettings());
    const reloaded = await page.evaluate(() => document.getElementById('cfg-fluid-net-threshold').value);
    t.check('loadSettings() reflects the saved threshold back into the form', reloaded === '3000');
  }

  await page.close();
  return t;
};
