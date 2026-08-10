/*
 * Vitals — persistence.
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

  const DB_NAME = 'vitals';
  const DB_VERSION = 1;

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
        void e;
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database blocked — close other Vitals tabs and reload.'));
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
    theme: 'auto',         // 'auto' | 'dark' | 'light'
    firstDayOfWeek: 1,
    // Nutrition rules
    lateMealHour: 21,          // meals after this hour are "late"
    lateMealMinKcal: 150,      // ...but only if they exceed this, so water/supplements don't count
    // Training
    barWeightKg: 20,
    availablePlatesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
    defaultRestSec: 120,
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

  V.store = { db, settings, foods, foodLog, exercises, workouts, sets, templates, metrics, open, SCHEMA };
})(window.V);
