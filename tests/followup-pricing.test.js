// Covers Phase 5: admin-configurable Follow-Up Visit Policy and the
// reception-side registration prompt that applies it — never silently.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(followUps) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Reception Sara', role: 'receptionist' }, []);
        if (table === 'follow_ups') return chainable(null, ${JSON.stringify(followUps || [])});
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
  await page.fill('#auth-email', 'reception@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('followup-pricing');

  // --- TEST 1: no open follow-ups -> no prompt at all, returns null ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([]));
    await login(page, baseUrl);
    let dialogFired = false;
    page.on('dialog', d => { dialogFired = true; d.dismiss(); });
    const result = await page.evaluate(() => checkAndApplyFollowUpPricing('M1'));
    t.check('no open follow-up for this MRN never prompts reception', !dialogFired);
    t.check('returns null when nothing matches', result === null);
    await page.close();
  }

  // --- TEST 2: an open follow-up exists but its target date is well outside the configured window -> no prompt ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([
      { id: 1, patient_mrn: 'M1', used: false, target_date: daysFromToday(90), scheduled_by_name: 'Dr Jones', reason: 'Review' },
    ]));
    await login(page, baseUrl);
    await page.evaluate(() => { CFG.followupWindowDays = 7; });
    let dialogFired = false;
    page.on('dialog', d => { dialogFired = true; d.dismiss(); });
    const result = await page.evaluate(() => checkAndApplyFollowUpPricing('M1'));
    t.check('a follow-up scheduled far outside the window is not treated as relevant', !dialogFired && result === null);
    await page.close();
  }

  // --- TEST 3: within window, reception DECLINES -> no pricing applied, follow-up stays available ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([
      { id: 2, patient_mrn: 'M1', used: false, target_date: daysFromToday(2), scheduled_by_name: 'Dr Jones', reason: 'Review BP' },
    ]));
    await login(page, baseUrl);
    await page.evaluate(() => { CFG.followupWindowDays = 7; });
    page.on('dialog', d => d.dismiss());
    const result = await page.evaluate(() => checkAndApplyFollowUpPricing('M1'));
    t.check('declining the prompt returns null (no discount applied)', result === null);
    await page.close();
  }

  // --- TEST 4: within window, reception CONFIRMS -> returns the matched follow-up id ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([
      { id: 3, patient_mrn: 'M1', used: false, target_date: daysFromToday(-1), scheduled_by_name: 'Dr Jones', reason: 'Review BP' },
    ]));
    await login(page, baseUrl);
    await page.evaluate(() => { CFG.followupWindowDays = 7; });
    let dialogMessage = '';
    page.on('dialog', d => { dialogMessage = d.message(); d.accept(); });
    const result = await page.evaluate(() => checkAndApplyFollowUpPricing('M1'));
    t.check('confirming returns the matched follow-up id', result?.followUpId === 3);
    t.check('the prompt names the scheduling doctor and reason, never applies silently', dialogMessage.includes('Dr Jones') && dialogMessage.includes('Review BP'));
    await page.close();
  }

  // --- TEST 5: multiple open follow-ups -> picks the one closest to today ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([
      { id: 10, patient_mrn: 'M1', used: false, target_date: daysFromToday(6), scheduled_by_name: 'Dr Far', reason: 'Far' },
      { id: 11, patient_mrn: 'M1', used: false, target_date: daysFromToday(1), scheduled_by_name: 'Dr Near', reason: 'Near' },
    ]));
    await login(page, baseUrl);
    await page.evaluate(() => { CFG.followupWindowDays = 7; });
    page.on('dialog', d => d.accept());
    const result = await page.evaluate(() => checkAndApplyFollowUpPricing('M1'));
    t.check('when multiple open follow-ups match, the one closest to today is used', result?.followUpId === 11);
    await page.close();
  }

  // --- TEST 6: Settings round-trip through CFG getters/setters ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([]));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      document.getElementById('cfg-followup-window-days').value = '10';
      document.getElementById('cfg-followup-pricing-rule').value = 'percentage';
      document.getElementById('cfg-followup-pricing-value').value = '50';
      saveFollowupPolicySettings();
    });
    const stored = await page.evaluate(() => ({ days: CFG.followupWindowDays, rule: CFG.followupPricingRule, value: CFG.followupPricingValue }));
    t.check('saveFollowupPolicySettings persists window days', stored.days === 10);
    t.check('saveFollowupPolicySettings persists the pricing rule', stored.rule === 'percentage');
    t.check('saveFollowupPolicySettings persists the pricing value', stored.value === 50);
    // Reload and confirm loadSettings() reflects it back into the form.
    await page.evaluate(() => loadSettings());
    const reloaded = await page.evaluate(() => document.getElementById('cfg-followup-window-days').value);
    t.check('loadSettings() reflects the saved window days back into the form', reloaded === '10');
    await page.close();
  }

  // --- TEST 7: pricing-value field visibility toggles with the rule (Free hides it) ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([]));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.getElementById('cfg-followup-pricing-rule').value = 'free'; updateFollowupPricingValueVisibility(); });
    const hiddenForFree = await page.evaluate(() => document.getElementById('cfg-followup-pricing-value-wrap').style.display === 'none');
    t.check('the pricing value field is hidden for the Free rule', hiddenForFree);
    await page.evaluate(() => { document.getElementById('cfg-followup-pricing-rule').value = 'fixed'; updateFollowupPricingValueVisibility(); });
    const shownForFixed = await page.evaluate(() => document.getElementById('cfg-followup-pricing-value-wrap').style.display !== 'none');
    const labelText = await page.evaluate(() => document.getElementById('cfg-followup-pricing-value-label').textContent);
    t.check('the pricing value field shows for Fixed price, labelled accordingly', shownForFixed && labelText.includes('Fixed Price'));
    await page.close();
  }

  // --- TEST 8: full registration integration — 'free' rule zeroes the invoice net_amount and marks the follow-up used ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { insertedInvoice: null, followUpUpdates: [] };
      const openFollowUp = { id: 42, patient_mrn: 'M1', used: false, target_date: new Date().toISOString().slice(0,10), scheduled_by_name: 'Dr Jones', reason: 'Review' };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Reception Sara', role: 'receptionist' }, []);
          if (table === 'follow_ups') {
            const c = chainable(null, [openFollowUp]);
            c.update = (payload) => ({ eq: () => { window.__mock.followUpUpdates.push(payload); return Promise.resolve({data:null,error:null}); } });
            return c;
          }
          if (table === 'invoices') {
            const c = chainable(null, []);
            c.insert = (payload) => { window.__mock.insertedInvoice = payload; return Promise.resolve({data:[payload],error:null}); };
            return c;
          }
          const c = chainable(null, []);
          c.insert = (payload) => Promise.resolve({data:[payload],error:null});
          c.update = () => ({ eq: () => Promise.resolve({data:null,error:null}) });
          return c;
        },
        rpc: () => Promise.resolve({ data: 'ID-1', error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    page.on('dialog', d => d.accept());
    await login(page, baseUrl);
    await page.evaluate(() => { CFG.followupWindowDays = 7; CFG.followupPricingRule = 'free'; _activeShift = { status: 'active' }; });
    await page.evaluate(() => goPage('register'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('r-fname', 'Test'); set('r-sex', 'Male'); set('r-phone', '0912345678');
      set('r-existing-mrn', 'M1');
      const consent = document.getElementById('r-consent'); if (consent) consent.checked = true;
      if (typeof _regDestinations !== 'undefined') _regDestinations.add('lab');
      const testChk = document.querySelector('.test-chk'); if (testChk) testChk.checked = true;
    });
    await page.evaluate(() => submitRegistration());
    await page.waitForTimeout(400);
    const invoice = await page.evaluate(() => window.__mock.insertedInvoice);
    const followUpUpdates = await page.evaluate(() => window.__mock.followUpUpdates);
    t.check('an invoice was created for the matched registration', !!invoice);
    if (invoice) {
      t.check('the "free" pricing rule sets discount_amount to the full subtotal', invoice.discount_amount === invoice.total_amount);
      t.check('the "free" pricing rule zeroes net_amount', invoice.net_amount === 0);
    }
    t.check('the matched follow_up is marked used, linked to the new registration', followUpUpdates.length === 1 && followUpUpdates[0].used === true && !!followUpUpdates[0].used_patient_id);
    await page.close();
  }

  return t;
};
