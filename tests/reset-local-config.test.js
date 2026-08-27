// Covers resetAllLocalConfig() -- the "Reset All Local Configuration" action
// added to the login screen's Supabase Configuration panel and the Settings
// > Supabase Connection card. localStorage is scoped to the browser origin,
// not to any particular downloaded copy of index.html, so a device that
// previously connected to one hospital's Supabase project would otherwise
// keep showing that hospital's URL/key (and, in the de-identified template,
// its cached hospital name) to whoever opens a "fresh" copy next. This test
// seeds stale config, clicks the reset button, and confirms both the
// storage and the visible login-screen fields come back empty after reload.
const { makeSuite } = require('./helpers/test-kit');

// location.reload() inside resetAllLocalConfig() races with Playwright's own
// load-state tracking -- an evaluate() issued right after it can land either
// just before or just after the new document is up, destroying its execution
// context either way. Retrying past that transient error (rather than trying
// to out-guess the exact timing) is the robust way to wait it out.
async function evalAfterReload(page, fn, tries = 10) {
  for (let i = 0; i < tries; i++) {
    try { return await page.evaluate(fn); }
    catch (e) {
      if (!/Execution context was destroyed/.test(e.message) || i === tries - 1) throw e;
      await page.waitForTimeout(150);
    }
  }
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('reset-local-config');
  const page = await context.newPage();

  // Accept the confirm() dialog resetAllLocalConfig() shows before it clears anything.
  page.on('dialog', dialog => dialog.accept());

  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });

  // Seed stale config as if this browser previously connected to a different hospital.
  await page.evaluate(() => {
    localStorage.setItem('sb_url', 'https://stale-old-hospital.supabase.co');
    localStorage.setItem('sb_key', 'stale-anon-key-123');
    localStorage.setItem('cfg_name', 'Some Other Hospital');
    localStorage.setItem('cfg_addr', 'Somewhere Else');
  });
  await page.reload({ waitUntil: 'load' });

  const seeded = await page.evaluate(() => ({
    sb_url: localStorage.getItem('sb_url'),
    sb_key: localStorage.getItem('sb_key'),
    cfg_name: localStorage.getItem('cfg_name'),
  }));
  t.check('stale config is actually seeded before reset', seeded.sb_url === 'https://stale-old-hospital.supabase.co' && seeded.cfg_name === 'Some Other Hospital');

  // Open the login screen's config panel and confirm it shows the stale values (pre-reset baseline).
  await page.evaluate(() => toggleCfg());
  const beforeUrlValue = await page.$eval('#cfg-url', el => el.value);
  t.check('config panel shows the stale Supabase URL before reset', beforeUrlValue === 'https://stale-old-hospital.supabase.co');

  const resetBtn = await page.$('.auth-submit[onclick="resetAllLocalConfig()"]');
  t.check('login screen has a Reset All Local Configuration button', !!resetBtn);

  await page.evaluate(() => resetAllLocalConfig()).catch(e => {
    if (!/Execution context was destroyed/.test(e.message)) throw e;
  });

  const afterClear = await evalAfterReload(page, () => ({
    sb_url: localStorage.getItem('sb_url'),
    sb_key: localStorage.getItem('sb_key'),
    cfg_name: localStorage.getItem('cfg_name'),
    keys: Object.keys(localStorage),
  }));
  // localStorage.clear() empties everything; the app's own post-reload init
  // (e.g. setLanguage() re-persisting a UI-only 'lang' default) re-adding a
  // non-identifying key afterwards is expected, not a leak -- what matters
  // is that none of the stale hospital/Supabase identity survives.
  t.check('stale Supabase URL/key/hospital-name are gone after reset', afterClear.sb_url === null && afterClear.sb_key === null && afterClear.cfg_name === null, JSON.stringify(afterClear));
  const leakedIdentityKeys = afterClear.keys.filter(k => k !== 'lang');
  t.check('no unexpected keys survive the reset besides the UI-only lang default', leakedIdentityKeys.length === 0, JSON.stringify(afterClear.keys));

  await evalAfterReload(page, () => toggleCfg());
  const afterUrlValue = await page.$eval('#cfg-url', el => el.value);
  t.check('config panel URL field is blank after reset + reload', afterUrlValue === '');

  await page.close();
  return t;
};
