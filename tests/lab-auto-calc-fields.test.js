// Covers three confirmed auto-calculated-field bugs found during real
// clinical use, plus the regression they cause:
//   1. eGFR never populated (no calcEgfr() existed at all) -- blocked
//      Verify/Release on every RFT order, since RESULT_TAGS.chem.egfr
//      tags it required and checkVerificationComplete() can never see a
//      value that's never written.
//   2. Globulin / A-G Ratio -- calcGlobAG() existed but was only ever
//      called once at Chemistry page load; Total Protein's and Albumin's
//      own oninput handlers never called it (a duplicate, equivalent
//      calculation had been living inline inside flagChem() instead --
//      consolidated into the single calcGlobAG() function as part of this
//      fix so there is exactly one place this logic lives).
//   3. Absolute Differential Counts -- calcAbsCounts() was wired to all
//      five % differential fields but NOT to WBC's own oninput, even
//      though it reads WBC to compute every absolute count, so entering
//      WBC after the percentages left stale/wrong absolutes on screen.
//
// Exercised through real DOM .fill()+dispatchEvent (not direct .value
// writes bypassing oninput, which is how earlier lab-safety tests are
// written) since these bugs are specifically about oninput wiring.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(pt) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { upserts: [] };
    const pt = ${JSON.stringify(pt)};
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'lab_tech' }, []);
        if (table === 'patients') { const c = chainable(pt, []); c.select = () => c; c.eq = () => c; return c; }
        if (table === 'results_hematology' || table === 'results_chemistry') {
          const c = chainable(null, []);
          c.select = () => c; c.eq = () => c;
          c.upsert = (payload) => { window.__mock.upserts.push(payload); return Promise.resolve({ data: [payload], error: null }); };
          return c;
        }
        if (table === 'sample_records') return chainable(null, []);
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
  const t = makeSuite('lab-auto-calc-fields');

  // ═══════════════════════════════════════════════════════════════════
  // 1. eGFR (2021 CKD-EPI race-free creatinine equation)
  // ═══════════════════════════════════════════════════════════════════
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ id: 'p1', age: 50, age_unit: 'Years', sex: 'Male', tests_requested: ['RFT (Renal Function)'], payment_status: 'paid' }));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Adult Male'));
    await page.waitForTimeout(200);
    await page.fill('#ce-creat', '106');
    await page.dispatchEvent('#ce-creat', 'input');
    await page.waitForTimeout(50);
    const egfr = await page.evaluate(() => ({ value: document.getElementById('ce-egfr').value, readOnly: document.getElementById('ce-egfr').readOnly }));
    const scr = 106 / 88.4;
    const expected = Math.round(142 * Math.pow(scr / 0.9, -1.2) * Math.pow(0.9938, 50));
    t.check('calcEgfr() computes the correct 2021 CKD-EPI value for an adult male (Scr>0.9 branch)', Number(egfr.value) === expected);
    t.check('ce-egfr stays readonly once auto-calc succeeds (no silent manual overwrite)', egfr.readOnly === true);
    await page.close();
  }
  {
    // Female, Scr<=0.7 branch, to prove both sex/branch pairs are wired correctly.
    const page = await context.newPage();
    await page.addInitScript(initScript({ id: 'p1', age: 35, age_unit: 'Years', sex: 'Female', tests_requested: ['RFT (Renal Function)'], payment_status: 'paid' }));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Adult Female'));
    await page.waitForTimeout(200);
    await page.fill('#ce-creat', '53'); // 53/88.4 = 0.5995 <= 0.7
    await page.dispatchEvent('#ce-creat', 'input');
    await page.waitForTimeout(50);
    const egfrVal = await page.evaluate(() => Number(document.getElementById('ce-egfr').value));
    const scr = 53 / 88.4;
    const expected = Math.round(142 * Math.pow(scr / 0.7, -0.241) * Math.pow(0.9938, 35) * 1.012);
    t.check('calcEgfr() computes correctly for an adult female (Scr<=0.7 branch)', egfrVal === expected);
    await page.close();
  }
  {
    // Pediatric patient -- CKD-EPI adult equation must not apply; field must
    // stay blank AND become editable so RFT is never permanently unverifiable.
    const page = await context.newPage();
    await page.addInitScript(initScript({ id: 'p1', age: 8, age_unit: 'Years', sex: 'Male', tests_requested: ['RFT (Renal Function)'], payment_status: 'paid' }));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Child'));
    await page.waitForTimeout(200);
    await page.fill('#ce-creat', '40');
    await page.dispatchEvent('#ce-creat', 'input');
    await page.waitForTimeout(50);
    const egfr = await page.evaluate(() => ({ value: document.getElementById('ce-egfr').value, readOnly: document.getElementById('ce-egfr').readOnly }));
    t.check('a pediatric patient (age<18) gets no auto-calculated eGFR', egfr.value === '');
    t.check('the field becomes editable instead of a permanent block', egfr.readOnly === false);
    await page.fill('#ce-egfr', '95');
    const manualVal = await page.evaluate(() => document.getElementById('ce-egfr').value);
    t.check('a tech can still manually enter eGFR for a pediatric patient', manualVal === '95');
    await page.close();
  }
  {
    // End-to-end: eGFR auto-populating actually unblocks RFT Verify.
    const page = await context.newPage();
    await page.addInitScript(initScript({ id: 'p1', age: 50, age_unit: 'Years', sex: 'Male', tests_requested: ['RFT (Renal Function)'], payment_status: 'paid' }));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Adult Male'));
    await page.waitForTimeout(200);
    await page.fill('#ce-creat', '80');
    await page.dispatchEvent('#ce-creat', 'input');
    await page.fill('#ce-urea', '5');
    await page.fill('#ce-ua', '0.3');
    await page.evaluate(() => { document.getElementById('ce-date').value = today(); });
    await page.evaluate(() => saveChemEntry(true));
    await page.waitForTimeout(150);
    const upsert = await page.evaluate(() => window.__mock.upserts[window.__mock.upserts.length - 1]);
    t.check('RFT Verify now succeeds once creatinine is entered (eGFR auto-populated, was permanently blocked before this fix)', upsert?.is_verified === true);
    t.check('the saved payload carries the auto-calculated egfr value', upsert?.egfr > 0);
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. Globulin / A-G Ratio -- live update regardless of entry order
  // ═══════════════════════════════════════════════════════════════════
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ id: 'p1', age: 40, age_unit: 'Years', sex: 'Female', tests_requested: ['LFT (Liver Function)'], payment_status: 'paid' }));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Glob Patient'));
    await page.waitForTimeout(200);
    await page.fill('#ce-tp', '70');
    await page.dispatchEvent('#ce-tp', 'input');
    await page.waitForTimeout(30);
    const globAfterTpOnly = await page.evaluate(() => document.getElementById('ce-glob').value);
    t.check('Globulin stays unset until both TP and Albumin are on file', globAfterTpOnly === '');
    await page.fill('#ce-alb', '40');
    await page.dispatchEvent('#ce-alb', 'input');
    await page.waitForTimeout(30);
    const glob = await page.evaluate(() => document.getElementById('ce-glob').value);
    const ag = await page.evaluate(() => document.getElementById('ce-ag').value);
    t.check('Globulin updates live immediately after Albumin is typed (was: only recalculated on page load)', glob === '30.0');
    t.check('A/G Ratio updates live in the same keystroke', ag === '1.33');
    await page.close();
  }
  {
    // Reverse entry order -- Albumin first, then TP -- must also work.
    const page = await context.newPage();
    await page.addInitScript(initScript({ id: 'p1', age: 40, age_unit: 'Years', sex: 'Male', tests_requested: ['LFT (Liver Function)'], payment_status: 'paid' }));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Glob Patient 2'));
    await page.waitForTimeout(200);
    await page.fill('#ce-alb', '45');
    await page.dispatchEvent('#ce-alb', 'input');
    await page.fill('#ce-tp', '75');
    await page.dispatchEvent('#ce-tp', 'input');
    await page.waitForTimeout(30);
    const glob = await page.evaluate(() => document.getElementById('ce-glob').value);
    t.check('Globulin also updates correctly when Albumin is entered before Total Protein', glob === '30.0');
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. Absolute Differential Counts -- WBC entered LAST still triggers
  //    recalculation (was: only wired to the five % fields)
  // ═══════════════════════════════════════════════════════════════════
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ id: 'p1', age: 30, age_unit: 'Years', sex: 'Male', tests_requested: ['CBC (Full Blood Count)'], payment_status: 'paid' }));
    await login(page, baseUrl);
    await page.evaluate(() => openUnifiedResultsEntry('p1', 'L1', 'Abs Patient'));
    await page.waitForTimeout(200);
    await page.fill('#he-neut', '60');
    await page.dispatchEvent('#he-neut', 'input');
    await page.waitForTimeout(30);
    const absBeforeWbc = await page.evaluate(() => document.getElementById('he-neut-abs').value);
    t.check('the absolute count stays unset while WBC is still unknown', absBeforeWbc === '');
    await page.fill('#he-wbc', '8');
    await page.dispatchEvent('#he-wbc', 'input');
    await page.waitForTimeout(30);
    const absAfterWbc = await page.evaluate(() => document.getElementById('he-neut-abs').value);
    t.check('entering WBC LAST now correctly (re)triggers the absolute-count calculation (was stale/blank before this fix)', absAfterWbc === '4.80');
    await page.close();
  }

  return t;
};
