// Covers Documentation/Logbook Phase 6 (Bed Management & Theatre): a Bed
// Transfer Register (hospital-wide/ward-wide view + export over existing
// bed_transfers data, previously only visible inline per-admission), a
// Daily Bed Census (a point-in-time occupancy snapshot, previously only
// live "right now" counters existed), and the WHO Surgical Safety
// Checklist (genuinely new — three sequential, independently-gated
// Sign In/Time Out/Sign Out stages tied to a theatre booking).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { whoUpdate: null, whoInsert: null };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Theatre Test', role: 'admin' }, []);
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
  const t = makeSuite('doclogbook-bedtheatre-phase6');

  // --- Bed Transfer Register ---
  {
    const transfers = [
      { id: 'x1', patient_id: 'p1', from_ward: 'Medical', from_room: '1', from_bed: '3', to_ward: 'ICU', to_room: '1', to_bed: '1', reason: 'Deterioration', transferred_by_name: 'Nurse A', transferred_at: '2026-08-01T10:00:00Z', patients: { name: 'Register Test Patient', mrn: 'M700' } },
    ];
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'bed_transfers') return chainable(null, ${JSON.stringify(transfers)});
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(300);
    const html = await page.evaluate(() => document.getElementById('transfer-register-body').innerHTML);
    t.check('the Bed Transfer Register loads and lists a transfer (previously only visible per-admission)', html.includes('Register Test Patient') && html.includes('ICU'));
    const rowCount = await page.evaluate(() => _transferRegisterRows.length);
    t.check('the register keeps the raw rows for export', rowCount === 1);
    await page.close();
  }

  // --- Daily Bed Census ---
  {
    const admissions = [{ ward: 'Medical' }, { ward: 'Medical' }, { ward: 'ICU' }];
    const beds = [{ ward: 'Medical' }, { ward: 'Medical' }, { ward: 'Medical' }, { ward: 'Medical' }, { ward: 'ICU' }, { ward: 'ICU' }];
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'admissions') return chainable(null, ${JSON.stringify(admissions)});
        if (table === 'beds') return chainable(null, ${JSON.stringify(beds)});
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(300);
    const html = await page.evaluate(() => document.getElementById('bed-census-body').innerHTML);
    t.check('the census shows Medical ward with 2 occupied out of 4 beds', /Medical[\s\S]*?2[\s\S]*?4/.test(html));
    t.check('the census shows ICU ward with 1 occupied out of 2 beds', /ICU[\s\S]*?1[\s\S]*?2/.test(html));
    t.check('the census shows a total row', html.includes('Total'));
    await page.close();
  }

  // --- WHO Surgical Safety Checklist: sequential gating ---
  {
    const booking = { id: 'b1', operation_name: 'Appendicectomy', theatre_room: 'OT-1', patients: { name: 'WHO Test Patient', mrn: 'M800' } };
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'theatre_bookings') return chainable(${JSON.stringify(booking)}, []);
        if (table === 'who_safety_checklist') {
          const c = chainable({ id: 'wc1' }, []);
          c.insert = (payload) => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'wc1', ...payload }, error: null }) }) });
          c.update = (payload) => { window.__mock.whoUpdate = { ...(window.__mock.whoUpdate||{}), ...payload }; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('theatre'));
    await page.waitForTimeout(200);
    await page.evaluate(() => openWhoChecklist('b1'));
    await page.waitForTimeout(150);
    const infoText = await page.evaluate(() => document.getElementById('who-checklist-info').innerHTML);
    t.check('the checklist modal identifies the correct patient and procedure', infoText.includes('WHO Test Patient') && infoText.includes('Appendicectomy'));
    const timeoutLocked = await page.evaluate(() => document.getElementById('who-timeout-items').innerHTML.includes('previous stage first'));
    t.check('Time Out is locked until Sign In is completed', timeoutLocked);
    const signoutLocked = await page.evaluate(() => document.getElementById('who-signout-items').innerHTML.includes('previous stage first'));
    t.check('Sign Out is locked until Time Out is completed', signoutLocked);
    // Confirm button stays disabled until every Sign In item is checked.
    const btnDisabledInitially = await page.evaluate(() => document.getElementById('who-signin-confirm-btn').disabled);
    t.check('the Sign In confirm button starts disabled', btnDisabledInitially);
    await page.evaluate(() => {
      const items = WHO_CHECKLIST_ITEMS.signin;
      for (let i = 0; i < items.length - 1; i++) document.getElementById('who-signin-chk-' + i).checked = true;
      updateWhoStageButton('signin');
    });
    const stillDisabledPartial = await page.evaluate(() => document.getElementById('who-signin-confirm-btn').disabled);
    t.check('the confirm button stays disabled until ALL items are checked, not just most', stillDisabledPartial);
    await page.evaluate(() => {
      const items = WHO_CHECKLIST_ITEMS.signin;
      document.getElementById('who-signin-chk-' + (items.length - 1)).checked = true;
      updateWhoStageButton('signin');
    });
    const enabledWhenAllChecked = await page.evaluate(() => !document.getElementById('who-signin-confirm-btn').disabled);
    t.check('the confirm button enables once every item is checked', enabledWhenAllChecked);
    await page.evaluate(() => completeWhoStage('signin'));
    await page.waitForTimeout(150);
    const update = await page.evaluate(() => window.__mock.whoUpdate);
    t.check('completing Sign In stamps who and when', !!update?.signin_completed_by_name && !!update?.signin_completed_at);
    const timeoutUnlockedNow = await page.evaluate(() => !document.getElementById('who-timeout-items').innerHTML.includes('previous stage first'));
    t.check('Time Out unlocks once Sign In is confirmed', timeoutUnlockedNow);
    const signinBadge = await page.evaluate(() => document.getElementById('who-signin-badge').innerHTML);
    t.check('Sign In shows a completed badge', signinBadge.includes('✓'));
    await page.close();
  }

  return t;
};
