// Tier 1 quick win: Follow-Ups Due Soon panel on the Appointments page —
// loadFollowUpsDue() lists scheduled-but-unused follow_ups rows due within
// 3 days (or overdue), and sendFollowUpReminder() sends an SMS via the
// same sendSms()/send-sms Edge Function path as appointment reminders,
// then stamps follow_ups.reminder_sent_at.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function initScript(followUps, patients) {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { smsInvokes: [], followUpUpdates: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Reception Sara', role: 'receptionist' }, []);
        if (table === 'follow_ups') {
          const c = chainable(null, ${JSON.stringify(followUps || [])});
          c.update = (payload) => ({ eq: (col,val) => { window.__mock.followUpUpdates.push({payload,id:val}); return Promise.resolve({data:null,error:null}); } });
          return c;
        }
        if (table === 'patients') return chainable(null, ${JSON.stringify(patients || [])});
        const c = chainable(null, []);
        c.insert = (payload) => Promise.resolve({data:[payload],error:null});
        return c;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async (name, opts) => { if(name==='send-sms') window.__mock.smsInvokes.push(opts.body); return {data:{ok:true},error:null}; } },
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

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('tier1-followup-reminders');

  // --- TEST 1: nothing due -> empty state ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([], []));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('appointments'));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('followups-due-body').innerHTML);
    t.check('no due follow-ups shows the empty state', html.includes('No follow-ups due soon'));
    await page.close();
  }

  // --- TEST 2: a due follow-up with a phone on file shows a Remind button; far-future one is excluded ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(
      [
        { id: 1, patient_mrn: 'M1', used: false, target_date: daysFromToday(1), reason: 'BP Review' },
        { id: 2, patient_mrn: 'M2', used: false, target_date: daysFromToday(30), reason: 'Too far out' },
      ],
      [
        { mrn: 'M1', name: 'Ahmed Ali', phone: '0912345678' },
      ]
    ));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('appointments'));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('followups-due-body').innerHTML);
    t.check('a follow-up due within the window is listed with the patient name', html.includes('Ahmed Ali'));
    t.check('a follow-up scheduled far outside the 3-day window is excluded', !html.includes('Too far out'));
    t.check('the row offers a Remind button since a phone is on file', html.includes('sendFollowUpReminder'));
    await page.close();
  }

  // --- TEST 3: overdue follow-up is flagged, and one with no phone on file shows "No phone on file" instead of a button ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(
      [{ id: 3, patient_mrn: 'M3', used: false, target_date: daysFromToday(-2), reason: 'Overdue check' }],
      [{ mrn: 'M3', name: 'No Phone Patient', phone: null }]
    ));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('appointments'));
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('followups-due-body').innerHTML);
    t.check('an overdue follow-up is visually flagged OVERDUE', html.includes('OVERDUE'));
    t.check('a patient with no phone on file shows "No phone on file" instead of a Remind button', html.includes('No phone on file'));
    await page.close();
  }

  // --- TEST 4: sendFollowUpReminder sends via send-sms and stamps reminder_sent_at ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript([], []));
    await login(page, baseUrl);
    await page.evaluate(() => sendFollowUpReminder(99, '0911111111', 'Test Patient', '2026-08-15'));
    await page.waitForTimeout(150);
    const smsInvokes = await page.evaluate(() => window.__mock.smsInvokes);
    const followUpUpdates = await page.evaluate(() => window.__mock.followUpUpdates);
    t.check('sendFollowUpReminder sends exactly one SMS via send-sms', smsInvokes.length === 1 && smsInvokes[0].to === '0911111111');
    t.check('the reminder message mentions the patient name and target date', smsInvokes[0].message.includes('Test Patient') && smsInvokes[0].message.includes('2026-08-15'));
    t.check('a successful send stamps reminder_sent_at on the right follow_ups row', followUpUpdates.length === 1 && followUpUpdates[0].id === 99 && !!followUpUpdates[0].payload.reminder_sent_at);
    await page.close();
  }

  return t;
};
