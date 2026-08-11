// Tier 1 quick win: hardware (keyboard-wedge) barcode scanners type the
// scanned code into whatever field has focus, then send Enter. Confirms
// the Receive in Lab search field (1) auto-focuses when the tab opens and
// (2) a trailing Enter now selects the matching patient without a mouse
// click — handleReceiveScanEnter(), wired in this session.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(patients, collectedIds) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech', role: 'lab_tech' }, []);
        if (table === 'patients') {
          const all = ${JSON.stringify(patients || [])};
          const c = chainable(all[0]||null, all);
          return c;
        }
        if (table === 'sample_records') {
          const ids = new Set(${JSON.stringify(collectedIds || [])});
          const c = chainable(null, ${JSON.stringify((collectedIds||[]).map(id=>({patient_id:id})))});
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
  await page.fill('#auth-email', 'lab@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('tier1-sample-receiving-scan');

  // --- TEST 1: switching to the Receive in Lab tab auto-focuses the search field ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([], []));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('samples'));
    await page.waitForTimeout(100);
    await page.evaluate(() => switchSampleTab('receive', document.getElementById('sc-tabbtn-receive')));
    await page.waitForTimeout(100);
    const isFocused = await page.evaluate(() => document.activeElement?.id === 'sc-recv-search');
    t.check('opening Receive in Lab auto-focuses the scan/search field — a hardware scanner can type into it immediately', isFocused);
    await page.close();
  }

  // --- TEST 2: scanning a code that resolves to exactly one collected sample selects it on Enter, no click needed ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(
      [{ id: 'p1', name: 'Jane Doe', mrn: 'MRN-100', lab_no: 'FH100', age: 30, age_unit: 'Years', sex: 'Female', payment_status: 'paid' }],
      ['p1']
    ));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('samples'));
    await page.waitForTimeout(100);
    await page.evaluate(() => switchSampleTab('receive', document.getElementById('sc-tabbtn-receive')));
    await page.fill('#sc-recv-search', 'MRN-100');
    await page.waitForTimeout(150);
    await page.locator('#sc-recv-search').press('Enter');
    await page.waitForTimeout(150);
    const selectedId = await page.evaluate(() => document.getElementById('sc-recv-pt-id').value);
    const bannerVisible = await page.evaluate(() => document.getElementById('sc-recv-banner').style.display === 'block');
    t.check('pressing Enter after a scan auto-selects the single matching patient', selectedId === 'p1');
    t.check('the patient banner is shown without any manual click', bannerVisible);
    await page.close();
  }

  // --- TEST 3: an exact MRN match among several results wins even if others also matched the substring ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(
      [
        { id: 'p2', name: 'Alaa Osman', mrn: 'MRN-200', lab_no: 'FH200', age: 40, age_unit: 'Years', sex: 'Male', payment_status: 'paid' },
        { id: 'p3', name: 'MRN-200-Junior', mrn: 'MRN-2001', lab_no: 'FH201', age: 10, age_unit: 'Years', sex: 'Male', payment_status: 'paid' },
      ],
      ['p2', 'p3']
    ));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('samples'));
    await page.waitForTimeout(100);
    await page.evaluate(() => switchSampleTab('receive', document.getElementById('sc-tabbtn-receive')));
    await page.fill('#sc-recv-search', 'MRN-200');
    await page.waitForTimeout(150);
    await page.locator('#sc-recv-search').press('Enter');
    await page.waitForTimeout(150);
    const selectedId = await page.evaluate(() => document.getElementById('sc-recv-pt-id').value);
    t.check('an exact MRN match is preferred over a same-substring near-match when multiple rows matched', selectedId === 'p2');
    await page.close();
  }

  // --- TEST 4: no match at all -> Enter does nothing (no crash, nothing selected) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([], []));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('samples'));
    await page.waitForTimeout(100);
    await page.evaluate(() => switchSampleTab('receive', document.getElementById('sc-tabbtn-receive')));
    await page.fill('#sc-recv-search', 'NOPE');
    await page.waitForTimeout(150);
    await page.locator('#sc-recv-search').press('Enter');
    await page.waitForTimeout(100);
    const selectedId = await page.evaluate(() => document.getElementById('sc-recv-pt-id').value);
    t.check('Enter with no match selects nothing and does not error', !selectedId);
    await page.close();
  }

  return t;
};
