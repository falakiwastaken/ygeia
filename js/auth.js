/*
 * Ygeia — local passcode lock.
 *
 * There is no account and no server. This is a lock on THIS device, for the very ordinary
 * case of someone picking up your unlocked phone.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES AND DOES NOT PROTECT — be honest with users about this.
 *
 * Does:     stops casual access to the app UI. The passcode itself is never stored —
 *           only a PBKDF2-derived verifier with a random salt, so reading the database
 *           does not reveal it. Failed attempts are throttled.
 *
 * Does NOT: encrypt your logged data. Anyone with developer tools or filesystem access
 *           to the device can still read IndexedDB directly. Making that impossible means
 *           encrypting every record with a key derived from the passcode — which also
 *           means forgetting the passcode destroys the data permanently, with no server
 *           to recover from. That trade is not made here.
 *
 * The Settings screen states both of these plainly. Do not soften that wording.
 * ---------------------------------------------------------------------------
 */
(function (V) {
  'use strict';

  const A = {};

  // OWASP-recommended order of magnitude for PBKDF2-HMAC-SHA256. High enough to make
  // brute-forcing a 4-digit PIN from a stolen verifier slow, low enough to unlock in
  // well under a second on a phone.
  const ITERATIONS = 310000;
  const KEY_BITS = 256;

  /**
   * SubtleCrypto only exists in a secure context. Opened from file:// there is no crypto
   * available, so the feature is offered but disabled rather than silently insecure.
   */
  A.available = function () {
    return !!(window.crypto && window.crypto.subtle && window.isSecureContext);
  };

  A.unavailableReason = function () {
    if (!window.crypto || !window.crypto.subtle) return 'This browser has no Web Crypto support.';
    if (!window.isSecureContext) {
      return 'Passcodes need a secure context. Open Ygeia over https:// or from localhost — ' +
             'opening index.html directly as a file will not work.';
    }
    return null;
  };

  const enc = new TextEncoder();
  const b64 = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function derive(passcode, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      KEY_BITS,
    );
  }

  /** Length-independent comparison, so timing does not leak how much of the hash matched. */
  function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  async function record() {
    return (await V.store.db.get('kv', 'auth')) || null;
  }

  A.isSet = async function () {
    const r = await record();
    return !!(r && r.verifier);
  };

  /** Create or replace the passcode. Changing it requires the current one. */
  A.setPasscode = async function (passcode, currentPasscode) {
    if (!A.available()) throw new Error(A.unavailableReason());
    if (!passcode || passcode.length < 4) throw new Error('Use at least 4 digits.');

    if (await A.isSet()) {
      const ok = await A.verify(currentPasscode);
      if (!ok.ok) throw new Error('Current passcode is wrong.');
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const bits = await derive(passcode, salt, ITERATIONS);

    await V.store.db.put('kv', {
      key: 'auth',
      salt: b64(salt),
      verifier: b64(bits),
      iterations: ITERATIONS,
      createdAt: Date.now(),
      failures: 0,
      lockedUntil: 0,
    });
    return true;
  };

  A.removePasscode = async function (currentPasscode) {
    const ok = await A.verify(currentPasscode);
    if (!ok.ok) throw new Error('Passcode is wrong.');
    await V.store.db.remove('kv', 'auth');
    return true;
  };

  /**
   * Check a passcode.
   *
   * Repeated failures introduce an increasing delay. This is a local lock, so an attacker
   * with devtools can bypass the delay entirely — the throttle is there to make casual
   * shoulder-surfing guesswork tedious, not to stop a determined attacker, and the UI
   * does not claim otherwise.
   */
  A.verify = async function (passcode) {
    const r = await record();
    if (!r || !r.verifier) return { ok: true, noPasscode: true };

    const now = Date.now();
    if (r.lockedUntil && now < r.lockedUntil) {
      return { ok: false, lockedFor: Math.ceil((r.lockedUntil - now) / 1000) };
    }

    if (!passcode) return { ok: false };

    const bits = await derive(passcode, unb64(r.salt), r.iterations || ITERATIONS);
    const match = constantTimeEqual(new Uint8Array(bits), unb64(r.verifier));

    if (match) {
      if (r.failures) {
        r.failures = 0;
        r.lockedUntil = 0;
        await V.store.db.put('kv', r);
      }
      return { ok: true };
    }

    r.failures = (r.failures || 0) + 1;
    // 5 free attempts, then a delay that doubles: 5s, 10s, 20s… capped at 5 minutes.
    if (r.failures > 5) {
      const delay = Math.min(5000 * Math.pow(2, r.failures - 6), 300000);
      r.lockedUntil = now + delay;
    }
    await V.store.db.put('kv', r);

    return {
      ok: false,
      failures: r.failures,
      lockedFor: r.lockedUntil > now ? Math.ceil((r.lockedUntil - now) / 1000) : 0,
    };
  };

  // ------------------------------------------------------------ session state --

  let unlocked = false;
  let lastActive = Date.now();

  A.isUnlocked = () => unlocked;
  A.markUnlocked = function () { unlocked = true; lastActive = Date.now(); };
  A.lock = function () { unlocked = false; };
  A.touch = function () { lastActive = Date.now(); };

  /** True when the app has been in the background longer than the auto-lock timeout. */
  A.shouldAutoLock = function (timeoutMinutes) {
    if (!unlocked) return false;
    if (!timeoutMinutes) return false;
    return Date.now() - lastActive > timeoutMinutes * 60000;
  };

  A.ITERATIONS = ITERATIONS;
  V.auth = A;
})(window.V);
