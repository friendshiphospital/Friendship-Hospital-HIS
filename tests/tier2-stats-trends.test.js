// Tier 2: extended analytics beyond the existing Statistics dashboard —
// a new "Trends" tab (renderStatsTrends()) showing month-over-month
// patient volume/revenue, department workload over time, and a top-tests
// breakdown, built on top of the existing Statistics module. Unlike every
// other tab it always looks at a fixed trailing 6-month window rather
// than the page's from/to date filter.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function isoInMonthsAgo(n, day) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(day || 10);
  return d.toISOString();
}

function initScript(patients, invoices, sectionData) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []);
        if (table === 'patients') return chainable(null, ${JSON.stringify(patients || [])});
        if (table === 'invoices') return chainable(null, ${JSON.stringify(invoices || [])});
        if (table === 'results_hematology') return chainable(null, ${JSON.stringify((sectionData && sectionData.Haematology) || [])});
        if (table === 'results_chemistry') return chainable(null, ${JSON.stringify((sectionData && sectionData.Chemistry) || [])});
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
  await page.fill('#auth-email', 'admin@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('tier2-stats-trends');

  // --- TEST 1: Trends tab renders canvases + top tests, and populates the export payload ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(
      [
        { created_at: isoInMonthsAgo(0), tests_requested: ['CBC (Full Blood Count)', 'Fasting Glucose'] },
        { created_at: isoInMonthsAgo(0), tests_requested: ['CBC (Full Blood Count)'] },
        { created_at: isoInMonthsAgo(1), tests_requested: ['Fasting Glucose'] },
      ],
      [
        { created_at: isoInMonthsAgo(0), net_amount: 500 },
        { created_at: isoInMonthsAgo(1), net_amount: 300 },
      ],
      { Haematology: [{ created_at: isoInMonthsAgo(0) }], Chemistry: [{ created_at: isoInMonthsAgo(1) }] }
    ));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('statistics'));
    await page.waitForTimeout(150);
    await page.evaluate(() => setStatsTab('trends', null));
    await page.waitForTimeout(200);
    const hasCanvases = await page.evaluate(() => !!document.getElementById('stats-trend-canvas') && !!document.getElementById('stats-dept-canvas'));
    t.check('the Trends tab renders both the volume/revenue and department-workload canvases', hasCanvases);
    const html = await page.evaluate(() => document.getElementById('stats-body').innerHTML);
    t.check('the most-requested test appears in the Top Tests Ordered breakdown', html.includes('CBC (Full Blood Count)'));
    const exportPayload = await page.evaluate(() => _statsExport);
    t.check('the export payload is populated for the Trends tab', exportPayload.title === 'Trends' && exportPayload.rows.length === 6);
    t.check('the export includes a Patients and Revenue column', exportPayload.headers.includes('Patients') && exportPayload.headers.includes('Revenue'));
    await page.close();
  }

  // --- TEST 2: no data at all in the window -> renders without crashing, empty top-tests state ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([], [], {}));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('statistics'));
    await page.waitForTimeout(150);
    await page.evaluate(() => setStatsTab('trends', null));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('stats-body').innerHTML);
    t.check('an empty window shows the no-tests empty state rather than crashing', html.includes('No tests recorded in this window'));
    await page.close();
  }

  return t;
};
