/*
 * Ygeia — accountability, meal planning and training programs.
 *
 * Pure functions. No DOM, no storage.
 *
 * The daily check-in that used to live here has been removed. It asked four questions
 * every morning and three every evening to produce a "readiness" score, which is a lot of
 * friction for one number — and the things it was correlated against are already measured
 * directly by sleep, training volume and nutrition.
 */
(function (V) {
  'use strict';

  const P = {};

  // =========================================================================
  // Accountability habits
  // =========================================================================

  /**
   * Simple daily commitments, tracked yes/no.
   *
   * Deliberately binary. Partial credit turns a habit tracker into a negotiation, and the
   * point of a commitment is that it is unambiguous.
   */
  P.SUGGESTED_HABITS = [
    { name: 'Hit protein target', icon: '🥩' },
    { name: 'In bed by target time', icon: '🌙' },
    { name: 'Trained today', icon: '🏋' },
    { name: '10k steps', icon: '👟' },
    { name: 'No alcohol', icon: '🚫' },
    { name: 'Studied', icon: '📖' },
    { name: 'Logged all meals', icon: '📝' },
    { name: 'Stretched', icon: '🧘' },
  ];

  /** Completion rate over a window, plus the current streak. */
  P.habitStats = function (habit, logs, days) {
    const window = days || 30;
    const since = V.addDays(V.today(), -(window - 1));
    const relevant = logs.filter((l) => l.habitId === habit.id && l.date >= since);
    const done = relevant.filter((l) => l.done);

    return {
      completed: done.length,
      // Only count days since the habit was created — a habit added yesterday should not
      // show a 3% completion rate.
      possible: Math.min(window, V.daysBetween(V.dateKey(new Date(habit.createdAt)), V.today()) + 1),
      streak: V.domain.streak(done.map((l) => l.date)),
      rate: relevant.length ? done.length / relevant.length : 0,
    };
  };

  // =========================================================================
  // Meal planning
  // =========================================================================

  /** Total nutrients for one serving of a meal template. */
  P.mealNutrients = function (meal, foodsById) {
    const parts = meal.ingredients
      .map((ing) => {
        const food = foodsById[ing.foodId];
        return food ? V.domain.scaleNutrients(food.per100, ing.grams) : null;
      })
      .filter(Boolean);
    return V.domain.sumNutrients(parts);
  };

  /** Ingredients a meal references that aren't in the library — used to flag broken data. */
  P.missingIngredients = function (meal, foodsById) {
    return meal.ingredients.filter((i) => !foodsById[i.foodId]).map((i) => i.foodId);
  };

  /**
   * Aggregate a set of planned meals into a shopping list.
   *
   * Quantities are summed per ingredient across every planned serving, then rounded up to
   * something you can actually buy — nobody buys 347 g of chicken.
   */
  P.shoppingList = function (plannedMeals, foodsById) {
    const totals = {};

    for (const entry of plannedMeals) {
      const meal = entry.meal;
      const servings = entry.servings || 1;
      for (const ing of meal.ingredients) {
        totals[ing.foodId] = (totals[ing.foodId] || 0) + ing.grams * servings;
      }
    }

    return Object.keys(totals)
      .map((foodId) => {
        const food = foodsById[foodId];
        if (!food) return null;
        const grams = totals[foodId];
        return {
          foodId,
          name: food.name,
          grams,
          display: P.formatShoppingQuantity(grams, food),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  /** Turn a gram total into a sensible shopping quantity. */
  P.formatShoppingQuantity = function (grams, food) {
    // Eggs and similar are far more useful as a count than a weight.
    const unitServing = (food.servings || []).find((s) => /egg|slice|wrap|bagel|biscuit/i.test(s.label));
    if (unitServing && unitServing.grams > 0) {
      return Math.ceil(grams / unitServing.grams) + ' × ' + unitServing.label;
    }
    if (grams >= 1000) return V.fmt(Math.ceil(grams / 100) / 10, 1) + ' kg';
    if (grams >= 100) return Math.ceil(grams / 50) * 50 + ' g';
    return Math.ceil(grams / 10) * 10 + ' g';
  };

  /** Filter meals by tag and maximum prep time. */
  P.filterMeals = function (meals, opts) {
    const o = opts || {};
    return meals.filter((m) => {
      if (o.maxMinutes && m.timeMin > o.maxMinutes) return false;
      if (o.tag && !m.tags.includes(o.tag)) return false;
      return true;
    });
  };

  /**
   * Suggest meals that move the day toward its remaining macro budget.
   * Ranked by how well one serving fits what is left, with a penalty for overshooting
   * calories — a meal that blows the budget is not a good suggestion however good its protein.
   */
  P.suggestMeals = function (meals, remaining, foodsById, limit) {
    if (remaining.kcal <= 0) return [];

    return meals
      .map((meal) => {
        const n = P.mealNutrients(meal, foodsById);
        const kcalFit = 1 - Math.abs(n.kcal - remaining.kcal) / Math.max(remaining.kcal, 1);
        const proteinFit = remaining.protein > 0
          ? Math.min(1, (n.protein || 0) / remaining.protein)
          : 0;
        const overshoot = n.kcal > remaining.kcal * 1.15 ? -0.6 : 0;
        return { meal, nutrients: n, score: kcalFit * 0.5 + proteinFit * 0.5 + overshoot };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit || 5);
  };

  // =========================================================================
  // Training programs
  // =========================================================================

  /**
   * Which session is next in the rotation.
   * Programs cycle through their days in order rather than being pinned to weekdays, so
   * missing a Tuesday doesn't mean skipping legs — it just shifts everything along.
   */
  P.nextSession = function (program, completedCount) {
    if (!program || !program.days.length) return null;
    const index = (completedCount || 0) % program.days.length;
    return { index, day: program.days[index] };
  };

  /**
   * Turn a program day into concrete sets, pre-filled from the last time each exercise
   * was trained so the user starts from where they left off rather than from zero.
   */
  P.buildSession = function (day, historyByExercise, exercisesById) {
    return day.exercises.map((slot) => {
      const history = historyByExercise[slot.exerciseId] || [];
      const exercise = exercisesById[slot.exerciseId];

      let weightKg = 0;
      let reps = slot.repMin;

      if (history.length) {
        const lastWorkoutId = history[history.length - 1].workoutId;
        const lastSets = V.domain.workingSets(history.filter((h) => h.workoutId === lastWorkoutId));
        const suggestion = V.domain.suggestProgression(lastSets, exercise, { min: slot.repMin, max: slot.repMax });
        if (suggestion) {
          weightKg = suggestion.weightKg;
          reps = suggestion.reps;
        }
      }

      return {
        exerciseId: slot.exerciseId,
        exercise,
        sets: slot.sets,
        repMin: slot.repMin,
        repMax: slot.repMax,
        weightKg,
        reps,
        isNew: history.length === 0,
      };
    });
  };

  /** Adherence: sessions completed against sessions expected since starting. */
  P.programAdherence = function (program, startedAt, completedCount) {
    const weeks = Math.max(1 / 7, (Date.now() - startedAt) / (7 * 86400000));
    const expected = Math.max(1, Math.round(weeks * program.daysPerWeek));
    return {
      expected,
      completed: completedCount,
      pct: V.clamp((completedCount / expected) * 100, 0, 100),
      weeks,
    };
  };

  V.plan = P;
})(window.V);
