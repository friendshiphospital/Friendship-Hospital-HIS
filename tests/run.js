#!/usr/bin/env node
// Committed regression suite runner for Friendship Hospital HIS.
//
// Usage:
//   node tests/run.js              — run every *.test.js file in this directory
//   node tests/run.js auth-role    — run only files whose name contains "auth-role"
//
// Requires Playwright (see helpers/load-playwright.js for how it's located)
// and a Chromium build discoverable via PLAYWRIGHT_BROWSERS_PATH or the
// default Playwright browser cache — no other setup. Spins up its own
// static file server over the repo root and tears it down when done, so
// there's nothing to start by hand first.
//
// TO ADD A NEW TEST: drop a new `<name>.test.js` file in this directory
// exporting `module.exports = async function run(context, baseUrl) { ... }`
// that returns a suite from helpers/test-kit.js's makeSuite(). It's picked
// up automatically — nothing else to register.
const fs = require('fs');
const path = require('path');
const { loadPlaywright } = require('./helpers/load-playwright');
const { startStaticServer } = require('./helpers/static-server');
const { installCdnMirror } = require('./helpers/cdn-mirror');

async function main() {
  const filterArg = process.argv[2];
  const testsDir = __dirname;
  const repoRoot = path.resolve(__dirname, '..');

  let testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js')).sort();
  if (filterArg) testFiles = testFiles.filter(f => f.includes(filterArg));
  if (!testFiles.length) {
    console.error('No matching *.test.js files found in ' + testsDir + (filterArg ? ' matching "' + filterArg + '"' : ''));
    process.exit(1);
  }

  const { chromium } = loadPlaywright();
  const { server, port } = await startStaticServer(repoRoot);
  const baseUrl = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  const allSuites = [];
  try {
    for (const file of testFiles) {
      const runTest = require(path.join(testsDir, file));
      const context = await browser.newContext();
      // TEST-ONLY: index.html's real <script src="https://cdn.jsdelivr.net/...">
      // tags are left untouched; this only reroutes those specific requests
      // inside this Playwright context so the suite can run while jsdelivr
      // is blocked by the sandbox proxy. See tests/helpers/cdn-mirror.js.
      await installCdnMirror(context);
      let suite;
      try {
        suite = await runTest(context, baseUrl);
      } catch (e) {
        suite = { name: file, results: [{ desc: 'test file threw an uncaught error', pass: false, extra: e.stack || e.message }] };
      }
      await context.close();
      allSuites.push({ file, suite });
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  let totalPass = 0, totalFail = 0;
  console.log('\n=== Friendship Hospital HIS — Regression Suite ===\n');
  for (const { file, suite } of allSuites) {
    console.log('-- ' + file + ' (' + (suite.name || file) + ') --');
    for (const r of (suite.results || [])) {
      const mark = r.pass ? 'PASS' : 'FAIL';
      if (r.pass) totalPass++; else totalFail++;
      console.log('  [' + mark + '] ' + r.desc + (r.extra ? '\n         ' + String(r.extra).split('\n').join('\n         ') : ''));
    }
    console.log('');
  }
  console.log(totalPass + ' passed, ' + totalFail + ' failed\n');
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Test runner crashed:', e); process.exit(1); });
