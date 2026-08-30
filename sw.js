/*
 * Ygeia — service worker.
 *
 * Cache-first for the app shell so the app opens instantly and works with no network.
 * Deliberately hand-written: Workbox would add a build step to an app whose entire point
 * is that it has none.
 *
 * Your health data is NOT here — it lives in IndexedDB and is never cached or transmitted.
 */

/*
 * Bump this to ship an update - the old cache is dropped on activate.
 *
 * There is no ASSET_VERSION constant to bump alongside it, whatever this comment used to
 * claim. The version is hand-written into every `?v=` query below, into index.html, and
 * into tests.html - around 140 places that must all agree, with nothing checking that they
 * do. Get one wrong and the only symptom shows up offline, weeks later. Phase 2's build
 * step replaces this with content hashes; until then, bump with:
 *
 *   sed -i 's/v=38/v=39/g' sw.js index.html tests.html
 *   sed -i 's/ygeia-v38/ygeia-v39/' sw.js
 */
const CACHE = 'ygeia-v38';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css?v=38',
  './js/util.js?v=38',
  './js/platform.js?v=38',
  './js/store.js?v=38',
  './js/auth.js?v=38',
  './js/domain.js?v=38',
  './js/domain-life.js?v=38',
  './js/domain-cut.js?v=38',
  './js/domain-study.js?v=38',
  './js/domain-rank.js?v=38',
  './js/domain-plan.js?v=38',
  './js/domain-insights.js?v=38',
  './js/domain-timeline.js?v=38',
  './js/domain-gaps.js?v=38',
  './js/domain-vitals.js?v=38',
  './js/domain-sound.js?v=38',
  './js/domain-load.js?v=38',
  './js/domain-notebook.js?v=38',
  './js/domain-features.js?v=38',
  './js/data-meals.js?v=38',
  './js/data-programs.js?v=38',
  './js/data-daily.js?v=38',
  './js/explain.js?v=38',
  './js/data-foods.js?v=38',
  './js/data-exercises.js?v=38',
  './js/ui.js?v=38',
  './js/charts.js?v=38',
  './js/map.js?v=38',
  './js/openfoodfacts.js?v=38',
  './js/food-parser.js?v=38',
  './js/ai-prompt.js?v=38',
  './js/ai-providers.js?v=38',
  './js/ai-vision.js?v=38',
  './js/ai-cloud.js?v=38',
  './js/places.js?v=38',
  './js/healthimport.js?v=38',
  './js/backup.js?v=38',
  './js/view-today.js?v=38',
  './js/view-food.js?v=38',
  './js/view-train.js?v=38',
  './js/view-study.js?v=38',
  './js/view-notebook.js?v=38',
  './js/view-features.js?v=38',
  './js/view-sound.js?v=38',
  './js/view-flashcards.js?v=38',
  './js/view-solve.js?v=38',
  './js/view-scandeck.js?v=38',
  './js/view-aikey.js?v=38',
  './js/view-calendar.js?v=38',
  './js/view-coach.js?v=38',
  './js/view-body.js?v=38',
  './js/view-cut.js?v=38',
  './js/view-plan.js?v=38',
  './js/view-lock.js?v=38',
  './js/view-onboard.js?v=38',
  './js/view-settings.js?v=38',
  './js/app.js?v=38',
  './icons/icon.svg',
  './icons/icon-180.png',
  // Referenced by manifest.webmanifest — without these the install prompt and the
  // splash screen have no icon when offline.
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

/*
 * The core of the shell — the files without which the app cannot boot at all.
 *
 * These are required to install. Everything else in SHELL is best-effort: a missing chart
 * module or icon degrades one screen, whereas a missing store.js is a blank page.
 */
const REQUIRED = ['./', './index.html', './css/app.css?v=38', './js/util.js?v=38',
  './js/store.js?v=38', './js/ui.js?v=38', './js/app.js?v=38'];

self.addEventListener('install', (event) => {
  /*
   * addAll is atomic but all-or-nothing: one 404 anywhere would reject the whole install and
   * leave no cache at all. So each file is added individually — but the results are no longer
   * discarded.
   *
   * They used to be. Every failure was swallowed, the install "succeeded" regardless,
   * skipWaiting() fired, and activate then deleted the previous cache. A network that flaked
   * partway through those parallel adds therefore replaced a complete offline app with a
   * partial one, unrecoverably, and the user found out the next time they opened it on a
   * train. Now a failure among the files that actually matter fails the install, which
   * leaves the old worker and its intact cache in place — exactly the right outcome.
   */
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const failed = [];
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => { failed.push(url); })));

      const missingCore = failed.filter((url) => REQUIRED.includes(url));
      if (missingCore.length) {
        // Do not leave a half-populated cache behind for the next install to find.
        await caches.delete(CACHE);
        throw new Error('Incomplete precache, keeping the previous version: ' + missingCore.join(', '));
      }

      if (failed.length) console.warn('[Ygeia sw] optional assets not cached:', failed);
      return self.skipWaiting();
    }),
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

  /*
   * Compare absolute URLs, not hand-built relative paths.
   *
   * This used to do `'./' + pathname.replace(/^\//, '')`, which only ever matches when the
   * app is served from the root of its origin. On GitHub Pages — the deployment the README
   * actually documents — the pathname is `/ygeia/js/data-foods.js`, so the computed key was
   * `./ygeia/js/data-foods.js` and never equalled the `./js/data-foods.js` the page sends.
   * The eviction silently did nothing there, and the feature switches quietly stopped
   * shrinking the offline cache.
   *
   * Resolving both sides against the registration scope makes it correct at any depth.
   */
  const skip = new Set(msg.skip.map((p) => new URL(p, self.registration.scope).href));

  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const keys = await cache.keys();
      for (const req of keys) {
        // Match on the path alone; cached entries carry a ?v= query the caller does not.
        const url = new URL(req.url);
        if (skip.has(url.origin + url.pathname)) await cache.delete(req);
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
        /*
         * Fail as a failure.
         *
         * This used to fall back to `caches.match('./index.html')`, which answered a missing
         * *script* with the HTML shell. Classic <script> tags do not enforce MIME type, so
         * the browser parsed `<!doctype html>` as JavaScript, threw a SyntaxError, and left
         * that module's globals undefined — turning one absent file into an app that boots
         * into a broken half-state. The navigation branch above still falls back to the
         * shell, which is the only place that fallback makes sense.
         */
        .catch(() => new Response('', { status: 504, statusText: 'Offline' }));
    }),
  );
});
