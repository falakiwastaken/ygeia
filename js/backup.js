/*
 * Ygeia — backup and restore.
 *
 * Ygeia has no server and no account, which is the point: nothing to breach, no health
 * data sitting on someone else's machine, no legal duty of care over other people's
 * medical information.
 *
 * The cost of that choice is durability. A lost phone or a tapped "clear browsing data"
 * takes months of logs with it, and there is nobody to ask for a copy. So backups are not
 * a nice-to-have here — they are the only recovery path that exists, and the app nags
 * about them accordingly.
 *
 * Two formats:
 *
 *   Plain      readable JSON. Easy to inspect, grep, or parse with a script.
 *   Encrypted  AES-GCM under a PBKDF2 key. Safe to keep in iCloud, Drive, Dropbox or
 *              email, none of which you would want holding a readable health diary.
 *
 * The encrypted format is documented in FORMAT below and uses nothing exotic, so the data
 * is recoverable with a short script even if this app disappears. A backup you cannot open
 * without the original software is not really a backup.
 */
(function (V) {
  'use strict';

  const B = {};

  const PLAIN_FORMAT = 'ygeia-backup';
  const ENCRYPTED_FORMAT = 'ygeia-backup-encrypted';

  // Older tags still accepted on restore so early exports keep working.
  const ACCEPTED_PLAIN = [PLAIN_FORMAT, 'Ygeia-backup', 'vitals-backup'];

  /*
   * 310,000 is the OWASP figure for PBKDF2-HMAC-SHA1. This uses SHA-256, where the
   * corresponding recommendation is 600,000 — so the old value was running at roughly half
   * the intended strength for the hash actually in use.
   *
   * Raising it costs nothing in compatibility: `decrypt` reads the count out of the envelope
   * rather than assuming this constant, so every backup written before this change still
   * opens. The threat model here is not hypothetical — the UI tells people this file is safe
   * to keep in iCloud or Dropbox, which is to say it assumes the ciphertext is already in
   * someone else's hands.
   */
  const ITERATIONS = 600000;

  /**
   * The encrypted envelope, written out so a future reader does not have to guess:
   *
   *   { format, version, exportedAt,
   *     kdf:    { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: base64 },
   *     cipher: { name: 'AES-GCM', iv: base64 },
   *     data:   base64 ciphertext of the UTF-8 JSON payload }
   *
   * Derive a 256-bit key with PBKDF2 over the passphrase and salt, then AES-GCM decrypt
   * `data` with `iv`. That is the whole scheme.
   */
  B.FORMAT = { PLAIN_FORMAT, ENCRYPTED_FORMAT, ITERATIONS };

  const STORES = [
    'foods', 'foodLogs', 'recipes', 'exercises', 'templates', 'workouts', 'sets',
    'metrics', 'sportSessions', 'sleepLogs', 'subjects', 'studySessions', 'reviewItems',
    'cutPlans', 'places', 'checkIns', 'habits', 'habitLogs', 'mealPlans', 'programRun',
    'decks', 'notes', 'notebooks', 'notebookPages', 'dailyAnswers', 'kv',
  ];

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /*
   * Base64, in chunks.
   *
   * This was `btoa(String.fromCharCode.apply(null, bytes))`, which spreads every byte into
   * an argument list. JavaScriptCore caps that around 65,536 arguments and V8 around 125,000,
   * so it threw `RangeError: Maximum call stack size exceeded` for any ciphertext past about
   * 100 kB — which is to say, for every database with a few months in it. Encrypted export
   * was broken for precisely the people with enough data to need it, and since the plain
   * path does not come through here, the failure quietly pushed them to the UNENCRYPTED file.
   *
   * 0x8000 bytes per call stays an order of magnitude inside the smaller limit.
   */
  const B64_CHUNK = 0x8000;
  const b64 = function (buf) {
    const bytes = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < bytes.length; i += B64_CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK));
    }
    return btoa(out);
  };

  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // =========================================================================
  // Gathering
  // =========================================================================

  /**
   * Collect every store into one object.
   *
   * `kv` holds the settings blob — and also the passcode verifier and, if set, the Gemini
   * API key. Those are stripped: a backup is a file people email to themselves, and an API
   * key in it is a credential leak waiting to happen. The passcode verifier is dropped
   * because restoring someone else's lock onto your own device is a way to get locked out
   * of your own data.
   */
  B.collect = async function () {
    const stores = {};
    for (const name of STORES) {
      if (!V.store.SCHEMA[name]) continue;
      stores[name] = await V.store.db.all(name);
    }

    if (stores.kv) {
      stores.kv = stores.kv.filter((row) => row.key !== 'auth' && row.key !== 'visionKey');
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'Ygeia',
      stores,
    };
  };

  B.counts = function (payload) {
    const out = {};
    let total = 0;
    for (const name in payload.stores) {
      const n = payload.stores[name].length;
      if (n) { out[name] = n; total += n; }
    }
    return { byStore: out, total };
  };

  // =========================================================================
  // Encryption
  // =========================================================================

  B.available = function () {
    return !!(window.crypto && window.crypto.subtle && window.isSecureContext);
  };

  async function deriveKey(passphrase, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  B.encrypt = async function (payload, passphrase) {
    if (!B.available()) throw new Error('Encryption needs a secure context — use https:// or localhost.');
    /*
     * 12, not 8. The UI tells people this file is safe to keep in iCloud, Drive, Dropbox or
     * email — which means the threat model already assumes the ciphertext is in someone
     * else's hands, and the passphrase is then the only thing standing between them and a
     * readable health diary. Eight characters does not survive that; an offline attacker
     * gets unlimited guesses at whatever rate their hardware allows.
     */
    if (!passphrase || passphrase.length < 12) {
      throw new Error('Use a passphrase of at least 12 characters — this file is meant to be safe ' +
                      'even if someone else gets hold of it.');
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ITERATIONS);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(JSON.stringify(payload)),
    );

    return {
      format: ENCRYPTED_FORMAT,
      version: 1,
      exportedAt: payload.exportedAt,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) },
      cipher: { name: 'AES-GCM', iv: b64(iv) },
      data: b64(ciphertext),
    };
  };

  B.decrypt = async function (envelope, passphrase) {
    if (!B.available()) throw new Error('Decryption needs a secure context — use https:// or localhost.');

    // The iteration count comes from an untrusted file, so it is clamped. Without a
    // ceiling a malformed or hostile backup could pin the main thread for minutes.
    const claimed = Number(envelope.kdf && envelope.kdf.iterations) || ITERATIONS;
    const iterations = Math.min(Math.max(claimed, 10000), 2000000);

    const key = await deriveKey(passphrase, unb64(envelope.kdf.salt), iterations);

    let plain;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: unb64(envelope.cipher.iv) },
        key,
        unb64(envelope.data),
      );
    } catch (err) {
      // AES-GCM authenticates, so a failure here means the wrong passphrase or a corrupted
      // file — there is no way to tell which, and guessing would be misleading.
      throw new Error('Could not decrypt. Wrong passphrase, or the file is damaged.');
    }

    return JSON.parse(dec.decode(plain));
  };

  // =========================================================================
  // Files
  // =========================================================================

  B.download = function (obj, filename) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = V.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking synchronously can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  B.exportPlain = async function () {
    const payload = await B.collect();
    payload.format = PLAIN_FORMAT;
    B.download(payload, `ygeia-backup-${V.today()}.json`);
    await B.markBackedUp();
    return B.counts(payload);
  };

  B.exportEncrypted = async function (passphrase) {
    const payload = await B.collect();
    payload.format = PLAIN_FORMAT;
    const envelope = await B.encrypt(payload, passphrase);
    B.download(envelope, `ygeia-backup-${V.today()}.encrypted.json`);
    await B.markBackedUp();
    return B.counts(payload);
  };

  /** Read a file and work out what it is. Returns { encrypted, payload? , envelope? }. */
  B.inspect = async function (file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      throw new Error('That is not a JSON file.');
    }

    if (parsed.format === ENCRYPTED_FORMAT) {
      if (!parsed.kdf || !parsed.cipher || !parsed.data) {
        throw new Error('That encrypted backup is missing parts and cannot be read.');
      }
      return { encrypted: true, envelope: parsed, exportedAt: parsed.exportedAt };
    }

    if (ACCEPTED_PLAIN.includes(parsed.format)) {
      return { encrypted: false, payload: parsed, exportedAt: parsed.exportedAt };
    }

    throw new Error('That is not a Ygeia backup.');
  };

  /**
   * Replace everything with the contents of a backup.
   *
   * Deliberately destructive and deliberately explicit — the caller must confirm first.
   * Stores absent from the file are left alone rather than cleared, so restoring an older
   * backup does not wipe data belonging to features that did not exist when it was made.
   */
  B.restore = async function (payload) {
    if (!payload || !payload.stores) throw new Error('That backup has no data in it.');

    /*
     * Validate the whole file before touching anything.
     *
     * The previous version cleared each store and then wrote it back, store by store, in
     * separate transactions. A rejection partway through — a malformed row, the quota, a
     * closed tab — left one store empty, the stores before it replaced, and the stores after
     * it untouched, with no rollback and nothing to tell the user which was which. Restoring
     * a slightly bad backup was worse than not restoring at all.
     */
    const plan = {};
    let restored = 0;
    for (const name in payload.stores) {
      if (!V.store.SCHEMA[name]) continue; // a store from a newer version of the app
      const rows = payload.stores[name];
      if (!Array.isArray(rows)) continue;
      plan[name] = rows;
      restored += rows.length;
    }

    if (!Object.keys(plan).length) throw new Error('That backup has no readable stores in it.');

    /*
     * `kv` carries the settings blob, and `collect` deliberately strips the passcode verifier
     * and the API key from exports — so clearing `kv` wholesale would silently remove the
     * lock and the stored key from THIS device on every restore. Carry them across.
     */
    const keep = [];
    if (plan.kv) {
      for (const key of ['auth', 'visionKey']) {
        const existing = await V.store.db.get('kv', key);
        if (existing) keep.push(existing);
      }
      plan.kv = plan.kv.filter((row) => !keep.some((k) => k.key === row.key)).concat(keep);
    }

    // One transaction across every store: it either all lands or none of it does.
    await V.store.db.replaceStores(plan);

    V.store.settings.invalidate();
    return restored;
  };

  // =========================================================================
  // Reminders
  // =========================================================================

  B.markBackedUp = async function () {
    await V.store.db.put('kv', { key: 'lastBackup', at: Date.now() });
  };

  B.lastBackupAt = async function () {
    const rec = await V.store.db.get('kv', 'lastBackup');
    return (rec && rec.at) || null;
  };

  B.daysSinceBackup = async function () {
    const at = await B.lastBackupAt();
    if (!at) return null;
    return Math.floor((Date.now() - at) / 86400000);
  };

  /**
   * Whether to nag, and how loudly.
   *
   * Only nags once there is something worth losing — prompting someone to back up an empty
   * database trains them to ignore the prompt, which is exactly when you need them to read it.
   */
  B.reminderState = async function () {
    const [days, logs, workouts] = await Promise.all([
      B.daysSinceBackup(),
      V.store.db.count('foodLogs'),
      V.store.db.count('workouts'),
    ]);

    const hasData = logs + workouts >= 10;
    if (!hasData) return { show: false, days, hasData };

    if (days == null) {
      return {
        show: true, urgent: true, days: null, hasData,
        message: 'You have never backed up. There is no server — if this device is lost or ' +
                 'you clear site data, everything goes with it.',
      };
    }
    if (days >= 30) {
      return {
        show: true, urgent: true, days, hasData,
        message: `Last backup was ${days} days ago.`,
      };
    }
    if (days >= 14) {
      return { show: true, urgent: false, days, hasData, message: `Last backup was ${days} days ago.` };
    }
    return { show: false, days, hasData };
  };

  V.backup = B;
})(window.V);
