// Covers Prompt1 Phase 1 (finally executed after the user pointed at the
// still-cluttered sidebar and confirmed): the 7 individual per-department
// lab entry sidebar links (Haematology/Chemistry/Serology/Immunology/
// Microbiology/PCR/Histopathology/Cytology Entry) never had a working
// patient-search UI of their own — their *-entry-pt-id fields are hidden
// inputs, only ever populated by openUnifiedResultsEntry(), and nothing
// but those sidebar links themselves ever called goPage() on them. The
// only real, working path to result entry has always been Worklist ->
// Enter -> the Unified Entry page (openUnifiedResultsEntry(), which
// physically relocates the relevant department cards there). This
// replaces the 7 redundant links with one "Enter Results" link to that
// already-working page, while leaving the underlying department pages,
// DEPT_META, and every save*Entry()/saveResultWithSafetyChecks() function
// completely untouched — openEnterModalDept()'s direct per-department
// "View/Edit" links still work exactly as before.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(role) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    const pts = [{ id:'p1', name:'Consolidation Test Patient', mrn:'M1', lab_no:'L1', age:40, age_unit:'y', sex:'M',
      priority:'Routine', payment_status:'paid', tests_requested:['CBC (Full Blood Count)'], created_at:new Date().toISOString() }];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Lab Tech Test', role:'${role}' }, []);
        if (table === 'patients') return chainable(pts[0], pts);
        if (table === 'sample_records') return chainable(null, [{ patient_id:'p1', status:'Received', sample_source:'Venipuncture' }]);
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
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
  const t = makeSuite('lab-entry-consolidation');

  {
    const page = await context.newPage();
    await page.addInitScript(initScript('lab_tech'));
    await login(page, baseUrl, 'labtech@example.com');

    const oldLinksGone = await page.evaluate(() => {
      const ids = ['hem-entry','chem-entry','sero-entry','immuno-entry','micro-entry','pcr-entry','histo-entry','cyto-entry'];
      return ids.every(id => !document.querySelector('.sb-item[data-p="' + id + '"]'));
    });
    t.check('none of the 7 individual department entry sidebar links exist anymore', oldLinksGone);

    const unifiedLinkPresent = await page.evaluate(() => !!document.querySelector('.sb-item[data-p="unified-entry"]'));
    t.check('a single "Enter Results" sidebar link exists in its place', unifiedLinkPresent);

    const unifiedLinkVisible = await page.evaluate(() => {
      const el = document.querySelector('.sb-item[data-p="unified-entry"]');
      return el && el.style.display !== 'none';
    });
    t.check('the Enter Results link is visible for lab_tech (already permitted via ROLE_PAGES)', unifiedLinkVisible);

    // Opened cold (no patient), it must not error and must point back to Worklist
    await page.evaluate(() => goPage('unified-entry'));
    await page.waitForTimeout(100);
    const coldOpenText = await page.evaluate(() => document.getElementById('ue-pt-info')?.textContent || '');
    t.check('opened cold from the sidebar, the page tells the user to go to Worklist rather than erroring', coldOpenText.includes('Worklist'));

    await page.close();
  }

  // --- The real, working path (Worklist -> Enter) still functions exactly as before ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript('lab_tech'));
    await login(page, baseUrl, 'labtech2@example.com');
    await page.evaluate(() => goPage('worklist'));
    await page.waitForTimeout(150);

    await page.evaluate(() => openEnterModal('p1', 'L1', 'Consolidation Test Patient'));
    await page.waitForTimeout(200);

    const onUnifiedEntryPage = await page.evaluate(() => document.getElementById('page-unified-entry')?.classList.contains('active'));
    t.check('Worklist Enter still lands on the Unified Entry page', onUnifiedEntryPage);
    const patientLoaded = await page.evaluate(() => (document.getElementById('ue-pt-info')?.textContent || '').includes('Consolidation Test Patient'));
    t.check('the correct patient is loaded into the unified view', patientLoaded);
    const hemSectionShown = await page.evaluate(() => (document.getElementById('ue-nav')?.textContent || '').includes('Haematology'));
    t.check('the Haematology section (matching this patient\'s ordered CBC) is shown', hemSectionShown);

    await page.close();
  }

  return t;
};
