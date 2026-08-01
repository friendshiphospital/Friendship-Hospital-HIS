// Covers the launcher's role-filtered module tiles (visibleModulesForRole(),
// renderLauncher(), enterModule()) — pure client-side state/DOM logic, no
// Supabase involved, so these tests just set currentProfile directly.
const { makeSuite } = require('./helpers/test-kit');

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('launcher-tiles');
  const page = await context.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });

  // --- cashier: ROLE_PAGES.cashier = ['billing','prices'] -> only the Billing tile ---
  const cashierModules = await page.evaluate(() => {
    currentProfile = { role: 'cashier' };
    return visibleModulesForRole();
  });
  t.check('cashier sees exactly the Billing module tile', cashierModules.length === 1 && cashierModules[0] === 'billing');

  // --- admin: every module tile, including Statistics ---
  const adminModules = await page.evaluate(() => {
    currentProfile = { role: 'admin' };
    return visibleModulesForRole();
  });
  const allModuleKeys = await page.evaluate(() => MODULE_ORDER.slice());
  t.check('admin sees every module tile', adminModules.length === allModuleKeys.length && allModuleKeys.every(k => adminModules.includes(k)));

  // --- Statistics is hardcoded admin-only regardless of ROLE_PAGES, for every non-admin role ---
  const nonAdminRoles = await page.evaluate(() => Object.keys(ROLE_PAGES).filter(r => r !== 'admin'));
  const statsLeakage = await page.evaluate((roles) => {
    return roles.filter(role => {
      currentProfile = { role };
      return visibleModulesForRole().includes('statistics');
    });
  }, nonAdminRoles);
  t.check('no non-admin role ever gets the Statistics tile', statsLeakage.length === 0, statsLeakage.join(', '));

  // --- renderLauncher() DOM output matches visibleModulesForRole() for cashier ---
  await page.evaluate(() => { currentProfile = { role: 'cashier', full_name: 'Cashier Sara' }; renderLauncher(); });
  const tileLabels = await page.evaluate(() => [...document.querySelectorAll('#launcher-grid .launcher-tile .lt-lbl')].map(el => el.textContent));
  t.check('renderLauncher() renders exactly one tile for cashier, labelled Billing', tileLabels.length === 1 && tileLabels[0] === 'Billing');

  // --- enterModule() on a module with zero accessible pages for this role is refused, doesn't navigate ---
  await page.evaluate(() => { currentProfile = { role: 'cashier' }; enterModule('laboratory'); });
  const anyLabPageActive = await page.evaluate(() => {
    const labPages = MODULE_PAGES.laboratory.pages;
    return labPages.some(p => document.getElementById('page-' + p)?.classList.contains('active'));
  });
  t.check('enterModule() into a module with no accessible pages for this role never activates any page in it', !anyLabPageActive);

  // --- enterModule() on an accessible module does navigate ---
  await page.evaluate(() => { currentProfile = { role: 'cashier' }; enterModule('billing'); });
  const billingActive = await page.evaluate(() => !!document.getElementById('page-billing')?.classList.contains('active'));
  t.check('enterModule() into an accessible module activates its first accessible page', billingActive);

  await page.close();
  return t;
};
