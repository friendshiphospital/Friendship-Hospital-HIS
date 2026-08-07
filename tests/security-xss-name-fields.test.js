// Regression test for the CodeQL "DOM text reinterpreted as HTML" fix
// (index.html:8122 buildLabPtBanner/printHeader/printFooter, :13857
// openSampleLabelWindow) plus two related, not-CodeQL-flagged locations
// found during the same pass (Lab Worklist, Nursing Queue). Uses the same
// payload as the original live finding, confirming it renders as literal
// text everywhere it's now escaped, never as live markup.
const XSS_PAYLOAD = '<img src="x" onerror="stealCookies()" />';
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    localStorage.setItem('cfg_phone', window.__xssPayload);
    localStorage.setItem('cfg_email', window.__xssPayload);
    localStorage.setItem('cfg_footer', window.__xssPayload);
    localStorage.setItem('fh_label_settings', JSON.stringify({width:window.__xssPayload, height:29, barcodeType:'CODE128'}));
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Audit Admin', role:'admin' }, []);
        ${extra || ''}
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function login(page, baseUrl, extra) {
  // Hand the payload to the page as a real Playwright-serialized argument
  // (window.__xssPayload) rather than string-interpolating it into
  // generated JS source below — avoids ever building executable code from
  // untrusted-looking text, even though JSON.stringify() was already a
  // correct, safe serialization for that purpose.
  await page.addInitScript((payload) => { window.__xssPayload = payload; }, XSS_PAYLOAD);
  await page.addInitScript(initScript(extra));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'admin@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

// True positive check: confirm the popup's rendered DOM has NO actual <img>
// element (i.e. the payload never became live markup) and that the raw
// payload string is still present somewhere as literal text/escaped source.
async function assertPayloadIsInert(t, label, popup) {
  const imgCount = await popup.evaluate(() => document.querySelectorAll('img').length);
  const html = await popup.content();
  t.check(label + ': no live <img> element was created from the payload', imgCount === 0);
  // popup.content() is the browser's own re-serialized DOM, not the raw
  // string passed to document.write() -- text-node serialization only
  // re-encodes &, <, > (the characters that are actually unsafe to leave
  // literal in text content), so a &quot;-escaped quote written via
  // escapeHtml() round-trips back to a literal " character here. Check
  // for the one entity that reliably survives serialization.
  const expectedEscaped = '&lt;img src="x" onerror="stealCookies()" /&gt;';
  t.check(label + ': the payload text is still present, safely escaped (not stripped/silently dropped)', html.includes(expectedEscaped));
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('security-xss-name-fields');

  // --- index.html:8122 -- buildLabPtBanner (patient name) via printHemReport ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, `
      if (table === 'patients') { const c = chainable({ id:'p1', name: window.__xssPayload, mrn:'522', visit_no:'201', lab_no:'301', tests_requested:['CBC (Full Blood Count)'] }, []); c.select=()=>c; c.eq=()=>c; c.single=()=>Promise.resolve({data:{id:'p1', name: window.__xssPayload, mrn:'522', visit_no:'201', lab_no:'301', tests_requested:['CBC (Full Blood Count)']}, error:null}); return c; }
      if (table === 'results_hematology') { const c = chainable({ patient_id:'p1', wbc:5, hgb:13, plt:250, created_at:new Date().toISOString() }, []); c.select=()=>c; c.eq=()=>c; c.order=()=>c; c.limit=()=>c; c.single=()=>Promise.resolve({data:{patient_id:'p1', wbc:5, hgb:13, plt:250, created_at:new Date().toISOString()}, error:null}); return c; }
    `);
    await page.evaluate(() => { document.getElementById('hem-entry-pt-id').value = 'p1'; });
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => printHemReport()),
    ]);
    await popup.waitForLoadState();
    await assertPayloadIsInert(t, 'buildLabPtBanner (patient name in a printed lab report)', popup);
    await popup.close();
    await page.close();
  }

  // --- index.html:8122 -- printHeader()/printFooter() (CFG.phone/email/footer) ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, `
      if (table === 'price_list') return chainable(null, []);
    `);
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => openPrintWin(printHeader('Test Doc')+printFooter(), 'Test')),
    ]);
    await popup.waitForLoadState();
    await assertPayloadIsInert(t, 'printHeader/printFooter (CFG.phone/email/footer, Settings-configured)', popup);
    await popup.close();
    await page.close();
  }

  // --- index.html:13857 -- openSampleLabelWindow (label width/height from device settings) ---
  {
    const page = await context.newPage();
    await login(page, baseUrl);
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => openSampleLabelWindow({ name:'Test Patient', meta:'meta', specimen:'EDTA', collector:'Nurse', time:'10:00', barcodeValue:'FH-TEST' })),
    ]);
    await popup.waitForLoadState();
    const html = await popup.content();
    const expectedEscapedWidth = '&lt;img src=&quot;x&quot; onerror=&quot;stealCookies()&quot; /&gt;';
    t.check('openSampleLabelWindow: the poisoned label width setting is escaped, not live markup', !html.includes('<img src="x"') && html.includes(expectedEscapedWidth));
    await popup.close();
    await page.close();
  }

  // --- Lab Worklist row (found during this pass, not CodeQL-flagged) ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, `
      if (table === 'patients') return chainable(null, [{ id:'p2', name: window.__xssPayload, mrn:'522', lab_no:'301', tests_requested:['CBC (Full Blood Count)'], payment_status:'paid', priority:'Routine' }]);
      if (table === 'sample_records') return chainable(null, [{ patient_id:'p2', status:'Received' }]);
    `);
    await page.evaluate(() => goPage('worklist'));
    await page.waitForTimeout(400);
    const bodyHtml = await page.evaluate(() => document.getElementById('wl-table-body')?.innerHTML || '');
    const imgCount = await page.evaluate(() => document.querySelectorAll('#page-worklist img').length);
    t.check('Lab Worklist: the worklist actually rendered rows (not an empty/vacuous check)', bodyHtml.length > 100);
    t.check('Lab Worklist: no live <img> element rendered from a poisoned patient name', imgCount === 0);
    t.check('Lab Worklist: the payload is present safely escaped in the row', bodyHtml.includes('&lt;img'));
    await page.close();
  }

  // --- Nursing Queue row (found during this pass, not CodeQL-flagged) ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, `
      if (table === 'patients') { const c = chainable(null, [{ id:'p3', name: window.__xssPayload, mrn:'522', payment_status:'paid', visit_destination:'lab' }]); c.select=()=>c; c.or=()=>c; c.order=()=>c; c.limit=()=>c; return c; }
      if (table === 'critical_values') return chainable(null, []);
    `);
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(400);
    const imgCount = await page.evaluate(() => document.querySelectorAll('#page-nursing img').length);
    const bodyHtml = await page.evaluate(() => document.getElementById('nrs-queue-body')?.innerHTML || '');
    t.check('Nursing Queue: the queue actually rendered rows (not an empty/vacuous check)', bodyHtml.length > 100);
    t.check('Nursing Queue: no live <img> element rendered from a poisoned patient name', imgCount === 0);
    t.check('Nursing Queue: the payload is present safely escaped in the row', bodyHtml.includes('&lt;img'));
    await page.close();
  }

  // --- Registration: name field with HTML metacharacters is blocked at submission (root-cause fix) ---
  {
    const page = await context.newPage();
    await login(page, baseUrl);
    await page.evaluate(() => { _activeShift = { id: 'shift-1', status: 'active' }; });
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(150);
    await page.evaluate(() => regGoStep(1));
    await page.fill('#r-fname', 'Test<img src=x onerror=alert(1)>');
    await page.selectOption('#r-sex', 'Male');
    await page.fill('#r-phone', '0911111111');
    const nextDisabled = await page.evaluate(() => document.getElementById('reg-step1-next')?.disabled);
    const hintVisible = await page.evaluate(() => document.getElementById('r-name-metachar-hint')?.style.display !== 'none');
    t.check('Registration: Step 1 Next stays disabled while the name field contains HTML metacharacters', nextDisabled === true);
    t.check('Registration: the inline warning hint is shown', hintVisible === true);
    // Also confirm the hard block holds even if the wizard is bypassed straight to submit.
    await page.evaluate(() => { document.getElementById('r-consent').checked = true; });
    await page.evaluate(() => submitRegistration());
    await page.waitForTimeout(150);
    const toastText = await page.evaluate(() => { const el = [...document.querySelectorAll('#toast-wrap .toast')]; return el.length ? el[el.length - 1].textContent : ''; });
    t.check('Registration: submitRegistration() hard-blocks with a clear message even if the UI gate were bypassed', toastText.includes('Names') || toastText.includes('<'));
    await page.close();
  }

  return t;
};
