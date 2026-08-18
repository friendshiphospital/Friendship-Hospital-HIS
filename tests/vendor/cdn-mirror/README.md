# cdn-mirror — TEST-ONLY vendored copies of index.html's CDN scripts

## Why this directory exists

`index.html` loads three libraries straight from `cdn.jsdelivr.net` (see the
`<script src=...>` tags near the top of the file):

- `@supabase/supabase-js@2` → `dist/umd/supabase.js`
- `jsbarcode@3.11.5` → `dist/JsBarcode.all.min.js`
- `html5-qrcode@2.3.8` → `html5-qrcode.min.js`

As of **2026-08-18**, this sandbox's outbound proxy started rejecting every
`CONNECT` to `cdn.jsdelivr.net:443` with a hard `403` ("gateway answered 403
to CONNECT (policy denial or upstream failure)") — confirmed live, reproducible,
and *not* an intermittent network blip: `registry.npmjs.org` (which is on the
proxy's allowlist) was reachable at the exact same moment. Since every
regression test loads a real `index.html` page in a real browser (only
`sb.from(...)` calls are mocked — see `helpers/chainable-mock.js` /
`helpers/stateful-mock.js`), the browser's page-`load` event can never fire
without these three scripts, and the entire suite hangs.

`tests/helpers/cdn-mirror.js` intercepts just those three specific CDN
requests with Playwright's `page.route()`/`context.route()` and serves the
files in this directory instead — **test harness only**. It does not touch
`index.html`, which still points at the real `cdn.jsdelivr.net` URLs and will
keep loading from the real CDN in production exactly as before. If a future
session is looking at this directory: this is not a real dependency and must
never be `import`ed or referenced from `index.html` itself. If the jsdelivr
block turns out to be permanent, that's a separate, deliberate decision for a
human to make (self-hosting these for production, switching CDNs, etc.) —
not something this directory silently does on its own.

## Version pinning — READ BEFORE UPDATING

Each file must stay byte-for-byte what jsdelivr would actually serve for
`index.html`'s current `<script src>` tag, or a "passing" test suite would be
validating a library version production doesn't run.

- `jsbarcode@3.11.5.all.min.js` and `html5-qrcode@2.3.8.min.js` pin to
  **exact** versions — index.html's CDN URLs hardcode `@3.11.5` / `@2.3.8`,
  so these are unambiguous.
- `supabase-js@2.112.3.umd.js` is different: index.html's CDN URL is
  `@supabase/supabase-js@2` (an **unpinned major-version tag**, not an exact
  version) — jsdelivr resolves that to whatever the latest published stable
  2.x release is *at request time*. There is no single "the" version; it
  floats. `2.112.3` was npm's `dist-tags.latest` for `@supabase/supabase-js`
  (highest non-prerelease 2.x release) as of 2026-08-18, which is what
  `@2` would have resolved to that day. **If supabase-js publishes a newer
  2.x release before this mirror is refreshed, this file will be behind
  what jsdelivr actually serves in production** — that drift is inherent to
  index.html using a floating tag, not a mistake in this mirror. Re-fetch
  periodically (see below), and if index.html is ever changed to pin an
  exact supabase-js version, update this comment and file to match exactly
  instead.

Every file here was downloaded straight from `registry.npmjs.org` (the
official npm CDN mirrors jsdelivr's own `npm/` namespace) and its SHA-1
verified against the registry's own `dist.shasum` for that exact version
before being copied in — same bytes jsdelivr would have served.

## Refreshing this mirror

```bash
# Look up the tarball URL + shasum for a package/version:
curl -sS https://registry.npmjs.org/<pkg>/<version>

# Download, verify, extract the same dist file jsdelivr serves, e.g.:
curl -sS -o /tmp/pkg.tgz https://registry.npmjs.org/<pkg>/-/<pkg>-<version>.tgz
sha1sum /tmp/pkg.tgz   # compare against dist.shasum from the metadata above
tar -xzf /tmp/pkg.tgz -C /tmp/pkg-extract
# copy the specific dist file this mirror needs, renamed to <pkg>@<version>...
```

Then update the filename (if the version changed) and the corresponding path
in `tests/helpers/cdn-mirror.js`.
