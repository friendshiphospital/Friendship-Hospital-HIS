// Tier 2: mobile-friendly layout pass. Most USB desktop screens never hit
// the new @media(max-width:768px) breakpoint, so this exercises the piece
// that's actually testable headlessly: the off-canvas sidebar JS contract
// (toggleMobileSidebar()/closeMobileSidebar(), and goPage()/goHome() both
// closing it on navigation) rather than the CSS breakpoint itself, which
// Playwright's default viewport won't trigger.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => { if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Doctor Test', role: 'doctor' }, []); return chainable(null, []); },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'doctor@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('tier2-mobile-sidebar');

  // --- TEST 1: the hamburger button and backdrop exist and toggleMobileSidebar() adds/removes mb-open on both ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    const btnExists = await page.evaluate(() => !!document.getElementById('mb-menu-btn'));
    const backdropExists = await page.evaluate(() => !!document.getElementById('mb-sidebar-backdrop'));
    t.check('the mobile menu button exists in the topbar', btnExists);
    t.check('the mobile sidebar backdrop element exists', backdropExists);
    await page.evaluate(() => toggleMobileSidebar());
    const openedBoth = await page.evaluate(() => document.getElementById('sidebar').classList.contains('mb-open') && document.getElementById('mb-sidebar-backdrop').classList.contains('mb-open'));
    t.check('toggling opens mb-open on both the sidebar and its backdrop', openedBoth);
    await page.evaluate(() => toggleMobileSidebar());
    const closedBoth = await page.evaluate(() => !document.getElementById('sidebar').classList.contains('mb-open') && !document.getElementById('mb-sidebar-backdrop').classList.contains('mb-open'));
    t.check('toggling again closes both', closedBoth);
    await page.close();
  }

  // --- TEST 2: navigating via goPage() auto-closes an open mobile sidebar ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => toggleMobileSidebar());
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(100);
    const stillOpen = await page.evaluate(() => document.getElementById('sidebar').classList.contains('mb-open'));
    t.check('navigating to a page closes the mobile sidebar automatically, so it never stays stuck open over the page content', !stillOpen);
    await page.close();
  }

  // --- TEST 3: closeMobileSidebar() is idempotent / safe when already closed ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    let threw = false;
    try { await page.evaluate(() => { closeMobileSidebar(); closeMobileSidebar(); }); } catch (e) { threw = true; }
    t.check('calling closeMobileSidebar() when already closed does not throw', !threw);
    await page.close();
  }

  // --- TEST 4: clicking the backdrop closes the sidebar (same handler as the close function) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => toggleMobileSidebar());
    // Backdrop is normally display:none outside the mobile breakpoint; force it
    // visible for this click-through check since Playwright's default viewport
    // doesn't trigger the @media rule that would otherwise show it.
    await page.evaluate(() => { document.getElementById('mb-sidebar-backdrop').style.display = 'block'; });
    await page.click('#mb-sidebar-backdrop');
    const closed = await page.evaluate(() => !document.getElementById('sidebar').classList.contains('mb-open'));
    t.check('clicking the backdrop closes the sidebar', closed);
    await page.close();
  }

  return t;
};
