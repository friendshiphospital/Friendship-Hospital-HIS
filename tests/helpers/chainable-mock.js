// Shared mock-Supabase chainable query builder, spliced as literal source
// into each test's page.addInitScript() string. Playwright's addInitScript
// runs in the browser page's own context, not this Node process, so a real
// `require()` of a shared module isn't possible there — the same text has
// to be re-injected into every test that needs a mocked `sb.from(...)`.
//
// This exact shape (filters deferred until .then()/.single()/.maybeSingle()
// actually resolves the chain) matters: an earlier, naive version of this
// mock resolved .update(payload) immediately, before .eq(...) was even
// chained onto it, which silently applied updates to every row in the
// mocked table instead of just the matched one. Keep new tests building on
// this one instead of writing a fresh ad hoc mock per file.
const CHAINABLE_MOCK_SRC = `
function chainable(single, arr) {
  return {
    eq(){ return chainable(single, arr); },
    in(){ return chainable(single, arr); },
    or(){ return chainable(single, arr); },
    not(){ return chainable(single, arr); },
    order(){ return chainable(single, arr); },
    limit(){ return chainable(single, arr); },
    gte(){ return chainable(single, arr); },
    lte(){ return chainable(single, arr); },
    neq(){ return chainable(single, arr); },
    select(){ return chainable(single, arr); },
    maybeSingle(){ return Promise.resolve({ data: single, error: null }); },
    single(){ return Promise.resolve({ data: single, error: null }); },
    then(resolve){ return resolve({ data: arr, error: null }); },
    insert(){ return chainable(null, []); },
    update(){ return { eq: () => Promise.resolve({ data: null, error: null }) }; },
  };
}
`;

module.exports = { CHAINABLE_MOCK_SRC };
