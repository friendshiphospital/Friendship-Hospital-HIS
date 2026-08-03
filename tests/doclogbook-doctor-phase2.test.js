// Covers Documentation/Logbook Phase 2 (Doctor): Digital Informed Consent
// — genuinely new per the Phase 0 audit (only plain checkboxes existed
// before, none inside Consultation, no signature capture anywhere) — a
// canvas-based e-signature pad (no library), consent type, linked to the
// patient/visit, printable. Also covers the bilingual discharge summary
// fix: labels now translate via the existing I18N/t() mechanism, while
// doctor-entered clinical free text is deliberately never auto-translated.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { consentInsert: null };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Doc Test', role: 'admin' }, []);
        ${extra || ''}
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
  await page.fill('#auth-email', 'admin@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

async function drawSignature(page) {
  const box = await page.locator('#con-sig-pad').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 60, { steps: 5 });
  await page.mouse.move(box.x + 180, box.y + 30, { steps: 5 });
  await page.mouse.up();
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('doclogbook-doctor-phase2');

  // --- Consent tab wiring + signature pad presence ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Consent Test Patient' }; });
    await page.evaluate(() => switchDocTab('consent', null));
    await page.waitForTimeout(150);
    const visible = await page.evaluate(() => getComputedStyle(document.getElementById('doc-tab-consent')).display !== 'none');
    t.check('the new Consent tab activates from switchDocTab', visible);
    const canvasExists = await page.evaluate(() => !!document.getElementById('con-sig-pad'));
    t.check('a canvas-based signature pad exists (no external library)', canvasExists);
    await page.close();
  }

  // --- Saving without a signature is blocked ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'consent_forms') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.consentInsert = payload; return chainable(null, []); };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Consent Test Patient' }; });
    await page.evaluate(() => switchDocTab('consent', null));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('con-type').value = 'Surgical Procedure';
      document.getElementById('con-procedure').value = 'Appendectomy';
      document.getElementById('con-signee-name').value = 'Patient Self';
    });
    await page.evaluate(() => saveConsentForm());
    await page.waitForTimeout(100);
    const blocked = await page.evaluate(() => window.__mock.consentInsert);
    t.check('saving without a drawn signature is blocked (no insert sent)', blocked === null);
    await page.close();
  }

  // --- Full happy path: draw a signature, save, verify payload + list + print ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'consent_forms') {
          const c = chainable(null, [{ id: 'cf1', consent_type: 'Surgical Procedure', consent_date: '2026-08-02', signee_name: 'Patient Self', performed_by_name: 'Doc Test', created_at: '2026-08-02T10:00:00Z' }]);
          c.insert = (payload) => { window.__mock.consentInsert = payload; return chainable(null, []); };
          c.select = function(){ return this; };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Consent Test Patient' }; });
    await page.evaluate(() => switchDocTab('consent', null));
    await page.waitForTimeout(150);
    await drawSignature(page);
    const hasSig = await page.evaluate(() => _consentHasSignature);
    t.check('drawing on the pad registers a captured signature', hasSig === true);
    await page.evaluate(() => {
      document.getElementById('con-type').value = 'Anaesthesia';
      document.getElementById('con-procedure').value = 'General anaesthesia for appendectomy';
      document.getElementById('con-risks').value = 'Nausea, sore throat, rare cardiac/respiratory risk — discussed.';
      document.getElementById('con-signee-name').value = 'Patient Self';
      document.getElementById('con-witness').value = 'Nurse B';
    });
    await page.evaluate(() => saveConsentForm());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.consentInsert);
    t.check('the saved consent form records the selected consent type', insert?.consent_type === 'Anaesthesia');
    t.check('the saved consent form records the procedure description', insert?.procedure_description === 'General anaesthesia for appendectomy');
    t.check('the saved consent form records who signed', insert?.signee_name === 'Patient Self');
    t.check('the saved consent form records the witness', insert?.witnessed_by === 'Nurse B');
    t.check('the saved consent form captures a real PNG signature image, not a placeholder', typeof insert?.signature_data_url === 'string' && insert.signature_data_url.startsWith('data:image/png'));
    t.check('the save is attributed to the performing staff member (same audit pattern as elsewhere)', insert?.performed_by_name === 'Doc Test');
    t.check('the form is linked to the patient', insert?.patient_id === 'p1');
    // Clearing the pad after save resets the "has signature" state.
    const clearedAfterSave = await page.evaluate(() => _consentHasSignature);
    t.check('the signature pad is cleared after a successful save', clearedAfterSave === false);
    await page.waitForTimeout(150);
    const listHtml = await page.evaluate(() => document.getElementById('con-list-body').innerHTML);
    t.check('the signed-forms list shows a "✓ Signed" badge (same audit-badge convention as lab results)', listHtml.includes('Signed'));
    await page.close();
  }

  // --- Bilingual discharge summary: labels translate, clinical free text does not ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    const enHtml = await page.evaluate(() => {
      localStorage.setItem('lang', 'en'); currentLang = 'en';
      return buildDischargeSummaryHtml({ name: 'Test Patient', mrn: 'M001', ward: 'Medical' }, { discharge_type: 'Discharged — Recovered', reason_for_admission: 'Fever and cough for 3 days', primary_diagnosis: 'Community-acquired pneumonia' });
    });
    t.check('English discharge summary shows the English section labels', enHtml.includes('Reason for Admission') && enHtml.includes('Diagnosis'));
    const arHtml = await page.evaluate(() => {
      localStorage.setItem('lang', 'ar'); currentLang = 'ar';
      return buildDischargeSummaryHtml({ name: 'Test Patient', mrn: 'M001', ward: 'Medical' }, { discharge_type: 'Discharged — Recovered', reason_for_admission: 'Fever and cough for 3 days', primary_diagnosis: 'Community-acquired pneumonia' });
    });
    t.check('Arabic discharge summary translates the template labels (was previously not covered at all)', arHtml.includes(t_ar_diagnosis()));
    t.check('Arabic discharge summary sets dir="rtl" on the printed content', arHtml.includes('dir="rtl"'));
    t.check('doctor-entered clinical free text (diagnosis) is printed as-typed, never auto-translated', arHtml.includes('Community-acquired pneumonia'));
    t.check('doctor-entered clinical free text (reason for admission) is printed as-typed, never auto-translated', arHtml.includes('Fever and cough for 3 days'));
    await page.evaluate(() => { localStorage.setItem('lang', 'en'); currentLang = 'en'; });
    await page.close();
  }

  function t_ar_diagnosis() { return 'التشخيص'; }

  return t;
};
