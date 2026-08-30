/*
 * Ygeia — device capabilities.
 *
 * One place for the browser APIs that only some browsers have. Everything here is
 * feature-detected and every function is safe to call unconditionally: on a browser without
 * the API the call is a no-op that resolves, never a throw and never a branch the caller has
 * to write. That is the point — capability checks scattered through the views is how you end
 * up with three slightly different versions of the same `if`.
 *
 * Nothing here sends anything anywhere. Notifications are raised locally by this device, for
 * timers this device is running; there is no push service, no subscription and no server to
 * subscribe to. That is a deliberate limitation, not an oversight — see the note on Push in
 * the README's honest limitations.
 */
(function (V) {
  'use strict';

  const P = {};

  // ------------------------------------------------------------- wake lock --

  /*
   * Screen Wake Lock.
   *
   * Three features in this app measure or count time while you are looking at the screen but
   * not touching it — the rest timer between sets, the study focus block, and the live sound
   * meter. Without a wake lock the phone dims and sleeps partway through all three. For the
   * sound meter that is not merely inconvenient: requestAnimationFrame stops when the screen
   * is off, so the meter silently stops measuring while still appearing to be running.
   *
   * Locks are reference-counted by reason. Two features can hold one at once, and the screen
   * only goes back to normal when the last of them lets go.
   *
   * The browser drops a wake lock whenever the page is hidden, so it has to be reacquired on
   * the way back. That listener is registered once, here, rather than in each caller.
   */
  let sentinel = null;
  const holders = new Set();

  const wakeLockSupported = () => 'wakeLock' in navigator &&
    navigator.wakeLock && typeof navigator.wakeLock.request === 'function';

  P.wakeLockSupported = wakeLockSupported;

  async function acquire() {
    if (!wakeLockSupported() || sentinel || !holders.size) return;
    if (document.visibilityState !== 'visible') return; // request() rejects when hidden
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => { sentinel = null; });
    } catch (err) {
      // Refused for policy, low battery, or an unsupported surface. The feature still works;
      // the screen just behaves as it did before.
      sentinel = null;
    }
  }

  /** Hold the screen awake for `reason` until `releaseWakeLock(reason)` is called. */
  P.keepAwake = function (reason) {
    holders.add(reason || 'default');
    return acquire();
  };

  P.releaseWakeLock = async function (reason) {
    holders.delete(reason || 'default');
    if (holders.size || !sentinel) return;
    try { await sentinel.release(); } catch (err) { /* already gone */ }
    sentinel = null;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && holders.size) acquire();
  });

  // --------------------------------------------------------- notifications --

  /*
   * Local notifications, for a timer that finishes while the app is in the background.
   *
   * The rest timer's completion used to be a beep, a vibration and a toast — every one of
   * which needs the app to be foregrounded. Putting the phone down between sets is not an
   * edge case, it is the entire point of a rest timer, and doing so meant the cue never
   * arrived. Worse, setInterval is throttled to roughly once a minute in a background tab,
   * so even the countdown stopped being accurate.
   *
   * Permission is never requested at boot. A permission prompt fired at someone who has just
   * opened an app, for a thing they have not asked for yet, is the reason most people now
   * refuse them reflexively — so this only ever asks at the moment a timer is actually
   * started, when the request explains itself.
   */
  P.notificationsSupported = () => 'Notification' in window;

  P.notificationPermission = () => (P.notificationsSupported() ? Notification.permission : 'unsupported');

  /** Ask, but only when it can succeed and only when the answer is still open. */
  P.requestNotifications = async function () {
    if (!P.notificationsSupported()) return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    try {
      return await Notification.requestPermission();
    } catch (err) {
      return Notification.permission;
    }
  };

  /**
   * Show a local notification. Prefers the service worker, which is the only path iOS
   * supports for an installed web app, and falls back to a page notification elsewhere.
   */
  P.notify = async function (title, opts) {
    if (!P.notificationsSupported() || Notification.permission !== 'granted') return false;
    const options = Object.assign({
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      silent: false,
    }, opts || {});

    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, options);
          return true;
        }
      }
      new Notification(title, options);
      return true;
    } catch (err) {
      return false;
    }
  };

  // ---------------------------------------------------------------- badging --

  /**
   * The count on the app icon. Only meaningful for an installed app, and a silent no-op
   * everywhere else, so callers need not care which they are running in.
   */
  P.setBadge = async function (count) {
    try {
      if (!navigator.setAppBadge) return;
      if (count > 0) await navigator.setAppBadge(count);
      else if (navigator.clearAppBadge) await navigator.clearAppBadge();
    } catch (err) { /* not installed, or unsupported */ }
  };

  // ------------------------------------------------------------------ share --

  P.canShareFiles = function (files) {
    return !!(navigator.canShare && files && navigator.canShare({ files }));
  };

  /**
   * Hand a file to the OS share sheet, falling back to a download.
   *
   * `<a download>` is unreliable in iOS Safari and lands the file somewhere the user then
   * has to go hunting for — which is a poor way to treat the only copy of their data.
   * Returns 'shared', 'downloaded', or 'cancelled'.
   */
  P.shareFile = async function (blob, filename, title) {
    const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
    if (file && P.canShareFiles([file])) {
      try {
        await navigator.share({ files: [file], title: title || filename });
        return 'shared';
      } catch (err) {
        // AbortError is the user closing the sheet; anything else falls through to download.
        if (err && err.name === 'AbortError') return 'cancelled';
      }
    }
    return 'downloaded';
  };

  // ----------------------------------------------------------- transitions --

  /**
   * Run a DOM update inside a View Transition when the browser has them.
   *
   * `update` may be async. Browsers without the API just run it, so callers get the same
   * behaviour either way and never need the capability check themselves. Respects
   * prefers-reduced-motion, because a full-page cross-fade is exactly the kind of motion
   * people turn that setting on to avoid.
   */
  P.transition = function (update) {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduced) return Promise.resolve(update());
    try {
      return document.startViewTransition(update).finished.catch(() => {});
    } catch (err) {
      return Promise.resolve(update());
    }
  };

  V.platform = P;
})(window.V);
