// Covers Documentation/Logbook Phase 3 (Nursing): MAR now supports a
// distinct Refused status (previously folded into Omit) with a
// mandatory reason for Omit/Hold/Refused; high-alert medications require
// independent second-staff verification before they can be marked Given
// (genuinely absent before, confirmed by the Phase 0 audit); and Ward
// Handover Notes now has real SBAR-structured fields (Situation/
// Background/Assessment/Recommendation), not just free text.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

const LAB_TECH_A = { email: 'nursea@example.com', authId: 'auth-a', staffId: 'staff-a', name: 'Nurse A' };
const NURSE_B = { email: 'nurseb@example.com', authId: 'auth-b', staffId: 'staff-b', name: 'Nurse B' };
const USERS = [LAB_TECH_A, NURSE_B];

function initScript(loggedInUser, extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { marInsert: null, handoverInsert: null };
    const USERS = ${JSON.stringify(USERS)};
    window.supabase = { createClient: () => ({
      auth: {
        signInWithPassword: async({email,password}) => {
          const u = USERS.find(x=>x.email===email);
          if (!u || password !== 'correctpassword') return { data: { user: null }, error: { message: 'invalid' } };
          return { data: { user: { id: u.authId } }, error: null };
        },
        getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}),
      },
      from: (table) => {
        if (table === 'staff') {
          const c = chainable(null, []);
          c.select = () => c;
          c.eq = (col, val) => {
            const u = USERS.find(x=>x.authId===val) || ${JSON.stringify(loggedInUser)};
            return chainable({ id: u.staffId, user_id: u.authId, full_name: u.name, role: 'admin' }, []);
          };
          return c;
        }
        if (table === 'vital_signs') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.marInsert = payload; return { select: () => Promise.resolve({ data: [payload], error: null }) }; };
          return c;
        }
        if (table === 'ward_handover_notes') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.handoverInsert = payload; return chainable(null, []); };
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
  await page.fill('#auth-email', LAB_TECH_A.email);
  await page.fill('#auth-pass', 'correctpassword');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('doclogbook-nursing-phase3');

  // --- MAR: distinct Refused status + mandatory reason ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(LAB_TECH_A));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.getElementById('vs-pt-id').value = 'p1'; });
    await page.evaluate(() => addMarRow());
    const hasRefusedOption = await page.evaluate(() => [...document.getElementById('mar-status-0').options].some(o => o.value === 'Refused'));
    t.check('MAR status dropdown has a distinct Refused option (previously folded into Omit)', hasRefusedOption);
    await page.evaluate(() => {
      document.getElementById('mar-drug-0').value = 'Paracetamol';
      document.getElementById('mar-status-0').value = 'Refused';
      updateMarRowUI(0);
    });
    const reasonVisible = await page.evaluate(() => getComputedStyle(document.getElementById('mar-reason-0')).display !== 'none');
    t.check('selecting Refused reveals the mandatory reason field', reasonVisible);
    await page.evaluate(() => saveMAR());
    await page.waitForTimeout(100);
    t.check('saving Refused without a reason is blocked', (await page.evaluate(() => window.__mock.marInsert)) === null);
    await page.evaluate(() => { document.getElementById('mar-reason-0').value = 'Patient declined, explained risks'; });
    await page.evaluate(() => saveMAR());
    await page.waitForTimeout(100);
    const insert = await page.evaluate(() => window.__mock.marInsert);
    t.check('saving Refused with a reason succeeds', insert?.mar_entries?.[0]?.status === 'Refused');
    t.check('the reason is persisted on the entry', insert?.mar_entries?.[0]?.reason === 'Patient declined, explained risks');
    await page.close();
  }

  // --- MAR: Omit/Hold also require a reason ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(LAB_TECH_A));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.getElementById('vs-pt-id').value = 'p1'; });
    await page.evaluate(() => addMarRow());
    await page.evaluate(() => { document.getElementById('mar-drug-0').value = 'Amoxicillin'; document.getElementById('mar-status-0').value = 'Omit'; updateMarRowUI(0); });
    await page.evaluate(() => saveMAR());
    await page.waitForTimeout(100);
    t.check('Omit without a reason is blocked', (await page.evaluate(() => window.__mock.marInsert)) === null);
    await page.evaluate(() => { document.getElementById('mar-reason-0').value = 'NPO for surgery'; });
    await page.evaluate(() => saveMAR());
    await page.waitForTimeout(100);
    t.check('Omit with a reason succeeds', (await page.evaluate(() => window.__mock.marInsert))?.mar_entries?.[0]?.status === 'Omit');
    await page.close();
  }

  // --- MAR: high-alert medication requires independent second-staff verification ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(LAB_TECH_A));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.getElementById('vs-pt-id').value = 'p1'; });
    await page.evaluate(() => addMarRow());
    await page.evaluate(() => {
      document.getElementById('mar-drug-0').value = 'Insulin Actrapid';
      document.getElementById('mar-dose-0').value = '10 units';
      document.getElementById('mar-status-0').value = 'Given';
      updateMarRowUI(0);
    });
    const verifyBtnShown = await page.evaluate(() => document.getElementById('mar-verify-cell-0').innerHTML.includes('Verify'));
    t.check('a high-alert drug marked Given shows a second-staff Verify control', verifyBtnShown);
    await page.evaluate(() => saveMAR());
    await page.waitForTimeout(100);
    t.check('saving a high-alert Given entry without verification is blocked', (await page.evaluate(() => window.__mock.marInsert)) === null);
    // Attempt verification as the SAME logged-in user — must be rejected.
    await page.evaluate(() => openMarVerify(0));
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.getElementById('mar-verify-email').value = 'nursea@example.com'; document.getElementById('mar-verify-pass').value = 'correctpassword'; });
    await page.evaluate(() => confirmMarVerify());
    await page.waitForTimeout(100);
    const stillUnverified = await page.evaluate(() => !window._marSecondVerify[0]);
    t.check('verifying as the same staff member administering is rejected (must be a different person)', stillUnverified);
    // Verify as a genuinely different staff member — succeeds.
    await page.evaluate(() => { document.getElementById('mar-verify-email').value = 'nurseb@example.com'; document.getElementById('mar-verify-pass').value = 'correctpassword'; });
    await page.evaluate(() => confirmMarVerify());
    await page.waitForTimeout(100);
    const verified = await page.evaluate(() => window._marSecondVerify[0]);
    t.check('verifying as a genuinely different staff member succeeds', verified?.staffName === 'Nurse B');
    await page.evaluate(() => saveMAR());
    await page.waitForTimeout(100);
    const insert = await page.evaluate(() => window.__mock.marInsert);
    t.check('the high-alert Given entry now saves, with the second verifier recorded', insert?.mar_entries?.[0]?.second_verified_by === 'Nurse B');
    await page.close();
  }

  // --- MAR: a non-high-alert drug never requires second verification ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(LAB_TECH_A));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.getElementById('vs-pt-id').value = 'p1'; });
    await page.evaluate(() => addMarRow());
    await page.evaluate(() => { document.getElementById('mar-drug-0').value = 'Paracetamol'; document.getElementById('mar-status-0').value = 'Given'; updateMarRowUI(0); });
    const noVerifyNeeded = await page.evaluate(() => document.getElementById('mar-verify-cell-0').innerHTML === '');
    t.check('an ordinary (non-high-alert) drug marked Given shows no verify control', noVerifyNeeded);
    await page.evaluate(() => { document.getElementById('mar-by-0').value = 'NA'; });
    await page.evaluate(() => saveMAR());
    await page.waitForTimeout(100);
    t.check('an ordinary drug marked Given saves without any second-staff step', (await page.evaluate(() => window.__mock.marInsert))?.mar_entries?.[0]?.status === 'Given');
    await page.close();
  }

  // --- Handover Notes: real SBAR-structured fields ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(LAB_TECH_A));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(200);
    const sbarFieldsExist = await page.evaluate(() => ['ho-situation', 'ho-background', 'ho-assessment', 'ho-recommendation'].every(id => !!document.getElementById(id)));
    t.check('the handover form has 4 distinct SBAR-labeled fields (was previously free-text only)', sbarFieldsExist);
    await page.evaluate(() => {
      document.getElementById('ho-notes').value = 'General notes for shift.';
      document.getElementById('ho-situation').value = 'Bed 4 spiked a fever an hour ago.';
      document.getElementById('ho-background').value = 'Post-op day 2, appendectomy, previously afebrile.';
      document.getElementById('ho-assessment').value = 'Temp 38.6, HR 102, otherwise stable, wound clean.';
      document.getElementById('ho-recommendation').value = 'Recheck temp in 2h, notify surgical team if it climbs further.';
    });
    await page.evaluate(() => saveHandover());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.handoverInsert);
    t.check('Situation is saved as its own distinct field', insert?.situation === 'Bed 4 spiked a fever an hour ago.');
    t.check('Background is saved as its own distinct field', insert?.background === 'Post-op day 2, appendectomy, previously afebrile.');
    t.check('Assessment is saved as its own distinct field', insert?.assessment === 'Temp 38.6, HR 102, otherwise stable, wound clean.');
    t.check('Recommendation is saved as its own distinct field', insert?.recommendation === 'Recheck temp in 2h, notify surgical team if it climbs further.');
    await page.close();
  }

  return t;
};
