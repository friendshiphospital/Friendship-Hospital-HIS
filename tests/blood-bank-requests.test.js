// Covers Blood Bank Phase 3: blood request workflow — request placement
// from Doctor Consultation (same shape/payment-gate convention as
// submitRadOrder()), and crossmatch/compatibility checking against the
// patient's on-file blood type (from Haematology, per Phase 0's audit).
// A patient with no on-file blood type must be blocked from crossmatch,
// never proceeding on an assumed/unconfirmed type.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

async function login(page, baseUrl, email) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('blood-bank-requests');

  // --- TEST 1: compatibility matrix — ABO/Rh rules match the standard RBC compatibility chart ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => { if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Doc Test', role: 'doctor' }, []); return chainable(null, []); },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl, 'doc@example.com');
    const checks = await page.evaluate(() => ({
      oNegUniversalDonor: isBloodCompatible('AB+','O','Negative'),
      abPositiveUniversalRecipient: isBloodCompatible('AB+','AB','Positive') && isBloodCompatible('AB+','O','Positive') && isBloodCompatible('AB+','A','Positive') && isBloodCompatible('AB+','B','Positive'),
      oNegOnlyReceivesONeg: isBloodCompatible('O-','O','Negative') && !isBloodCompatible('O-','O','Positive') && !isBloodCompatible('O-','A','Negative'),
      aPositiveCannotReceiveB: !isBloodCompatible('A+','B','Positive') && !isBloodCompatible('A+','B','Negative'),
      aPositiveCanReceiveAAndO: isBloodCompatible('A+','A','Positive') && isBloodCompatible('A+','A','Negative') && isBloodCompatible('A+','O','Positive') && isBloodCompatible('A+','O','Negative'),
    }));
    t.check('O- is compatible as a donor for the universal recipient (AB+)', checks.oNegUniversalDonor);
    t.check('AB+ patients can receive from every ABO/Rh combination (universal recipient)', checks.abPositiveUniversalRecipient);
    t.check('O- patients can only receive O- (most restrictive)', checks.oNegOnlyReceivesONeg);
    t.check('A+ patients cannot receive B-type blood (major ABO mismatch blocked)', checks.aPositiveCannotReceiveB);
    t.check('A+ patients can receive A or O (Rh either)', checks.aPositiveCanReceiveAAndO);
    await page.close();
  }

  // --- TEST 2: the Doctor Consultation Orders tab has a Blood Bank order type alongside Lab/Radiology ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => { if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Doc Test', role: 'doctor' }, []); return chainable(null, []); },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl, 'doc@example.com');
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(150);
    const hasTab = await page.evaluate(() => !!document.querySelector('[onclick*="switchOrderType(\'bloodbank\'"]'));
    t.check('a Blood Bank order-type tab exists alongside Lab/Radiology', hasTab);
    await page.evaluate(() => switchOrderType('bloodbank', null));
    const visible = await page.evaluate(() => document.getElementById('order-tab-bloodbank').style.display !== 'none');
    const labHidden = await page.evaluate(() => document.getElementById('order-tab-lab').style.display === 'none');
    t.check('switching to it shows the Blood Bank order form', visible);
    t.check('and hides the Lab order form (same tab-switch convention as Lab/Radiology)', labHidden);
    await page.close();
  }

  // --- TEST 3: submitting a blood request creates a blood_requests row AND a mirrored doctor_orders row ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { requestInsert: null, orderInsert: null };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Doc Test', role: 'doctor' }, []);
          if (table === 'blood_requests') {
            const c = chainable(null, []);
            c.insert = (payload) => { window.__mock.requestInsert = payload; return Promise.resolve({ data: [payload], error: null }); };
            return c;
          }
          if (table === 'doctor_orders') {
            const c = chainable(null, []);
            c.insert = (payload) => { window.__mock.orderInsert = payload; return Promise.resolve({ data: [payload], error: null }); };
            return c;
          }
          if (table === 'patients') return chainable({ visit_status: 'Orders Pending' }, []);
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl, 'doc@example.com');
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Test Patient', payment_status: 'paid' }; });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchOrderType('bloodbank', null));
    await page.evaluate(() => {
      document.getElementById('ord-bb-component').value = 'Packed RBC';
      document.getElementById('ord-bb-units').value = '2';
      document.getElementById('ord-bb-urgency').value = 'Urgent';
      document.getElementById('ord-bb-indication').value = 'Hb 6.2, symptomatic anaemia';
    });
    await page.evaluate(() => submitBloodRequest());
    await page.waitForTimeout(200);
    const mock = await page.evaluate(() => window.__mock);
    t.check('a blood_requests row is created with the right component/units/urgency', mock.requestInsert?.component_type === 'Packed RBC' && mock.requestInsert?.units_requested === 2 && mock.requestInsert?.urgency === 'Urgent');
    t.check('a request_no is generated', /^BBR-/.test(mock.requestInsert?.request_no || ''));
    t.check('a mirrored doctor_orders row is created (order_type: Blood Bank), same convention as Radiology', mock.orderInsert?.order_type === 'Blood Bank' && mock.orderInsert?.patient_id === 'p1');
    await page.close();
  }

  // --- TEST 4: a patient with NO on-file blood type is blocked from crossmatch entirely ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      const request = { id: 'r1', request_no: 'BBR-26-0001', patient_id: 'p1', component_type: 'Packed RBC', units_requested: 1, urgency: 'Routine', clinical_indication: 'Pre-op', patients: { name: 'Untyped Patient', mrn: 'M1' } };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []);
          if (table === 'blood_requests') return chainable(null, [request]);
          if (table === 'results_hematology') return chainable(null, []); // no blood group on file
          if (table === 'blood_units') return chainable(null, []);
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl, 'labtech@example.com');
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchBbTab('requests', null));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('bb-requests-body').innerHTML);
    t.check('a request for an untyped patient shows a clear block message', html.includes('no on-file blood type') || html.includes('crossmatch blocked'));
    t.check('no Crossmatch button is offered for an untyped patient', !html.includes('Crossmatch'));
    await page.close();
  }

  // --- TEST 5: crossmatching offers only ABO/Rh-COMPATIBLE Available units, and reserving one updates both rows ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { unitUpdate: null, requestUpdate: null };
      const request = { id: 'r1', request_no: 'BBR-26-0002', patient_id: 'p2', component_type: 'Packed RBC', units_requested: 1, urgency: 'STAT', clinical_indication: 'Active bleed', patients: { name: 'A Positive Patient', mrn: 'M2' } };
      const units = [
        { id: 'u1', unit_no: 'BB-26-0001', blood_group: 'B', rh_factor: 'Positive', component_type: 'Packed RBC', expiry_date: '2026-12-01', status: 'Available' },  // incompatible with A+
        { id: 'u2', unit_no: 'BB-26-0002', blood_group: 'O', rh_factor: 'Negative', component_type: 'Packed RBC', expiry_date: '2026-11-01', status: 'Available' }, // compatible (universal donor)
        { id: 'u3', unit_no: 'BB-26-0003', blood_group: 'A', rh_factor: 'Positive', component_type: 'Packed RBC', expiry_date: '2026-10-01', status: 'Available' }, // compatible (exact match)
      ];
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []);
          if (table === 'blood_requests') {
            const c = chainable(null, [request]);
            c.update = (payload) => ({ eq: () => { window.__mock.requestUpdate = payload; return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          if (table === 'results_hematology') return chainable({ blood_group: 'A', rh_factor: 'Positive' }, []);
          if (table === 'blood_units') {
            const c = chainable(null, units);
            c.update = (payload) => ({ eq: (col1,val1) => ({ eq: (col2,val2) => { window.__mock.unitUpdate = payload; return Promise.resolve({data:null,error:null}); } }) });
            return c;
          }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl, 'labtech@example.com');
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchBbTab('requests', null));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('bb-requests-body').innerHTML);
    t.check('the patient\'s on-file type (A+) is shown', html.includes('A+'));
    t.check('the incompatible B+ unit is NOT offered as a crossmatch candidate', !html.includes('BB-26-0001'));
    t.check('the compatible O- unit (universal donor) IS offered', html.includes('BB-26-0002'));
    t.check('the compatible A+ exact-match unit IS offered', html.includes('BB-26-0003'));
    await page.evaluate(() => crossmatchUnit('u3', 'r1'));
    await page.waitForTimeout(150);
    const mock = await page.evaluate(() => window.__mock);
    t.check('crossmatching reserves the unit (status -> Crossmatched, linked to the request)', mock.unitUpdate?.status === 'Crossmatched' && mock.unitUpdate?.request_id === 'r1');
    t.check('the request itself is marked Crossmatched too', mock.requestUpdate?.status === 'Crossmatched');
    await page.close();
  }

  return t;
};
