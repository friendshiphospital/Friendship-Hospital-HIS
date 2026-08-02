// Covers Phase 1 of the Bed Management (IPD) overhaul: splitting the
// combined "Admissions" launcher tile (pages:['admission','theatre']) into
// two separate top-level tiles — "Bed Management (IPD)" (admission) and
// "Theatre / OT" (theatre) — via MODULE_PAGES/MODULE_ORDER only, with no
// ROLE_PAGES change, since visibleModulesForRole()/firstAccessiblePageInModule()
// already compute tile visibility generically from ROLE_PAGES.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(role) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: ${JSON.stringify(role)} }, []);
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
  await page.fill('#auth-email', 'doc@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('bed-management-tiles');

  // --- TEST 1: MODULE_PAGES now has separate 'admissions' and 'theatre' module keys ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('doctor'));
    await login(page, baseUrl);
    const mods = await page.evaluate(() => ({
      admissions: MODULE_PAGES.admissions,
      theatre: MODULE_PAGES.theatre,
    }));
    t.check('MODULE_PAGES.admissions is now Bed Management (IPD), pages=[admission] only', mods.admissions?.label === 'Bed Management (IPD)' && JSON.stringify(mods.admissions?.pages) === JSON.stringify(['admission']));
    t.check('MODULE_PAGES.theatre is a new standalone module for the theatre page', mods.theatre?.label === 'Theatre / OT' && JSON.stringify(mods.theatre?.pages) === JSON.stringify(['theatre']));
    await page.close();
  }

  // --- TEST 2: a role with both 'admission' and 'theatre' page access (doctor) sees TWO separate launcher tiles ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('doctor'));
    await login(page, baseUrl);
    const visible = await page.evaluate(() => visibleModulesForRole());
    t.check('doctor role sees both the admissions and theatre module keys as separate entries', visible.includes('admissions') && visible.includes('theatre'));
    await page.evaluate(() => { document.getElementById('sidebar').style.display='none'; document.getElementById('main').style.display='none'; document.getElementById('launcher-screen')?.classList.add('show'); renderLauncher(); });
    const tileLabels = await page.evaluate(() => Array.from(document.querySelectorAll('#launcher-grid .lt-lbl')).map(e => e.textContent));
    t.check('the launcher grid renders a "Bed Management (IPD)" tile', tileLabels.includes('Bed Management (IPD)'));
    t.check('the launcher grid renders a separate "Theatre / OT" tile', tileLabels.includes('Theatre / OT'));
    await page.close();
  }

  // --- TEST 3: entering the 'admissions' tile still lands on the 'admission' page (unchanged behavior) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('doctor'));
    await login(page, baseUrl);
    await page.evaluate(() => enterModule('admissions'));
    await page.waitForTimeout(100);
    const activePage = await page.evaluate(() => document.querySelector('.page.active')?.id);
    t.check('entering the admissions module still opens the admission page', activePage === 'page-admission');
    await page.close();
  }

  // --- TEST 4: entering the new 'theatre' tile lands on the 'theatre' page ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('doctor'));
    await login(page, baseUrl);
    await page.evaluate(() => enterModule('theatre'));
    await page.waitForTimeout(100);
    const activePage = await page.evaluate(() => document.querySelector('.page.active')?.id);
    t.check('entering the new theatre module opens the theatre page', activePage === 'page-theatre');
    await page.close();
  }

  // --- TEST 5: a role with only theatre access (theatre_nurse) sees the theatre tile but not the bed-management tile ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('theatre_nurse'));
    await login(page, baseUrl);
    const visible = await page.evaluate(() => visibleModulesForRole());
    t.check('theatre_nurse (no admission page grant) does not see the admissions tile', !visible.includes('admissions'));
    t.check('theatre_nurse still sees the theatre tile', visible.includes('theatre'));
    await page.close();
  }

  return t;
};
