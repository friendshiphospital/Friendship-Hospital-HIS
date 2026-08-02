// Covers Phase 4 of the Bed Management (IPD) overhaul: the Dashboard's
// Active/ICU/Surgical/Available-Beds counters and the Bed Management
// (Admissions) page's own as-active/as-icu/as-surgical/as-beds counters
// used to run two independent admissions+beds queries — they could
// disagree if one page's data was fetched a moment apart from the
// other's. Both now read through one shared computeBedOccupancyStats()
// so the two screens can never drift apart.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

const ACTIVE_ADMISSIONS = [
  { id: 'a1', ward: 'ICU', status: 'Active' },
  { id: 'a2', ward: 'Surgical', status: 'Active' },
  { id: 'a3', ward: 'Medical', status: 'Active' },
];
const BEDS = [
  { status: 'Available', ward: 'Medical' },
  { status: 'Available', ward: 'ICU' },
  { status: 'Occupied', ward: 'ICU' },
  { status: 'Cleaning', ward: 'Surgical' },
];

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []);
        if (table === 'admissions') return chainable(null, ${JSON.stringify(ACTIVE_ADMISSIONS)});
        if (table === 'beds') return chainable(null, ${JSON.stringify(BEDS)});
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
  const t = makeSuite('bed-occupancy-stats');

  // --- TEST 1: computeBedOccupancyStats() itself returns the right numbers ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    const stats = await page.evaluate(() => computeBedOccupancyStats());
    t.check('3 active admissions counted', stats.active === 3);
    t.check('1 ICU active admission counted', stats.icu === 1);
    t.check('1 Surgical active admission counted', stats.surgical === 1);
    t.check('2 Available beds counted (out of 4 total)', stats.availableBeds === 2);
    await page.close();
  }

  // --- TEST 2: the Bed Management page's own counters reflect the shared computation ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => loadAdmissionStats());
    await page.waitForTimeout(150);
    const vals = await page.evaluate(() => ({
      active: document.getElementById('as-active').textContent,
      icu: document.getElementById('as-icu').textContent,
      surgical: document.getElementById('as-surgical').textContent,
      beds: document.getElementById('as-beds').textContent,
    }));
    t.check('as-active shows 3', vals.active === '3');
    t.check('as-icu shows 1', vals.icu === '1');
    t.check('as-surgical shows 1', vals.surgical === '1');
    t.check('as-beds shows 2', vals.beds === '2');
    await page.close();
  }

  // --- TEST 3: the Dashboard's counters, computed from the SAME mock data, match the Bed Management page's exactly ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => Promise.all([loadAdmissionStats(), loadDashboard()]));
    await page.waitForTimeout(200);
    const vals = await page.evaluate(() => ({
      asActive: document.getElementById('as-active').textContent,
      dsAdmissions: document.getElementById('ds-admissions').textContent,
      asBeds: document.getElementById('as-beds').textContent,
      dsBeds: document.getElementById('ds-beds').textContent,
      dsTheatre: document.getElementById('ds-theatre').textContent,
    }));
    t.check('Dashboard "Active Admissions" matches the Bed Management page\'s Active counter exactly', vals.dsAdmissions === vals.asActive && vals.dsAdmissions === '3');
    t.check('Dashboard "Available Beds" matches the Bed Management page\'s Avail. Beds counter exactly', vals.dsBeds === vals.asBeds && vals.dsBeds === '2');
    t.check('Dashboard "In Theatre" is 0 (no active admission is in a Theatre ward in this mock)', vals.dsTheatre === '0');
    await page.close();
  }

  return t;
};
