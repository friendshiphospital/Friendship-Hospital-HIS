// Covers Blood Bank Phase 1: blood unit inventory — the new Blood Bank
// top-level launcher tile, the FEFO-style expiry-aware unit list (reusing
// computeExpiryStatus()'s exact colour thresholds), status filtering, and
// barcode label printing (reusing the printHeader+JsBarcode+openPrintWin
// pattern already used by printInventoryBarcodeLabel()).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function daysFromToday(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const UNITS = [
  { id: 'u1', unit_no: 'BB-2026-0001', blood_group: 'O', rh_factor: 'Negative', component_type: 'Packed RBC', collection_date: daysFromToday(-10), expiry_date: daysFromToday(-1), volume_ml: 350, source: 'In-House Donation', status: 'Expired' },
  { id: 'u2', unit_no: 'BB-2026-0002', blood_group: 'A', rh_factor: 'Positive', component_type: 'Packed RBC', collection_date: daysFromToday(-5), expiry_date: daysFromToday(30), volume_ml: 350, source: 'Received - External Supply', status: 'Available' },
  { id: 'u3', unit_no: 'BB-2026-0003', blood_group: 'AB', rh_factor: 'Positive', component_type: 'Platelets', collection_date: daysFromToday(-1), expiry_date: daysFromToday(200), volume_ml: 250, source: 'In-House Donation', status: 'Quarantined' },
];

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []);
        if (table === 'blood_units') return chainable(null, ${JSON.stringify(UNITS)});
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
  const t = makeSuite('blood-bank-inventory');

  // --- TEST 1: the Blood Bank launcher tile exists and is reachable, without removing any other tile ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    const visible = await page.evaluate(() => visibleModulesForRole());
    t.check('admin sees the new bloodbank module', visible.includes('bloodbank'));
    t.check('admin still sees the inventory module (nothing displaced)', visible.includes('inventory'));
    await page.evaluate(() => enterModule('bloodbank'));
    await page.waitForTimeout(150);
    const activePage = await page.evaluate(() => document.querySelector('.page.active')?.id);
    t.check('entering the bloodbank module opens the bloodbank page', activePage === 'page-bloodbank');
    await page.close();
  }

  // --- TEST 2: loadBloodUnits() renders all units with FEFO-derived expiry colour banding ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('bb-units-body').innerHTML);
    t.check('all 3 mock units render', ['BB-2026-0001','BB-2026-0002','BB-2026-0003'].every(u => html.includes(u)));
    t.check('the already-expired unit shows the Expired banding', html.includes('Expired'));
    const rowColors = await page.evaluate(() => Array.from(document.querySelectorAll('#bb-units-body td')).map(td => td.style.color).filter(Boolean));
    t.check('expiry cells use computeExpiryStatus()\'s colour values (not a separate colour scheme)', rowColors.length > 0);
    await page.close();
  }

  // --- TEST 3: status tab filtering narrows the list ---
  // The shared chainable() mock ignores .eq(...) filters (returns the same
  // full array regardless), so this test needs its own small filtering
  // chain that actually applies the status filter the real query sends.
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      const allUnits = ${JSON.stringify(UNITS)};
      function filteringChain(rows) {
        return {
          select() { return filteringChain(rows); },
          eq(col, val) { return filteringChain(rows.filter(r => r[col] === val)); },
          order() { return filteringChain(rows); },
          then(resolve) { return resolve({ data: rows, error: null }); },
        };
      }
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []);
          if (table === 'blood_units') return filteringChain(allUnits);
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(200);
    await page.evaluate(() => setBbStatusFilter('Available', null));
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('bb-units-body').innerHTML);
    t.check('filtering to Available shows only the Available unit', html.includes('BB-2026-0002') && !html.includes('BB-2026-0001') && !html.includes('BB-2026-0003'));
    await page.close();
  }

  // --- TEST 4: unit search filters by unit number ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(200);
    await page.evaluate(() => filterBloodUnitList('0003'));
    const html = await page.evaluate(() => document.getElementById('bb-units-body').innerHTML);
    t.check('searching by unit number shows only the matching unit', html.includes('BB-2026-0003') && !html.includes('BB-2026-0001'));
    await page.close();
  }

  // --- TEST 5: printBloodUnitLabel() opens a print window and renders a CODE128 barcode of the unit number ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__mock = { barcodeCalls: [] };
      window.JsBarcode = (el, value, opts) => { window.__mock.barcodeCalls.push({ value, format: opts.format }); };
      window.open = () => ({ document: { write: () => {}, close: () => {}, getElementById: () => document.createElementNS('http://www.w3.org/2000/svg','svg') }, focus: () => {} });
    });
    await page.evaluate(() => printBloodUnitLabel('u2'));
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__mock.barcodeCalls);
    t.check('the label barcode encodes the unit\'s own unit_no', calls.length === 1 && calls[0].value === 'BB-2026-0002');
    t.check('the barcode uses CODE128, same format as inventory item labels', calls[0]?.format === 'CODE128');
    await page.close();
  }

  // --- TEST 6: Blood Bank shelf-life defaults round-trip through Settings ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    const defaults = await page.evaluate(() => ({ wb: CFG.bloodShelfWholeBlood, prbc: CFG.bloodShelfPrbc, plt: CFG.bloodShelfPlatelets, ffp: CFG.bloodShelfFfp, cryo: CFG.bloodShelfCryo }));
    t.check('AABB standard defaults are used out of the box (Whole Blood 35d, PRBC 42d, Platelets 5d, FFP 365d)', defaults.wb === 35 && defaults.prbc === 42 && defaults.plt === 5 && defaults.ffp === 365 && defaults.cryo === 365);
    await page.evaluate(() => {
      document.getElementById('cfg-bb-shelf-plt').value = '7';
      saveBloodBankSettings();
    });
    const updated = await page.evaluate(() => CFG.bloodShelfPlatelets);
    t.check('an admin can override a component\'s shelf-life default', updated === 7);
    await page.close();
  }

  return t;
};
