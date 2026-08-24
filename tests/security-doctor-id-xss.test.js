// CodeQL alert #928: "DOM text reinterpreted as HTML" at index.html:19380
// (loadDoctors()'s body.innerHTML assignment). Every other field in that
// row (name, specialty, doctor_type, phone, email, license_no) was already
// passed through escapeHtml() -- but d.id was interpolated raw into the
// Edit/Delete buttons' onclick="editDoctor('...')" attribute, an
// HTML-attribute-then-JS-string context escapeHtml() doesn't cover (that's
// what escAttr() exists for, and is already used this same way at dozens
// of other call sites in this file, e.g. openEnterModalDept/printResultByDept).
//
// Fixed by wrapping d.id in escAttr(), matching the established pattern.
//
// This test seeds a doctor row whose id contains HTML/attribute-breaking
// metacharacters (a real id would never look like this -- Supabase UUIDs
// don't -- but CodeQL's static analysis correctly doesn't assume that, and
// neither should this test) and confirms:
//   1. No live, unescaped tag/attribute breakout renders in the DOM.
//   2. Edit/Delete still work normally for an ordinary doctor row (no
//      functional regression from adding the escaping).
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

const MALICIOUS_ID = `abc"'><img src=x onerror=alert(1)>`;

function initScript() {
  const seed = {
    tables: {
      staff: [{ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }],
      doctors: [
        { id: MALICIOUS_ID, name: 'Dr. Malicious', specialty: 'General Practitioner', doctor_type: 'GP', phone: '0900000000', email: 'x@example.com', license_no: 'LIC1' },
        { id: 'doc-normal', name: 'Dr. Normal', specialty: 'Cardiology', doctor_type: 'Consultant', phone: '0911111111', email: 'normal@example.com', license_no: 'LIC2' },
      ],
    },
    users: [{ id: 'u1', email: 'admin@example.com', password: 'whatever' }],
  };
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = ${JSON.stringify(seed)};
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
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
  const t = makeSuite('security-doctor-id-xss');
  const page = await context.newPage();
  await page.addInitScript(initScript());

  let dialogFired = false;
  page.on('dialog', d => { dialogFired = true; d.dismiss(); });

  await login(page, baseUrl);
  await page.evaluate(() => loadDoctors());
  await page.waitForTimeout(300);

  // No live <img> element with the injected onerror handler actually exists in the DOM.
  const injectedImgCount = await page.evaluate(() => document.querySelectorAll('#dr-table-body img[onerror]').length);
  t.check('the malicious id does not create a live <img onerror> element in the DOM', injectedImgCount === 0);
  t.check('no alert dialog fired from the injected onerror payload', !dialogFired);

  // The row still renders, and the escaped id is present as inert text/attribute, not executable markup.
  const rowCount = await page.evaluate(() => document.querySelectorAll('#dr-table-body tbody tr').length);
  t.check('both doctor rows still rendered', rowCount === 2);
  const bodyHtml = await page.evaluate(() => document.getElementById('dr-table-body').innerHTML);
  t.check('the row for the malicious-id doctor still shows their name safely', bodyHtml.includes('Dr. Malicious'));

  // Functional regression check: Edit still works normally for an ordinary doctor.
  await page.evaluate(() => editDoctor('doc-normal'));
  await page.waitForTimeout(200);
  const nameFieldValue = await page.evaluate(() => document.getElementById('dr-name')?.value);
  t.check('editDoctor() still populates the edit form correctly for a normal id', nameFieldValue === 'Dr. Normal');

  // Functional regression check: Delete still works normally (confirm() dialog + actual removal).
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => deleteDoctor('doc-normal'));
  await page.waitForTimeout(300);
  const remaining = await page.evaluate(() => sb.__db.doctors.map(d => d.id));
  t.check('deleteDoctor() still actually deletes the correct doctor by id', !remaining.includes('doc-normal') && remaining.includes(MALICIOUS_ID));

  await page.close();
  return t;
};
