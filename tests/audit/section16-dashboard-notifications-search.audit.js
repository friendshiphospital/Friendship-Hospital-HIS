// Functional audit, Section 16: Dashboard, Notifications & Global Search.
// Real Playwright browser interaction against the real app, real STATEFUL
// mock DB (writes visible across calls, exactly like Section 15's pattern).
// Builds on Sections 11/12's already-confirmed lowStock notification
// category — this section covers the OTHER refreshNotifications()
// categories (crits/unpaid/pendingAdm/deferredDue/resultsReady), the
// Dashboard's loadDashboard() KPI tiles, and Global Search (globalSearch()).
//   (16a) Dashboard top stat-grid (ds-today/ds-pending/ds-critical/
//         ds-verified/ds-admissions/ds-theatre/ds-beds/ds-discharged) is
//         real live data, accurately computed from seeded rows.
//   (16b) BUG — the Dashboard's second stat-grid (ds-unpaid/ds-insurance/
//         ds-revenue/ds-rad-pending) and two whole card panels
//         (dash-unpaid-list "Unpaid/Blocked Patients", dash-stat-list
//         "STAT/Urgent Orders") are never written by any code anywhere —
//         confirmed by grepping the whole file (each id appears exactly
//         once, in its own markup declaration) and now confirmed live:
//         despite real qualifying data in the DB, they stay stuck at their
//         static placeholder ("—") / permanent loading spinner forever.
//   (16c) Ward Census grid quirk — a ward's occupancy count is driven by
//         beds.status==='Occupied', with active admissions only "flooring"
//         it to at least 1, never summed — demonstrated undercount when
//         admissions outnumber bed rows marked Occupied.
//   (16d) Notification bell — crits (unacknowledged critical values)
//         category + accurate count + click-through to Criticals page.
//   (16e) Notification bell — unpaid invoices category (past
//         CFG.unpaidAlertHours) + click-through to Billing/editInvoice.
//   (16f) Notification bell — pendingAdm category (routed to Admission,
//         past CFG.admissionAlertHours, correctly excludes anyone who
//         already has an admissions row) + click-through to Admission page
//         with the patient pre-selected.
//   (16g) Notification bell — deferredDue category (STAT payment-deferred
//         Lab+Radiology orders that just came back, resurfacing
//         immediately rather than waiting on unpaidAlertHours; correctly
//         drops out once actually paid) + click-through to Billing.
//   (16h) Notification bell — resultsReady category is correctly scoped to
//         doctor/admin only: identical qualifying data produces ZERO
//         entries for a nurse, but a real entry for a doctor, whose
//         click-through lands on Consultation's Orders tab.
//   (16i) Global Search — patient lookup by name/MRN/phone/lab_no (all
//         four independently), accurate (no false positive on an unrelated
//         patient), plus invoice lookup by invoice_no; click-through for
//         both (pt-history / billing+editInvoice).
//   (16j) GAP — the notif bell and Global Search render identically for
//         EVERY role regardless of ROLE_PAGES (no role-scoping at all,
//         except resultsReady's explicit doctor/admin check above) —
//         confirmed for cashier (crits/pendingAdm shown in the bell but
//         dead-end with "Access denied" on click, since cashier's
//         ROLE_PAGES has neither 'criticals' nor 'admission') and for
//         receptionist (Global Search patient results dead-end the same
//         way on 'pt-history') — contrasted against this exact same app's
//         OWN separate "existing patient" search on the Register page,
//         which DOES correctly gate its analogous history link behind a
//         live ROLE_PAGES check (canViewHistory) for the very same role.
//   (16k) Dashboard page access itself — live ROLE_PAGES spot check:
//         lab_supervisor/cashier/theatre_nurse have NO 'dashboard' entry
//         at all (sidebar hidden + goPage('dashboard') refused), while
//         admin/doctor/nurse/lab_tech/receptionist/radiologist do —
//         undocumented in README.md's role table, which never mentions
//         Dashboard for any role.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');

function initScript(seedOverrides) {
  const seed = { tables: {}, users: [], idStart: {}, ...seedOverrides };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
  `;
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

// Deterministically ends with the notif panel OPEN and freshly refreshed,
// regardless of whatever state it was left in (toggleNotifPanel() is a
// plain toggle, so calling it blind twice in a row is a footgun -- this
// always closes first, unconditionally, then opens).
async function openFreshNotifPanel(page) {
  await page.evaluate(() => { closeNotifPanel(); });
  await page.evaluate(() => toggleNotifPanel());
  await page.waitForTimeout(250);
}

const NOW = Date.now();
const TODAY = new Date(NOW).toISOString().slice(0, 10);
function hoursAgo(h) { return new Date(NOW - h * 3600000).toISOString(); }
function todayAt(hh) { return TODAY + 'T' + String(hh).padStart(2, '0') + ':00:00.000Z'; }

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // ═════════════════════════════════════════════════════════════════
  // 16a/16b/16c: Dashboard — seed a rich, realistic dataset covering
  // every KPI tile's underlying query, load the real page, read back the
  // real rendered DOM.
  // ═════════════════════════════════════════════════════════════════
  const page = await context.newPage();
  {
    const seed = {
      tables: {
        staff: [{ id: 's1', user_id: 'u1', full_name: 'Dash Admin', role: 'admin' }],
        patients: [
          { id: 'p-t1', name: 'Today Patient One', mrn: 'MRN-T1', created_at: todayAt(8) },
          { id: 'p-t2', name: 'Today Patient Two', mrn: 'MRN-T2', created_at: todayAt(9) },
          { id: 'p-t3', name: 'Today Patient Three', mrn: 'MRN-T3', created_at: todayAt(10) },
          { id: 'p-y1', name: 'Yesterday Patient', mrn: 'MRN-Y1', created_at: hoursAgo(30) }, // must NOT count toward ds-today
        ],
        results_hematology: [
          { id: 'rh1', patient_id: 'p-t1', is_verified: true, hgb: 13, created_at: todayAt(8) },
          { id: 'rh2', patient_id: 'p-t2', is_verified: false, hgb: 12, created_at: todayAt(9) }, // unverified: must NOT count
        ],
        results_chemistry: [
          { id: 'rc1', patient_id: 'p-t2', is_verified: true, glucose: 5.5, created_at: todayAt(9) },
        ],
        critical_values: [
          { id: 'cv1', patient_id: 'p-t3', parameter: 'Potassium', value: '7.2', department: 'Chemistry', is_acknowledged: false, created_at: todayAt(10) },
          { id: 'cv2', patient_id: 'p-t1', parameter: 'Glucose', value: '1.5', department: 'Chemistry', is_acknowledged: false, created_at: todayAt(9) },
          { id: 'cv3', patient_id: 'p-t2', parameter: 'HGB', value: '4.0', department: 'Haematology', is_acknowledged: true, created_at: todayAt(9) }, // acknowledged: must NOT count
        ],
        admissions: [
          { id: 'ad1', patient_id: 'p-t1', ward: 'ICU', status: 'Active', admission_no: 'ADM-1', admission_type: 'Emergency', created_at: todayAt(8) },
          { id: 'ad2', patient_id: 'p-t2', ward: 'Surgical', status: 'Active', admission_no: 'ADM-2', admission_type: 'Elective', created_at: todayAt(9) },
          { id: 'ad3', patient_id: 'p-t3', ward: 'Theatre', status: 'Active', admission_no: 'ADM-3', admission_type: 'Emergency', created_at: todayAt(10) },
          { id: 'ad4', patient_id: 'p-y1', ward: 'Medical', status: 'Discharged', discharge_date: todayAt(7), admission_no: 'ADM-4', admission_type: 'Elective', created_at: hoursAgo(40) },
          { id: 'ad5', patient_id: 'p-y1', ward: 'Medical', status: 'Discharged', discharge_date: hoursAgo(50), admission_no: 'ADM-5', admission_type: 'Elective', created_at: hoursAgo(60) }, // discharged yesterday: must NOT count in ds-discharged
          // 16c: two MORE active admissions in Surgical beyond ad2 (3 total
          // active-in-Surgical), but the beds table below only marks ONE
          // Surgical bed Occupied -- to test whether the ward grid actually
          // sums admissions or just floors bed-derived occupancy to >=1.
          { id: 'ad6', patient_id: 'p-t1', ward: 'Surgical', status: 'Active', admission_no: 'ADM-6', admission_type: 'Emergency', created_at: todayAt(11) },
          { id: 'ad7', patient_id: 'p-t2', ward: 'Surgical', status: 'Active', admission_no: 'ADM-7', admission_type: 'Emergency', created_at: todayAt(12) },
        ],
        beds: [
          { id: 'b1', ward: 'ICU', status: 'Available' },
          { id: 'b2', ward: 'ICU', status: 'Occupied' },
          { id: 'b3', ward: 'Surgical', status: 'Occupied' }, // only 1 of 3 active Surgical admissions has a matching Occupied bed row
          { id: 'b4', ward: 'Surgical', status: 'Available' },
          { id: 'b5', ward: 'Surgical', status: 'Available' },
          { id: 'b6', ward: 'Medical', status: 'Available' },
          { id: 'b7', ward: 'Medical', status: 'Available' },
        ],
        // Real qualifying billing/radiology data exists in the DB, so if
        // ds-unpaid/ds-insurance/ds-revenue/ds-rad-pending or
        // dash-unpaid-list/dash-stat-list were actually wired up, they
        // would have real, non-placeholder content to show.
        invoices: [
          { id: 'inv-u1', invoice_no: 'INV-U1', patient_name: 'Today Patient One', net_amount: 300, currency: 'SDG', payment_status: 'unpaid', created_at: todayAt(8) },
          { id: 'inv-i1', invoice_no: 'INV-I1', patient_name: 'Today Patient Two', net_amount: 450, currency: 'SDG', payment_status: 'insurance_pending', created_at: todayAt(9) },
          { id: 'inv-p1', invoice_no: 'INV-P1', patient_name: 'Today Patient Three', net_amount: 200, currency: 'SDG', payment_status: 'paid', created_at: todayAt(10) },
        ],
        radiology_requests: [
          { id: 'rr1', patient_id: 'p-t3', imaging_type: 'Chest X-Ray', status: 'Pending', created_at: todayAt(10) },
        ],
      },
      users: [{ id: 'u1', email: 'dash@fh.local', password: 'whatever' }],
    };
    await page.addInitScript(initScript(seed));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page, 'dash@fh.local', 'whatever');
    await page.evaluate(() => goPage('dashboard'));
    await page.evaluate(() => loadDashboard());
    await page.waitForTimeout(400);

    // ── 16a: top stat-grid ──
    const vals = await page.evaluate(() => ({
      today: document.getElementById('ds-today').textContent,
      pending: document.getElementById('ds-pending').textContent,
      critical: document.getElementById('ds-critical').textContent,
      verified: document.getElementById('ds-verified').textContent,
      admissions: document.getElementById('ds-admissions').textContent,
      theatre: document.getElementById('ds-theatre').textContent,
      beds: document.getElementById('ds-beds').textContent,
      discharged: document.getElementById('ds-discharged').textContent,
      critAlertVisible: document.getElementById('dash-crit-alert').style.display === 'flex',
      critAlertText: document.getElementById('dash-crit-text').textContent,
      activityHtml: document.getElementById('dash-activity').innerHTML,
    }));
    // Expected: today=3 (p-t1,p-t2,p-t3; p-y1 excluded), critical=2 (cv1,cv2; cv3 acked excluded),
    // verified=2 (rh1 + rc1; rh2 unverified excluded), pending=max(0,3-2)=1,
    // admissions=5 active (ad1,ad2,ad3,ad6,ad7), theatre=1 (ad3), beds available=4 (b1,b4,b5,b6,b7=5 actually)
    const bedsAvailableExpected = 5; // b1,b4,b5,b6,b7
    const ok16a = vals.today === '3' && vals.critical === '2' && vals.verified === '2' && vals.pending === '1'
      && vals.admissions === '5' && vals.theatre === '1' && vals.beds === String(bedsAvailableExpected) && vals.discharged === '1'
      && vals.critAlertVisible && /2 unacknowledged critical values/.test(vals.critAlertText)
      && vals.activityHtml.includes('Patient registered') && vals.activityHtml.includes('Admission ADM-') && vals.activityHtml.includes('Critical:');
    log('16a', ok16a ? 'PASS' : 'FAIL',
      `Seeded 3 patients today + 1 yesterday, 2 verified results today (+1 unverified, correctly excluded), 2 unacknowledged criticals (+1 acknowledged, correctly excluded), 5 active admissions across ICU/Surgical/Theatre, 1 admission discharged today (+1 discharged yesterday, correctly excluded), and a 7-row beds table. Loaded the real Dashboard and ran the real loadDashboard(). Read back: Patients Today=${vals.today} (expected 3), Critical Values=${vals.critical} (expected 2, acknowledged one correctly excluded), Verified Results=${vals.verified} (expected 2, unverified one correctly excluded), Pending Lab=${vals.pending} (expected 1, = today-verified), Active Admissions=${vals.admissions} (expected 5), In Theatre=${vals.theatre} (expected 1), Available Beds=${vals.beds} (expected ${bedsAvailableExpected}), Discharged Today=${vals.discharged} (expected 1, yesterday's discharge correctly excluded). The red critical-value banner correctly appeared with the right count/wording=${vals.critAlertVisible && /2 unacknowledged critical values/.test(vals.critAlertText)}. The Recent Activity feed correctly rendered real registration/admission/critical events pulled live from the DB=${vals.activityHtml.includes('Patient registered') && vals.activityHtml.includes('Critical:')}. Every one of these 8 top-row KPI tiles is genuinely live, DB-backed data — none is a static placeholder.`);

    // ── 16b: BUG — the second (billing) stat-grid + the two list panels ──
    const billingVals = await page.evaluate(() => ({
      unpaid: document.getElementById('ds-unpaid').textContent,
      insurance: document.getElementById('ds-insurance').textContent,
      revenue: document.getElementById('ds-revenue').textContent,
      radPending: document.getElementById('ds-rad-pending').textContent,
      unpaidListHtml: document.getElementById('dash-unpaid-list').innerHTML,
      statListHtml: document.getElementById('dash-stat-list').innerHTML,
    }));
    const stillPlaceholder = billingVals.unpaid === '—' && billingVals.insurance === '—' && billingVals.revenue === '—' && billingVals.radPending === '—';
    const stillSpinning = billingVals.unpaidListHtml.includes('spinner') && billingVals.statListHtml.includes('spinner');
    // Confirm this isn't a timing fluke -- wait longer and re-check.
    await page.waitForTimeout(1500);
    const billingVals2 = await page.evaluate(() => ({
      unpaid: document.getElementById('ds-unpaid').textContent,
      unpaidListHtml: document.getElementById('dash-unpaid-list').innerHTML,
    }));
    const stillStuckAfterWait = billingVals2.unpaid === '—' && billingVals2.unpaidListHtml.includes('spinner');
    const ok16b = stillPlaceholder && stillSpinning && stillStuckAfterWait;
    log('16b', ok16b ? '🚫 BUG CONFIRMED' : 'PASS (unexpectedly wired up)',
      `Seeded real qualifying data for every one of these tiles/panels: an unpaid invoice (INV-U1, 300 SDG), an insurance-pending invoice (INV-I1, 450 SDG), a paid invoice today (INV-P1, 200 SDG, for a real "Revenue Today" figure), and a pending Radiology request. After running the real loadDashboard() and waiting (incl. a further 1.5s re-check to rule out a timing fluke), the second stat-grid never moved off its static markup placeholder: Unpaid Invoices="${billingVals.unpaid}", Insurance Pending="${billingVals.insurance}", Revenue Today (SDG)="${billingVals.revenue}", Radiology Pending="${billingVals.radPending}" (all still literally "—")=${stillPlaceholder}. The two card panels "⚠️ Unpaid / Blocked Patients" and "⚡ STAT / Urgent Orders" are stuck on their permanent loading spinner forever=${stillSpinning}, confirmed not a load-timing issue=${stillStuckAfterWait}. Grepping the whole file confirms why: ds-unpaid/ds-insurance/ds-revenue/ds-rad-pending/dash-unpaid-list/dash-stat-list each appear EXACTLY ONCE in index.html — only in their own <div id="..."> markup declaration — with no setText()/innerHTML assignment anywhere in loadDashboard() or any other function. These are dead UI: 4 KPI tiles that will show "—" no matter what is in the database, and 2 entire card panels that will spin forever, on every load, for every user, permanently.`);

    // ── 16c: Ward Census grid — bed-status-driven, not admission-summed ──
    const wardGridHtml = await page.evaluate(() => document.getElementById('dash-ward-grid').innerHTML);
    // Surgical: beds show 1 Occupied of 3 total (b3 occupied, b4/b5 available)
    // -> pct = round(1/3*100) = 33%, EVEN THOUGH 3 real active admissions
    // (ad2, ad6, ad7) are sitting in Surgical right now.
    const surgicalMatch = wardGridHtml.match(/<div class="ward-name">Surgical<\/div><div class="ward-occ">(\d+)<span> \/ (\d+)<\/span><\/div>/);
    const surgicalOcc = surgicalMatch ? parseInt(surgicalMatch[1], 10) : null;
    const surgicalTotal = surgicalMatch ? parseInt(surgicalMatch[2], 10) : null;
    const ok16c = surgicalOcc === 1 && surgicalTotal === 3;
    log('16c', ok16c ? '⚠️ GAP FOUND' : 'FAIL/INCONCLUSIVE',
      `Seeded 3 real active admissions all in the Surgical ward (ad2, ad6, ad7) but only 1 matching beds row actually marked status='Occupied' in Surgical (the other 2 Surgical beds are 'Available' — i.e. the beds table wasn't kept in sync with admissions, a realistic staff-forgot-to-update-the-bed-board scenario). GAP: the Ward Census card's occupancy figure for Surgical came out as ${surgicalOcc} / ${surgicalTotal} (expected occ=1,total=3, confirming this)=${ok16c} — NOT 3/3, even though 3 real patients are actively admitted there. Reading index.html's own logic confirms why: wardOcc is computed purely by counting beds.status==='Occupied' per ward, and active admissions only run \`wardOcc[a.ward]=Math.max(wardOcc[a.ward],1)\` — a floor of "at least 1 if any admission exists", never a real sum of admissions. So the moment the beds table drifts even slightly out of sync with the admissions table (bed statuses not updated on every admit/discharge/transfer), this dashboard card silently under-reports ward occupancy — in this case understating Surgical at 33% full when it is truly over-capacity (3 patients, 3 beds). ds-theatre (In Theatre, tested in 16a) is NOT affected by this — it counts admissions.ward==='Theatre' directly — so the two "occupancy" numbers on the very same dashboard are computed by genuinely different methods with different accuracy characteristics.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 16d-16h: Notification bell categories (crits/unpaid/pendingAdm/
  // deferredDue/resultsReady), fresh page/DB per subsection to keep each
  // category's seed unambiguous.
  // ═════════════════════════════════════════════════════════════════
  {
    const seed = {
      tables: {
        // Admin, not doctor: this session's job is to prove EVERY category's
        // click-through actually lands (billing/admission/criticals/
        // consultation), so it needs full page access. resultsReady's own
        // doctor/admin role gate (see refreshNotifications()) still applies
        // to admin the same as doctor, so this doesn't weaken 16h -- the
        // negative case (a role that should NOT get resultsReady) is
        // covered separately below by a genuine nurse session.
        staff: [{ id: 's2', user_id: 'u2', full_name: 'Notif Admin', role: 'admin' }],
        patients: [
          { id: 'p-crit', name: 'Critical Patient', mrn: 'MRN-C1', created_at: hoursAgo(1) },
          { id: 'p-adm-pending', name: 'Waiting Admission Patient', mrn: 'MRN-A1', visit_destination: 'admission', created_at: hoursAgo(10) }, // >4h admCutoff, no admissions row -> should surface
          { id: 'p-adm-done', name: 'Already Admitted Patient', mrn: 'MRN-A2', visit_destination: 'admission', created_at: hoursAgo(10) }, // has an admissions row -> must be excluded
          { id: 'p-doc-ready', name: 'Doctor Queue Patient', mrn: 'MRN-D1', lab_no: 'FH-1', visit_destination: 'doctor', created_at: hoursAgo(2) },
        ],
        admissions: [{ id: 'ad-done', patient_id: 'p-adm-done', ward: 'Medical', status: 'Active', created_at: hoursAgo(5) }],
        invoices: [{ id: 'inv-old', invoice_no: 'INV-OLD1', patient_id: 'p-crit', patient_name: 'Critical Patient', net_amount: 500, currency: 'SDG', payment_status: 'unpaid', created_at: hoursAgo(100) }], // >72h unpaidCutoff -> should surface
        critical_values: [{ id: 'cv-notif', patient_id: 'p-crit', parameter: 'Sodium', value: '118', department: 'Chemistry', is_acknowledged: false, created_at: hoursAgo(1) }],
        sample_records: [{ id: 'sr1', patient_id: 'p-doc-ready', status: 'Released', payment_deferred: false }],
      },
      users: [{ id: 'u2', email: 'notifdoc@fh.local', password: 'whatever' }],
    };
    await page.addInitScript(initScript(seed));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page, 'notifdoc@fh.local', 'whatever');
    await page.evaluate(() => goPage('dashboard'));
    await page.evaluate(() => refreshNotifications());
    await page.waitForTimeout(400);

    const state = await page.evaluate(() => JSON.parse(JSON.stringify(_notifState)));
    const bellCount = await page.evaluate(() => document.getElementById('notif-bell-count').textContent);
    const bellVisible = await page.evaluate(() => document.getElementById('notif-bell-count').style.display !== 'none');

    // 16d: crits
    const critsOk = state.crits.length === 1 && state.crits[0].patient_id === 'p-crit' && state.crits[0].parameter === 'Sodium' && state.crits[0].patients?.name === 'Critical Patient';
    await openFreshNotifPanel(page);
    const critListHtml = await page.evaluate(() => document.getElementById('notif-list').innerHTML);
    const critRenderOk = critListHtml.includes('Critical Patient') && critListHtml.includes('Sodium = 118');
    await page.evaluate(() => document.querySelector('#notif-list div[onclick^="notifJumpToCritical"]').click());
    await page.waitForTimeout(200);
    const onCriticalsPage = await page.evaluate(() => document.getElementById('page-criticals')?.classList.contains('active'));
    const ok16d = critsOk && critRenderOk && onCriticalsPage;
    log('16d', ok16d ? 'PASS' : 'FAIL',
      `Seeded one real unacknowledged critical value (Sodium=118, Critical Patient) plus (for contrast) an acknowledged one is absent from this seed entirely. refreshNotifications() correctly picked up exactly the 1 unacknowledged row with the right patient/parameter/value joined in via the patients(name,mrn) embed=${critsOk}. The rendered notif panel showed it under the "🚨 Unacknowledged Criticals" header with the right text=${critRenderOk}. Clicking it ran the real notifJumpToCritical() and correctly navigated to the Criticals page=${onCriticalsPage}.`);

    // 16e: unpaid
    const unpaidOk = state.unpaid.length === 1 && state.unpaid[0].invoice_no === 'INV-OLD1' && state.unpaid[0].net_amount === 500;
    await openFreshNotifPanel(page);
    const unpaidListHtml = await page.evaluate(() => document.getElementById('notif-list').innerHTML);
    const unpaidRenderOk = unpaidListHtml.includes('INV-OLD1') && unpaidListHtml.includes('500.00');
    await page.evaluate(() => document.querySelector('#notif-list div[onclick*="notifJumpToInvoice"]').click());
    await page.waitForTimeout(300);
    const billEditId = await page.evaluate(() => document.getElementById('bill-edit-id').value);
    const onBillingPage = await page.evaluate(() => document.getElementById('page-billing')?.classList.contains('active'));
    const ok16e = unpaidOk && unpaidRenderOk && onBillingPage && billEditId === 'inv-old';
    log('16e', ok16e ? 'PASS' : 'FAIL',
      `Seeded one real invoice created 100 hours ago with payment_status='unpaid' (past the default 72h CFG.unpaidAlertHours cutoff). refreshNotifications() correctly surfaced it under 'unpaid' with the right invoice_no/amount=${unpaidOk}, rendered correctly under "💰 Unpaid Invoices"=${unpaidRenderOk}. Clicking it ran the real notifJumpToInvoice()->jumpToInvoice(), navigated to Billing=${onBillingPage}, and loaded the real invoice into the edit form (bill-edit-id="${billEditId}")=${billEditId === 'inv-old'}.`);

    // 16f: pendingAdm
    const pendingAdmOk = state.pendingAdm.length === 1 && state.pendingAdm[0].id === 'p-adm-pending';
    const excludesAlreadyAdmitted = !state.pendingAdm.some(p => p.id === 'p-adm-done');
    await openFreshNotifPanel(page);
    const pendingAdmListHtml = await page.evaluate(() => document.getElementById('notif-list').innerHTML);
    const pendingAdmRenderOk = pendingAdmListHtml.includes('Waiting Admission Patient') && !pendingAdmListHtml.includes('Already Admitted Patient');
    await page.evaluate(() => document.querySelector('#notif-list div[onclick*="notifJumpToAdmission"]').click());
    await page.waitForTimeout(300);
    const onAdmissionPage = await page.evaluate(() => document.getElementById('page-admission')?.classList.contains('active'));
    const admPtSelected = await page.evaluate(() => document.getElementById('adm-pt-name-disp')?.textContent);
    const ok16f = pendingAdmOk && excludesAlreadyAdmitted && pendingAdmRenderOk && onAdmissionPage && admPtSelected === 'Waiting Admission Patient';
    log('16f', ok16f ? 'PASS' : 'FAIL',
      `Seeded two patients routed to Admission at registration 10h ago (past the default 4h CFG.admissionAlertHours cutoff) — one (MRN-A1) with NO admissions row yet, one (MRN-A2) who already has a real admissions row. refreshNotifications() correctly surfaced only MRN-A1 as pendingAdm, correctly EXCLUDING MRN-A2 via its own live "already has an admissions row" check=${pendingAdmOk && excludesAlreadyAdmitted}, rendered correctly under "🛏 Pending Admissions" (only the waiting patient shown, not the already-admitted one)=${pendingAdmRenderOk}. Clicking it ran the real notifJumpToAdmission(), navigated to the Admission page=${onAdmissionPage}, and pre-selected the correct patient in the admit banner (admPtSelected="${admPtSelected}")=${admPtSelected === 'Waiting Admission Patient'}.`);

    // 16h: resultsReady is scoped to doctor/admin -- this session IS an
    // admin, so it should be populated; a fresh nurse session against the
    // identical qualifying data should come back empty (checked below).
    const resultsReadyOk = state.resultsReady.length === 1 && state.resultsReady[0].id === 'p-doc-ready';
    await openFreshNotifPanel(page);
    const rrHtml = await page.evaluate(() => document.getElementById('notif-list').innerHTML);
    const rrRenderOk = rrHtml.includes('Doctor Queue Patient') && rrHtml.includes('Results Ready');
    await page.evaluate(() => document.querySelector('#notif-list div[onclick*="notifJumpToPatientResults"]').click());
    await page.waitForTimeout(600); // notifJumpToPatientResults awaits a fetch THEN sets a further 250ms setTimeout
    const onConsultPage = await page.evaluate(() => document.getElementById('page-consultation')?.classList.contains('active'));
    const onOrdersTab = await page.evaluate(() => {
      const panel = document.getElementById('doc-tab-orders');
      const btn = [...document.querySelectorAll('#doc-tabs .tab')].find(b => /orders/i.test(b.textContent || ''));
      return !!panel && panel.style.display !== 'none' && !!btn && btn.classList.contains('active');
    });
    const docPtId = await page.evaluate(() => document.getElementById('doc-pt-id').value);
    const ok16hDoctor = resultsReadyOk && rrRenderOk && onConsultPage && docPtId === 'p-doc-ready';

    // Same exact seed data, but a NURSE session -- resultsReady must come
    // back empty (the role gate lives inside refreshNotifications() itself,
    // not just in what's rendered).
    const nurseSeed = JSON.parse(JSON.stringify(seed));
    nurseSeed.tables.staff = [{ id: 's-nurse', user_id: 'u-nurse', full_name: 'Notif Nurse', role: 'nurse' }];
    nurseSeed.users = [{ id: 'u-nurse', email: 'notifnurse@fh.local', password: 'whatever' }];
    const nursePage = await context.newPage();
    await nursePage.addInitScript(initScript(nurseSeed));
    await nursePage.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(nursePage, 'notifnurse@fh.local', 'whatever');
    await nursePage.evaluate(() => goPage('dashboard'));
    await nursePage.evaluate(() => refreshNotifications());
    await nursePage.waitForTimeout(400);
    const nurseState = await nursePage.evaluate(() => JSON.parse(JSON.stringify(_notifState)));
    const nurseResultsReadyEmpty = Array.isArray(nurseState.resultsReady) && nurseState.resultsReady.length === 0;
    await nursePage.close();

    const ok16h = ok16hDoctor && nurseResultsReadyEmpty;
    log('16h', ok16h ? 'PASS' : 'FAIL',
      `Seeded one patient routed to the Doctor queue 2h ago (past the resultsReady's 24h window) whose sample was already Released. As an ADMIN session (resultsReady's gate is \`role==='doctor'||role==='admin'\`, so admin exercises the same code path a doctor would), refreshNotifications() correctly populated resultsReady with exactly this patient=${resultsReadyOk}, rendered under "🔔 Results Ready"=${rrRenderOk}, and clicking it ran the real notifJumpToPatientResults(), navigated to Consultation=${onConsultPage}, loaded the correct patient (doc-pt-id="${docPtId}")=${docPtId === 'p-doc-ready'}, and landed on the Orders tab specifically (not the default Notes tab)=${onOrdersTab}. As a fresh NURSE session against the IDENTICAL qualifying seed data, resultsReady came back completely empty (length=${nurseState.resultsReady?.length})=${nurseResultsReadyEmpty} — confirming the doctor/admin-only scoping documented in the code comment is real and lives inside refreshNotifications() itself (the extra queries are skipped entirely for other roles), not merely hidden in the UI after being fetched.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 16g: deferredDue — STAT payment-deferral resurfacing for BOTH Lab and
  // Radiology sources, and correctly dropping out once actually paid.
  // ═════════════════════════════════════════════════════════════════
  {
    const seed = {
      tables: {
        staff: [{ id: 's3', user_id: 'u3', full_name: 'Deferred Admin', role: 'admin' }],
        patients: [
          { id: 'p-def-lab', name: 'Deferred Lab Patient', mrn: 'MRN-DL1', payment_status: 'unpaid', created_at: hoursAgo(1) },
          { id: 'p-def-rad', name: 'Deferred Rad Patient', mrn: 'MRN-DR1', payment_status: 'insurance_pending', created_at: hoursAgo(1) },
          { id: 'p-def-paid', name: 'Deferred Then Paid Patient', mrn: 'MRN-DP1', payment_status: 'paid', created_at: hoursAgo(1) }, // deferral released but now paid -> must NOT surface
        ],
        sample_records: [
          { id: 'sr-def1', patient_id: 'p-def-lab', status: 'Released', payment_deferred: true },
          { id: 'sr-def2', patient_id: 'p-def-paid', status: 'Released', payment_deferred: true },
        ],
        radiology_requests: [
          { id: 'rr-def1', patient_id: 'p-def-rad', imaging_type: 'Abdominal Ultrasound', status: 'Reported', payment_deferred: true },
        ],
        invoices: [{ id: 'inv-def', invoice_no: 'INV-DEF1', patient_id: 'p-def-lab', patient_name: 'Deferred Lab Patient', net_amount: 150, currency: 'SDG', payment_status: 'unpaid', created_at: hoursAgo(1) }],
      },
      users: [{ id: 'u3', email: 'deferred@fh.local', password: 'whatever' }],
    };
    await page.addInitScript(initScript(seed));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page, 'deferred@fh.local', 'whatever');
    await page.evaluate(() => goPage('dashboard'));
    await page.evaluate(() => refreshNotifications());
    await page.waitForTimeout(400);

    const state = await page.evaluate(() => JSON.parse(JSON.stringify(_notifState)));
    const labEntry = state.deferredDue.find(d => d.kind === 'Lab');
    const radEntry = state.deferredDue.find(d => d.kind === 'Radiology');
    const excludesPaid = !state.deferredDue.some(d => d.patient_id === 'p-def-paid');
    const dataOk = state.deferredDue.length === 2 && labEntry?.patients?.name === 'Deferred Lab Patient' && radEntry?.patients?.name === 'Deferred Rad Patient' && radEntry?.label === 'Abdominal Ultrasound' && excludesPaid;

    await openFreshNotifPanel(page);
    const html = await page.evaluate(() => document.getElementById('notif-list').innerHTML);
    const renderOk = html.includes('Deferred Payments Now Due') && html.includes('Deferred Lab Patient') && html.includes('Deferred Rad Patient') && html.includes('Abdominal Ultrasound') && !html.includes('Deferred Then Paid Patient');
    await page.evaluate(() => document.querySelector('#notif-list div[onclick*="notifJumpToDeferredPayment"]').click());
    await page.waitForTimeout(300);
    const onBillingPage = await page.evaluate(() => document.getElementById('page-billing')?.classList.contains('active'));
    const billEditId = await page.evaluate(() => document.getElementById('bill-edit-id').value);

    const ok = dataOk && renderOk && onBillingPage && billEditId === 'inv-def';
    log('16g', ok ? 'PASS' : 'FAIL',
      `Seeded a STAT-deferred Lab order that just came back Released for an unpaid patient, a STAT-deferred Radiology study just Reported for an insurance_pending patient, AND a third patient whose Lab deferral is likewise Released but who has since actually paid (payment_status='paid'). refreshNotifications() correctly surfaced exactly the first two under deferredDue with the right kind/label/patient joined in, and correctly EXCLUDED the paid one=${dataOk}. Rendered under "⚠ Deferred Payments Now Due" showing both Lab and Radiology sources, correctly omitting the paid patient=${renderOk}. Clicking the Lab entry ran the real notifJumpToDeferredPayment(), navigated to Billing=${onBillingPage}, and loaded that exact patient's real unpaid invoice into the edit form=${billEditId === 'inv-def'}. This category resurfaces independently of the generic 72h unpaid-invoice cutoff — the seeded invoice here is only 1h old, well under CFG.unpaidAlertHours, yet still correctly appeared because the RESULT (not the invoice age) is what triggers it.`);
  }
  await page.close();

  // ═════════════════════════════════════════════════════════════════
  // 16i: Global Search — patient by name/MRN/phone/lab_no, invoice by
  // invoice_no; accuracy (no false positives) + click-through for both.
  // ═════════════════════════════════════════════════════════════════
  {
    const page4 = await context.newPage();
    const seed = {
      tables: {
        staff: [{ id: 's4', user_id: 'u4', full_name: 'Search Admin', role: 'admin' }],
        patients: [
          { id: 'p-gs1', name: 'Fatima Al-Rashid', mrn: 'MRN-9911', phone: '0912345678', lab_no: 'FH-25-777', visit_no: 'V-501', age: 34, age_unit: 'y', sex: 'F' },
          { id: 'p-gs2', name: 'Unrelated Patient Zed', mrn: 'MRN-0001', phone: '0900000000', lab_no: 'FH-25-000', visit_no: 'V-000', age: 50, age_unit: 'y', sex: 'M' },
        ],
        invoices: [{ id: 'inv-gs1', invoice_no: 'INV-SEARCH-42', patient_id: 'p-gs1', patient_name: 'Fatima Al-Rashid', net_amount: 620, currency: 'SDG', payment_status: 'unpaid' }],
      },
      users: [{ id: 'u4', email: 'search@fh.local', password: 'whatever' }],
    };
    await page4.addInitScript(initScript(seed));
    await page4.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(page4, 'search@fh.local', 'whatever');
    await page4.evaluate(() => goPage('dashboard'));
    await page4.waitForTimeout(200);

    async function searchAndRead(term) {
      await page4.fill('#gs-input', '');
      await page4.fill('#gs-input', term);
      await page4.waitForTimeout(400); // debounce is 220ms
      return page4.evaluate(() => document.getElementById('gs-results').innerHTML);
    }

    const byName = await searchAndRead('Fatima');
    const byNameOk = byName.includes('Fatima Al-Rashid') && !byName.includes('Unrelated Patient Zed');
    const byMrn = await searchAndRead('MRN-9911');
    const byMrnOk = byMrn.includes('Fatima Al-Rashid') && !byMrn.includes('Unrelated Patient Zed');
    const byPhone = await searchAndRead('0912345678');
    const byPhoneOk = byPhone.includes('Fatima Al-Rashid') && !byPhone.includes('Unrelated Patient Zed');
    const byLabNo = await searchAndRead('FH-25-777');
    const byLabNoOk = byLabNo.includes('Fatima Al-Rashid') && byLabNo.includes('Lab FH-25-777') && !byLabNo.includes('Unrelated Patient Zed');
    const byInvoice = await searchAndRead('INV-SEARCH-42');
    const byInvoiceOk = byInvoice.includes('INV-SEARCH-42') && byInvoice.includes('Fatima Al-Rashid') && byInvoice.includes('620.00');
    const noMatch = await searchAndRead('zzzznonexistentzzzz');
    const noMatchOk = /No matches for/.test(noMatch);

    // Click-through: patient result -> pt-history + correct patient loaded.
    await searchAndRead('Fatima');
    await page4.evaluate(() => document.querySelector('#gs-results div[onclick*="jumpToPatient"]').click());
    await page4.waitForTimeout(300);
    const onPtHistory = await page4.evaluate(() => document.getElementById('page-pt-history')?.classList.contains('active'));
    const pthName = await page4.evaluate(() => document.getElementById('pth-pt-name')?.textContent);
    const gsInputCleared = await page4.evaluate(() => document.getElementById('gs-input').value === '');
    const patientClickOk = onPtHistory && pthName === 'Fatima Al-Rashid' && gsInputCleared;

    // Click-through: invoice result -> billing + editInvoice.
    await page4.evaluate(() => goPage('dashboard'));
    await searchAndRead('INV-SEARCH-42');
    await page4.evaluate(() => document.querySelector('#gs-results div[onclick*="jumpToInvoice"]').click());
    await page4.waitForTimeout(300);
    const onBilling = await page4.evaluate(() => document.getElementById('page-billing')?.classList.contains('active'));
    const billEditId = await page4.evaluate(() => document.getElementById('bill-edit-id').value);
    const invoiceClickOk = onBilling && billEditId === 'inv-gs1';

    const ok = byNameOk && byMrnOk && byPhoneOk && byLabNoOk && byInvoiceOk && noMatchOk && patientClickOk && invoiceClickOk;
    log('16i', ok ? 'PASS' : 'FAIL',
      `Seeded two distinct patients (one target, one deliberately similar-looking decoy "Unrelated Patient Zed") and one invoice. Global Search correctly matched the target patient and correctly EXCLUDED the decoy when searching by name=${byNameOk}, MRN=${byMrnOk}, phone=${byPhoneOk}, and lab_no (with the "· Lab FH-25-777" hint correctly appended for a lab-no-specific hit)=${byLabNoOk}. Invoice search by invoice_no returned the right invoice with correct patient name and amount=${byInvoiceOk}. A deliberately non-matching term correctly showed "No matches"=${noMatchOk}. Click-through worked for both result types: a patient result ran jumpToPatient()->openPatientHistoryTimeline(), navigated to Patient History Timeline, loaded the correct patient, and cleared the search box=${patientClickOk}; an invoice result ran jumpToInvoice(), navigated to Billing, and loaded the correct invoice into the edit form=${invoiceClickOk}.`);
    await page4.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 16j: role-scoping gap — the notif bell / Global Search UI itself is
  // NOT gated by ROLE_PAGES at all (aside from resultsReady's explicit
  // doctor/admin check, tested in 16h). A role that lacks the destination
  // page for a category still sees it counted/rendered in the bell, and
  // clicking it dead-ends with "Access denied". Contrasted against this
  // same app's OWN Register-page "existing patient" search, which DOES
  // correctly gate its own history link behind ROLE_PAGES for that role.
  // ═════════════════════════════════════════════════════════════════
  {
    const seed = {
      tables: {
        staff: [{ id: 's5', user_id: 'u5', full_name: 'Cash Register', role: 'cashier' }],
        patients: [
          { id: 'p-cash-crit', name: 'Cashier View Critical', mrn: 'MRN-CV1', created_at: hoursAgo(1) },
          { id: 'p-cash-adm', name: 'Cashier View PendingAdm', mrn: 'MRN-CV2', visit_destination: 'admission', created_at: hoursAgo(10) },
        ],
        critical_values: [{ id: 'cv-cash', patient_id: 'p-cash-crit', parameter: 'Potassium', value: '6.9', department: 'Chemistry', is_acknowledged: false, created_at: hoursAgo(1) }],
        invoices: [{ id: 'inv-cash', invoice_no: 'INV-CASH1', patient_id: 'p-cash-crit', patient_name: 'Cashier View Critical', net_amount: 80, currency: 'SDG', payment_status: 'unpaid', created_at: hoursAgo(100) }],
      },
      users: [{ id: 'u5', email: 'cashier@fh.local', password: 'whatever' }],
    };
    // cashier's ROLE_PAGES is ['billing','prices'] -- neither 'criticals'
    // nor 'admission' nor 'dashboard' is in it, so navigate straight into
    // 'billing', the one page this role can actually reach, and drive the
    // bell from there (proving the topbar/bell/search are reachable from
    // ANY page, independent of what that page's own role access is).
    const pageC = await context.newPage();
    await pageC.addInitScript(initScript(seed));
    await pageC.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(pageC, 'cashier@fh.local', 'whatever');
    await pageC.evaluate(() => goPage('billing'));
    await pageC.waitForTimeout(150);
    const bellReachableFromBilling = await pageC.evaluate(() => !!document.getElementById('notif-bell-wrap') && !!document.getElementById('gs-input'));

    await pageC.evaluate(() => refreshNotifications());
    await pageC.waitForTimeout(300);
    const cashierState = await pageC.evaluate(() => JSON.parse(JSON.stringify(_notifState)));
    const cashierSeesCrits = cashierState.crits.length === 1;
    const cashierSeesPendingAdm = cashierState.pendingAdm.length === 1;

    await openFreshNotifPanel(pageC);
    // Click the critical -> goPage('criticals') should be refused (cashier lacks it).
    await pageC.evaluate(() => document.querySelector('#notif-list div[onclick^="notifJumpToCritical"]').click());
    await pageC.waitForTimeout(200);
    const critDeniedToast = await lastToast(pageC);
    const critStillOnBilling = await pageC.evaluate(() => document.getElementById('page-billing')?.classList.contains('active'));
    const critDeadEnd = /Access denied/i.test(critDeniedToast || '') && critStillOnBilling;

    // Reopen panel, click pendingAdm -> goPage('admission') also refused.
    await openFreshNotifPanel(pageC);
    await pageC.evaluate(() => document.querySelector('#notif-list div[onclick*="notifJumpToAdmission"]').click());
    await pageC.waitForTimeout(200);
    const admDeniedToast = await lastToast(pageC);
    const admStillOnBilling = await pageC.evaluate(() => document.getElementById('page-billing')?.classList.contains('active'));
    const admDeadEnd = /Access denied/i.test(admDeniedToast || '') && admStillOnBilling;

    // But the unpaid-invoice category DOES work for cashier, since
    // 'billing' IS in cashier's ROLE_PAGES -- confirming this is
    // specifically a per-destination-page gap, not a universal breakage.
    await openFreshNotifPanel(pageC);
    await pageC.evaluate(() => document.querySelector('#notif-list div[onclick*="notifJumpToInvoice"]').click());
    await pageC.waitForTimeout(400); // jumpToInvoice()'s editInvoice() runs on a 250ms setTimeout
    const invoiceWorksForCashier = await pageC.evaluate(() => document.getElementById('bill-edit-id').value === 'inv-cash');

    // Global Search patient click-through for a RECEPTIONIST (also lacks
    // 'pt-history'), contrasted against the Register page's OWN existing-
    // patient search, which correctly hides the same link for this role.
    const recSeed = {
      tables: {
        staff: [{ id: 's6', user_id: 'u6', full_name: 'Front Desk', role: 'receptionist' }],
        patients: [{ id: 'p-rec1', name: 'Reception Search Target', mrn: 'MRN-REC1', phone: '0955555555', created_at: hoursAgo(1) }],
      },
      users: [{ id: 'u6', email: 'reception@fh.local', password: 'whatever' }],
    };
    const pageR = await context.newPage();
    await pageR.addInitScript(initScript(recSeed));
    await pageR.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    await loginAs(pageR, 'reception@fh.local', 'whatever');
    await pageR.evaluate(() => goPage('register'));
    await pageR.waitForTimeout(150);
    const pthNotInRolePages = await pageR.evaluate(() => !(ROLE_PAGES['receptionist'] || []).includes('pt-history'));

    await pageR.fill('#gs-input', 'Reception Search Target');
    await pageR.waitForTimeout(400);
    const gsHtml = await pageR.evaluate(() => document.getElementById('gs-results').innerHTML);
    const receptionistSeesResult = gsHtml.includes('Reception Search Target');
    await pageR.evaluate(() => document.querySelector('#gs-results div[onclick*="jumpToPatient"]').click());
    await pageR.waitForTimeout(300);
    const gsDeniedToast = await lastToast(pageR);
    const gsStillOnRegister = await pageR.evaluate(() => document.getElementById('page-register')?.classList.contains('active'));
    const gsDeadEnd = /Access denied/i.test(gsDeniedToast || '') && gsStillOnRegister;

    const ok = bellReachableFromBilling && cashierSeesCrits && cashierSeesPendingAdm && critDeadEnd && admDeadEnd && invoiceWorksForCashier && pthNotInRolePages && receptionistSeesResult && gsDeadEnd;
    log('16j', ok ? '⚠️ GAP FOUND' : 'FAIL/INCONCLUSIVE',
      `The notification bell and Global Search live in the persistent topbar shell (outside the per-role-gated .page divs), reachable from any page a role can reach at all=${bellReachableFromBilling}. As a CASHIER (ROLE_PAGES=['billing','prices'] only — no 'criticals', 'admission', or even 'dashboard') sitting on the one page cashier can reach (Billing): the bell still counted and rendered a real unacknowledged critical=${cashierSeesCrits} and a real pending admission=${cashierSeesPendingAdm} exactly as it would for any other role. Clicking the critical correctly reached notifJumpToCritical()->goPage('criticals'), which goPage()'s own ROLE_PAGES check correctly refused with "Access denied" — but the notif panel had already shown it as if actionable, and the click is a dead end (stayed on Billing, nothing happened)=${critDeadEnd}. Clicking the pending-admission entry hit the identical dead end against goPage('admission')=${admDeadEnd}. By contrast, clicking the Unpaid Invoices entry worked completely normally=${invoiceWorksForCashier}, because 'billing' IS in cashier's ROLE_PAGES — confirming this is specifically a per-destination-page gap in the bell/search, not a general breakage. The SAME shape of gap exists in Global Search for a RECEPTIONIST, who likewise lacks 'pt-history' in ROLE_PAGES=${pthNotInRolePages}: searching a real patient by name from the Register page correctly returned a match=${receptionistSeesResult}, but clicking it (jumpToPatient->openPatientHistoryTimeline->goPage('pt-history')) is an identical dead end, refused with "Access denied"=${gsDeadEnd}. Notably, this exact same app already gets this right elsewhere for the identical role/page pairing: the Register page's OWN separate "existing patient" search (selectExistingFilePatient) explicitly checks \`canViewHistory = (ROLE_PAGES[currentProfile.role]||[]).includes('pt-history')\` before rendering its own "View →" history link, correctly hiding it for a receptionist — but the persistent topbar's Global Search performs no such check before offering the exact same click target. Neither the bell nor Global Search is functionally broken for roles WITH the destination page (admin/doctor/etc. all tested working in 16d-16i) — the gap is confined to roles without it, where these two topbar features advertise actions their own role access will then refuse.`);
    await pageC.close();
    await pageR.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 16k: Dashboard page access itself — live ROLE_PAGES spot check.
  // ═════════════════════════════════════════════════════════════════
  {
    const roleSeed = {
      tables: { staff: [
        { id: 'r-admin', user_id: 'ur-admin', full_name: 'R Admin', role: 'admin' },
        { id: 'r-doctor', user_id: 'ur-doctor', full_name: 'R Doctor', role: 'doctor' },
        { id: 'r-nurse', user_id: 'ur-nurse', full_name: 'R Nurse', role: 'nurse' },
        { id: 'r-labtech', user_id: 'ur-labtech', full_name: 'R Lab Tech', role: 'lab_tech' },
        { id: 'r-labsup', user_id: 'ur-labsup', full_name: 'R Lab Supervisor', role: 'lab_supervisor' },
        { id: 'r-recep', user_id: 'ur-recep', full_name: 'R Receptionist', role: 'receptionist' },
        { id: 'r-cashier', user_id: 'ur-cashier', full_name: 'R Cashier', role: 'cashier' },
        { id: 'r-theatre', user_id: 'ur-theatre', full_name: 'R Theatre Nurse', role: 'theatre_nurse' },
        { id: 'r-radio', user_id: 'ur-radio', full_name: 'R Radiologist', role: 'radiologist' },
      ] },
      users: [
        { id: 'ur-admin', email: 'ra1@fh.local', password: 'whatever' },
        { id: 'ur-doctor', email: 'ra2@fh.local', password: 'whatever' },
        { id: 'ur-nurse', email: 'ra3@fh.local', password: 'whatever' },
        { id: 'ur-labtech', email: 'ra4@fh.local', password: 'whatever' },
        { id: 'ur-labsup', email: 'ra5@fh.local', password: 'whatever' },
        { id: 'ur-recep', email: 'ra6@fh.local', password: 'whatever' },
        { id: 'ur-cashier', email: 'ra7@fh.local', password: 'whatever' },
        { id: 'ur-theatre', email: 'ra8@fh.local', password: 'whatever' },
        { id: 'ur-radio', email: 'ra9@fh.local', password: 'whatever' },
      ],
    };
    const checkRole = async (email, entryPage) => {
      const p = await context.newPage();
      await p.addInitScript(initScript(roleSeed));
      await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
      await loginAs(p, email, 'whatever');
      await p.evaluate((ep) => goPage(ep), entryPage);
      await p.waitForTimeout(150);
      const sidebarVisible = await p.evaluate(() => {
        const el = document.querySelector('[data-p="dashboard"]');
        return !!el && el.style.display !== 'none';
      });
      await p.evaluate(() => goPage('dashboard'));
      await p.waitForTimeout(150);
      const entered = await p.evaluate(() => document.getElementById('page-dashboard')?.classList.contains('active'));
      const deniedToast = await lastToast(p);
      await p.close();
      return { sidebarVisible, entered, deniedToast };
    };

    const admin = await checkRole('ra1@fh.local', 'dashboard');
    const doctor = await checkRole('ra2@fh.local', 'dashboard');
    const nurse = await checkRole('ra3@fh.local', 'dashboard');
    const labTech = await checkRole('ra4@fh.local', 'dashboard');
    const labSup = await checkRole('ra5@fh.local', 'register'); // lab_supervisor's ROLE_PAGES has no 'dashboard' -- enter via a page it does have
    const recep = await checkRole('ra6@fh.local', 'dashboard');
    const cashier = await checkRole('ra7@fh.local', 'billing');
    const theatre = await checkRole('ra8@fh.local', 'theatre');
    const radio = await checkRole('ra9@fh.local', 'dashboard');

    const hasDashboardOk = [admin, doctor, nurse, labTech, recep, radio].every(r => r.entered && r.sidebarVisible);
    const lacksDashboardOk = [labSup, cashier, theatre].every(r => !r.entered && !r.sidebarVisible && /Access denied/i.test(r.deniedToast || ''));

    const ok = hasDashboardOk && lacksDashboardOk;
    log('16k', ok ? 'PASS (matches live ROLE_PAGES; undocumented in README\'s role table)' : 'FAIL',
      `Live ROLE_PAGES spot check for 'dashboard', each role on its own fresh session. HAS access (sidebar item visible + goPage('dashboard') succeeds): admin, doctor, nurse, lab_tech, receptionist, radiologist — all confirmed=${hasDashboardOk}. LACKS access (sidebar item hidden + goPage('dashboard') refused with "Access denied"): lab_supervisor, cashier, theatre_nurse — all confirmed=${lacksDashboardOk}. This 6-vs-3 split is real and consistently enforced (both the sidebar visual gate via filterSidebar() and goPage()'s own functional gate agree for every role tested) — but it is NOT documented anywhere: CLAUDE.md's "Roles and page access" table (reproduced from README.md) never mentions Dashboard for ANY role, including the ones that do have it, so a reader has no way to know from the docs alone that lab_supervisor/cashier/theatre_nurse are the three exceptions. Not a functional bug (the code is internally consistent), but a documentation gap worth closing given how central the Dashboard is.`);
  }

  return findings;
};
