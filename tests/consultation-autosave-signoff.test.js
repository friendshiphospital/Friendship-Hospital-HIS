// Covers a reported bug: "Save notes first" error persisting after
// notes were actually saved. Live reproduction (via both the Doctor Queue
// AND the Consultation search box) found the previously-known root cause
// (searchDocPatient() passing a bare id string instead of the full patient
// object) already fixed — a clean save-then-complete round trip worked in
// both cases. The reported friction is real anyway: Complete & Sign Off
// required a separate, prior manual Save click, an easy way to hit this
// exact confusing error if a doctor clicked Complete first. Fixed by having
// completeAndSignOffVisit() auto-save any unsaved Notes-tab edits
// (_docNotesDirty, set by a delegated input/change listener scoped to
// #doc-tab-notes) before checking for an existing consultation row, reusing
// saveConsultation()'s own logic — so it's now one action regardless of
// click order, while a genuinely note-less attempt still blocks with the
// same clear error.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  const now = new Date().toISOString();
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: 'doctor' }],
      patients: [{ id: 'p1', name: 'Test Patient', mrn: 'M1', lab_no: 'L1', age: 30, age_unit: 'Years', sex: 'Male', visit_destination: 'doctor', visit_status: 'Registered', payment_status: 'paid', created_at: now }],
    },
    users: [{ id: 'u1', email: 'doc@example.com', password: 'whatever' }],
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
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

async function captureToasts(page, fnName) {
  const toasts = [];
  await page.exposeFunction(fnName, (m) => toasts.push(m));
  await page.evaluate((fn) => {
    const orig = window.toast;
    window.toast = function (msg, kind) { window[fn](msg); return orig ? orig(msg, kind) : undefined; };
  }, fnName);
  return toasts;
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('consultation-autosave-signoff');

  // --- TEST 1: selecting via the Doctor Queue, then save-then-complete (two clicks) works cleanly ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(300);
    await page.click('.doc-queue-card');
    await page.waitForTimeout(200);
    const docPtId = await page.evaluate(() => _docPt && _docPt.id);
    t.check('selecting a patient from the Doctor Queue sets the full patient object on _docPt', docPtId === 'p1');
    await page.fill('#doc-complaint', 'Headache');
    const toasts = await captureToasts(page, '__capt1');
    await page.click('button:has-text("Save Consultation")');
    await page.waitForTimeout(250);
    t.check('Save shows the success toast', toasts.includes('✅ Consultation saved'));
    await page.click('#doc-complete-btn');
    await page.waitForTimeout(250);
    t.check('Complete & Sign Off after a prior Save does NOT show the "save notes first" error', !toasts.some(m => m.includes('Save consultation notes')));
    t.check('Complete & Sign Off succeeds after a prior Save', toasts.includes('✅ Visit completed and signed off'));
    await page.close();
  }

  // --- TEST 2: selecting via the Consultation search box, then save-then-complete works cleanly (confirms the old bare-id bug stays fixed) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(300);
    const searchInputId = await page.evaluate(() => document.querySelector('#page-consultation input[oninput*="searchDocPatient"]')?.id);
    t.check('the Consultation search box exists', !!searchInputId);
    await page.fill('#' + searchInputId, 'Test');
    await page.waitForTimeout(300);
    await page.click('.doc-queue-card');
    await page.waitForTimeout(200);
    const docPt = await page.evaluate(() => _docPt);
    t.check('selecting a patient via search also sets the full patient object (not a bare id)', docPt && docPt.id === 'p1' && docPt.name === 'Test Patient');
    await page.fill('#doc-complaint', 'Headache via search');
    const toasts = await captureToasts(page, '__capt2');
    await page.click('button:has-text("Save Consultation")');
    await page.waitForTimeout(250);
    await page.click('#doc-complete-btn');
    await page.waitForTimeout(250);
    t.check('save-then-complete via the search path also completes cleanly with no error', toasts.includes('✅ Visit completed and signed off') && !toasts.some(m => m.includes('Save consultation notes')));
    await page.close();
  }

  // --- TEST 3: clicking Complete & Sign Off directly (no prior Save click) now auto-saves and completes in one action ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(300);
    await page.click('.doc-queue-card');
    await page.waitForTimeout(200);
    await page.fill('#doc-complaint', 'Headache, no prior save click');
    const toasts = await captureToasts(page, '__capt3');
    await page.click('#doc-complete-btn');
    await page.waitForTimeout(300);
    t.check('typed notes are auto-saved before sign-off, with no separate Save click', toasts.includes('✅ Consultation saved'));
    t.check('sign-off completes in the same action', toasts.includes('✅ Visit completed and signed off'));
    t.check('the confusing "save notes first" error never appears when notes were actually typed', !toasts.some(m => m.includes('Save consultation notes')));
    await page.close();
  }

  // --- TEST 4: a truly note-less attempt (nothing ever typed) still blocks with a clear error, and inserts no row ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(300);
    await page.click('.doc-queue-card');
    await page.waitForTimeout(200);
    const toasts = await captureToasts(page, '__capt4');
    await page.click('#doc-complete-btn');
    await page.waitForTimeout(250);
    t.check('a genuinely note-less attempt still shows the clear blocking error', toasts.some(m => m.includes('Save consultation notes before completing this visit')));
    t.check('it does not also claim success', !toasts.includes('✅ Visit completed and signed off'));
    const consultRows = await page.evaluate(() => sb.__db && sb.__db.doctor_consultations ? sb.__db.doctor_consultations.length : null);
    t.check('no consultation row was inserted when nothing was ever typed', consultRows === undefined || consultRows === null || consultRows === 0);
    await page.close();
  }

  // --- TEST 5: switching to a different patient resets the dirty flag, so leftover text in a field doesn't get attributed to the wrong patient ---
  {
    const page = await context.newPage();
    const now = new Date().toISOString();
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Dr Test', role: 'doctor' }],
        patients: [
          { id: 'p1', name: 'Patient One', mrn: 'M1', lab_no: 'L1', age: 30, age_unit: 'Years', sex: 'Male', visit_destination: 'doctor', visit_status: 'Registered', payment_status: 'paid', created_at: now },
          { id: 'p2', name: 'Patient Two', mrn: 'M2', lab_no: 'L2', age: 40, age_unit: 'Years', sex: 'Female', visit_destination: 'doctor', visit_status: 'Registered', payment_status: 'paid', created_at: now },
        ],
      },
      users: [{ id: 'u1', email: 'doc@example.com', password: 'whatever' }],
    };
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${STATEFUL_MOCK_SRC}
      window.__seed = ${JSON.stringify(seed)};
      window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(300);
    const cards = page.locator('.doc-queue-card');
    await cards.nth(0).click();
    await page.waitForTimeout(150);
    const dirtyAfterSelect = await page.evaluate(() => _docNotesDirty);
    t.check('selecting a patient starts with a clean (not dirty) notes state', dirtyAfterSelect === false);
    await page.close();
  }

  return t;
};
