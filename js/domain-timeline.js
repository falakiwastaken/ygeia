/*
 * Ygeia — timeline assembly.
 *
 * Everything logged already carries a timestamp, so a day can be replayed in order:
 * what you ate and when, when you trained, when you studied, when you slept.
 *
 * Pure functions — the caller does the fetching and passes raw arrays in. That keeps this
 * testable and stops the view from having to know how events are ordered or grouped.
 */
(function (V) {
  'use strict';

  const T = {};

  /**
   * Categories. The colour is the same one that category uses everywhere else in the app,
   * so a dot on the calendar means the same thing as a bar on a chart.
   */
  T.CATEGORIES = {
    meal:    { label: 'Food',        color: 'var(--nutrition)', icon: '🍽' },
    workout: { label: 'Workout',     color: 'var(--strain)',    icon: '🏋' },
    sport:   { label: 'Sport',       color: 'var(--strain)',    icon: '🏃' },
    study:   { label: 'Study',       color: 'var(--info)',      icon: '📖' },
    sleep:   { label: 'Sleep',       color: 'var(--sleep)',     icon: '🌙' },
    checkin: { label: 'Check-in',    color: 'var(--recovery)',  icon: '✓' },
    metric:  { label: 'Measurement', color: 'var(--stress)',    icon: '📏' },
    weight:  { label: 'Weigh-in',    color: 'var(--stress)',    icon: '⚖' },
  };

  const METRIC_LABEL = {
    weight: 'Weight', body_fat_pct: 'Body fat', lean_mass: 'Lean mass',
    resting_hr: 'Resting heart rate', hrv: 'HRV', systolic: 'Systolic',
    diastolic: 'Diastolic', sleep_hours: 'Sleep', steps: 'Steps', vo2max: 'VO₂ max',
  };

  const METRIC_UNIT = {
    weight: 'kg', body_fat_pct: '%', lean_mass: 'kg', resting_hr: 'bpm', hrv: 'ms',
    systolic: 'mmHg', diastolic: 'mmHg', sleep_hours: 'h', steps: '', vo2max: '',
  };

  /**
   * Build one day's events, in the order they happened.
   *
   * @param {object} d raw data for the day
   * @param {Array}  d.foodLogs   resolved entries (with .food and .nutrients)
   * @param {Array}  d.workouts
   * @param {object} d.setsByWorkout  workoutId -> sets[]
   * @param {Array}  d.sports
   * @param {Array}  d.studySessions
   * @param {object} d.sleep       the night that ended on this date, or null
   * @param {object} d.checkIn
   * @param {Array}  d.metrics
   * @param {object} d.subjectsById
   */
  T.buildDay = function (d) {
    const events = [];
    const dayStart = V.parseKey(d.date).getTime();

    // ---- Meals -------------------------------------------------------------
    // Grouped by meal slot rather than one row per ingredient — twelve entries for one
    // dinner is a log, not a timeline.
    const byMeal = V.groupBy(d.foodLogs || [], 'meal');
    for (const slot in byMeal) {
      const entries = byMeal[slot];
      const kcal = V.sum(entries, (e) => (e.nutrients && e.nutrients.kcal) || 0);
      const at = Math.min.apply(null, entries.map((e) => e.loggedAt));

      events.push({
        at,
        category: 'meal',
        title: slot.charAt(0).toUpperCase() + slot.slice(1),
        detail: entries.map((e) => e.food.name).join(', '),
        value: V.fmt(kcal) + ' kcal',
        count: entries.length,
        ref: { type: 'meal', slot },
      });
    }

    // ---- Workouts ----------------------------------------------------------
    for (const w of d.workouts || []) {
      const sets = (d.setsByWorkout && d.setsByWorkout[w.id]) || [];
      const working = V.domain.workingSets(sets);
      const minutes = w.finishedAt ? Math.round((w.finishedAt - w.startedAt) / 60000) : null;

      events.push({
        at: w.startedAt,
        endAt: w.finishedAt || null,
        category: 'workout',
        title: w.name || 'Workout',
        detail: working.length
          ? `${working.length} sets · ${V.fmt(V.domain.volume(sets))} kg volume`
          : 'In progress',
        value: minutes != null ? minutes + ' min' : '●',
        ref: { type: 'workout', id: w.id },
      });
    }

    // ---- Sport -------------------------------------------------------------
    for (const s of d.sports || []) {
      events.push({
        at: s.startedAt,
        category: 'sport',
        title: s.sport,
        detail: `${s.durationMin} min · ${s.intensity}`,
        value: V.fmt(s.calories) + ' kcal',
        ref: { type: 'sport', id: s.id },
      });
    }

    // ---- Study -------------------------------------------------------------
    for (const s of d.studySessions || []) {
      const subject = d.subjectsById && d.subjectsById[s.subjectId];
      events.push({
        at: s.startedAt,
        endAt: s.endedAt || null,
        category: 'study',
        title: subject ? subject.name : 'Study',
        detail: s.technique ? 'Focus block · ' + s.technique : 'Focus block',
        value: s.minutes + ' min',
        ref: { type: 'study', id: s.id },
      });
    }

    // ---- Sleep -------------------------------------------------------------
    // Filed at the moment of waking, since that is when the night belongs to this day.
    if (d.sleep && d.sleep.wakeTimeMin != null) {
      events.push({
        at: dayStart + d.sleep.wakeTimeMin * 60000,
        category: 'sleep',
        title: 'Woke up',
        detail: `Slept ${V.study.formatTime(d.sleep.bedTimeMin)} – ${V.study.formatTime(d.sleep.wakeTimeMin)}` +
                (d.sleep.quality ? ` · ${'★'.repeat(d.sleep.quality)}` : ''),
        value: V.fmt(d.sleep.hours, 1) + ' h',
        ref: { type: 'sleep' },
      });
    }

    // ---- Check-ins ---------------------------------------------------------
    if (d.checkIn) {
      if (d.checkIn.morningAt) {
        const readiness = V.plan.readiness(d.checkIn);
        events.push({
          at: d.checkIn.morningAt,
          category: 'checkin',
          title: 'Morning check-in',
          detail: readiness != null ? 'Readiness ' + readiness + '/100' : 'Logged',
          value: '',
          ref: { type: 'checkin', part: 'morning' },
        });
      }
      if (d.checkIn.eveningAt) {
        events.push({
          at: d.checkIn.eveningAt,
          category: 'checkin',
          title: 'Evening check-in',
          detail: 'Logged',
          value: '',
          ref: { type: 'checkin', part: 'evening' },
        });
      }
    }

    // ---- Measurements ------------------------------------------------------
    for (const m of d.metrics || []) {
      events.push({
        at: m.recordedAt,
        category: m.type === 'weight' ? 'weight' : 'metric',
        title: METRIC_LABEL[m.type] || m.type,
        detail: m.source === 'import' ? 'Imported from Apple Health' : 'Logged',
        value: V.fmt(m.value, m.type === 'steps' ? 0 : 1) + ' ' + (METRIC_UNIT[m.type] || ''),
        // Imported values are daily aggregates, not the moment they were taken.
        approximateTime: m.source === 'import',
        ref: { type: 'metric', id: m.id, metric: m.type },
      });
    }

    events.sort((a, b) => a.at - b.at);
    return events;
  };

  /** Which categories a day contains — used for the dots on the month grid. */
  T.daySummary = function (events) {
    const set = [];
    for (const e of events) if (!set.includes(e.category)) set.push(e.category);
    // Stable, meaningful order rather than whatever happened first.
    const order = ['sleep', 'meal', 'workout', 'sport', 'study', 'checkin', 'weight', 'metric'];
    return set.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  };

  /**
   * Calendar grid for a month, padded to whole weeks.
   * @param {number} year
   * @param {number} month 0-based
   * @param {number} firstDayOfWeek 0 = Sunday, 1 = Monday
   */
  T.monthGrid = function (year, month, firstDayOfWeek) {
    const startOfWeek = firstDayOfWeek == null ? 1 : firstDayOfWeek;
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // How many blanks before the 1st, given the week starts on startOfWeek.
    const lead = (first.getDay() - startOfWeek + 7) % 7;

    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push(V.dateKey(new Date(year, month, day)));
    }
    // Pad the final week so the grid stays rectangular.
    while (cells.length % 7 !== 0) cells.push(null);

    return cells;
  };

  T.weekdayLabels = function (firstDayOfWeek) {
    const start = firstDayOfWeek == null ? 1 : firstDayOfWeek;
    const base = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const out = [];
    for (let i = 0; i < 7; i++) out.push(base[(start + i) % 7]);
    return out;
  };

  T.METRIC_LABEL = METRIC_LABEL;
  T.METRIC_UNIT = METRIC_UNIT;
  V.timeline = T;
})(window.V);
