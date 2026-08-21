// Covers a live-reported bug: registering a patient routed to Doctor
// showed Consultation Fee not pricing correctly. Live investigation (see
// the fix commit) found the real cause: buildAutoInvoiceLines()'s
// doctor-specialty-routing fee resolution (migration_v2.50) treated an
// UNCONFIGURED Settings default (CFG.feeGP/feeSpecialist/feeConsultant)
// as a real fee of 0 SDG, because both the getter and saveSettings()
// coerce a blank field straight to 0 -- there's no way to distinguish
// "never configured" from "admin typed 0". The invoice line rendered as
// fully priced, charging nothing, silently bypassing the price_list
// "Consultation Fee" entry that should have been the fallback.
//
// This drives the REAL Registration UI end-to-end (goPage, doctor
// dropdown, destination toggle) through buildRegInvoicePreview() -- the
// same function wired to the live invoice preview panel -- for the exact
// scenario a fresh/real deployment is in: Settings' consultation-fee
// defaults never touched, no per-doctor override set.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(opts) {
  const priceRows = [
    { code: 'CON000', name: 'Consultation Fee', category: 'consultation', price: 500, currency: 'SDG' },
    { code: 'REG001', name: 'Registration Fee', category: 'registration', price: 500, currency: 'SDG' },
  ];
  const doctorRows = [
    { id: 'doc-1', name: 'Dr. Amina Hassan', specialty: 'Internal Medicine', doctor_type: 'GP', consultation_fee: opts.doctorFee ?? null },
  ];
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const priceRows = ${JSON.stringify(priceRows)};
    const doctorRows = ${JSON.stringify(doctorRows)};
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Reception Test', role:'receptionist' }, []);
        if (table === 'price_list') { const c = chainable(null, priceRows); c.select = () => c; c.in = () => c; c.eq = () => c; return c; }
        if (table === 'doctors') { const c = chainable(doctorRows[0], doctorRows); c.select = () => c; c.eq = () => c; c.order = () => c; c.maybeSingle = () => Promise.resolve({ data: doctorRows[0], error: null }); return c; }
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
  await page.fill('#auth-email', 'reception@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('registration-consultation-fee-zero-charge');

  // --- Real-world default: Settings consultation-fee defaults never touched, no per-doctor override ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({}));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(300);

    await page.evaluate(async () => { await populateDoctorDropdown(); });
    await page.evaluate(() => {
      const sel = document.getElementById('r-doc');
      const opt = [...sel.options].find(o => o.value === 'Dr. Amina Hassan');
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(() => setDest('doctor'));
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => ({
      linesHtml: document.getElementById('reg-inv-lines')?.innerHTML || '',
      totalText: document.getElementById('reg-inv-total')?.textContent || '',
    }));
    t.check('Consultation Fee line appears in the registration invoice preview', result.linesHtml.includes('Consultation Fee'));
    t.check('it shows the real price_list price (500), not "⚠ Price not set"', result.linesHtml.includes('500.00 SDG') && !result.linesHtml.includes('Price not set'));
    // "500.00 SDG" would (correctly) contain "0.00 SDG" as a substring, so
    // check the exact Consultation Fee row's own amount, not the whole panel.
    const consultRowMatch = /Consultation Fee<\/span><span[^>]*>([\d.,]+) SDG/.exec(result.linesHtml);
    t.check('it is NOT silently charged as 0.00 SDG', consultRowMatch?.[1] === '500.00');
    t.check('the invoice total includes the consultation fee (500 + 500 registration = 1000)', result.totalText.includes('1000.00'));
    await page.close();
  }

  // --- Regression check: an explicit per-doctor override still takes priority ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ doctorFee: 3500 }));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(300);
    await page.evaluate(async () => { await populateDoctorDropdown(); });
    await page.evaluate(() => {
      const sel = document.getElementById('r-doc');
      const opt = [...sel.options].find(o => o.value === 'Dr. Amina Hassan');
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(() => setDest('doctor'));
    await page.waitForTimeout(200);
    const linesHtml = await page.evaluate(() => document.getElementById('reg-inv-lines')?.innerHTML || '');
    t.check('an explicit per-doctor consultation_fee (3500) still overrides the price_list default', linesHtml.includes('3,500.00 SDG') || linesHtml.includes('3500.00 SDG'));
    await page.close();
  }

  return t;
};
