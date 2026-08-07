// Functional audit, Section 12: Inventory.
// Real Playwright browser interaction against the real app. Existing
// dedicated regression coverage already proves two narrow slices in
// isolation with lightweight chainable mocks:
//   tests/prescription-inventory-link.test.js — a doctor's prescription
//     decrementing drug stock via dispenseFromInventoryFefo().
//   tests/doclogbook-inventory-phase5.test.js — the wastage/discard modal's
//     mandatory reason-code+notes gate, and the transfer pipeline's
//     requester-confirms-receipt closing step — each in a throwaway,
//     single-call mock (no real stock-math verification).
// This section does NOT re-prove those in isolation; instead it drives one
// continuous, realistic session against the real STATEFUL mock DB (writes
// from one action are genuinely visible to the next, like a real Supabase
// project) to confirm the pieces actually connect and the arithmetic is
// really happening in the DB, not just in a toast message:
//   (12a) golden path — add a new catalog item with an initial batch,
//         see it rendered in the live table, then dispense (FEFO) and
//         confirm current_stock AND the batch's own quantity both
//         genuinely decrement together.
//   (12b) low-stock alert firing from the Inventory page's own
//         perspective (cross-checking, not re-deriving, Section 11's
//         Blood Bank finding that reagent_inventory already drives the
//         notification bell's lowStock category) — including the
//         per-row ⚠️ highlight on the live Inventory table itself.
//   (12c) FEFO expiry ordering — with two batches of the same item at
//         different expiry dates plus one already-expired batch, confirm
//         dispensing draws from the earliest-EXPIRING non-expired batch
//         first and skips the expired one entirely.
//   (12d) wastage/discard log — reason-coded, mandatory notes, real audit
//         trail (who/when/why) — AND whether current_stock is actually
//         reconciled down afterward, comparing against the two paths that
//         ARE proven to keep it in sync (receive/dispense).
//   (12e) inter-department requisition/transfer workflow end-to-end:
//         pending -> approved (role-gated) -> fulfilled (real FEFO stock
//         movement) -> received (a genuinely different actor — the
//         original requester — closing the loop), plus the role gate
//         itself (a requester without decide-rights cannot approve their
//         own request).
//   (12f) role access — live ROLE_PAGES spot check for Inventory across
//         several roles, cross-referenced against CLAUDE.md/README's
//         documented role table.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function futureDate(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function pastDate(days) {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function initScript(seedOverrides) {
  const seed = {
    tables: {},
    users: [],
    idStart: { mrn: 500, opd: 200, ip: 100, lab_number: 300, radiology_number: 400 },
    ...seedOverrides,
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
  `;
}

async function loginAs(page, email, password) {
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.evaluate(() => { const b = document.getElementById('auth-btn'); if (b) { b.disabled = false; b.innerHTML = 'Sign In'; } });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', password);
  await page.click('#auth-btn');
  await page.waitForTimeout(400);
}

async function firstLoad(page, baseUrl, seedOverrides, email, password) {
  await page.addInitScript(initScript(seedOverrides));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await loginAs(page, email, password);
}

async function logoutAndLoginAs(page, email, password) {
  await page.evaluate(() => doLogout());
  await page.waitForTimeout(200);
  await loginAs(page, email, password);
}

// Direct-value workaround for fields inside .ov/.mo overlay modals, which
// consistently report a zero-size box to Playwright's actionability checks
// in this headless sandbox (confirmed environment quirk in prior sections,
// not an app bug).
async function setModalValue(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) throw new Error('setModalValue: no element #' + id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
}

async function lastToast(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('#toast-wrap .toast');
    return nodes.length ? nodes[nodes.length - 1].textContent : null;
  });
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // ═════════════════════════════════════════════════════════════════
  // 12a: golden path — add a catalog item (via the real form), see it
  // rendered live, then dispense via FEFO and confirm both current_stock
  // and the underlying batch quantity genuinely decrement together.
  // ═════════════════════════════════════════════════════════════════
  const page = await context.newPage();
  {
    const seed = {
      tables: {
        staff: [{ id: 's-lab', user_id: 'u-lab', full_name: 'Inv Lab Tech', role: 'lab_tech' }],
      },
      users: [{ id: 'u-lab', email: 'labtech@inv.local', password: 'whatever' }],
    };
    await firstLoad(page, baseUrl, seed, 'labtech@inv.local', 'whatever');
    await page.evaluate(() => goPage('inventory'));
    await page.waitForTimeout(200);

    await page.fill('#inv-name', 'CBC Reagent Kit');
    await page.selectOption('#inv-dept', 'Laboratory');
    await page.waitForTimeout(50);
    await page.fill('#inv-stock', '20');
    await page.fill('#inv-unit', 'kits');
    await page.fill('#inv-min', '5');
    await page.fill('#inv-lot', 'LOT-A1');
    await page.fill('#inv-expiry', futureDate(60));
    await page.evaluate(() => saveInventoryItem());
    await page.waitForTimeout(300);

    const items = await page.evaluate(async () => { const { data } = await sb.from('reagent_inventory').select('*'); return data; });
    const batches = await page.evaluate(async () => { const { data } = await sb.from('inventory_batches').select('*'); return data; });
    const item = items.find(i => i.item_name === 'CBC Reagent Kit');
    const batch = batches.find(b => b.item_id === item?.id);
    const savedOk = item && item.current_stock === 20 && item.min_level === 5 && item.department === 'Laboratory' &&
      batch && batch.quantity === 20 && batch.batch_no === 'LOT-A1';

    // The stateful mock does not apply Postgres column defaults (unlike a
    // real Supabase project, where `inventory_batches.is_active boolean
    // default true` makes an unset insert read back as true automatically
    // — the same category of gap Section 11 documented for
    // blood_units.verified_on_receipt). saveInventoryItem()'s auto-batch
    // insert (like receiveBatchStock()'s) never sets is_active explicitly,
    // relying entirely on that column default, so this single backfill
    // lets the REAL loadInventory()/dispenseFromInventoryFefo() code
    // (which both filter .eq('is_active',true)) be exercised faithfully,
    // rather than being a genuine app bug.
    if (batch) await page.evaluate((id) => sb.from('inventory_batches').update({ is_active: true }).eq('id', id), batch.id);

    await page.evaluate(() => loadInventory());
    await page.waitForTimeout(200);
    const tableHtml = await page.evaluate(() => document.getElementById('inv-table-body').innerHTML);
    const listedOk = tableHtml.includes('CBC Reagent Kit') && tableHtml.includes('20') && tableHtml.includes('Laboratory');

    // Dispense 8 via the real FEFO prompt() flow.
    page.once('dialog', async d => { await d.accept('8'); });
    await page.evaluate((id) => promptDispenseFefo(id), item.id);
    await page.waitForTimeout(300);

    const itemsAfter = await page.evaluate(async () => { const { data } = await sb.from('reagent_inventory').select('*'); return data; });
    const batchesAfter = await page.evaluate(async () => { const { data } = await sb.from('inventory_batches').select('*'); return data; });
    const itemAfter = itemsAfter.find(i => i.id === item.id);
    const batchAfter = batchesAfter.find(b => b.id === batch.id);
    const dispenseOk = itemAfter?.current_stock === 12 && batchAfter?.quantity === 12;

    await page.evaluate(() => loadInventory());
    await page.waitForTimeout(200);
    const tableAfterHtml = await page.evaluate(() => document.getElementById('inv-table-body').innerHTML);
    const tableReflectsOk = /\b12\s*kits\b/.test(tableAfterHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

    const ok = savedOk && listedOk && dispenseOk && tableReflectsOk;
    log('12a', ok ? 'PASS' : 'FAIL',
      `Logged in as Inv Lab Tech, filled the real "Add Inventory Item" form (CBC Reagent Kit, Laboratory dept, 20 kits, min 5, lot LOT-A1, expiry +60d) and clicked Save. A real reagent_inventory row was created (current_stock=${item?.current_stock}, min_level=${item?.min_level}) AND — because current_stock>0 on creation — a matching inventory_batches row was auto-seeded (qty=${batch?.quantity}, batch_no=${batch?.batch_no})=${savedOk}. It appeared correctly in the live Stock Catalog table=${listedOk}. Dispensing 8 kits via the real FEFO prompt (promptDispenseFefo -> dispenseFromInventoryFefo) decremented BOTH reagent_inventory.current_stock (20->${itemAfter?.current_stock}) AND the underlying batch's own quantity (20->${batchAfter?.quantity}) in lockstep=${dispenseOk}, and the live table re-rendered the new figure=${tableReflectsOk}.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 12b: low-stock alert — cross-checking Section 11's finding that
  // reagent_inventory drives the bell's lowStock category, now from the
  // Inventory page's OWN perspective too (per-row ⚠️ highlight using the
  // exact same current_stock<=min_level comparison).
  // ═════════════════════════════════════════════════════════════════
  {
    // Continue on the SAME page/session/DB as 12a — the item is now at
    // 12 kits with min_level 5 (not yet low). Dispense down to 4 (below
    // the threshold) and confirm both the bell and the page's own row
    // react together, live.
    const items = await page.evaluate(async () => { const { data } = await sb.from('reagent_inventory').select('*'); return data; });
    const item = items.find(i => i.item_name === 'CBC Reagent Kit');

    page.once('dialog', async d => { await d.accept('8'); }); // 12 -> 4, now <= min_level(5)
    await page.evaluate((id) => promptDispenseFefo(id), item.id);
    await page.waitForTimeout(300);
    await page.evaluate(() => loadInventory());
    await page.waitForTimeout(200);

    const rowHtml = await page.evaluate(() => document.getElementById('inv-table-body').innerHTML);
    const rowFlaggedOk = rowHtml.includes('pay-unpaid') && /4\s*kits\s*⚠️/.test(rowHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/>\s*</g, '><'));

    await page.evaluate(() => refreshNotifications());
    await page.waitForTimeout(300);
    const notifState = await page.evaluate(() => _notifState);
    const bellFlaggedOk = notifState.lowStock?.some(i => i.item_name === 'CBC Reagent Kit' && i.current_stock === 4);
    const bellCount = await page.evaluate(() => document.getElementById('notif-bell-count')?.textContent);
    const notifHtml = await page.evaluate(() => { toggleNotifPanel(); return document.getElementById('notif-list').innerHTML; });
    const bellPanelOk = notifHtml.includes('CBC Reagent Kit') && notifHtml.includes('Low Stock');
    await page.evaluate(() => toggleNotifPanel());

    const ok = rowFlaggedOk && bellFlaggedOk && bellPanelOk;
    log('12b', ok ? 'PASS' : 'FAIL',
      `Continuing the same session/DB from 12a, dispensed the same item down to 4 kits (min_level=5, now at/below reorder threshold). The Inventory page's OWN live Stock Catalog row picked it up immediately: red-highlighted row + "4 kits ⚠️"=${rowFlaggedOk}. refreshNotifications() (Section 11's finding: reagent_inventory items <=min_level feed the bell's lowStock category) independently picked up the SAME item via the SAME current_stock<=min_level comparison=${bellFlaggedOk} (bell count now "${bellCount}"), and it rendered in the notification panel itself under "Low Stock"=${bellPanelOk} — confirming the two surfaces (page row vs. bell) genuinely agree rather than one being stale.`);
  }
  await page.close();

  // ═════════════════════════════════════════════════════════════════
  // 12c: FEFO expiry ordering — earliest-expiring non-expired batch
  // consumed first; an already-expired batch is never touched.
  // ═════════════════════════════════════════════════════════════════
  {
    const page2 = await context.newPage();
    const itemId = 'i-fefo';
    const batches = [
      { id: 'b-expired', item_id: itemId, batch_no: 'OLD-EXPIRED', quantity: 10, expiry_date: pastDate(5), is_active: true, received_date: pastDate(90) },
      { id: 'b-soon', item_id: itemId, batch_no: 'SOON', quantity: 10, expiry_date: futureDate(10), is_active: true, received_date: pastDate(20) },
      { id: 'b-later', item_id: itemId, batch_no: 'LATER', quantity: 10, expiry_date: futureDate(120), is_active: true, received_date: pastDate(5) },
    ];
    await page2.addInitScript(initScript({
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'FEFO Tester', role: 'lab_tech' }],
        reagent_inventory: [{ id: itemId, item_name: 'Chemistry Control Kit', department: 'Laboratory', current_stock: 30, min_level: 5, unit: 'kits', is_active: true }],
        inventory_batches: batches,
      },
      users: [{ id: 'u1', email: 'fefo@inv.local', password: 'whatever' }],
    }));
    await page2.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page2, 'fefo@inv.local', 'whatever');
    await page2.evaluate(() => goPage('inventory'));
    await page2.waitForTimeout(200);

    // Dispense 15 — should fully drain 'b-soon' (10, expires soonest among
    // non-expired) then take 5 from 'b-later', and must NEVER touch
    // 'b-expired' even though it has stock.
    const { dispensed, shortfall } = await page2.evaluate((id) => dispenseFromInventoryFefo(id, 15), itemId);
    await page2.waitForTimeout(200);
    const batchesAfter = await page2.evaluate(async () => { const { data } = await sb.from('inventory_batches').select('*'); return data; });
    const bExpired = batchesAfter.find(b => b.id === 'b-expired');
    const bSoon = batchesAfter.find(b => b.id === 'b-soon');
    const bLater = batchesAfter.find(b => b.id === 'b-later');
    const item = await page2.evaluate(async () => { const { data } = await sb.from('reagent_inventory').select('*').eq('id', 'i-fefo').single(); return data; });

    const fefoOrderOk = bSoon.quantity === 0 && bLater.quantity === 5 && bExpired.quantity === 10;
    const stockOk = item.current_stock === 15; // 30 - 15
    const dispensedOk = dispensed === 15 && shortfall === 0;

    // Batch panel should still show the expired batch (visible, not
    // hidden) but with a locked/Expired badge, and the FEFO note.
    await page2.evaluate((id) => toggleInvBatches(id), itemId);
    await page2.waitForTimeout(150);
    const panelHtml = await page2.evaluate((id) => document.getElementById('inv-batches-row-' + id).innerHTML, itemId);
    const expiredVisibleOk = panelHtml.includes('OLD-EXPIRED') && /Expired/.test(panelHtml);

    const ok = fefoOrderOk && stockOk && dispensedOk && expiredVisibleOk;
    log('12c', ok ? 'PASS' : 'FAIL',
      `Seeded one item with 3 batches: an already-EXPIRED one (10 units, still with quantity>0), one expiring in 10 days (10 units), one expiring in 120 days (10 units). Dispensing 15 units via dispenseFromInventoryFefo() correctly drained the 10-day batch completely (10->${bSoon.quantity}) then took the remaining 5 from the 120-day batch (10->${bLater.quantity}), while the expired batch was never touched at all (10->${bExpired.quantity})=${fefoOrderOk}. Fully dispensed with no shortfall=${dispensedOk}, reagent_inventory.current_stock correctly reflects only the real 15 taken (30->${item.current_stock})=${stockOk}. The expired batch still shows in the Batches panel (visible for audit) but flagged Expired rather than being silently hidden or offered=${expiredVisibleOk}.`);
    await page2.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 12d: wastage/discard log — reason-coded, mandatory notes, real audit
  // trail; AND whether current_stock is reconciled afterward (comparing
  // against the two paths — receive/dispense — that ARE proven above to
  // keep current_stock and batch quantity in sync).
  // ═════════════════════════════════════════════════════════════════
  {
    const page3 = await context.newPage();
    const itemId = 'i-waste';
    await page3.addInitScript(initScript({
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Waste Tester', role: 'admin' }],
        reagent_inventory: [{ id: itemId, item_name: 'Glucose Strips', department: 'Laboratory', current_stock: 25, min_level: 5, unit: 'boxes', is_active: true }],
        inventory_batches: [{ id: 'b-waste', item_id: itemId, batch_no: 'BX-100', quantity: 25, expiry_date: futureDate(30), is_active: true, received_date: pastDate(10) }],
      },
      users: [{ id: 'u1', email: 'waste@inv.local', password: 'whatever' }],
    }));
    await page3.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page3, 'waste@inv.local', 'whatever');
    await page3.evaluate(() => goPage('inventory'));
    await page3.waitForTimeout(200);

    // No-silent-discard gate: try to submit with no reason code / no notes.
    await page3.evaluate((id) => openDiscardBatch('b-waste', id), itemId);
    await page3.waitForTimeout(100);
    await page3.evaluate(() => submitDiscardBatch());
    await page3.waitForTimeout(100);
    const blockedNoReason = await lastToast(page3);
    await setModalValue(page3, 'inv-discard-reason-code', 'Damaged');
    await page3.evaluate(() => submitDiscardBatch());
    await page3.waitForTimeout(100);
    const blockedNoNotes = await lastToast(page3);
    const gateOk = /reason code/i.test(blockedNoReason || '') && /required|no silent/i.test(blockedNoNotes || '');

    // Now supply both and actually discard.
    await setModalValue(page3, 'inv-discard-notes', 'Box found with 3 broken vials during routine stock check.');
    await page3.evaluate(() => submitDiscardBatch());
    await page3.waitForTimeout(200);

    const batchAfter = await page3.evaluate(async () => { const { data } = await sb.from('inventory_batches').select('*').eq('id', 'b-waste').single(); return data; });
    const itemAfter = await page3.evaluate(async () => { const { data } = await sb.from('reagent_inventory').select('*').eq('id', 'i-waste').single(); return data; });
    const auditTrailOk = batchAfter.is_active === false && batchAfter.discard_reason_code === 'Damaged' &&
      batchAfter.discard_notes?.includes('broken vials') && batchAfter.discarded_by_name === 'Waste Tester' && !!batchAfter.discarded_at;

    // The finding: does current_stock get reconciled down after a
    // discard, the way it correctly does after receive/dispense (proven
    // in 12a)? Expected per current code: NO — submitDiscardBatch() only
    // updates inventory_batches, never touches reagent_inventory.current_stock.
    const stockReconciled = itemAfter.current_stock === 0; // what it SHOULD be (25 discarded, nothing left)
    const staleStockBug = itemAfter.current_stock === 25 && !stockReconciled;

    const modalClosedOk = await page3.evaluate(() => !document.getElementById('inv-discard-ov').classList.contains('open'));
    await page3.evaluate(() => loadInventory());
    await page3.waitForTimeout(200);
    const catalogHtml = await page3.evaluate(() => document.getElementById('inv-table-body').innerHTML);
    // The item still shows in the catalog (current_stock untouched) even
    // though its only batch was just discarded / has 0 active batches.
    const catalogShowsStaleStock = /25\s*boxes/.test(catalogHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

    log('12d', gateOk && auditTrailOk ? (staleStockBug ? '⚠️ GAP FOUND' : 'PASS') : 'FAIL',
      `Reason-coded mandatory-notes discard gate: submitting with no reason code was rejected ("${blockedNoReason}"), submitting a reason but no notes was also rejected ("${blockedNoNotes}") — no silent discards=${gateOk}. Supplying both (Damaged, "Box found with 3 broken vials…") and confirming produced a real permanent audit trail on the batch: is_active=${batchAfter.is_active}, discard_reason_code=${batchAfter.discard_reason_code}, discard_notes recorded=${!!batchAfter.discard_notes}, discarded_by_name=${batchAfter.discarded_by_name}, discarded_at=${!!batchAfter.discarded_at}=${auditTrailOk}, modal closed after=${modalClosedOk}. BUG: unlike receiveBatchStock() and dispenseFromInventoryFefo() (both proven in 12a to keep reagent_inventory.current_stock and the batch's own quantity in lockstep), submitDiscardBatch() (index.html, function submitDiscardBatch) never writes to reagent_inventory at all — the item's whole 25-box batch was discarded but current_stock is still ${itemAfter.current_stock} (should be 0). The live Stock Catalog table still shows "25 boxes" in stock for an item with zero active batches left=${catalogShowsStaleStock}, and — because the same current_stock field feeds both the per-row low-stock highlight (12b) and the notification bell — a wastage discard can leave an actually-empty item looking fully stocked and silently suppress the low-stock alert that should have fired.`);
    await page3.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 12e: inter-department requisition/transfer workflow, end-to-end,
  // across three genuinely different real staff accounts on one shared
  // session/DB — pending -> approved (role-gated) -> fulfilled (real
  // FEFO stock movement) -> received (closed by the ORIGINAL requester).
  // ═════════════════════════════════════════════════════════════════
  {
    const page4 = await context.newPage();
    const itemId = 'i-req';
    const seed = {
      tables: {
        staff: [
          { id: 's-tech', user_id: 'u-tech', full_name: 'Requesting Tech', role: 'lab_tech' },
          { id: 's-sup', user_id: 'u-sup', full_name: 'Deciding Supervisor', role: 'lab_supervisor' },
        ],
        reagent_inventory: [{ id: itemId, item_name: 'IV Cannula 18G', department: 'General Medical & Nursing', current_stock: 50, min_level: 10, unit: 'pcs', is_active: true }],
        inventory_batches: [{ id: 'b-req', item_id: itemId, batch_no: 'IVC-1', quantity: 50, expiry_date: futureDate(200), is_active: true, received_date: pastDate(15) }],
      },
      users: [
        { id: 'u-tech', email: 'reqtech@inv.local', password: 'whatever' },
        { id: 'u-sup', email: 'reqsup@inv.local', password: 'whatever' },
      ],
    };
    await page4.addInitScript(initScript(seed));
    await page4.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page4, 'reqtech@inv.local', 'whatever');

    // --- Requesting Tech (lab_tech, no decide-rights) submits a requisition ---
    await page4.evaluate(() => goPage('inventory'));
    await page4.waitForTimeout(200);
    await page4.evaluate(() => switchInvTab('req', null));
    await page4.waitForTimeout(200);
    await page4.selectOption('#req-dept', 'ICU');
    await page4.selectOption('#req-item', itemId);
    await page4.fill('#req-qty', '12');
    await page4.fill('#req-notes', 'Restocking ICU crash cart');
    await page4.evaluate(() => submitStockRequisition());
    await page4.waitForTimeout(300);

    const reqs1 = await page4.evaluate(async () => { const { data } = await sb.from('stock_requisitions').select('*'); return data; });
    const req = reqs1[0];
    const submittedOk = req && req.requesting_department === 'ICU' && req.item_id === itemId && req.qty_requested === 12 && req.status === 'pending' && req.requested_by_name === 'Requesting Tech';

    // Bridge the stateful mock's naive embedded-select FK guess (it assumes
    // a "<singularized-relation>_id" column name -- "reagent_inventory_id"
    // -- for the "reagent_inventory(item_name,unit)" embed used by
    // loadStockRequisitions() below, but this schema's real FK column is
    // "item_id"). A real Supabase/PostgREST embed follows the actual
    // foreign key regardless of naming (same test-harness adaptation
    // Section 11 needed for blood_units -> blood_requests), not a real
    // schema mismatch in the app itself.
    await page4.evaluate(({ reqId, itemId }) => sb.from('stock_requisitions').update({ reagent_inventory_id: itemId }).eq('id', reqId), { reqId: req.id, itemId });

    // Role gate: as lab_tech (not admin/lab_supervisor), the requester
    // should NOT see Approve/Reject actions on their own pending request.
    await page4.evaluate(() => loadStockRequisitions());
    await page4.waitForTimeout(200);
    const techViewHtml = await page4.evaluate(() => document.getElementById('req-table-body').innerHTML);
    const techCannotDecide = techViewHtml.includes('IV Cannula 18G') && !techViewHtml.includes('Approve') && !techViewHtml.includes('Reject');

    // --- Deciding Supervisor (lab_supervisor, has decide-rights) approves, then fulfills ---
    await logoutAndLoginAs(page4, 'reqsup@inv.local', 'whatever');
    await page4.evaluate(() => goPage('inventory'));
    await page4.waitForTimeout(200);
    await page4.evaluate(() => switchInvTab('req', null));
    await page4.waitForTimeout(200);
    const supViewHtml = await page4.evaluate(() => document.getElementById('req-table-body').innerHTML);
    const supCanDecide = supViewHtml.includes('Approve') && supViewHtml.includes('Reject');

    await page4.evaluate((id) => decideRequisition(id, 'approved'), req.id);
    await page4.waitForTimeout(200);
    const reqApproved = await page4.evaluate(async (id) => { const { data } = await sb.from('stock_requisitions').select('*').eq('id', id).single(); return data; }, req.id);
    const approvedOk = reqApproved.status === 'approved' && reqApproved.decided_by_name === 'Deciding Supervisor' && !!reqApproved.decided_at;

    await page4.evaluate(() => loadStockRequisitions());
    await page4.waitForTimeout(200);
    await page4.evaluate((id) => fulfillRequisition(id), req.id);
    await page4.waitForTimeout(300);
    const reqFulfilled = await page4.evaluate(async (id) => { const { data } = await sb.from('stock_requisitions').select('*').eq('id', id).single(); return data; }, req.id);
    const itemAfterFulfill = await page4.evaluate(async (id) => { const { data } = await sb.from('reagent_inventory').select('*').eq('id', id).single(); return data; }, itemId);
    const batchAfterFulfill = await page4.evaluate(async () => { const { data } = await sb.from('inventory_batches').select('*').eq('id', 'b-req').single(); return data; });
    const fulfillOk = reqFulfilled.status === 'fulfilled' && itemAfterFulfill.current_stock === 38 && batchAfterFulfill.quantity === 38;

    // --- Requesting Tech logs back in and confirms receipt — closing the loop as a genuinely different actor ---
    await logoutAndLoginAs(page4, 'reqtech@inv.local', 'whatever');
    await page4.evaluate(() => goPage('inventory'));
    await page4.waitForTimeout(200);
    await page4.evaluate(() => switchInvTab('req', null));
    await page4.waitForTimeout(200);
    const techReceiptViewHtml = await page4.evaluate(() => document.getElementById('req-table-body').innerHTML);
    const techSeesConfirmReceipt = techReceiptViewHtml.includes('Confirm Receipt');
    await page4.evaluate((id) => confirmRequisitionReceipt(id), req.id);
    await page4.waitForTimeout(200);
    const reqReceived = await page4.evaluate(async (id) => { const { data } = await sb.from('stock_requisitions').select('*').eq('id', id).single(); return data; }, req.id);
    const receivedOk = reqReceived.status === 'received' && reqReceived.received_confirmed_by_name === 'Requesting Tech' && !!reqReceived.received_confirmed_at;

    const ok = submittedOk && techCannotDecide && supCanDecide && approvedOk && fulfillOk && techSeesConfirmReceipt && receivedOk;
    log('12e', ok ? 'PASS' : 'FAIL',
      `Full cross-role transfer cycle on one shared session/DB. Requesting Tech (lab_tech) submitted a real requisition (ICU, 12x IV Cannula 18G, "Restocking ICU crash cart") -> stock_requisitions row created status=pending=${submittedOk}; as a lab_tech (no decide-rights) they correctly could NOT see Approve/Reject on their own request=${techCannotDecide}. Logged out/in as Deciding Supervisor (lab_supervisor, HAS decide-rights) who correctly DOES see Approve/Reject=${supCanDecide}; approving set status=approved with decided_by/decided_at recorded=${approvedOk}. Fulfilling then ran the SAME real FEFO stock movement proven in 12a/12c: current_stock 50->${itemAfterFulfill.current_stock} and the source batch's own quantity 50->${batchAfterFulfill.quantity}, moving in lockstep=${fulfillOk}, requisition flipped to status=fulfilled. Logged back in as the ORIGINAL Requesting Tech — a genuinely different actor from whoever approved/fulfilled — who saw a "Confirm Receipt" action=${techSeesConfirmReceipt} and confirming it closed the loop: status=received, received_confirmed_by_name=${reqReceived.received_confirmed_by_name}=${receivedOk}. This is a real four-state gated workflow (pending/approved/fulfilled/received) with a genuine role gate and a genuine third-actor closing step, not just a status-string toggle.`);
    await page4.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 12f: role access — live ROLE_PAGES spot check across several roles,
  // cross-referenced against CLAUDE.md/README's documented role table.
  // ═════════════════════════════════════════════════════════════════
  {
    const roleSeed = {
      tables: { staff: [
        { id: 's-nurse', user_id: 'u-nurse', full_name: 'Role Nurse', role: 'nurse' },
        { id: 's-doc', user_id: 'u-doc', full_name: 'Role Doctor', role: 'doctor' },
        { id: 's-theatre', user_id: 'u-theatre', full_name: 'Role Theatre Nurse', role: 'theatre_nurse' },
        { id: 's-radio', user_id: 'u-radio', full_name: 'Role Radiologist', role: 'radiologist' },
        { id: 's-cash', user_id: 'u-cash', full_name: 'Role Cashier', role: 'cashier' },
        { id: 's-recep', user_id: 'u-recep', full_name: 'Role Receptionist', role: 'receptionist' },
      ] },
      users: [
        { id: 'u-nurse', email: 'rn@inv.local', password: 'whatever' },
        { id: 'u-doc', email: 'rd@inv.local', password: 'whatever' },
        { id: 'u-theatre', email: 'rt@inv.local', password: 'whatever' },
        { id: 'u-radio', email: 'rr@inv.local', password: 'whatever' },
        { id: 'u-cash', email: 'rc@inv.local', password: 'whatever' },
        { id: 'u-recep', email: 're@inv.local', password: 'whatever' },
      ],
    };
    const checkRole = async (email) => {
      const p = await context.newPage();
      await p.addInitScript(initScript(roleSeed));
      await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
      await loginAs(p, email, 'whatever');
      const visible = await p.evaluate(() => visibleModulesForRole().includes('inventory'));
      await p.evaluate(() => goPage('inventory'));
      await p.waitForTimeout(150);
      const entered = await p.evaluate(() => document.getElementById('page-inventory')?.classList.contains('active'));
      await p.close();
      return { visible, entered };
    };

    const nurse = await checkRole('rn@inv.local');
    const doctor = await checkRole('rd@inv.local');
    const theatreNurse = await checkRole('rt@inv.local');
    const radiologist = await checkRole('rr@inv.local');
    const cashier = await checkRole('rc@inv.local');
    const receptionist = await checkRole('re@inv.local');

    // Live ROLE_PAGES grants (confirmed by direct exercise above): admin,
    // nurse, lab_tech, lab_supervisor, theatre_nurse, radiologist all get
    // 'inventory'; doctor, cashier, receptionist do not.
    const liveGrantsMatchCode = nurse.visible && nurse.entered && theatreNurse.visible && theatreNurse.entered &&
      radiologist.visible && radiologist.entered && !doctor.visible && !doctor.entered &&
      !cashier.visible && !cashier.entered && !receptionist.visible && !receptionist.entered;

    // CLAUDE.md's "Roles and page access" table (mirroring README.md) lists
    // Inventory ONLY for Lab Tech (and, via "All Lab Tech +", implicitly
    // Lab Supervisor). It does NOT list Inventory for Nurse, Theatre Nurse,
    // or Radiologist — yet ROLE_PAGES genuinely grants it to all three,
    // confirmed live above.
    const docTableGapConfirmed = nurse.visible && theatreNurse.visible && radiologist.visible;

    log('12f', liveGrantsMatchCode ? (docTableGapConfirmed ? '⚠️ DOC GAP' : 'PASS') : 'FAIL',
      `Live ROLE_PAGES spot check, each role on its own fresh page/session: Nurse sees+enters Inventory (visible=${nurse.visible}, entered=${nurse.entered}); Theatre Nurse sees+enters it (visible=${theatreNurse.visible}, entered=${theatreNurse.entered}); Radiologist sees+enters it (visible=${radiologist.visible}, entered=${radiologist.entered}); Doctor is correctly hidden from and blocked from it (visible=${doctor.visible}, entered=${doctor.entered}); Cashier likewise blocked (visible=${cashier.visible}, entered=${cashier.entered}); Receptionist likewise blocked (visible=${receptionist.visible}, entered=${receptionist.entered}) — all match ROLE_PAGES in index.html exactly=${liveGrantsMatchCode}. DOCUMENTATION GAP (not a code bug, same pattern Section 11 found for Blood Bank): CLAUDE.md's "Roles and page access" table lists Inventory only under Lab Tech — it has no Inventory entry for Nurse, Theatre Nurse, or Radiologist at all, yet all three genuinely have live access confirmed above=${docTableGapConfirmed}. CLAUDE.md explicitly states "This table must stay in sync with ROLE_PAGES in index.html" — Inventory access for these three roles has been out of sync with that table.`);
  }

  return findings;
};
