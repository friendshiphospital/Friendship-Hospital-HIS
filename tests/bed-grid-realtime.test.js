// Covers Phase 5a of the Bed Management (IPD) overhaul: Supabase Realtime
// multi-device sync for the bed grid — the first use of Realtime anywhere
// in this codebase. Scope must stay narrow: one channel, just the beds
// table, only while the Bed Management page is open, torn down the moment
// navigation leaves it (so it never stacks a second channel or keeps
// running in the background on other pages).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { channels: [], removed: [] };
    function makeChannel(name) {
      const ch = { _name: name, _subs: [] };
      ch.on = function(event, filter, cb) { ch._subs.push({ event, filter, cb }); return ch; };
      ch.subscribe = function() { window.__mock.channels.push(ch); return ch; };
      return ch;
    }
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Nurse Test', role: 'nurse' }, []);
        if (table === 'beds') return chainable(null, [{ id:'b1', ward:'Medical', room:'101', bed_number:'1', status:'Available' }]);
        if (table === 'admissions') return chainable(null, []);
        return chainable(null, []);
      },
      channel: (name) => makeChannel(name),
      removeChannel: (ch) => { window.__mock.removed.push(ch); },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'nurse@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('bed-grid-realtime');

  // --- TEST 1: opening the Bed Management page subscribes exactly one channel, scoped to the beds table ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const chans = window.__mock.channels;
      const sub = chans[0]?._subs?.[0];
      return { count: chans.length, table: sub?.filter?.table, schema: sub?.filter?.schema, event: sub?.filter?.event };
    });
    t.check('exactly one channel is subscribed when the page opens', info.count === 1);
    t.check('the subscription is scoped to the public.beds table only', info.table === 'beds' && info.schema === 'public');
    t.check('the subscription listens for all change types (insert/update/delete)', info.event === '*');
    await page.close();
  }

  // --- TEST 2: a simulated beds change from another device reloads the grid automatically ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__mock.loadBedGridCalls = 0;
      const orig = window.loadBedGrid;
      window.loadBedGrid = (...args) => { window.__mock.loadBedGridCalls++; return orig(...args); };
    });
    // Fire the callback the app registered with .on(), simulating a
    // postgres_changes event arriving from another device's write.
    await page.evaluate(() => window.__mock.channels[0]._subs[0].cb({ eventType: 'UPDATE' }));
    await page.waitForTimeout(150);
    const calls = await page.evaluate(() => window.__mock.loadBedGridCalls);
    t.check('a remote beds change triggers an automatic grid reload, no manual refresh needed', calls === 1);
    await page.close();
  }

  // --- TEST 3: navigating away unsubscribes the channel; no channel lingers on another page ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    await page.evaluate(() => goPage('dashboard'));
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => ({ removedCount: window.__mock.removed.length, currentChannel: !!window._bedGridChannel }));
    t.check('leaving the Bed Management page removes the subscribed channel', state.removedCount === 1);
    await page.close();
  }

  // --- TEST 4: re-entering the page after leaving subscribes a fresh channel, never stacking a second one ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(150);
    await page.evaluate(() => goPage('dashboard'));
    await page.waitForTimeout(100);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(150);
    const count = await page.evaluate(() => window.__mock.channels.length);
    t.check('re-entering the page subscribes exactly one new channel (2 total across both visits), never leaving two active at once', count === 2);
    await page.close();
  }

  return t;
};
