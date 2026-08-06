// Covers the lab verify/release lock: releaseResults() refusing to release
// unverified results, and applyResultLock()/canOverrideResultLock() locking
// result-entry fields once a result is verified/released, with an
// admin/lab_supervisor-only override. One of this project's four
// highest-value regression areas per its own bug history.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScriptWithHemRow(row) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { updateCalls: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'results_hematology') {
          const c = chainable(${JSON.stringify(row)}, ${row ? '[' + JSON.stringify(row) + ']' : '[]'});
          c.update = (payload) => ({ eq: () => { window.__mock.updateCalls.push(payload); return Promise.resolve({ data: null, error: null }); } });
          return c;
        }
        if (table === 'sample_records') return chainable(null, []);
        // releaseResults() now gates on payment status (billing enforcement) --
        // this suite is testing the verify/release LOCK specifically, so the
        // mock patient is always paid, keeping that behavior out of scope here
        // (covered separately by billing-release-gate.test.js).
        if (table === 'patients') return chainable({ payment_status: 'paid' }, []);
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('result-verify-lock');

  // --- releaseResults(): no result on file at all -> refused, no update ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptWithHemRow(null));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__mock.updateCalls.length);
    t.check('releaseResults() with no saved result at all makes no update call', calls === 0);
    await page.close();
  }

  // --- releaseResults(): result exists but unverified -> refused ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptWithHemRow({ is_verified: false }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__mock.updateCalls.length);
    t.check('releaseResults() on an unverified result makes no update call', calls === 0);
    await page.close();
  }

  // --- releaseResults(): result verified -> released ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptWithHemRow({ is_verified: true }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__mock.updateCalls);
    t.check('releaseResults() on a verified result makes exactly one update call', calls.length === 1);
    t.check('the update sets is_released:true', calls[0] && calls[0].is_released === true);
    await page.close();
  }

  // --- applyResultLock(): unverified/unreleased -> fields NOT disabled ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptWithHemRow(null));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.evaluate(() => { currentProfile = { role: 'lab_tech' }; applyResultLock('hem', { is_verified: false, is_released: false }); });
    const hgbDisabled = await page.evaluate(() => document.getElementById('he-hgb').disabled);
    t.check('unverified result -> entry fields stay editable', !hgbDisabled);
    await page.close();
  }

  // --- applyResultLock(): verified, non-privileged role -> locked, no override button ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptWithHemRow(null));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.evaluate(() => { currentProfile = { role: 'lab_tech' }; applyResultLock('hem', { is_verified: true, is_released: false }); });
    const hgbDisabled = await page.evaluate(() => document.getElementById('he-hgb').disabled);
    const unlockVisible = await page.evaluate(() => {
      const b = document.getElementById('hem-entry-unlock-btn');
      return !!b && b.style.display !== 'none';
    });
    t.check('verified result -> lab_tech\'s entry fields become disabled', hgbDisabled);
    t.check('lab_tech (not admin/lab_supervisor) never gets an unlock-to-edit button', !unlockVisible);
    await page.close();
  }

  // --- applyResultLock(): verified, admin -> locked by default, but can override ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScriptWithHemRow(null));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.evaluate(() => { currentProfile = { role: 'admin' }; applyResultLock('hem', { is_verified: true, is_released: false }); });
    const hgbDisabledBefore = await page.evaluate(() => document.getElementById('he-hgb').disabled);
    const unlockVisible = await page.evaluate(() => {
      const b = document.getElementById('hem-entry-unlock-btn');
      return !!b && b.style.display !== 'none';
    });
    t.check('verified result -> admin\'s fields are locked by default too (role alone doesn\'t bypass the lock)', hgbDisabledBefore);
    t.check('admin gets an unlock-to-edit override button', unlockVisible);
    await page.evaluate(() => document.getElementById('hem-entry-unlock-btn').click());
    const hgbDisabledAfter = await page.evaluate(() => document.getElementById('he-hgb').disabled);
    t.check('clicking Unlock re-enables the fields for admin', !hgbDisabledAfter);
    await page.close();
  }

  return t;
};
