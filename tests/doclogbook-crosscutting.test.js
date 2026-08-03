// Covers the Documentation/Logbook cross-cutting work: a new
// app_audit_logs table (logAppAudit()) reaching Nursing/Radiology/Bed
// Management/Theatre/Blood Bank — modules the existing audit_logs
// (DB-trigger, 8 lab/consultation tables only) and billing_audit_logs
// (billing-only) never covered — and Radiology's Verify step now
// capturing verified_by/verified_at (previously it only flipped the
// status string, confirmed gap from the Phase 0 audit).
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(extra) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { auditInserts: [], radUpdate: null };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Cross Test', role: 'admin' }, []);
        if (table === 'app_audit_logs') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.auditInserts.push(payload); return { select: () => Promise.resolve({ data: [payload], error: null }) }; };
          return c;
        }
        if (table === 'radiology_requests') {
          const c = chainable(null, []);
          c.update = (payload) => { window.__mock.radUpdate = payload; return { eq: () => Promise.resolve({ data: null, error: null }) }; };
          return c;
        }
        if (table === 'beds') {
          const c = chainable(null, []);
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
  const t = makeSuite('doclogbook-crosscutting');

  // --- logAppAudit() writes a well-formed row and never throws ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => logAppAudit('Nursing', 'Test Action', 'rec1', 'some detail'));
    await page.waitForTimeout(150);
    const inserts = await page.evaluate(() => window.__mock.auditInserts);
    t.check('logAppAudit records the module', inserts[0]?.module === 'Nursing');
    t.check('logAppAudit records the action', inserts[0]?.action === 'Test Action');
    t.check('logAppAudit records the record id', inserts[0]?.record_id === 'rec1');
    t.check('logAppAudit attributes the performing staff member', inserts[0]?.performed_by_name === 'Cross Test');
    await page.close();
  }

  // --- Radiology Verify step now captures verified_by/verified_at ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('radiology'));
    await page.waitForTimeout(200);
    await page.evaluate(() => updateRadStatus('rr1', 'Verified'));
    await page.waitForTimeout(150);
    const update = await page.evaluate(() => window.__mock.radUpdate);
    t.check('verifying a report now sets status to Verified', update?.status === 'Verified');
    t.check('verifying a report now records who verified it (previously never captured)', update?.verified_by_name === 'Cross Test');
    t.check('verifying a report now records when (previously never captured)', !!update?.verified_at);
    const auditInserts = await page.evaluate(() => window.__mock.auditInserts);
    t.check('verifying a report also writes to the cross-module audit log', auditInserts.some(a => a.module === 'Radiology' && a.action === 'Verify'));
    await page.close();
  }

  // --- A non-verify status change does NOT stamp verifier fields ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('radiology'));
    await page.waitForTimeout(200);
    await page.evaluate(() => updateRadStatus('rr2', 'Reported'));
    await page.waitForTimeout(150);
    const update = await page.evaluate(() => window.__mock.radUpdate);
    t.check('a non-Verified status change does not stamp verifier fields', update?.status === 'Reported' && update?.verified_by_name === undefined);
    await page.close();
  }

  // --- Bed Management: manual bed status changes now write to the audit log ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript());
    await login(page, baseUrl);
    await page.evaluate(() => goPage('admission'));
    await page.waitForTimeout(200);
    await page.evaluate(() => setBedStatus('bed1', 'Cleaning'));
    await page.waitForTimeout(150);
    const auditInserts = await page.evaluate(() => window.__mock.auditInserts);
    t.check('a manual bed status change writes to the cross-module audit log (previously had no attribution at all)', auditInserts.some(a => a.module === 'Bed Management' && a.record_id === 'bed1'));
    await page.close();
  }

  return t;
};
