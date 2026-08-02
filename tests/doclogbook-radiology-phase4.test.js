// Covers Documentation/Logbook Phase 4 (Radiology): closes two real gaps
// confirmed by the Phase 0 audit — (1) the pregnancy/contrast/eGFR safety
// gate previously only existed on the dedicated Radiology module's own
// request form; orders placed via Doctor quick-order or Reception
// registration could bypass it entirely — and (2) radiology critical
// findings were only ever visible inside the Radiology module's own
// lists, never on the shared critical_values/Criticals-page/notification
// pipeline that Lab and Blood Bank both use.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { radInsert: null, criticalInsert: null };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Rad Test', role: 'admin' }, []);
        if (table === 'radiology_requests') {
          const c = chainable({ patient_id: 'p1', imaging_type: 'Chest X-Ray', patients: { mrn: 'M123', lab_no: 'L123' } }, []);
          c.insert = (payload) => { window.__mock.radInsert = payload; return { select: () => Promise.resolve({ data: [payload], error: null }) }; };
          c.update = (payload) => ({ eq: () => Promise.resolve({ data: null, error: null }) });
          return c;
        }
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

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('doclogbook-radiology-phase4');

  // --- Doctor quick-order Radiology tab: safety-field parity ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'doctor_orders') return chainable(null, []);
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Rad Test Patient', sex: 'F', age: 28, age_unit: 'y', payment_status: 'paid' }; });
    await page.evaluate(() => switchOrderType('radiology', null));
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.getElementById('ord-rad-type').value = 'X-Ray — Abdomen'; updateOrdRadSafetyFields(); });
    const pregVisible = await page.evaluate(() => getComputedStyle(document.getElementById('ord-rad-pregnancy-wrap')).display !== 'none');
    t.check('Doctor quick-order now shows the pregnancy gate for a female childbearing-age patient + X-Ray (previously absent)', pregVisible);
    await page.evaluate(() => submitRadOrder());
    await page.waitForTimeout(100);
    t.check('submitting without confirming pregnancy status is hard-blocked, same as the dedicated Radiology form', (await page.evaluate(() => window.__mock.radInsert)) === null);
    await page.evaluate(() => { document.getElementById('ord-rad-pregnancy-status').value = 'confirmed_not_pregnant'; });
    await page.evaluate(() => submitRadOrder());
    await page.waitForTimeout(100);
    const insert = await page.evaluate(() => window.__mock.radInsert);
    t.check('after confirming, the order submits and records the pregnancy status', insert?.pregnancy_status === 'confirmed_not_pregnant');
    await page.close();
  }

  // --- Doctor quick-order: contrast study shows eGFR warning ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'doctor_orders') return chainable(null, []);
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('consultation'));
    await page.waitForTimeout(200);
    await page.evaluate(() => { _docPt = { id: 'p1', name: 'Rad Test Patient', sex: 'M', age: 50, age_unit: 'y', payment_status: 'paid' }; });
    await page.evaluate(() => switchOrderType('radiology', null));
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.getElementById('ord-rad-type').value = 'CT — Head (contrast)'; updateOrdRadSafetyFields(); });
    const contrastVisible = await page.evaluate(() => getComputedStyle(document.getElementById('ord-rad-contrast-wrap')).display !== 'none');
    t.check('a contrast study shows the eGFR/creatinine fields (previously absent on this order path)', contrastVisible);
    await page.evaluate(() => { document.getElementById('ord-rad-egfr').value = '20'; checkOrdRadContrastSafety(); });
    const warningShown = await page.evaluate(() => getComputedStyle(document.getElementById('ord-rad-contrast-warning')).display !== 'none');
    t.check('a low eGFR triggers the nephrotoxicity warning', warningShown);
    await page.close();
  }

  // --- Reception registration: safety-field parity ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.getElementById('r-sex').value = 'Female';
      document.getElementById('r-age').value = '30';
      document.getElementById('r-age-unit').value = 'Years';
      document.getElementById('r-rad-type').value = 'X-Ray — Pelvis (AP)';
      updateRegRadSafetyFields();
    });
    const pregVisible = await page.evaluate(() => getComputedStyle(document.getElementById('r-rad-pregnancy-wrap')).display !== 'none');
    t.check('Reception registration now shows the pregnancy gate for a female childbearing-age patient + X-Ray (previously absent)', pregVisible);
    await page.evaluate(() => {
      document.getElementById('r-sex').value = 'Male';
      updateRegRadSafetyFields();
    });
    const pregHiddenForMale = await page.evaluate(() => getComputedStyle(document.getElementById('r-rad-pregnancy-wrap')).display === 'none');
    t.check('the pregnancy gate correctly hides for a male patient', pregHiddenForMale);
    await page.close();
  }

  // --- Radiology critical finding integrates into the shared critical_values pipeline ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'critical_values') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.criticalInsert = payload; return Promise.resolve({ data: payload, error: null }); };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('radiology'));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.getElementById('rad-rep-id').value = 'rr1';
      document.getElementById('rad-rep-impression').value = 'Large pneumothorax, urgent intervention needed.';
      document.getElementById('rad-rep-critical').checked = true;
      document.getElementById('rad-critical-desc').value = 'Large right-sided tension pneumothorax';
      document.getElementById('rad-crit-notified-name').value = 'Dr. Surgeon';
      document.getElementById('rad-crit-notified-time').value = '2026-08-02T10:30';
      document.getElementById('rad-crit-channel').value = 'Phone Call';
    });
    await page.evaluate(() => saveRadReport());
    await page.waitForTimeout(200);
    const insert = await page.evaluate(() => window.__mock.criticalInsert);
    t.check('a radiology critical finding is now ALSO inserted into critical_values (previously only visible inside Radiology\'s own lists)', insert?.department === 'Radiology');
    t.check('the critical_values row carries the actual finding text', insert?.value === 'Large right-sided tension pneumothorax');
    t.check('the critical_values row starts unacknowledged, same as any other critical value', insert?.is_acknowledged === false);
    t.check('the notifying physician name carries through', insert?.notified_by === 'Dr. Surgeon');
    await page.close();
  }

  // --- Non-critical reports never touch critical_values ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`
        if (table === 'critical_values') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.criticalInsert = payload; return Promise.resolve({ data: payload, error: null }); };
          return c;
        }
    `));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('radiology'));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.getElementById('rad-rep-id').value = 'rr2';
      document.getElementById('rad-rep-impression').value = 'Normal chest X-ray.';
      document.getElementById('rad-rep-critical').checked = false;
    });
    await page.evaluate(() => saveRadReport());
    await page.waitForTimeout(200);
    t.check('a non-critical report never writes to critical_values', (await page.evaluate(() => window.__mock.criticalInsert)) === null);
    await page.close();
  }

  return t;
};
