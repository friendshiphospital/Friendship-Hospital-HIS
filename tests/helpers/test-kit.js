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

// Strips HTML tags from innerHTML pulled out of the page for test
// assertions/report strings. A single-pass /<[^>]+>/g replace is an
// incomplete sanitizer (CodeQL js/incomplete-multi-character-sanitization)
// -- e.g. "<<script>script>" loses its inner "<script>" in one pass but
// still leaves "<script>" behind. Looping to a fixed point closes that gap.
// `replacement` defaults to '' for plain display strings; callers matching
// against adjacent table cells pass ' ' so cell boundaries don't collapse
// two words together (e.g. "<td>12</td><td>kits</td>" -> "12 kits", not
// "12kits"). Test-only string handling (never rendered as HTML), but cheap
// to do right.
function stripTags(html, replacement) {
  const rep = replacement === undefined ? '' : replacement;
  let prev, out = String(html || '');
  do { prev = out; out = prev.replace(/<[^>]*>/g, rep); } while (out !== prev);
  return out;
}

module.exports = { makeSuite, stripTags };
