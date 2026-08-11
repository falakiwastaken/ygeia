/*
 * Ygeia — service worker.
 *
 * Cache-first for the app shell so the app opens instantly and works with no network.
 * Deliberately hand-written: Workbox would add a build step to an app whose entire point
 * is that it has none.
 *
 * Your health data is NOT here — it lives in IndexedDB and is never cached or transmitted.
 */

// Bump this to ship an update — the old cache is dropped on activate.
// Bump ASSET_VERSION in index.html and here together when shipping a change.
const CACHE = 'ygeia-v13';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css?v=13',
  './js/util.js?v=13',
  './js/store.js?v=13',
  './js/auth.js?v=13',
  './js/domain.js?v=13',
  './js/domain-life.js?v=13',
  './js/domain-cut.js?v=13',
  './js/domain-study.js?v=13',
  './js/domain-rank.js?v=13',
  './js/domain-plan.js?v=13',
  './js/domain-insights.js?v=13',
  './js/domain-timeline.js?v=13',
  './js/data-meals.js?v=13',
  './js/data-programs.js?v=13',
  './js/explain.js?v=13',
  './js/data-foods.js?v=13',
  './js/data-exercises.js?v=13',
  './js/ui.js?v=13',
  './js/charts.js?v=13',
  './js/map.js?v=13',
  './js/openfoodfacts.js?v=13',
  './js/food-parser.js?v=13',
  './js/ai-vision.js?v=13',
  './js/ai-local.js?v=13',
  './js/places.js?v=13',
  './js/healthimport.js?v=13',
  './js/backup.js?v=13',
  './js/view-today.js?v=13',
  './js/view-food.js?v=13',
  './js/view-train.js?v=13',
  './js/view-study.js?v=13',
  './js/view-flashcards.js?v=13',
  './js/view-solve.js?v=13',
  './js/view-calendar.js?v=13',
  './js/view-coach.js?v=13',
  './js/view-body.js?v=13',
  './js/view-cut.js?v=13',
  './js/view-plan.js?v=13',
  './js/view-lock.js?v=13',
  './js/view-settings.js?v=13',
  './js/app.js?v=13',
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

  /*
   * Navigations and the HTML shell are NETWORK-FIRST.
   *
   * Cache-first on index.html meant every update took two loads to appear: the first
   * served the stale shell, and only the background refresh made the next one current.
   * For a page whose whole job is to list the current script tags, that is the wrong
   * trade — it looks exactly like "my changes did nothing". The network is tried first
   * and the cache is the offline fallback.
   */
  const isShell = req.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html');

  if (isShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html'))),
    );
    return;
  }

  // Everything else stays cache-first: scripts and styles are cheap to revalidate in the
  // background, and serving them instantly is what makes the app feel native offline.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
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
