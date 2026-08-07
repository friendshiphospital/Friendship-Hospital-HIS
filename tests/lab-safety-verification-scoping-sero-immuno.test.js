// Covers Lab Safety Phase 1 for Serology + Immunology, which share ONE
// results_serology row per patient_id (Immunology is folded into "Serology"
// scope since it's the same table/row). The row-level is_verified flag must
// reflect BOTH departments' currently-ordered tests together -- verifying
// from the Serology page must not silently flip is_verified=true while an
// ordered Immunology test (or vice versa) still has no value, and must not
// require an unordered department's fields either.
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
        if (table === 'results_serology') {
          const c = chainable(existingRow, []);
          c.select = () => c; c.eq = () => c;
          c.upsert = (payload) => {
            window.__mock.upserts.push(payload);
            // simulate the DB merging this partial payload into the row, so a
            // second save-in-sequence within the same test sees prior columns
            Object.assign(existingRow || (existingRow = {}), payload);
            c._single = existingRow;
            return Promise.resolve({ data: [payload], error: null });
          };
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
  const t = makeSuite('lab-safety-verification-scoping-sero-immuno');

  // --- Serology only ordered, all Sero fields filled -> verify succeeds, no Immuno fields required ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['HIV Ag/Ab']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('sero-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => { document.getElementById('se-hiv').value = 'Non-Reactive'; });
    await page.evaluate(() => saveSeroEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('Serology-only order verifies successfully without any Immunology fields', upsert?.is_verified === true);
    t.check('verified_fields includes hiv', upsert?.verified_fields?.includes('hiv'));
    await page.close();
  }

  // --- Both Sero + Immuno ordered, only Sero filled -> verify from Sero page is BLOCKED ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['HIV Ag/Ab', '🔹 Thyroid Profile (TSH+FT3+FT4)']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('sero-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => { document.getElementById('se-hiv').value = 'Non-Reactive'; });
    await page.evaluate(() => saveSeroEntry(true));
    await page.waitForTimeout(200);
    const upserts = await page.evaluate(() => window.__mock.upserts.length);
    t.check('verifying Sero is blocked (no save at all) while an ordered Immuno test (TSH/FT3/FT4) is still empty on the shared row', upserts === 0);
    await page.close();
  }

  // --- Both Sero + Immuno ordered, Sero already saved+filled on the row, now Immuno fills its part and verifies -> row becomes verified ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(
      ['HIV Ag/Ab', '🔹 Thyroid Profile (TSH+FT3+FT4)'],
      { patient_id: 'p1', hiv: 'Non-Reactive', verified_fields: [] }
    ));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('immuno-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => {
      document.getElementById('se-tsh').value = '2.1';
      document.getElementById('se-ft3').value = '5.0';
      document.getElementById('se-ft4').value = '15';
    });
    await page.evaluate(() => saveImmunoEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('verifying Immuno succeeds once merged with the already-saved Sero columns on the shared row', upsert?.is_verified === true);
    t.check('verified_fields includes both the Immuno columns just verified and the pre-existing hiv column', upsert?.verified_fields?.includes('tsh') && upsert?.verified_fields?.includes('hiv'));
    await page.close();
  }

  // --- Plain Save (no verify) always resets is_verified to false, same as Hem/Chem ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['HIV Ag/Ab']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('sero-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => { document.getElementById('se-hiv').value = 'Non-Reactive'; });
    await page.evaluate(() => saveSeroEntry(false));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('a plain Save (verify=false) is never marked verified', upsert?.is_verified === false);
    t.check('a plain Save does not touch verified_fields at all', !('verified_fields' in (upsert || {})));
    await page.close();
  }

  return t;
};
