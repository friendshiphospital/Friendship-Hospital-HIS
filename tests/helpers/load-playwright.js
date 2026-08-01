// Locates a usable Playwright install without assuming one exact layout.
// Tries, in order: an explicit override (PLAYWRIGHT_MODULE_PATH), then a
// normal `require('playwright')` resolution (works if it's a devDependency
// or globally installed with NODE_PATH set), then this project's sandbox
// dev environment's known global install path. Add more fallback paths
// here rather than hardcoding one path directly in every test file.
function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_PATH,
    'playwright',
    '/opt/node22/lib/node_modules/playwright',
  ].filter(Boolean);

  let lastErr;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    'Could not load the "playwright" module (tried: ' + candidates.join(', ') + ').\n' +
    'Install it with `npm i -D playwright`, or set PLAYWRIGHT_MODULE_PATH to its install location.\n' +
    'Underlying error: ' + lastErr.message
  );
}

module.exports = { loadPlaywright };
