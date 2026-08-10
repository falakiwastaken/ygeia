/*
 * Vitals — service worker.
 *
 * Cache-first for the app shell so the app opens instantly and works with no network.
 * Deliberately hand-written: Workbox would add a build step to an app whose entire point
 * is that it has none.
 *
 * Your health data is NOT here — it lives in IndexedDB and is never cached or transmitted.
 */

const CACHE = 'vitals-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/util.js',
  './js/store.js',
  './js/domain.js',
  './js/data-foods.js',
  './js/data-exercises.js',
  './js/ui.js',
  './js/charts.js',
  './js/openfoodfacts.js',
  './js/healthimport.js',
  './js/view-today.js',
  './js/view-food.js',
  './js/view-train.js',
  './js/view-body.js',
  './js/view-settings.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic: one 404 would reject the whole install and leave no cache at
      // all, so each file is added individually and failures are tolerated.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Open Food Facts lookups must always hit the network and are never cached — a stale
  // food database is worse than no result, and caching third-party responses would grow
  // unbounded.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Refresh in the background so the next launch gets the newer file.
        fetch(req)
          .then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          })
          .catch(() => {});
        return cached;
      }

      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});
