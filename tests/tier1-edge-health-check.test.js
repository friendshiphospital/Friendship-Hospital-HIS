// Tier 1 quick win: Edge Function Health Check panel (Settings page).
// runEdgeFunctionHealthCheck() pings send-sms, reception-shift-notify,
// send-email, and create-staff-account with {ping:true} and renders
// deployed/configured status per function, without ever sending a real
// SMS/email or creating a real staff account.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript(invokeImpl) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => { if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []); return chainable(null, []); },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: ${invokeImpl} },
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
  const t = makeSuite('tier1-edge-health-check');

  // --- TEST 1: all four fully deployed and configured -> all OK ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`async (name, opts) => ({ data: { ok: true, ping: true }, error: null })`));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    await page.evaluate(() => runEdgeFunctionHealthCheck());
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('edge-health-body').innerHTML);
    t.check('all four Edge Functions are listed', ['send-sms','reception-shift-notify','send-email','create-staff-account'].every(n => html.includes(n)));
    t.check('fully working functions show OK', (html.match(/✅ OK/g)||[]).length === 4);
    await page.close();
  }

  // --- TEST 2: deployed but secret not configured -> a distinct warning, not a hard failure ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`async (name, opts) => ({ data: { error: 'Email provider not configured — set RESEND_API_KEY via \`supabase secrets set\`' }, error: null })`));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    await page.evaluate(() => runEdgeFunctionHealthCheck());
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('edge-health-body').innerHTML);
    t.check('a deployed-but-unconfigured function is reported distinctly from "not deployed"', html.includes('Deployed, secret not configured'));
    t.check('the underlying provider error detail is surfaced', html.includes('RESEND_API_KEY'));
    await page.close();
  }

  // --- TEST 3: function never deployed (network/404-style error) -> "not deployed" ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(`async (name, opts) => ({ data: null, error: { message: 'Failed to send a request to the Edge Function', context: { status: 404, json: async () => ({}) } } })`));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    await page.evaluate(() => runEdgeFunctionHealthCheck());
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.getElementById('edge-health-body').innerHTML);
    t.check('a 404/unreachable function is reported as not deployed', html.includes('Not deployed / unreachable'));
    await page.close();
  }

  // --- TEST 4: the ping never touches a real side-effect table (create-staff-account) ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.__mock = { staffInserted: false, invokedBodies: [] };
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => { if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }, []); return chainable(null, []); },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async (name, opts) => { window.__mock.invokedBodies.push(opts.body); return { data: { ok: true, ping: true }, error: null }; } },
      }) };
    `);
    await login(page, baseUrl);
    await page.evaluate(() => goPage('settings'));
    await page.waitForTimeout(100);
    await page.evaluate(() => runEdgeFunctionHealthCheck());
    await page.waitForTimeout(150);
    const bodies = await page.evaluate(() => window.__mock.invokedBodies);
    t.check('every health-check invocation sends {ping:true}, never a real payload', bodies.length === 4 && bodies.every(b => b && b.ping === true));
    await page.close();
  }

  return t;
};
