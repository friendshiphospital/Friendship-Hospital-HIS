// Covers getNextNumber() — the generate_next_id() RPC path, its client-side
// self-healing fallback (reads id_counters + MAX() over real data as a
// floor), optimistic-concurrency retry on a write collision, and the
// fully-offline temporary-number path. This is the ID-collision-prone code
// two devices can hit simultaneously, so it's one of this project's
// highest-value regression targets.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function baseInit(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    ${extra}
  `;
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('id-generation');

  // --- Scenario A: RPC succeeds -> returns the RPC value directly ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`
      window.__mock = { idCountersTouched: false };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => { if (table === 'id_counters') window.__mock.idCountersTouched = true; return chainable(null, []); },
        rpc: () => Promise.resolve({ data: 'RPC-777', error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    const result = await page.evaluate(() => getNextNumber('lab_number'));
    const touched = await page.evaluate(() => window.__mock.idCountersTouched);
    t.check('RPC success returns the RPC value directly', result === 'RPC-777');
    t.check('RPC success never falls through to the id_counters fallback', !touched);
    await page.close();
  }

  // --- Scenario B: RPC fails, id_counters row exists -> update path ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`
      window.__mock = { updateCalls: 0, lastUpdatePayload: null };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'id_counters') return {
            select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { current_value: 305 }, error: null }) }) }),
            update: (payload) => ({ eq: () => ({ eq: () => ({ select: () => {
              window.__mock.updateCalls++; window.__mock.lastUpdatePayload = payload;
              return Promise.resolve({ data: [payload], error: null });
            } }) }) }),
          };
          return chainable(null, []); // computeDataMax's reads -> empty -> dataMax=0
        },
        rpc: () => Promise.reject(new Error('function not deployed')),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    const result = await page.evaluate(() => getNextNumber('lab_number'));
    const calls = await page.evaluate(() => window.__mock.updateCalls);
    const payload = await page.evaluate(() => window.__mock.lastUpdatePayload);
    t.check('RPC failure + existing counter row -> increments past current_value (305 -> 306)', result === '306');
    t.check('exactly one update call on the happy path (no collision)', calls === 1);
    t.check('update payload carries the new current_value', payload && payload.current_value === 306);
    await page.close();
  }

  // --- Scenario C: RPC fails, id_counters row does NOT exist -> insert path, seeded floor ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`
      window.__mock = { insertCalls: 0, lastInsertPayload: null };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'id_counters') return {
            select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
            insert: (payload) => { window.__mock.insertCalls++; window.__mock.lastInsertPayload = payload; return Promise.resolve({ data: [payload], error: null }); },
          };
          return chainable(null, []);
        },
        rpc: () => Promise.reject(new Error('function not deployed')),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    // ID_START.lab_number = 300, so with no counter row and no existing data, next should seed at 301.
    const result = await page.evaluate(() => getNextNumber('lab_number'));
    const calls = await page.evaluate(() => window.__mock.insertCalls);
    t.check('no counter row -> seeds from ID_START (300) -> returns 301', result === '301');
    t.check('exactly one insert call when creating a brand-new counter row', calls === 1);
    await page.close();
  }

  // --- Scenario D: optimistic-concurrency collision on first write -> retries and succeeds ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`
      window.__mock = { updateCalls: 0 };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'id_counters') return {
            select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { current_value: 305 }, error: null }) }) }),
            update: (payload) => ({ eq: () => ({ eq: () => ({ select: () => {
              window.__mock.updateCalls++;
              // First attempt loses the optimistic-concurrency race (another device won) -> no rows matched.
              if (window.__mock.updateCalls === 1) return Promise.resolve({ data: [], error: null });
              return Promise.resolve({ data: [payload], error: null });
            } }) }) }),
          };
          return chainable(null, []);
        },
        rpc: () => Promise.reject(new Error('function not deployed')),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    const result = await page.evaluate(() => getNextNumber('lab_number'));
    const calls = await page.evaluate(() => window.__mock.updateCalls);
    t.check('a lost optimistic-concurrency race retries instead of returning a stale/duplicate number', calls >= 2);
    t.check('retry after collision still returns a valid incremented number', result === '306');
    await page.close();
  }

  // --- Scenario E: fully offline (no sb) -> temporary out-of-range marker, never throws ---
  {
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' }); // no sb_url/sb_key set -> sb stays null
    const result = await page.evaluate(() => getNextNumber('lab_number'));
    const numeric = Number(result);
    t.check('offline fallback returns a numeric string', !Number.isNaN(numeric));
    t.check('offline fallback is deliberately outside every department\'s normal 100-999 range', numeric >= 1000000);
    await page.close();
  }

  return t;
};
