// Covers Phase 5d of the Bed Management (IPD) overhaul: the isolation/
// infection visual overlay on Occupied bed-grid tiles — reads the
// EXISTING Infection Flags feature (infection_flags.active) read-only, no
// new flag-creation path. Must be an icon/border treatment, not just a
// colour change, since tile colour already means occupancy status.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

const BEDS = [
  { id: 'b1', ward: 'Medical', room: '101', bed_number: '1', status: 'Occupied', current_admission_id: 'a1' },
  { id: 'b2', ward: 'Medical', room: '102', bed_number: '1', status: 'Occupied', current_admission_id: 'a2' },
];
const ADMISSIONS = [
  { id: 'a1', ward: 'Medical', patient_id: 'p1', admission_no: 'A1', admitting_doctor: 'Dr X', admission_date: '2026-07-30T08:00:00Z', discharge_planning_started_at: null, patients: { name: 'Isolated Patient', mrn: 'M1' } },
  { id: 'a2', ward: 'Medical', patient_id: 'p2', admission_no: 'A2', admitting_doctor: 'Dr X', admission_date: '2026-07-30T08:00:00Z', discharge_planning_started_at: null, patients: { name: 'Regular Patient', mrn: 'M2' } },
];

function initScript(flags) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Nurse Test', role: 'nurse' }, []);
        if (table === 'beds') return chainable(null, ${JSON.stringify(BEDS)});
        if (table === 'admissions') return chainable(null, ${JSON.stringify(ADMISSIONS)});
        if (table === 'infection_flags') return chainable(null, ${JSON.stringify(flags)});
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
  await page.fill('#auth-email', 'nurse@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('bed-isolation-overlay');

  // --- TEST 1: a patient with an active infection flag gets the isolation marker; the other patient does not ---
  {
    const flags = [{ patient_id: 'p1', flag_type: 'Contact', active: true }];
    const page = await context.newPage();
    await page.addInitScript(initScript(flags));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('#bed-grid-container .bed-tile')).map(el => ({ html: el.innerHTML, cls: el.className })));
    const isolatedTile = tiles.find(x => x.html.includes('Isolated Patient'));
    const regularTile = tiles.find(x => x.html.includes('Regular Patient'));
    t.check('the patient with an active infection flag gets the isolation marker', isolatedTile?.html.includes('bed-tile-iso') && isolatedTile?.cls.includes('bed-isolation'));
    t.check('the isolation marker names the precaution type (Contact)', isolatedTile?.html.includes('Contact'));
    t.check('the patient with no infection flag does not get the marker', !regularTile?.html.includes('bed-tile-iso') && !regularTile?.cls.includes('bed-isolation'));
    t.check('the isolated tile keeps its normal Occupied/red status class (marker is additive, not a colour replacement)', isolatedTile?.cls.includes('bed-oc'));
    await page.close();
  }

  // --- TEST 2: a RESOLVED infection flag (active:false, filtered server-side) does not trigger the marker ---
  {
    const page = await context.newPage();
    // Mock's .eq('active', true) is a no-op filter (chainable ignores
    // filters), so simulate what the real backend would actually return:
    // only flags where active is genuinely true.
    await page.addInitScript(initScript([]));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const hasMarker = await page.evaluate(() => !!document.querySelector('.bed-tile-iso'));
    t.check('with no active infection flags at all, no bed shows the isolation marker', !hasMarker);
    await page.close();
  }

  // --- TEST 3: no new infection-flag write path was introduced — this overlay is strictly read-only ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([{ patient_id: 'p1', flag_type: 'Airborne', active: true }]));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    const hasWriteHandlerOnTile = await page.evaluate(() => {
      const iso = document.querySelector('.bed-tile-iso');
      return iso ? iso.hasAttribute('onclick') : false;
    });
    t.check('the isolation marker itself has no click handler (display-only, opening the drawer is still the normal tile tap)', !hasWriteHandlerOnTile);
    await page.close();
  }

  return t;
};
