// Covers Phase 3 of the Bed Management (IPD) overhaul: extending the
// EXISTING #adm-detail-ov drawer (opened via openAdmDetail(), already had
// Overview/Lab Orders/Vital Signs/Orders/Theatre tabs) with a live LOS
// counter, a Medications tab that deep-links into the existing Nursing MAR
// (not a rebuild), a genuinely-new Transfer tab, and a Discharge action
// that calls the existing openDischarge() rather than reimplementing it.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function twoDaysAgoIso() {
  const d = new Date(); d.setDate(d.getDate() - 2); d.setHours(d.getHours() - 5);
  return d.toISOString();
}

const ADM = {
  id: 'a1', ward: 'Medical', room: '101', bed: '1', patient_id: 'p1',
  admission_no: 'ADM-1', admission_type: 'Emergency', admitting_doctor: 'Dr X',
  primary_diagnosis: 'Pneumonia', notes: '', admission_date: twoDaysAgoIso(), status: 'Active',
  patients: { id: 'p1', name: 'John Doe', mrn: 'M1', age: 40, age_unit: 'y', sex: 'Male' },
};
const BEDS = [
  { id: 'b1', ward: 'Medical', room: '101', bed_number: '1', status: 'Occupied', current_patient_id: 'p1', current_admission_id: 'a1' },
  { id: 'b2', ward: 'ICU', room: '201', bed_number: '1', status: 'Available', current_patient_id: null, current_admission_id: null },
];
const MAR_VITALS = [
  { recorded_at: '2026-08-01T09:00:00Z', recorded_by: 'Nurse Amina', mar_entries: [{ drug: 'Ceftriaxone', dose: '1g', route: 'IV', status: 'Given' }] },
];

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Nurse Test', role: 'nurse' }, []);
        if (table === 'admissions') return chainable(${JSON.stringify(ADM)}, [${JSON.stringify(ADM)}]);
        if (table === 'beds') return chainable(null, ${JSON.stringify(BEDS)});
        if (table === 'vital_signs') return chainable(null, ${JSON.stringify(MAR_VITALS)});
        if (table === 'doctor_orders') return chainable(null, []);
        if (table === 'bed_transfers') return chainable(null, []);
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
  const t = makeSuite('bed-detail-drawer');

  // --- TEST 1: opening the drawer shows the new tabs, the Discharge action, and a live LOS counter ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => openAdmDetail('a1'));
    await page.waitForTimeout(200);
    const tabLabels = await page.evaluate(() => Array.from(document.querySelectorAll('#adm-detail-ov .tab')).map(b => b.textContent));
    t.check('the drawer now has a Medications tab', tabLabels.some(l => l.includes('Medications')));
    t.check('the drawer now has a Transfer tab', tabLabels.some(l => l.includes('Transfer')));
    t.check('the original Overview/Labs/Vitals/Orders/Theatre tabs are all still present (nothing removed)', ['Overview','Lab Orders','Vital Signs','Orders','Theatre'].every(x => tabLabels.some(l => l.includes(x))));
    const hasDischargeBtn = await page.evaluate(() => !!document.querySelector('#adm-detail-ov [onclick="dischargeFromAdmDetail()"]'));
    t.check('the drawer header has a Discharge action', hasDischargeBtn);
    const los = await page.evaluate(() => document.getElementById('adm-detail-los')?.textContent || '');
    t.check('a live LOS counter is shown (2 days ago -> "2d")', /^2d/.test(los));
    await page.close();
  }

  // --- TEST 2: Medications tab shows recent MAR entries and a link to the full MAR ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => openAdmDetail('a1'));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('adm-detail-meds').innerHTML);
    t.check('the Medications tab lists the recorded MAR entry (drug name)', html.includes('Ceftriaxone'));
    t.check('the Medications tab offers a link to the full MAR rather than re-entry fields', html.includes('Open Full MAR'));
    await page.close();
  }

  // --- TEST 3: "Open Full MAR" deep-links into the EXISTING Nursing Medications tab for this patient ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => openAdmDetail('a1'));
    await page.waitForTimeout(200);
    await page.evaluate(() => openMarForAdmPatient());
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({
      onNursingPage: document.getElementById('page-nursing')?.classList.contains('active'),
      medsTabVisible: document.getElementById('nrs-tab-meds')?.style.display !== 'none',
      vsPtId: document.getElementById('vs-pt-id')?.value,
      drawerClosed: !document.getElementById('adm-detail-ov')?.classList.contains('open'),
    }));
    t.check('navigates to the Nursing page', state.onNursingPage);
    t.check('lands directly on the Medications (MAR) tab', state.medsTabVisible);
    t.check('the correct patient id is wired into the existing MAR patient-scoping field', state.vsPtId === 'p1');
    t.check('the admission drawer closes behind it', state.drawerClosed);
    await page.close();
  }

  // --- TEST 4: Transfer tab is populated with the actually-configured wards ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => openAdmDetail('a1'));
    await page.waitForTimeout(200);
    const wardOpts = await page.evaluate(() => Array.from(document.getElementById('xfer-ward').options).map(o => o.textContent));
    t.check('the Transfer ward dropdown includes the configured wards', wardOpts.includes('Medical') && wardOpts.includes('ICU'));
    const currentLine = await page.evaluate(() => document.getElementById('adm-detail-transfer').textContent);
    t.check('the Transfer tab shows the patient\'s current bed for reference', currentLine.includes('Medical') && currentLine.includes('101'));
    await page.close();
  }

  // --- TEST 5: submitting a transfer logs it, updates the admission, and re-points both beds ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { transferInsert: null, admUpdate: null, bedUpdates: [] };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Nurse Test', role: 'nurse' }, []);
          if (table === 'admissions') {
            const c = chainable(${JSON.stringify(ADM)}, [${JSON.stringify(ADM)}]);
            c.update = (payload) => ({ eq: () => { window.__mock.admUpdate = payload; return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          if (table === 'beds') {
            const c = chainable(null, ${JSON.stringify(BEDS)});
            c.update = (payload) => {
              const rec = { payload, eqs: [] };
              const chain = { eq(col,val){ rec.eqs.push([col,val]); return chain; }, then(resolve){ window.__mock.bedUpdates.push(rec); return resolve({data:null,error:null}); } };
              return chain;
            };
            return c;
          }
          if (table === 'bed_transfers') {
            const c = chainable(null, []);
            c.insert = (payload) => { window.__mock.transferInsert = payload; return Promise.resolve({data:[payload],error:null}); };
            return c;
          }
          if (table === 'vital_signs') return chainable(null, ${JSON.stringify(MAR_VITALS)});
          if (table === 'doctor_orders') return chainable(null, []);
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => openAdmDetail('a1'));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.getElementById('xfer-ward').value = 'ICU';
      document.getElementById('xfer-room').innerHTML = '<option>201</option>';
      document.getElementById('xfer-room').value = '201';
      document.getElementById('xfer-bed').innerHTML = '<option>1</option>';
      document.getElementById('xfer-bed').value = '1';
      document.getElementById('xfer-reason').value = 'Deteriorating — requires ICU level care';
    });
    await page.evaluate(() => submitBedTransfer());
    await page.waitForTimeout(200);
    const mock = await page.evaluate(() => window.__mock);
    t.check('a bed_transfers row is logged with the reason and both locations', mock.transferInsert?.reason === 'Deteriorating — requires ICU level care' && mock.transferInsert?.to_ward === 'ICU' && mock.transferInsert?.from_ward === 'Medical');
    t.check('the admission\'s ward/room/bed is updated to the new location', mock.admUpdate?.ward === 'ICU' && mock.admUpdate?.room === '201' && mock.admUpdate?.bed === '1');
    t.check('both the old bed (freed) and new bed (occupied) are updated', mock.bedUpdates.length === 2 && mock.bedUpdates.some(u => u.payload.status === 'Available') && mock.bedUpdates.some(u => u.payload.status === 'Occupied'));
    await page.close();
  }

  // --- TEST 6: the drawer's Discharge action calls the EXISTING openDischarge(), not a rebuilt flow ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => openAdmDetail('a1'));
    await page.waitForTimeout(200);
    // Override AFTER page load — index.html's own `function openDischarge`
    // declaration would otherwise clobber a pre-load window.* mock.
    await page.evaluate(() => { window.__dischargeCalls = []; window.openDischarge = (id) => { window.__dischargeCalls.push(id); }; });
    await page.evaluate(() => dischargeFromAdmDetail());
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__dischargeCalls);
    const drawerClosed = await page.evaluate(() => !document.getElementById('adm-detail-ov')?.classList.contains('open'));
    t.check('discharging from the drawer calls the existing openDischarge() with the admission id', calls.length === 1 && calls[0] === 'a1');
    t.check('the admission drawer closes first', drawerClosed);
    await page.close();
  }

  return t;
};
