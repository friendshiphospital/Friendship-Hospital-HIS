// Covers Blood Bank Phase 4: the MANDATORY two-person verified issue
// workflow. This is the safety-critical phase — a wrong blood-type match
// is a fatal error — so this suite is deliberately exhaustive about every
// gate: both confirmers must re-type the actual patient MRN and unit
// number (not a name-only formality), the second confirmer must
// authenticate with their OWN real credentials, the two confirmers must
// be different staff members, and the final Issue action is inert until
// both gates pass.
//
// The mock models TWO distinct real staff accounts (keyed by email/authId/
// staffId) so that the currently-logged-in session (the first confirmer)
// and a second confirmer authenticated via verifyStaffCredentials()'s
// throwaway client are genuinely different, resolvable identities — not
// just two different labels on the same mock row.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

const UNIT = { id: 'u1', unit_no: 'BB-26-0007', blood_group: 'O', rh_factor: 'Negative', component_type: 'Packed RBC', status: 'Crossmatched', request_id: 'r1', crossmatched_by: 'staff-lab', crossmatched_by_name: 'Lab Tech A', crossmatched_at: '2026-08-01T08:00:00Z', blood_requests: { patient_id: 'p1', request_no: 'BBR-26-0001' } };
const PATIENT = { id: 'p1', name: 'Test Patient', mrn: 'M12345' };

const LAB_TECH_A = { email: 'labtech@example.com', authId: 'u1', staffId: 's1', full_name: 'Lab Tech A', role: 'lab_tech' };
const NURSE_B = { email: 'nurse@example.com', authId: 'u2', staffId: 's2', full_name: 'Nurse Receiving', role: 'nurse' };

function buildScript(users) {
  const usersJson = JSON.stringify(users);
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { unitUpdate: null, requestUpdate: null, logInsert: null, authCalls: [] };
    const USERS = ${usersJson};
    function findByEmail(email) { return USERS.find(u => u.email === email); }
    function findByAuthId(authId) { return USERS.find(u => u.authId === authId); }
    window.supabase = { createClient: () => ({
      auth: {
        signInWithPassword: async ({ email, password }) => {
          window.__mock.authCalls.push({ email, password });
          const u = findByEmail(email);
          if (!u || password !== 'correctpassword') return { data: { user: null }, error: { message: 'Invalid login credentials' } };
          return { data: { user: { id: u.authId } }, error: null };
        },
        getSession: async () => ({ data: { session: null } }),
        signOut: async () => ({ error: null }),
      },
      from: (table) => {
        if (table === 'staff') {
          const c = {
            select(){ return c; },
            eq(col, val){ c._authId = val; return c; },
            maybeSingle(){ const u = findByAuthId(c._authId); return Promise.resolve({ data: u ? { id: u.staffId, user_id: u.authId, full_name: u.full_name, role: u.role } : null, error: null }); },
            single(){ return c.maybeSingle(); },
            then(resolve){ return resolve({ data: USERS.map(u=>({id:u.staffId,user_id:u.authId,full_name:u.full_name,role:u.role})), error: null }); },
          };
          return c;
        }
        if (table === 'blood_units') {
          const c = chainable(${JSON.stringify(UNIT)}, []);
          c.update = (payload) => ({ eq: () => ({ eq: () => { window.__mock.unitUpdate = payload; return Promise.resolve({data:null,error:null}); } }) });
          return c;
        }
        if (table === 'patients') return chainable(${JSON.stringify(PATIENT)}, []);
        if (table === 'blood_requests') {
          const c = chainable(null, []);
          c.update = (payload) => ({ eq: () => { window.__mock.requestUpdate = payload; return Promise.resolve({data:null,error:null}); } });
          return c;
        }
        if (table === 'blood_issue_log') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.logInsert = payload; return Promise.resolve({ data: [payload], error: null }); };
          return c;
        }
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function loginAs(page, baseUrl, email) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', 'correctpassword');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('blood-bank-issue');

  // --- TEST 1: opening the issue modal for a Crossmatched unit shows the patient/unit summary and both confirmation steps ---
  {
    const page = await context.newPage();
    await page.addInitScript(buildScript([LAB_TECH_A, NURSE_B]));
    await loginAs(page, baseUrl, LAB_TECH_A.email);
    await page.evaluate(() => openIssueUnit('u1'));
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({
      open: document.getElementById('bb-issue-ov').classList.contains('open'),
      summary: document.getElementById('bb-issue-summary').textContent,
      finalDisabled: document.getElementById('bb-issue-final-btn').disabled,
    }));
    t.check('the issue modal opens', state.open);
    t.check('the summary shows the patient MRN and unit number', state.summary.includes('M12345') && state.summary.includes('BB-26-0007'));
    t.check('the final Issue button starts disabled — neither confirmation done yet', state.finalDisabled === true);
    await page.close();
  }

  // --- TEST 2: step 1 rejects a wrong MRN/unit re-entry, accepts the correct one ---
  {
    const page = await context.newPage();
    await page.addInitScript(buildScript([LAB_TECH_A, NURSE_B]));
    await loginAs(page, baseUrl, LAB_TECH_A.email);
    await page.evaluate(() => openIssueUnit('u1'));
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.getElementById('bb-issue-s1-mrn').value = 'WRONG-MRN'; document.getElementById('bb-issue-s1-unit').value = 'BB-26-0007'; confirmIssueStep1(); });
    const rejected = await page.evaluate(() => ({ text: document.getElementById('bb-issue-step1-status').textContent, finalDisabled: document.getElementById('bb-issue-final-btn').disabled }));
    t.check('a mismatched MRN re-entry is rejected with a clear error', rejected.text.includes('❌') && rejected.finalDisabled);
    await page.evaluate(() => { document.getElementById('bb-issue-s1-mrn').value = 'M12345'; document.getElementById('bb-issue-s1-unit').value = 'BB-26-0007'; confirmIssueStep1(); });
    const accepted = await page.evaluate(() => document.getElementById('bb-issue-step1-status').textContent);
    t.check('the correct re-entry is accepted', accepted.includes('✅'));
    await page.close();
  }

  // --- TEST 3: the second confirmer must authenticate with real credentials — a wrong password is rejected ---
  {
    const page = await context.newPage();
    await page.addInitScript(buildScript([LAB_TECH_A, NURSE_B]));
    await loginAs(page, baseUrl, LAB_TECH_A.email);
    await page.evaluate(() => openIssueUnit('u1'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('bb-issue-s2-email').value = 'nurse@example.com';
      document.getElementById('bb-issue-s2-pass').value = 'wrongpassword';
      document.getElementById('bb-issue-s2-mrn').value = 'M12345';
      document.getElementById('bb-issue-s2-unit').value = 'BB-26-0007';
    });
    await page.evaluate(() => confirmIssueStep2());
    await page.waitForTimeout(150);
    const status = await page.evaluate(() => document.getElementById('bb-issue-step2-status').textContent);
    t.check('an invalid password for the second confirmer is rejected', status.includes('❌') && status.toLowerCase().includes('invalid'));
    // authCalls also includes the initial page login's own signInWithPassword
    // call (for LAB_TECH_A) — the relevant one here is the LAST call, made
    // by confirmIssueStep2()'s verifyStaffCredentials().
    const authCalls = await page.evaluate(() => window.__mock.authCalls);
    const lastCall = authCalls[authCalls.length - 1];
    t.check('the credential check actually authenticates against real Supabase Auth (not a checkbox)', lastCall?.email === 'nurse@example.com' && lastCall?.password === 'wrongpassword');
    await page.close();
  }

  // --- TEST 4: THE CORE SAFETY RULE — the same staff member cannot complete both confirmations ---
  {
    const page = await context.newPage();
    await page.addInitScript(buildScript([LAB_TECH_A, NURSE_B]));
    await loginAs(page, baseUrl, LAB_TECH_A.email);
    await page.evaluate(() => openIssueUnit('u1'));
    await page.waitForTimeout(150);
    // Step 1 as the logged-in user (Lab Tech A).
    await page.evaluate(() => { document.getElementById('bb-issue-s1-mrn').value = 'M12345'; document.getElementById('bb-issue-s1-unit').value = 'BB-26-0007'; confirmIssueStep1(); });
    // Step 2 attempted with Lab Tech A's OWN real credentials — valid login, but the same person.
    await page.evaluate(() => {
      document.getElementById('bb-issue-s2-email').value = 'labtech@example.com';
      document.getElementById('bb-issue-s2-pass').value = 'correctpassword';
      document.getElementById('bb-issue-s2-mrn').value = 'M12345';
      document.getElementById('bb-issue-s2-unit').value = 'BB-26-0007';
    });
    await page.evaluate(() => confirmIssueStep2());
    await page.waitForTimeout(150);
    const status = await page.evaluate(() => document.getElementById('bb-issue-step2-status').textContent);
    const finalDisabled = await page.evaluate(() => document.getElementById('bb-issue-final-btn').disabled);
    t.check('completing step 2 as the SAME staff member as step 1 is rejected, even with fully valid credentials', status.includes('different from the issuing staff'));
    t.check('the final Issue button stays disabled when both confirmations resolve to one person', finalDisabled === true);
    await page.close();
  }

  // --- TEST 5: full happy path — two genuinely different staff, both correct — issues the unit and writes the permanent log ---
  {
    const page = await context.newPage();
    await page.addInitScript(buildScript([LAB_TECH_A, NURSE_B]));
    await loginAs(page, baseUrl, LAB_TECH_A.email);
    await page.evaluate(() => openIssueUnit('u1'));
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.getElementById('bb-issue-s1-mrn').value = 'M12345'; document.getElementById('bb-issue-s1-unit').value = 'BB-26-0007'; confirmIssueStep1(); });
    await page.evaluate(() => {
      document.getElementById('bb-issue-s2-email').value = 'nurse@example.com';
      document.getElementById('bb-issue-s2-pass').value = 'correctpassword';
      document.getElementById('bb-issue-s2-mrn').value = 'M12345';
      document.getElementById('bb-issue-s2-unit').value = 'BB-26-0007';
    });
    await page.evaluate(() => confirmIssueStep2());
    await page.waitForTimeout(150);
    const finalEnabled = await page.evaluate(() => !document.getElementById('bb-issue-final-btn').disabled);
    t.check('once both confirmations succeed with two genuinely different staff, the final Issue button enables', finalEnabled);
    // Stub the print window so finalizeBloodIssue()'s printBloodIssueSlip() call doesn't hang on a real popup.
    await page.evaluate(() => { window.open = () => ({ document: { write: () => {}, close: () => {} }, focus: () => {} }); });
    await page.evaluate(() => finalizeBloodIssue());
    await page.waitForTimeout(200);
    const mock = await page.evaluate(() => window.__mock);
    t.check('the unit is marked Issued with both staff identities and timestamps', mock.unitUpdate?.status === 'Issued' && mock.unitUpdate?.issued_by_name === 'Lab Tech A' && mock.unitUpdate?.received_by_name === 'Nurse Receiving');
    t.check('the linked request is marked Issued too', mock.requestUpdate?.status === 'Issued');
    t.check('a permanent blood_issue_log entry is written with the full chain (reserved -> issued -> received)', mock.logInsert?.reserved_by_name === 'Lab Tech A' && mock.logInsert?.issued_by_name === 'Lab Tech A' && mock.logInsert?.received_by_name === 'Nurse Receiving');
    t.check('the log entry never has the same staff as both issuer and receiver', mock.logInsert?.issued_by !== mock.logInsert?.received_by);
    const modalClosed = await page.evaluate(() => !document.getElementById('bb-issue-ov').classList.contains('open'));
    t.check('the modal closes after a successful issue', modalClosed);
    await page.close();
  }

  return t;
};
