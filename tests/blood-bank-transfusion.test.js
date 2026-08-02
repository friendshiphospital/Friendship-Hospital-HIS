// Covers Blood Bank Phase 5: transfusion administration & reaction
// reporting. Vitals before/during/after are recorded through the
// EXISTING Nursing vitals form (deep-link, not a rebuilt form) — this
// suite checks the tag round-trips into saveVitals()'s actual insert
// payload. Reaction reporting reuses the existing Critical Values table/
// alert pipeline. Discard requires a mandatory reason code — no silent
// removals.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

const ISSUED_UNIT = { id: 'u1', unit_no: 'BB-26-0009', blood_group: 'A', rh_factor: 'Positive', component_type: 'Packed RBC', status: 'Issued', request_id: 'r1', blood_requests: { patient_id: 'p1' } };
const PATIENT = { id: 'p1', name: 'Transfused Patient', mrn: 'M999' };

function initScript(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { txInsert: null, txUpdate: null, criticalInsert: null, unitUpdate: null, vitalsInsert: null };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        // admin bypasses the ROLE_PAGES gate entirely — Blood Bank's role
        // grants are Phase 6's job (not yet wired), and TEST 1 below needs
        // goPage('bloodbank') to actually activate the page and run
        // loadBloodUnits(), not just leave the static markup in place.
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Nurse Test', role: 'admin' }, []);
        if (table === 'blood_units') {
          const c = chainable(${JSON.stringify(ISSUED_UNIT)}, [${JSON.stringify(ISSUED_UNIT)}]);
          c.update = (payload) => ({ eq: () => { window.__mock.unitUpdate = payload; return Promise.resolve({data:null,error:null}); } });
          return c;
        }
        if (table === 'patients') return chainable(${JSON.stringify(PATIENT)}, []);
        if (table === 'blood_transfusions') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.txInsert = payload; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'tx1', ...payload }, error: null }) }) }; };
          c.update = (payload) => ({ eq: () => { window.__mock.txUpdate = payload; return Promise.resolve({data:null,error:null}); } });
          return c;
        }
        if (table === 'vital_signs') return chainable(null, []);
        if (table === 'critical_values') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.criticalInsert = payload; return Promise.resolve({ data: [payload], error: null }); };
          return c;
        }
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
  await page.fill('#auth-email', 'nurse@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('blood-bank-transfusion');

  // --- TEST 1: an Issued unit shows a Transfusion action; opening it shows a Start Transfusion control ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(400);
    const html = await page.evaluate(() => document.getElementById('bb-units-body').innerHTML);
    t.check('an Issued unit shows a Transfusion action button', html.includes('Transfusion'));
    t.check('an Issued unit does NOT show a Discard action (already left inventory)', !html.includes('openDiscardUnit'));
    await page.evaluate(() => openTransfusionRecord('u1'));
    await page.waitForTimeout(150);
    const controls = await page.evaluate(() => document.getElementById('bb-tx-controls').innerHTML);
    t.check('no transfusion started yet -> shows Start Transfusion', controls.includes('Start Transfusion'));
    await page.close();
  }

  // --- TEST 2: starting a transfusion creates a blood_transfusions row and switches controls to Stop + Report Reaction ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(200);
    await page.evaluate(() => openTransfusionRecord('u1'));
    await page.waitForTimeout(150);
    await page.evaluate(() => startTransfusion());
    await page.waitForTimeout(150);
    const mock = await page.evaluate(() => window.__mock);
    t.check('starting a transfusion inserts a blood_transfusions row (In Progress)', mock.txInsert?.status === 'In Progress' && mock.txInsert?.unit_id === 'u1' && mock.txInsert?.patient_id === 'p1');
    const controls = await page.evaluate(() => document.getElementById('bb-tx-controls').innerHTML);
    t.check('once started, the Stop Transfusion control appears', controls.includes('Stop Transfusion'));
    const reactionVisible = await page.evaluate(() => document.getElementById('bb-tx-reaction-btn').style.display !== 'none');
    t.check('the Report Adverse Reaction action becomes available once in progress', reactionVisible);
    await page.close();
  }

  // --- TEST 3: "Record Vitals" for a stage tags window._transfusionTag and deep-links into the EXISTING Nursing vitals form ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(200);
    await page.evaluate(() => openTransfusionRecord('u1'));
    await page.waitForTimeout(150);
    await page.evaluate(() => startTransfusion());
    await page.waitForTimeout(150);
    await page.evaluate(() => tagAndGoToVitals('Before'));
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({
      onNursing: document.getElementById('page-nursing')?.classList.contains('active'),
      tag: window._transfusionTag,
      bannerVisible: document.getElementById('vs-transfusion-tag-banner').style.display !== 'none',
      bannerText: document.getElementById('vs-transfusion-tag-stage').textContent,
    }));
    t.check('deep-links to the Nursing page (the existing vitals form, not a new one)', state.onNursing);
    t.check('tags window._transfusionTag with the transfusion id and stage', state.tag?.id === 'tx1' && state.tag?.stage === 'Before');
    t.check('the Vitals form shows a visible banner that this reading will be tagged', state.bannerVisible && state.bannerText === 'Before');
    await page.close();
  }

  // --- TEST 4: saving vitals while tagged includes transfusion_id/transfusion_stage in the actual insert, then clears the tag ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      ${initScript()}
    `);
    await login(page, baseUrl);
    // Re-wire vital_signs insert to capture the payload via dbWrite (dbWrite calls sb.from(table).insert(...) on success).
    await page.evaluate(() => {
      const origFrom = sb.from.bind(sb);
      sb.from = (table) => {
        if (table === 'vital_signs') {
          const c = origFrom(table);
          // dbWrite() calls .insert(payload).select() — the mock must return
          // something with a .select() method, not a bare Promise.
          c.insert = (payload) => { window.__mock.vitalsInsert = payload; return { select: () => Promise.resolve({ data: [payload], error: null }) }; };
          return c;
        }
        return origFrom(table);
      };
    });
    await page.evaluate(() => {
      _vsPt = { id: 'p1', name: 'Transfused Patient' };
      window._transfusionTag = { id: 'tx1', stage: 'During' };
      document.getElementById('vs-by').value = 'Nurse Test';
    });
    await page.evaluate(() => saveVitals());
    await page.waitForTimeout(200);
    const insert = await page.evaluate(() => window.__mock.vitalsInsert);
    t.check('the saved vitals row carries the transfusion tag', insert?.transfusion_id === 'tx1' && insert?.transfusion_stage === 'During');
    const tagCleared = await page.evaluate(() => window._transfusionTag === null);
    t.check('the tag is cleared after a successful save, so the next ordinary reading is untagged', tagCleared);
    await page.close();
  }

  // --- TEST 5: reporting a reaction writes into the EXISTING critical_values table (reusing the alert pipeline, not a new one) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(200);
    await page.evaluate(() => openTransfusionRecord('u1'));
    await page.waitForTimeout(150);
    await page.evaluate(() => startTransfusion());
    await page.waitForTimeout(150);
    await page.evaluate(() => openReactionReport());
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      document.getElementById('bb-reaction-type').value = 'Anaphylactic';
      document.getElementById('bb-reaction-severity').value = 'Severe';
      document.getElementById('bb-reaction-desc').value = 'Stopped transfusion immediately, called rapid response.';
    });
    await page.evaluate(() => submitTransfusionReaction());
    await page.waitForTimeout(150);
    const mock = await page.evaluate(() => window.__mock);
    t.check('the reaction is inserted into critical_values, not a separate table', mock.criticalInsert?.department === 'Blood Bank' && mock.criticalInsert?.parameter.includes('Anaphylactic'));
    t.check('it starts unacknowledged, same as any other critical value', mock.criticalInsert?.is_acknowledged === false);
    t.check('the transfusion record is marked Reaction Reported', mock.txUpdate?.status === 'Reaction Reported');
    await page.close();
  }

  // --- TEST 6: discarding a unit requires a reason code and details — no silent removals ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(200);
    // openDiscardUnit reads from the _bbUnits in-memory list populated by loadBloodUnits().
    await page.evaluate(() => openDiscardUnit('u1'));
    await page.waitForTimeout(100);
    await page.evaluate(() => submitDiscardUnit());
    await page.waitForTimeout(100);
    const blockedNoReason = await page.evaluate(() => window.__mock.unitUpdate);
    t.check('discarding without a reason code is blocked', blockedNoReason === null);
    await page.evaluate(() => { document.getElementById('bb-discard-reason-code').value = 'Damaged'; });
    await page.evaluate(() => submitDiscardUnit());
    await page.waitForTimeout(100);
    const blockedNoNotes = await page.evaluate(() => window.__mock.unitUpdate);
    t.check('discarding without details/notes is also blocked (reason code alone is not enough)', blockedNoNotes === null);
    await page.evaluate(() => { document.getElementById('bb-discard-notes').value = 'Bag found leaking on inspection.'; });
    await page.evaluate(() => submitDiscardUnit());
    await page.waitForTimeout(150);
    const update = await page.evaluate(() => window.__mock.unitUpdate);
    t.check('a valid discard sets status Discarded with the reason code and who/when', update?.status === 'Discarded' && update?.discard_reason_code === 'Damaged' && !!update?.discarded_by_name && !!update?.discarded_at);
    await page.close();
  }

  return t;
};
