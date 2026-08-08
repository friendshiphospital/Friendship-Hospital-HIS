// Functional audit, Section 18: Offline Support.
// Real Playwright browser interaction against the real app, with GENUINE
// browser-level offline emulation (context.setOffline(true/false), which
// actually flips navigator.onLine and fires real 'online'/'offline' DOM
// events in Chromium) rather than merely mocking a function to fail --
// proving the real offline detection path (dbWrite()'s own
// `if (navigator.onLine && sb)` branch), not just a simulated stand-in.
//
// Covers, per CLAUDE.md's "Supabase access + offline-first writes" section:
//   (18a) golden path — a real dbWrite()-backed save (Nursing Vital Signs)
//         made while genuinely offline queues into IndexedDB instead of
//         failing, with the correct toast and connection-badge/sync-panel
//         state.
//   (18b) reconnection — going back online fires the real 'online' event,
//         which auto-triggers flushOfflineQueue() (no manual click needed),
//         draining the queue into the (now-online) mock backend.
//   (18c) a failed sync attempt is NOT silently dropped -- it stays queued
//         with its error surfaced in the Sync Status panel -- and the
//         visible "🔄 Sync Now" button genuinely re-invokes the same
//         flushOfflineQueue() engine and successfully drains it once the
//         transient failure condition clears.
//   (18d) a genuine Postgrest/validation-shaped error (has .code/.details,
//         i.e. NOT a connectivity failure) is correctly told apart from a
//         real network failure by isNetworkError() and rethrown by
//         dbWrite() rather than swallowed into the offline queue -- proven
//         both as a direct dbWrite() contract test and via isNetworkError()
//         unit calls on several representative error shapes.
//   (18e) genOfflineId() -- direct unit assertions on its format/uniqueness,
//         PLUS a live, real, fully-offline patient registration
//         (submitRegistration(), genuinely offline via setOffline(true))
//         that completes end-to-end without crashing and produces a
//         genOfflineId()-generated invoice number.
//   (18f) the OTHER client-side ID fallback path -- COUNTER_TO_ID_TYPE /
//         ID_START / maxNumericField -- exercised for real via (i) sb
//         entirely absent, and (ii) sb present but the generate_next_id RPC
//         itself failing (the actual documented trigger for this fallback,
//         which is about the RPC being unreachable, not about browser
//         offline state -- verified by reading getNextNumber()'s real
//         implementation first).
//   (18g) sw.js static code check -- reads the real file directly and
//         confirms the cache-exclusion list and caching strategy actually
//         match what CLAUDE.md documents.
//   (18h) sw.js LIVE check -- actual service worker registration/activation
//         in the real headless browser against the real dev static server,
//         confirming the app shell genuinely gets cached and that a
//         supabase.co-shaped request is genuinely never cached, live (not
//         just read from source).
//
// Note up front on a real mock-harness limitation, not an app bug: the
// stateful mock Supabase client (tests/helpers/stateful-mock.js) is pure
// in-process JS -- it never makes a real network call, so
// context.setOffline() (which only affects the browser's actual network
// stack) cannot make sb.from(...)/sb.rpc(...) calls THEMSELVES fail. This
// does NOT affect dbWrite()'s own offline detection (18a/18b), which
// branches on navigator.onLine directly before ever touching sb -- that
// path is tested with fully genuine browser-level offline emulation.
// But it DOES mean getNextNumber()'s "RPC unreachable" self-healing
// fallback (18f) can only be exercised by making the RPC call itself
// return/throw an error (via a seeded rpcHandler), not by flipping
// browser-level connectivity -- this is called out explicitly at that test.
const { STATEFUL_MOCK_SRC } = require('../helpers/stateful-mock');
const fs = require('fs');
const path = require('path');

function baseSeed(overrides = {}) {
  const { tables: overrideTables, ...rest } = overrides;
  return {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Audit Admin', role: 'admin', status: 'active' }],
      patients: [{ id: 'p1', mrn: 'MRN-1', name: 'Vitals Test Patient', first_name: 'Vitals', last_name: 'Test',
        visit_status: 'Registered', sex: 'Male', age: '40', age_unit: 'Years' }],
      ...overrideTables,
    },
    users: [{ id: 'u1', email: 'admin@audit.local', password: 'whatever' }],
    idStart: { mrn: 500, opd: 200, ip: 100, lab_number: 300, radiology_number: 400 },
    ...rest,
  };
}

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

async function gotoAndLogin(page, baseUrl, email, password) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', password);
  await page.click('#auth-btn');
  await page.waitForTimeout(400);
}

async function openShift(page) {
  await page.evaluate(() => { if (typeof openShiftModal === 'function') openShiftModal(); });
  await page.waitForTimeout(100);
  await page.evaluate(() => submitOpenShift());
  await page.waitForTimeout(200);
}

async function lastToast(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('#toast-wrap .toast');
    return nodes.length ? nodes[nodes.length - 1].textContent : null;
  });
}

async function allToasts(page) {
  return page.evaluate(() => [...document.querySelectorAll('#toast-wrap .toast')].map(n => n.textContent));
}

module.exports = async function run(context, baseUrl) {
  const findings = [];
  const log = (section, status, detail) => findings.push({ section, status, detail });

  // ═════════════════════════════════════════════════════════════════
  // ONE continuous session for 18a/18b/18c so the IndexedDB queue and
  // mock backend state genuinely carry across the offline -> online ->
  // failed-retry -> manual-sync steps, exactly like a real device would
  // experience them in sequence.
  // ═════════════════════════════════════════════════════════════════
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  const extraJs = `
    window.__flakyCalls = 0;
    window.supabase = { createClient: () => {
      const real = makeStatefulSupabaseMock(window.__seed);
      const origFrom = real.from;
      real.from = (name) => {
        if (name === 'flaky_sync_table') {
          window.__flakyCalls++;
          if (window.__flakyCalls === 1) {
            return {
              insert(){ return this; }, update(){ return this; }, upsert(){ return this; }, match(){ return this; }, select(){ return this; },
              then(resolve){ resolve({ data:null, error:{ message:'Simulated transient sync failure (server briefly unreachable)' } }); },
            };
          }
          return origFrom(name);
        }
        return origFrom(name);
      };
      return real;
    } };
  `;
  await page.addInitScript(initScript(baseSeed(), extraJs));
  await gotoAndLogin(page, baseUrl, 'admin@audit.local', 'whatever');
  await page.evaluate(() => goPage('nursing'));
  await page.waitForTimeout(150);
  await page.evaluate(() => loadVitalsForPatient('p1', null, 'Vitals Test Patient', 'Ward A', 'Bed 1', 'ADM-1'));
  await page.waitForTimeout(150);

  // ─────────────────────────────────────────────────────────────
  // 18a: GOLDEN PATH — genuinely offline (context.setOffline), a real
  // dbWrite()-backed save (saveVitals()) queues instead of failing.
  // ─────────────────────────────────────────────────────────────
  {
    await page.fill('#vs-sys', '120');
    await page.fill('#vs-dia', '80');
    await page.fill('#vs-hr', '78');
    await page.fill('#vs-rr', '16');
    await page.fill('#vs-temp', '37.0');
    await page.fill('#vs-spo2', '98');

    const onlineBefore = await page.evaluate(() => navigator.onLine);
    await context.setOffline(true);
    await page.waitForTimeout(300); // let the real 'offline' event + updateConnBadge() run
    const onlineAfterSetOffline = await page.evaluate(() => navigator.onLine);
    const offlineToast = await lastToast(page);
    const badgeClassAfterOffline = await page.evaluate(() => document.getElementById('conn-badge')?.className);
    const badgeTextAfterOffline = await page.evaluate(() => document.getElementById('conn-text')?.textContent);

    const vitalsCountBefore = await page.evaluate(async () => (await sb.from('vital_signs').select('*')).data.length);
    await page.evaluate(() => saveVitals());
    await page.waitForTimeout(300);
    const saveToast = await lastToast(page);
    const vitalsCountAfterOffline = await page.evaluate(async () => (await sb.from('vital_signs').select('*')).data.length);

    const queueAfterSave = await page.evaluate(() => idbGetAll(QUEUE_STORE));
    const badgeAfterQueue = await page.evaluate(() => ({
      cls: document.getElementById('conn-badge')?.className,
      text: document.getElementById('conn-text')?.textContent,
    }));

    // Open the real Sync Status panel and read its actual rendered content.
    await page.evaluate(() => toggleSyncPanel());
    await page.waitForTimeout(150);
    const panelHtml = await page.evaluate(() => document.getElementById('sync-panel-body')?.innerHTML || '');
    await page.evaluate(() => toggleSyncPanel());

    const ok = onlineBefore === true && onlineAfterSetOffline === false &&
      /Offline.*saved locally.*sync/i.test(offlineToast || '') &&
      /offline/i.test(badgeClassAfterOffline || '') && /Offline/i.test(badgeTextAfterOffline || '') &&
      /Offline.*vitals saved.*sync later/i.test(saveToast || '') &&
      vitalsCountAfterOffline === vitalsCountBefore && // NOT written to the "backend" yet
      queueAfterSave.length === 1 && queueAfterSave[0].table === 'vital_signs' && queueAfterSave[0].op === 'insert' &&
      /pending sync|queued/i.test(badgeAfterQueue.text || '') &&
      /1 item\(s\) waiting to sync/.test(panelHtml) && /Vital Signs/.test(panelHtml);

    log('18a', ok ? 'PASS' : 'FAIL',
      `Used context.setOffline(true) — genuine browser-level offline emulation, not a mocked function. navigator.onLine correctly flipped true→false (${onlineBefore}→${onlineAfterSetOffline}), the real window 'offline' listener fired its own toast ("${offlineToast}") and updateConnBadge() marked the badge offline (class="${badgeClassAfterOffline}", text="${badgeTextAfterOffline}"). Filled the real Nursing Vital Signs form (sys/dia/HR/RR/temp/SpO2) and called the real saveVitals(), which goes through dbWrite('vital_signs','insert',...) — a real, documented dbWrite() call site, not a synthetic one. Toast: "${saveToast}" (matches the app's own queued-write copy). Critically the mock "backend" table vital_signs did NOT receive the row while offline (count stayed ${vitalsCountBefore}→${vitalsCountAfterOffline}) — it went into the REAL IndexedDB pending_writes store instead (queue length=${queueAfterSave.length}, table="${queueAfterSave[0]?.table}", op="${queueAfterSave[0]?.op}"). The connection badge and the real Sync Status panel (opened via the actual toggleSyncPanel(), reading its actual rendered innerHTML) both correctly reflect 1 pending item, with the panel correctly labeling it "Vital Signs" via its tableLabels map. Overall=${ok}.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 18b: RECONNECTION — genuinely going back online fires the real
  // 'online' DOM event, which auto-triggers flushOfflineQueue() (no
  // manual click), and the queued vitals row actually lands in the
  // (now-online) mock backend.
  // ─────────────────────────────────────────────────────────────
  {
    const queueBefore = await page.evaluate(() => idbGetAll(QUEUE_STORE));
    await context.setOffline(false);
    // Give the real 'online' listener's flushOfflineQueue() call (which is
    // itself async — table lookups + idbDelete) time to actually finish.
    await page.waitForTimeout(600);
    const onlineToast = await lastToast(page);
    const queueAfter = await page.evaluate(() => idbGetAll(QUEUE_STORE));
    const vitalsRows = await page.evaluate(async () => (await sb.from('vital_signs').select('*')).data);
    const badgeAfterSync = await page.evaluate(() => ({
      cls: document.getElementById('conn-badge')?.className,
      text: document.getElementById('conn-text')?.textContent,
    }));
    const syncedRow = vitalsRows.find(r => r.patient_id === 'p1');

    // (onlineToast could be either the 'Back online' toast or the immediately-
    // following 'Synced N offline record(s)' toast, since both fire in quick
    // succession — check the FULL toast history instead of just the last one.)
    const toasts = await allToasts(page);
    const sawBackOnline = toasts.some(t => /Back online.*syncing/i.test(t));
    const sawSynced = toasts.some(t => /Synced 1 offline record/i.test(t));
    const realOk = queueBefore.length === 1 && sawBackOnline && sawSynced &&
      queueAfter.length === 0 && !!syncedRow && syncedRow.systolic === 120 && syncedRow.heart_rate === 78 &&
      /online/i.test(badgeAfterSync.cls || '') && /^Online$/.test((badgeAfterSync.text || '').trim());

    log('18b', realOk ? 'PASS' : 'FAIL',
      `Called context.setOffline(false) — genuine reconnection, firing the real browser 'online' event. The app's own window.addEventListener('online',...) handler fired without any manual intervention: toast history shows both "🟢 Back online — syncing…" (present=${sawBackOnline}) and, once flushOfflineQueue() actually finished draining the queue, "🟢 Synced 1 offline record" (present=${sawSynced}). The pending_writes queue genuinely emptied (${queueBefore.length}→${queueAfter.length} items) and the vitals row that was queued offline in 18a is now a REAL row in the mock backend's vital_signs table (found by patient_id="p1", systolic=${syncedRow?.systolic}, heart_rate=${syncedRow?.heart_rate} — matching exactly what was typed while offline). Connection badge correctly returned to online state (class="${badgeAfterSync.cls}", text="${badgeAfterSync.text}"). This is the automatic 'online'-event flush path specifically (no Sync Now click involved) — confirms flushOfflineQueue() is genuinely wired to window's real online event, not just reachable via the button. Overall=${realOk}.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 18c: a sync attempt that genuinely fails is NOT silently dropped —
  // it stays queued with its error surfaced in the panel — and the
  // visible "🔄 Sync Now" button genuinely re-invokes flushOfflineQueue()
  // and succeeds once the failure condition clears.
  // ─────────────────────────────────────────────────────────────
  {
    // Queue a write against the 'flaky_sync_table', which the seeded mock
    // (see extraJs above) is rigged to fail on its FIRST sb.from() call and
    // succeed on every call after that — a realistic transient-failure shape.
    await context.setOffline(true);
    await page.waitForTimeout(200);
    const dbWriteResult = await page.evaluate(() => dbWrite('flaky_sync_table', 'insert', { note: 'audit-flaky-record' }));
    const queueAfterQueue = await page.evaluate(() => idbGetAll(QUEUE_STORE));
    await context.setOffline(false);
    await page.waitForTimeout(600); // let the automatic online-triggered flush attempt (and fail) run
    const toastsAfterFailedFlush = await allToasts(page);
    const sawFailedToast = toastsAfterFailedFlush.some(t => /1 item\(s\) could not sync — check Sync Status panel/i.test(t));
    const queueAfterFailedFlush = await page.evaluate(() => idbGetAll(QUEUE_STORE));
    const stillQueued = queueAfterFailedFlush.length === 1 && queueAfterFailedFlush[0].table === 'flaky_sync_table';
    const errorRecorded = !!(queueAfterFailedFlush[0] && queueAfterFailedFlush[0].error);

    // Open the real Sync Status panel and confirm the failure is genuinely
    // rendered (⚠️ + the real error message), not hidden.
    await page.evaluate(() => toggleSyncPanel());
    await page.waitForTimeout(150);
    const panelHtmlWithError = await page.evaluate(() => document.getElementById('sync-panel-body')?.innerHTML || '');
    const panelShowsError = /sp-item failed/.test(panelHtmlWithError) && /Simulated transient sync failure/.test(panelHtmlWithError);

    // Now click the REAL "🔄 Sync Now" button rendered inside the panel
    // (not a direct flushOfflineQueue() call) — proves the visible UI
    // control is actually wired to the engine. Count matching toast
    // elements before/after (rather than relying on ordering within a
    // possibly-mixed toast history) so a genuinely NEW "Synced" toast is
    // detected even though 18b already produced one with identical text.
    const syncNowBtn = await page.evaluateHandle(() => [...document.querySelectorAll('#sync-panel-body button')].find(b => /Sync Now/i.test(b.textContent)));
    const btnExists = await page.evaluate(el => !!el, syncNowBtn);
    const syncedToastCountBefore = await page.evaluate(() => [...document.querySelectorAll('#toast-wrap .toast')].filter(n => /Synced 1 offline record/i.test(n.textContent)).length);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#sync-panel-body button')].find(x => /Sync Now/i.test(x.textContent)); if (b) b.click(); });
    await page.waitForTimeout(400);
    const syncedToastCountAfter = await page.evaluate(() => [...document.querySelectorAll('#toast-wrap .toast')].filter(n => /Synced 1 offline record/i.test(n.textContent)).length);
    const sawManualSyncSuccess = syncedToastCountAfter > syncedToastCountBefore;
    const queueAfterManualSync = await page.evaluate(() => idbGetAll(QUEUE_STORE));
    const flakyRows = await page.evaluate(async () => (await sb.from('flaky_sync_table').select('*')).data);
    await page.evaluate(() => toggleSyncPanel());

    const ok = dbWriteResult.queued === true && queueAfterQueue.length === 1 &&
      sawFailedToast && stillQueued && errorRecorded && panelShowsError &&
      btnExists && sawManualSyncSuccess && queueAfterManualSync.length === 0 &&
      flakyRows.some(r => r.note === 'audit-flaky-record');

    log('18c', ok ? 'PASS' : 'FAIL',
      `Queued a write against a deliberately flaky table while genuinely offline (dbWrite() returned queued=${dbWriteResult.queued}). Reconnected — the automatic online-triggered flushOfflineQueue() attempted it, hit the seeded transient failure, and CORRECTLY left it in the queue rather than silently discarding it: toast "1 item(s) could not sync — check Sync Status panel" shown=${sawFailedToast}, item still present in pending_writes=${stillQueued}, with its real error message recorded on the queued item itself (item.error set=${errorRecorded}). Opened the real Sync Status panel — the failure is genuinely rendered to the user, not swallowed (shows the "failed" style + the actual error text)=${panelShowsError}. Then clicked the REAL "🔄 Sync Now" button inside that panel (button found=${btnExists}, a real DOM click(), not a direct function call) — this time the mock's flaky table succeeds (rigged to fail only once), and the click's own flushOfflineQueue() invocation genuinely drained it: a later "Synced 1 offline record" toast followed the earlier failure toast=${sawManualSyncSuccess}, the queue is now empty (${queueAfterManualSync.length} items), and the record genuinely landed in the mock backend (found note="audit-flaky-record" in flaky_sync_table)=${flakyRows.some(r => r.note === 'audit-flaky-record')}. Confirms failed syncs are visibly surfaced (not silently dropped) AND that the manual Sync Now control in the UI is a real, working retry path on the same engine as the automatic one. Overall=${ok}.`);
  }
  await page.close();

  // ═════════════════════════════════════════════════════════════════
  // 18d: a genuine Postgrest/validation-shaped error (has .code/.details —
  // i.e. NOT a connectivity failure) is correctly told apart from a real
  // network failure and RETHROWN by dbWrite(), not swallowed into the
  // offline queue. Tested directly against dbWrite()'s own documented
  // contract, plus isNetworkError() unit calls on representative shapes.
  // ═════════════════════════════════════════════════════════════════
  {
    const pageD = await context.newPage();
    const extraD = `
      window.supabase = { createClient: () => {
        const real = makeStatefulSupabaseMock(window.__seed);
        const origFrom = real.from;
        real.from = (name) => {
          if (name === '__force_pg_error__') {
            return {
              insert(){ return this; }, update(){ return this; }, upsert(){ return this; }, match(){ return this; },
              select(){ return { then(resolve){ resolve({ data:null, error:{ code:'23505', message:'duplicate key value violates unique constraint "ux_lab_number"', details:'Key (lab_number)=(300) already exists.', hint:null } }); } }; },
            };
          }
          return origFrom(name);
        };
        return real;
      } };
    `;
    await pageD.addInitScript(initScript(baseSeed(), extraD));
    await gotoAndLogin(pageD, baseUrl, 'admin@audit.local', 'whatever');
    // Genuinely online for this test (default context state) -- the whole
    // point is proving a real error surfaces even with connectivity fine.
    const onlineNow = await pageD.evaluate(() => navigator.onLine);
    const queueBefore = await pageD.evaluate(() => idbGetAll(QUEUE_STORE));
    // Catch the error from INSIDE the page evaluation (rather than letting
    // it propagate out of page.evaluate() as a Node-side exception) so we
    // get the exact original .code/.details/.message, unambiguously.
    const directResult = await pageD.evaluate(async () => {
      try { await dbWrite('__force_pg_error__', 'insert', { lab_number: 300 }); return { threw: false }; }
      catch (e) { return { threw: true, message: e.message, code: e.code, details: e.details }; }
    });
    const queueAfter = await pageD.evaluate(() => idbGetAll(QUEUE_STORE));

    // isNetworkError() unit calls on representative shapes, straight from
    // the real function (not re-implemented in the test).
    const isNetErrChecks = await pageD.evaluate(() => {
      const cases = [];
      // A real Postgrest error object -- must NOT be treated as a network error.
      cases.push({ label: 'postgrest-error(code)', result: isNetworkError({ code: '23505', message: 'duplicate key' }) });
      cases.push({ label: 'postgrest-error(details)', result: isNetworkError({ details: 'Key already exists.', message: 'x' }) });
      // A genuine fetch/TypeError-shaped failure -- MUST be treated as network.
      cases.push({ label: 'typeerror-fetch', result: isNetworkError(new TypeError('Failed to fetch')) });
      cases.push({ label: 'message-network', result: isNetworkError({ message: 'NetworkError when attempting to fetch resource.' }) });
      // No error at all.
      cases.push({ label: 'no-error', result: isNetworkError(null) });
      return cases;
    });
    const isNetOk = isNetErrChecks[0].result === false && isNetErrChecks[1].result === false &&
      isNetErrChecks[2].result === true && isNetErrChecks[3].result === true && isNetErrChecks[4].result === false;

    const ok = onlineNow === true && queueBefore.length === 0 &&
      directResult.threw === true && directResult.code === '23505' && /duplicate key/i.test(directResult.message || '') &&
      queueAfter.length === 0 && isNetOk;

    log('18d', ok ? 'PASS' : 'FAIL',
      `Called dbWrite() directly (its own documented contract) while genuinely online (navigator.onLine=${onlineNow}) against a table rigged to return a REAL Postgrest-shaped error (code 23505, a genuine unique-constraint violation, with .details/.hint present — the exact shape isNetworkError() is supposed to recognize as "not a connectivity problem"). dbWrite() correctly RETHREW it rather than queuing it (threw=${directResult.threw}, code="${directResult.code}", message="${directResult.message}") — a caller's existing try/catch + toast(e.message,'err') pattern keeps working exactly as CLAUDE.md documents. The offline queue stayed genuinely empty throughout (${queueBefore.length}→${queueAfter.length} items) — the error was never miscategorized as "we're offline, queue it". Backed this with direct isNetworkError() unit calls on 5 representative shapes, straight from the real function: a Postgrest error with .code=${isNetErrChecks[0].result} (must be false — not network), one with .details=${isNetErrChecks[1].result} (false), a real TypeError('Failed to fetch')=${isNetErrChecks[2].result} (must be true — network), a message containing "NetworkError"=${isNetErrChecks[3].result} (true), and null/no error=${isNetErrChecks[4].result} (false) — all 5 matched the documented behaviour (isNetOk=${isNetOk}). Overall=${ok}.`);
    await pageD.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 18e: genOfflineId() — direct unit assertions, PLUS a live, real, fully
  // -offline patient registration that completes end-to-end and produces a
  // genOfflineId()-generated invoice number.
  // ═════════════════════════════════════════════════════════════════
  {
    const pageE = await context.newPage();
    await pageE.addInitScript(initScript(baseSeed({ tables: { patients: [] } })));
    await gotoAndLogin(pageE, baseUrl, 'admin@audit.local', 'whatever');

    // Direct unit check first.
    const unitResults = await pageE.evaluate(() => {
      const ids = Array.from({ length: 50 }, () => genOfflineId('TEST'));
      const allMatchFormat = ids.every(id => /^TEST-\d{6}-[A-Z0-9]{4}$/.test(id));
      const allUnique = new Set(ids).size === ids.length;
      return { sample: ids[0], allMatchFormat, allUnique, count: ids.length };
    });
    const unitOk = unitResults.allMatchFormat && unitResults.allUnique;
    log('18e-unit', unitOk ? 'PASS' : 'FAIL',
      `Called genOfflineId('TEST') directly 50 times in a tight loop (worst-case collision pressure). Every id matched the documented "prefix-YYMMDD-RAND4" shape (sample="${unitResults.sample}", all 50 matched=${unitResults.allMatchFormat}) and all 50 were pairwise unique (allUnique=${unitResults.allUnique}) — crypto.getRandomValues()-backed suffix genuinely avoids collisions even under rapid-fire local generation with no server round trip involved.`);

    // Live: a REAL, complete patient registration performed while genuinely
    // offline (context.setOffline(true)), through the real wizard, exactly
    // like a receptionist's device losing connectivity mid-shift.
    await openShift(pageE);
    await pageE.evaluate(() => goPage('register'));
    await pageE.waitForTimeout(150);
    await pageE.evaluate(() => regGoStep(1));
    await pageE.waitForTimeout(50);
    await pageE.fill('#r-fname', 'Offline Registered Patient');
    await pageE.selectOption('#r-sex', 'Female');
    await pageE.fill('#r-phone', '0911112222');
    await pageE.evaluate(() => regGoStep(2));
    await pageE.waitForTimeout(100);
    await pageE.evaluate(() => setDest('lab'));
    await pageE.check('#r-consent');
    await pageE.evaluate(() => regGoStep(3));
    await pageE.waitForTimeout(100);

    const pageErrorsE = [];
    pageE.on('pageerror', e => pageErrorsE.push(e.message));
    await context.setOffline(true);
    await pageE.waitForTimeout(250);
    const patientsCountBefore = await pageE.evaluate(async () => (await sb.from('patients').select('*')).data.length);
    await pageE.evaluate(() => submitRegistration());
    await pageE.waitForTimeout(500);
    const regToast = await lastToast(pageE);
    const patientsCountAfter = await pageE.evaluate(async () => (await sb.from('patients').select('*')).data.length);
    const queueAfterReg = await pageE.evaluate(() => idbGetAll(QUEUE_STORE));
    const queuedPatientWrite = queueAfterReg.find(q => q.table === 'patients' && q.op === 'insert');
    const queuedInvoiceWrite = queueAfterReg.find(q => q.table === 'invoices' && q.op === 'insert');
    const invNoInQueue = queuedInvoiceWrite?.payload?.invoice_no;
    const invNoLooksOfflineGenerated = /^INV-\d{6}-[A-Z0-9]{4}$/.test(invNoInQueue || '');
    await context.setOffline(false);
    await pageE.waitForTimeout(600);
    const patientsAfterSync = await pageE.evaluate(async () => (await sb.from('patients').select('*')).data);
    const registeredRow = patientsAfterSync.find(p => p.first_name === 'Offline Registered Patient');

    const ok = pageErrorsE.length === 0 && patientsCountBefore === patientsCountAfter /* nothing landed while offline */ &&
      /Offline.*patient saved.*sync when connection returns/i.test(regToast || '') &&
      !!queuedPatientWrite && !!queuedInvoiceWrite && invNoLooksOfflineGenerated &&
      !!registeredRow && registeredRow.mrn; // synced back after reconnect, still has a real MRN

    log('18e-live', ok ? 'PASS' : 'FAIL',
      `Performed a REAL, complete patient registration through the actual wizard (identity → destinations/consent → submit) while genuinely offline (context.setOffline(true)) — no uncaught page errors during the entire flow (pageerror count=${pageErrorsE.length}). submitRegistration() completed gracefully rather than crashing: toast "${regToast}" (the documented offline-registration copy). Nothing was written to the mock "backend" patients table while offline (count stayed ${patientsCountBefore}→${patientsCountAfter}) — both the patient insert (found in queue=${!!queuedPatientWrite}) and the auto-created invoice insert (found=${!!queuedInvoiceWrite}) went into the real offline queue instead. Critically, the queued invoice's invoice_no ("${invNoInQueue}") is a genOfflineId('INV')-shaped local ID (matches /^INV-\\d{6}-[A-Z0-9]{4}$/ = ${invNoLooksOfflineGenerated}) — proving genOfflineId() is genuinely exercised by a real, fully-offline-created record's invoice numbering, exactly as CLAUDE.md describes it ("for records created fully offline"), not just callable in isolation. After reconnecting, the queue flushed and the patient row is now for-real present in the backend with its MRN intact (mrn="${registeredRow?.mrn}") — a genuinely usable, syncable offline-created record end to end. Overall=${ok}. NOTE (harness limitation, not an app bug): the patient's MRN/visit/lab numbers themselves still came from the real generate_next_id() RPC path rather than getNextNumber()'s offline fallback, because the stateful mock's sb.rpc() is pure in-process JS and unaffected by context.setOffline() — see 18f for a direct, honest exercise of that specific fallback instead.`);
    await pageE.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 18f: the OTHER client-side ID fallback — COUNTER_TO_ID_TYPE / ID_START /
  // maxNumericField self-healing — exercised for real via (i) sb entirely
  // absent, and (ii) sb present but the generate_next_id RPC itself
  // failing, which is what the code's own comments say actually triggers
  // this path ("DB function not deployed or unreachable"), not browser
  // connectivity per se.
  // ═════════════════════════════════════════════════════════════════
  {
    const pageF = await context.newPage();
    await pageF.addInitScript(initScript(baseSeed({
      tables: { patients: [{ id: 'px', mrn: 'MRN-X', visit_no: '250', patient_type: 'Outpatient' }] },
    })));
    await gotoAndLogin(pageF, baseUrl, 'admin@audit.local', 'whatever');

    // (i) sb entirely unset -- the documented `if(!sb)` branch. NOTE: `sb`
    // is a top-level `let` in index.html's script, which (unlike `var`)
    // does NOT alias to `window.sb` -- must reassign the bare identifier
    // itself from inside page.evaluate() for this to actually take effect
    // (confirmed against the exact same pattern already used in Section 1's
    // audit for this same function).
    const noSbResult = await pageF.evaluate(async () => {
      const saved = sb; sb = null;
      const n = await getNextNumber('lab_number');
      sb = saved;
      return n;
    });
    const noSbOk = /^\d{7}$/.test(noSbResult) && Number(noSbResult) >= 1000000;

    // (ii) sb present, but generate_next_id RPC itself fails -- forces the
    // client-side self-healing loop (id_counters + computeDataMax/
    // maxNumericField) to actually run. NOTE: the stateful mock's rpc()
    // has its OWN hardcoded, always-succeeds branch for 'generate_next_id'
    // that is checked BEFORE seed.rpcHandlers is ever consulted -- seeding
    // rpcHandlers.generate_next_id has no effect for this one function
    // name. Instead, monkey-patch the live sb.rpc method directly post-
    // login, exactly matching the already-proven-working pattern from
    // Section 1's audit (1d) for this same scenario.
    const pageF2 = await context.newPage();
    await pageF2.addInitScript(initScript(baseSeed({
      tables: { patients: [{ id: 'px', mrn: 'MRN-X', visit_no: '250', patient_type: 'Outpatient' }] },
    })));
    await gotoAndLogin(pageF2, baseUrl, 'admin@audit.local', 'whatever');
    await pageF2.evaluate(() => {
      const real = sb.rpc.bind(sb);
      sb.rpc = (name, args) => name === 'generate_next_id'
        ? Promise.resolve({ data: null, error: { message: 'generate_next_id RPC not reachable (simulated)' } })
        : real(name, args);
    });
    const selfHealResult = await pageF2.evaluate(() => getNextNumber('file_number_opd'));
    // Seeded ID_START.opd=200, but a real existing patient row already has
    // visit_no=250 -- maxNumericField()/computeDataMax() must win over the
    // seed so the self-healing fallback can never hand out a number that
    // collides with real, already-used data.
    const selfHealOk = Number(selfHealResult) === 251;
    const idCounterRow = await pageF2.evaluate(async () => (await sb.from('id_counters').select('*').eq('counter_name', 'opd').maybeSingle()).data);
    const counterPersisted = idCounterRow?.current_value === 251;

    const ok = noSbOk && selfHealOk && counterPersisted;
    log('18f', ok ? 'PASS' : 'FAIL',
      `(i) Called getNextNumber('lab_number') with sb temporarily nulled out — the documented "no live counter to read" branch — got back "${noSbResult}", a numbers-only 7-digit value ≥1,000,000 (deliberately outside every department's normal 100-999 range, obviously a temporary placeholder at a glance) rather than throwing or hanging=${noSbOk}. (ii) Separately, with sb present but the live sb.rpc('generate_next_id',...) call itself monkey-patched to return a real error response ("RPC not reachable (simulated)") — the actual real-world trigger per the code's own comment ("DB function not deployed or unreachable"), not offline browser state — getNextNumber('file_number_opd') correctly fell through to the client-side self-healing loop and returned "${selfHealResult}". This correctly computed 251, NOT the seeded ID_START.opd=200+1=201: a real existing patient row in the mock backend already has visit_no=250, and maxNumericField()/computeDataMax() correctly took the higher of (stored counter, real data MAX, seed) — proving the self-healing fallback genuinely can't hand out a number that collides with already-used real data=${selfHealOk}. The id_counters row was also genuinely persisted with current_value=251 for next time=${counterPersisted}. Overall=${ok}.`);
    await pageF.close();
    await pageF2.close();
  }

  // ═════════════════════════════════════════════════════════════════
  // 18g: sw.js — STATIC code check (read directly from disk, not via the
  // browser) confirming the cache-exclusion list and caching strategy
  // genuinely match what CLAUDE.md documents.
  // ═════════════════════════════════════════════════════════════════
  {
    const swPath = path.resolve(__dirname, '../../sw.js');
    const swSrc = fs.readFileSync(swPath, 'utf8');
    const excludesSupabase = /req\.url\.includes\(\s*['"]supabase\.co['"]\s*\)\s*\)\s*return;/.test(swSrc);
    const onlyHandlesGet = /req\.method\s*!==\s*['"]GET['"]\s*\)\s*return;/.test(swSrc);
    const staleWhileRevalidateShape = /caches\.open\(CACHE_VERSION\)/.test(swSrc) &&
      /cache\.match\(req\)/.test(swSrc) && /fetch\(req\)/.test(swSrc) && /cache\.put\(req/.test(swSrc) &&
      /return cached \|\| networkFetch/.test(swSrc);
    const precachesSupabaseJsCdn = /PRECACHE_URLS\s*=\s*\[\s*['"]https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/.test(swSrc);
    const cacheVersionMatch = swSrc.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const cacheVersion = cacheVersionMatch ? cacheVersionMatch[1] : null;
    const activateCleansOldCaches = /keys\.filter\(\(k\)\s*=>\s*k\s*!==\s*CACHE_VERSION\)/.test(swSrc);
    const claimsClients = /self\.clients\.claim\(\)/.test(swSrc);
    const skipsWaiting = /self\.skipWaiting\(\)/.test(swSrc);

    // Note worth calling out (not a bug, just precise about what CLAUDE.md's
    // "caches the app shell" phrasing means in practice): PRECACHE_URLS
    // (install-time precache) contains ONLY the Supabase JS CDN script --
    // index.html itself is not explicitly precached at install, it's cached
    // opportunistically the first time the stale-while-revalidate fetch
    // handler intercepts a GET for it (i.e. after the very first successful
    // load). A device that has never once loaded the app while online still
    // cannot load it fully offline on its very first visit -- expected for
    // any web app, but worth stating precisely.
    const appShellNotExplicitlyPrecached = !/PRECACHE_URLS\s*=\s*\[[^\]]*index\.html/.test(swSrc);

    const ok = excludesSupabase && onlyHandlesGet && staleWhileRevalidateShape && precachesSupabaseJsCdn && cacheVersion && activateCleansOldCaches;
    log('18g', ok ? 'PASS' : 'FAIL',
      `Read sw.js directly from disk (${swPath}). Confirmed line-for-line: (1) the fetch handler explicitly excludes ALL supabase.co traffic via \`if (req.url.includes('supabase.co')) return;\`, letting those requests pass straight through uncached=${excludesSupabase} — exactly matching CLAUDE.md's "explicitly excluding all supabase.co API traffic". (2) Only GET requests are ever intercepted (\`if (req.method !== 'GET') return;\`), so writes are never touched by the SW cache layer=${onlyHandlesGet}. (3) The caching strategy for everything else is genuinely stale-while-revalidate — serve \`cache.match(req)\` immediately if present while a background \`fetch(req)\` refreshes the cache via \`cache.put\`, falling back to network if nothing cached (\`return cached || networkFetch\`)=${staleWhileRevalidateShape}. (4) PRECACHE_URLS at install time contains the Supabase JS CDN bundle (\`https://cdn.jsdelivr.net/npm/@supabase/supabase-js...\`)=${precachesSupabaseJsCdn}, cache keyed under CACHE_VERSION="${cacheVersion}", and activate() cleans up any stale-versioned caches (\`keys.filter(k => k !== CACHE_VERSION)\`)=${activateCleansOldCaches}, with self.skipWaiting()=${skipsWaiting}/self.clients.claim()=${claimsClients} so a new SW version takes over promptly. One precise nuance worth stating (not a bug): the app's own HTML (index.html) is NOT itself in the install-time PRECACHE_URLS list (appShellNotExplicitlyPrecached=${appShellNotExplicitlyPrecached}) — only the Supabase CDN script is explicitly precached; index.html instead becomes cached opportunistically via the same stale-while-revalidate fetch handler the very first time it's requested successfully. In practice this still delivers what CLAUDE.md describes ("caches the app shell... for offline load"), just lazily for the HTML rather than eagerly at install. Overall (all documented properties genuinely present in the real file)=${ok}.`);
  }

  // ═════════════════════════════════════════════════════════════════
  // 18h: sw.js — LIVE check. Real service worker registration/activation
  // in the actual headless browser against the actual dev static server,
  // confirming the app shell genuinely gets cached and a supabase.co-shaped
  // request is genuinely never cached — live, not just read from source.
  // ═════════════════════════════════════════════════════════════════
  {
    const pageH = await context.newPage();
    await pageH.addInitScript(initScript(baseSeed()));
    await pageH.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    // window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js')...)
    // fires on the 'load' event, which waitUntil:'load' above already waited for.
    let registration = null, regError = null;
    try {
      registration = await pageH.evaluate(async () => {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('serviceWorker.ready timed out after 10s')), 10000));
        const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
        return { scope: reg.scope, scriptURL: reg.active?.scriptURL || null, state: reg.active?.state || null };
      });
    } catch (e) { regError = e.message; }

    const cacheNamesAfterInstall = registration ? await pageH.evaluate(() => caches.keys()) : [];
    const hasShellCache = cacheNamesAfterInstall.includes('fh-his-shell-v1');

    // Wait for this already-open page to actually become CONTROLLED — the
    // SW's activate handler calls self.clients.claim(), which claims
    // already-open clients without needing a reload.
    let becameControlled = false;
    if (registration) {
      try {
        becameControlled = await pageH.evaluate(() => new Promise((resolve) => {
          if (navigator.serviceWorker.controller) { resolve(true); return; }
          const t = setTimeout(() => resolve(!!navigator.serviceWorker.controller), 4000);
          navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(true); });
        }));
      } catch (e) { /* leave false */ }
    }

    // Once controlled, a real fetch for the app's own HTML from this page
    // should be intercepted by the fetch handler and genuinely land in the
    // named cache (stale-while-revalidate cache.put on a successful fetch).
    let shellUrlCached = false;
    if (becameControlled) {
      await pageH.evaluate(() => fetch('/index.html', { cache: 'no-store' }).catch(() => {}));
      await pageH.waitForTimeout(300);
      shellUrlCached = await pageH.evaluate(async () => {
        const cache = await caches.open('fh-his-shell-v1');
        const keys = await cache.keys();
        return keys.some(k => k.url.includes('/index.html') || k.url.endsWith('/'));
      });
    }

    // A supabase.co-shaped request must NEVER be cached by the SW, live —
    // fire one (it will fail at the network layer since the domain is
    // fake/unreachable in this sandbox, which is fine and expected: the
    // proof is about caching behaviour, not about the request succeeding).
    let noSupabaseCacheEntry = true;
    if (registration) {
      // Timeout-guarded: this domain is unreachable from this sandbox, and
      // the point is purely the SW's caching behaviour, not whether the
      // request itself succeeds -- never let a slow/hanging DNS failure
      // stall the whole audit run.
      await pageH.evaluate(() => Promise.race([
        fetch('https://fake-project.supabase.co/rest/v1/probe', { mode: 'no-cors' }).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]));
      await pageH.waitForTimeout(300);
      noSupabaseCacheEntry = await pageH.evaluate(async () => {
        const names = await caches.keys();
        for (const n of names) {
          const cache = await caches.open(n);
          const keys = await cache.keys();
          if (keys.some(k => k.url.includes('supabase.co'))) return false;
        }
        return true;
      });
    }

    const ok = !regError && !!registration?.scriptURL?.endsWith('/sw.js') && registration?.state === 'activated' &&
      hasShellCache && becameControlled && shellUrlCached && noSupabaseCacheEntry;

    log('18h', ok ? 'PASS' : 'FAIL',
      registration
        ? `Registered the REAL sw.js against the REAL dev static server (${baseUrl}/sw.js) in an actual headless Chromium page — no mocking. navigator.serviceWorker.ready resolved with scriptURL="${registration.scriptURL}", state="${registration.state}" (registrationError=${regError}). The named cache "fh-his-shell-v1" genuinely exists after install=${hasShellCache} (caches.keys()=${JSON.stringify(cacheNamesAfterInstall)}) — created even though the install-time precache target (the Supabase JS CDN script) is unreachable from this sandboxed network, because caches.open() succeeds regardless of what addAll() does (and the SW's own .catch(()=>{}) deliberately doesn't let a flaky CDN block install). The already-open page genuinely became SW-controlled without a reload (becameControlled=${becameControlled}, via self.clients.claim() on activate). A real fetch('/index.html') made from that now-controlled page was genuinely intercepted and cached (shellUrlCached=${shellUrlCached}) — live proof of the stale-while-revalidate app-shell caching, not just a source-code claim. Finally, a fetch to a supabase.co-shaped URL was made from the same controlled page, and afterwards NO cache anywhere in this origin contains any supabase.co entry (noSupabaseCacheEntry=${noSupabaseCacheEntry}) — live confirmation that the SW's fetch handler generically passes those requests through rather than caching them, matching the static code check in 18g. Overall=${ok}.`
        : `Service worker registration/activation did not complete in this sandbox (registrationError="${regError}"). Falling back entirely to the static code check in 18g for this section's guarantees — noting this explicitly as a live-verification gap rather than silently treating the static check alone as sufficient.`);
    await pageH.close();
  }

  return findings;
};
