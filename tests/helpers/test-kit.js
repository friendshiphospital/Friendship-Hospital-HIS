// Tiny shared assertion collector — deliberately not a real test framework
// (no npm dependency to add for a one-file-per-scenario suite like this).
// Each *.test.js file creates one suite, calls .check(desc, condition) for
// every assertion, and returns the suite for tests/run.js to aggregate.
function makeSuite(name) {
  const results = [];
  return {
    name,
    results,
    check(desc, condition, extra) {
      results.push({ desc, pass: !!condition, extra });
    },
  };
}

module.exports = { makeSuite };
