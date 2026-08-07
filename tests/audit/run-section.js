#!/usr/bin/env node
// Runs a single audit/*.audit.js file against the real app in a real
// browser and prints its findings as JSON, for the functional audit.
const path = require('path');
const { loadPlaywright } = require('../helpers/load-playwright');
const { startStaticServer } = require('../helpers/static-server');

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node run-section.js <audit-file.js>'); process.exit(1); }
  const repoRoot = path.resolve(__dirname, '../..');
  const { chromium } = loadPlaywright();
  const { server, port } = await startStaticServer(repoRoot);
  const baseUrl = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext();
  let findings;
  try {
    const runFn = require(path.resolve(file));
    findings = await runFn(context, baseUrl);
  } catch (e) {
    findings = [{ section: 'RUNNER', status: 'FAIL', detail: 'Audit script threw: ' + (e.stack || e.message) }];
  } finally {
    await context.close();
    await browser.close();
    await new Promise(r => server.close(r));
  }
  console.log(JSON.stringify(findings, null, 2));
}
main();
