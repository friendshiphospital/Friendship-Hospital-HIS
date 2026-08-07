// Functional audit, Section 2: Security (RLS).
//
// IMPORTANT SCOPE NOTE (read before trusting these results): Row-Level
// Security is a PostgreSQL/Supabase server-side feature. This audit
// environment has no live Supabase project -- it runs against an in-memory
// mock client (tests/helpers/stateful-mock.js) that has NO policy engine at
// all; every query it receives "succeeds" regardless of role. That means
// this file can NOT verify RLS itself, and does not attempt to. What it DOES
// verify, by real login-and-click interaction as two different non-admin
// roles: the CLIENT-SIDE access boundary (ROLE_PAGES + goPage() +
// filterSidebar()) -- which the code's own comments describe as "UX only,"
// with RLS as "the real [boundary] server-side." Whether migration_v2.8 has
// actually been run against the real database is reported as a static file
// check only (present in the repo, not confirmed applied) -- see the
// Section 2 report for what the user needs to verify themselves.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function initScript(role, extraSeed) {
  const seed = {
    tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit ' + role, role }] },
    users: [{ id: 'u1', email: role + '@audit.local', password: 'whatever' }],
    idStart: { mrn: 500, opd: 200, ip: 100, lab_number: 300, radiology_number: 400 },
    ...extraSeed,
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
  `;
}

async function loginAs(page, baseUrl, role) {
  await page.addInitScript(initScript(role));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', role + '@audit.local');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(400);
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // --- 2a: static check -- does the RLS migration exist and what does it cover? ---
  {
    const fs = require('fs');
    const path = require('path');
    const repoRoot = path.resolve(__dirname, '../..');
    const migPath = path.join(repoRoot, 'migration_v2.8_rls_security.sql');
    const exists = fs.existsSync(migPath);
    let tableCount = 0;
    if (exists) {
      const src = fs.readFileSync(migPath, 'utf8');
      tableCount = (src.match(/enable row level security/g) || []).length;
    }
    log('2a', exists ? 'INFO' : 'FAIL',
      exists
        ? `migration_v2.8_rls_security.sql is present in the repo, enabling RLS on ${tableCount} tables/table-loops (staff, patients_master, patients, admissions, sample_records, all 7 results_* tables via a loop, critical_values, invoices, doctor_consultations, radiology_requests, audit_logs). This ONLY confirms the migration file exists -- this sandboxed audit environment has no live Supabase project and CANNOT confirm the migration has actually been executed against the real database. The user must verify this themselves (Supabase SQL editor: "select tablename, rowsecurity from pg_tables where schemaname='public'" should show rowsecurity=true for these tables, and "select policyname from pg_policies" should list the policies this file creates).`
        : 'migration_v2.8_rls_security.sql was not found in the repository.');
  }

  // --- 2b: receptionist role -- can do legitimate reception tasks, cannot reach lab/clinical pages ---
  {
    const page = await context.newPage();
    await loginAs(page, baseUrl, 'receptionist');
    const sidebarState = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.sb-item[data-p]')];
      return items.map(el => ({ page: el.dataset.p, visible: el.style.display !== 'none' }));
    });
    const shouldSeeRegister = sidebarState.find(i => i.page === 'register');
    // Receptionist's own ROLE_PAGES entry legitimately includes 'worklist'
    // (front-desk staff check lab order status for patients) -- confirmed by
    // reading ROLE_PAGES before picking these targets, so the DISALLOWED
    // pages tested here are ones genuinely absent from receptionist's list:
    // lab result entry and doctor consultation.
    const shouldNotSeeLabEntry = sidebarState.find(i => i.page === 'unified-entry');
    const shouldNotSeeConsultation = sidebarState.find(i => i.page === 'consultation');
    // Legitimate task: navigate to Register (own page) -- should succeed.
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(150);
    const onRegisterPage = await page.evaluate(() => document.getElementById('page-register')?.classList.contains('active'));
    // Illegitimate task: try to navigate to lab result entry -- should be blocked.
    await page.evaluate(() => goPage('unified-entry'));
    await page.waitForTimeout(150);
    const onLabEntryPage = await page.evaluate(() => document.getElementById('page-unified-entry')?.classList.contains('active'));
    const toastAfterBlock = await page.evaluate(() => { const t = [...document.querySelectorAll('#toast-wrap .toast')]; return t.length ? t[t.length - 1].textContent : null; });
    // Illegitimate task: try to navigate to Doctor Consultation -- should also be blocked.
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(150);
    const onConsultPage = await page.evaluate(() => document.getElementById('page-consultation')?.classList.contains('active'));

    const sidebarOk = shouldSeeRegister?.visible === true && shouldNotSeeLabEntry?.visible === false && shouldNotSeeConsultation?.visible === false;
    const gateOk = onRegisterPage === true && onLabEntryPage === false && onConsultPage === false;
    log('2b', (sidebarOk && gateOk) ? 'PASS' : 'FAIL',
      `Receptionist sidebar: Register visible=${shouldSeeRegister?.visible}, Lab Result Entry visible=${shouldNotSeeLabEntry?.visible}, Consultation visible=${shouldNotSeeConsultation?.visible}. ` +
      `goPage() enforcement: reached Register=${onRegisterPage}, blocked from Lab Result Entry=${!onLabEntryPage} (toast: "${toastAfterBlock}"), blocked from Consultation=${!onConsultPage}.`);
    await page.close();
  }

  // --- 2c: lab_tech role -- can reach lab pages, cannot reach billing/register/admission ---
  {
    const page = await context.newPage();
    await loginAs(page, baseUrl, 'lab_tech');
    const sidebarState = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.sb-item[data-p]')];
      return items.map(el => ({ page: el.dataset.p, visible: el.style.display !== 'none' }));
    });
    const shouldSeeWorklist = sidebarState.find(i => i.page === 'worklist');
    const shouldNotSeeBilling = sidebarState.find(i => i.page === 'billing');
    const shouldNotSeeRegister = sidebarState.find(i => i.page === 'register');
    await page.evaluate(() => goPage('worklist'));
    await page.waitForTimeout(150);
    const onWorklistPage = await page.evaluate(() => document.getElementById('page-worklist')?.classList.contains('active'));
    await page.evaluate(() => goPage('billing'));
    await page.waitForTimeout(150);
    const onBillingPage = await page.evaluate(() => document.getElementById('page-billing')?.classList.contains('active'));
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(150);
    const onRegisterPage = await page.evaluate(() => document.getElementById('page-register')?.classList.contains('active'));

    const sidebarOk = shouldSeeWorklist?.visible === true && shouldNotSeeBilling?.visible === false && shouldNotSeeRegister?.visible === false;
    const gateOk = onWorklistPage === true && onBillingPage === false && onRegisterPage === false;
    log('2c', (sidebarOk && gateOk) ? 'PASS' : 'FAIL',
      `Lab Tech sidebar: Worklist visible=${shouldSeeWorklist?.visible}, Billing visible=${shouldNotSeeBilling?.visible}, Register visible=${shouldNotSeeRegister?.visible}. ` +
      `goPage() enforcement: reached Worklist=${onWorklistPage}, blocked from Billing=${!onBillingPage}, blocked from Register=${!onRegisterPage}.`);
    await page.close();
  }

  // --- 2d: admin bypasses the client-side gate entirely (by design) ---
  {
    const page = await context.newPage();
    await loginAs(page, baseUrl, 'admin');
    await page.evaluate(() => goPage('billing'));
    await page.waitForTimeout(150);
    const onBillingPage = await page.evaluate(() => document.getElementById('page-billing')?.classList.contains('active'));
    await page.evaluate(() => goPage('worklist'));
    await page.waitForTimeout(150);
    const onWorklistPage = await page.evaluate(() => document.getElementById('page-worklist')?.classList.contains('active'));
    log('2d', (onBillingPage && onWorklistPage) ? 'PASS' : 'FAIL',
      `Admin can reach Billing (${onBillingPage}) and Worklist (${onWorklistPage}) -- confirms the documented admin bypass. NOTE: this also means the client-side gate provides ZERO restriction for a compromised/mistaken admin session; the ONLY real backstop for an over-privileged admin account is RLS on the live database (see 2a) -- client code cannot enforce anything an admin session's own browser chooses to call.`);
    await page.close();
  }

  // --- 2e: unlinked account (no staff row for this auth user) -- must be blocked, never default to admin ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('doctor', { tables: { staff: [] }, users: [{ id: 'u1', email: 'unlinked@audit.local', password: 'whatever' }] }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await page.waitForSelector('#auth-screen', { state: 'visible' });
    await page.fill('#auth-email', 'unlinked@audit.local');
    await page.fill('#auth-pass', 'whatever');
    await page.click('#auth-btn');
    await page.waitForTimeout(500);
    const stillOnAuthScreen = await page.evaluate(() => document.getElementById('auth-screen')?.style.display !== 'none' && !document.getElementById('app')?.classList.contains('visible'));
    log('2e', stillOnAuthScreen ? 'PASS' : 'FAIL',
      `A Supabase Auth user with NO linked staff row: ${stillOnAuthScreen ? 'correctly denied entry, stayed on the login screen (app never became visible)' : 'was NOT blocked -- got into the app despite having no linked staff row'}. This is the specific auth-fallback fix from an earlier session (loadProfile() previously defaulted silently to admin here) -- confirming it still holds.`);
    await page.close();
  }

  return findings;
};
