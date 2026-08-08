// Covers a live-reported gap in "recheck all pricing in all departments":
// buildAutoInvoiceLines() looked up real prices from price_list for lab
// tests and radiology studies, but Consultation Fee, Admission Fee, and
// Registration Fee were hardcoded flat numbers (500 / 1000 / 50) that never
// consulted price_list at all -- so editing them on the Price List page had
// zero effect on what registration actually charged. All three flat fees
// are now resolved through the shared code-based resolvePricedLines()
// lookup, same as lab/radiology. A missing price_list row is never papered
// over with a fabricated fallback number -- the line comes back
// priced:false/total_price:0 and buildRegInvoicePreview() surfaces it as a
// blocking "Price not set" warning instead.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(priceRows) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const flatPrices = ${JSON.stringify(priceRows)};
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Reception Test', role:'receptionist' }, []);
        if (table === 'price_list') {
          const c = chainable(null, flatPrices);
          c.select = () => c;
          c.in = () => c;
          c.eq = () => c;
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
  await page.fill('#auth-email', 'reception@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('registration-flat-fee-price-lookup');

  // --- price_list has custom (admin-edited) rows for all three flat fees ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([
      { code: 'CON000', name: 'Consultation Fee', price: 2200 },
      { code: 'ADM008', name: 'Admission Fee (one-time)', price: 3300 },
      { code: 'REG001', name: 'Registration Fee', price: 500 },
    ]));
    await login(page, baseUrl);
    const lines = await page.evaluate(async () => buildAutoInvoiceLines([], new Set(['doctor', 'admission'])));
    const consult = lines.find(l => l.name === 'Consultation Fee');
    const admission = lines.find(l => l.category === 'admission');
    const registration = lines.find(l => l.name === 'Registration Fee');
    t.check('Consultation Fee uses the price_list value (2200), not the hardcoded 500', consult?.total_price === 2200);
    t.check('Admission fee line uses the price_list value (3300), not the hardcoded 1000', admission?.total_price === 3300);
    t.check('Registration Fee uses the price_list value (500), not the hardcoded 50', registration?.total_price === 500);
    t.check('all three flat fees are marked priced:true', consult?.priced === true && admission?.priced === true && registration?.priced === true);
    await page.close();
  }

  // --- price_list has no matching rows -- must NEVER fabricate a fallback price, must flag as unpriced instead ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([]));
    await login(page, baseUrl);
    const lines = await page.evaluate(async () => buildAutoInvoiceLines([], new Set(['doctor', 'admission'])));
    const consult = lines.find(l => l.name === 'Consultation Fee');
    const admission = lines.find(l => l.category === 'admission');
    const registration = lines.find(l => l.name === 'Registration Fee');
    t.check('no price_list row -> Consultation Fee is flagged priced:false, not a fabricated fallback number', consult?.priced === false);
    t.check('no price_list row -> Admission fee is flagged priced:false, not a fabricated fallback number', admission?.priced === false);
    t.check('no price_list row -> Registration Fee is flagged priced:false, not a fabricated fallback number', registration?.priced === false);
    t.check('unpriced flat fees never carry a nonzero total_price', consult?.total_price === 0 && admission?.total_price === 0 && registration?.total_price === 0);
    await page.close();
  }

  // --- the new generic "Consultation Fee" seed entry exists so admins have something to edit ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([]));
    await login(page, baseUrl);
    const hasSeed = await page.evaluate(() => seedDefaultPrices.toString().includes("name:'Consultation Fee'"));
    t.check('seedDefaultPrices() ships a generic "Consultation Fee" entry (previously only specialty-specific ones existed)', hasSeed);
    await page.close();
  }

  return t;
};
