// Covers Phase 5b of the Bed Management (IPD) overhaul: the bed-turnaround
// SLA timer for Cleaning/Maintenance beds — elapsed time since
// status_changed_at, escalating past two admin-configurable thresholds
// (Settings -> Bed Turnaround SLA). Purely visual/informational, never
// blocks or auto-changes anything.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function minutesAgoIso(mins) {
  return new Date(Date.now() - mins * 60000).toISOString();
}

function initScript(beds) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []);
        if (table === 'beds') return chainable(null, ${JSON.stringify(beds)});
        if (table === 'admissions') return chainable(null, []);
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
  const t = makeSuite('bed-turnaround-sla');

  const BEDS = [
    { id: 'b1', ward: 'Medical', room: '101', bed_number: '1', status: 'Cleaning', status_changed_at: minutesAgoIso(10) },
    { id: 'b2', ward: 'Medical', room: '102', bed_number: '1', status: 'Cleaning', status_changed_at: minutesAgoIso(45) },
    { id: 'b3', ward: 'ICU', room: '201', bed_number: '1', status: 'Maintenance', status_changed_at: minutesAgoIso(120) },
    { id: 'b4', ward: 'ICU', room: '201', bed_number: '2', status: 'Available', status_changed_at: minutesAgoIso(5) },
  ];

  // --- TEST 1: default thresholds (30/90 min) — under, amber, and red tiles render correctly ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(BEDS));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const tiles = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('#bed-grid-container .bed-tile'));
      return els.map(el => ({ cls: el.className, text: el.querySelector('.bed-tile-info')?.textContent || '' }));
    });
    const under = tiles.find(x => x.text.includes('10m'));
    const amber = tiles.find(x => x.text.includes('45m'));
    const red = tiles.find(x => x.text.includes('2h'));
    t.check('a bed Cleaning for 10 min (under the 30 min amber threshold) shows elapsed time with no escalation class', under && !under.cls.includes('bed-sla-amber') && !under.cls.includes('bed-sla-red'));
    t.check('a bed Cleaning for 45 min (past the 30 min amber threshold, under 90) escalates to amber', amber && amber.cls.includes('bed-sla-amber') && !amber.cls.includes('bed-sla-red'));
    t.check('a bed in Maintenance for 2h (past the 90 min red threshold) escalates to red', red && red.cls.includes('bed-sla-red'));
    t.check('elapsed time is only shown for Cleaning/Maintenance beds, not Available ones', !tiles.some(x => x.text.includes('⏱') && x.cls.includes('bed-av')));
    await page.close();
  }

  // --- TEST 2: the thresholds are admin-configurable via Settings and take effect immediately ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(BEDS));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      document.getElementById('cfg-bed-sla-amber').value = '5';
      document.getElementById('cfg-bed-sla-red').value = '15';
      saveBedSlaSettings();
    });
    const stored = await page.evaluate(() => ({ amber: CFG.bedTurnaroundAmberMin, red: CFG.bedTurnaroundRedMin }));
    t.check('saveBedSlaSettings persists the amber threshold', stored.amber === 5);
    t.check('saveBedSlaSettings persists the red threshold', stored.red === 15);
    // Reload and confirm loadSettings() reflects it back into the form.
    await page.evaluate(() => loadSettings());
    const reloaded = await page.evaluate(() => document.getElementById('cfg-bed-sla-amber').value);
    t.check('loadSettings() reflects the saved amber threshold back into the form', reloaded === '5');
    // With a 5/15 min threshold, the 10-min bed (previously "under") now escalates to amber.
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('#bed-grid-container .bed-tile')).map(el => ({ cls: el.className, text: el.querySelector('.bed-tile-info')?.textContent || '' })));
    const tenMin = tiles.find(x => x.text.includes('10m'));
    t.check('lowering the threshold immediately changes which tiles escalate', tenMin && tenMin.cls.includes('bed-sla-amber'));
    await page.close();
  }

  // --- TEST 3: status_changed_at is stamped on the manual status-menu write (setBedStatus) ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { bedUpdates: [] };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []);
          if (table === 'beds') {
            const c = chainable(null, ${JSON.stringify(BEDS)});
            c.update = (payload) => ({ eq: (col, val) => { window.__mock.bedUpdates.push({ payload, id: val }); return Promise.resolve({ data: null, error: null }); } });
            return c;
          }
          if (table === 'admissions') return chainable(null, []);
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    await page.evaluate(() => setBedStatus('b4', 'Cleaning'));
    await page.waitForTimeout(100);
    const update = await page.evaluate(() => window.__mock.bedUpdates[0]);
    t.check('setBedStatus() stamps status_changed_at alongside the new status', update?.payload.status === 'Cleaning' && typeof update?.payload.status_changed_at === 'string' && !isNaN(Date.parse(update.payload.status_changed_at)));
    await page.close();
  }

  return t;
};
