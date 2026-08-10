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
  // v3 added check-ins, accountability habits, meal plans and training programs.
  // v4 added decks and migrated review items from one-sided to front/back cards.
  const DB_VERSION = 4;

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
    checkIns:   { keyPath: 'date', indexes: [] },
    habits:     { keyPath: 'id', indexes: [] },
    habitLogs:  { keyPath: 'id', indexes: [['date', 'date'], ['habitId', 'habitId']] },
    mealPlans:  { keyPath: 'id', indexes: [['date', 'date']] },
    programRun: { keyPath: 'id', indexes: [] },

    // --- v4 ---
    decks: { keyPath: 'id', indexes: [['subjectId', 'subjectId']] },
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

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database blocked — close other Ygeia tabs and reload.'));
    });
    return dbPromise;
  }

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
    proteinPerKg: 1.8,
    // Manual overrides. When null the targets are derived from the profile.
    kcalOverride: null,
    proteinOverride: null,
    carbsOverride: null,
    fatOverride: null,
    // Display
    weightUnit: 'kg',      // 'kg' | 'lb'
    heightUnit: 'cm',      // 'cm' | 'in'
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
     * Substring search over the local library, ranked so that a prefix match on the name
     * beats a match buried in the middle, and shorter names beat longer ones. Loads all
     * foods and filters in memory: with a few thousand records that is well under a frame,
     * and it avoids maintaining a separate search index.
     */
    async search(query, limit) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return [];
      const list = await db.all('foods');
      const scored = [];
      for (const f of list) {
        const name = (f.name || '').toLowerCase();
        const brand = (f.brand || '').toLowerCase();
        let score = -1;
        if (name.startsWith(q)) score = 0;
        else if (name.includes(q)) score = 1;
        else if (brand.includes(q)) score = 2;
        if (score < 0) continue;
        // Custom foods first at equal relevance — the user's own entries are what they mean.
        scored.push({ f, score: score * 1000 + name.length - (f.source === 'custom' ? 500 : 0) });
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
     */
    async daily(type) {
      const s = await metrics.series(type);
      const byDay = V.groupBy(s, 'date');
      return Object.keys(byDay).sort().map((date) => ({
        date,
        value: V.sum(byDay[date], (x) => x.value) / byDay[date].length,
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

  // ------------------------------------------------------------- check-ins --

  const checkIns = {
    all: () => db.all('checkIns'),
    get: (date) => db.get('checkIns', date),
    save: (c) => db.put('checkIns', c),
    remove: (date) => db.remove('checkIns', date),

    /** Merge a partial answer set into the day's check-in, creating it if needed. */
    async patch(date, part, answers) {
      const existing = (await db.get('checkIns', date)) || { date };
      existing[part] = Object.assign({}, existing[part], answers);
      existing[part + 'At'] = Date.now();
      await db.put('checkIns', existing);
      return existing;
    },

    async recent(days) {
      const all = await db.all('checkIns');
      const since = V.addDays(V.today(), -((days || 30) - 1));
      return all.filter((c) => c.date >= since).sort((a, b) => (a.date < b.date ? -1 : 1));
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
    checkIns, habits, mealPlans, programs,
    open, SCHEMA,
  };
})(window.V);
