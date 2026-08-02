// Covers Phase 2 of the Bed Management (IPD) overhaul: the visual ward
// bed-grid layered on top of the existing beds/admissions data — ward
// filter tabs pulled from actual configured wards (not hardcoded),
// per-status tile rendering, and tile-tap routing (Available -> pre-fills
// the existing Admit Patient form, Occupied/Discharge Pending -> opens the
// existing openAdmDetail() drawer, Cleaning/Maintenance -> blocked).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

const BEDS = [
  { id: 'b1', ward: 'Medical', room: '101', bed_number: '1', status: 'Available', current_patient_id: null, current_admission_id: null },
  { id: 'b2', ward: 'Medical', room: '101', bed_number: '2', status: 'Occupied', current_patient_id: 'p1', current_admission_id: 'a1' },
  { id: 'b3', ward: 'ICU', room: '201', bed_number: '1', status: 'Cleaning', current_patient_id: null, current_admission_id: null },
  { id: 'b4', ward: 'ICU', room: '201', bed_number: '2', status: 'Discharge Pending', current_patient_id: 'p2', current_admission_id: 'a2' },
];
const ADMISSIONS = [
  { id: 'a1', admission_no: 'ADM-1', admitting_doctor: 'Dr X', admission_date: '2026-07-20', patients: { name: 'John Doe', mrn: 'M1' } },
  { id: 'a2', admission_no: 'ADM-2', admitting_doctor: 'Dr Y', admission_date: '2026-07-25', patients: { name: 'Jane Roe', mrn: 'M2' } },
];

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: 'doctor' }, []);
        if (table === 'beds') return chainable(null, ${JSON.stringify(BEDS)});
        if (table === 'admissions') return chainable(null, ${JSON.stringify(ADMISSIONS)});
        if (table === 'doctors') return chainable(null, []);
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
  await page.fill('#auth-email', 'doc@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('bed-grid');

  // --- TEST 1: loadBedGrid() populates all four beds with the right status classes ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('#bed-grid-container .bed-tile')).map(el => el.className));
    t.check('all 4 configured beds render as tiles', tiles.length === 4);
    t.check('the Available bed renders with the bed-av class', tiles.some(c => c.includes('bed-av')));
    t.check('the Occupied bed renders with the bed-oc class', tiles.some(c => c.includes('bed-oc')));
    t.check('the Cleaning bed renders with the bed-cl class', tiles.some(c => c.includes('bed-cl')));
    t.check('the Discharge Pending bed renders with the bed-dp class', tiles.some(c => c.includes('bed-dp')));
    await page.close();
  }

  // --- TEST 2: ward tabs are pulled from actual bed data, not hardcoded ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const tabLabels = await page.evaluate(() => Array.from(document.querySelectorAll('#bed-grid-ward-tabs .tab')).map(b => b.textContent));
    t.check('ward tabs include "All Wards" plus the two actually-configured wards (ICU, Medical)', tabLabels.includes('All Wards') && tabLabels.includes('ICU') && tabLabels.includes('Medical'));
    t.check('no ward tab exists for a ward that has no beds configured (e.g. Surgical)', !tabLabels.includes('Surgical'));
    await page.close();
  }

  // --- TEST 3: filtering by ward narrows the grid ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    await page.evaluate(() => setBedGridWard('ICU', null));
    const tileCount = await page.evaluate(() => document.querySelectorAll('#bed-grid-container .bed-tile').length);
    t.check('selecting the ICU ward tab shows only the 2 ICU beds', tileCount === 2);
    await page.close();
  }

  // --- TEST 4: occupied tile shows the patient name/MRN, not just a bare status ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('bed-grid-container').innerHTML);
    t.check('the occupied bed tile shows the admitted patient’s name', html.includes('John Doe'));
    t.check('the occupied bed tile shows the patient’s MRN', html.includes('M1'));
    await page.close();
  }

  // --- TEST 5: tapping an Available tile pre-fills the existing Admit Patient form ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    await page.evaluate(() => bedTileClick('b1'));
    await page.waitForTimeout(200);
    const vals = await page.evaluate(() => ({ ward: document.getElementById('adm-ward').value, room: document.getElementById('adm-room').value, bed: document.getElementById('adm-bed').value }));
    t.check('tapping the Available tile pre-fills the ward dropdown', vals.ward === 'Medical');
    t.check('tapping the Available tile pre-fills the room dropdown', vals.room === '101');
    t.check('tapping the Available tile pre-fills the bed dropdown', vals.bed === '1');
    await page.close();
  }

  // --- TEST 6: tapping an Occupied tile opens the EXISTING admission detail drawer (not a rebuilt one) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    // Override AFTER page load — index.html's own `function openAdmDetail`
    // declaration would otherwise clobber a pre-load window.* mock.
    await page.evaluate(() => { window.__admDetailCalls = []; window.openAdmDetail = (id) => { window.__admDetailCalls.push(id); }; });
    await page.evaluate(() => bedTileClick('b2'));
    const calls = await page.evaluate(() => window.__admDetailCalls);
    t.check('tapping the Occupied tile calls the existing openAdmDetail() with the linked admission id', calls.length === 1 && calls[0] === 'a1');
    await page.close();
  }

  // --- TEST 7: tapping a Discharge Pending tile also opens the drawer (patient still physically in the bed) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.__admDetailCalls = []; window.openAdmDetail = (id) => { window.__admDetailCalls.push(id); }; });
    await page.evaluate(() => bedTileClick('b4'));
    const calls = await page.evaluate(() => window.__admDetailCalls);
    t.check('tapping the Discharge Pending tile also opens the admission drawer', calls.length === 1 && calls[0] === 'a2');
    await page.close();
  }

  // --- TEST 8: tapping a Cleaning/Maintenance tile is blocked from admission (no form pre-fill, no drawer) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.getElementById('adm-ward').value = ''; window.__admDetailCalls = []; window.openAdmDetail = (id) => { window.__admDetailCalls.push(id); }; });
    await page.evaluate(() => bedTileClick('b3'));
    await page.waitForTimeout(100);
    const wardVal = await page.evaluate(() => document.getElementById('adm-ward').value);
    const drawerCalls = await page.evaluate(() => window.__admDetailCalls.length);
    const toastText = await page.evaluate(() => document.getElementById('toast-wrap')?.lastElementChild?.textContent || '');
    t.check('the Cleaning tile does not pre-fill the admit form', wardVal === '');
    t.check('the Cleaning tile does not open the admission drawer', drawerCalls === 0);
    t.check('a blocked-status toast explains why', toastText.toLowerCase().includes('cleaning'));
    await page.close();
  }

  // --- TEST 9: the manual status menu lets staff move an Available bed to Cleaning, and it persists via dbWrite-style update ---
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
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: 'doctor' }, []);
          if (table === 'beds') {
            const c = chainable(null, ${JSON.stringify(BEDS)});
            c.update = (payload) => ({ eq: (col, val) => { window.__mock.bedUpdates.push({ payload, id: val }); return Promise.resolve({ data: null, error: null }); } });
            return c;
          }
          if (table === 'admissions') return chainable(null, ${JSON.stringify(ADMISSIONS)});
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    await page.evaluate(() => setBedStatus('b1', 'Cleaning'));
    await page.waitForTimeout(100);
    const updates = await page.evaluate(() => window.__mock.bedUpdates);
    t.check('setBedStatus writes the new status to the beds table for the right bed', updates.length === 1 && updates[0].id === 'b1' && updates[0].payload.status === 'Cleaning');
    await page.close();
  }

  return t;
};
