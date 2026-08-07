// Covers Lab Safety Phase 1 for Microbiology: verification scoped to what
// was actually ordered this visit, checked per ordered PANEL (e.g.
// "Urinalysis (UA)") rather than per individual sub-field, since many
// UA/stool/CSF sub-results are legitimately method-dependent and optional —
// unlike a Hem/Chem analyzer panel that always reports every parameter
// together. Complete = at least one field in each ordered panel has a value.
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
        if (table === 'results_microbiology') {
          const c = chainable(existingRow, []);
          c.select = () => c; c.eq = () => c;
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
  const t = makeSuite('lab-safety-verification-scoping-micro');

  // --- UA ordered, at least one UA field filled -> verify succeeds (loose per-panel check) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['Urinalysis (UA)']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('micro-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => { document.getElementById('mi-ua-color').value = 'Yellow'; });
    await page.evaluate(() => saveMicroEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('UA ordered with one field filled verifies successfully (loose per-panel completeness)', upsert?.is_verified === true);
    t.check('verified_fields includes the filled UA column', upsert?.verified_fields?.includes('ua_color'));
    await page.close();
  }

  // --- UA ordered, NO UA fields filled at all -> verify blocked ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['Urinalysis (UA)']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('micro-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => saveMicroEntry(true));
    await page.waitForTimeout(200);
    const upserts = await page.evaluate(() => window.__mock.upserts.length);
    t.check('verify is blocked when an ordered panel (UA) has zero fields filled', upserts === 0);
    await page.close();
  }

  // --- UA ordered and filled, Urine Culture also ordered but empty -> verify blocked (both panels required) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['Urinalysis (UA)', 'Urine Culture & Sensitivity']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('micro-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => { document.getElementById('mi-ua-color').value = 'Yellow'; });
    await page.evaluate(() => saveMicroEntry(true));
    await page.waitForTimeout(200);
    const upserts = await page.evaluate(() => window.__mock.upserts.length);
    t.check('verify is blocked when a second ordered panel (Urine Culture) is entirely empty, even though UA is filled', upserts === 0);
    await page.close();
  }

  // --- Stale CSF value present but not ordered this visit -> never required, never added to verified_fields ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['Urinalysis (UA)'], { verified_fields: [] }));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('micro-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => {
      document.getElementById('mi-ua-color').value = 'Yellow';
      document.getElementById('mi-csf-appear').value = 'Clear'; // stale from an earlier, unrelated order
    });
    await page.evaluate(() => saveMicroEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('verifying UA succeeds even with an unordered stale CSF value present', upsert?.is_verified === true);
    t.check('the stale, unordered CSF field is NOT added to verified_fields', !upsert?.verified_fields?.includes('csf_appear'));
    await page.close();
  }

  return t;
};
