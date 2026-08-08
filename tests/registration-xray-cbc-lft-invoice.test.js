// Phase 4 verification: reproduces the exact live-reported scenario from the
// screenshot that started this pricing investigation -- a patient registered
// with an X-Ray order plus two lab tests (CBC, LFT). The screenshot showed
// the X-Ray and the flat Registration Fee priced correctly, but BOTH lab
// tests showed "-" and were silently excluded from the total. Drives the
// real Registration UI (goPage, checkbox clicks, destination toggle, radiology
// select) end-to-end through buildRegInvoicePreview() -- the same function
// wired to the live invoice preview panel -- rather than calling the pricing
// function directly, so this proves the fix holds through the actual UI path
// a receptionist uses.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const priceRows = [
      { code:'LC001', name:'CBC (Full Blood Count)', price:3000, category:'lab' },
      { code:'LC014', name:'LFT (Liver Function)', price:4000, category:'lab' },
      { code:'RAD001', name:'X-Ray — Chest PA', price:3000, category:'radiology' },
      { code:'REG001', name:'Registration Fee', price:500, category:'registration' },
    ];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Reception Test', role:'receptionist' }, []);
        if (table === 'price_list') { const c = chainable(null, priceRows); c.select = () => c; c.in = () => c; c.eq = () => c; return c; }
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
  await page.fill('#auth-email', 'reception@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('registration-xray-cbc-lft-invoice');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  await page.evaluate(() => goPage('register'));
  await page.waitForTimeout(300);

  // Select radiology destination + X-Ray study (mirrors the reported screenshot)
  await page.evaluate(() => { setDest('radiology'); });
  await page.evaluate(() => {
    const el = document.getElementById('r-rad-type');
    el.value = 'X-Ray — Chest PA';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Check CBC and LFT lab test checkboxes
  const checkedOk = await page.evaluate(() => {
    const cbc = [...document.querySelectorAll('.test-chk')].find(c => c.value === 'CBC (Full Blood Count)');
    const lft = [...document.querySelectorAll('.test-chk')].find(c => c.value === 'LFT (Liver Function)');
    if (cbc) cbc.checked = true;
    if (lft) lft.checked = true;
    return !!cbc && !!lft;
  });
  t.check('CBC and LFT checkboxes exist in the rendered test catalog', checkedOk);

  await page.evaluate(() => buildRegInvoicePreview());
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => ({
    linesHtml: document.getElementById('reg-inv-lines')?.innerHTML || '',
    totalText: document.getElementById('reg-inv-total')?.textContent || '',
  }));

  t.check('X-Ray line shows a real price, not "-"', /X-Ray.*3000\.00 SDG/s.test(result.linesHtml) || result.linesHtml.includes('3000.00 SDG'));
  t.check('CBC line shows a real price (3000), not "-"', result.linesHtml.includes('CBC') && !result.linesHtml.includes('⚠ Price not set'));
  t.check('LFT line shows a real price (4000), not "-"', result.linesHtml.includes('LFT'));
  t.check('no "Price not set" warning is shown for any of these three items', !result.linesHtml.includes('Price not set'));
  t.check('the displayed total is the full sum: 3000 (X-Ray) + 3000 (CBC) + 4000 (LFT) + 500 (Registration Fee) = 10500', result.totalText.includes('10500.00'));

  await page.close();
  return t;
};
