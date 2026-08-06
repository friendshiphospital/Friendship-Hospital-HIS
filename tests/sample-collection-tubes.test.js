// Covers Sample Collection issues: (1) the Specimen Type dropdown always
// silently defaulted to its first <option> ("EDTA Blood") regardless of
// what was actually ordered -- a tech who didn't manually override it
// recorded the wrong specimen type on every sample, which is what showed
// up later on the Receive tab. (2) the "Tests Ordered" card only updated
// when the newly-selected patient had tests -- selecting a patient with
// none left the PREVIOUS patient's tests displayed instead of clearing.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const patients = {
      pSst: { id:'pSst', name:'SST Patient', mrn:'M1', lab_no:'L1', age:30, age_unit:'y', sex:'M', payment_status:'paid', tests_requested:['LFT (Liver Function)'] },
      pMulti: { id:'pMulti', name:'Multi Tube Patient', mrn:'M2', lab_no:'L2', age:40, age_unit:'y', sex:'F', payment_status:'paid', tests_requested:['CBC (Full Blood Count)','LFT (Liver Function)','PT / INR'] },
      pNone: { id:'pNone', name:'No Tests Patient', mrn:'M3', lab_no:'L3', age:50, age_unit:'y', sex:'M', payment_status:'paid', tests_requested:[] },
    };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'lab_tech' }, []);
        if (table === 'patients') {
          const c = chainable(null, []);
          c.select = () => c;
          c.eq = (field, val) => ({ single: () => Promise.resolve({ data: patients[val], error: null }) });
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
  await page.fill('#auth-email', 'labtech@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
  await page.evaluate(() => goPage('samples'));
  await page.waitForTimeout(100);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('sample-collection-tubes');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  // --- A patient needing SST (not EDTA) auto-selects the correct specimen type ---
  await page.evaluate(() => selectScPt('pSst'));
  await page.waitForTimeout(150);
  const specimenValue = await page.evaluate(() => document.getElementById('sc-specimen')?.value);
  t.check('Specimen Type auto-selects "Plain Blood / SST" for a patient whose only test needs SST, not the default EDTA Blood', specimenValue === 'Plain Blood / SST');
  const tubesText = await page.evaluate(() => document.getElementById('sc-tubes-required')?.textContent || '');
  t.check('the Required Tubes card shows the matching test name', tubesText.includes('LFT (Liver Function)'));
  const testsOrderedText = await page.evaluate(() => document.getElementById('sc-tests-ordered')?.textContent || '');
  t.check('the Tests Ordered card shows the ordered test', testsOrderedText.includes('LFT (Liver Function)'));

  // --- A patient needing multiple tube types gets a warning, not a silently-wrong single selection ---
  await page.evaluate(() => selectScPt('pMulti'));
  await page.waitForTimeout(150);
  const multiTubesText = await page.evaluate(() => document.getElementById('sc-tubes-required')?.textContent || '');
  t.check('multiple distinct tube types are all listed (EDTA + SST + Citrate)', multiTubesText.includes('EDTA') && multiTubesText.includes('SST') && multiTubesText.includes('Citrate'));
  t.check('a warning explains the single Specimen Type field cannot capture all of them', multiTubesText.includes('different tube types required'));

  // --- Switching to a patient with NO tests clears the stale previous display ---
  await page.evaluate(() => selectScPt('pNone'));
  await page.waitForTimeout(150);
  const clearedTestsText = await page.evaluate(() => document.getElementById('sc-tests-ordered')?.textContent || '');
  t.check('the Tests Ordered card is cleared (not left showing the PREVIOUS patient\'s tests) for a patient with none', !clearedTestsText.includes('CBC') && !clearedTestsText.includes('LFT'));
  const clearedTubesText = await page.evaluate(() => document.getElementById('sc-tubes-required')?.textContent || '');
  t.check('the Required Tubes card correctly shows nothing required for this patient', clearedTubesText.includes('No tests with recognised tube requirements'));

  await page.close();
  return t;
};
