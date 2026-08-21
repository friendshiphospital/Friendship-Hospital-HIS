// Covers a live-reported bug: patient "Farah ahmed" registered 19 Aug as
// MRN 542 with completed lab results, then registered again on 20 Aug
// (a follow-up visit) but came back as MRN 543 -- a different permanent
// identity instead of a new visit under the same MRN.
//
// Root cause (confirmed by reading submitRegistration()): there is no
// separate "follow-up registration" path -- every registration, walk-in
// or follow-up, goes through the same function, and MRN reuse depended
// entirely on the receptionist having manually matched the patient via
// the phone-typing hint or search box (populating the hidden
// #r-existing-mrn field). checkAndApplyFollowUpPricing()'s own
// phone-based fallback already detects "this phone matches an open
// follow-up under a different mrn" but only ever used that fact to ask
// about PRICING, never to correct the identity -- so a missed/skipped
// manual match always minted a brand-new MRN regardless.
//
// Fix: submitRegistration() now does one authoritative safety-net lookup
// against patients_master by phone (the actual identity registry) before
// minting a new MRN, whenever #r-existing-mrn wasn't already set. This
// covers walk-in and follow-up registrations identically, since both go
// through this one function.
//
// Uses STATEFUL_MOCK_SRC (not CHAINABLE_MOCK_SRC) because this needs to
// tell "reused the existing patients_master row" apart from "silently
// inserted a second one" -- real per-table state, not a single-call mock.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(seedOverrides) {
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Reception Test', role: 'receptionist' }],
      ...seedOverrides,
    },
    users: [{ id: 'u1', email: 'reception@example.com', password: 'whatever' }],
    idStart: { mrn: 500 },
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
  await page.fill('#auth-email', 'reception@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

async function fillMinimalRegistration(page, { phone }) {
  await page.evaluate(() => { _activeShift = { status: 'active' }; });
  await page.evaluate(() => goPage('register'));
  await page.waitForTimeout(150);
  await page.evaluate((phone) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('r-fname', 'Farah'); set('r-lname', 'ahmed'); set('r-sex', 'Female'); set('r-phone', phone);
    const consent = document.getElementById('r-consent'); if (consent) consent.checked = true;
    if (typeof _regDestinations !== 'undefined') { _regDestinations.clear(); _regDestinations.add('doctor'); }
  }, phone);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('registration-returning-patient-mrn-reuse');

  // --- The exact reported scenario: returning patient, receptionist never manually matched, confirms the safety-net prompt ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      patients_master: [{ mrn: '542', name: 'Farah ahmed', phone: '0912345678', first_name: 'Farah', last_name: 'ahmed' }],
      patients: [{ id: 'visit1', mrn: '542', name: 'Farah ahmed', phone: '0912345678', created_at: '2026-08-19T09:00:00Z', visit_status: 'Visit Complete' }],
    }));
    let dialogMessage = '';
    page.on('dialog', d => { dialogMessage = d.message(); d.accept(); });
    await login(page, baseUrl);
    await fillMinimalRegistration(page, { phone: '0912345678' });
    // Deliberately NOT setting r-existing-mrn -- reproduces the exact gap: no manual search match made.
    await page.evaluate(() => submitRegistration());
    await page.waitForTimeout(400);

    const state = await page.evaluate(() => ({
      mastersCount: sb.__db.patients_master.length,
      newVisit: sb.__db.patients.find(p => p.id !== 'visit1'),
    }));
    t.check('the safety-net prompt names the existing patient and their real MRN', dialogMessage.includes('Farah ahmed') && dialogMessage.includes('542'));
    t.check('confirming reuses MRN 542 for the new visit -- NOT a freshly minted MRN', state.newVisit?.mrn === '542');
    t.check('patients_master is NOT duplicated -- still exactly one record for this person', state.mastersCount === 1);
    await page.close();
  }

  // --- Declining the safety-net prompt still allows registering as a genuinely new, separate patient ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      patients_master: [{ mrn: '542', name: 'Farah ahmed', phone: '0912345678', first_name: 'Farah', last_name: 'ahmed' }],
      patients: [{ id: 'visit1', mrn: '542', name: 'Farah ahmed', phone: '0912345678', created_at: '2026-08-19T09:00:00Z' }],
    }));
    page.on('dialog', d => d.dismiss());
    await login(page, baseUrl);
    await fillMinimalRegistration(page, { phone: '0912345678' });
    await page.evaluate(() => submitRegistration());
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      mastersCount: sb.__db.patients_master.length,
      newVisit: sb.__db.patients.find(p => p.id !== 'visit1'),
    }));
    t.check('declining the prompt still registers a new visit (does not block registration)', !!state.newVisit);
    t.check('...under a genuinely new, different MRN', state.newVisit?.mrn !== '542');
    t.check('...and a second patients_master record is created for the declined "different person"', state.mastersCount === 2);
    await page.close();
  }

  // --- No matching phone at all -> no prompt, brand-new patient exactly as before this fix ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({ patients_master: [], patients: [] }));
    let dialogFired = false;
    page.on('dialog', d => { dialogFired = true; d.dismiss(); });
    await login(page, baseUrl);
    await fillMinimalRegistration(page, { phone: '0900000000' });
    await page.evaluate(() => submitRegistration());
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      mastersCount: sb.__db.patients_master.length,
      newVisit: sb.__db.patients[0],
    }));
    t.check('a genuinely new phone number never triggers the safety-net prompt', !dialogFired);
    t.check('a brand-new patient is still registered normally', !!state.newVisit && state.mastersCount === 1);
    await page.close();
  }

  // --- Manual search match (existing behaviour) still takes priority -- safety net never double-prompts ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript({
      patients_master: [{ mrn: '542', name: 'Farah ahmed', phone: '0912345678', first_name: 'Farah', last_name: 'ahmed' }],
      patients: [{ id: 'visit1', mrn: '542', name: 'Farah ahmed', phone: '0912345678', created_at: '2026-08-19T09:00:00Z' }],
    }));
    let dialogCount = 0;
    page.on('dialog', d => { dialogCount++; d.accept(); });
    await login(page, baseUrl);
    await fillMinimalRegistration(page, { phone: '0912345678' });
    await page.evaluate(() => { document.getElementById('r-existing-mrn').value = '542'; });
    await page.evaluate(() => submitRegistration());
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      mastersCount: sb.__db.patients_master.length,
      newVisit: sb.__db.patients.find(p => p.id !== 'visit1'),
    }));
    t.check('an already-matched r-existing-mrn skips the safety-net prompt entirely (no double-prompt)', dialogCount === 0);
    t.check('MRN 542 is still correctly reused', state.newVisit?.mrn === '542');
    t.check('patients_master is still not duplicated', state.mastersCount === 1);
    await page.close();
  }

  return t;
};
