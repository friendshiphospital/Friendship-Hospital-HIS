// Covers Phase 4: visit-level status tracking (advanceVisitStatus,
// checkAndAdvanceToResultsReady, effectiveVisitStatus), and the doctor-only
// "Complete & Sign Off" flow with its consultation-notes lock and
// follow-up scheduling.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function baseInit(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    ${extra}
  `;
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'doc@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('visit-status-and-signoff');

  // --- TEST 1: effectiveVisitStatus computes "Payment Pending" overlay, never stores it ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`window.supabase = { createClient: () => ({ auth:{signInWithPassword:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})}, from:()=>chainable(null,[]), rpc:()=>Promise.resolve({data:null,error:null}), functions:{invoke:async()=>({data:{ok:true},error:null})} }) };`));
    await login(page, baseUrl);
    const results = await page.evaluate(() => ({
      unpaidRegistered: effectiveVisitStatus({ visit_status: 'Registered', payment_status: 'unpaid' }),
      paidRegistered: effectiveVisitStatus({ visit_status: 'Registered', payment_status: 'paid' }),
      ordersPendingUnpaid: effectiveVisitStatus({ visit_status: 'Orders Pending', payment_status: 'unpaid' }),
      order: VISIT_STATUS_ORDER,
    }));
    t.check('unpaid + Registered shows the computed "Payment Pending" overlay', results.unpaidRegistered === 'Payment Pending');
    t.check('paid + Registered shows plain "Registered"', results.paidRegistered === 'Registered');
    t.check('"Payment Pending" is never the stored/raw value once past Registered', results.ordersPendingUnpaid === 'Orders Pending');
    t.check('the stored enum has exactly 5 values (Payment Pending is not one of them)', results.order.length === 5 && !results.order.includes('Payment Pending'));
    await page.close();
  }

  // --- TEST 2: advanceVisitStatus only moves forward, never regresses, never leaves Visit Complete ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`
      window.__mock = { current: 'Orders Pending', updateCalls: [] };
      window.supabase = { createClient: () => ({
        auth:{signInWithPassword:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},
        from: (table) => {
          if (table === 'patients') {
            const c = chainable({ visit_status: window.__mock.current }, []);
            c.update = (payload) => ({ eq: () => { window.__mock.updateCalls.push(payload); window.__mock.current = payload.visit_status; return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `));
    await login(page, baseUrl);
    // Orders Pending -> With Doctor (backward) must be a no-op.
    await page.evaluate(() => advanceVisitStatus('p1', 'With Doctor'));
    await page.waitForTimeout(100);
    let calls = await page.evaluate(() => window.__mock.updateCalls.length);
    t.check('advanceVisitStatus never regresses a later status to an earlier one', calls === 0);
    // Orders Pending -> Results Ready (forward) must apply.
    await page.evaluate(() => advanceVisitStatus('p1', 'Results Ready'));
    await page.waitForTimeout(100);
    let current = await page.evaluate(() => window.__mock.current);
    t.check('advanceVisitStatus does advance forward', current === 'Results Ready');
    // Now simulate terminal state and confirm nothing can move it again.
    await page.evaluate(() => { window.__mock.current = 'Visit Complete'; window.__mock.updateCalls = []; });
    await page.evaluate(() => advanceVisitStatus('p1', 'Orders Pending'));
    await page.waitForTimeout(100);
    calls = await page.evaluate(() => window.__mock.updateCalls.length);
    t.check('advanceVisitStatus never touches a visit already at the terminal Visit Complete state', calls === 0);
    await page.close();
  }

  // --- TEST 3: checkAndAdvanceToResultsReady only fires once EVERY lab+radiology order is done ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`
      window.__mock = { sampleStatus: 'Completed', radStatuses: ['Reported','Requested'], patientsStatus: 'Orders Pending', advanceCalled: [] };
      window.supabase = { createClient: () => ({
        auth:{signInWithPassword:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},
        from: (table) => {
          if (table === 'sample_records') return chainable({ status: window.__mock.sampleStatus }, []);
          if (table === 'radiology_requests') return chainable(null, window.__mock.radStatuses.map(s => ({ status: s })));
          if (table === 'patients') {
            const c = chainable({ visit_status: window.__mock.patientsStatus }, []);
            c.update = (payload) => ({ eq: () => { window.__mock.advanceCalled.push(payload.visit_status); window.__mock.patientsStatus = payload.visit_status; return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `));
    await login(page, baseUrl);
    // One radiology study still Requested -> must NOT advance yet.
    await page.evaluate(() => checkAndAdvanceToResultsReady('p1'));
    await page.waitForTimeout(150);
    let advanced = await page.evaluate(() => window.__mock.advanceCalled.length);
    t.check('does not advance to Results Ready while any radiology study is still outstanding', advanced === 0);
    // Now finish that last study -> must advance.
    await page.evaluate(() => { window.__mock.radStatuses = ['Reported', 'Reported']; });
    await page.evaluate(() => checkAndAdvanceToResultsReady('p1'));
    await page.waitForTimeout(150);
    const finalStatus = await page.evaluate(() => window.__mock.patientsStatus);
    t.check('advances to Results Ready once every lab and radiology order is done', finalStatus === 'Results Ready');
    await page.close();
  }

  // --- TEST 4: completeAndSignOffVisit blocks when no consultation notes were ever saved ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`
      window.supabase = { createClient: () => ({
        auth:{signInWithPassword:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},
        from: (table) => {
          if (table === 'doctor_consultations') return chainable(null, []); // no row at all
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `));
    await login(page, baseUrl);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Test Patient', mrn: 'M1' }; });
    let threw = false;
    page.on('pageerror', () => { threw = true; });
    await page.evaluate(() => completeAndSignOffVisit());
    await page.waitForTimeout(150);
    const modalOpen = await page.evaluate(() => document.getElementById('followup-schedule-ov')?.classList.contains('open'));
    t.check('completing a visit with no saved consultation notes never opens the follow-up modal', !modalOpen);
    t.check('no page error was thrown while blocked', !threw);
    await page.close();
  }

  // --- TEST 5: full happy path — notes saved, doctor schedules a follow-up, visit completes and locks ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`
      window.__mock = { consultUpdates: [], followUpInserts: [], patientUpdates: [] };
      window.supabase = { createClient: () => ({
        auth:{signInWithPassword:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},
        from: (table) => {
          if (table === 'doctor_consultations') {
            const c = chainable({ id: 'c1', is_signed_off: false }, []);
            c.update = (payload) => ({ eq: () => { window.__mock.consultUpdates.push(payload); return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          if (table === 'follow_ups') {
            const c = chainable(null, []);
            c.insert = (payload) => { window.__mock.followUpInserts.push(payload); return Promise.resolve({data:null,error:null}); };
            return c;
          }
          if (table === 'patients') {
            const c = chainable(null, []);
            c.update = (payload) => ({ eq: () => { window.__mock.patientUpdates.push(payload); return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `));
    page.on('dialog', d => d.accept()); // "Schedule a follow-up?" -> yes
    await login(page, baseUrl);
    await page.evaluate(() => { currentProfile = { id: 'doc1', role: 'doctor', full_name: 'Dr Test' }; _docPt = { id: 'p1', name: 'Test Patient', mrn: 'M1' }; });
    await page.evaluate(() => completeAndSignOffVisit());
    await page.waitForTimeout(200);
    const modalOpen = await page.evaluate(() => document.getElementById('followup-schedule-ov')?.classList.contains('open'));
    t.check('confirming "schedule a follow-up" opens the follow-up modal', modalOpen);
    const suggestedDate = await page.evaluate(() => document.getElementById('fu-date').value);
    t.check('the modal pre-fills a suggested date (today + configured window)', !!suggestedDate);
    await page.evaluate(() => { document.getElementById('fu-reason').value = 'Review BP control'; });
    await page.evaluate(() => saveFollowUpSchedule());
    await page.waitForTimeout(200);
    const followUps = await page.evaluate(() => window.__mock.followUpInserts);
    const consultUpdates = await page.evaluate(() => window.__mock.consultUpdates);
    const patientUpdates = await page.evaluate(() => window.__mock.patientUpdates);
    const modalClosed = await page.evaluate(() => !document.getElementById('followup-schedule-ov')?.classList.contains('open'));
    t.check('a follow_ups row is inserted with the mrn, date, and reason', followUps.length === 1 && followUps[0].patient_mrn === 'M1' && followUps[0].reason === 'Review BP control');
    t.check('the most recent consultation is marked signed off with the doctor identity', consultUpdates.length === 1 && consultUpdates[0].is_signed_off === true && consultUpdates[0].signed_off_by_name);
    t.check('the visit is marked Visit Complete', patientUpdates.length === 1 && patientUpdates[0].visit_status === 'Visit Complete');
    t.check('the follow-up modal closes after saving', modalClosed);
    const notesDisabled = await page.evaluate(() => {
      const el = document.querySelector('#doc-tab-notes textarea, #doc-tab-notes input');
      return el ? el.disabled : null;
    });
    t.check('consultation notes fields are disabled (locked) after sign-off', notesDisabled === true);
    const completeBtnHidden = await page.evaluate(() => document.getElementById('doc-complete-btn')?.style.display === 'none');
    t.check('the Complete & Sign Off button hides once already signed off', completeBtnHidden);
    await page.close();
  }

  // --- TEST 6: admin override unlocks the notes, non-admin never sees the unlock button ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`window.supabase = { createClient: () => ({ auth:{signInWithPassword:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})}, from:()=>chainable(null,[]), rpc:()=>Promise.resolve({data:null,error:null}), functions:{invoke:async()=>({data:{ok:true},error:null})} }) };`));
    await login(page, baseUrl);
    await page.evaluate(() => { currentProfile = { role: 'doctor', full_name: 'Dr Test' }; applyConsultationNotesLock(true); });
    let unlockVisible = await page.evaluate(() => document.getElementById('doc-signoff-unlock-btn').style.display !== 'none');
    t.check('a non-admin doctor never gets the unlock-to-edit override button', !unlockVisible);
    await page.evaluate(() => { currentProfile = { role: 'admin', full_name: 'Admin User' }; applyConsultationNotesLock(true); });
    unlockVisible = await page.evaluate(() => document.getElementById('doc-signoff-unlock-btn').style.display !== 'none');
    t.check('admin gets the unlock-to-edit override button', unlockVisible);
    await page.evaluate(() => toggleConsultationLockOverride());
    const notesEnabled = await page.evaluate(() => {
      const el = document.querySelector('#doc-tab-notes textarea, #doc-tab-notes input');
      return el ? !el.disabled : null;
    });
    t.check('clicking Unlock re-enables the consultation notes fields for admin', notesEnabled === true);
    await page.close();
  }

  // --- TEST 7: registration sets visit_status:'Registered' explicitly ---
  {
    const page = await context.newPage();
    await page.addInitScript(baseInit(`
      window.__mock = { insertedPatient: null };
      window.supabase = { createClient: () => ({
        auth:{signInWithPassword:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},
        from: (table) => {
          const c = chainable(null, []);
          if (table === 'patients') c.insert = (payload) => { window.__mock.insertedPatient = payload; return Promise.resolve({data:[payload],error:null}); };
          else c.insert = (payload) => Promise.resolve({data:[payload],error:null});
          return c;
        },
        rpc: () => Promise.resolve({ data: 'ID-1', error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('r-fname', 'Test'); set('r-sex', 'Male'); set('r-phone', '0912345678');
      const consent = document.getElementById('r-consent'); if (consent) consent.checked = true;
      if (typeof _regDestinations !== 'undefined') _regDestinations.add('lab');
    });
    await page.evaluate(() => submitRegistration());
    await page.waitForTimeout(300);
    const inserted = await page.evaluate(() => window.__mock.insertedPatient);
    t.check('a freshly registered patient is inserted with visit_status:\'Registered\'', inserted?.visit_status === 'Registered');
    await page.close();
  }

  return t;
};
