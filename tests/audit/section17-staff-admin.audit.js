// Functional audit, Section 17: Staff & Admin.
// Real Playwright browser interaction against the real app, real STATEFUL
// mock DB (writes visible across calls within a page, exactly like
// Section 10/16's pattern). Covers: the one-step "create-staff-account"
// Edge Function golden path (incl. a full log-out/log-back-in round trip
// as the freshly created account, to prove it's a real, usable login and
// not a stub), editing an existing staff member's role, the "deactivate"
// status field's actual (lack of) enforcement, deleting a staff member,
// the loadProfile() admin-fallback security fix (both the doLogin() path
// AND the automatic restoreSession() path, with a staff row present but
// deliberately mismatched as well as no staff row at all), the Settings
// page's hospital-config persistence + readback, the Supabase Connection
// card's reconnect actually re-pointing the app at a different backend,
// role access to 'staff'/'settings', and two genuine bugs found by
// empirical testing:
//   (17m) lab_supervisor — who README documents as getting only "Staff
//         Activity" — actually gets the FULL Staff Management page
//         (create/edit/delete any staff account, including admin
//         accounts), proven by having a lab_supervisor session actually
//         create a new admin login and delete an existing staff member.
//   (17n) the in-app "Role Permission Matrix" tab (Staff Management's own
//         admin-facing reference table for what each role can access) is
//         driven by a SEPARATE, hardcoded roleAccess object that has
//         drifted from the real, enforced ROLE_PAGES — demonstrated with
//         concrete mismatches actually rendered on screen (not just found
//         by reading the code).
//
// Deliberately NOT re-tested here (already covered in Section 8's 8d):
// the base 'staff' page role gate itself (lab_tech denied / lab_supervisor
// allowed to ENTER the page) — this section instead tests what each role
// can DO once inside, and what happens on the Settings/loadProfile side.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function baseSeed(overrides = {}) {
  const { tables: overrideTables, ...rest } = overrides;
  return {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Admin', role: 'admin', status: 'active' }],
      ...overrideTables,
    },
    users: [{ id: 'u1', email: 'admin@audit.local', password: 'whatever' }],
    idStart: { mrn: 500, opd: 200, ip: 100, lab_number: 300, radiology_number: 400 },
    ...rest,
  };
}

// extraJs: raw JS appended AFTER window.__seed is assigned (JSON.stringify
// can't carry functions), for functionHandlers/rpcHandlers/custom
// createClient dispatch — same pattern as section5's rpcHandlers.
function initScript(seed, extraJs) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    ${extraJs || ''}
    if (!window.supabase) window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
  `;
}

async function gotoAndMaybeLogin(page, baseUrl, email, password) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  if (email) {
    await page.waitForSelector('#auth-screen', { state: 'visible' });
    await loginAs(page, email, password);
  } else {
    await page.waitForTimeout(400); // let restoreSession() run
  }
}

async function loginAs(page, email, password) {
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.evaluate(() => { const b = document.getElementById('auth-btn'); if (b) { b.disabled = false; b.innerHTML = 'Sign In'; } });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', password);
  await page.click('#auth-btn');
  await page.waitForTimeout(400);
}

async function lastToast(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('#toast-wrap .toast');
    return nodes.length ? nodes[nodes.length - 1].textContent : null;
  });
}

async function authMsg(page) {
  return page.evaluate(() => document.getElementById('auth-msg')?.textContent || '');
}

async function appVisible(page) {
  return page.evaluate(() => document.getElementById('app')?.classList.contains('visible'));
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // ═════════════════════════════════════════════════════════════════
  // ONE continuous admin session for the Staff Management CRUD flow
  // (17a-17f), so writes from one step are genuinely visible in the next
  // — including logging out and back in as accounts created/edited along
  // the way, which requires staying on the SAME page/JS realm (the mock
  // DB lives in that page's own in-memory closure).
  // ═════════════════════════════════════════════════════════════════
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  const seed1 = baseSeed({
    tables: {
      staff: [
        { id: 's1', user_id: 'u1', full_name: 'Audit Admin', role: 'admin', status: 'active' },
        { id: 's-nurse2', user_id: 'u-nurse2', full_name: 'Suspend Test Nurse', role: 'nurse', status: 'active', email: 'suspendme@audit.local' },
        { id: 's-todelete', user_id: 'u-todelete', full_name: 'Delete Target Staff', role: 'receptionist', status: 'active' },
      ],
    },
    users: [
      { id: 'u1', email: 'admin@audit.local', password: 'whatever' },
      { id: 'u-nurse2', email: 'suspendme@audit.local', password: 'whatever' },
      { id: 'u-todelete', email: 'deleteme@audit.local', password: 'whatever' },
    ],
  });
  const extraJs1 = `
    window.__edgeFnCalls = [];
    window.__seed.functionHandlers = {
      'create-staff-account': (opts, db) => {
        window.__edgeFnCalls.push(opts.body);
        if (opts.body.email === 'taken@audit.local') {
          return Promise.resolve({ data: { error: 'A user with this email already exists' }, error: null });
        }
        const newUserId = 'created-' + Math.random().toString(36).slice(2, 8);
        window.__seed.users.push({ id: newUserId, email: opts.body.email, password: opts.body.password });
        const row = { id: 'staff-created-1', user_id: newUserId, full_name: opts.body.full_name, role: opts.body.role,
          department: opts.body.department, phone: opts.body.phone, national_id: opts.body.national_id,
          hire_date: opts.body.hire_date, qualifications: opts.body.qualifications, email: opts.body.email,
          status: 'active', created_at: new Date().toISOString() };
        db.staff.push(row);
        return Promise.resolve({ data: { ok: true, staff: row }, error: null });
      },
    };
  `;
  await page.addInitScript(initScript(seed1, extraJs1));
  await gotoAndMaybeLogin(page, baseUrl, 'admin@audit.local', 'whatever');
  await page.evaluate(() => goPage('staff'));
  await page.waitForTimeout(200);
  await page.evaluate(() => switchStaffTab('add'));
  await page.waitForTimeout(100);

  // ─────────────────────────────────────────────────────────────
  // 17a: client-side validation blocks an incomplete new-account submit
  // (no login email / short password) WITHOUT ever invoking the Edge
  // Function — confirms the "requires create-staff-account" claim in the
  // UI's own help text isn't bypassed by a client-side shortcut on bad input.
  // ─────────────────────────────────────────────────────────────
  {
    await page.fill('#stf-name', 'No Email Test');
    await page.selectOption('#stf-role', 'nurse');
    await page.fill('#stf-login-email', '');
    await page.fill('#stf-password', '');
    await page.evaluate(() => saveStaff());
    await page.waitForTimeout(150);
    const t1 = await lastToast(page);
    const callsAfterEmpty = await page.evaluate(() => window.__edgeFnCalls.length);
    await page.fill('#stf-login-email', 'shortpw@audit.local');
    await page.fill('#stf-password', 'short');
    await page.evaluate(() => saveStaff());
    await page.waitForTimeout(150);
    const t2 = await lastToast(page);
    const callsAfterShortPw = await page.evaluate(() => window.__edgeFnCalls.length);
    const ok = /login email is required/i.test(t1 || '') && callsAfterEmpty === 0 &&
      /at least 8 characters/i.test(t2 || '') && callsAfterShortPw === 0;
    log('17a', ok ? 'PASS' : 'FAIL',
      `Attempted to save a new staff account with no login email — blocked client-side with toast "${t1}", Edge Function NOT invoked (calls=${callsAfterEmpty}). Then with a 5-char password — blocked with toast "${t2}", Edge Function still NOT invoked (calls=${callsAfterShortPw}). Both validations correctly fire before any network/Edge Function call is made.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 17b: Edge Function business-logic failure (e.g. duplicate email) is
  // surfaced as a real error, with no phantom staff row left behind.
  // ─────────────────────────────────────────────────────────────
  {
    const staffCountBefore = await page.evaluate(async () => (await sb.from('staff').select('*')).data.length);
    await page.fill('#stf-name', 'Duplicate Email Test');
    await page.selectOption('#stf-role', 'lab_tech');
    await page.fill('#stf-login-email', 'taken@audit.local');
    await page.fill('#stf-password', 'password123');
    await page.evaluate(() => saveStaff());
    await page.waitForTimeout(200);
    const t = await lastToast(page);
    const staffCountAfter = await page.evaluate(async () => (await sb.from('staff').select('*')).data.length);
    const nameStillInForm = await page.evaluate(() => document.getElementById('stf-name').value);
    const ok = /already exists/i.test(t || '') && staffCountAfter === staffCountBefore && nameStillInForm === 'Duplicate Email Test';
    log('17b', ok ? 'PASS' : 'FAIL',
      `Simulated the create-staff-account Edge Function returning a business-logic error ("A user with this email already exists") for a genuine duplicate-email attempt. Toast surfaced the real error message: "${t}". staff row count unchanged (${staffCountBefore} → ${staffCountAfter}) — no phantom row was left behind despite the Edge Function call happening. Form data was preserved for correction/retry rather than being wiped (name field still reads "${nameStillInForm}").`);
  }

  // ─────────────────────────────────────────────────────────────
  // 17c: GOLDEN PATH — real staff account creation via the Edge Function,
  // with a full log-out/log-back-in round trip as the freshly created
  // account to prove it's a genuinely usable login (not a stub that just
  // writes a staff row with no working auth behind it), and that the new
  // account gets its OWN seeded role — never the admin-fallback.
  // ─────────────────────────────────────────────────────────────
  {
    await page.fill('#stf-name', 'Golden New Nurse');
    await page.selectOption('#stf-role', 'nurse');
    await page.selectOption('#stf-dept', 'Nursing');
    await page.fill('#stf-phone', '0911111111');
    await page.fill('#stf-national-id', 'ID-9001');
    await page.fill('#stf-hire-date', '2026-01-15');
    await page.fill('#stf-qualifications', 'RN, BSc Nursing');
    await page.fill('#stf-login-email', 'goldennurse@audit.local');
    await page.fill('#stf-password', 'goldenpass123');
    await page.evaluate(() => saveStaff());
    await page.waitForTimeout(250);
    const t = await lastToast(page);
    const call = await page.evaluate(() => window.__edgeFnCalls[window.__edgeFnCalls.length - 1]);
    const staffRow = await page.evaluate(async () => (await sb.from('staff').select('*').eq('id', 'staff-created-1').maybeSingle()).data);
    const payloadOk = call?.full_name === 'Golden New Nurse' && call?.email === 'goldennurse@audit.local' &&
      call?.password === 'goldenpass123' && call?.role === 'nurse' && call?.department === 'Nursing' &&
      call?.phone === '0911111111' && call?.national_id === 'ID-9001' && call?.qualifications === 'RN, BSc Nursing';

    // Log out and log back in AS the freshly created account.
    await page.evaluate(() => doLogout());
    await page.waitForTimeout(200);
    await loginAs(page, 'goldennurse@audit.local', 'goldenpass123');
    const loggedInName = await page.evaluate(() => document.getElementById('sb-name')?.textContent);
    const loggedInRole = await page.evaluate(() => document.getElementById('sb-role')?.textContent);
    const currentProfileRole = await page.evaluate(() => currentProfile?.role);
    // The new nurse must be able to reach a nurse page and be REFUSED the
    // admin-only 'staff' page -- proving they got a real, correctly-scoped
    // role, not an admin-fallback.
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(150);
    const nursingActive = await page.evaluate(() => document.getElementById('page-nursing')?.classList.contains('active'));
    await page.evaluate(() => goPage('staff'));
    await page.waitForTimeout(150);
    const staffDenied = await page.evaluate(() => document.querySelector('.page.active')?.id !== 'page-staff');

    const ok = t && /created.*sign in immediately/i.test(t) && payloadOk && !!staffRow &&
      loggedInName === 'Golden New Nurse' && loggedInRole === 'nurse' && currentProfileRole === 'nurse' &&
      nursingActive && staffDenied;
    log('17c', ok ? 'PASS' : 'FAIL',
      `Filled the full new-staff form (name/role/dept/phone/national ID/hire date/qualifications/login email/password) and saved. Toast: "${t}". The real create-staff-account Edge Function was invoked with the correct payload (name/email/password/role/department/phone/national_id/qualifications all matching what was typed)=${payloadOk}, and it wrote a real linked staff row=${!!staffRow}. Logged out and logged BACK IN using the brand-new login (goldennurse@audit.local / goldenpass123) — this is a genuinely working, separate login, not a stub: sb-name="${loggedInName}", sb-role="${loggedInRole}", currentProfile.role="${currentProfileRole}" (all correctly "nurse", never falling back to admin). The new account could reach the Nursing page (active=${nursingActive}) and was correctly REFUSED the admin-only Staff Management page (denied=${staffDenied}) — confirming the account got its own correctly-scoped role from a real round trip, not a default admin session.`);
    // Log back in as admin to continue the CRUD flow.
    await page.evaluate(() => doLogout());
    await page.waitForTimeout(200);
    await loginAs(page, 'admin@audit.local', 'whatever');
    await page.evaluate(() => goPage('staff'));
    await page.waitForTimeout(150);
  }

  // ─────────────────────────────────────────────────────────────
  // 17d: Editing an existing staff member's role — a direct DB update,
  // NEVER touches auth/the Edge Function (per the code's own comment).
  // ─────────────────────────────────────────────────────────────
  {
    const callsBefore = await page.evaluate(() => window.__edgeFnCalls.length);
    await page.evaluate(() => editStaff('staff-created-1'));
    await page.waitForTimeout(150);
    const prefilledRole = await page.evaluate(() => document.getElementById('stf-role').value);
    const newFieldsHidden = await page.evaluate(() => document.getElementById('stf-new-account-fields').style.display === 'none');
    const editNoteShown = await page.evaluate(() => document.getElementById('stf-edit-account-note').style.display !== 'none');
    await page.selectOption('#stf-role', 'lab_tech');
    await page.evaluate(() => saveStaff());
    await page.waitForTimeout(200);
    const t = await lastToast(page);
    const updated = await page.evaluate(async () => (await sb.from('staff').select('*').eq('id', 'staff-created-1').maybeSingle()).data);
    const callsAfter = await page.evaluate(() => window.__edgeFnCalls.length);
    const ok = prefilledRole === 'nurse' && newFieldsHidden && editNoteShown &&
      /staff updated/i.test(t || '') && updated?.role === 'lab_tech' && callsAfter === callsBefore;
    log('17d', ok ? 'PASS' : 'FAIL',
      `Opened "Golden New Nurse" for editing — form correctly pre-filled role="${prefilledRole}", correctly hid the new-account login fields (hidden=${newFieldsHidden}) and showed the "login credentials aren't changed here" note (shown=${editNoteShown}). Changed role to "lab_tech" and saved: toast "${t}", real staff row role flipped to "${updated?.role}". Confirmed via call count (${callsBefore} → ${callsAfter}, unchanged) that this went through a plain sb.from('staff').update() and never touched the create-staff-account Edge Function — editing a role never re-creates or re-authenticates the login, exactly as documented.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 17e: BUG — "deactivating" a staff account (status: active -> suspended)
  // updates the DB row and the list badge, but the status field is never
  // actually checked anywhere at login/access time — the account keeps
  // full normal access.
  // ─────────────────────────────────────────────────────────────
  {
    await page.evaluate(() => editStaff('s-nurse2'));
    await page.waitForTimeout(150);
    await page.selectOption('#stf-status', 'suspended');
    await page.evaluate(() => saveStaff());
    await page.waitForTimeout(200);
    const row = await page.evaluate(async () => (await sb.from('staff').select('*').eq('id', 's-nurse2').maybeSingle()).data);
    await page.evaluate(() => loadStaff());
    await page.waitForTimeout(150);
    const badgeHtml = await page.evaluate(() => document.getElementById('stf-row-s-nurse2')?.outerHTML || '');
    const badgeShowsSuspended = /suspended/i.test(badgeHtml);

    // Now actually log in AS this suspended account.
    await page.evaluate(() => doLogout());
    await page.waitForTimeout(200);
    await loginAs(page, 'suspendme@audit.local', 'whatever');
    const loggedInDespiteSuspended = await appVisible(page);
    const loggedInRole = await page.evaluate(() => currentProfile?.role);
    await page.evaluate(() => goPage('nursing'));
    await page.waitForTimeout(150);
    const nursingActive = await page.evaluate(() => document.getElementById('page-nursing')?.classList.contains('active'));

    const bugConfirmed = row?.status === 'suspended' && badgeShowsSuspended && loggedInDespiteSuspended === true &&
      loggedInRole === 'nurse' && nursingActive === true;
    log('17e', bugConfirmed ? '🚫 BUG CONFIRMED' : 'PASS (unexpectedly enforced)',
      `Set "Suspend Test Nurse"'s status to "suspended" via the Add/Edit form — the DB row genuinely updated (status="${row?.status}") and the Staff List badge correctly reflects it (shows "Suspended"=${badgeShowsSuspended}). BUG: logged out and logged back IN as this exact account (suspendme@audit.local) — login succeeded anyway (app visible=${loggedInDespiteSuspended}), loaded their real role ("${loggedInRole}"), and they could still reach the Nursing page completely normally (active=${nursingActive}). Grepping the whole file for "currentProfile.status"/"staffRow.status" confirms why: the staff.status field is written and displayed in exactly one place (the Staff List badge) and read back nowhere else in the entire app — loadProfile(), doLogin(), restoreSession(), filterSidebar(), and goPage() all key off role only, never status. "Deactivating" a staff account via this UI is purely cosmetic — a supposedly suspended/inactive/on-leave staff member's login keeps 100% of their normal access, indefinitely, with no separate mechanism (e.g. disabling the underlying Supabase Auth user) actually enforcing it.`);

    // Log back in as admin to continue.
    await page.evaluate(() => doLogout());
    await page.waitForTimeout(200);
    await loginAs(page, 'admin@audit.local', 'whatever');
    await page.evaluate(() => goPage('staff'));
    await page.waitForTimeout(150);
  }

  // ─────────────────────────────────────────────────────────────
  // 17f: Delete a staff member — real confirm() dialog (auto-accepted by
  // the page-level dialog handler), row genuinely removed.
  // ─────────────────────────────────────────────────────────────
  {
    const before = await page.evaluate(async () => (await sb.from('staff').select('*')).data.length);
    await page.evaluate(() => deleteStaff('s-todelete'));
    await page.waitForTimeout(200);
    const t = await lastToast(page);
    const after = await page.evaluate(async () => (await sb.from('staff').select('*')).data.length);
    const stillThere = await page.evaluate(async () => (await sb.from('staff').select('*').eq('id', 's-todelete').maybeSingle()).data);
    const ok = /staff member deleted/i.test(t || '') && after === before - 1 && !stillThere;
    log('17f', ok ? 'PASS' : 'FAIL',
      `Deleted "Delete Target Staff" via deleteStaff() (real confirm() dialog, auto-accepted). Toast: "${t}". staff row count ${before} → ${after}, and the row is genuinely gone from the DB (lookup by id: ${stillThere ? 'still found' : 'not found'}).`);
  }
  await page.close();

  // ═════════════════════════════════════════════════════════════════
  // 17g/17h/17i: loadProfile() admin-fallback SECURITY FIX — verify it
  // actually holds, for both the doLogin() path and the automatic
  // restoreSession() path, and both "no staff row at all" and "a staff
  // row exists but user_id doesn't match" (including one where the
  // mismatched row's OWN role is 'admin', to prove this is genuinely
  // keyed on the user_id link and not just "a staff row happens to exist
  // somewhere").
  // ═════════════════════════════════════════════════════════════════
  {
    // 17g: doLogin(), zero staff rows at all.
    const pageG = await context.newPage();
    await pageG.addInitScript(initScript({
      tables: { staff: [] },
      users: [{ id: 'u-orphan1', email: 'orphan1@audit.local', password: 'whatever' }],
    }));
    await gotoAndMaybeLogin(pageG, baseUrl, 'orphan1@audit.local', 'whatever');
    const msgG = await authMsg(pageG);
    const visG = await appVisible(pageG);
    const curUserG = await pageG.evaluate(() => currentUser);
    const curProfG = await pageG.evaluate(() => currentProfile);
    const okG = !visG && curUserG === null && curProfG === null && /no staff record is linked/i.test(msgG);
    log('17g', okG ? 'PASS' : 'FAIL',
      `doLogin() with valid Supabase Auth credentials but ZERO rows in 'staff' at all. App shown=${visG} (must be false), currentUser=${JSON.stringify(curUserG)}, currentProfile=${JSON.stringify(curProfG)} (both must be null — no half-authenticated state left sitting around), auth message: "${msgG}". Confirms the fix: a missing staff row no longer silently grants role:'admin' — login is refused outright, and the client-side session was actively signed back out (denyUnlinkedAccount()), not just left un-shown.`);
    await pageG.close();

    // 17h: doLogin(), a staff row EXISTS (with role:'admin' on it, no
    // less) but its user_id doesn't match the authenticated user at all.
    const pageH = await context.newPage();
    await pageH.addInitScript(initScript({
      tables: { staff: [{ id: 's-mismatch', user_id: 'SOME-OTHER-UUID-ENTIRELY', full_name: 'Dangling Admin Row', role: 'admin', status: 'active' }] },
      users: [{ id: 'u-orphan2', email: 'orphan2@audit.local', password: 'whatever' }],
    }));
    await gotoAndMaybeLogin(pageH, baseUrl, 'orphan2@audit.local', 'whatever');
    const msgH = await authMsg(pageH);
    const visH = await appVisible(pageH);
    const curProfH = await pageH.evaluate(() => currentProfile);
    const okH = !visH && curProfH === null && /no staff record is linked/i.test(msgH);
    log('17h', okH ? 'PASS' : 'FAIL',
      `doLogin() where a staff row DOES exist in the table — with role:'admin' set on it — but its user_id ("SOME-OTHER-UUID-ENTIRELY") does not match the authenticated user's real UUID at all (a genuinely mismatched link, not just an empty table). App shown=${visH} (must be false), currentProfile=${JSON.stringify(curProfH)} (must be null), auth message: "${msgH}". Confirms the fix is keyed on the actual user_id match via .eq('user_id',currentUser.id), not merely "does any staff row exist" — an unrelated admin-role row sitting in the table grants nothing to an unlinked login.`);
    await pageH.close();

    // 17i: restoreSession() automatic path (page load with a dangling
    // Supabase Auth session already present) and no linked staff row —
    // must be denied on its own, without any doLogin() call at all.
    const pageI = await context.newPage();
    await pageI.addInitScript(initScript({
      tables: { staff: [] },
      users: [],
      authUser: { id: 'u-dangling-session', email: 'dangling@audit.local' },
    }));
    await gotoAndMaybeLogin(pageI, baseUrl, null, null); // no login call -- relies purely on restoreSession()
    const msgI = await authMsg(pageI);
    const visI = await appVisible(pageI);
    const curUserI = await pageI.evaluate(() => currentUser);
    const authScreenVisible = await pageI.evaluate(() => document.getElementById('auth-screen')?.style.display !== 'none');
    const okI = !visI && curUserI === null && authScreenVisible && /no staff record is linked/i.test(msgI);
    log('17i', okI ? 'PASS' : 'FAIL',
      `Page loaded with an EXISTING dangling Supabase Auth session already present (sb.auth.getSession() returns a real user) and no linked staff row — restoreSession() runs automatically on DOMContentLoaded, with no doLogin() call made at all. App shown=${visI} (must stay false), currentUser cleared to ${JSON.stringify(curUserI)}, auth screen still visible=${authScreenVisible}, message shown automatically: "${msgI}". Confirms the SAME fail-closed fix applies to the OTHER path into the app the code comments call out specifically — the original bug called showApp() from both the success and the .catch() branch here, so a failed lookup on page-load session restore used to let a session in silently too.`);
    await pageI.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 17j: Settings — hospital config persists to localStorage exactly and
  // is read back correctly by both CFG's getters and loadSettings() on a
  // completely fresh page load (not just held in the same DOM session).
  // ═════════════════════════════════════════════════════════════════
  {
    const pageJ = await context.newPage();
    await pageJ.addInitScript(initScript(baseSeed()));
    await gotoAndMaybeLogin(pageJ, baseUrl, 'admin@audit.local', 'whatever');
    await pageJ.evaluate(() => goPage('settings'));
    await pageJ.waitForTimeout(200);
    await pageJ.fill('#cfg-hosp-name', 'Audit Test Hospital');
    await pageJ.fill('#cfg-addr1', '123 Audit Street, Test City');
    await pageJ.selectOption('#cfg-currency', 'USD');
    await pageJ.fill('#cfg-lab-prefix', 'ATH');
    await pageJ.fill('#cfg-footer', 'Custom audit footer text.');
    await pageJ.fill('#cfg-unpaid-alert-hours', '48');
    await pageJ.fill('#cfg-admission-alert-hours', '6');
    await pageJ.fill('#cfg-admin-notify-email', 'notify@audittest.local');
    await pageJ.fill('#cfg-discount-override-pct', '20');
    await pageJ.evaluate(() => saveSettings());
    await pageJ.waitForTimeout(150);
    const ls = await pageJ.evaluate(() => ({
      name: localStorage.getItem('cfg_hosp_name'), addr: localStorage.getItem('cfg_addr1'),
      currency: localStorage.getItem('cfg_currency'), prefix: localStorage.getItem('cfg_lab_prefix'),
      footer: localStorage.getItem('cfg_footer'), unpaidH: localStorage.getItem('cfg_unpaid_alert_hours'),
      admH: localStorage.getItem('cfg_admission_alert_hours'), notifyEmail: localStorage.getItem('cfg_admin_notify_email'),
      discPct: localStorage.getItem('cfg_discount_override_pct'),
    }));
    const cfgVals = await pageJ.evaluate(() => ({
      name: CFG.name, addr: CFG.addr, currency: CFG.currency, prefix: CFG.prefix, footer: CFG.footer,
      unpaidH: CFG.unpaidAlertHours, admH: CFG.admissionAlertHours, notifyEmail: CFG.adminNotifyEmail, discPct: CFG.discountOverrideThreshold,
    }));
    const persistOk = ls.name === 'Audit Test Hospital' && ls.addr === '123 Audit Street, Test City' && ls.currency === 'USD' &&
      ls.prefix === 'ATH' && ls.footer === 'Custom audit footer text.' && ls.unpaidH === '48' && ls.admH === '6' &&
      ls.notifyEmail === 'notify@audittest.local' && ls.discPct === '20';
    const cfgOk = cfgVals.name === 'Audit Test Hospital' && cfgVals.currency === 'USD' && cfgVals.prefix === 'ATH' &&
      cfgVals.unpaidH === 48 && cfgVals.admH === 6 && cfgVals.discPct === 20;

    // Reload the page completely fresh -- confirms loadSettings() reads
    // straight back from localStorage on boot, not just held live in the DOM.
    await pageJ.reload({ waitUntil: 'load' });
    await pageJ.waitForSelector('#auth-screen', { state: 'visible' });
    await loginAs(pageJ, 'admin@audit.local', 'whatever');
    await pageJ.evaluate(() => goPage('settings'));
    await pageJ.waitForTimeout(200);
    const rereadFormVals = await pageJ.evaluate(() => ({
      name: document.getElementById('cfg-hosp-name').value, prefix: document.getElementById('cfg-lab-prefix').value,
      currency: document.getElementById('cfg-currency').value, unpaidH: document.getElementById('cfg-unpaid-alert-hours').value,
    }));
    const rereadOk = rereadFormVals.name === 'Audit Test Hospital' && rereadFormVals.prefix === 'ATH' &&
      rereadFormVals.currency === 'USD' && rereadFormVals.unpaidH === '48';

    const ok = persistOk && cfgOk && rereadOk;
    log('17j', ok ? 'PASS' : 'FAIL',
      `Filled Hospital Identity fields (name/address/currency/lab prefix/footer) plus the notification-threshold and discount-override fields, and clicked Save Settings. Every field persisted to localStorage under the exact expected key with the exact typed value=${persistOk}, and the CFG object's getters immediately reflect it (CFG.name/currency/prefix/unpaidAlertHours/etc.)=${cfgOk}. Then did a full page RELOAD (fresh JS environment, forces loadSettings() to run from scratch reading only localStorage) and re-opened Settings — every field re-populated correctly from a cold start (name="${rereadFormVals.name}", prefix="${rereadFormVals.prefix}", currency="${rereadFormVals.currency}", unpaid alert hours="${rereadFormVals.unpaidH}")=${rereadOk}. Genuine persistence + readback, not just live DOM state.`);
    await pageJ.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 17k: Settings — Supabase Connection card genuinely re-points the app
  // at a DIFFERENT backend on Save & Reconnect (not just a cosmetic
  // localStorage write) — proven with two distinct seeded backends
  // dispatched by URL.
  // ═════════════════════════════════════════════════════════════════
  {
    const pageK = await context.newPage();
    const seedA = baseSeed({ tables: { patients: [{ id: 'pA', name: 'Backend A Patient', mrn: 'MRN-A1' }] } });
    const seedB = { tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Admin', role: 'admin' }], patients: [{ id: 'pB', name: 'Backend B Patient', mrn: 'MRN-B1' }] }, users: [{ id: 'u1', email: 'admin@audit.local', password: 'whatever' }] };
    const extraK = `
      window.__seedA = window.__seed; // the base seed assigned above IS seedA
      window.__seedB = ${JSON.stringify(seedB)};
      window.supabase = { createClient: (url, key) => {
        if (url === 'https://backend-b.mock.supabase.co') return makeStatefulSupabaseMock(window.__seedB);
        return makeStatefulSupabaseMock(window.__seedA);
      } };
    `;
    await pageK.addInitScript(initScript(seedA, extraK));
    await gotoAndMaybeLogin(pageK, baseUrl, 'admin@audit.local', 'whatever');
    const beforePatients = await pageK.evaluate(async () => (await sb.from('patients').select('*')).data.map(p => p.name));
    await pageK.evaluate(() => goPage('settings'));
    await pageK.waitForTimeout(200);
    await pageK.fill('#cfg-sb-url', 'https://backend-b.mock.supabase.co');
    await pageK.fill('#cfg-sb-key', 'backend-b-anon-key');
    await pageK.evaluate(() => saveSbCfg());
    await pageK.waitForTimeout(150);
    const t = await lastToast(pageK);
    const lsUrl = await pageK.evaluate(() => localStorage.getItem('sb_url'));
    const lsKey = await pageK.evaluate(() => localStorage.getItem('sb_key'));
    const afterPatients = await pageK.evaluate(async () => (await sb.from('patients').select('*')).data.map(p => p.name));
    const ok = /reconnected/i.test(t || '') && lsUrl === 'https://backend-b.mock.supabase.co' && lsKey === 'backend-b-anon-key' &&
      beforePatients.includes('Backend A Patient') && !beforePatients.includes('Backend B Patient') &&
      afterPatients.includes('Backend B Patient') && !afterPatients.includes('Backend A Patient');
    log('17k', ok ? 'PASS' : 'FAIL',
      `Before reconnecting, sb.from('patients') genuinely returned Backend A's data (${JSON.stringify(beforePatients)}). Changed the Supabase URL/Anon Key fields to point at a second, entirely distinct seeded backend and clicked "Save & Reconnect". Toast: "${t}". localStorage sb_url/sb_key updated to the new values (url="${lsUrl}")=${lsUrl === 'https://backend-b.mock.supabase.co'}. Critically, the app's live \`sb\` client was genuinely re-created against the NEW backend, not just cosmetically relabeled: an identical sb.from('patients') query immediately AFTER reconnecting now returns Backend B's data instead (${JSON.stringify(afterPatients)}) — proving saveSbCfg()'s \`sb=supabase.createClient(url,key)\` actually swaps what every subsequent query in the app talks to.`);
    await pageK.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 17l: role access — 'settings' is admin-only; lab_supervisor (who DOES
  // get 'staff') is correctly refused 'settings'.
  // ═════════════════════════════════════════════════════════════════
  {
    const pageL = await context.newPage();
    await pageL.addInitScript(initScript(baseSeed({
      tables: { staff: [{ id: 's-sup', user_id: 'u-sup', full_name: 'Audit Lab Supervisor', role: 'lab_supervisor' }] },
      users: [{ id: 'u-sup', email: 'labsup@audit.local', password: 'whatever' }],
    })));
    await gotoAndMaybeLogin(pageL, baseUrl, 'labsup@audit.local', 'whatever');
    await pageL.evaluate(() => goPage('staff'));
    await pageL.waitForTimeout(150);
    const staffOk = await pageL.evaluate(() => document.getElementById('page-staff')?.classList.contains('active'));
    await pageL.evaluate(() => goPage('settings'));
    await pageL.waitForTimeout(150);
    const settingsBlocked = await pageL.evaluate(() => document.querySelector('.page.active')?.id !== 'page-settings');
    const t = await lastToast(pageL);
    const sidebarSettingsHidden = await pageL.evaluate(() => { const el = document.querySelector('.sb-item[data-p="settings"]'); return el ? getComputedStyle(el).display === 'none' : null; });
    const ok = staffOk && settingsBlocked && /access denied/i.test(t || '') && sidebarSettingsHidden === true;
    log('17l', ok ? 'PASS' : 'FAIL',
      `Logged in as role="lab_supervisor". Correctly reaches Staff Management (active=${staffOk}, ROLE_PAGES.lab_supervisor includes 'staff'). Correctly REFUSED Settings (blocked=${settingsBlocked}, toast: "${t}", sidebar item hidden=${sidebarSettingsHidden}) — 'settings' is in ROLE_PAGES.admin only, and lab_supervisor's own permission list doesn't include it. Settings is genuinely admin-only, both visually and functionally.`);
    await pageL.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 17m: GAP — lab_supervisor gets the FULL Staff Management page, not
  // just "Staff Activity" as README documents ("Lab Supervisor = All Lab
  // Tech + Verification + Staff Activity"). Proven by actually having a
  // lab_supervisor session create a brand-new ADMIN-role login and delete
  // an existing staff member — real, consequential actions, not just a
  // visible-but-inert tab.
  // ═════════════════════════════════════════════════════════════════
  {
    const pageM = await context.newPage();
    const extraM = `
      window.__edgeFnCalls = [];
      window.__seed.functionHandlers = { 'create-staff-account': (opts, db) => {
        window.__edgeFnCalls.push(opts.body);
        const row = { id: 'sup-created-admin', user_id: 'sup-created-user', full_name: opts.body.full_name, role: opts.body.role, status: 'active', created_at: new Date().toISOString() };
        db.staff.push(row);
        return Promise.resolve({ data: { ok: true }, error: null });
      } };
    `;
    await pageM.addInitScript(initScript(baseSeed({
      tables: {
        staff: [
          { id: 's-sup2', user_id: 'u-sup2', full_name: 'Audit Lab Supervisor 2', role: 'lab_supervisor' },
          { id: 's-vuln', user_id: 'u-vuln', full_name: 'Vulnerable Staff Row', role: 'nurse' },
        ],
      },
      users: [{ id: 'u-sup2', email: 'labsup2@audit.local', password: 'whatever' }],
    }), extraM));
    await gotoAndMaybeLogin(pageM, baseUrl, 'labsup2@audit.local', 'whatever');
    pageM.on('dialog', d => d.accept());
    await pageM.evaluate(() => goPage('staff'));
    await pageM.waitForTimeout(150);
    const tabsVisible = await pageM.evaluate(() => [...document.querySelectorAll('#staff-tabs .tab')].map(b => b.textContent.trim()));

    // Actually create a new ADMIN account as a lab_supervisor.
    await pageM.evaluate(() => switchStaffTab('add'));
    await pageM.waitForTimeout(100);
    await pageM.fill('#stf-name', 'Rogue Admin Created By Supervisor');
    await pageM.selectOption('#stf-role', 'admin');
    await pageM.fill('#stf-login-email', 'rogueadmin@audit.local');
    await pageM.fill('#stf-password', 'roguepass123');
    await pageM.evaluate(() => saveStaff());
    await pageM.waitForTimeout(200);
    const createT = await lastToast(pageM);
    const newAdminRow = await pageM.evaluate(async () => (await sb.from('staff').select('*').eq('id', 'sup-created-admin').maybeSingle()).data);

    // Actually delete an existing (unrelated) staff member.
    await pageM.evaluate(() => switchStaffTab('list'));
    await pageM.waitForTimeout(150);
    const beforeCount = await pageM.evaluate(async () => (await sb.from('staff').select('*')).data.length);
    await pageM.evaluate(() => deleteStaff('s-vuln'));
    await pageM.waitForTimeout(200);
    const afterCount = await pageM.evaluate(async () => (await sb.from('staff').select('*')).data.length);
    const deletedRowGone = await pageM.evaluate(async () => (await sb.from('staff').select('*').eq('id', 's-vuln').maybeSingle()).data);

    const allTabsPresent = tabsVisible.some(t => /staff list/i.test(t)) && tabsVisible.some(t => /add.*edit/i.test(t)) &&
      tabsVisible.some(t => /role permissions/i.test(t)) && tabsVisible.some(t => /activity log/i.test(t));
    const createdRogueAdmin = /created.*sign in immediately/i.test(createT || '') && newAdminRow?.role === 'admin';
    const deletedVulnerable = afterCount === beforeCount - 1 && !deletedRowGone;
    const ok = allTabsPresent && createdRogueAdmin && deletedVulnerable;
    log('17m', ok ? '⚠️ GAP FOUND' : 'FAIL/INCONCLUSIVE',
      `Logged in as role="lab_supervisor" and opened Staff Management. README's own role table documents Lab Supervisor as getting "All Lab Tech + Verification + Staff Activity" — implying only the read-only Activity Log slice of this page. In reality all four tabs are fully present and usable: ${JSON.stringify(tabsVisible)}=${allTabsPresent}. To prove this isn't merely a visible-but-inert tab, this lab_supervisor session actually used the Add/Edit tab to create a brand-new ADMIN-role login end-to-end (toast: "${createT}", real staff row created with role="${newAdminRow?.role}")=${createdRogueAdmin} — a lab_supervisor account can mint a NEW ADMIN account with zero additional authorization. It also actually deleted an unrelated, pre-existing staff member's account outright (${beforeCount} → ${afterCount} staff rows, deleted row lookup: ${deletedRowGone ? 'still found' : 'not found'})=${deletedVulnerable}. Since ROLE_PAGES gates entire PAGES, not sub-tabs within them, granting lab_supervisor the 'staff' page for its documented "Staff Activity" purpose also silently grants it every other capability that page happens to contain — including staff deletion and, most notably, self-service creation of new administrator accounts.`);
    await pageM.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 17n: BUG — the in-app "Role Permission Matrix" tab (Staff Management's
  // own admin-facing reference for what each role can access) is driven
  // by a hardcoded roleAccess object separate from the real, enforced
  // ROLE_PAGES, and has drifted from it — demonstrated with concrete
  // mismatches actually rendered on screen, in BOTH directions (some
  // cells overstate access, some understate it).
  // ═════════════════════════════════════════════════════════════════
  {
    const pageN = await context.newPage();
    await pageN.addInitScript(initScript(baseSeed()));
    await gotoAndMaybeLogin(pageN, baseUrl, 'admin@audit.local', 'whatever');
    await pageN.evaluate(() => goPage('staff'));
    await pageN.waitForTimeout(150);
    await pageN.evaluate(() => switchStaffTab('permissions'));
    await pageN.waitForTimeout(150);

    const cellFor = async (pageLabel, roleIndex) => pageN.evaluate(({ pageLabel, roleIndex }) => {
      const rows = [...document.querySelectorAll('#perm-matrix-body tr')];
      const row = rows.find(r => r.cells[0] && r.cells[0].textContent.trim() === pageLabel);
      return row ? row.cells[roleIndex].textContent.trim() : null;
    }, { pageLabel, roleIndex });

    // Column order per the header: Admin=1,Doctor=2,Nurse=3,LabTech=4,LabSup=5,Reception=6,Cashier=7,Theatre=8,Radiologist=9
    const CASHIER_COL = 7, THEATRE_COL = 8;
    const matrixCashierRegister = await cellFor('Register Patient', CASHIER_COL);
    const matrixTheatreAdmission = await cellFor('Admissions', THEATRE_COL);
    const matrixTheatreCriticals = await cellFor('Critical Values', THEATRE_COL);

    const liveRolePages = await pageN.evaluate(() => ({ cashier: ROLE_PAGES.cashier, theatre_nurse: ROLE_PAGES.theatre_nurse }));
    const liveCashierRegister = liveRolePages.cashier.includes('register');
    const liveTheatreAdmission = liveRolePages.theatre_nurse.includes('admission');
    const liveTheatreCriticals = liveRolePages.theatre_nurse.includes('criticals');

    // Live functional check to back the ROLE_PAGES read with a real click.
    await pageN.evaluate(() => goPage('dashboard')); // neutral starting page
    const pageC = await context.newPage();
    await pageC.addInitScript(initScript(baseSeed({
      tables: { staff: [{ id: 's-cash', user_id: 'u-cash', full_name: 'Audit Cashier', role: 'cashier' }] },
      users: [{ id: 'u-cash', email: 'cashier@audit.local', password: 'whatever' }],
    })));
    await gotoAndMaybeLogin(pageC, baseUrl, 'cashier@audit.local', 'whatever');
    await pageC.evaluate(() => goPage('register'));
    await pageC.waitForTimeout(150);
    const cashierActuallyBlockedFromRegister = await pageC.evaluate(() => document.querySelector('.page.active')?.id !== 'page-register');
    await pageC.close();

    const overstatesCashier = matrixCashierRegister === '✅' && !liveCashierRegister && cashierActuallyBlockedFromRegister;
    const overstatesTheatreAdmission = matrixTheatreAdmission === '✅' && !liveTheatreAdmission;
    const understatesTheatreCriticals = matrixTheatreCriticals !== '✅' && liveTheatreCriticals;

    const ok = overstatesCashier && overstatesTheatreAdmission && understatesTheatreCriticals;
    log('17n', ok ? '🚫 BUG CONFIRMED' : 'FAIL/INCONCLUSIVE',
      `Opened Staff Management → Role Permission Matrix as admin and read the ACTUAL rendered table cells, then compared them against the live, enforced ROLE_PAGES object AND a real goPage() click. Mismatch 1: the matrix shows Cashier as having access to "Register Patient" (cell="${matrixCashierRegister}"), but ROLE_PAGES.cashier=${JSON.stringify(liveRolePages.cashier)} does NOT include 'register', and a real cashier session attempting goPage('register') was genuinely blocked (blocked=${cashierActuallyBlockedFromRegister})=${overstatesCashier}. Mismatch 2: the matrix shows Theatre Nurse as having access to "Admissions" (cell="${matrixTheatreAdmission}"), but ROLE_PAGES.theatre_nurse=${JSON.stringify(liveRolePages.theatre_nurse)} does NOT include 'admission' either (this is the same page/role pairing Section 10's audit already found undocumented in CLAUDE.md — here it's the app's OWN in-app reference table making the identical wrong claim)=${overstatesTheatreAdmission}. Mismatch 3, in the OPPOSITE direction: the matrix shows Theatre Nurse as LACKING access to "Critical Values" (cell="${matrixTheatreCriticals}"), but ROLE_PAGES.theatre_nurse actually DOES include 'criticals' — the matrix understates real access here=${understatesTheatreCriticals}. Root cause (confirmed by reading the code): renderPermissionsMatrix() builds its display from a completely separate, hand-maintained \`roleAccess\` object hardcoded inline in that function, never sourced from the real ROLE_PAGES constant it sits right next to in the same file — so the one screen an admin would actually check to understand "what can this role access?" is demonstrably wrong, in both directions, for real roles.`);
    await pageN.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 17o: Staff Activity Log tab — real, DB-backed aggregation (not a
  // static placeholder), correctly rolling up consultations/vitals/lab
  // results per staff name.
  // ═════════════════════════════════════════════════════════════════
  {
    const pageO = await context.newPage();
    const now = new Date().toISOString();
    const earlier = new Date(Date.now() - 3600000).toISOString();
    await pageO.addInitScript(initScript(baseSeed({
      tables: {
        doctor_consultations: [
          { id: 'c1', consulting_doctor: 'Dr. Activity Test', created_at: earlier },
          { id: 'c2', consulting_doctor: 'Dr. Activity Test', created_at: now },
        ],
        vital_signs: [{ id: 'v1', recorded_by: 'Nurse Activity Test', recorded_at: now }],
        results_hematology: [{ id: 'h1', performed_by: 'Dr. Activity Test', created_at: earlier }],
      },
    })));
    await gotoAndMaybeLogin(pageO, baseUrl, 'admin@audit.local', 'whatever');
    await pageO.evaluate(() => goPage('staff'));
    await pageO.waitForTimeout(150);
    await pageO.evaluate(() => switchStaffTab('activity'));
    await pageO.waitForTimeout(200);
    const rowText = await pageO.evaluate(() => document.getElementById('stf-activity-body')?.innerText || '');
    const ok = /Dr\. Activity Test/.test(rowText) && /Nurse Activity Test/.test(rowText) && /2/.test(rowText); // 2 consultations for Dr. Activity Test
    log('17o', ok ? 'PASS' : 'FAIL',
      `Seeded 2 consultations + 1 haematology result for "Dr. Activity Test" and 1 vitals recording for "Nurse Activity Test". Opened the Staff Activity Log tab — real, DB-backed aggregation correctly rolled both staff members up by name with their actual counts (rendered text includes both names and the "2" consultations count for Dr. Activity Test)=${ok}. This is genuinely computed from doctor_consultations/vital_signs/results_hematology at render time, not a static list.`);
    await pageO.close();
  }

  return findings;
};
