// TEST-ONLY network shim — routes index.html's three real cdn.jsdelivr.net
// <script src> requests to local vendored files instead of the real CDN.
//
// WHY THIS EXISTS: as of 2026-08-18 this sandbox's outbound proxy started
// hard-rejecting (403 "policy denial") every CONNECT to cdn.jsdelivr.net,
// while registry.npmjs.org (a different host) stayed reachable at the same
// moment — confirmed live and reproducible, not a flaky timeout. Every
// regression test loads a real index.html page in a real browser (only
// `sb.from(...)` is mocked, not the page load itself), so without these
// three scripts the browser's `load` event never fires and the whole suite
// hangs. See tests/vendor/cdn-mirror/README.md for the full writeup and how
// to refresh the pinned versions below.
//
// THIS DOES NOT CHANGE THE APP. index.html's real <script src="https://
// cdn.jsdelivr.net/...">  tags are untouched and still load from the real
// CDN in production and in any browser session outside this test harness.
// A future session must NOT mistake this for a real dependency, and must
// NOT port anything from tests/vendor/ into index.html or any non-test code.
//
// If cdn.jsdelivr.net becomes reachable again, this shim is harmless to
// leave in place (it only intercepts those three exact URLs), but it also
// stops being necessary — this file was written under an active block, not
// as a permanent replacement for the real CDN.
const fs = require('fs');
const path = require('path');

// Keep in sync with the exact <script src> versions in index.html's <head>,
// and with the filenames actually present in tests/vendor/cdn-mirror/.
const MIRRORS = [
  {
    // index.html pins the UNPINNED major-version tag "@2" (floats to
    // whatever jsdelivr resolves as the latest stable 2.x release at
    // request time) — this file is a snapshot of that resolution taken
    // 2026-08-18 (npm dist-tags.latest 2.112.3). See the vendor README
    // before assuming this is "the" version pinned by index.html.
    match: (url) => url.includes('cdn.jsdelivr.net') && url.includes('/npm/@supabase/supabase-js@2/dist/umd/supabase.js'),
    file: 'supabase-js@2.112.3.umd.js',
  },
  {
    match: (url) => url.includes('cdn.jsdelivr.net') && url.includes('/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js'),
    file: 'jsbarcode@3.11.5.all.min.js',
  },
  {
    match: (url) => url.includes('cdn.jsdelivr.net') && url.includes('/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'),
    file: 'html5-qrcode@2.3.8.min.js',
  },
];

const VENDOR_DIR = path.join(__dirname, '..', 'vendor', 'cdn-mirror');

// Attach to a Playwright BrowserContext (or a single Page — both expose
// .route()) before navigating to index.html, so the very first request for
// each script is already intercepted.
async function installCdnMirror(contextOrPage) {
  await contextOrPage.route('https://cdn.jsdelivr.net/**', (route) => {
    const url = route.request().url();
    const mirror = MIRRORS.find((m) => m.match(url));
    if (!mirror) {
      // Unrecognized jsdelivr request (e.g. a version bump in index.html
      // this shim hasn't been updated for yet) — fail loudly instead of
      // silently falling through to the real, blocked CDN and hanging.
      route.abort('failed');
      return;
    }
    const body = fs.readFileSync(path.join(VENDOR_DIR, mirror.file));
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
  });
}

module.exports = { installCdnMirror };
