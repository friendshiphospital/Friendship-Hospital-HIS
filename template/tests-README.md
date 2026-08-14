# Regression suite

Committed Playwright tests for Friendship Hospital HIS. This replaces the
throwaway, hand-written-per-session Playwright scripts this project used
before — same underlying technique (a mocked `window.supabase` client
injected via `page.addInitScript`, served over a local static file server),
but committed, structured, and runnable with one command instead of
reconstructed from scratch each time.

## Running

```bash
node tests/run.js
```

Runs every `*.test.js` file in this directory and exits non-zero if
anything fails. Filter to one or more files by substring:

```bash
node tests/run.js auth-role     # just auth-role-access.test.js
```

No `npm install` step — this project has no build tooling or package.json
by design (see the repo's `CLAUDE.md`), and the suite follows that: it
needs only a Playwright install and a Chromium build, found via
`tests/helpers/load-playwright.js`:

1. `PLAYWRIGHT_MODULE_PATH` env var, if set (explicit override).
2. A normal `require('playwright')` resolution (works if it's a
   `devDependency`, or installed globally with `NODE_PATH` pointing at it).
3. This project's sandbox dev environment's known global install path,
   as a last resort.

Chromium itself is found via Playwright's own `PLAYWRIGHT_BROWSERS_PATH`
resolution — no explicit `executablePath` is hardcoded anywhere in this
suite, so it should run unmodified in any environment with a normal
Playwright + browser install.

## What's covered

Four areas, chosen because each has had a real, previously-shipped bug in
this project's history:

- **`auth-role-access.test.js`** — the `loadProfile()` admin-fallback bug
  (a missing/errored staff lookup must never grant `admin`), plus
  `goPage()`'s `ROLE_PAGES` enforcement.
- **`id-generation.test.js`** — `getNextNumber()`'s `generate_next_id()` RPC
  path, its client-side self-healing fallback, optimistic-concurrency retry
  on a write collision, and the fully-offline temporary-number path.
- **`result-verify-lock.test.js`** — `releaseResults()` refusing to release
  an unverified result, and `applyResultLock()`/`canOverrideResultLock()`
  locking result-entry fields once verified/released, with an
  admin/lab_supervisor-only override.
- **`launcher-tiles.test.js`** — the module launcher's role-filtered tile
  visibility (`visibleModulesForRole()`, `renderLauncher()`, `enterModule()`).

This is a starting set, not full coverage — see "Adding a test" below to
extend it.

## Adding a test

Drop a new `<name>.test.js` file in this directory exporting:

```js
const { makeSuite } = require('./helpers/test-kit');

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('my-suite-name');
  const page = await context.newPage();
  // ... addInitScript for a Supabase mock if needed, page.goto(baseUrl + '/index.html'), assertions ...
  t.check('description of what should be true', someBooleanCondition);
  await page.close();
  return t;
};
```

`tests/run.js` picks it up automatically — nothing else to register. Use a
fresh `context.newPage()` per distinct mock scenario within a file rather
than reusing one page across differently-mocked logins: `addInitScript`
calls accumulate on a page across navigations, so mixing scenarios on one
page silently runs every scenario's init script on every `goto`.

### Helpers

- **`helpers/chainable-mock.js`** — the shared mock `sb.from(table)` query
  builder, as a literal source string (spliced into each test's
  `addInitScript` string, since the browser page can't `require()` a real
  Node module). Reuse this instead of writing a new one — an earlier ad hoc
  version of this exact mock had a real bug where `.update(payload)`
  resolved before `.eq(...)` was chained onto it, silently applying updates
  to every row instead of just the matched one.
- **`helpers/static-server.js`** — a dependency-free static file server
  over the repo root, started and stopped by `run.js` automatically.
- **`helpers/load-playwright.js`** — portable Playwright module resolution
  (see "Running" above).
- **`helpers/test-kit.js`** — the `makeSuite()` assertion collector.

### Notes for writing new mocks

- Match the exact `sb.from(table).select(...).eq(...)....` chain the real
  `index.html` code calls for whatever you're testing — `chainable()`
  supports `.eq/.in/.or/.not/.order/.limit/.gte/.lte/.neq/.select` before
  resolving via `.then()/.single()/.maybeSingle()`. For a table needing
  custom `.insert()`/`.update()` behaviour (recording what was written,
  simulating a collision, etc.), override just that method on the object
  `chainable()` returns rather than writing a whole new mock.
- Prefer testing pure functions (no `sb` involved) without any Supabase
  mock at all when possible — see `launcher-tiles.test.js`, which just sets
  `currentProfile` directly. Simpler and faster than mocking a client that
  isn't actually needed.
