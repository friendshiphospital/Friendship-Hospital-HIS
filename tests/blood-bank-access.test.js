// Covers Blood Bank Phase 6: access control. ROLE_PAGES now grants
// 'bloodbank' to admin, doctor, nurse, lab_tech, lab_supervisor —
// receptionist/cashier/theatre_nurse/radiologist deliberately do not get
// it (none of their responsibilities touch blood products). This checks
// both halves of the generic tile-visibility rule (visibleModulesForRole()
// deciding whether the launcher tile shows, and goPage('bloodbank')
// actually enforcing the same grant) stay in agreement for each role, per
// the existing pattern used by firstAccessiblePageInModule().
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
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Role Test', role: '${role}' }, []);
        if (table === 'blood_units') return chainable(null, []);
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
  await page.fill('#auth-email', 'test@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('blood-bank-access');

  const GRANTED = ['doctor', 'nurse', 'lab_tech', 'lab_supervisor'];
  const NOT_GRANTED = ['receptionist', 'cashier', 'theatre_nurse', 'radiologist'];

  for (const role of GRANTED) {
    const page = await context.newPage();
    await page.addInitScript(initScript(role));
    await login(page, baseUrl);
    const visible = await page.evaluate(() => visibleModulesForRole());
    t.check(`${role} sees the Blood Bank tile`, visible.includes('bloodbank'));
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    const active = await page.evaluate(() => document.getElementById('page-bloodbank')?.classList.contains('active'));
    t.check(`${role} can actually enter goPage('bloodbank')`, active);
    await page.close();
  }

  for (const role of NOT_GRANTED) {
    const page = await context.newPage();
    await page.addInitScript(initScript(role));
    await login(page, baseUrl);
    const visible = await page.evaluate(() => visibleModulesForRole());
    t.check(`${role} does NOT see the Blood Bank tile`, !visible.includes('bloodbank'));
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    const active = await page.evaluate(() => document.getElementById('page-bloodbank')?.classList.contains('active'));
    t.check(`${role} is blocked from entering goPage('bloodbank')`, !active);
    await page.close();
  }

  // admin bypasses ROLE_PAGES entirely, same as every other module
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('admin'));
    await login(page, baseUrl);
    const visible = await page.evaluate(() => visibleModulesForRole());
    t.check('admin sees the Blood Bank tile', visible.includes('bloodbank'));
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    const active = await page.evaluate(() => document.getElementById('page-bloodbank')?.classList.contains('active'));
    t.check('admin can enter goPage(\'bloodbank\')', active);
    await page.close();
  }

  return t;
};
