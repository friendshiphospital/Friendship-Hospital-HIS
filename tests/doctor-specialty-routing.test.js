// Covers the new Doctor Specialty Routing + Per-Doctor Consultation Fee
// feature:
//   1. buildAutoInvoiceLines() charging a specific doctor's own
//      doctors.consultation_fee when set, falling back to the Settings
//      default fee for that doctor's doctor_type when it's null, and
//      falling back to the original flat price_list 'Consultation Fee'
//      item exactly as before when no doctor was selected at all.
//   2. loadDoctorQueue() filtering doctor-destined patients by the logged-
//      in doctor's specialty (via patients.doctor_id -> doctors.specialty),
//      an admin seeing everyone unfiltered, and a doctor account with no
//      specialty configured also seeing everyone unfiltered (additive
//      filtering, not a new access restriction).
//   3. populateDoctorDropdown() stamping each real clinic-doctor <option>
//      with data-id so getRegDoctorId() can resolve a specific doctor.
//
// Uses STATEFUL_MOCK_SRC (real per-table eq/in filtering) throughout —
// this feature is fundamentally about resolving matching rows
// (doctor_id -> doctors.specialty, doctors.id -> consultation_fee) and
// reacting differently depending on what's found, which
// CHAINABLE_MOCK_SRC's no-op filters cannot distinguish.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(seedOverrides, localStorageExtra) {
  const seed = {
    tables: {
      staff: [
        { id: 's-a', user_id: 'u-a', full_name: 'Dr A', role: 'doctor', specialty: 'Internal Medicine' },
        { id: 's-b', user_id: 'u-b', full_name: 'Dr B', role: 'doctor', specialty: 'General Surgery' },
        { id: 's-nospec', user_id: 'u-nospec', full_name: 'Dr NoSpec', role: 'doctor', specialty: null },
        { id: 's-admin', user_id: 'u-admin', full_name: 'Admin User', role: 'admin' },
      ],
      doctors: [
        { id: 'doc-a', name: 'Dr. A', specialty: 'Internal Medicine', doctor_type: 'Consultant', consultation_fee: 200 },
        { id: 'doc-b', name: 'Dr. B', specialty: 'General Surgery', doctor_type: 'GP', consultation_fee: 50 },
        { id: 'doc-c', name: 'Dr. C', specialty: 'Cardiology', doctor_type: 'Specialist', consultation_fee: null },
      ],
      price_list: [{ code: 'CON000', price: 100 }],
      patients: [
        { id: 'p1', name: 'Patient IM', visit_destination: 'doctor', doctor_id: 'doc-a', created_at: new Date().toISOString() },
        { id: 'p2', name: 'Patient Surg', visit_destination: 'doctor', doctor_id: 'doc-b', created_at: new Date().toISOString() },
      ],
    },
    users: [
      { id: 'u-a', email: 'dr-a@example.com', password: 'whatever' },
      { id: 'u-b', email: 'dr-b@example.com', password: 'whatever' },
      { id: 'u-nospec', email: 'dr-nospec@example.com', password: 'whatever' },
      { id: 'u-admin', email: 'admin@example.com', password: 'whatever' },
    ],
    ...seedOverrides,
  };
  return `
    ${Object.entries(localStorageExtra || {}).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(String(v))});`).join('\n    ')}
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
  `;
}

async function login(page, baseUrl, email) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('doctor-specialty-routing');

  // ═══════════════════════════════════════════════════════════════════
  // PART 1 — buildAutoInvoiceLines() per-doctor consultation fee
  // ═══════════════════════════════════════════════════════════════════

  // --- TEST 1: a doctor with their own consultation_fee set is charged that exact fee ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl, 'admin@example.com');
    const lines = await page.evaluate(() => buildAutoInvoiceLines([], ['doctor'], 'doc-a'));
    const consult = lines.find(l => l.category === 'consultation');
    t.check('Dr. A (own fee 200, Consultant) is charged 200, not the flat default', consult?.unit_price === 200 && consult?.priced === true);
    await page.close();
  }

  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl, 'admin@example.com');
    const lines = await page.evaluate(() => buildAutoInvoiceLines([], ['doctor'], 'doc-b'));
    const consult = lines.find(l => l.category === 'consultation');
    t.check('Dr. B (own fee 50, GP) is charged 50, not the flat default', consult?.unit_price === 50 && consult?.priced === true);
    await page.close();
  }

  // --- TEST 2: a doctor with NO own fee falls back to the Settings default for their doctor_type ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({}, { cfg_fee_specialist: 75, cfg_fee_gp: 10, cfg_fee_consultant: 300 }));
    await login(page, baseUrl, 'admin@example.com');
    const lines = await page.evaluate(() => buildAutoInvoiceLines([], ['doctor'], 'doc-c'));
    const consult = lines.find(l => l.category === 'consultation');
    t.check('Dr. C (no own fee, Specialist) falls back to CFG.feeSpecialist (75), not GP/Consultant defaults', consult?.unit_price === 75 && consult?.priced === true);
    await page.close();
  }

  // --- TEST 3: no doctor selected at all falls back to the original flat price_list 'Consultation Fee' item exactly as before ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl, 'admin@example.com');
    const linesNoDoctor = await page.evaluate(() => buildAutoInvoiceLines([], ['doctor']));
    const linesNullDoctor = await page.evaluate(() => buildAutoInvoiceLines([], ['doctor'], null));
    const c1 = linesNoDoctor.find(l => l.category === 'consultation');
    const c2 = linesNullDoctor.find(l => l.category === 'consultation');
    t.check('no doctorId argument at all still resolves the flat price_list Consultation Fee (100)', c1?.unit_price === 100 && c1?.priced === true);
    t.check('explicit null doctorId also falls back to the flat price_list Consultation Fee (100)', c2?.unit_price === 100 && c2?.priced === true);
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 2 — loadDoctorQueue() specialty filtering
  // ═══════════════════════════════════════════════════════════════════

  // --- TEST 4: Dr. A (Internal Medicine) sees only the Internal Medicine patient ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl, 'dr-a@example.com');
    await page.evaluate(() => goPage('consultation'));
    await page.evaluate(() => { window._docFilter='doctor'; return loadDoctorQueue(); });
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('doc-queue-body').innerHTML);
    t.check('Dr. A (Internal Medicine) sees the Internal Medicine patient', html.includes('Patient IM'));
    t.check('Dr. A (Internal Medicine) does NOT see the General Surgery patient', !html.includes('Patient Surg'));
    await page.close();
  }

  // --- TEST 5: Dr. B (General Surgery) sees only the General Surgery patient ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl, 'dr-b@example.com');
    await page.evaluate(() => goPage('consultation'));
    await page.evaluate(() => { window._docFilter='doctor'; return loadDoctorQueue(); });
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('doc-queue-body').innerHTML);
    t.check('Dr. B (General Surgery) sees the General Surgery patient', html.includes('Patient Surg'));
    t.check('Dr. B (General Surgery) does NOT see the Internal Medicine patient', !html.includes('Patient IM'));
    await page.close();
  }

  // --- TEST 6: an admin sees every doctor-destined patient unfiltered ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl, 'admin@example.com');
    await page.evaluate(() => goPage('consultation'));
    await page.evaluate(() => { window._docFilter='doctor'; return loadDoctorQueue(); });
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('doc-queue-body').innerHTML);
    t.check('admin sees both the Internal Medicine and General Surgery patients unfiltered', html.includes('Patient IM') && html.includes('Patient Surg'));
    await page.close();
  }

  // --- TEST 7: a doctor account with no specialty configured yet also sees everyone unfiltered (additive filtering, not a new lockout) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl, 'dr-nospec@example.com');
    await page.evaluate(() => goPage('consultation'));
    await page.evaluate(() => { window._docFilter='doctor'; return loadDoctorQueue(); });
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('doc-queue-body').innerHTML);
    t.check('a doctor with no specialty configured sees every doctor-destined patient, same as before this feature existed', html.includes('Patient IM') && html.includes('Patient Surg'));
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART 3 — Registration doctor picker stamps a resolvable doctor id
  // ═══════════════════════════════════════════════════════════════════

  // --- TEST 8: populateDoctorDropdown() stamps data-id, and getRegDoctorId() resolves it ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl, 'admin@example.com');
    await page.evaluate(() => goPage('register'));
    await page.evaluate(() => regGoStep(2)); // "Referring Doctor" lives on step 2 ("Visit & Tests"), hidden (display:none) on step 1 by default
    await page.evaluate(() => populateDoctorDropdown());
    await page.waitForTimeout(100);
    const optionCount = await page.evaluate(() => document.querySelectorAll('#r-doc-clinic-group option').length);
    t.check('the registration doctor dropdown lists all 3 seeded doctors', optionCount === 3);
    await page.selectOption('#r-doc', { label: 'Dr. A — Internal Medicine' });
    const resolvedId = await page.evaluate(() => getRegDoctorId());
    const resolvedName = await page.evaluate(() => getRegDoctor());
    t.check('selecting "Dr. A — Internal Medicine" resolves getRegDoctorId() to doc-a', resolvedId === 'doc-a');
    t.check('getRegDoctor() (unchanged, backward-compatible) still returns the plain name "Dr. A"', resolvedName === 'Dr. A');
    await page.selectOption('#r-doc', { value: '' });
    const noneId = await page.evaluate(() => getRegDoctorId());
    t.check('"Select…" (no doctor chosen) resolves getRegDoctorId() to null', noneId === null);
    await page.close();
  }

  return t;
};
