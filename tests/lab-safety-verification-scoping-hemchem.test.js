// Covers Lab Safety Phase 1 for Haematology + Chemistry (shared
// saveResultWithSafetyChecks pipeline): verification must be scoped to
// what was actually ordered THIS visit, never a blanket whole-row flag.
// Root cause (Phase 0 audit): a single row-level is_verified boolean
// covered every column, including ones holding a stale value from an
// earlier order in the same visit (results_* is one row per patient_id,
// and loadExistingResults() pre-fills the form from whatever's already
// there). Fixed via a new verified_fields column, only ever appended to
// for columns belonging to a currently-ordered test, plus a hard block on
// Verify if any currently-ordered test still has no value.
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
        if (table === 'results_hematology' || table === 'results_chemistry') {
          const c = chainable(existingRow, []);
          c.select = () => c; c.eq = () => c;
          c.upsert = (payload) => { window.__mock.upserts.push(payload); return Promise.resolve({ data: [payload], error: null }); };
          return c;
        }
        if (table === 'delta_check_log' || table === 'critical_values' || table === 'results_hematology_history' || table === 'results_chemistry_history' || table === 'sample_records') return chainable(null, []);
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
  const t = makeSuite('lab-safety-verification-scoping-hemchem');

  // --- Haematology: CBC ordered, all CBC fields filled -> verify succeeds ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['CBC (Full Blood Count)']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      ['he-wbc','he-rbc','he-hgb','he-hct','he-mcv','he-mch','he-mchc','he-rdw','he-nrbc','he-plt','he-mpv','he-pdw','he-neut','he-lymph','he-mono','he-eosi','he-baso'].forEach(id => set(id, '5'));
    });
    await page.evaluate(() => saveHemEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('a fully-filled CBC verifies successfully', upsert?.is_verified === true);
    t.check('verified_fields includes the CBC columns actually ordered (e.g. wbc, hgb)', upsert?.verified_fields?.includes('wbc') && upsert?.verified_fields?.includes('hgb'));
    await page.close();
  }

  // --- Haematology: CBC ordered, HGB missing -> verify blocked, nothing saved ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['CBC (Full Blood Count)']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      ['he-wbc','he-rbc','he-hct','he-mcv','he-mch','he-mchc','he-rdw','he-nrbc','he-plt','he-mpv','he-pdw','he-neut','he-lymph','he-mono','he-eosi','he-baso'].forEach(id => set(id, '5'));
      // he-hgb deliberately left empty
    });
    await page.evaluate(() => saveHemEntry(true));
    await page.waitForTimeout(200);
    const upserts = await page.evaluate(() => window.__mock.upserts.length);
    t.check('verify is blocked (no save at all) when an ordered CBC parameter (HGB) is missing', upserts === 0);
    await page.close();
  }

  // --- Haematology: verifying a NEW order must not silently re-verify a STALE, unordered field ---
  // Simulates the exact reported scenario: an earlier order's ESR value is still
  // sitting in the row (pre-filled by loadExistingResults()), but THIS visit only
  // ordered a repeat CBC -- verifying the CBC must never mark the stale ESR as
  // freshly verified, and must not require it to have a value either.
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['CBC (Full Blood Count)'], { verified_fields: [] }));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      ['he-wbc','he-rbc','he-hgb','he-hct','he-mcv','he-mch','he-mchc','he-rdw','he-nrbc','he-plt','he-mpv','he-pdw','he-neut','he-lymph','he-mono','he-eosi','he-baso'].forEach(id => set(id, '5'));
      set('he-esr', '40'); // stale value from an earlier, already-reviewed order, still sitting in the form
    });
    await page.evaluate(() => saveHemEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('verifying this visit\'s CBC succeeds even though an unrelated ESR value is also present', upsert?.is_verified === true);
    t.check('the stale, unordered ESR field is NOT added to verified_fields', !upsert?.verified_fields?.includes('esr'));
    await page.close();
  }

  // --- Chemistry: same completeness gate, RFT panel ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['RFT (Renal Function)']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('chem-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => {
      document.getElementById('ce-creat').value = '80';
      document.getElementById('ce-urea').value = '5';
      // ce-egfr (also part of RFT) deliberately left empty
    });
    await page.evaluate(() => saveChemEntry(true));
    await page.waitForTimeout(200);
    const upserts = await page.evaluate(() => window.__mock.upserts.length);
    t.check('Chemistry: verify is blocked when an ordered RFT parameter (eGFR) is missing', upserts === 0);
    await page.close();
  }
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(['RFT (Renal Function)']));
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('chem-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => {
      document.getElementById('ce-creat').value = '80';
      document.getElementById('ce-urea').value = '5';
      document.getElementById('ce-ua').value = '0.3';
      document.getElementById('ce-egfr').value = '95';
    });
    await page.evaluate(() => saveChemEntry(true));
    await page.waitForTimeout(200);
    const upsert = await page.evaluate(() => window.__mock.upserts[0]);
    t.check('Chemistry: a fully-filled RFT verifies successfully', upsert?.is_verified === true);
    t.check('Chemistry: verified_fields covers exactly the RFT columns (creat, urea, ua, egfr)', ['creat','urea','ua','egfr'].every(c=>upsert?.verified_fields?.includes(c)));
    t.check('Chemistry: an unordered field (e.g. LFT\'s tbil) is never required or added', !upsert?.verified_fields?.includes('tbil'));
    await page.close();
  }

  return t;
};
