// Covers a live-reported requirement: "any patient not paid or waiver or
// insurance should not allowed to release result in lab or report in
// radiology or from any department only after billing complete even sick
// leave or referral everything". Previously nothing checked payment status
// at the RELEASE/finalization point at all -- checkPaymentGate() only ever
// guarded ORDER submission, so once an order was placed (or chargeForNewOrder
// flipped payment_status back to unpaid for a fresh, unbilled order), lab
// results, radiology reports, sick leave certificates, and referral letters
// could all still be released/printed with an outstanding balance. A
// legitimate STAT payment deferral (already tracked and already resurfaced
// via the notification bell) must still be allowed through -- it is not a
// bypass, it is the intended deferred-billing path.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(pt, sampleDeferred, radDeferred) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { released: false, radReported: false };
    const pt = ${JSON.stringify(pt)};
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'lab_tech' }, []);
        if (table === 'patients') {
          const c = chainable(pt, []);
          c.select = () => c; c.eq = () => c;
          return c;
        }
        if (table === 'sample_records') {
          const c = chainable({ payment_deferred: ${sampleDeferred} }, []);
          c.select = () => c; c.eq = () => c;
          c.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
          return c;
        }
        if (table === 'results_hematology') {
          const c = chainable({ is_verified: true }, []);
          c.select = () => c; c.eq = () => c; c.order = () => c; c.limit = () => c;
          c.update = (payload) => { window.__mock.released = true; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
        if (table === 'radiology_requests') {
          const c = chainable({ patient_id: pt.id, payment_deferred: ${radDeferred} }, []);
          c.select = () => c; c.eq = () => c;
          c.update = (payload) => { window.__mock.radReported = true; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
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
  await page.fill('#auth-email', 'labtech@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('billing-release-gate');

  // --- releaseResults(): unpaid, not deferred -> blocked ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ id:'p1', name:'Unpaid Patient', payment_status:'unpaid' }, false, false));
    await login(page, baseUrl);
    await page.evaluate(() => { const el = document.getElementById('hem-entry-pt-id'); if (el) el.value = 'p1'; });
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(200);
    t.check('releaseResults() is blocked for an unpaid, non-deferred patient', await page.evaluate(() => window.__mock.released === false));
    await page.close();
  }

  // --- releaseResults(): unpaid but STAT-deferred -> allowed (deferral is not a bypass to re-block) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ id:'p2', name:'Deferred Patient', payment_status:'unpaid' }, true, false));
    await login(page, baseUrl);
    await page.evaluate(() => { const el = document.getElementById('hem-entry-pt-id'); if (el) el.value = 'p2'; });
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(200);
    t.check('releaseResults() still proceeds for a legitimately STAT-deferred order', await page.evaluate(() => window.__mock.released === true));
    await page.close();
  }

  // --- releaseResults(): paid -> allowed ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ id:'p3', name:'Paid Patient', payment_status:'paid' }, false, false));
    await login(page, baseUrl);
    await page.evaluate(() => { const el = document.getElementById('hem-entry-pt-id'); if (el) el.value = 'p3'; });
    await page.evaluate(() => releaseResults('hem'));
    await page.waitForTimeout(200);
    t.check('releaseResults() proceeds normally for a paid patient', await page.evaluate(() => window.__mock.released === true));
    await page.close();
  }

  // --- saveRadReport(): unpaid, non-critical -> blocked ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ id:'p4', name:'Unpaid Rad Patient', payment_status:'unpaid' }, false, false));
    await login(page, baseUrl);
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('rad-rep-id', 'req1'); set('rad-rep-impression', 'Normal study');
    });
    await page.evaluate(() => saveRadReport());
    await page.waitForTimeout(200);
    t.check('saveRadReport() is blocked for an unpaid patient on a routine (non-critical) report', await page.evaluate(() => window.__mock.radReported === false));
    await page.close();
  }

  // --- printSickLeave() / printReferral(): unpaid -> blocked (no window.open) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ id:'p5', name:'Unpaid Doc Patient', payment_status:'unpaid' }, false, false));
    await login(page, baseUrl);
    await page.evaluate(() => { window.__mock.printOpened = false; window.openPrintWin = () => { window.__mock.printOpened = true; }; });
    await page.evaluate(() => { _docPt = { id:'p5', name:'Unpaid Doc Patient', payment_status:'unpaid' }; });
    await page.evaluate(() => printSickLeave());
    t.check('printSickLeave() is blocked for an unpaid patient', await page.evaluate(() => window.__mock.printOpened === false));
    await page.evaluate(() => printReferral());
    t.check('printReferral() is blocked for an unpaid patient', await page.evaluate(() => window.__mock.printOpened === false));
    await page.close();
  }

  // --- printSickLeave(): waived -> allowed ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ id:'p6', name:'Waived Doc Patient', payment_status:'waived' }, false, false));
    await login(page, baseUrl);
    await page.evaluate(() => { window.__mock.printOpened = false; window.openPrintWin = () => { window.__mock.printOpened = true; }; });
    await page.evaluate(() => { _docPt = { id:'p6', name:'Waived Doc Patient', payment_status:'waived' }; });
    await page.evaluate(() => printSickLeave());
    t.check('printSickLeave() proceeds for a waived patient', await page.evaluate(() => window.__mock.printOpened === true));
    await page.close();
  }

  return t;
};
