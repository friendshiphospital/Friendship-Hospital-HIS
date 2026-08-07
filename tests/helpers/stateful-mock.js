// A genuinely stateful, generic in-memory Supabase mock for the full
// functional audit (real Playwright browser interaction across a whole
// workflow -- register a patient, place an order, enter a result, verify --
// rather than the single-call-per-test chainable mocks used by the regular
// regression suite in tests/*.test.js). Injected into the page the same way
// (spliced as literal source into page.addInitScript()), but unlike
// CHAINABLE_MOCK_SRC this one keeps real per-table arrays in memory for the
// lifetime of the page, so writes made by one action are visible to the
// next read -- the whole point of "test by doing" instead of re-reading code.
//
// Not exhaustive Postgrest semantics -- covers what this app's queries
// actually use (seen by grepping index.html): eq/neq/gt/gte/lt/lte/like/
// ilike/in/is/not/or (simple "col.op.val,col.op.val" form), order, limit,
// single/maybeSingle, insert/update/upsert/delete, and a best-effort
// one-level embedded-select resolver (e.g. "*,patients(name,mrn,ward)").
const STATEFUL_MOCK_SRC = `
function makeStatefulSupabaseMock(seed) {
  const db = {};
  Object.keys(seed?.tables || {}).forEach(t => { db[t] = (seed.tables[t] || []).map(r => ({...r})); });
  function table(name) { if (!db[name]) db[name] = []; return db[name]; }
  let idCounter = 1;
  function genId() { return 'mock-' + (idCounter++) + '-' + Math.random().toString(36).slice(2, 8); }

  function coerce(v) { return v === undefined ? null : v; }
  function likeToRegex(pattern, ci) {
    const esc = String(pattern).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp('^' + esc + '$', ci ? 'i' : '');
  }
  function applyOp(val, op, target) {
    val = coerce(val);
    switch (op) {
      case 'eq': return val === target;
      case 'neq': return val !== target;
      case 'gt': return val != null && val > target;
      case 'gte': return val != null && val >= target;
      case 'lt': return val != null && val < target;
      case 'lte': return val != null && val <= target;
      case 'like': return likeToRegex(target, false).test(String(val ?? ''));
      case 'ilike': return likeToRegex(target, true).test(String(val ?? ''));
      case 'in': return Array.isArray(target) && target.includes(val);
      case 'is': return target === null ? (val === null || val === undefined) : val === target;
      default: return true;
    }
  }
  function rowMatches(row, filters) {
    return filters.every(f => {
      if (f.op === 'or') {
        return f.clauses.some(c => applyOp(row[c.col], c.op, c.val));
      }
      if (f.op === 'not_is_null') return row[f.col] !== null && row[f.col] !== undefined;
      return applyOp(row[f.col], f.op, f.val);
    });
  }
  function parseOrExpr(expr) {
    // e.g. "name.ilike.%foo%,mrn.ilike.%foo%"
    return expr.split(',').map(part => {
      const m = part.match(/^([a-zA-Z0-9_]+)\\.(eq|neq|gt|gte|lt|lte|like|ilike|is)\\.(.*)$/);
      if (!m) return { col: '__never__', op: 'eq', val: '__nomatch__' };
      let [, col, op, val] = m;
      if (val === 'null') val = null;
      return { col, op, val };
    });
  }
  function resolveEmbeds(row, selectStr) {
    if (!selectStr || selectStr === '*' || !selectStr.includes('(')) return row;
    const out = { ...row };
    const embedRe = /([a-zA-Z0-9_]+)\\(([^)]*)\\)/g;
    let m;
    while ((m = embedRe.exec(selectStr))) {
      const [, rel] = m;
      // Best-effort: assume rel is a table name and row has a <rel-singular>_id
      // or the relation table has a *_id pointing back to this row's id.
      const relTable = table(rel);
      const fkGuess = rel.replace(/s$/, '') + '_id';
      let related = null;
      if (row[fkGuess] != null) related = relTable.find(r => r.id === row[fkGuess]);
      else if (row.patient_id != null && rel === 'patients') related = table('patients').find(r => r.id === row.patient_id);
      out[rel] = related || null;
    }
    return out;
  }

  function builder(name) {
    let filters = [];
    let orderCol = null, orderAsc = true, limitN = null;
    let selectStr = '*';
    let mode = 'select';
    let payload = null;
    let onConflict = null;
    let wantCount = false, wantHead = false;

    const api = {
      // opts.count (e.g. {count:'exact'}, optionally with head:true) -- the
      // app uses this Postgrest pattern ~27x (checkCriticals()'s crit-badge,
      // dashboard KPI tiles, etc.) to get a row count without necessarily
      // fetching all the rows. head:true is honoured by returning data:null
      // (matching real Supabase/Postgrest HEAD-request semantics) while
      // count is still computed from the full (pre-limit) filtered set.
      select(cols, opts) { selectStr = cols || '*'; if (opts && opts.count) { wantCount = true; wantHead = !!opts.head; } return api; },
      insert(p) { mode = 'insert'; payload = Array.isArray(p) ? p : [p]; return api; },
      update(p) { mode = 'update'; payload = p; return api; },
      upsert(p, opts) { mode = 'upsert'; payload = Array.isArray(p) ? p : [p]; onConflict = opts && opts.onConflict; return api; },
      delete() { mode = 'delete'; return api; },
      eq(col, val) { filters.push({ col, op: 'eq', val }); return api; },
      neq(col, val) { filters.push({ col, op: 'neq', val }); return api; },
      gt(col, val) { filters.push({ col, op: 'gt', val }); return api; },
      gte(col, val) { filters.push({ col, op: 'gte', val }); return api; },
      lt(col, val) { filters.push({ col, op: 'lt', val }); return api; },
      lte(col, val) { filters.push({ col, op: 'lte', val }); return api; },
      like(col, val) { filters.push({ col, op: 'like', val }); return api; },
      ilike(col, val) { filters.push({ col, op: 'ilike', val }); return api; },
      in(col, vals) { filters.push({ col, op: 'in', val: vals }); return api; },
      is(col, val) { filters.push({ col, op: 'is', val }); return api; },
      not(col, _op, val) { filters.push({ col, op: 'not_is_null', val }); return api; },
      or(expr) { filters.push({ op: 'or', clauses: parseOrExpr(expr) }); return api; },
      // .match({col: val, ...}) -- Postgrest shorthand for a batch of eq()
      // filters in one call. Added because the app's own dbWrite() (the
      // universal offline-resilient write path documented in CLAUDE.md)
      // always builds its 'update' ops as .update(payload).match(opts.match),
      // so any section exercising a real dbWrite() update needs this to
      // reach the underlying rows at all.
      match(obj) { Object.entries(obj || {}).forEach(([col, val]) => filters.push({ col, op: 'eq', val })); return api; },
      order(col, opts) { orderCol = col; orderAsc = !(opts && opts.ascending === false); return api; },
      limit(n) { limitN = n; return api; },
      then(resolve, reject) { return execute().then(resolve, reject); },
      single() { return execute().then(r => (r.data && r.data.length ? { data: r.data[0], error: null } : { data: null, error: { message: 'No rows found' } })); },
      maybeSingle() { return execute().then(r => ({ data: r.data && r.data.length ? r.data[0] : null, error: null })); },
    };

    async function execute() {
      const t = table(name);
      if (mode === 'insert') {
        const inserted = payload.map(p => {
          const row = { ...p };
          if (row.id == null) row.id = genId();
          if (row.created_at == null) row.created_at = new Date().toISOString();
          t.push(row);
          return row;
        });
        return { data: inserted, error: null };
      }
      if (mode === 'upsert') {
        const conflictCols = (onConflict || 'id').split(',');
        const results = payload.map(p => {
          let existing = t.find(row => conflictCols.every(c => row[c] === p[c]));
          if (existing) { Object.assign(existing, p); return existing; }
          const row = { ...p };
          if (row.id == null) row.id = genId();
          if (row.created_at == null) row.created_at = new Date().toISOString();
          t.push(row);
          return row;
        });
        return { data: results, error: null };
      }
      let rows = t.filter(row => rowMatches(row, filters));
      if (mode === 'update') {
        rows.forEach(row => Object.assign(row, payload));
        return { data: rows, error: null };
      }
      if (mode === 'delete') {
        rows.forEach(row => { const idx = t.indexOf(row); if (idx >= 0) t.splice(idx, 1); });
        return { data: rows, error: null };
      }
      if (orderCol) {
        rows = rows.slice().sort((a, b) => {
          const av = a[orderCol], bv = b[orderCol];
          if (av == null && bv == null) return 0;
          if (av == null) return orderAsc ? -1 : 1;
          if (bv == null) return orderAsc ? 1 : -1;
          if (av < bv) return orderAsc ? -1 : 1;
          if (av > bv) return orderAsc ? 1 : -1;
          return 0;
        });
      }
      const exactCount = wantCount ? rows.length : null; // pre-limit, matching Postgrest's count:'exact'
      if (limitN != null) rows = rows.slice(0, limitN);
      rows = rows.map(r => resolveEmbeds(r, selectStr));
      return { data: wantHead ? null : rows, error: null, count: exactCount };
    }
    return api;
  }

  // generate_next_id RPC: mirrors the real optimistic-concurrency counter,
  // using id_counters + ID_START-equivalent seed values passed in.
  async function rpc(fnName, args) {
    if (fnName === 'generate_next_id') {
      const idType = args.id_type;
      const startSeed = (seed.idStart && seed.idStart[idType] != null) ? seed.idStart[idType] : 0;
      const counters = table('id_counters');
      let row = counters.find(r => r.counter_name === idType);
      if (!row) { row = { id: genId(), counter_name: idType, current_value: startSeed }; counters.push(row); }
      row.current_value = row.current_value + 1;
      return { data: String(row.current_value), error: null };
    }
    if (seed.rpcHandlers && seed.rpcHandlers[fnName]) {
      return seed.rpcHandlers[fnName](args, db);
    }
    return { data: null, error: null };
  }

  let currentAuthUser = seed.authUser || null;
  const auth = {
    async signInWithPassword({ email, password }) {
      const user = (seed.users || []).find(u => u.email === email && (u.password === undefined || u.password === password));
      if (!user) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
      currentAuthUser = { id: user.id, email: user.email };
      return { data: { user: currentAuthUser, session: { user: currentAuthUser } }, error: null };
    },
    async getSession() { return { data: { session: currentAuthUser ? { user: currentAuthUser } : null } }; },
    async signOut() { currentAuthUser = null; return { error: null }; },
  };

  return {
    from: builder,
    rpc,
    auth,
    functions: { invoke: async (name, opts) => (seed.functionHandlers && seed.functionHandlers[name]) ? seed.functionHandlers[name](opts, db) : { data: { ok: true }, error: null } },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
    __db: db,
  };
}
`;

module.exports = { STATEFUL_MOCK_SRC };
