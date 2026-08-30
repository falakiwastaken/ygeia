/*
 * Ygeia — persistence.
 *
 * IndexedDB, wrapped in promises. No ORM, no dependencies.
 *
 * Why IndexedDB and not localStorage: localStorage caps at ~5 MB, is synchronous (so it
 * janks the UI on every write), and stores strings only. Food logs and set-by-set workout
 * history accumulate for years, so this needs real indexed storage.
 *
 * Everything lives on the device. Nothing here talks to a network.
 */
(function (V) {
  'use strict';

  // Lowercase, and separate from the display name on purpose: renaming this orphans every
  // existing user's data. If it ever must change, migrate rather than rename.
  const DB_NAME = 'ygeia';
  // v2 added lifestyle tracking: sports, sleep, study, weight cuts and saved places.
  // v3 added accountability habits, meal plans and training programs.
  // v4 added decks and migrated review items from one-sided to front/back cards.
  // v5 added calendar notes.
  //
  // v6 added notebooks and whiteboards.
  //
  // `checkIns` went unwritten for a while after the original daily check-in was removed,
  // and was kept in the schema so nobody's history was destroyed. It is in use again for
  // the stress and energy ratings, and old records are still readable — same shape, with
  // fields that were not captured simply absent.
  const DB_VERSION = 6;

  /** store name -> { keyPath, indexes: [[name, keyPath, opts]] } */
  const SCHEMA = {
    foods:     { keyPath: 'id', indexes: [['barcode', 'barcode'], ['source', 'source']] },
    foodLogs:  { keyPath: 'id', indexes: [['date', 'date'], ['foodId', 'foodId']] },
    recipes:   { keyPath: 'id', indexes: [] },
    exercises: { keyPath: 'id', indexes: [['primary', 'primary']] },
    templates: { keyPath: 'id', indexes: [] },
    workouts:  { keyPath: 'id', indexes: [['date', 'date']] },
    sets:      { keyPath: 'id', indexes: [['workoutId', 'workoutId'], ['exerciseId', 'exerciseId']] },
    metrics:   { keyPath: 'id', indexes: [['type', 'type'], ['date', 'date'], ['typeDate', ['type', 'date']]] },
    kv:        { keyPath: 'key', indexes: [] },

    // --- v2 ---
    sportSessions: { keyPath: 'id', indexes: [['date', 'date'], ['sport', 'sport']] },
    sleepLogs:     { keyPath: 'id', indexes: [['date', 'date']] },
    subjects:      { keyPath: 'id', indexes: [] },
    studySessions: { keyPath: 'id', indexes: [['date', 'date'], ['subjectId', 'subjectId']] },
    reviewItems:   { keyPath: 'id', indexes: [['subjectId', 'subjectId'], ['dueDate', 'dueDate']] },
    cutPlans:      { keyPath: 'id', indexes: [] },
    places:        { keyPath: 'id', indexes: [] },

    // --- v3 ---
    // checkIns is keyed by date: there is exactly one per day, so the date IS the identity.
    // { date, stress: 1-5, energy: 1-5, at }
    checkIns:   { keyPath: 'date', indexes: [] },
    habits:     { keyPath: 'id', indexes: [] },
    habitLogs:  { keyPath: 'id', indexes: [['date', 'date'], ['habitId', 'habitId']] },
    mealPlans:  { keyPath: 'id', indexes: [['date', 'date']] },
    programRun: { keyPath: 'id', indexes: [] },

    // --- v4 ---
    decks: { keyPath: 'id', indexes: [['subjectId', 'subjectId']] },

    // --- v5 ---
    // Free-text things the user writes on a day: "exam tomorrow", "felt awful".
    notes: { keyPath: 'id', indexes: [['date', 'date']] },

    // --- v6 ---
    // Long-form study capture. A notebook is a container; the pages hold the content.
    // `kind` picks the editor — lined text, or a whiteboard you draw on.
    // { id, name, subjectId|null, kind: 'text'|'draw', createdAt, updatedAt }
    notebooks: { keyPath: 'id', indexes: [['subjectId', 'subjectId']] },
    // { id, notebookId, index, kind, text, strokes, updatedAt }
    notebookPages: { keyPath: 'id', indexes: [['notebookId', 'notebookId']] },

    // One answered question of the day, keyed by date like checkIns.
    // { date, questionId, answer, correct, answeredAt }
    dailyAnswers: { keyPath: 'date', indexes: [] },
  };

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = req.result;
        for (const name in SCHEMA) {
          const def = SCHEMA[name];
          const st = db.objectStoreNames.contains(name)
            ? req.transaction.objectStore(name)
            : db.createObjectStore(name, { keyPath: def.keyPath });
          for (const [idxName, keyPath, opts] of def.indexes) {
            if (!st.indexNames.contains(idxName)) st.createIndex(idxName, keyPath, opts || {});
          }
        }

        // ---- v4: review items became two-sided flashcards --------------------
        // Before v4 a card was just a title you self-graded. Copy that into `front`
        // and flag it so the UI can prompt for the missing answer. Runs inside the
        // versionchange transaction, so it either completes or the upgrade aborts —
        // no half-migrated state, and no card is lost.
        if (e.oldVersion < 4 && db.objectStoreNames.contains('reviewItems')) {
          const st = req.transaction.objectStore('reviewItems');
          st.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            const item = cursor.value;
            if (item.front == null) {
              item.front = item.title || '';
              item.back = item.back || '';
              item.needsAnswer = !item.back;
              cursor.update(item);
            }
            cursor.continue();
          };
        }
      };

      /*
       * Blocked means another connection is still holding an older version open — a
       * second tab, or the installed home-screen app running alongside the browser.
       *
       * This is NOT fatal and must not be treated as such. Every other connection gets
       * an `onversionchange` event (wired below) telling it to let go, and the upgrade
       * proceeds by itself the moment it does. Rejecting here immediately, as this used
       * to, turned an ordinary second tab into a dead "Storage unavailable" screen on
       * every schema change. So give the other tabs a moment to stand down, and only
       * give up if one of them genuinely will not.
       */
      let blockedTimer = null;
      req.onblocked = () => {
        blockedTimer = setTimeout(() => {
          const err = new Error(
            'Ygeia is open somewhere else with an older version of its database, and it ' +
            'has to close before this one can update. Close the app\'s other tabs and ' +
            'windows — including the home-screen app if you installed it — then reload.',
          );
          err.name = 'BlockedError';
          reject(err);
        }, BLOCKED_GRACE_MS);
      };

      req.onsuccess = () => {
        clearTimeout(blockedTimer);
        const db = req.result;

        /*
         * Yield to a newer version opened elsewhere.
         *
         * Without this, an old tab left open in the background holds the previous schema
         * forever and every newer tab is blocked indefinitely. Closing here is what makes
         * an upgrade possible at all while the app is open twice, which — for something
         * people pin to a home screen and also open in a browser — is the normal case,
         * not an edge case.
         */
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
          if (typeof onSuperseded === 'function') onSuperseded();
        };

        resolve(db);
      };

      req.onerror = () => { clearTimeout(blockedTimer); reject(req.error); };
    });

    /*
     * Never cache a failure.
     *
     * `dbPromise` is memoised so the database is only opened once. If that promise
     * rejects and is kept, every later call returns the same rejection for the life of
     * the page — one transient failure (a blocked upgrade that has since cleared, a
     * momentary quota error) and the app stays broken until it is reloaded, with each
     * subsequent screen failing for a reason that has long stopped being true. Dropping
     * it here lets the next caller genuinely retry.
     *
     * The identity check matters: a retry may already have replaced `dbPromise` with a
     * live connection by the time this settles, and clearing that would throw away a
     * working database.
     */
    const pending = dbPromise;
    pending.catch(() => { if (dbPromise === pending) dbPromise = null; });

    return pending;
  }

  /** How long to let other tabs close before calling a blocked upgrade a failure. */
  const BLOCKED_GRACE_MS = 3000;

  /**
   * Called when another tab upgrades the schema out from under this one. The connection
   * is already closed by then, so the app has to reload rather than carry on writing.
   */
  let onSuperseded = null;
  function setSupersededHandler(fn) { onSuperseded = fn; }

  function run(storeNames, mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeNames, mode);
          let result;
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
          // fn resolves its value synchronously into `result`; the transaction's own
          // completion is what we actually await, so writes are durable before resolving.
          result = fn(tx);
        }),
    );
  }

  const wrap = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  // ------------------------------------------------------------ primitives --

  const db = {
    put(store, value) {
      return run([store], 'readwrite', (tx) => { tx.objectStore(store).put(value); return value; });
    },

    putMany(store, values) {
      return run([store], 'readwrite', (tx) => {
        const st = tx.objectStore(store);
        for (const v of values) st.put(v);
        return values.length;
      });
    },

    get(store, key) {
      return open().then((d) => wrap(d.transaction(store, 'readonly').objectStore(store).get(key)));
    },

    all(store) {
      return open().then((d) => wrap(d.transaction(store, 'readonly').objectStore(store).getAll()));
    },

    /** All records where `index` equals `value` (or falls in an IDBKeyRange). */
    byIndex(store, index, value) {
      return open().then((d) =>
        wrap(d.transaction(store, 'readonly').objectStore(store).index(index).getAll(value)),
      );
    },

    remove(store, key) {
      return run([store], 'readwrite', (tx) => { tx.objectStore(store).delete(key); return true; });
    },

    clear(store) {
      return run([store], 'readwrite', (tx) => { tx.objectStore(store).clear(); return true; });
    },

    /**
     * Replace the entire contents of several stores, atomically.
     *
     * `map` is { storeName: [rows] }. Every named store is cleared and refilled inside ONE
     * transaction, so if anything is rejected — a bad key, a quota limit, the tab closing
     * mid-write — IndexedDB aborts the whole thing and the database is left exactly as it was.
     *
     * This exists for restore. Doing it as clear-then-write per store in separate
     * transactions means a failure halfway leaves some stores replaced, one store empty and
     * the rest untouched, with no way back. For the only recovery path an app with no server
     * has, that is the wrong shape: a restore must either happen or not happen.
     */
    replaceStores(map) {
      const names = Object.keys(map);
      if (!names.length) return Promise.resolve(0);
      return run(names, 'readwrite', (tx) => {
        let n = 0;
        for (const name of names) {
          const st = tx.objectStore(name);
          st.clear();
          for (const row of map[name]) { st.put(row); n++; }
        }
        return n;
      });
    },

    count(store) {
      return open().then((d) => wrap(d.transaction(store, 'readonly').objectStore(store).count()));
    },
  };

  // -------------------------------------------------------------- settings --

  const DEFAULT_SETTINGS = {
    key: 'settings',
    // Profile — used for BMR/TDEE. 'unspecified' avoids forcing a choice on first run.
    sex: 'unspecified',
    age: 30,
    heightCm: 175,
    weightKg: 75,
    activityLevel: 'moderate',
    goal: 'maintain',
    // Grams per kg of bodyweight. See D.DEFAULT_PROTEIN_PER_KG in js/domain.js for why
    // this sits at the top of the supported range rather than at the plateau.
    proteinPerKg: 2.2,
    // Aim at the bottom of the calorie estimate rather than its middle, to absorb
    // under-logging. 0 = off. See D.DEFAULT_CALORIE_MARGIN in js/domain.js.
    calorieMargin: 0,
    // Manual overrides. When null the targets are derived from the profile.
    kcalOverride: null,
    proteinOverride: null,
    carbsOverride: null,
    fatOverride: null,
    // Display
    weightUnit: 'kg',      // 'kg' | 'lb'
    heightUnit: 'cm',      // 'cm' | 'in'
    tempUnit: 'c',         // 'c' | 'f'
    energyUnit: 'kcal',
    theme: 'light',        // 'light' | 'dark' | 'auto' — light is the intended look
    firstDayOfWeek: 1,
    // Nutrition rules
    lateMealHour: 21,          // meals after this hour are "late"
    lateMealMinKcal: 150,      // ...but only if they exceed this, so water/supplements don't count
    // Training
    barWeightKg: 20,
    availablePlatesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
    defaultRestSec: 120,

    // Sleep & study
    sleepTargetHours: 8,
    wakeTarget: '07:00',
    dailyStudyMinutes: 180,
    // Difficulty of the daily question. 'foundation' | 'standard' | 'advanced'.
    studyLevel: 'standard',
    // Open the daily question by itself when the Study tab is opened.
    dailyQuestionPopup: true,

    // Hearing. A phone mic reports dBFS, which needs an offset to become dB SPL, and
    // that offset is device-specific — see js/domain-sound.js. Calibratable in the meter.
    micOffsetDb: 90,

    // Security. Only takes effect once a passcode is set.
    autoLockMinutes: 5,

    onboarded: false,
  };

  let settingsCache = null;

  const settings = {
    async get() {
      if (settingsCache) return settingsCache;
      const stored = await db.get('kv', 'settings');
      // Spread defaults first so settings added in later versions appear automatically.
      settingsCache = Object.assign({}, DEFAULT_SETTINGS, stored || {});
      return settingsCache;
    },

    async set(patch) {
      const next = Object.assign({}, await settings.get(), patch, { key: 'settings' });
      settingsCache = next;
      await db.put('kv', next);
      return next;
    },

    invalidate() { settingsCache = null; },

    defaults: DEFAULT_SETTINGS,
  };

  // ----------------------------------------------------------------- foods --

  const foods = {
    all: () => db.all('foods'),
    get: (id) => db.get('foods', id),
    save: (food) => db.put('foods', food),
    remove: (id) => db.remove('foods', id),

    async byBarcode(code) {
      const hits = await db.byIndex('foods', 'barcode', code);
      return hits[0] || null;
    },

    /**
     * Token search over the local library.
     *
     * Every word in the query must appear somewhere in the food's name or brand — so
     * "greek yogurt" finds "Greek yoghurt, 0% fat" while plain substring matching would
     * not. Each word is also tried as its synonyms (see V.FOOD_SYNONYMS), which is what
     * makes "yogurt", "coke" and "eggplant" work against a library written in British
     * English.
     *
     * Loads everything and filters in memory: with a few thousand records that is well
     * under a frame, and it avoids maintaining a separate index.
     */
    async search(query, limit) {
      const raw = String(query || '').trim().toLowerCase();
      if (!raw) return [];
      const list = await db.all('foods');

      const synonyms = V.FOOD_SYNONYMS || {};

      /**
       * Singular/plural variants. The library stores "Egg, whole, raw", so a search for
       * "eggs" would otherwise miss it entirely — which is exactly what people type.
       */
      const forms = (tok) => {
        const set = [tok];
        if (tok.length > 3) {
          if (/ies$/.test(tok)) set.push(tok.slice(0, -3) + 'y');
          // "potatoes" -> "potato", "tomatoes" -> "tomato"
          else if (/oes$/.test(tok)) set.push(tok.slice(0, -2));
          else if (/(ch|sh|s|x|z)es$/.test(tok)) set.push(tok.slice(0, -2));
          else if (/s$/.test(tok)) set.push(tok.slice(0, -1));
          else set.push(tok + 's');
        }
        return set;
      };

      const tokens = raw.split(/\s+/).filter(Boolean).map((tok) => {
        const variants = forms(tok);
        for (const syn of synonyms[tok] || []) {
          for (const f of forms(syn)) if (!variants.includes(f)) variants.push(f);
        }
        return variants;
      });

      const scored = [];
      for (const f of list) {
        const name = (f.name || '').toLowerCase();
        const haystack = name + ' ' + (f.brand || '').toLowerCase();

        let matchedAll = true;
        let bonus = 0;

        for (const variants of tokens) {
          const hit = variants.find((v) => haystack.includes(v));
          if (!hit) { matchedAll = false; break; }
          // Prefer the word actually typed over a synonym, and a word starting the name
          // over one buried in it.
          if (hit === variants[0]) bonus -= 25;
          if (name.startsWith(hit)) bonus -= 60;
        }
        if (!matchedAll) continue;

        let score = name.length + bonus;

        /*
         * Names in this library read "Food, qualifier, qualifier" — "Egg, whole, raw",
         * "Potato, boiled". So an exact hit on the part before the first comma means the
         * user named the food itself rather than a variant of it. Without this, searching
         * "eggs" returns "Egg white" simply because it is a shorter string.
         */
        const head = name.split(',')[0].trim();
        if (head === raw) score -= 900;
        else if (tokens.length === 1 && tokens[0].includes(head)) score -= 800;

        if (name.startsWith(raw)) score -= 500;
        else if (name.includes(raw)) score -= 200;
        // The user's own entries are almost always what they meant.
        if (f.source === 'custom') score -= 300;

        scored.push({ f, score });
      }

      scored.sort((a, b) => a.score - b.score);
      return scored.slice(0, limit || 40).map((s) => s.f);
    },
  };

  // -------------------------------------------------------------- food log --

  const foodLog = {
    byDate: (date) => db.byIndex('foodLogs', 'date', date),
    save: (entry) => db.put('foodLogs', entry),
    remove: (id) => db.remove('foodLogs', id),

    /** Entries for a date, each joined with its food record. Unresolvable rows are dropped. */
    async resolved(date) {
      const entries = await foodLog.byDate(date);
      const out = [];
      for (const e of entries) {
        const food = await foods.get(e.foodId);
        if (!food) continue;
        out.push(Object.assign({}, e, { food, nutrients: V.domain.scaleNutrients(food.per100, e.grams) }));
      }
      return out.sort((a, b) => a.loggedAt - b.loggedAt);
    },

    async range(startDate, endDate) {
      return db.byIndex('foodLogs', 'date', IDBKeyRange.bound(startDate, endDate));
    },
  };

  // ------------------------------------------------------------- exercises --

  const exercises = {
    all: () => db.all('exercises'),
    get: (id) => db.get('exercises', id),
    save: (ex) => db.put('exercises', ex),
    remove: (id) => db.remove('exercises', id),
  };

  // -------------------------------------------------------------- workouts --

  const workouts = {
    all: () => db.all('workouts'),
    get: (id) => db.get('workouts', id),
    save: (w) => db.put('workouts', w),
    byDate: (date) => db.byIndex('workouts', 'date', date),

    async remove(id) {
      const sets = await db.byIndex('sets', 'workoutId', id);
      await Promise.all(sets.map((s) => db.remove('sets', s.id)));
      return db.remove('workouts', id);
    },

    /** The in-progress workout, if any. At most one exists at a time. */
    async active() {
      const all = await db.all('workouts');
      return all.find((w) => !w.finishedAt) || null;
    },

    async recent(limit) {
      const all = await db.all('workouts');
      return all
        .filter((w) => w.finishedAt)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, limit || 30);
    },
  };

  const sets = {
    byWorkout: (workoutId) => db.byIndex('sets', 'workoutId', workoutId),
    byExercise: (exerciseId) => db.byIndex('sets', 'exerciseId', exerciseId),
    save: (s) => db.put('sets', s),
    saveMany: (list) => db.putMany('sets', list),
    remove: (id) => db.remove('sets', id),
  };

  const templates = {
    all: () => db.all('templates'),
    get: (id) => db.get('templates', id),
    save: (t) => db.put('templates', t),
    remove: (id) => db.remove('templates', id),
  };

  // --------------------------------------------------------------- metrics --

  const metrics = {
    save: (m) => db.put('metrics', m),
    remove: (id) => db.remove('metrics', id),
    byType: (type) => db.byIndex('metrics', 'type', type),

    /** Chronological samples of one metric type, oldest first. */
    async series(type) {
      const list = await db.byIndex('metrics', 'type', type);
      return list.sort((a, b) => a.recordedAt - b.recordedAt);
    },

    /** Most recent sample of a type, or null. */
    async latest(type) {
      const s = await metrics.series(type);
      return s.length ? s[s.length - 1] : null;
    },

    /**
     * One value per day, averaging same-day samples. Weight especially is often logged
     * more than once a day, and a daily mean is far less noisy than picking one reading.
     *
     * `aggregate` overrides how a day's values collapse, because an arithmetic mean is
     * not always the right answer. Decibels are logarithmic: 60 dB and 90 dB average to
     * 87, not 75, and treating them as 75 understates the day's noise exposure enormously.
     * Pass V.sound.meanDb for those. Existing callers get the mean as before.
     */
    async daily(type, aggregate) {
      const s = await metrics.series(type);
      const byDay = V.groupBy(s, 'date');
      const collapse = aggregate || ((vals) => V.sum(vals) / vals.length);
      return Object.keys(byDay).sort().map((date) => ({
        date,
        value: collapse(byDay[date].map((x) => x.value)),
      }));
    },
  };

  // ---------------------------------------------------------------- sports --

  const sports = {
    all: () => db.all('sportSessions'),
    byDate: (date) => db.byIndex('sportSessions', 'date', date),
    save: (s) => db.put('sportSessions', s),
    remove: (id) => db.remove('sportSessions', id),

    async recent(limit) {
      const all = await db.all('sportSessions');
      return all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit || 30);
    },
  };

  // ----------------------------------------------------------------- sleep --

  const sleep = {
    all: () => db.all('sleepLogs'),
    save: (s) => db.put('sleepLogs', s),
    remove: (id) => db.remove('sleepLogs', id),

    /**
     * A night is filed under the date you WOKE UP, which is what people mean by
     * "how did I sleep last night" and keeps it aligned with that day's performance.
     */
    async byDate(date) {
      const hits = await db.byIndex('sleepLogs', 'date', date);
      return hits[0] || null;
    },

    async series() {
      const all = await db.all('sleepLogs');
      return all.sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  };

  // ----------------------------------------------------------------- study --

  const study = {
    subjects: () => db.all('subjects'),
    saveSubject: (s) => db.put('subjects', s),

    async removeSubject(id) {
      // Cascade: orphaned sessions and review items would be unreachable otherwise.
      for (const s of await db.byIndex('studySessions', 'subjectId', id)) await db.remove('studySessions', s.id);
      for (const r of await db.byIndex('reviewItems', 'subjectId', id)) await db.remove('reviewItems', r.id);
      return db.remove('subjects', id);
    },

    sessions: () => db.all('studySessions'),
    sessionsByDate: (date) => db.byIndex('studySessions', 'date', date),
    saveSession: (s) => db.put('studySessions', s),
    removeSession: (id) => db.remove('studySessions', id),

    reviews: () => db.all('reviewItems'),
    saveReview: (r) => db.put('reviewItems', r),
    removeReview: (id) => db.remove('reviewItems', id),

    /** Review items due on or before `date`, soonest first. */
    async dueReviews(date) {
      const all = await db.all('reviewItems');
      return all
        .filter((r) => r.dueDate <= (date || V.today()))
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    },

    // ---- decks -------------------------------------------------------------

    decks: () => db.all('decks'),
    getDeck: (id) => db.get('decks', id),
    saveDeck: (d) => db.put('decks', d),

    async removeDeck(id, keepCards) {
      const cards = await db.all('reviewItems');
      for (const c of cards.filter((x) => x.deckId === id)) {
        // Deleting a deck should not silently destroy study history unless asked.
        if (keepCards) { delete c.deckId; await db.put('reviewItems', c); }
        else await db.remove('reviewItems', c.id);
      }
      return db.remove('decks', id);
    },

    async cardsInDeck(deckId) {
      const all = await db.all('reviewItems');
      return all.filter((c) => c.deckId === deckId);
    },

    /** Cards with a front but no back yet — surfaced so migrated cards get finished. */
    async unfinishedCards() {
      const all = await db.all('reviewItems');
      return all.filter((c) => c.needsAnswer || !c.back);
    },
  };

  // ------------------------------------------------------------- weight cut --

  const cuts = {
    all: () => db.all('cutPlans'),
    get: (id) => db.get('cutPlans', id),
    save: (p) => db.put('cutPlans', p),
    remove: (id) => db.remove('cutPlans', id),

    /** The single active plan, if any. */
    async active() {
      const all = await db.all('cutPlans');
      return all.find((p) => p.active) || null;
    },
  };

  // ---------------------------------------------------------------- places --

  const places = {
    all: () => db.all('places'),
    get: (id) => db.get('places', id),
    save: (p) => db.put('places', p),
    remove: (id) => db.remove('places', id),
  };

  // ----------------------------------------------------------------- notes --

  const notes = {
    all: () => db.all('notes'),
    byDate: (date) => db.byIndex('notes', 'date', date),
    save: (n) => db.put('notes', n),
    remove: (id) => db.remove('notes', id),

    async range(startDate, endDate) {
      return db.byIndex('notes', 'date', IDBKeyRange.bound(startDate, endDate));
    },

    /** Notes dated from today onwards, soonest first — for the "exam tomorrow" prompt. */
    async upcoming(days) {
      const from = V.today();
      const to = V.addDays(from, days == null ? 14 : days);
      const rows = await db.byIndex('notes', 'date', IDBKeyRange.bound(from, to));
      return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  };

  // -------------------------------------------------------------- notebooks --

  const notebooks = {
    all: () => db.all('notebooks'),
    get: (id) => db.get('notebooks', id),
    save: (nb) => db.put('notebooks', Object.assign({}, nb, { updatedAt: Date.now() })),
    bySubject: (subjectId) => db.byIndex('notebooks', 'subjectId', subjectId),

    /** Cascade, exactly as removeSubject does — orphan pages are unreachable otherwise. */
    async remove(id) {
      for (const p of await db.byIndex('notebookPages', 'notebookId', id)) {
        await db.remove('notebookPages', p.id);
      }
      return db.remove('notebooks', id);
    },

    /** Pages of a notebook in reading order. */
    async pages(notebookId) {
      const rows = await db.byIndex('notebookPages', 'notebookId', notebookId);
      return rows.sort((a, b) => (a.index || 0) - (b.index || 0));
    },

    savePage: (p) => db.put('notebookPages', Object.assign({}, p, { updatedAt: Date.now() })),
    removePage: (id) => db.remove('notebookPages', id),

    async pageCount(notebookId) {
      const rows = await db.byIndex('notebookPages', 'notebookId', notebookId);
      return rows.length;
    },
  };

  // ---------------------------------------------------------- daily answers --

  const dailyAnswers = {
    all: () => db.all('dailyAnswers'),
    byDate: (date) => db.get('dailyAnswers', date),
    save: (a) => db.put('dailyAnswers', Object.assign({ answeredAt: Date.now() }, a)),
  };

  // -------------------------------------------------------------- check-ins --

  /**
   * How the day felt: self-rated stress and energy, 1–5.
   *
   * Keyed by date, so saving twice in a day updates rather than accumulates. This is
   * deliberately kept apart from the physiological stress estimate in domain-vitals —
   * they measure different things, and the disagreement between them is the useful part.
   */
  const checkIns = {
    all: () => db.all('checkIns'),
    byDate: (date) => db.get('checkIns', date),
    remove: (date) => db.remove('checkIns', date),

    save: (c) => db.put('checkIns', Object.assign({ at: Date.now() }, c)),

    async range(startDate, endDate) {
      const all = await db.all('checkIns');
      return all
        .filter((c) => c.date >= startDate && c.date <= endDate)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  };

  // ---------------------------------------------------------------- habits --

  const habits = {
    all: () => db.all('habits'),
    save: (h) => db.put('habits', h),

    async remove(id) {
      for (const l of await db.byIndex('habitLogs', 'habitId', id)) await db.remove('habitLogs', l.id);
      return db.remove('habits', id);
    },

    logs: () => db.all('habitLogs'),
    logsByDate: (date) => db.byIndex('habitLogs', 'date', date),

    /**
     * Set a habit's state for a day. The id is derived from habit+date so toggling twice
     * updates one record rather than accumulating duplicates.
     */
    async setDone(habitId, date, done) {
      const id = habitId + '|' + date;
      await db.put('habitLogs', { id, habitId, date, done, at: Date.now() });
      return id;
    },
  };

  // ------------------------------------------------------------ meal plans --

  const mealPlans = {
    all: () => db.all('mealPlans'),
    byDate: (date) => db.byIndex('mealPlans', 'date', date),
    save: (p) => db.put('mealPlans', p),
    remove: (id) => db.remove('mealPlans', id),

    async range(startDate, endDate) {
      return db.byIndex('mealPlans', 'date', IDBKeyRange.bound(startDate, endDate));
    },
  };

  // --------------------------------------------------------------- program --

  const programs = {
    all: () => db.all('programRun'),
    save: (p) => db.put('programRun', p),
    remove: (id) => db.remove('programRun', id),

    /** The single active program run, if any. */
    async active() {
      const all = await db.all('programRun');
      return all.find((p) => p.active) || null;
    },
  };

  V.store = {
    db, settings, foods, foodLog, exercises, workouts, sets, templates, metrics,
    sports, sleep, study, cuts, places,
    notes, habits, mealPlans, programs, checkIns, notebooks, dailyAnswers,
    open, SCHEMA, setSupersededHandler, DB_VERSION,
  };
})(window.V);
