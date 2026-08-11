/* Ygeia — Today: the day at a glance. */
(function (V) {
  'use strict';

  V.views = V.views || {};

  /** Where a gap came from, so the guideline is checkable rather than asserted. */
  function openGapSheet(gap) {
    V.ui.sheet(gap.label, (body) => {
      body.appendChild(
        V.el('div', {
          className: gap.severity === 'high' ? 'warn-box' : 'good-box',
          text: gap.message,
        }),
      );

      if (gap.target != null) {
        body.appendChild(
          V.el('div', { className: 'grid-2', style: { marginTop: '12px' } }, [
            V.ui.stat({ label: 'You', value: String(gap.actual), unit: gap.unit }),
            V.ui.stat({ label: 'Guideline', value: String(gap.target), unit: gap.unit }),
          ]),
        );
      }

      if (gap.source) {
        body.appendChild(V.ui.sectionTitle('Where this comes from'));
        body.appendChild(V.el('div', { className: 'hint', text: gap.source }));
      }

      body.appendChild(
        V.el('div', {
          className: 'hint',
          style: { marginTop: '12px' },
          text: 'This is a general population guideline compared against what you logged. ' +
                'It is not advice about your health, and nothing here interprets a symptom ' +
                'or a medical result.',
        }),
      );
    });
  }

  V.views.today = {
    async render(state) {
      const date = state.date;
      const settings = await V.store.settings.get();
      const targets = V.domain.macroTargets(settings);

      const [entries, workoutsToday, allLogs, allWorkouts] = await Promise.all([
        V.store.foodLog.resolved(date),
        V.store.workouts.byDate(date),
        V.store.db.all('foodLogs'),
        V.store.workouts.all(),
      ]);

      const totals = V.domain.sumNutrients(entries.map((e) => e.nutrients));
      const scored = V.domain.nutritionScore(entries, targets, settings);
      const root = V.el('div');

      // ---- Notes and accountability ---------------------------------------
      root.appendChild(await V.calendar.buildNotesCard(state));
      root.appendChild(await V.planView.buildHabitsCard(state));

      // ---- Calorie ring + macros ------------------------------------------
      const kcal = totals.kcal || 0;
      const remaining = targets.kcal - kcal;

      root.appendChild(
        V.ui.card({
          action: V.explain.button(async () => V.explain.calorieTarget(settings)),
          children: [
            V.el('div', { className: 'rings-row' }, [
              V.ui.ring({
                value: kcal,
                max: targets.kcal,
                color: 'var(--nutrition)',
                size: 116,
                stroke: 10,
                centerText: V.fmt(Math.abs(remaining)),
                centerSub: remaining >= 0 ? 'kcal left' : 'kcal over',
              }),
              V.el('div', { style: { flex: '1' } }, [
                V.ui.macroBar('Protein', totals.protein || 0, targets.protein, 'var(--protein)'),
                V.ui.macroBar('Carbs', totals.carbs || 0, targets.carbs, 'var(--carbs)'),
                V.ui.macroBar('Fat', totals.fat || 0, targets.fat, 'var(--fat)'),
              ]),
            ]),
          ],
        }),
      );

      // ---- Nutrition quality score ----------------------------------------
      if (scored.score != null) {
        const band = V.domain.scoreBand(scored.score);
        root.appendChild(
          V.ui.card({
            title: 'Nutrition quality',
            sub: band.label,
            action: V.el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
              V.el('div', { className: 'stat-value', style: { color: band.color }, text: String(scored.score) }),
              V.explain.button(async () => V.explain.nutritionScore(scored)),
            ]),
            children: [
              V.el('div', {},
                scored.components
                  .slice()
                  .sort((a, b) => a.value - b.value)
                  .slice(0, 3)
                  .map((c) =>
                    V.el('div', { className: 'macro-block' }, [
                      V.el('div', { className: 'macro-row' }, [
                        V.el('span', { text: c.label }),
                        V.el('span', { className: 'row-sub', text: c.detail || '' }),
                      ]),
                      V.ui.bar(c.value, 100, V.domain.scoreBand(c.value).color),
                    ]),
                  ),
              ),
              V.el('div', { className: 'hint', text: 'Scores the whole day, not individual foods. Lowest three shown.' }),
            ],
          }),
        );
      }

      // ---- Meals ------------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Meals'));
      if (!entries.length) {
        root.appendChild(
          V.ui.card({
            children: [
              V.ui.empty('Nothing logged yet.'),
              V.ui.button('Add food', () => V.app.go('food'), 'btn-primary'),
            ],
          }),
        );
      } else {
        const byMeal = V.groupBy(entries, 'meal');
        const rows = [];
        for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
          const list = byMeal[meal];
          if (!list || !list.length) continue;
          const mealKcal = V.sum(list, (e) => e.nutrients.kcal || 0);
          rows.push(
            V.ui.row({
              title: meal.charAt(0).toUpperCase() + meal.slice(1),
              sub: list.map((e) => e.food.name).join(', '),
              value: V.fmt(mealKcal) + ' kcal',
              onClick: () => V.app.go('food'),
            }),
          );
        }
        root.appendChild(V.ui.list(rows));
      }

      // ---- Training ---------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Training'));
      if (!workoutsToday.length) {
        root.appendChild(
          V.ui.card({
            children: [
              V.ui.empty('No workout logged.'),
              V.ui.button('Start a workout', () => V.app.go('train'), 'btn-primary'),
            ],
          }),
        );
      } else {
        const rows = [];
        for (const w of workoutsToday) {
          const sets = await V.store.sets.byWorkout(w.id);
          const working = V.domain.workingSets(sets);
          const volume = V.domain.volume(sets);
          rows.push(
            V.ui.row({
              title: w.name || 'Workout',
              sub: w.finishedAt
                ? `${working.length} sets · ${V.fmt(volume)} kg volume`
                : 'In progress',
              value: w.finishedAt
                ? Math.round((w.finishedAt - w.startedAt) / 60000) + ' min'
                : '●',
              onClick: () => V.app.go('train'),
            }),
          );
        }
        root.appendChild(V.ui.list(rows));
      }

      // ---- Streaks and weight ----------------------------------------------
      const loggedDays = Array.from(new Set(allLogs.map((l) => l.date)));
      const workoutDays = Array.from(new Set(allWorkouts.filter((w) => w.finishedAt).map((w) => w.date)));
      const weightDaily = await V.store.metrics.daily('weight');

      const tiles = [
        V.ui.stat({
          label: 'Food streak',
          value: String(V.domain.streak(loggedDays)),
          unit: 'd',
        }),
        V.ui.stat({
          label: 'Workouts (7d)',
          value: String(workoutDays.filter((d) => V.daysBetween(d, V.today()) < 7).length),
        }),
      ];

      if (weightDaily.length) {
        const latest = weightDaily[weightDaily.length - 1];
        const trend = V.domain.trend(weightDaily.slice(-30), 30);
        const unit = settings.weightUnit;
        tiles.push(
          V.ui.stat({
            label: 'Weight',
            value: V.fmt(V.kgToDisplay(latest.value, unit), 1),
            unit: ' ' + unit,
            deltaText: trend && trend.reliable
              ? `${trend.perWeek >= 0 ? '+' : ''}${V.fmt(V.kgToDisplay(trend.perWeek, unit), 2)} ${unit}/wk`
              : null,
            delta: trend ? trend.perWeek : null,
            higherIsBetter: settings.goal === 'lean_bulk',
          }),
        );
      }

      root.appendChild(V.ui.sectionTitle('Trends'));
      root.appendChild(V.el('div', { className: 'grid-3' }, tiles));

      // ---- 7-day calorie history -------------------------------------------
      const days = V.lastNDays(7, date);
      const logsByDate = V.groupBy(allLogs, 'date');
      const foodsById = {};
      for (const f of await V.store.foods.all()) foodsById[f.id] = f;

      const bars = days.map((d) => {
        const list = logsByDate[d] || [];
        const dayKcal = V.sum(list, (l) => {
          const f = foodsById[l.foodId];
          return f ? (f.per100.kcal * l.grams) / 100 : 0;
        });
        return { label: V.parseKey(d).toLocaleDateString(undefined, { weekday: 'narrow' }), value: dayKcal };
      });

      if (V.sum(bars, (b) => b.value) > 0) {
        root.appendChild(
          V.ui.card({
            title: 'Last 7 days',
            sub: `Target ${V.fmt(targets.kcal)} kcal`,
            children: [V.charts.bars(bars, { target: targets.kcal, color: 'var(--nutrition)' })],
          }),
        );
      }

      // ---- What you're missing ----------------------------------------------
      // Deterministic: each gap is a subtraction against a cited guideline, not an
      // opinion. It works with no AI installed; the coach just narrates the same figures.
      const gaps = await V.coachView.findGaps();
      if (gaps.length) {
        root.appendChild(V.ui.sectionTitle('What you’re missing'));
        root.appendChild(
          V.ui.list(
            gaps.slice(0, 4).map((g) =>
              V.ui.row({
                title: g.label,
                sub: g.message,
                value: g.short != null ? '−' + g.short + g.unit : '',
                accessory: V.el('span', {
                  className: 'subject-dot',
                  style: {
                    background: g.severity === 'high' ? 'var(--bad)'
                      : g.severity === 'medium' ? 'var(--warn)' : 'var(--text-faint)',
                  },
                }),
                onClick: () => openGapSheet(g),
              }),
            ),
          ),
        );
      }

      // ---- Insights ---------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Analysis'));
      root.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Insights',
            sub: 'Correlations across everything you log',
            value: '›',
            onClick: () => V.planView.openInsightsSheet(),
          }),
          V.ui.row({
            title: 'Meal ideas & shopping list',
            sub: 'Bulk-store meals that fit your remaining macros',
            value: '›',
            onClick: () => V.planView.openMealPlannerSheet(),
          }),
        ]),
      );

      return root;
    },
  };
})(window.V);
