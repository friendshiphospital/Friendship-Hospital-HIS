// Covers Lab Safety Phase 1 for PCR: verification scoped to what was
// actually ordered this visit, matched by TARGET NAME (results_pcr.tests
// is a jsonb array of {target,result,ct_value}, not fixed columns) rather
// than column name. Also covers the related data-loss bug found during
// this audit: DEPT_LOAD_MAP.pcr had no afterLoad, so every previously
// entered target row silently vanished from the DOM on reload -- and a
// second Save on top of that blank table would wipe the DB's targets too.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(testsRequested, existingRow) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { upserts: [] };
    const testsRequested = ${JSON.stringify(testsRequested)};
    const existingRow = ${JSON.stringify(existingRow || null)};
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'lab_tech' }, []);
        if (table === 'patients') { const c = chainable({ tests_requested: testsRequested }, []); c.select = () => c; c.eq = () => c; return c; }
        if (table === 'results_pcr') {
          const c = chainable(existingRow, []);
          c.select = () => c; c.eq = () => c; c.order = () => c; c.limit = () => c;
          c.upsert = (payload) => { window.__mock.upserts.push(payload); return Promise.resolve({ data: [payload], error: null }); };
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
  await page.fill('#auth-email', 'labtech@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('lab-safety-verification-scoping-pcr');

  // --- COVID-19 PCR ordered, target row named + resulted to match -> verify succeeds ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['COVID-19 PCR']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('pcr-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => {
      document.getElementById('pcr-target-0').value = 'COVID-19 PCR';
      document.getElementById('pcr-result-0').value = 'Not Detected';
    });
    await page.evaluate(() => savePcrEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('a matching, resulted target verifies successfully', upsert?.is_verified === true);
    t.check('verified_fields records the target NAME, not a column name', upsert?.verified_fields?.includes('COVID-19 PCR'));
    await page.close();
  }

  // --- COVID-19 PCR ordered, but no target row names it -> verify blocked ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['COVID-19 PCR']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('pcr-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => {
      document.getElementById('pcr-target-0').value = 'Influenza A/B PCR'; // wrong target, doesn't match the order
      document.getElementById('pcr-result-0').value = 'Not Detected';
    });
    await page.evaluate(() => savePcrEntry(true));
    await page.waitForTimeout(200);
    const upserts = await page.evaluate(() => window.__mock.upserts.length);
    t.check('verify is blocked when no target row matches the ordered test name', upserts === 0);
    await page.close();
  }

  // --- COVID-19 PCR ordered, target row named right but no result entered -> verify blocked ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['COVID-19 PCR']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('pcr-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => { document.getElementById('pcr-target-0').value = 'COVID-19 PCR'; });
    await page.evaluate(() => savePcrEntry(true));
    await page.waitForTimeout(200);
    const upserts = await page.evaluate(() => window.__mock.upserts.length);
    t.check('verify is blocked when the matching target row has no result value', upserts === 0);
    await page.close();
  }

  // --- Data-loss fix: reloading a patient with 2 saved targets restores BOTH rows into the DOM ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['COVID-19 PCR', 'Influenza A/B PCR'], {
      patient_id: 'p1',
      tests: { targets: [
        { target: 'COVID-19 PCR', result: 'Not Detected', ct_value: null },
        { target: 'Influenza A/B PCR', result: 'Detected', ct_value: 22.5 }
      ] }
    }));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('pcr-entry'));
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.getElementById('pcr-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => loadExistingResults('pcr', 'p1'));
    await page.waitForTimeout(200);
    const rowCount = await page.evaluate(() => document.querySelectorAll('#pcr-targets-body tr').length);
    t.check('reload restores exactly 2 target rows (was always 1 blank row before this fix)', rowCount === 2);
    const restored = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#pcr-targets-body tr')].map(r => r.id.replace('pcr-row-', ''));
      return rows.map(i => ({
        target: document.getElementById('pcr-target-' + i)?.value,
        result: document.getElementById('pcr-result-' + i)?.value,
        ct: document.getElementById('pcr-ct-' + i)?.value,
      }));
    });
    t.check('the first restored row has the correct target/result', restored.some(r => r.target === 'COVID-19 PCR' && r.result === 'Not Detected'));
    t.check('the second restored row has the correct target/result/Ct', restored.some(r => r.target === 'Influenza A/B PCR' && r.result === 'Detected' && r.ct === '22.5'));
    // Now simulate a save right after reload -- previously this would have
    // wiped both targets from the DB since the DOM started out blank.
    await page.evaluate(() => savePcrEntry(false));
    await page.waitForTimeout(150);
    const upsert = await page.evaluate(() => window.__mock.upserts[window.__mock.upserts.length - 1]);
    t.check('a save immediately after reload still persists both restored targets (data-loss bug fixed)', upsert?.tests?.targets?.length === 2);
    await page.close();
  }

  return t;
};
