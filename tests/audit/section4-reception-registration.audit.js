// Functional audit, Section 4: Reception & Registration.
// Real Playwright browser interaction: duplicate-phone detection, the
// payment gate (hard block + STAT deferral), returning-patient search,
// appointments booking, and follow-up pricing at re-registration.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function initScript(seedOverrides) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Reception', role: 'receptionist' }] },
    users: [{ id: 'u1', email: 'receptionist@audit.local', password: 'whatever' }],
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
  await page.fill('#auth-email', 'receptionist@audit.local');
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

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // --- 4a: duplicate-phone detection while typing in the registration wizard ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Reception', role: 'receptionist' }],
        patients: [{ id: 'existing-1', mrn: '480', name: 'Existing Patient', first_name: 'Existing', last_name: 'Patient', phone: '0955512345', sex: 'Male', age: '40', age_unit: 'Years', created_at: new Date().toISOString() }],
      },
    });
    await openShift(page);
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(150);
    await page.evaluate(() => regGoStep(1));
    await page.waitForTimeout(50);
    await page.fill('#r-phone', '0955512345');
    // onPhoneNumberInput debounces 500ms before searching.
    await page.waitForTimeout(900);
    const hintText = await page.evaluate(() => document.getElementById('r-phone-check-hint')?.textContent);
    const resultsVisible = await page.evaluate(() => document.getElementById('reg-existing-results')?.style.display === 'block');
    const resultsText = await page.evaluate(() => document.getElementById('reg-existing-results')?.textContent || '');
    log('4a', (resultsVisible && resultsText.includes('Existing Patient') && hintText?.includes('Found existing record')) ? 'PASS' : 'FAIL',
      `Typing a phone number matching an existing patient produced hint: "${hintText}", with results box showing: "${resultsText.slice(0, 120)}".`);
    await page.close();
  }

  // --- 4b: selecting a suggested duplicate reuses the existing MRN and pre-fills demographics ---
  {
    const page = await context.newPage();
    await login(page, baseUrl, {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Reception', role: 'receptionist' }],
        patients: [{ id: 'existing-2', mrn: '481', name: 'Jane Returning', first_name: 'Jane', last_name: 'Returning', phone: '0966698765', sex: 'Female', age: '29', age_unit: 'Years', created_at: new Date().toISOString() }],
      },
    });
    await openShift(page);
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(150);
    await page.evaluate(() => regGoStep(1));
    await page.waitForTimeout(50);
    await page.evaluate(() => searchExistingFilePatient('481'));
    await page.waitForTimeout(200);
    await page.evaluate(() => selectExistingFilePatient('481'));
    await page.waitForTimeout(200);
    const mrnField = await page.evaluate(() => document.getElementById('r-existing-mrn')?.value);
    const fnameField = await page.evaluate(() => document.getElementById('r-fname')?.value);
    log('4b', (mrnField === '481' && fnameField === 'Jane') ? 'PASS' : 'FAIL',
      `Selecting a returning patient from search results set r-existing-mrn="${mrnField}" and pre-filled r-fname="${fnameField}" (expected 481 / Jane).`);
    await page.close();
  }

  // --- 4c: payment gate hard-blocks a non-STAT order for an unpaid patient ---
  {
    const page = await context.newPage();
    await login(page, baseUrl);
    await page.evaluate(() => {
      _docPt = { id: 'unpaid-1', name: 'Unpaid Patient', payment_status: 'unpaid', tests_requested: [] };
    });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchDocTab('orders', null));
    await page.waitForTimeout(150);
    await page.evaluate(() => { const el = document.getElementById('ord-lab-priority'); if (el) el.value = 'Routine'; });
    const checkboxFound = await page.evaluate(() => { const c = document.querySelector('.order-test-chk'); if (c) { c.checked = true; return true; } return false; });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(200);
    const orders = await page.evaluate(async () => { const { data } = await sb.from('doctor_orders').select('*'); return data; });
    const toastText = await page.evaluate(() => { const t = [...document.querySelectorAll('#toast-wrap .toast')]; return t.length ? t[t.length - 1].textContent : null; });
    log('4c', (orders.length === 0 && toastText?.includes('blocked')) ? 'PASS' : 'FAIL',
      `Routine lab order for an unpaid patient (test checkbox found and checked=${checkboxFound}): orders created=${orders.length} (expected 0), toast: "${toastText}".`);
    await page.close();
  }

  // --- 4d: STAT payment deferral -- confirm() dialog offered, accepting lets the order proceed ---
  {
    const page = await context.newPage();
    await login(page, baseUrl);
    let dialogMessage = null;
    page.on('dialog', async (dialog) => {
      // Real confirm() dialog from checkPaymentGate's STAT deferral path.
      dialogMessage = dialog.message();
      await dialog.accept();
    });
    await page.evaluate(() => {
      _docPt = { id: 'unpaid-2', name: 'Unpaid STAT Patient', payment_status: 'unpaid', tests_requested: [] };
    });
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(150);
    await page.evaluate(() => switchDocTab('orders', null));
    await page.waitForTimeout(150);
    await page.evaluate(() => { const el = document.getElementById('ord-lab-priority'); if (el) el.value = 'STAT'; });
    const checkboxResult = await page.evaluate(() => {
      const panelHtml = document.getElementById('doc-order-tests')?.innerHTML?.length || 0;
      const c = document.querySelector('.order-test-chk');
      if (c) { c.checked = true; return { found: true, checked: c.checked, panelHtml }; }
      return { found: false, panelHtml };
    });
    await page.evaluate(() => submitLabOrder());
    await page.waitForTimeout(300);
    const orders = await page.evaluate(async () => { const { data } = await sb.from('doctor_orders').select('*'); return data; });
    const order = orders[0];
    const lastToast = await page.evaluate(() => { const t = [...document.querySelectorAll('#toast-wrap .toast')]; return t.length ? t[t.length - 1].textContent : null; });
    log('4d', (orders.length > 0 && order?.payment_deferred === true) ? 'PASS' : 'FAIL',
      `STAT lab order for an unpaid patient, deferral accepted via the confirm() dialog: checkbox=${JSON.stringify(checkboxResult)}, dialogSeen="${dialogMessage}", orders created=${orders.length}, payment_deferred=${order?.payment_deferred}, last toast="${lastToast}".`);
    await page.close();
  }

  // --- 4e: appointment booking ---
  {
    const page = await context.newPage();
    await login(page, baseUrl);
    await openShift(page);
    await page.evaluate(() => goPage('appointments'));
    await page.waitForTimeout(150);
    await page.fill('#appt-name', 'Audit Appt Patient');
    await page.fill('#appt-phone', '0977712345');
    await page.fill('#appt-date', '2026-09-01');
    await page.evaluate(() => saveAppointment());
    await page.waitForTimeout(200);
    const appts = await page.evaluate(async () => { const { data } = await sb.from('appointments').select('*'); return data; });
    log('4e', (appts.length === 1 && appts[0].patient_name === 'Audit Appt Patient' && appts[0].status === 'Booked') ? 'PASS' : 'FAIL',
      `Booked one appointment via the real form: ${JSON.stringify(appts[0] || {})}.`);
    await page.close();
  }

  // --- 4f: follow-up pricing prompt at re-registration ---
  // This calls checkAndApplyFollowUpPricing(mrn) directly (the same function
  // submitRegistration() calls for a returning patient) rather than driving
  // the full two-registration UI flow, since the function itself is a
  // self-contained confirm()-gated unit -- still real app code under real
  // interaction, just entered at the function boundary instead of two full
  // registrations worth of form-filling.
  {
    const page = await context.newPage();
    const today = new Date();
    const targetDate = new Date(today); targetDate.setDate(targetDate.getDate() + 2); // within any reasonable window default
    const targetDateStr = targetDate.toISOString().slice(0, 10);
    await login(page, baseUrl, {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Reception', role: 'receptionist' }],
        follow_ups: [{ id: 'fu-1', patient_mrn: '490', used: false, target_date: targetDateStr, reason: 'Post-op review', scheduled_by_name: 'Dr. Audit' }],
      },
    });
    let dialogMessage = null;
    page.on('dialog', async (dialog) => { dialogMessage = dialog.message(); await dialog.accept(); });
    const result = await page.evaluate(() => checkAndApplyFollowUpPricing('490'));
    log('4f', (dialogMessage?.includes('follow-up scheduled') && dialogMessage?.includes('Post-op review') && result?.followUpId === 'fu-1') ? 'PASS' : 'FAIL',
      `Re-registering MRN 490 (which has an open follow-up due ${targetDateStr}, within the pricing window) surfaced a confirm() prompt: "${dialogMessage}". Accepting returned ${JSON.stringify(result)} (expected followUpId: fu-1).`);
    await page.close();
  }

  return findings;
};
