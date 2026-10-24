// sw.js: service worker for the web version of EASY Manager (the copy
// EASY Suite serves at /wp-content/plugins/easy-suite/app/). The
// Android app never registers it.
//
// Network first for the app's own files, always revalidating so a new
// Suite publish shows up on the next open instead of waiting on a
// server or browser cache. The last good copy is kept so the app still
// opens with no signal. Site data (/wp-json) is never touched here; the
// app keeps its own last-good copies of that.
const CACHE = 'easy-manager-app';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const scope = new URL(self.registration.scope);
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  // A navigation request cannot be re-issued with options, so fetch its
  // URL instead.
  const fresh = req.mode === 'navigate'
    ? fetch(url.href, { cache: 'no-cache', credentials: 'omit' })
    : fetch(req, { cache: 'no-cache' });

  event.respondWith(
    fresh
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error())
      )
  );
});
