/**
 * Service worker.
 *
 * Deliberately modest for v1: it caches the app shell so the app opens instantly and
 * still opens on a bad connection. It does NOT cache API responses and it does NOT
 * queue writes offline — logging a food while offline would fail, and pretending
 * otherwise (showing it as saved when it isn't) would be worse than failing.
 *
 * The shell cache is versioned. Bump SHELL_CACHE on any change to this file.
 */
const SHELL_CACHE = 'health-shell-v1';

// Only the entry point is precached by name. Hashed asset files are picked up as
// they are requested, so a deploy never needs this list updated.
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Not addAll: one 404 must not abort the whole install.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API calls always go to the network. Serving a stale summary would show
  // yesterday's numbers as though they were today's.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first, falling back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Static assets: cache first. Vite hashes their filenames, so a cached hit is
  // always the right version — a new build requests new names.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
