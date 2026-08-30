/*
 * Ygeia — service worker.
 *
 * Cache-first for the app shell so the app opens instantly and works with no network.
 * Deliberately hand-written: Workbox would add a build step to an app whose entire point
 * is that it has none.
 *
 * Your health data is NOT here — it lives in IndexedDB and is never cached or transmitted.
 */

// Bump this to ship an update — the old cache is dropped on activate.
// Bump ASSET_VERSION in index.html and here together when shipping a change.
const CACHE = 'ygeia-v37';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css?v=37',
  './js/util.js?v=37',
  './js/store.js?v=37',
  './js/auth.js?v=37',
  './js/domain.js?v=37',
  './js/domain-life.js?v=37',
  './js/domain-cut.js?v=37',
  './js/domain-study.js?v=37',
  './js/domain-rank.js?v=37',
  './js/domain-plan.js?v=37',
  './js/domain-insights.js?v=37',
  './js/domain-timeline.js?v=37',
  './js/domain-gaps.js?v=37',
  './js/domain-vitals.js?v=37',
  './js/domain-sound.js?v=37',
  './js/domain-load.js?v=37',
  './js/domain-notebook.js?v=37',
  './js/domain-features.js?v=37',
  './js/data-meals.js?v=37',
  './js/data-programs.js?v=37',
  './js/data-daily.js?v=37',
  './js/explain.js?v=37',
  './js/data-foods.js?v=37',
  './js/data-exercises.js?v=37',
  './js/ui.js?v=37',
  './js/charts.js?v=37',
  './js/map.js?v=37',
  './js/openfoodfacts.js?v=37',
  './js/food-parser.js?v=37',
  './js/ai-prompt.js?v=37',
  './js/ai-providers.js?v=37',
  './js/ai-vision.js?v=37',
  './js/ai-cloud.js?v=37',
  './js/places.js?v=37',
  './js/healthimport.js?v=37',
  './js/backup.js?v=37',
  './js/view-today.js?v=37',
  './js/view-food.js?v=37',
  './js/view-train.js?v=37',
  './js/view-study.js?v=37',
  './js/view-notebook.js?v=37',
  './js/view-features.js?v=37',
  './js/view-sound.js?v=37',
  './js/view-flashcards.js?v=37',
  './js/view-solve.js?v=37',
  './js/view-scandeck.js?v=37',
  './js/view-aikey.js?v=37',
  './js/view-calendar.js?v=37',
  './js/view-coach.js?v=37',
  './js/view-body.js?v=37',
  './js/view-cut.js?v=37',
  './js/view-plan.js?v=37',
  './js/view-lock.js?v=37',
  './js/view-onboard.js?v=37',
  './js/view-settings.js?v=37',
  './js/app.js?v=37',
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

/*
 * Feature choices, sent by the page.
 *
 * The worker cannot read the user's settings — those live in IndexedDB behind the app's
 * own schema, and duplicating that here would be a second source of truth to keep in
 * step. So the page computes which data files are unwanted and tells us, and we drop
 * them from the cache. Turning a feature back on re-fetches its files on next use and
 * the cache-first handler stores them again from then on.
 *
 * Install still caches everything: on a first run there is no page to ask yet, and a
 * complete offline app is the safer default to start from.
 */
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'setFeatures' || !Array.isArray(msg.skip)) return;

  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const keys = await cache.keys();
      for (const req of keys) {
        const path = './' + new URL(req.url).pathname.replace(/^\//, '');
        // Match on the path alone; cached entries carry a ?v= query the caller does not.
        if (msg.skip.includes(path)) await cache.delete(req);
      }
    }),
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

  // Open Food Facts lookups must always hit the network and are never cached — a stale
  // food database is worse than no result, and caching third-party responses would grow
  // unbounded.
  if (url.origin !== self.location.origin) return;

  /*
   * Navigations and the HTML shell are NETWORK-FIRST.
   *
   * Cache-first on index.html meant every update took two loads to appear: the first
   * served the stale shell, and only the background refresh made the next one current.
   * For a page whose whole job is to list the current script tags, that is the wrong
   * trade — it looks exactly like "my changes did nothing". The network is tried first
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
