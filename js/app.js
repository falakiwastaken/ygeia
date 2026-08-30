/*
 * Ygeia — bootstrap and router.
 *
 * Loaded last. Seeds the library on first run, wires navigation, and re-renders the
 * active view on demand. Views are plain objects with a render(container) method.
 */
(function (V) {
  'use strict';

  const app = {
    state: {
      date: V.today(),
      view: 'today',
    },
  };

  const VIEW_IDS = ['today', 'food', 'train', 'study', 'body', 'settings'];

  // ------------------------------------------------------------ rendering --

  /** Re-render the active view. Safe to call after any mutation. */
  app.render = async function () {
    const name = app.state.view;
    const container = V.$('#view-' + name);
    const view = V.views[name];
    if (!container || !view) return;

    try {
      const content = await view.render(app.state);
      container.innerHTML = '';
      container.appendChild(content);
    } catch (err) {
      console.error('[Ygeia] render failed:', err);
      container.innerHTML = '';
      container.appendChild(
        V.el('div', { className: 'card' }, [
          V.el('div', { className: 'card-title', text: 'Something went wrong' }),
          V.el('div', { className: 'hint', text: String(err && err.message ? err.message : err) }),
        ]),
      );
    }
    updateHeader();
  };

  /** Tabs currently switched on. Settings and Today are always present. */
  app.visibleTabs = function () {
    return V.features.visibleTabs(app.settings || {}, VIEW_IDS);
  };

  /**
   * Show or hide tabs to match the feature switches.
   *
   * Called after any change to them. If the tab the user is standing on has just been
   * switched off, they are moved to Today rather than left looking at a view that is no
   * longer reachable.
   */
  app.applyFeatures = async function () {
    app.settings = await V.store.settings.get();
    const visible = app.visibleTabs();

    for (const tab of V.$$('#tabbar .tab')) {
      tab.hidden = !visible.includes(tab.dataset.view);
    }
    if (!visible.includes(app.state.view)) app.go('today');

    // Tell the service worker which data files not to keep for offline use. Best effort:
    // if there is no worker (file://, or the very first load before it activates) the
    // app is unaffected — this only controls what is held in the offline cache.
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'setFeatures',
        skip: V.features.skippedPaths(app.settings),
      });
    }
  };

  app.go = function (name) {
    if (!VIEW_IDS.includes(name)) return;
    app.state.view = name;
    for (const id of VIEW_IDS) {
      V.$('#view-' + id).classList.toggle('active', id === name);
    }
    for (const tab of V.$$('#tabbar .tab')) {
      tab.classList.toggle('active', tab.dataset.view === name);
    }
    app.render();
  };

  app.setDate = function (dateKey) {
    // Logging into the future is almost always a mis-tap, and it corrupts streaks.
    if (dateKey > V.today()) return;
    app.state.date = dateKey;
    app.render();
  };

  function updateHeader() {
    V.$('#date-main').textContent = V.friendlyDate(app.state.date);
    const sub = V.$('#date-sub');
    sub.textContent = app.state.date === V.today() ? '' : V.longDate(app.state.date);
    // Nothing to navigate to beyond today.
    V.$('#btn-next-day').style.visibility = app.state.date >= V.today() ? 'hidden' : 'visible';
  }

  // --------------------------------------------------------------- theme ---

  app.applyTheme = async function () {
    const s = await V.store.settings.get();
    const root = document.documentElement;
    // Always set the attribute: the stylesheet's prefers-color-scheme rule is scoped to
    // [data-theme="auto"], so that "Auto" only follows the OS when explicitly chosen.
    root.setAttribute('data-theme', s.theme || 'light');

    // Keep the iOS status bar and Android chrome in step with the active palette.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#F6F2E8');
    }
  };

  // -------------------------------------------------------------- seeding --

  /**
   * Populate the bundled library on first run.
   *
   * Seed ids are derived from the item name, so `put` overwrites cleanly and re-running
   * this can never create duplicates. User-created foods and exercises are untouched
   * because their ids come from V.uid().
   */
  async function seedIfNeeded() {
    const [foodCount, exCount] = await Promise.all([
      V.store.db.count('foods'),
      V.store.db.count('exercises'),
    ]);

    if (foodCount === 0) await V.store.db.putMany('foods', V.seedFoods());
    if (exCount === 0) await V.store.db.putMany('exercises', V.seedExercises());
  }

  // ---------------------------------------------------------------- wiring --

  function wireChrome() {
    for (const tab of V.$$('#tabbar .tab')) {
      tab.addEventListener('click', () => {
        V.haptic();
        app.go(tab.dataset.view);
      });
    }

    V.$('#btn-prev-day').addEventListener('click', () => app.setDate(V.addDays(app.state.date, -1)));
    V.$('#btn-next-day').addEventListener('click', () => app.setDate(V.addDays(app.state.date, 1)));
    // The date in the header is the natural way into the calendar.
    V.$('#btn-date').addEventListener('click', () => V.calendar.open(app.state.date));

    V.$('#sheet-close').addEventListener('click', () => V.ui.closeSheet());

    /*
     * Tap-outside-to-close, without eating text selections.
     *
     * This cannot be done with a `click` listener. A click fires on the nearest common
     * ancestor of where the press started and where it ended — so highlighting a sentence
     * inside the sheet and releasing a few pixels past its edge produces a click whose
     * target is the backdrop, and the sheet closes, taking the selection with it. Anyone
     * trying to copy a number out of a sheet hit this every time.
     *
     * So the gesture has to both START and END on the dimmed area. A press that begins on
     * the sheet is a selection or a drag and is none of the backdrop's business; a press
     * that begins outside and wanders in is an aborted dismissal and should also do
     * nothing.
     */
    const backdrop = V.$('#sheet-backdrop');
    let pressStartedOnBackdrop = false;

    backdrop.addEventListener('pointerdown', (e) => {
      pressStartedOnBackdrop = e.target === backdrop;
    });
    backdrop.addEventListener('pointerup', (e) => {
      const dismiss = pressStartedOnBackdrop && e.target === backdrop;
      pressStartedOnBackdrop = false;
      if (dismiss) V.ui.closeSheet();
    });
    // A pointer that is cancelled (the browser taking over for a scroll or a system
    // gesture) never produces a pointerup, so the flag has to be cleared here too or the
    // next release anywhere on the backdrop would close a sheet the user never touched.
    backdrop.addEventListener('pointercancel', () => { pressStartedOnBackdrop = false; });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && V.ui.sheetOpen()) V.ui.closeSheet();
    });

    // Returning to the app after midnight should roll the date over.
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') {
        // Start the auto-lock clock the moment the app is backgrounded.
        V.auth.touch();
        return;
      }
      if (app.state.date !== V.today() && app.state.wasToday) {
        app.state.date = V.today();
      }

      const s = await V.store.settings.get();
      if (s.autoLockMinutes && V.auth.shouldAutoLock(s.autoLockMinutes)) {
        V.auth.lock();
        V.ui.closeSheet(true);
        await V.lockScreen.requireUnlock();
      }
      app.render();
    });

    // Any interaction counts as activity, so the app does not lock mid-use.
    for (const ev of ['pointerdown', 'keydown']) {
      document.addEventListener(ev, () => V.auth.touch(), { passive: true });
    }
  }

  // ----------------------------------------------------------------- boot --

  /**
   * Last-resort screen when storage cannot be opened at all.
   *
   * Deliberately built with real elements and theme tokens rather than a blob of inline
   * HTML in a hardcoded dark palette — this used to flash a dark screen at light-theme
   * users and read as the app having vanished. `blocked` gets its own copy because it is
   * a completely different problem from a browser refusing storage, and the fix is one
   * the user can actually carry out.
   */
  function showStorageFailure(err) {
    const blocked = err && err.name === 'BlockedError';
    /*
     * A VersionError means the stored database is NEWER than this code expects, which
     * only happens one way: the browser is running an out-of-date copy of the app against
     * data a newer copy already upgraded. In practice that is a stale service-worker
     * cache. Worth its own message, because the instinct on seeing a storage error is to
     * clear site data — and here that would delete a perfectly good database to fix a
     * stale script.
     */
    const stale = err && err.name === 'VersionError';

    let heading = 'Storage unavailable';
    let message = 'Ygeia needs IndexedDB to store your data. This usually means private ' +
                  'browsing is on, or the browser is blocking site data.';
    if (blocked) {
      heading = 'Ygeia is open somewhere else';
      message = err.message;
    } else if (stale) {
      heading = 'This copy of Ygeia is out of date';
      message = 'Your data was saved by a newer version of the app than the one your ' +
                'browser has loaded — almost always an old cached copy. Reload to fetch ' +
                'the current version. Do NOT clear your site data: your data is fine, it ' +
                'is the app that is behind.';
    }

    document.body.innerHTML = '';
    document.body.appendChild(
      V.el('div', { className: 'boot-error' }, [
        V.el('h2', { text: heading }),
        V.el('p', { text: message }),
        (!blocked && !stale)
          ? V.el('p', { className: 'boot-error-detail', text: String(err && err.message ? err.message : err) })
          : null,
        V.el('button', {
          className: 'btn btn-primary', type: 'button', text: 'Reload',
          on: { click: () => location.reload() },
        }),
        stale
          ? V.el('button', {
              className: 'btn btn-ghost', type: 'button', text: 'Clear the app cache and reload',
              style: { marginTop: '8px' },
              on: {
                click: async () => {
                  // Caches and service workers only — never IndexedDB, which holds the data.
                  try {
                    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
                    if (navigator.serviceWorker) {
                      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
                    }
                  } catch (e) { /* Reloading is still worth a try. */ }
                  location.reload();
                },
              },
            })
          : null,
        V.el('p', {
          className: 'boot-error-detail',
          text: 'Your data is safe either way — nothing here deletes it.',
        }),
      ]),
    );
  }

  async function boot() {
    try {
      await V.store.open();
    } catch (err) {
      console.error('[Ygeia] storage open failed:', err);
      showStorageFailure(err);
      return;
    }

    /*
     * If another tab upgrades the schema while this one is running, our connection is
     * closed out from under us and every later read would fail with an obscure
     * InvalidStateError. Say so plainly instead, and offer the reload that fixes it.
     */
    V.store.setSupersededHandler(() => {
      showStorageFailure(Object.assign(
        new Error('Ygeia was updated in another tab, so this one is now out of date. ' +
                  'Reload to pick up the new version.'),
        { name: 'BlockedError' },
      ));
    });

    await seedIfNeeded();
    await app.applyTheme();

    // Gate everything behind the passcode before any data reaches the screen.
    if (await V.auth.isSet()) {
      await V.lockScreen.requireUnlock();
    } else {
      V.auth.markUnlocked();
    }

    wireChrome();
    await app.applyFeatures();
    app.go('today');

    // First run: ask for the body the calculations need. Every step is skippable, and it
    // renders over a working app rather than blocking it.
    if (await V.onboard.shouldShow()) V.onboard.open();

    // Service workers require http(s); opened from file:// this is simply skipped.
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {
        /* Offline caching is a nice-to-have; the app works without it. */
      });
    }
  }

  V.app = app;
  V.views = V.views || {};

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.V);
