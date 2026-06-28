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

  // Stale-while-revalidate for everything else (the app HTML itself, fonts, the Supabase JS lib)
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
