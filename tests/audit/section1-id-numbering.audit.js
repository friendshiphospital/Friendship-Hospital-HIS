// Functional audit, Section 1: Core ID/Numbering System.
// Real Playwright browser interaction against a stateful in-memory mock
// backend (tests/helpers/stateful-mock.js) -- registers real patients
// through the real registration wizard, reads back the real DOM/response
// state, and reports what actually happened. Not a re-read of the source.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function initScript(seedOverrides) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Admin', role: 'admin' }] },
    users: [{ id: 'u1', email: 'admin@audit.local', password: 'whatever' }],
    idStart: { mrn: 500, opd: 200, ip: 100, lab_number: 300, radiology_number: 400 },
    ...seedOverrides,
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
  `;
}

async function login(page, baseUrl, seedOverrides) {
  await page.addInitScript(initScript(seedOverrides));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'admin@audit.local');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(400);
}

async function openShift(page) {
  await page.evaluate(() => { if (typeof openShiftModal === 'function') openShiftModal(); });
  await page.waitForTimeout(100);
  await page.evaluate(() => submitOpenShift());
  await page.waitForTimeout(200);
}

async function registerPatient(page, { fname, sex, phone, patientType, destinations, radType }) {
  await page.evaluate(() => goPage('register'));
  await page.waitForTimeout(150);
  await page.evaluate(() => regGoStep(1));
  await page.waitForTimeout(50);
  // Step 1: identity
  await page.fill('#r-fname', fname);
  await page.selectOption('#r-sex', sex);
  await page.fill('#r-phone', phone);
  const step1NextEnabled = await page.evaluate(() => !document.getElementById('reg-step1-next')?.disabled);
  await page.evaluate(() => regGoStep(2));
  await page.waitForTimeout(100);
  // Step 2: visit details -- patient type, destinations, consent
  if (patientType === 'Inpatient') {
    await page.selectOption('#r-patient-type', 'Inpatient');
  }
  for (const d of destinations) {
    await page.evaluate((dest) => setDest(dest), d);
  }
  if (radType) {
    await page.selectOption('#r-rad-type', radType);
  }
  await page.check('#r-consent');
  await page.evaluate(() => regGoStep(3));
  await page.waitForTimeout(100);
  // Step 3: payment & confirmation -- submit
  await page.evaluate(() => submitRegistration());
  await page.waitForTimeout(300);
  // Mirror the real receptionist workflow: the success panel's "Register
  // Another Patient" button is the only thing that resets wizard state
  // (_regDestinations, checkboxes, etc.) -- confirmed by reading clearRegForm()
  // and initRegForm(); simply navigating back to Register via the sidebar does
  // NOT reset it (a real finding, logged separately for Section 4/Reception).
  await page.evaluate(() => { if (typeof clearRegForm === 'function') { clearRegForm(); hidRegSuccess(); } });
  return { step1NextEnabled };
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // --- 1a: sequential MRN + OPD file number across two fresh registrations ---
  {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await login(page, baseUrl);
    await openShift(page);
    await registerPatient(page, { fname: 'AuditPatientOne', sex: 'Male', phone: '0911111111', destinations: ['lab'] });
    // Read back directly from the mock's in-memory table via the sb client the app is using.
    const patients1 = await page.evaluate(async () => {
      const { data } = await sb.from('patients').select('*');
      return data;
    });
    await registerPatient(page, { fname: 'AuditPatientTwo', sex: 'Female', phone: '0922222222', destinations: ['lab'] });
    const patients2 = await page.evaluate(async () => {
      const { data } = await sb.from('patients').select('*');
      return data;
    });
    const p1 = patients1[0], p2 = patients2.find(p => p.name && p.name.includes('AuditPatientTwo'));
    if (errors.length) log('1a', 'FAIL', 'Page threw errors during registration: ' + errors.join('; '));
    else if (!p1 || !p2) log('1a', 'FAIL', 'Registration did not produce readable patient rows (p1=' + JSON.stringify(p1) + ', p2=' + JSON.stringify(p2) + ')');
    else {
      const mrnOk = p1.mrn === '501' && p2.mrn === '502';
      const visitOk = p1.visit_no === '201' && p2.visit_no === '202';
      const labOk = p1.lab_no === '301' && p2.lab_no === '302';
      log('1a', (mrnOk && visitOk && labOk) ? 'PASS' : 'PARTIAL',
        `Patient 1: mrn=${p1.mrn}, visit_no=${p1.visit_no}, lab_no=${p1.lab_no}. Patient 2: mrn=${p2.mrn}, visit_no=${p2.visit_no}, lab_no=${p2.lab_no}. Expected mrn 501/502, visit_no 201/202, lab_no 301/302 (seeded ID_START mrn:500/opd:200/lab:300).`);
    }
    await page.close();
  }

  // --- 1b: Inpatient admission uses the separate 'ip' counter, not 'opd' ---
  {
    const page = await context.newPage();
    await login(page, baseUrl);
    await openShift(page);
    await registerPatient(page, { fname: 'AuditInpatient', sex: 'Male', phone: '0933333333', patientType: 'Inpatient', destinations: ['admission'] });
    const patients = await page.evaluate(async () => { const { data } = await sb.from('patients').select('*'); return data; });
    const ip = patients.find(p => p.name && p.name.includes('AuditInpatient'));
    if (!ip) log('1b', 'FAIL', 'Inpatient registration produced no readable patient row.');
    else {
      const ok = ip.visit_no === '101'; // ID_START.ip = 100
      log('1b', ok ? 'PASS' : 'PARTIAL', `Inpatient visit_no=${ip.visit_no} (expected 101, from the separate ID_START.ip=100 counter, not the OPD counter which was already past 200).`);
    }
    await page.close();
  }

  // --- 1c: Radiology number generated on a radiology-destination registration ---
  {
    const page = await context.newPage();
    await login(page, baseUrl);
    await openShift(page);
    await registerPatient(page, { fname: 'AuditRadPatient', sex: 'Female', phone: '0944444444', destinations: ['radiology'], radType: 'X-Ray — Chest PA' });
    const requests = await page.evaluate(async () => { const { data } = await sb.from('radiology_requests').select('*'); return data; });
    const req = requests[0];
    if (!req) log('1c', 'FAIL', 'No radiology_requests row was created for a Radiology-destination registration.');
    else {
      const ok = req.radiology_no === '401'; // ID_START.radiology_number = 400
      log('1c', ok ? 'PASS' : 'PARTIAL', `radiology_no=${req.radiology_no} (expected 401, from ID_START.radiology_number=400).`);
    }
    await page.close();
  }

  // --- 1d: self-healing MAX()+1 safety net -- generate_next_id RPC forced to fail,
  // client-side fallback must not collide with an existing higher lab_no already on record ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Admin', role: 'admin' }],
        // A pre-existing patient with a lab_no far ahead of the counter start,
        // simulating a real deployment's data that the counter table doesn't know about yet.
        patients: [{ id: 'preexisting-1', mrn: '600', lab_no: '350', name: 'Pre-existing Patient', patient_type: 'Outpatient' }],
      },
    });
    await page.evaluate(() => {
      // Force the RPC path to fail, forcing getNextNumber() down its documented
      // client-side self-healing fallback (computeDataMax + id_counters).
      const real = sb.rpc.bind(sb);
      sb.rpc = (name, args) => name === 'generate_next_id' ? Promise.resolve({ data: null, error: { message: 'function not found' } }) : real(name, args);
    });
    const nextLabNo = await page.evaluate(async () => await getNextNumber('lab_number'));
    const ok = parseInt(nextLabNo, 10) > 350;
    log('1d', ok ? 'PASS' : 'FAIL', `With the RPC forced to fail and an existing lab_no=350 on record (higher than the seeded counter), getNextNumber('lab_number') returned "${nextLabNo}" -- ${ok ? 'correctly stays above the real existing maximum' : 'DID NOT stay above the existing maximum, meaning a real collision would occur'}.`);
    await page.close();
  }

  // --- 1e: true offline fallback (no Supabase client at all) ---
  {
    const page = await context.newPage();
    await login(page, baseUrl);
    const offlineId = await page.evaluate(async () => {
      const saved = window.sb;
      sb = null;
      const result = await getNextNumber('mrn');
      sb = saved;
      return result;
    });
    const ok = /^\d{7}$/.test(offlineId) && parseInt(offlineId, 10) >= 1000000;
    log('1e', ok ? 'PASS' : 'FAIL', `With sb=null (fully offline, no live counter reachable), getNextNumber('mrn') returned "${offlineId}" -- ${ok ? 'correctly a 7-digit out-of-range temporary marker per the documented offline-fallback design' : 'did not match the documented offline-fallback shape'}.`);
    await page.close();
  }

  return findings;
};
