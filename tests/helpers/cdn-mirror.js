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
    // This build's UMD wrapper is a bare `var supabase = (function(){...})()`
    // at script scope, which unconditionally clobbers window.supabase —
    // confirmed by direct Playwright probe. Every test's page.addInitScript
    // installs its own `window.supabase = { createClient: mockFn, ... }`
    // BEFORE this script tag runs (addInitScript always runs first), and
    // the app's initSupabase() (index.html ~line 8150) expects that mock to
    // still be in place afterward, not the real library. wrapPreservingMock
    // scopes the real `var supabase` locally so it never touches
    // window.supabase when a mock is already present, restoring the
    // (apparently long-relied-on) behavior of whatever jsdelivr was
    // actually serving during this project's earlier successful runs — see
    // the vendor README's "Why wrapPreservingMock" section. The two test
    // files that never install a mock still get the real library exposed
    // as window.supabase exactly as an un-wrapped script would.
    wrapPreservingMock: true,
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
    let body = fs.readFileSync(path.join(VENDOR_DIR, mirror.file), 'utf8');
    if (mirror.wrapPreservingMock) {
      body = '(function(){\n'
        + 'var __mockPresent = (typeof window.supabase !== "undefined") && window.supabase !== null;\n'
        + 'var __mock = window.supabase;\n'
        + body + '\n'
        + 'window.supabase = __mockPresent ? __mock : supabase;\n'
        + '})();\n';
    }
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
  });
}

module.exports = { installCdnMirror };
