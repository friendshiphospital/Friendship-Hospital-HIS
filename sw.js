// ═══════════════════════════════════════════════════════════════
// Friendship Hospital HIS — Service Worker
// Caches the app shell (HTML + Supabase JS client) so the app
// LOADS even with zero internet connection. Does NOT cache
// Supabase API calls — those are handled by the offline write
// queue inside the main app.
// ═══════════════════════════════════════════════════════════════

const CACHE_VERSION = 'fh-his-shell-v1';
const PRECACHE_URLS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {}) // don't block install if a CDN resource is briefly unreachable
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests — never intercept writes
  if (req.method !== 'GET') return;

  // Never cache Supabase API traffic — that goes through the app's own offline queue
  if (req.url.includes('supabase.co')) return;

  // The app shell (index.html) changes on every deploy, and it's a single
  // file with no versioned filename/build hash to bust the cache with. A
  // stale-while-revalidate strategy always serves whatever was cached from
  // the PREVIOUS load first, updating the cache only for next time — so a
  // deployed fix could appear "still broken" no matter how many times staff
  // reload, because the fetch handler here returns the cached response
  // before the browser's own reload/cache-busting semantics ever come into
  // play (a hard refresh still goes through this same handler). Go
  // network-first for navigations so a normal reload always gets the
  // latest deployed code when online, falling back to the cached shell only
  // when the network genuinely fails — which is this worker's actual job
  // (offline load), not silently pinning everyone one deploy behind.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => caches.open(CACHE_VERSION).then((cache) => cache.match(req)))
    );
    return;
  }

  // Stale-while-revalidate for everything else (fonts, the Supabase JS lib) —
  // these are versioned/CDN-pinned or rarely change, so serving a cached
  // copy immediately while quietly refreshing it in the background is safe.
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached); // network failed entirely -> serve whatever we have cached
      return cached || networkFetch;
    })
  );
});
