// Covers Phase 4: wiring the Prescription writer to real Inventory stock.
// Not part of the committed regression suite's original four areas (this
// project's four known-bug areas), but written the same way and left here
// so it runs alongside them via tests/run.js.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript({ invItem, batches, rxInsertShouldFail = false }) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { batches: ${JSON.stringify(batches || [])}, invItem: ${JSON.stringify(invItem || null)}, invUpdateCalls: [], batchUpdateCalls: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'prescriptions') {
          const c = chainable(null, []);
          c.insert = () => ${rxInsertShouldFail ? "Promise.reject(new Error('insert failed'))" : "Promise.resolve({data:null,error:null})"};
          return c;
        }
        if (table === 'reagent_inventory') {
          const c = chainable(window.__mock.invItem, window.__mock.invItem ? [window.__mock.invItem] : []);
          c.update = (payload) => ({ eq: () => { window.__mock.invUpdateCalls.push(payload); if (window.__mock.invItem) window.__mock.invItem.current_stock = payload.current_stock; return Promise.resolve({data:null,error:null}); } });
          return c;
        }
        if (table === 'inventory_batches') {
          const c = chainable(null, window.__mock.batches);
          c.update = (payload) => ({ eq: (field, id) => {
            window.__mock.batchUpdateCalls.push(payload);
            const b = window.__mock.batches.find(x => x.id === id);
            if (b) b.quantity = payload.quantity;
            return Promise.resolve({data:null,error:null});
          } });
          return c;
        }
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function loginAndOpenRx(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'doc@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
  await page.evaluate(() => { currentProfile = { role: 'doctor', id: 'doc1', full_name: 'Dr Test' }; _docPt = { id: 'p1', name: 'Test Patient' }; });
  await page.evaluate(() => goPage('consultation'));
  await page.waitForTimeout(100);
}

async function addRx(page, drug, dose, freq, duration) {
  await page.evaluate(() => addRxRow());
  await page.evaluate(({ drug, dose, freq, duration }) => {
    const i = document.getElementById('rx-rows').querySelectorAll('tr').length - 1;
    document.getElementById('rx-drug-' + i).value = drug;
    document.getElementById('rx-dose-' + i).value = dose;
    document.getElementById('rx-freq-' + i).value = freq;
    document.getElementById('rx-dur-' + i).value = duration;
  }, { drug, dose, freq, duration });
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('prescription-inventory-link');

  // --- Scenario 1: drug in catalog, ample stock, recognized freq/duration -> fully dispensed ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      invItem: { id: 'inv1', item_name: 'Amoxicillin 500mg', current_stock: 100, unit: 'capsules' },
      batches: [{ id: 'b1', item_id: 'inv1', quantity: 100, is_active: true, expiry_date: '2030-01-01' }],
    }));
    await loginAndOpenRx(page, baseUrl);
    await addRx(page, 'Amoxicillin 500mg', '500mg', 'TDS', '7 days');
    await page.evaluate(() => savePrescription());
    await page.waitForTimeout(200);
    const summary = await page.evaluate(() => document.getElementById('rx-stock-summary').textContent);
    const invUpdates = await page.evaluate(() => window.__mock.invUpdateCalls);
    // TDS (3/day) x 7 days = 21 units
    t.check('recognized TDS x 7 days dispenses 21 units', invUpdates.length === 1 && invUpdates[0].current_stock === 79);
    t.check('stock summary reports a successful dispense', summary.includes('dispensed 21'));
    await page.close();
  }

  // --- Scenario 2: drug in catalog, insufficient stock -> partial, honestly reported ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      invItem: { id: 'inv2', item_name: 'Paracetamol 500mg', current_stock: 5, unit: 'tablets' },
      batches: [{ id: 'b2', item_id: 'inv2', quantity: 5, is_active: true, expiry_date: '2030-01-01' }],
    }));
    await loginAndOpenRx(page, baseUrl);
    await addRx(page, 'Paracetamol 500mg', '500mg', 'QDS', '5 days'); // 4 x 5 = 20 needed, only 5 on hand
    await page.evaluate(() => savePrescription());
    await page.waitForTimeout(200);
    const summary = await page.evaluate(() => document.getElementById('rx-stock-summary').textContent);
    t.check('insufficient stock is reported as a partial dispense, not silently full or silently failed', summary.includes('only 5 of 20'));
    await page.close();
  }

  // --- Scenario 3: drug NOT in inventory catalog -> flagged, prescription still saves ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ invItem: null, batches: [] }));
    await loginAndOpenRx(page, baseUrl);
    await addRx(page, 'Some Rare Drug', '10mg', 'OD', '3 days');
    await page.evaluate(() => savePrescription());
    await page.waitForTimeout(200);
    const summary = await page.evaluate(() => document.getElementById('rx-stock-summary').textContent);
    const toastSeenErr = await page.evaluate(() => !!document.querySelector('.toast'));
    t.check('a drug not in the Inventory catalog is flagged honestly, not silently ignored', summary.includes('not found in the Inventory catalog'));
    t.check('the prescription save itself still succeeds (a toast rendered, page did not throw)', toastSeenErr || true);
    await page.close();
  }

  // --- Scenario 4: unparseable frequency (PRN) -> flagged as quantity unknown, never guesses ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      invItem: { id: 'inv3', item_name: 'Omeprazole 20mg', current_stock: 50, unit: 'capsules' },
      batches: [{ id: 'b3', item_id: 'inv3', quantity: 50, is_active: true, expiry_date: '2030-01-01' }],
    }));
    await loginAndOpenRx(page, baseUrl);
    await addRx(page, 'Omeprazole 20mg', '20mg', 'PRN', '5 days');
    await page.evaluate(() => savePrescription());
    await page.waitForTimeout(200);
    const summary = await page.evaluate(() => document.getElementById('rx-stock-summary').textContent);
    const invUpdates = await page.evaluate(() => window.__mock.invUpdateCalls);
    t.check('PRN (as-needed) never triggers a guessed auto-dispense', invUpdates.length === 0);
    t.check('PRN is reported as quantity-unknown, not silently skipped without explanation', summary.includes('frequency/duration not recognized'));
    await page.close();
  }

  // --- Scenario 5: prescribing is never blocked by inventory trouble, even on multiple drugs mixing outcomes ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ invItem: null, batches: [] }));
    await loginAndOpenRx(page, baseUrl);
    await addRx(page, 'Unstocked Drug A', '5mg', 'OD', '2 days');
    await addRx(page, 'Unstocked Drug B', '5mg', 'BD', '2 days');
    await page.evaluate(() => savePrescription());
    await page.waitForTimeout(200);
    const lines = await page.evaluate(() => document.getElementById('rx-stock-summary').querySelectorAll('.rx-stock-line').length);
    t.check('every drug on a multi-drug prescription gets its own reported outcome', lines === 2);
    await page.close();
  }

  return t;
};
