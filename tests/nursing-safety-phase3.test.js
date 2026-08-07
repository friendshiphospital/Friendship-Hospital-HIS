// Covers Nursing Safety Extension Phase 3: Turning Clock, Post-Analgesia
// Reassessment, and MAR overdue status. All three are timestamp-anchored
// (a stored recorded_at / Time Due value), never a client-side
// setTimeout/setInterval counter -- overdue is always recalculated from
// real elapsed time, so a page refresh never resets anything.
const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.__mock = { vitalsInserts: [] };
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => {
        if (table === 'staff') return chainable({ id:'s1', user_id:'u1', full_name:'Nurse Test', role:'nurse' }, []);
        if (table === 'patients') { const c = chainable({ visit_status: 'Registered' }, []); c.select = () => c; c.eq = () => c; return c; }
        if (table === 'vital_signs') {
          const c = chainable(null, []);
          c.insert = (payload) => { window.__mock.vitalsInserts.push(payload); return { select: () => Promise.resolve({ data: [payload], error: null }) }; };
          c.select = () => c; c.eq = () => c; c.order = () => c; c.limit = () => c;
          return c;
        }
        return chainable(null, []);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

function minutesAgoISO(mins) {
  return new Date(Date.now() - mins * 60000).toISOString();
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'nurse@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('nursing-safety-phase3');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);
  await page.evaluate(() => goPage('nursing'));
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('vs-pt-id').value = 'p1'; });

  // --- Turning Clock: no data yet -> no flag ---
  {
    const html = await page.evaluate(() => { renderTurningStatus([]); return document.getElementById('turning-status-disp').innerHTML; });
    t.check('with no repositioning logged, the turning status shows the neutral placeholder, not an overdue flag', html.includes('No repositioning'));
  }

  // --- Turning Clock: logged 30 min ago -> not overdue (interval is 2h) ---
  {
    const html = await page.evaluate((ts) => {
      renderTurningStatus([{ turning_position: 'Left', recorded_at: ts }]);
      return document.getElementById('turning-status-disp').innerHTML;
    }, minutesAgoISO(30));
    t.check('a repositioning logged 30 min ago is not yet overdue (2h interval)', html.includes('Left') && !html.includes('OVERDUE'));
  }

  // --- Turning Clock: logged 3h ago -> overdue ---
  {
    const html = await page.evaluate((ts) => {
      renderTurningStatus([{ turning_position: 'Right', recorded_at: ts }]);
      return document.getElementById('turning-status-disp').innerHTML;
    }, minutesAgoISO(180));
    t.check('a repositioning logged 3 hours ago (past the 2h interval) is flagged overdue', html.includes('OVERDUE') && html.includes('Right'));
  }

  // --- Turning Clock: logTurningPosition() writes a fresh anchor, resetting the clock ---
  {
    await page.evaluate(() => logTurningPosition('Supine'));
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.vitalsInserts[window.__mock.vitalsInserts.length - 1]);
    t.check('logTurningPosition() inserts a fresh vital_signs row with the new position (resets the anchor, not a timer object)', insert?.turning_position === 'Supine');
  }

  // --- Post-Analgesia: no administration -> no flag ---
  {
    const html = await page.evaluate(() => { renderPostAnalgesiaStatus([]); return document.getElementById('post-analgesia-status').innerHTML; });
    t.check('with no analgesia given, no reassessment flag shows', html === '');
  }

  // --- Post-Analgesia: given 10 min ago -> "reassess by" cue, not yet overdue ---
  {
    const html = await page.evaluate((ts) => {
      renderPostAnalgesiaStatus([{ analgesia_administered_at: ts, recorded_at: ts, pain_score: null }]);
      return document.getElementById('post-analgesia-status').innerHTML;
    }, minutesAgoISO(10));
    t.check('analgesia given 10 min ago (before the 45-min window) shows a "reassess by" cue, not overdue', html.includes('reassess') && !html.includes('OVERDUE'));
  }

  // --- Post-Analgesia: given 60 min ago, no reassessment -> overdue ---
  {
    const html = await page.evaluate((ts) => {
      renderPostAnalgesiaStatus([{ analgesia_administered_at: ts, recorded_at: ts, pain_score: null }]);
      return document.getElementById('post-analgesia-status').innerHTML;
    }, minutesAgoISO(60));
    t.check('analgesia given 60 min ago with no reassessment is flagged overdue', html.includes('OVERDUE'));
  }

  // --- Post-Analgesia: a NEWER pain-score reading clears the flag ---
  {
    const html = await page.evaluate(({ administeredAgo, painAgo }) => {
      renderPostAnalgesiaStatus([
        { analgesia_administered_at: administeredAgo, recorded_at: administeredAgo, pain_score: null },
        { recorded_at: painAgo, pain_score: 3 },
      ]);
      return document.getElementById('post-analgesia-status').innerHTML;
    }, { administeredAgo: minutesAgoISO(60), painAgo: minutesAgoISO(5) });
    t.check('a pain-score reading logged AFTER the analgesia administration clears the reassessment flag', html === '');
  }

  // --- Post-Analgesia: an OLDER pain score (the pre-med baseline) does NOT clear the flag ---
  {
    const html = await page.evaluate(({ administeredAgo, painAgo }) => {
      renderPostAnalgesiaStatus([
        { analgesia_administered_at: administeredAgo, recorded_at: administeredAgo, pain_score: null },
        { recorded_at: painAgo, pain_score: 7 },
      ]);
      return document.getElementById('post-analgesia-status').innerHTML;
    }, { administeredAgo: minutesAgoISO(60), painAgo: minutesAgoISO(90) });
    t.check('a pain score recorded BEFORE the analgesia (the baseline) does not count as reassessment', html.includes('OVERDUE'));
  }

  // --- saveMAR(): an IV/Oral analgesic marked Given stamps analgesia_administered_at ---
  {
    await page.evaluate(() => addMarRow());
    await page.evaluate(() => {
      document.getElementById('mar-drug-0').value = 'Paracetamol';
      document.getElementById('mar-route-0').value = 'IV';
      document.getElementById('mar-status-0').value = 'Given';
      updateMarRowUI(0);
    });
    await page.evaluate(() => saveMAR());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.vitalsInserts[window.__mock.vitalsInserts.length - 1]);
    t.check('an IV analgesic marked Given stamps analgesia_administered_at on the saved MAR row', !!insert?.analgesia_administered_at);
  }

  // --- saveMAR(): a non-analgesic Given does NOT stamp the field ---
  {
    // Remove the previous block's Paracetamol/Given row first -- saveMAR()
    // saves every row currently in the table, and leaving it in place
    // would make this scenario indistinguishable from the last one.
    await page.evaluate(() => document.getElementById('mar-row-0')?.remove());
    await page.evaluate(() => addMarRow());
    await page.evaluate(() => {
      document.getElementById('mar-drug-1').value = 'Amoxicillin';
      document.getElementById('mar-route-1').value = 'IV';
      document.getElementById('mar-status-1').value = 'Given';
      updateMarRowUI(1);
    });
    await page.evaluate(() => saveMAR());
    await page.waitForTimeout(150);
    const insert = await page.evaluate(() => window.__mock.vitalsInserts[window.__mock.vitalsInserts.length - 1]);
    t.check('a non-analgesic (antibiotic) marked Given does not stamp analgesia_administered_at', !insert?.analgesia_administered_at);
  }

  // --- MAR overdue status badge ---
  {
    await page.evaluate(() => addMarRow());
    const onTime = await page.evaluate(() => {
      const future = new Date(Date.now() + 60 * 60000);
      document.getElementById('mar-time-2').value = future.toTimeString().slice(0, 5);
      document.getElementById('mar-status-2').value = 'Due';
      marTimeStatus(2);
      return document.getElementById('mar-time-status-2').innerHTML;
    });
    t.check('a dose scheduled in the future shows On-time', onTime.includes('On-time'));

    const overdue = await page.evaluate(() => {
      const past = new Date(Date.now() - 90 * 60000); // 90 min ago, past the 30-min due window
      document.getElementById('mar-time-2').value = past.toTimeString().slice(0, 5);
      marTimeStatus(2);
      return document.getElementById('mar-time-status-2').innerHTML;
    });
    t.check('a dose 90 minutes past its scheduled time (beyond the 30-min due window) shows Overdue', overdue.includes('Overdue'));

    const dueSoon = await page.evaluate(() => {
      const recent = new Date(Date.now() - 10 * 60000); // 10 min ago, within the 30-min window
      document.getElementById('mar-time-2').value = recent.toTimeString().slice(0, 5);
      marTimeStatus(2);
      return document.getElementById('mar-time-status-2').innerHTML;
    });
    t.check('a dose 10 minutes past its scheduled time (within the 30-min due window) shows Due', dueSoon.includes('>Due<'));

    const givenClearsIt = await page.evaluate(() => {
      document.getElementById('mar-status-2').value = 'Given';
      updateMarRowUI(2);
      return document.getElementById('mar-time-status-2').innerHTML;
    });
    t.check('once a dose is actually marked Given, the on-time/due/overdue badge clears (the outcome is what matters now)', givenClearsIt === '');
  }

  // --- nursingQueueAlertBadges(): Turning + Post-Analgesia badges surface on the Nursing Queue too ---
  {
    const overdueTurning = await page.evaluate((ts) => nursingQueueAlertBadges({ turningAt: ts }), minutesAgoISO(180));
    t.check('a patient overdue for turning shows the Turning Overdue badge on the queue', overdueTurning.includes('Turning Overdue'));
    const notYetTurning = await page.evaluate((ts) => nursingQueueAlertBadges({ turningAt: ts }), minutesAgoISO(30));
    t.check('a patient within the 2h turning interval shows no badge', notYetTurning === '');

    const overdueAnalgesia = await page.evaluate((ts) => nursingQueueAlertBadges({ analgesiaAt: ts }), minutesAgoISO(60));
    t.check('a patient overdue for pain reassessment shows the badge on the queue', overdueAnalgesia.includes('Pain Reassessment Overdue'));
    const reassessedAnalgesia = await page.evaluate(({ analgesiaAt, lastPainAt }) => nursingQueueAlertBadges({ analgesiaAt, lastPainAt }), { analgesiaAt: minutesAgoISO(60), lastPainAt: minutesAgoISO(5) });
    t.check('a patient already reassessed after analgesia shows no overdue badge', reassessedAnalgesia === '');
  }

  await page.close();
  return t;
};
