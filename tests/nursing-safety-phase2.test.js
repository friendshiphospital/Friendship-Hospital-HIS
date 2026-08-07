// Covers Nursing Safety Extension Phase 2: extending the EXISTING NEWS2
// implementation (calcNEWS2()) with escalation, not a new calculator.
// Score >=7 opens a blocking RRT modal (reusing the Critical Values
// acknowledge-with-real-read-back pattern) and actually blocks saveVitals()
// until acknowledged; 3-6 shows a visible hourly-monitoring flag, both on
// the vitals form itself and on the Nursing Queue.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { vitalsInserts: [] };
    window.__mockQueuePatients = [];
    window.__mockNewsRows = [];
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Nurse Test', role:'nurse' }, []);
        if (table === 'vital_signs') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.vitalsInserts.push(payload); return { select: () => Promise.resolve({ data: [payload], error: null }) }; };
          c.select = () => c; c.eq = () => c; c.gte = () => c; c.lte = () => c;
          c.in = () => c;
          c.order = () => ({ then: (resolve) => resolve({ data: window.__mockNewsRows, error: null }) });
          return c;
        }
        if (table === 'patients') { const c = chainable(null, window.__mockQueuePatients); c.select = () => c; c.gte = () => c; c.order = () => c; c.limit = () => c; return c; }
        if (table === 'admissions') { const c = chainable(null, []); c.select = () => c; c.in = () => c; c.limit = () => c; return c; }
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
  await page.fill('#auth-email', 'nurse@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

function setNews2Fields(page, { sys, rr, spo2, hr, temp }) {
  return page.evaluate(({ sys, rr, spo2, hr, temp }) => {
    const set = (id, v) => { document.getElementById(id).value = v; };
    set('vs-sys', sys); set('vs-rr', rr); set('vs-spo2', spo2); set('vs-hr', hr); set('vs-temp', temp);
    return calcNEWS2();
  }, { sys, rr, spo2, hr, temp });
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('nursing-safety-phase2');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);
  await page.evaluate(() => goPage('nursing'));
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('vs-pt-id').value = 'p1'; document.getElementById('vs-pt-name').textContent = 'RRT Test Patient'; resetNews2RrtState(); });

  // --- Score 3-6: visible hourly-monitoring flag, no modal ---
  {
    const score = await setNews2Fields(page, { sys: 105, rr: 22, spo2: 96, hr: 95, temp: 37 }); // moderate score
    const flagVisible = await page.evaluate(() => getComputedStyle(document.getElementById('vs-news2-hourly-flag')).display !== 'none');
    const modalOpen = await page.evaluate(() => document.getElementById('rrt-ack-ov').classList.contains('open'));
    t.check('a NEWS2 score of 3-6 shows the hourly-monitoring flag', score >= 3 && score < 7 && flagVisible);
    t.check('a NEWS2 score of 3-6 does NOT open the blocking RRT modal', !modalOpen);
  }

  // --- Score >=7: red pulse + blocking modal opens automatically ---
  {
    const score = await setNews2Fields(page, { sys: 85, rr: 26, spo2: 90, hr: 135, temp: 34.5 }); // severe
    const pulsing = await page.evaluate(() => document.getElementById('vs-news2-bar').classList.contains('news2-pulse'));
    const modalOpen = await page.evaluate(() => document.getElementById('rrt-ack-ov').classList.contains('open'));
    t.check('a NEWS2 score >=7 is actually computed as >=7 by this scenario', score >= 7);
    t.check('the NEWS2 bar gets the red pulsing class', pulsing);
    t.check('the RRT acknowledge modal opens automatically', modalOpen);
  }

  // --- The modal does not re-open on every keystroke while score stays >=7 ---
  {
    await page.evaluate(() => closeOv('rrt-ack-ov'));
    await setNews2Fields(page, { sys: 85, rr: 26, spo2: 90, hr: 136, temp: 34.5 }); // still >=7, minor HR change
    const modalOpen = await page.evaluate(() => document.getElementById('rrt-ack-ov').classList.contains('open'));
    t.check('closing the modal does not cause it to reopen on every subsequent edit while still >=7', !modalOpen);
  }

  // --- saveVitals() is BLOCKED while >=7 is unacknowledged ---
  {
    await page.evaluate(() => saveVitals());
    await page.waitForTimeout(150);
    const inserts = await page.evaluate(() => window.__mock.vitalsInserts.length);
    const modalOpen = await page.evaluate(() => document.getElementById('rrt-ack-ov').classList.contains('open'));
    t.check('saveVitals() refuses to save while NEWS2 >=7 is unacknowledged', inserts === 0);
    t.check('attempting to save re-opens the RRT modal', modalOpen);
  }

  // --- Read-back mismatch is rejected (real confirmation, not a bare click-through) ---
  {
    await page.evaluate(() => { document.getElementById('rrt-readback-val').value = '999'; document.getElementById('rrt-notified-to').value = 'Dr Ahmed'; submitRrtAck(); });
    const stillOpen = await page.evaluate(() => document.getElementById('rrt-ack-ov').classList.contains('open'));
    t.check('a wrong read-back value does not acknowledge the RRT escalation', stillOpen);
  }

  // --- Correct acknowledgement unblocks the save ---
  {
    const currentScore = await page.evaluate(() => document.getElementById('vs-news2-val').textContent.trim());
    await page.evaluate((score) => {
      document.getElementById('rrt-readback-val').value = score;
      document.getElementById('rrt-notified-to').value = 'Dr Ahmed';
      submitRrtAck();
    }, currentScore);
    const modalClosedAfterAck = await page.evaluate(() => !document.getElementById('rrt-ack-ov').classList.contains('open'));
    t.check('a matching read-back closes the modal', modalClosedAfterAck);
    await page.evaluate(() => saveVitals());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.vitalsInserts[0]);
    t.check('saveVitals() now succeeds after acknowledgement', !!insert);
    t.check('the acknowledgement is persisted on the saved row', insert?.rrt_acknowledged === true && insert?.rrt_notified_to === 'Dr Ahmed');
  }

  // --- Nursing Queue: NEWS2-based alert badges ---
  {
    const queuePage = await context.newPage();
    await queuePage.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${CHAINABLE_MOCK_SRC}
      window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
        from: (table) => {
          if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Nurse Test', role:'nurse' }, []);
          if (table === 'patients') {
            const rows = [
              { id:'qp1', name:'RRT Risk Patient', mrn:'Q1', payment_status:'paid', created_at:new Date().toISOString() },
              { id:'qp2', name:'Hourly Watch Patient', mrn:'Q2', payment_status:'paid', created_at:new Date().toISOString() },
              { id:'qp3', name:'Stable Patient', mrn:'Q3', payment_status:'paid', created_at:new Date().toISOString() },
            ];
            const c = chainable(null, rows); c.select = () => c; c.gte = () => c; c.order = () => c; c.limit = () => c; return c;
          }
          if (table === 'admissions') { const c = chainable(null, []); c.select = () => c; c.in = () => c; c.limit = () => c; return c; }
          if (table === 'vital_signs') {
            const newsRows = [
              { patient_id:'qp1', news2_score:8, recorded_at:new Date().toISOString() },
              { patient_id:'qp2', news2_score:4, recorded_at:new Date().toISOString() },
              { patient_id:'qp3', news2_score:1, recorded_at:new Date().toISOString() },
            ];
            const c = chainable(null, newsRows);
            c.select = () => c; c.in = () => c;
            // .order() is chained with a further .limit(500) by the source
            // (sb.from('vital_signs').select(...).in(...).order(...).limit(...))
            // -- the resolved object must still expose .limit(), not just .then().
            const ordered = { then: (resolve) => resolve({ data: newsRows, error: null }) };
            ordered.limit = () => ordered;
            c.order = () => ordered;
            return c;
          }
          return chainable(null, []);
        },
        rpc: () => Promise.resolve({ data: null, error: null }),
        functions: { invoke: async()=>({data:{ok:true},error:null}) },
      }) };
    `);
    await login(queuePage, baseUrl);
    await queuePage.evaluate(() => goPage('nursing'));
    await queuePage.waitForTimeout(600);
    const bodyText = await queuePage.evaluate(() => document.getElementById('nrs-queue-body')?.textContent || '');
    t.check('a NEWS2 >=7 patient shows the RRT alert badge on the Nursing Queue', bodyText.includes('NEWS2 8'));
    t.check('a NEWS2 3-6 patient shows the Hourly Monitoring badge on the Nursing Queue', bodyText.includes('Hourly Monitoring'));
    const rrtBadgeHtml = await queuePage.evaluate(() => document.getElementById('nrs-queue-body').innerHTML);
    t.check('the queue-level RRT badge also pulses (same visual language as the vitals form)', rrtBadgeHtml.includes('news2-pulse'));
    await queuePage.close();
  }

  await page.close();
  return t;
};
