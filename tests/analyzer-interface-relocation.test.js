// Covers Prompt1 Phase 2: Analyzer Interface moved from the Administration
// sidebar group to the Laboratory sidebar group (same page/data/access —
// admin-only, per ROLE_PAGES, unchanged — purely a navigation relocation).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []);
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
  const t = makeSuite('analyzer-interface-relocation');

  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);

    const inLaboratoryGroup = await page.evaluate(() => {
      const item = document.querySelector('[data-p="analyzer"]');
      const group = item?.closest('.sb-group');
      return group?.getAttribute('data-module') === 'laboratory';
    });
    t.check('Analyzer Interface sidebar item now lives inside the Laboratory group', inLaboratoryGroup);

    const inAdminGroup = await page.evaluate(() => {
      const adminGroup = document.querySelector('.sb-group[data-module="administration"]');
      return !!adminGroup?.querySelector('[data-p="analyzer"]');
    });
    t.check('Analyzer Interface no longer appears in the Administration group', !inAdminGroup);

    const onlyOneSidebarItem = await page.evaluate(() => document.querySelectorAll('[data-p="analyzer"]').length);
    t.check('exactly one Analyzer Interface sidebar entry exists (moved, not duplicated)', onlyOneSidebarItem === 1);

    await page.evaluate(() => goPage('analyzer'));
    await page.waitForTimeout(100);
    const pageActive = await page.evaluate(() => document.getElementById('page-analyzer')?.classList.contains('active'));
    t.check('navigating to the Analyzer Interface page still works (same page/data, unchanged)', pageActive);

    await page.close();
  }

  return t;
};
