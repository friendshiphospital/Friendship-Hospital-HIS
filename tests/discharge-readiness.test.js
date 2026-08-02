// Covers Phase 5c of the Bed Management (IPD) overhaul: the rule-based
// (never predictive/ML) discharge-readiness badge on Occupied bed-grid
// tiles — triggers on LOS exceeding the ward's own current average by a
// configurable margin, or discharge planning having started (the
// Discharge form was opened) but never finalized. Subtle badge only,
// never changes the tile's colour, never an alert.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function daysAgoIso(d) {
  const dt = new Date(); dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

function initScript(beds, admissions) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []);
        if (table === 'beds') return chainable(null, ${JSON.stringify(beds)});
        if (table === 'admissions') return chainable(null, ${JSON.stringify(admissions)});
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
  const t = makeSuite('discharge-readiness');

  // --- TEST 1: LOS far above ward average triggers the badge; a normal LOS does not ---
  {
    const beds = [
      { id: 'b1', ward: 'Medical', room: '101', bed_number: '1', status: 'Occupied', current_admission_id: 'a1' },
      { id: 'b2', ward: 'Medical', room: '102', bed_number: '1', status: 'Occupied', current_admission_id: 'a2' },
      { id: 'b3', ward: 'Medical', room: '103', bed_number: '1', status: 'Occupied', current_admission_id: 'a3' },
    ];
    const admissions = [
      { id: 'a1', ward: 'Medical', admission_no: 'A1', admitting_doctor: 'Dr X', admission_date: daysAgoIso(2), discharge_planning_started_at: null, patients: { name: 'Short Stay', mrn: 'M1' } },
      { id: 'a2', ward: 'Medical', admission_no: 'A2', admitting_doctor: 'Dr X', admission_date: daysAgoIso(2), discharge_planning_started_at: null, patients: { name: 'Also Short', mrn: 'M2' } },
      { id: 'a3', ward: 'Medical', admission_no: 'A3', admitting_doctor: 'Dr X', admission_date: daysAgoIso(20), discharge_planning_started_at: null, patients: { name: 'Long Stay', mrn: 'M3' } },
    ];
    const page = await context.newPage();
    await page.addInitScript(initScript(beds, admissions));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('#bed-grid-container .bed-tile')).map(el => ({ html: el.innerHTML, hasBadge: !!el.querySelector('.bed-tile-readiness') })));
    const longStayTile = tiles.find(x => x.html.includes('Long Stay'));
    const shortStayTiles = tiles.filter(x => x.html.includes('Short'));
    t.check('the outlier long-stay patient (20d vs ~2d ward average) gets the discharge-readiness badge', longStayTile?.hasBadge === true);
    t.check('the two short-stay patients (near ward average) do not get the badge', shortStayTiles.every(x => x.hasBadge === false));
    const badgeCopy = await page.evaluate(() => document.querySelector('.bed-tile-readiness')?.title || '');
    t.check('the badge tooltip is explicit that this is rule-based, not a prediction', badgeCopy.toLowerCase().includes('rule-based'));
    const longStayCls = await page.evaluate(() => Array.from(document.querySelectorAll('#bed-grid-container .bed-tile')).find(el => el.innerHTML.includes('Long Stay'))?.className);
    t.check('the flagged tile keeps its normal bed-oc (Occupied/red) status class', longStayCls?.includes('bed-oc'));
    await page.close();
  }

  // --- TEST 2: discharge planning started (form opened) but not finalized also triggers the badge ---
  {
    const beds = [{ id: 'b1', ward: 'ICU', room: '201', bed_number: '1', status: 'Occupied', current_admission_id: 'a1' }];
    const admissions = [{ id: 'a1', ward: 'ICU', admission_no: 'A1', admitting_doctor: 'Dr X', admission_date: daysAgoIso(1), discharge_planning_started_at: new Date().toISOString(), patients: { name: 'Stalled Discharge', mrn: 'M9' } }];
    const page = await context.newPage();
    await page.addInitScript(initScript(beds, admissions));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const hasBadge = await page.evaluate(() => !!document.querySelector('.bed-tile-readiness'));
    t.check('a stalled discharge (form opened, admission still Active) triggers the badge even with a short LOS', hasBadge);
    await page.close();
  }

  // --- TEST 3: opening the discharge form stamps discharge_planning_started_at exactly once ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { admUpdates: [] };
      const adm = { id: 'a1', ward: 'ICU', admission_date: '${daysAgoIso(1)}', discharge_planning_started_at: null, patients: { id: 'p1', name: 'Test Patient', mrn: 'M1' } };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []);
          if (table === 'admissions') {
            const c = chainable(adm, []);
            c.update = (payload) => ({ eq: () => { window.__mock.admUpdates.push(payload); return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          if (table === 'results_hematology') return chainable(null, []);
          if (table === 'results_chemistry') return chainable(null, []);
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => openDischarge('a1'));
    await page.waitForTimeout(150);
    const updates = await page.evaluate(() => window.__mock.admUpdates);
    t.check('opening the Discharge form stamps discharge_planning_started_at', updates.length === 1 && typeof updates[0].discharge_planning_started_at === 'string');
    await page.close();
  }

  // --- TEST 4: the LOS margin is admin-configurable via Settings and takes effect immediately ---
  {
    const beds = [
      { id: 'b1', ward: 'Medical', room: '101', bed_number: '1', status: 'Occupied', current_admission_id: 'a1' },
      { id: 'b2', ward: 'Medical', room: '102', bed_number: '1', status: 'Occupied', current_admission_id: 'a2' },
    ];
    const admissions = [
      { id: 'a1', ward: 'Medical', admission_no: 'A1', admitting_doctor: 'Dr X', admission_date: daysAgoIso(2), discharge_planning_started_at: null, patients: { name: 'Baseline', mrn: 'M1' } },
      { id: 'a2', ward: 'Medical', admission_no: 'A2', admitting_doctor: 'Dr X', admission_date: daysAgoIso(3), discharge_planning_started_at: null, patients: { name: 'Slightly Longer', mrn: 'M2' } },
    ];
    const page = await context.newPage();
    await page.addInitScript(initScript(beds, admissions));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.getElementById('cfg-discharge-readiness-margin').value = '5'; saveDischargeReadinessSettings(); });
    const stored = await page.evaluate(() => CFG.dischargeReadinessLosMarginPct);
    t.check('saveDischargeReadinessSettings persists the margin', stored === 5);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const hasBadge = await page.evaluate(() => !!document.querySelector('.bed-tile-readiness'));
    t.check('a tight 5% margin flags even a modestly longer stay (3d vs 2.5d avg)', hasBadge);
    await page.close();
  }

  return t;
};
