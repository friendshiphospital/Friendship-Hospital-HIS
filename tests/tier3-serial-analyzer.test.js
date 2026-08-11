// Tier 3: true bidirectional analyzer integration via the Web Serial API
// (connectSerialAnalyzer()/serialFrameByte()/finishSerialFrame()). Mocks
// navigator.serial (not available in headless Chromium by default) with a
// fake port whose readable stream yields pre-programmed byte chunks, then
// confirms a full ASTM frame (terminated by EOT 0x04) is parsed with the
// same parseAstmMessage() the paste/simulate tools use and lands in the
// same _instrumentMessages pipeline.
const { STATEFUL_MOCK_SRC } = require('./helpers/stateful-mock');
const { makeSuite } = require('./helpers/test-kit');

function bytesOf(str) {
  return Array.from(str).map((c) => c.charCodeAt(0));
}

// One ASTM 'R' result record for WBC, framed the way a real serial
// transmission would be: ENQ, the record text (CR-terminated), EOT.
function buildAstmFrameBytes(sampleId, testCode, value) {
  const enq = [0x05];
  const text = bytesOf('O|1|' + sampleId + '||\rR|1|^^^' + testCode + '|' + value + '|10*3/uL|4.0-10.0|N|||F\r');
  const eot = [0x04];
  return new Uint8Array([...enq, ...text, ...eot]);
}

function initScript(frameBytesArray) {
  const frameJson = JSON.stringify(frameBytesArray ? Array.from(frameBytesArray) : null);
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${STATEFUL_MOCK_SRC}
    window.__seed = { tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }] }, users: [{ id: 'u1', email: 'admin@example.com', password: 'whatever' }] };
    window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };

    window.__mock = { openedBaud: null, writtenBytes: [], portClosed: false };
    const frameBytes = ${frameJson};
    // Chromium ships navigator.serial as a real, non-writable accessor even
    // in this headless test environment, so a plain \`navigator.serial = ...\`
    // assignment silently no-ops and the code under test would end up
    // calling the REAL requestPort() (which hangs/rejects with no device
    // picker available). Object.defineProperty forces the override.
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
      requestPort: async () => ({
        open: async (opts) => { window.__mock.openedBaud = opts.baudRate; },
        close: async () => { window.__mock.portClosed = true; },
        readable: {
          getReader: () => {
            let sent = false;
            return {
              read: async () => {
                if (!sent && frameBytes) {
                  sent = true;
                  return { value: new Uint8Array(frameBytes), done: false };
                }
                // No more scripted data — hang rather than signalling done,
                // same as a real idle serial connection would.
                return new Promise(() => {});
              },
              releaseLock: () => {},
            };
          },
        },
        writable: {
          getWriter: () => ({
            write: async (bytes) => { window.__mock.writtenBytes.push(...bytes); },
            releaseLock: () => {},
          }),
        },
      }),
      },
    });
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
  const t = makeSuite('tier3-serial-analyzer');

  // --- TEST 1: isWebSerialSupported() reflects navigator.serial presence, and the unsupported-browser warning shows/hides accordingly ---
  {
    const page = await context.newPage();
    await page.addInitScript(`
      localStorage.setItem('sb_url','https://mock.supabase.co');
      localStorage.setItem('sb_key','mock-anon-key');
      ${STATEFUL_MOCK_SRC}
      window.__seed = { tables: { staff: [{ id: 's1', user_id: 'u1', full_name: 'Admin Test', role: 'admin' }] }, users: [{ id: 'u1', email: 'admin@example.com', password: 'whatever' }] };
      window.supabase = { createClient: () => makeStatefulSupabaseMock(window.__seed) };
      // This Chromium build ships navigator.serial for real (it's a shipped,
      // not experimental, Chrome/Edge desktop feature) as an accessor on
      // Navigator.prototype, and isWebSerialSupported() checks
      // 'serial' in navigator — an operator that walks the prototype
      // chain. Defining an own undefined-valued property on the instance
      // still leaves 'serial' in navigator true (the property exists,
      // just with an undefined value) since delete on the instance only
      // unmasks the prototype's accessor again. The only way to actually
      // simulate an unsupported browser (Safari/mobile) is removing it
      // from the shared prototype itself.
      if ('serial' in Navigator.prototype) delete Navigator.prototype.serial;
    `);
    await login(page, baseUrl);
    const supported = await page.evaluate(() => isWebSerialSupported());
    t.check('isWebSerialSupported() is false when navigator.serial is absent (e.g. Safari/mobile)', supported === false);
    await page.evaluate(() => goPage('analyzer'));
    await page.waitForTimeout(150);
    const warnShown = await page.evaluate(() => document.getElementById('ws-support-warn')?.style.display === 'block');
    t.check('the unsupported-browser warning is shown on the Analyzer page when Web Serial is unavailable', warnShown);
    await page.close();
  }

  // --- TEST 2: connecting opens the port at the selected baud rate and flips the Connect/Disconnect button states ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(null));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('analyzer'));
    await page.waitForTimeout(150);
    await page.selectOption('#ws-baud', '19200');
    await page.evaluate(() => connectSerialAnalyzer());
    await page.waitForTimeout(150);
    const openedBaud = await page.evaluate(() => window.__mock.openedBaud);
    const statusText = await page.evaluate(() => document.getElementById('ws-status').textContent);
    const btnStates = await page.evaluate(() => ({ connect: document.getElementById('ws-connect-btn').disabled, disconnect: document.getElementById('ws-disconnect-btn').disabled }));
    t.check('connectSerialAnalyzer() opens the port at the baud rate selected in the dropdown', openedBaud === 19200);
    t.check('the status badge reflects a successful connection', statusText.includes('Connected'));
    t.check('Connect is disabled and Disconnect enabled once connected', btnStates.connect === true && btnStates.disconnect === false);
    await page.close();
  }

  // --- TEST 3: a full ASTM frame (ENQ...EOT) arriving over the mocked serial port is parsed and lands in the instrument message stream ---
  {
    const page = await context.newPage();
    const frame = buildAstmFrameBytes('SER-500', 'WBC', '6.8');
    await page.addInitScript(initScript(frame));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('analyzer'));
    await page.waitForTimeout(150);
    await page.evaluate(() => connectSerialAnalyzer());
    await page.waitForTimeout(300);
    const messages = await page.evaluate(() => _instrumentMessages.map(m => ({ machine: m.machine_id, code: m.test_parameter, value: m.raw_value, barcode: m.sample_barcode })));
    t.check('a live serial ASTM frame is parsed into exactly one instrument message', messages.length === 1);
    if (messages.length) {
      t.check('the parsed message carries the correct test code and value from the wire', messages[0].code === 'WBC' && messages[0].value === '6.8');
      t.check('the sample barcode from the ASTM O record is captured', messages[0].barcode === 'SER-500');
      t.check('the message is attributed to the live serial transport, not paste/simulate', messages[0].machine.includes('Live Serial'));
    }
    const lastFrameShown = await page.evaluate(() => document.getElementById('ws-last-frame').textContent !== '—');
    t.check('the Last Frame Received indicator updates once a frame is processed', lastFrameShown);
    t.check('an ENQ byte at the start of the frame is ACKed back to the analyzer (basic handshake)', await page.evaluate(() => window.__mock.writtenBytes.includes(0x06)));
    await page.close();
  }

  // --- TEST 4: disconnecting closes the port and resets button/status state ---
  {
    const page = await context.newPage();
    await page.addInitScript(initScript(null));
    await login(page, baseUrl);
    await page.evaluate(() => goPage('analyzer'));
    await page.waitForTimeout(150);
    await page.evaluate(() => connectSerialAnalyzer());
    await page.waitForTimeout(150);
    await page.evaluate(() => disconnectSerialAnalyzer());
    await page.waitForTimeout(150);
    const closed = await page.evaluate(() => window.__mock.portClosed);
    const btnStates = await page.evaluate(() => ({ connect: document.getElementById('ws-connect-btn').disabled, disconnect: document.getElementById('ws-disconnect-btn').disabled }));
    const statusText = await page.evaluate(() => document.getElementById('ws-status').textContent);
    t.check('disconnectSerialAnalyzer() closes the underlying port', closed);
    t.check('button states reset so Connect can be used again', btnStates.connect === false && btnStates.disconnect === true);
    t.check('the status badge reflects the disconnect', statusText.includes('Disconnected'));
    await page.close();
  }

  return t;
};
