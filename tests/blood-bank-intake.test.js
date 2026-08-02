// Covers Blood Bank Phase 2: dual-source unit intake. Both the In-House
// Donation path (donor registration, eligibility questionnaire, mandatory
// 5-test infectious-disease screening before a unit can leave Quarantined)
// and the External Receipt path (lighter intake, but a mandatory
// Verified-on-Receipt confirmation before Available) must exist and both
// converge on the same blood_units status lifecycle from Phase 1.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function baseMockTables(extra) {
  return `
    if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []);
    ${extra || ''}
    return chainable(null, []);
  `;
}

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => { ${baseMockTables()} },
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
  const t = makeSuite('blood-bank-intake');

  // --- TEST 1: both intake paths exist in the UI; toggling source shows/hides the right form ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchBbTab('intake', null));
    await page.waitForTimeout(100);
    const initial = await page.evaluate(() => ({
      donationVisible: document.getElementById('bb-intake-donation').style.display !== 'none',
      externalVisible: document.getElementById('bb-intake-external').style.display === 'none',
    }));
    t.check('In-House Donation is the default visible path', initial.donationVisible);
    t.check('External Receipt form is hidden while Donation is selected', initial.externalVisible);
    await page.evaluate(() => { document.getElementById('bb-intake-source').value = 'Received - External Supply'; switchBbIntakeSource(); });
    const afterToggle = await page.evaluate(() => ({
      donationHidden: document.getElementById('bb-intake-donation').style.display === 'none',
      externalVisible: document.getElementById('bb-intake-external').style.display !== 'none',
    }));
    t.check('switching source hides the Donation path', afterToggle.donationHidden);
    t.check('switching source shows the External Receipt path', afterToggle.externalVisible);
    await page.close();
  }

  // --- TEST 2: the "Enable In-House Donor Collection" Settings toggle hides Path A entirely when off ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => { CFG.bloodDonorCollectionEnabled = false; });
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchBbTab('intake', null));
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => ({
      donationOptionHidden: document.querySelector('#bb-intake-source option[value="In-House Donation"]').style.display === 'none',
      sourceForcedExternal: document.getElementById('bb-intake-source').value === 'Received - External Supply',
      donationFormHidden: document.getElementById('bb-intake-donation').style.display === 'none',
    }));
    t.check('the In-House Donation option is hidden from the source dropdown', state.donationOptionHidden);
    t.check('the source is forced to External Receipt', state.sourceForcedExternal);
    t.check('the donor-registration UI is not shown at all', state.donationFormHidden);
    // localStorage (and therefore CFG) is shared across all pages in this
    // browser context — reset it so later tests in this file get the
    // default (donation collection enabled) rather than inheriting this
    // test's override.
    await page.evaluate(() => { CFG.bloodDonorCollectionEnabled = true; });
    await page.close();
  }

  // --- TEST 3: registering a new donor inserts into blood_donors with a generated donor number ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { donorInsert: null };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []);
          if (table === 'blood_donors') {
            const c = chainable(null, []);
            c.insert = (payload) => { window.__mock.donorInsert = payload; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'd1', donor_no: payload.donor_no, ...payload }, error: null }) }) }; };
            return c;
          }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchBbTab('intake', null));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      showNewDonorForm();
      document.getElementById('bbd-name').value = 'John Donor';
      document.getElementById('bbd-phone').value = '0911111111';
      document.getElementById('bbd-group').value = 'O';
      document.getElementById('bbd-rh').value = 'Negative';
    });
    await page.evaluate(() => registerBloodDonor());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.donorInsert);
    t.check('registerBloodDonor() inserts the donor with a generated donor_no', insert?.full_name === 'John Donor' && /^DNR-/.test(insert?.donor_no || ''));
    const selectedGroup = await page.evaluate(() => document.getElementById('bb-unit-group').value);
    t.check('registering the donor auto-fills the unit blood group from the donor\'s on-file type', selectedGroup === 'O');
    await page.close();
  }

  // --- TEST 4: In-House Donation intake creates a donation row AND a blood_units row, both starting Quarantined ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { donationInsert: null, unitsInsert: null };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []);
          if (table === 'blood_donations') {
            const c = chainable(null, []);
            c.insert = (payload) => { window.__mock.donationInsert = payload; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'don1', ...payload }, error: null }) }) }; };
            return c;
          }
          if (table === 'blood_units') {
            const c = chainable(null, []);
            c.insert = (payload) => { window.__mock.unitsInsert = payload; return Promise.resolve({ data: payload, error: null }); };
            return c;
          }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchBbTab('intake', null));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      selectBloodDonor({ id: 'd1', full_name: 'Jane Donor', donor_no: 'DNR-26-0001', blood_group: 'A', rh_factor: 'Positive' });
      document.getElementById('bb-unit-group').value = 'A';
      document.getElementById('bb-unit-rh').value = 'Positive';
      document.getElementById('bb-unit-component').value = 'Packed RBC';
      document.getElementById('bb-unit-expiry').value = '2026-09-15';
      document.getElementById('bb-unit-volume').value = '350';
    });
    await page.evaluate(() => submitBloodIntake());
    await page.waitForTimeout(150);
    const mock = await page.evaluate(() => window.__mock);
    t.check('a blood_donations row is created, linked to the selected donor', mock.donationInsert?.donor_id === 'd1');
    t.check('a blood_units row is created for the donation, starting Quarantined', mock.unitsInsert?.[0]?.status === 'Quarantined' && mock.unitsInsert?.[0]?.donation_id === 'don1');
    t.check('the unit carries the donation-path source', mock.unitsInsert?.[0]?.source === 'In-House Donation');
    await page.close();
  }

  // --- TEST 5: a donation only clears (and its units only move to Available) once ALL 5 screening tests are Negative ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { donationUpdate: null, unitsUpdated: false };
      const pendingDonation = { id: 'don1', collection_date: '2026-08-01', recent_illness: false, on_medication: false, recent_travel: false, prior_deferral: false, cleared: false, blood_donors: { full_name: 'Jane Donor', donor_no: 'DNR-26-0001' } };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []);
          if (table === 'blood_donations') {
            const c = chainable(null, [pendingDonation]);
            c.update = (payload) => ({ eq: () => { window.__mock.donationUpdate = payload; return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          if (table === 'blood_units') {
            const c = chainable(null, []);
            c.update = (payload) => ({ eq: () => ({ eq: () => { if (payload.status === 'Available') window.__mock.unitsUpdated = true; return Promise.resolve({data:null,error:null}); } }) });
            return c;
          }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchBbTab('pending', null));
    await page.waitForTimeout(150);
    // Leave one test as 'Pending' (not all Negative) and attempt to clear.
    await page.evaluate(() => {
      ['hiv','hbv','hcv','syphilis'].forEach(x => { document.getElementById('bb-screen-don1-'+x).value = 'Negative'; });
      // malaria left at default 'Pending'
      clearDonationScreening('don1');
    });
    await page.waitForTimeout(150);
    const partial = await page.evaluate(() => window.__mock);
    t.check('with one test still Pending, the donation is recorded but NOT cleared', partial.donationUpdate?.cleared === false);
    t.check('units are NOT moved to Available while the donation is uncleared', partial.unitsUpdated === false);
    // clearDonationScreening() reloads the pending-donations list on every
    // call, which re-renders (and resets) the bb-screen-don1-* selects —
    // so all five need setting again here, not just the one that changed.
    await page.evaluate(() => {
      ['hiv','hbv','hcv','syphilis','malaria'].forEach(x => { document.getElementById('bb-screen-don1-'+x).value = 'Negative'; });
      clearDonationScreening('don1');
    });
    await page.waitForTimeout(150);
    const full = await page.evaluate(() => window.__mock);
    t.check('once all 5 tests are Negative, the donation is cleared', full.donationUpdate?.cleared === true);
    t.check('clearing the donation moves its linked (Quarantined) units to Available', full.unitsUpdated === true);
    await page.close();
  }

  // --- TEST 6: External Receipt intake requires the supplier org/reference, and a unit stays Quarantined until Verified on Receipt ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { unitsInsert: null, verifyUpdate: null };
      const externalUnit = { id: 'u1', unit_no: 'BB-26-0009', blood_group: 'B', rh_factor: 'Positive', component_type: 'FFP', external_source_org: 'Regional Blood Centre', external_unit_ref: 'RBC-9981', verified_on_receipt: false };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []);
          if (table === 'blood_units') {
            const c = chainable(null, [externalUnit]);
            c.insert = (payload) => { window.__mock.unitsInsert = payload; return Promise.resolve({ data: payload, error: null }); };
            c.update = (payload) => ({ eq: () => { window.__mock.verifyUpdate = payload; return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    page.on('dialog', d => d.accept());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('bloodbank'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchBbTab('intake', null));
    await page.waitForTimeout(100);
    // Attempt submit with missing org/ref -> blocked.
    await page.evaluate(() => {
      document.getElementById('bb-intake-source').value = 'Received - External Supply';
      switchBbIntakeSource();
      document.getElementById('bb-unit-group').value = 'B';
      document.getElementById('bb-unit-rh').value = 'Positive';
      document.getElementById('bb-unit-component').value = 'FFP';
      document.getElementById('bb-unit-expiry').value = '2027-01-01';
    });
    await page.evaluate(() => submitBloodIntake());
    await page.waitForTimeout(100);
    const blocked = await page.evaluate(() => window.__mock.unitsInsert);
    t.check('External Receipt intake is blocked without the supplying org and their unit reference', blocked === null);
    // Fill them in and submit for real.
    await page.evaluate(() => {
      document.getElementById('bbe-org').value = 'Regional Blood Centre';
      document.getElementById('bbe-ref').value = 'RBC-9981';
    });
    await page.evaluate(() => submitBloodIntake());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.unitsInsert);
    t.check('a valid External Receipt intake creates a unit starting Quarantined', insert?.[0]?.status === 'Quarantined' && insert?.[0]?.source === 'Received - External Supply');
    // Now verify on receipt.
    await page.evaluate(() => switchBbTab('pending', null));
    await page.waitForTimeout(150);
    await page.evaluate(() => verifyUnitOnReceipt('u1'));
    await page.waitForTimeout(150);
    const verify = await page.evaluate(() => window.__mock.verifyUpdate);
    t.check('verifyUnitOnReceipt() moves the unit to Available and stamps who/when verified', verify?.status === 'Available' && verify?.verified_on_receipt === true && !!verify?.verified_by);
    await page.close();
  }

  return t;
};
