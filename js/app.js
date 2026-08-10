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
    V.$('#btn-date').addEventListener('click', () => app.setDate(V.today()));

    V.$('#sheet-close').addEventListener('click', () => V.ui.closeSheet());
    V.$('#sheet-backdrop').addEventListener('click', (e) => {
      // Only a tap on the dimmed area closes; taps inside the sheet must not.
      if (e.target.id === 'sheet-backdrop') V.ui.closeSheet();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && V.ui.sheetOpen()) V.ui.closeSheet();
    });

    // Returning to the app after midnight should roll the date over.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (app.state.date !== V.today() && app.state.wasToday) {
        app.state.date = V.today();
      }
      app.render();
    });
  }

  // ----------------------------------------------------------------- boot --

  async function boot() {
    try {
      await V.store.open();
    } catch (err) {
      document.body.innerHTML =
        '<div style="padding:32px;font-family:system-ui;color:#E8EDF2;background:#0B0D10;min-height:100vh">' +
        '<h2>Storage unavailable</h2><p>Ygeia needs IndexedDB to store your data. ' +
        'This usually means private browsing is on, or the browser is blocking site data.</p>' +
        '<p style="color:#8A94A3">' + V.esc(err.message) + '</p></div>';
      return;
    }

    await seedIfNeeded();
    await app.applyTheme();
    wireChrome();
    app.go('today');

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
