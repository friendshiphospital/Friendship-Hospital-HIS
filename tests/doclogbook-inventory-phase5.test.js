// Covers Documentation/Logbook Phase 5 (Inventory): a reason-coded,
// mandatory-notes wastage/discard log for general inventory_batches
// (previously only Blood Bank had this pattern — expired batches were
// only ever visually flagged, never formally written off), and a
// requester-confirms-receipt closing step for the stock requisition/
// transfer pipeline (previously ended at "fulfilled" with no step for
// the requesting department to confirm the stock actually arrived).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { batchUpdate: null, reqUpdate: null };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Inv Test', role: 'admin' }, []);
        ${extra || ''}
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
  const t = makeSuite('doclogbook-inventory-phase5');

  // --- Wastage/discard: mandatory reason code + notes, no silent removals ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'inventory_batches') {
          const c = chainable(null, []);
          c.update = (payload) => { window.__mock.batchUpdate = payload; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('inventory'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { window._invItems = [{ id: 'i1', item_name: 'Glucose Reagent', unit: 'kits' }]; });
    await page.evaluate(() => openDiscardBatch('b1', 'i1'));
    await page.waitForTimeout(100);
    const infoText = await page.evaluate(() => document.getElementById('inv-discard-info').innerHTML);
    t.check('the discard modal identifies the correct item', infoText.includes('Glucose Reagent'));
    await page.evaluate(() => submitDiscardBatch());
    await page.waitForTimeout(100);
    t.check('discarding without a reason code is blocked', (await page.evaluate(() => window.__mock.batchUpdate)) === null);
    await page.evaluate(() => { document.getElementById('inv-discard-reason-code').value = 'Damaged'; });
    await page.evaluate(() => submitDiscardBatch());
    await page.waitForTimeout(100);
    t.check('discarding without notes is also blocked (reason code alone is not enough)', (await page.evaluate(() => window.__mock.batchUpdate)) === null);
    await page.evaluate(() => { document.getElementById('inv-discard-notes').value = 'Bottle cracked in transit, contents leaked.'; });
    await page.evaluate(() => submitDiscardBatch());
    await page.waitForTimeout(100);
    const update = await page.evaluate(() => window.__mock.batchUpdate);
    t.check('a valid discard sets is_active false with the reason code and who/when', update?.is_active === false && update?.discard_reason_code === 'Damaged' && !!update?.discarded_by_name && !!update?.discarded_at);
    t.check('the mandatory notes are persisted', update?.discard_notes === 'Bottle cracked in transit, contents leaked.');
    await page.close();
  }

  // --- Lot register shows discarded batches distinctly, not silently disappeared ---
  {
    const page = await context.newPage();
    const items = [{ id: 'i1', item_name: 'Saline 0.9%', department: 'Laboratory', onboard_stability_days: 30 }];
    const batches = [
      { id: 'b1', item_id: 'i1', batch_no: 'LOT-D1', quantity: 0, received_date: '2026-06-01', expiry_date: '2026-12-01', is_opened: false, is_active: false, discard_reason_code: 'Damaged', discard_notes: 'Leaked', discarded_by_name: 'Inv Test', discarded_at: '2026-07-01T00:00:00Z' },
    ];
    await page.addInitScript(initScript(`
        if (table === 'reagent_inventory') return chainable(null, ${JSON.stringify(items)});
        if (table === 'inventory_batches') return chainable(null, ${JSON.stringify(batches)});
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('inventory'));
    await page.waitForTimeout(200);
    await page.evaluate(() => switchInvTab('lots', null));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('lot-register-body').innerHTML);
    t.check('the register still lists a discarded batch (a permanent record, not deleted)', html.includes('LOT-D1'));
    t.check('the register shows the discard reason distinctly, not a misleading expiry-health badge', html.includes('Discarded') && html.includes('Damaged'));
    await page.close();
  }

  // --- Requisition: requester confirms receipt after fulfillment ---
  {
    const page = await context.newPage();
    const req = { id: 'r1', requesting_department: 'ICU', item_id: 'i1', qty_requested: 5, status: 'fulfilled', requested_by: 'u1', requested_by_name: 'Inv Test', reagent_inventory: { item_name: 'Syringes', unit: 'pcs' } };
    await page.addInitScript(initScript(`
        if (table === 'stock_requisitions') {
          const c = chainable(null, [${JSON.stringify(req)}]);
          c.update = (payload) => { window.__mock.reqUpdate = payload; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('inventory'));
    await page.waitForTimeout(200);
    await page.evaluate(() => switchInvTab('req', null));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('req-table-body').innerHTML);
    t.check('a fulfilled requisition shows a Confirm Receipt action for the original requester', html.includes('Confirm Receipt'));
    await page.evaluate(() => confirmRequisitionReceipt('r1'));
    await page.waitForTimeout(100);
    const update = await page.evaluate(() => window.__mock.reqUpdate);
    t.check('confirming receipt sets status to received', update?.status === 'received');
    t.check('confirming receipt records who confirmed and when', !!update?.received_confirmed_by_name && !!update?.received_confirmed_at);
    await page.close();
  }

  return t;
};
