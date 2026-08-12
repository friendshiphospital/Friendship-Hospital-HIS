// Covers a gap in the lab release workflow: releaseResults() and the
// Unified Entry's releaseAllUnifiedEntry() released results with no extra
// confirmation regardless of whether the result carried a critical/panic
// value (has_critical, already stored on the row). Fixed by adding a
// confirm() gate — same native-dialog pattern already used elsewhere in
// this app (STAT payment deferral, operation cancellation) — before
// releasing any has_critical:true row, additionally noting in the prompt
// if this patient's matching critical_values entry hasn't been
// acknowledged yet (informational only, never a hard block — acknowledging
// and releasing are separate safety steps).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function mockClient(resultRow, critCount) {
  return `
    window.__mock = { released: false, updatePayload: null };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech', role: 'lab_tech' }, []);
        if (table === 'patients') return chainable({ payment_status: 'paid', name: 'Test Patient' }, []);
        if (table === 'results_hematology') {
          const c = chainable(${JSON.stringify(resultRow)}, []);
          c.update = (payload) => ({ eq: () => { window.__mock.released = true; window.__mock.updatePayload = payload; return Promise.resolve({data:null,error:null}); } });
          return c;
        }
        if (table === 'critical_values') return chainable(null, [], ${critCount});
        if (table === 'sample_records') return chainable({ payment_deferred: false }, []);
        const c = chainable(null, []);
        c.insert = (payload) => Promise.resolve({data:[payload],error:null});
        c.update = () => ({ eq: () => Promise.resolve({data:null,error:null}) });
        return c;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

// chainable() (helpers/chainable-mock) doesn't natively support .select(cols,{count:'exact',head:true})
// returning a count — patch it in for the critical_values lookup
// specifically (hasUnacknowledgedCritical() reads {count} back).
// Every chained method returns a fresh chainable(single, arr) that would
// otherwise drop the count set at construction time, so the third
// parameter needs threading through all 14 of those return sites too.
const CHAINABLE_WITH_COUNT = CHAINABLE_MOCK_SRC
  .replace('function chainable(single, arr) {', 'function chainable(single, arr, count) {')
  .replace(/return chainable\(single, arr\);/g, 'return chainable(single, arr, count);')
  .replace('then(resolve){ return resolve({ data: arr, error: null }); },', 'then(resolve){ return resolve({ data: arr, error: null, count: count }); },');

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'lab@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('critical-release-confirmation');

  // --- TEST 1: a critical result shows the Yes/No confirm prompt; declining leaves it unreleased ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_WITH_COUNT}
      ${mockClient({ is_verified: true, has_critical: true }, 0)}
    `);
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    let dialogMessage = '';
    page.on('dialog', d => { dialogMessage = d.message(); d.dismiss(); });
    const toasts = [];
    await page.exposeFunction('__capt1', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function(msg,kind){ window.__capt1(msg); return orig?orig(msg,kind):undefined; }; });
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(200);
    t.check('a critical result triggers a confirm prompt naming the CRITICAL value', dialogMessage.includes('CRITICAL'));
    const released = await page.evaluate(() => window.__mock.released);
    t.check('declining the prompt does NOT release the result', released === false);
    t.check('declining shows a clear "nothing changed" toast', toasts.some(m => m.includes('cancelled') && m.includes('unreleased')));
    await page.close();
  }

  // --- TEST 2: confirming releases the critical result normally ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_WITH_COUNT}
      ${mockClient({ is_verified: true, has_critical: true }, 0)}
    `);
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    page.on('dialog', d => d.accept());
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(200);
    const released = await page.evaluate(() => window.__mock.released);
    t.check('confirming the prompt releases the critical result normally', released === true);
    await page.close();
  }

  // --- TEST 3: an unacknowledged critical value adds the extra warning clause to the prompt ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_WITH_COUNT}
      ${mockClient({ is_verified: true, has_critical: true }, 1)}
    `);
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    let dialogMessage = '';
    page.on('dialog', d => { dialogMessage = d.message(); d.dismiss(); });
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(200);
    t.check('an unacknowledged critical value is mentioned in the confirm prompt', dialogMessage.includes('not yet been acknowledged'));
    await page.close();
  }

  // --- TEST 4: a non-critical result releases with no extra prompt, unchanged from before ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_WITH_COUNT}
      ${mockClient({ is_verified: true, has_critical: false }, 0)}
    `);
    await login(page, baseUrl);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    let dialogFired = false;
    page.on('dialog', d => { dialogFired = true; d.accept(); });
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(200);
    t.check('a non-critical result never triggers a confirm prompt', !dialogFired);
    const released = await page.evaluate(() => window.__mock.released);
    t.check('a non-critical result still releases normally', released === true);
    await page.close();
  }

  // --- TEST 5: releaseAllUnifiedEntry() also gates a critical section, without blocking non-critical sections in the same batch ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_WITH_COUNT}
      window.__mock = { hemReleased: false, chemReleased: false };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech', role: 'lab_tech' }, []);
          if (table === 'patients') return chainable({ payment_status: 'paid', name: 'Test Patient' }, []);
          if (table === 'results_hematology') {
            const c = chainable({ is_verified: true, has_critical: true }, []);
            c.update = (payload) => ({ eq: () => { window.__mock.hemReleased = true; return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          if (table === 'results_chemistry') {
            const c = chainable({ is_verified: true, has_critical: false }, []);
            c.update = (payload) => ({ eq: () => { window.__mock.chemReleased = true; return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          if (table === 'critical_values') return chainable(null, [], 0);
          if (table === 'sample_records') return chainable({ payment_deferred: false }, []);
          const c = chainable(null, []);
          c.update = () => ({ eq: () => Promise.resolve({data:null,error:null}) });
          return c;
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => { _ueCurrentDepts = ['hem','chem']; _uePatientId = 'p1'; });
    page.on('dialog', d => d.dismiss()); // decline the hem critical-value prompt
    const toasts = [];
    await page.exposeFunction('__capt5', (m) => toasts.push(m));
    await page.evaluate(() => { const orig = window.toast; window.toast = function(msg,kind){ window.__capt5(msg); return orig?orig(msg,kind):undefined; }; });
    await page.evaluate(() => releaseAllUnifiedEntry());
    await page.waitForTimeout(200);
    const hemReleased = await page.evaluate(() => window.__mock.hemReleased);
    const chemReleased = await page.evaluate(() => window.__mock.chemReleased);
    t.check('declining the critical-value prompt for one section leaves it unreleased', hemReleased === false);
    t.check('a non-critical section in the same batch still releases normally', chemReleased === true);
    t.check('the summary toast mentions the declined section', toasts.some(m => m.includes('declined at critical-value confirmation')));
    await page.close();
  }

  return t;
};
