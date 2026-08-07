// Covers Lab Safety Phase 1 for Histopathology + Cytology: one narrative
// report per specimen, not a multi-analyte panel, so "complete" just means
// the diagnosis/findings field is filled -- not per-sub-field. Histo has a
// TEST_CATALOG entry; Cytology does not (a Phase 0 finding), so Cytology
// falls back to the same keyword-based department match
// departmentsMatchingTests() already uses for cyto elsewhere.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(table, testsRequested, existingRow) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { upserts: [] };
    const testsRequested = ${JSON.stringify(testsRequested)};
    const existingRow = ${JSON.stringify(existingRow || null)};
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (t) => {
        if (t === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'lab_tech' }, []);
        if (t === 'patients') { const c = chainable({ tests_requested: testsRequested }, []); c.select = () => c; c.eq = () => c; return c; }
        if (t === '${table}') {
          const c = chainable(existingRow, []);
          c.select = () => c; c.eq = () => c;
          c.upsert = (payload) => { window.__mock.upserts.push(payload); return Promise.resolve({ data: [payload], error: null }); };
          return c;
        }
        if (t === 'sample_records') return chainable(null, []);
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
  const t = makeSuite('lab-safety-verification-scoping-histo-cyto');

  // --- Histopathology: biopsy ordered, diagnosis filled -> verify succeeds ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('results_histopathology', ['Liver Biopsy']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('histo-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => { document.getElementById('hi-diagnosis').value = 'Chronic hepatitis, mild activity'; });
    await page.evaluate(() => saveHistoEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('Histo: a biopsy order with diagnosis filled verifies successfully', upsert?.is_verified === true);
    t.check('Histo: verified_fields records the diagnosis marker', upsert?.verified_fields?.includes('diagnosis'));
    await page.close();
  }

  // --- Histopathology: biopsy ordered, diagnosis left blank -> verify blocked ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('results_histopathology', ['Liver Biopsy']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('histo-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => saveHistoEntry(true));
    await page.waitForTimeout(200);
    const upserts = await page.evaluate(() => window.__mock.upserts.length);
    t.check('Histo: verify is blocked when diagnosis is empty', upserts === 0);
    await page.close();
  }

  // --- Histopathology: nothing on record as histo-ordered -> never blocks (e.g. walk-in) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('results_histopathology', []));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('histo-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => saveHistoEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('Histo: with no tests_requested on record, verify is never blocked', upsert?.is_verified === true);
    await page.close();
  }

  // --- Cytology: FNA ordered (keyword match, no TEST_CATALOG entry), diagnosis/findings filled -> verify succeeds ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('results_cytology', ['FNA Cytology']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('cyto-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => { document.getElementById('cy-findings').value = 'Benign follicular cells, no atypia'; });
    await page.evaluate(() => saveCytoEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('Cyto: an FNA order (matched via DEPT_META keyword, not TEST_CATALOG) with findings filled verifies successfully', upsert?.is_verified === true);
    await page.close();
  }

  // --- Cytology: FNA ordered, both diagnosis and findings left blank -> verify blocked ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('results_cytology', ['FNA Cytology']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('cyto-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => saveCytoEntry(true));
    await page.waitForTimeout(200);
    const upserts = await page.evaluate(() => window.__mock.upserts.length);
    t.check('Cyto: verify is blocked when both diagnosis and findings are empty', upserts === 0);
    await page.close();
  }

  return t;
};
