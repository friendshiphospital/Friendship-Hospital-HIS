// Covers a live-repro'd bug class: the Lab Worklist's STAT banner staying
// visible (leftover markup/state) while the table shows "No patients
// found" for the current filter, and the worklist's own search box
// silently finding nothing for a real, existing patient — first because
// text-filtering only looked at rows already narrowed to the current
// date window (repro: file/lab no "513" registered outside "Today"), and
// then — even after that fix — because the row-narrowing itself excludes
// any patient whose sample hasn't been received into the lab yet, which
// is exactly the state a patient with real, paid, but not-yet-collected
// orders is in (repro: MRN 513 / patient "gada", visible in Doctor Orders
// but reported as "No patients found" in Worklist search). The fix makes
// search a real server-side multi-field query (name/MRN/phone/lab no/
// doctor — same shape as the header's globalSearch()) that is completely
// independent of both the date-window mode and sample-receipt status, and
// renders a patient whose sample isn't received yet with an explicit
// "Awaiting Receipt" state instead of omitting them.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = {};
    const patientsAllTime = [
      { id:'p513', name:'Test Five One Three', mrn:'M513', lab_no:'513', age:30, age_unit:'y', sex:'M',
        priority:'Routine', payment_status:'paid', visit_destination:'lab', visit_status:'Registered',
        tests_requested:['CBC'], created_at:'2026-07-20T08:00:00Z' },
    ];
    const sampleRowsAllTime = [
      { patient_id:'p513', status:'Received', sample_source:'Venipuncture' },
    ];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'lab_tech' }, []);
        if (table === 'patients') {
          // Search (filterWorklist/searchWorklist) now issues an
          // independent server-side query that does not depend on the
          // Today/Week/All date-mode at all — the mock mirrors that by
          // keying off window._wlSearchQuery (set synchronously by
          // filterWorklist before the debounced search fires) rather than
          // _wlMode, which is only relevant to plain loadWorklist() calls.
          if (window._wlSearchQuery) return chainable(null, patientsAllTime);
          const mode = window._wlMode || 'today';
          return chainable(null, mode === 'all' ? patientsAllTime : []);
        }
        if (table === 'sample_records') return chainable(null, sampleRowsAllTime);
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
  await page.fill('#auth-email', 'labtech@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
  await page.evaluate(() => goPage('worklist'));
  await page.waitForTimeout(100);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('lab-worklist-search');

  // --- A STAT banner left visible from a prior render must not survive an empty-result reload ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => { const b = document.getElementById('wl-stat-banner'); if (b) b.style.display = 'flex'; });
    await page.evaluate(() => loadWorklist());
    await page.waitForTimeout(150);
    const bannerDisplay = await page.evaluate(() => document.getElementById('wl-stat-banner')?.style.display);
    const bodyText = await page.evaluate(() => document.getElementById('wl-table-body')?.textContent || '');
    t.check('table correctly shows "No patients found" for empty Today filter', bodyText.includes('No patients found'));
    t.check('STAT banner is explicitly hidden, not left stale from a prior render', bannerDisplay === 'none');
    await page.close();
  }

  // --- Searching a real patient (file/lab no "513") registered outside "Today" must find them, not silently return nothing ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => loadWorklist());
    await page.waitForTimeout(150);
    const emptyBeforeSearch = await page.evaluate(() => document.getElementById('wl-table-body')?.textContent || '');
    t.check('sanity: Today mode genuinely has no rows for this patient before searching', emptyBeforeSearch.includes('No patients found'));

    await page.fill('#wl-search', '513');
    await page.evaluate(() => filterWorklist('513'));
    await page.waitForTimeout(400);

    const modeUnchanged = await page.evaluate(() => window._wlMode !== 'all');
    t.check('searching does NOT force-switch the date-mode buttons — search is independent of the date window entirely', modeUnchanged);
    const rowText = await page.evaluate(() => document.getElementById('wl-table-body')?.textContent || '');
    t.check('the patient (lab no 513) is now found, not "disappeared"', rowText.includes('513') && rowText.includes('Test Five One Three'));
    const rowVisible = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#wl-table tbody tr')];
      const row = rows.find(r => r.textContent.includes('513'));
      return row && row.style.display !== 'none';
    });
    t.check('the matching row is actually visible (not filtered out) after searching', rowVisible === true);

    await page.fill('#wl-search', '');
    await page.evaluate(() => filterWorklist(''));
    await page.waitForTimeout(200);
    const restoredText = await page.evaluate(() => document.getElementById('wl-table-body')?.textContent || '');
    t.check('clearing the search box restores the normal (date-mode-scoped) worklist view', restoredText.includes('No patients found'));
    await page.close();
  }

  // --- The repro that mattered most: a patient with real, PAID orders whose sample simply hasn't reached the lab yet must be found by search, not reported as nonexistent ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      const gada = [{ id:'p900', name:'gada', mrn:'513', lab_no:'L900', priority:'Routine', payment_status:'paid', doctor:'Dr. Test', tests_requested:['CBC'], created_at:new Date().toISOString() }];
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'lab_tech' }, []);
          if (table === 'patients') return chainable(null, gada);
          // No sample_records row at all yet -- exactly "active, paid
          // orders" that haven't been collected/received into the lab.
          if (table === 'sample_records') return chainable(null, []);
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.fill('#wl-search', '513');
    await page.evaluate(() => filterWorklist('513'));
    await page.waitForTimeout(400);

    const bodyText = await page.evaluate(() => document.getElementById('wl-table-body')?.textContent || '');
    t.check('searching MRN "513" finds patient "gada" even though their sample has not been received in the lab yet (the exact reported repro)', bodyText.includes('gada'));
    t.check('the row explicitly says the sample is awaiting receipt rather than silently omitting the patient', bodyText.includes('Awaiting Receipt'));
    const enterDisabled = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#wl-table tbody tr')];
      const row = rows.find(r => r.textContent.includes('gada'));
      const btn = row && row.querySelector('button');
      return btn && btn.getAttribute('onclick') === null;
    });
    t.check('Enter Results is not offered for a sample that has not been received yet', enterDisabled);
    await page.close();
  }

  // --- Multi-field search (phone/doctor), matching the header Global Search's matching approach ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      const pts = [{ id:'pPhone', name:'Phone Match Patient', mrn:'M700', lab_no:'700', phone:'0912345678', doctor:'Dr. Osman', priority:'Routine', payment_status:'paid', tests_requested:['CBC'], created_at:new Date().toISOString() }];
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'lab_tech' }, []);
          if (table === 'patients') return chainable(null, pts);
          if (table === 'sample_records') return chainable(null, [{ patient_id:'pPhone', status:'Received', sample_source:'Venipuncture' }]);
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.fill('#wl-search', '0912345678');
    await page.evaluate(() => filterWorklist('0912345678'));
    await page.waitForTimeout(400);
    const bodyText = await page.evaluate(() => document.getElementById('wl-table-body')?.textContent || '');
    t.check('searching by phone number finds the patient (multi-field search, matching header Global Search)', bodyText.includes('Phone Match Patient'));
    await page.close();
  }

  // --- A patient with no sample_records row at all must be explained, not silently vanish (plain worklist view, no search) ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      const pts = [{ id:'pNoSample', name:'No Sample Row Patient', mrn:'M900', lab_no:'900', priority:'Routine', payment_status:'paid', tests_requested:['CBC'], created_at:new Date().toISOString() }];
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'lab_tech' }, []);
          if (table === 'patients') return chainable(null, pts);
          if (table === 'sample_records') return chainable(null, []); // no row at all for pNoSample
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => loadWorklist());
    await page.waitForTimeout(150);
    const bodyText = await page.evaluate(() => document.getElementById('wl-table-body')?.textContent || '');
    t.check('a patient with zero sample_records rows is reported as awaiting receipt, not silently dropped', bodyText.includes('awaiting receipt'));
    await page.close();
  }

  return t;
};
