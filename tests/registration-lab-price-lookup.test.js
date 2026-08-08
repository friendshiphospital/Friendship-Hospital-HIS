// Covers a live-reported bug: the registration invoice preview/final
// invoice showed "—" for every lab test line (CBC, Haemoglobin Only,
// WBC Count, LFT, RFT...) and the total never included them. Root cause:
// the price_list seed data (seedDefaultPrices()) used descriptive names
// like "CBC — Complete Blood Count" while buildAutoInvoiceLines() looks
// up prices by an EXACT match against the names TEST_CATALOG actually
// produces ("CBC (Full Blood Count)") -- the two never matched, so every
// lab order silently priced at 0. Added a canonical LC001-LC098 block
// whose names mirror TEST_CATALOG exactly; this proves the lookup path
// itself resolves a real price once a matching row exists.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const labPrices = [
      { code:'LC001', name:'CBC (Full Blood Count)', price:3000, category:'lab' },
      { code:'LC002', name:'Haemoglobin Only', price:1000, category:'lab' },
      { code:'REG001', name:'Registration Fee', price:500, category:'registration' },
    ];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Reception Test', role:'receptionist' }, []);
        if (table === 'price_list') {
          const c = chainable(null, labPrices);
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
  const t = makeSuite('registration-lab-price-lookup');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  const lines = await page.evaluate(async () => {
    const result = await buildAutoInvoiceLines(['CBC (Full Blood Count)', 'Haemoglobin Only'], new Set());
    return result;
  });
  const cbcLine = lines.find(l => l.name === 'CBC (Full Blood Count)');
  const hgbLine = lines.find(l => l.name === 'Haemoglobin Only');
  t.check('CBC (Full Blood Count) resolves a real price (3000), not 0/"—"', cbcLine?.total_price === 3000);
  t.check('Haemoglobin Only resolves a real price (1000), not 0/"—"', hgbLine?.total_price === 1000);
  const total = lines.reduce((s, l) => s + (l.total_price || 0), 0);
  t.check('the invoice total actually includes the lab test prices, not just registration fee', total >= 3000 + 1000 + 500);

  // --- Every TEST_CATALOG name has a canonical price_list entry with a matching name ---
  const auditResult = await page.evaluate(() => {
    const allCatalogTests = Object.values(TEST_CATALOG).flat();
    // seedDefaultPrices() isn't run against a live table here (no admin
    // action in this test) -- instead confirm the SOURCE array itself
    // covers every catalog test by re-deriving it the same way the app
    // does: pull the function's source and count LC-coded entries whose
    // name matches a catalog test.
    const src = seedDefaultPrices.toString();
    const missing = allCatalogTests.filter(name => {
      const escapedName = JSON.stringify(name).slice(1, -1).replace(/'/g, "\\'");
      return !src.includes("name:'" + escapedName + "'");
    });
    return { total: allCatalogTests.length, missing };
  });
  t.check('every TEST_CATALOG test name has a canonical (exact-match) entry in the price seed source', auditResult.missing.length === 0);

  await page.close();
  return t;
};
