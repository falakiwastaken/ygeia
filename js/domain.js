/*
 * Ygeia — domain logic.
 *
 * Pure functions only: no DOM, no storage, no network. Everything here is deterministic
 * and directly testable, which matters because these are the numbers the user makes
 * decisions from.
 *
 * Canonical units: kg, cm, kcal, grams, mg for sodium, epoch-ms for timestamps.
 */
(function (V) {
  'use strict';

  const D = {};

  // =========================================================================
  // Energy expenditure
  // =========================================================================

  /**
   * Mifflin-St Jeor sex constant. Published as +5 for men, -161 for women;
   * 'unspecified' takes the midpoint rather than silently assuming one.
   */
  const SEX_CONSTANT = { male: 5, female: -161, unspecified: (5 - 161) / 2 };

  /**
   * Lifestyle activity multipliers. These already include exercise, so logged workouts
   * must NOT be added on top — double-counting training is the most common way calorie
   * targets get quietly inflated.
   */
  D.ACTIVITY_MULTIPLIER = {
    sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
  };

  D.ACTIVITY_LABEL = {
    sedentary: 'Desk job, little or no exercise',
    light: 'Light exercise 1–3 days/week',
    moderate: 'Moderate exercise 3–5 days/week',
    active: 'Hard exercise 6–7 days/week',
    very_active: 'Physical job or training twice a day',
  };

  /** Deliberately gentle: deep deficits cost lean mass and get abandoned. */
  D.GOAL_MULTIPLIER = { cut: 0.8, maintain: 1.0, lean_bulk: 1.1 };
  D.GOAL_LABEL = { cut: 'Lose fat', maintain: 'Maintain', lean_bulk: 'Lean bulk' };

  /** Basal metabolic rate, kcal/day (Mifflin-St Jeor 1990). */
  D.bmr = function (p) {
    const c = SEX_CONSTANT[p.sex] != null ? SEX_CONSTANT[p.sex] : SEX_CONSTANT.unspecified;
    return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + c;
  };

  /** Total daily energy expenditure, kcal/day. */
  D.tdee = function (p) {
    return D.bmr(p) * (D.ACTIVITY_MULTIPLIER[p.activityLevel] || 1.55);
  };

  /** Calorie target for the profile's goal, floored at BMR so it can never be unsafe. */
  D.calorieTarget = function (p) {
    const raw = D.tdee(p) * (D.GOAL_MULTIPLIER[p.goal] != null ? D.GOAL_MULTIPLIER[p.goal] : 1);
    return Math.round(Math.max(raw, D.bmr(p)));
  };

  /**
   * Macro targets derived from bodyweight rather than fixed percentages.
   *
   * Protein is set per kg (default 1.8 g/kg — inside the 1.6–2.2 range where the
   * resistance-training benefit plateaus). Fat is the greater of 25% of calories and
   * 0.6 g/kg, keeping hormone-supporting intake adequate even in a deficit. Carbohydrate
   * absorbs the remainder, so it flexes with the calorie goal instead of squeezing protein.
   *
   * Any of the four can be overridden by the user; overrides win untouched.
   */
  D.macroTargets = function (settings) {
    const kcal = settings.kcalOverride != null ? settings.kcalOverride : D.calorieTarget(settings);
    const proteinPerKg = settings.proteinPerKg || 1.8;

    let protein = settings.proteinOverride != null
      ? settings.proteinOverride
      : Math.round(settings.weightKg * proteinPerKg);

    let fat = settings.fatOverride != null
      ? settings.fatOverride
      : Math.round(Math.max((kcal * 0.25) / 9, settings.weightKg * 0.6));

    let carbs = settings.carbsOverride != null
      ? settings.carbsOverride
      : Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

    return { kcal: Math.round(kcal), protein, carbs, fat };
  };

  /**
   * Compare the measured weight trend against the goal and suggest a calorie change.
   *
   * This is what makes the estimate self-correcting: predictive equations are wrong for
   * any given individual by up to ~10%, but the scale tells the truth over a few weeks.
   * Uses 7700 kcal per kg of mixed tissue.
   *
   * @returns kcal/day adjustment rounded to 25, or 0 when the trend is on target
   */
  D.suggestCalorieAdjustment = function (goal, actualKgPerWeek, weightKg) {
    const target = D.targetWeeklyRate(goal, weightKg);
    const error = actualKgPerWeek - target;

    // Inside this band the trend is indistinguishable from scale noise (water, glycogen,
    // gut content), so acting on it would be chasing measurement error.
    if (Math.abs(error) < 0.1) return 0;

    const adjustment = -(error * 7700) / 7;
    // Cap one correction so a single noisy fortnight can't swing the target wildly.
    return Math.round(V.clamp(adjustment, -300, 300) / 25) * 25;
  };

  D.targetWeeklyRate = function (goal, weightKg) {
    if (goal === 'cut') return -0.0075 * weightKg;       // ~0.75%/wk, lean-mass sparing
    if (goal === 'lean_bulk') return 0.0025 * weightKg;  // ~0.25%/wk, minimises fat gain
    return 0;
  };

  // =========================================================================
  // Nutrients
  // =========================================================================

  /** Nutrient fields that scale linearly with portion size. */
  const NUTRIENT_KEYS = [
    'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'addedSugar',
    'saturatedFat', 'sodium', 'potassium', 'calcium', 'iron',
  ];

  /**
   * Scale per-100g nutrients to an actual portion.
   * Absent fields stay absent — "unknown" and "zero" are different, and the nutrition
   * score depends on being able to tell them apart.
   */
  D.scaleNutrients = function (per100, grams) {
    const factor = (Number(grams) || 0) / 100;
    const out = {};
    for (const k of NUTRIENT_KEYS) {
      if (per100 && per100[k] != null) out[k] = per100[k] * factor;
    }
    return out;
  };

  /** Element-wise sum. A field is present in the result if any input had it. */
  D.sumNutrients = function (list) {
    const out = {};
    for (const n of list) {
      for (const k of NUTRIENT_KEYS) {
        if (n && n[k] != null) out[k] = (out[k] || 0) + n[k];
      }
    }
    return out;
  };

  /** Calories implied by the macros, for sanity-checking user-entered custom foods. */
  D.kcalFromMacros = (n) => (n.protein || 0) * 4 + (n.carbs || 0) * 4 + (n.fat || 0) * 9;

  // =========================================================================
  // Nutrition score
  // =========================================================================

  /**
   * Daily food-quality score, 0–100.
   *
   * Scores the DAY, not individual foods — a biscuit is not "bad" in isolation, it is only
   * meaningful against everything else eaten. This mirrors the direction Bevel moved in
   * with its 2.3 rewrite, and it avoids the moralising that per-food grading produces.
   *
   * Components whose data is missing are dropped and the remaining weights renormalised,
   * so a day logged with bare macros scores on what is actually known rather than being
   * punished for absent micronutrient data.
   */
  D.nutritionScore = function (entries, targets, settings) {
    if (!entries.length) return { score: null, components: [], totals: {} };

    const totals = D.sumNutrients(entries.map((e) => e.nutrients));
    const kcal = totals.kcal || 0;
    const components = [];

    const add = (key, label, weight, value, detail) => {
      if (value == null) return;
      components.push({ key, label, weight, value: V.clamp(value, 0, 100), detail });
    };

    // -- Protein adequacy (weight 20) ------------------------------------
    // Ramps to full marks at target and stays there; overshooting protein isn't penalised.
    if (targets.protein > 0) {
      const ratio = (totals.protein || 0) / targets.protein;
      add('protein', 'Protein', 20, V.clamp(ratio, 0, 1) * 100,
        `${V.fmt(totals.protein)}g of ${V.fmt(targets.protein)}g`);
    }

    // -- Fiber (weight 15) -----------------------------------------------
    // 14 g per 1000 kcal is the Institute of Medicine adequate-intake basis.
    if (totals.fiber != null && kcal > 0) {
      const target = Math.max(14 * (kcal / 1000), 12);
      add('fiber', 'Fiber', 15, V.clamp(totals.fiber / target, 0, 1) * 100,
        `${V.fmt(totals.fiber)}g of ${V.fmt(target)}g`);
    }

    // -- Whole-food ratio (weight 20) ------------------------------------
    // Share of calories from NOVA 1–2 (unprocessed / culinary ingredients) against
    // calories whose processing level is actually known.
    let knownKcal = 0, wholeKcal = 0;
    for (const e of entries) {
      const c = e.nutrients.kcal || 0;
      if (e.food && e.food.novaGroup) {
        knownKcal += c;
        if (e.food.novaGroup <= 2) wholeKcal += c;
      }
    }
    // Below half the day's calories the sample is too thin to say anything useful.
    if (knownKcal > 0 && kcal > 0 && knownKcal / kcal >= 0.5) {
      const pct = (wholeKcal / knownKcal) * 100;
      add('whole', 'Whole foods', 20, pct, `${V.fmt(pct)}% of calories minimally processed`);
    }

    // -- Added sugar (weight 15) -----------------------------------------
    // Full marks at or below the WHO 10%-of-energy guideline, zero at 25%.
    if (totals.addedSugar != null && kcal > 0) {
      const pct = ((totals.addedSugar * 4) / kcal) * 100;
      const score = pct <= 10 ? 100 : V.clamp(100 - ((pct - 10) / 15) * 100, 0, 100);
      add('sugar', 'Added sugar', 15, score, `${V.fmt(pct, 1)}% of calories`);
    }

    // -- Saturated fat (weight 10) ---------------------------------------
    if (totals.saturatedFat != null && kcal > 0) {
      const pct = ((totals.saturatedFat * 9) / kcal) * 100;
      const score = pct <= 10 ? 100 : V.clamp(100 - ((pct - 10) / 10) * 100, 0, 100);
      add('satfat', 'Saturated fat', 10, score, `${V.fmt(pct, 1)}% of calories`);
    }

    // -- Sodium (weight 10) ----------------------------------------------
    if (totals.sodium != null) {
      const score = totals.sodium <= 2300 ? 100 : V.clamp(100 - ((totals.sodium - 2300) / 2300) * 100, 0, 100);
      add('sodium', 'Sodium', 10, score, `${V.fmt(totals.sodium)}mg`);
    }

    // -- Meal timing (weight 10) -----------------------------------------
    // Only substantial late meals count. Without the calorie floor, a glass of water or a
    // magnesium tablet before bed would register as a late meal — which is the exact
    // false positive Bevel added its own threshold to fix.
    const lateHour = settings.lateMealHour != null ? settings.lateMealHour : 21;
    const minKcal = settings.lateMealMinKcal != null ? settings.lateMealMinKcal : 150;
    const lateKcal = V.sum(
      entries.filter((e) => new Date(e.loggedAt).getHours() >= lateHour),
      (e) => e.nutrients.kcal || 0,
    );
    const isLate = lateKcal >= minKcal;
    add('timing', 'Meal timing', 10,
      isLate ? V.clamp(100 - ((lateKcal - minKcal) / 500) * 100, 40, 100) : 100,
      isLate ? `${V.fmt(lateKcal)} kcal after ${lateHour}:00` : 'No late meals');

    if (!components.length) return { score: null, components: [], totals };

    // Renormalise across whichever components had data.
    const totalWeight = V.sum(components, (c) => c.weight);
    const score = Math.round(V.sum(components, (c) => c.value * c.weight) / totalWeight);

    return { score, components, totals, lateKcal, isLateMeal: isLate };
  };

  /** Shared 0–100 banding, so colour means the same thing on every screen. */
  D.scoreBand = function (score) {
    if (score == null) return { label: 'No data', color: 'var(--text-faint)' };
    if (score >= 85) return { label: 'Excellent', color: 'var(--good)' };
    if (score >= 70) return { label: 'Good', color: 'var(--recovery)' };
    if (score >= 50) return { label: 'Fair', color: 'var(--warn)' };
    return { label: 'Poor', color: 'var(--bad)' };
  };

  // =========================================================================
  // Strength
  // =========================================================================

  /**
   * Estimated one-rep max.
   *
   * Brzycki is more accurate at low reps, Epley at higher ones, so this blends them with
   * a rep-dependent weight instead of picking a side. Above 12 reps every formula degrades
   * badly, so reps are capped there and the result is explicitly an estimate.
   */
  D.estimate1RM = function (weightKg, reps) {
    if (!weightKg || !reps || reps < 1) return 0;
    if (reps === 1) return weightKg;

    const r = Math.min(reps, 12);
    const brzycki = weightKg * (36 / (37 - r));
    const epley = weightKg * (1 + r / 30);
    // At r=2 trust Brzycki almost entirely; by r=12 the two are weighted evenly.
    const epleyWeight = V.clamp((r - 2) / 20, 0, 0.5);
    return brzycki * (1 - epleyWeight) + epley * epleyWeight;
  };

  /** Weight that should be achievable for `targetReps`, inverting Brzycki. */
  D.weightForReps = function (oneRM, targetReps) {
    if (!oneRM || targetReps < 1) return 0;
    return (oneRM * (37 - Math.min(targetReps, 12))) / 36;
  };

  /** Total tonnage. Warmups excluded — they inflate volume without driving adaptation. */
  D.volume = function (sets) {
    return V.sum(
      sets.filter((s) => s.completed && s.type !== 'warmup'),
      (s) => (s.weightKg || 0) * (s.reps || 0),
    );
  };

  D.workingSets = (sets) => sets.filter((s) => s.completed && s.type !== 'warmup');

  /**
   * Personal records across a set history for one exercise.
   * Tracks three independent records because they move independently: a heavy single, a
   * rep record at a given load, and best estimated 1RM.
   */
  D.personalRecords = function (sets) {
    const working = D.workingSets(sets);
    if (!working.length) return null;

    let heaviest = working[0], best1RM = working[0], mostReps = working[0];
    for (const s of working) {
      if (s.weightKg > heaviest.weightKg) heaviest = s;
      if (D.estimate1RM(s.weightKg, s.reps) > D.estimate1RM(best1RM.weightKg, best1RM.reps)) best1RM = s;
      if (s.reps > mostReps.reps) mostReps = s;
    }
    return {
      heaviest,
      mostReps,
      best1RM,
      estimated1RM: D.estimate1RM(best1RM.weightKg, best1RM.reps),
    };
  };

  /** True if `set` beats every set in `history` on estimated 1RM. */
  D.isPR = function (set, history) {
    if (!set.completed || set.type === 'warmup' || !set.reps) return false;
    const target = D.estimate1RM(set.weightKg, set.reps);
    if (target <= 0) return false;
    return D.workingSets(history).every(
      (h) => h.id === set.id || D.estimate1RM(h.weightKg, h.reps) < target,
    );
  };

  /**
   * Progressive-overload suggestion for the next session.
   *
   * Double progression: add reps within the range first, and only add load once the top of
   * the range is reached on every set at a manageable RPE. Lower-body lifts take bigger
   * jumps because they involve more muscle and tolerate larger absolute increments.
   */
  D.suggestProgression = function (lastSets, exercise, repRange) {
    const working = D.workingSets(lastSets);
    if (!working.length) return null;

    const range = repRange || { min: 6, max: 10 };
    const topWeight = Math.max(...working.map((s) => s.weightKg));
    const atTop = working.filter((s) => s.weightKg >= topWeight);
    const allMaxedReps = atTop.every((s) => s.reps >= range.max);
    // Missing RPE is treated as "fine" — most people don't log it, and blocking
    // progression on an optional field would make the feature useless.
    const rpeOk = atTop.every((s) => s.rpe == null || s.rpe <= 8.5);

    if (allMaxedReps && rpeOk) {
      const increment = exercise && exercise.isLowerBody ? 5 : 2.5;
      return {
        action: 'increase_weight',
        weightKg: topWeight + increment,
        reps: range.min,
        reason: `Hit ${range.max} reps on every set — add ${increment}kg and reset to ${range.min}.`,
      };
    }

    const minReps = Math.min(...atTop.map((s) => s.reps));
    if (minReps < range.max) {
      return {
        action: 'increase_reps',
        weightKg: topWeight,
        reps: Math.min(minReps + 1, range.max),
        reason: `Same weight — aim for ${Math.min(minReps + 1, range.max)} reps.`,
      };
    }
    return { action: 'hold', weightKg: topWeight, reps: range.max, reason: 'Repeat last session.' };
  };

  /**
   * Plates to load on each side of the bar.
   * Greedy largest-first, which is optimal for the doubling-ish plate sets gyms actually
   * stock. `remainderKg` is non-zero when the target isn't reachable with what's available.
   */
  D.platesPerSide = function (targetKg, barKg, availableKg) {
    const perSide = (targetKg - barKg) / 2;
    if (perSide <= 0) return { plates: [], perSide: 0, remainderKg: Math.max(0, targetKg - barKg) };

    const plates = [];
    let left = perSide;
    for (const p of [...availableKg].sort((a, b) => b - a)) {
      while (left >= p - 1e-9) { plates.push(p); left -= p; }
    }
    return { plates, perSide, remainderKg: V.round(left, 3) };
  };

  // =========================================================================
  // Trends and projections
  // =========================================================================

  /**
   * Ordinary least-squares fit over {x, y} points.
   * Returns slope, intercept and r² — r² is surfaced in the UI so a projection drawn
   * through noise is visibly untrustworthy rather than falsely confident.
   */
  D.linearRegression = function (points) {
    const n = points.length;
    if (n < 2) return null;

    const meanX = V.sum(points, (p) => p.x) / n;
    const meanY = V.sum(points, (p) => p.y) / n;

    let num = 0, den = 0;
    for (const p of points) {
      num += (p.x - meanX) * (p.y - meanY);
      den += (p.x - meanX) ** 2;
    }
    if (den === 0) return null; // all samples on one day — no trend to fit

    const slope = num / den;
    const intercept = meanY - slope * meanX;

    let ssTot = 0, ssRes = 0;
    for (const p of points) {
      ssTot += (p.y - meanY) ** 2;
      ssRes += (p.y - (slope * p.x + intercept)) ** 2;
    }
    const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

    return { slope, intercept, r2, n, predict: (x) => slope * x + intercept };
  };

  /**
   * Fit a trend to daily {date, value} samples and project forward.
   * x is days since the first sample, so slope is directly "units per day".
   */
  D.trend = function (daily, projectDays) {
    if (!daily || daily.length < 2) return null;

    const first = daily[0].date;
    const points = daily.map((d) => ({ x: V.daysBetween(first, d.date), y: d.value }));
    const fit = D.linearRegression(points);
    if (!fit) return null;

    const lastX = points[points.length - 1].x;
    const days = projectDays || 30;
    const projection = [];
    for (let i = 1; i <= days; i++) {
      projection.push({ date: V.addDays(daily[daily.length - 1].date, i), value: fit.predict(lastX + i) });
    }

    return {
      slope: fit.slope,
      perWeek: fit.slope * 7,
      r2: fit.r2,
      n: fit.n,
      current: fit.predict(lastX),
      projection,
      projected: fit.predict(lastX + days),
      // Below this the scatter is mostly noise and the projection shouldn't be trusted.
      reliable: fit.r2 >= 0.3 && fit.n >= 5,
    };
  };

  /** Exponential moving average — smooths day-to-day weight noise for display. */
  D.ema = function (values, alpha) {
    const a = alpha || 0.25;
    const out = [];
    let prev = null;
    for (const v of values) {
      prev = prev == null ? v : a * v + (1 - a) * prev;
      out.push(prev);
    }
    return out;
  };

  /** Consecutive days ending today (or yesterday) that satisfy `has`. */
  D.streak = function (dateKeys) {
    const set = new Set(dateKeys);
    let cursor = V.today();
    // Today not being logged yet shouldn't break a streak mid-morning.
    if (!set.has(cursor)) {
      cursor = V.addDays(cursor, -1);
      if (!set.has(cursor)) return 0;
    }
    let count = 0;
    while (set.has(cursor)) { count++; cursor = V.addDays(cursor, -1); }
    return count;
  };

  V.domain = D;
})(window.V);
