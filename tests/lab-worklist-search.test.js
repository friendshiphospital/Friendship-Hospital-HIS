// Covers a live-repro'd bug class: the Lab Worklist's STAT banner staying
// visible (leftover markup/state) while the table shows "No patients
// found" for the current filter, and the worklist's own search box
// silently finding nothing for a real, existing patient whose registration
// date falls outside whatever Today/Week/date window is currently active
// (repro case: searching file/lab no "513").
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
          // The real Supabase query is date-filtered server-side by
          // loadWorklist()'s .gte()/.lte() chaining; this mock ignores
          // those filters (see chainable-mock.js), so the test drives the
          // same "today has nothing, all has the patient" behavior by
          // keying off the in-page _wlMode global directly.
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
    // Simulate the exact screenshot repro: banner already showing (either
    // stale from a previous STAT-bearing render, or from the markup bug
    // where a duplicate `display:flex` in the inline style made it visible
    // by default) at the moment a filter with zero results loads.
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
    await page.waitForTimeout(200);

    const modeNow = await page.evaluate(() => window._wlMode);
    t.check('typing a search term automatically widens the filter to "All" rather than staying on "Today"', modeNow === 'all');
    const rowText = await page.evaluate(() => document.getElementById('wl-table-body')?.textContent || '');
    t.check('the patient (lab no 513) is now found, not "disappeared"', rowText.includes('513') && rowText.includes('Test Five One Three'));
    const rowVisible = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#wl-table tbody tr')];
      const row = rows.find(r => r.textContent.includes('513'));
      return row && row.style.display !== 'none';
    });
    t.check('the matching row is actually visible (not filtered out) after the mode switch', rowVisible === true);
    await page.close();
  }

  // --- A patient with no sample_records row at all must be explained, not silently vanish ---
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
