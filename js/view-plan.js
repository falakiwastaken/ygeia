/*
 * Ygeia — check-ins, accountability, meal planning, training programs and insights.
 *
 * These surfaces are shared across tabs rather than owning one, so they live together
 * here and are called from Today, Food and Train.
 */
(function (V) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  // ============================================================ accountability

  async function buildHabitsCard(state) {
    const [all, logs] = await Promise.all([V.store.habits.all(), V.store.habits.logsByDate(state.date)]);
    if (!all.length) {
      return V.ui.card({
        title: 'Accountability',
        sub: 'Daily commitments you either did or did not do',
        children: [V.ui.button('Set up habits', openHabitsManageSheet, 'btn-ghost')],
      });
    }

    const doneById = {};
    for (const l of logs) doneById[l.habitId] = l.done;
    const doneCount = all.filter((h) => doneById[h.id]).length;

    const rows = all.map((h) =>
      V.ui.row({
        title: (h.icon ? h.icon + '  ' : '') + h.name,
        accessory: V.el('button', {
          className: 'set-done' + (doneById[h.id] ? ' on' : ''),
          type: 'button',
          text: '✓',
          'aria-label': 'Mark ' + h.name,
          on: {
            click: async (e) => {
              e.stopPropagation();
              await V.store.habits.setDone(h.id, state.date, !doneById[h.id]);
              V.haptic(10);
              V.app.render();
            },
          },
        }),
      }),
    );

    return V.ui.card({
      title: 'Accountability',
      sub: `${doneCount} of ${all.length} done today`,
      action: V.el('button', {
        className: 'icon-btn', type: 'button', text: '⋯',
        'aria-label': 'Manage habits',
        on: { click: openHabitsManageSheet },
      }),
      children: [V.ui.list(rows)],
    });
  }

  function openHabitsManageSheet() {
    V.ui.sheet('Habits', async (body) => {
      const [all, logs] = await Promise.all([V.store.habits.all(), V.store.habits.logs()]);

      if (all.length) {
        body.appendChild(V.ui.sectionTitle('Your habits'));
        body.appendChild(
          V.ui.list(
            all.map((h) => {
              const s = V.plan.habitStats(h, logs);
              return V.ui.row({
                title: (h.icon ? h.icon + '  ' : '') + h.name,
                sub: `${s.streak} day streak · ${V.fmt(s.rate * 100)}% of logged days`,
                accessory: V.el('button', {
                  className: 'icon-btn', type: 'button', text: '×',
                  'aria-label': 'Delete',
                  on: {
                    click: async (e) => {
                      e.stopPropagation();
                      if (!V.confirm(`Delete "${h.name}" and its history?`)) return;
                      await V.store.habits.remove(h.id);
                      V.ui.refreshSheet();
                      V.app.render();
                    },
                  },
                }),
              });
            }),
          ),
        );
      }

      body.appendChild(V.ui.sectionTitle('Add a habit'));
      const existingNames = new Set(all.map((h) => h.name));
      const suggestions = V.plan.SUGGESTED_HABITS.filter((s) => !existingNames.has(s.name));

      if (suggestions.length) {
        body.appendChild(
          V.ui.list(
            suggestions.map((s) =>
              V.ui.row({
                title: s.icon + '  ' + s.name,
                onClick: async () => {
                  await V.store.habits.save({ id: V.uid(), name: s.name, icon: s.icon, createdAt: Date.now() });
                  V.ui.refreshSheet();
                  V.app.render();
                },
              }),
            ),
          ),
        );
      }

      const custom = V.ui.input({ placeholder: 'Or write your own' });
      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(custom);
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(
        V.ui.button('Add', async () => {
          const name = custom.value.trim();
          if (!name) return V.toast('Name it first');
          await V.store.habits.save({ id: V.uid(), name, icon: '•', createdAt: Date.now() });
          custom.value = '';
          V.ui.refreshSheet();
          V.app.render();
        }, 'btn-primary'),
      );

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Habits are deliberately yes/no. Partial credit turns a commitment into a ' +
                'negotiation, and the point of one is that it is unambiguous.',
        }),
      );
    });
  }

  // ============================================================ meal planning

  async function foodsById() {
    const map = {};
    for (const f of await V.store.foods.all()) map[f.id] = f;
    return map;
  }

  function openMealPlannerSheet() {
    V.ui.sheet('Meal ideas', async (body) => {
      const map = await foodsById();
      const settings = await V.store.settings.get();
      const targets = V.domain.macroTargets(settings);
      const entries = await V.store.foodLog.resolved(V.app.state.date);
      const totals = V.domain.sumNutrients(entries.map((e) => e.nutrients));

      const remaining = {
        kcal: Math.max(0, targets.kcal - (totals.kcal || 0)),
        protein: Math.max(0, targets.protein - (totals.protein || 0)),
      };

      let tag = null;
      let maxMinutes = null;

      const listWrap = V.el('div');
      const tagWrap = V.el('div');
      const timeWrap = V.el('div');

      function render() {
        const filtered = V.plan.filterMeals(V.MEALS, { tag, maxMinutes });
        listWrap.innerHTML = '';

        if (!filtered.length) {
          listWrap.appendChild(V.ui.empty('No meals match those filters.'));
          return;
        }

        listWrap.appendChild(
          V.ui.list(
            filtered.map((meal) => {
              const nut = V.plan.mealNutrients(meal, map);
              return V.ui.row({
                title: meal.name,
                sub: `${meal.timeMin} min · ${meal.servings} servings · ${V.fmt(nut.kcal)} kcal · ${V.fmt(nut.protein)}g protein`,
                onClick: () => openMealDetailSheet(meal, map),
              });
            }),
          ),
        );
      }

      function renderTags() {
        tagWrap.innerHTML = '';
        tagWrap.appendChild(
          V.ui.segmented(
            [{ value: null, label: 'All' }].concat(V.MEAL_TAGS.map((x) => ({ value: x, label: x }))),
            tag,
            (v) => { tag = v; renderTags(); render(); },
          ),
        );
      }

      function renderTime() {
        timeWrap.innerHTML = '';
        timeWrap.appendChild(
          V.ui.segmented(
            [{ value: null, label: 'Any time' }, { value: 10, label: '≤10 min' },
             { value: 20, label: '≤20 min' }, { value: 30, label: '≤30 min' }],
            maxMinutes,
            (v) => { maxMinutes = v; renderTime(); render(); },
          ),
        );
      }

      // ---- Suggestions against what's left of the day -----------------------
      if (remaining.kcal > 100) {
        const suggested = V.plan.suggestMeals(V.MEALS, remaining, map, 3);
        if (suggested.length) {
          body.appendChild(V.ui.sectionTitle('Fits what’s left today'));
          body.appendChild(
            V.el('div', { className: 'hint', style: { marginBottom: '8px' } }, [
              document.createTextNode(
                `${V.fmt(remaining.kcal)} kcal and ${V.fmt(remaining.protein)}g protein still to go.`,
              ),
            ]),
          );
          body.appendChild(
            V.ui.list(
              suggested.map((s) =>
                V.ui.row({
                  title: s.meal.name,
                  sub: `${V.fmt(s.nutrients.kcal)} kcal · ${V.fmt(s.nutrients.protein)}g protein · ${s.meal.timeMin} min`,
                  onClick: () => openMealDetailSheet(s.meal, map),
                }),
              ),
            ),
          );
        }
      }

      body.appendChild(V.ui.sectionTitle('Browse'));
      body.appendChild(timeWrap);
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(tagWrap);
      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(listWrap);

      body.appendChild(V.el('div', { style: { height: '16px' } }));
      body.appendChild(V.ui.button('This week’s shopping list', openShoppingListSheet, 'btn-ghost'));

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Built around what warehouse stores and big supermarkets sell in bulk. ' +
                'Macros are computed from the food library, not typed in — so they stay ' +
                'consistent with everything else you log.',
        }),
      );

      renderTime(); renderTags(); render();
    });
  }

  function openMealDetailSheet(meal, map) {
    V.ui.sheet(meal.name, async (body) => {
      const foods = map || (await foodsById());
      const nut = V.plan.mealNutrients(meal, foods);
      const missing = V.plan.missingIngredients(meal, foods);

      body.appendChild(
        V.el('div', { className: 'grid-2' }, [
          V.ui.stat({ label: 'Per serving', value: V.fmt(nut.kcal), unit: ' kcal' }),
          V.ui.stat({ label: 'Protein', value: V.fmt(nut.protein), unit: ' g' }),
          V.ui.stat({ label: 'Time', value: String(meal.timeMin), unit: ' min' }),
          V.ui.stat({ label: 'Makes', value: String(meal.servings), unit: ' servings' }),
        ]),
      );

      const tags = V.el('div', { className: 'tag-row' });
      for (const t of meal.tags) tags.appendChild(V.el('span', { className: 'tag', text: t }));
      body.appendChild(tags);

      if (missing.length) {
        body.appendChild(
          V.el('div', {
            className: 'warn-box',
            style: { marginTop: '12px' },
            text: `${missing.length} ingredient(s) are not in the food library, so the macros ` +
                  'above are incomplete.',
          }),
        );
      }

      body.appendChild(V.ui.sectionTitle('Ingredients (per serving)'));
      body.appendChild(
        V.ui.list(
          meal.ingredients.map((ing) => {
            const f = foods[ing.foodId];
            return V.ui.row({
              title: f ? f.name : ing.foodId,
              value: V.fmt(ing.grams) + ' g',
            });
          }),
        ),
      );

      body.appendChild(V.ui.sectionTitle('Method'));
      body.appendChild(
        V.el('ol', { className: 'phase-actions' }, meal.steps.map((s) => V.el('li', { text: s }))),
      );

      body.appendChild(V.el('div', { style: { height: '16px' } }));
      body.appendChild(
        V.ui.button('Log one serving', async () => {
          // Log each ingredient individually so the diary keeps full nutrient detail
          // rather than collapsing the meal into one opaque entry.
          const now = Date.now();
          for (const ing of meal.ingredients) {
            if (!foods[ing.foodId]) continue;
            await V.store.foodLog.save({
              id: V.uid(),
              date: V.app.state.date,
              loggedAt: now,
              foodId: ing.foodId,
              meal: defaultMealSlot(),
              grams: ing.grams,
            });
          }
          V.ui.closeSheet(true);
          V.toast('Logged ' + meal.name);
          V.app.render();
        }, 'btn-primary'),
      );

      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(
        V.ui.button('Add to this week’s plan', async () => {
          await V.store.mealPlans.save({
            id: V.uid(),
            date: V.app.state.date,
            mealId: meal.id,
            servings: meal.servings,
            addedAt: Date.now(),
          });
          V.toast('Added to the plan');
        }, 'btn-ghost'),
      );
    });
  }

  function defaultMealSlot() {
    const h = new Date().getHours();
    if (h < 11) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 21) return 'dinner';
    return 'snack';
  }

  function openShoppingListSheet() {
    V.ui.sheet('Shopping list', async (body) => {
      const map = await foodsById();
      const from = V.today();
      const to = V.addDays(from, 6);
      const planned = await V.store.mealPlans.range(from, to);

      if (!planned.length) {
        body.appendChild(V.ui.empty('Nothing planned for the next 7 days.'));
        body.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'Open a meal and tap "Add to this week’s plan" to build a list.',
          }),
        );
        return;
      }

      const mealsById = {};
      for (const m of V.MEALS) mealsById[m.id] = m;

      const entries = planned
        .map((p) => ({ meal: mealsById[p.mealId], servings: p.servings, plan: p }))
        .filter((e) => e.meal);

      body.appendChild(V.ui.sectionTitle('Planned meals'));
      body.appendChild(
        V.ui.list(
          entries.map((e) =>
            V.ui.row({
              title: e.meal.name,
              sub: `${V.friendlyDate(e.plan.date)} · ${e.servings} servings`,
              accessory: V.el('button', {
                className: 'icon-btn', type: 'button', text: '×', 'aria-label': 'Remove',
                on: {
                  click: async (ev) => {
                    ev.stopPropagation();
                    await V.store.mealPlans.remove(e.plan.id);
                    V.ui.refreshSheet();
                  },
                },
              }),
            }),
          ),
        ),
      );

      const list = V.plan.shoppingList(entries, map);
      body.appendChild(V.ui.sectionTitle(`Buy (${list.length} items)`));
      body.appendChild(V.ui.list(list.map((i) => V.ui.row({ title: i.name, value: i.display }))));

      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(
        V.ui.button('Copy list', async () => {
          const text = list.map((i) => `${i.display}  ${i.name}`).join('\n');
          try {
            await navigator.clipboard.writeText(text);
            V.toast('Copied');
          } catch (err) {
            // Clipboard access is blocked in some contexts; show it so it can be copied by hand.
            V.toast('Clipboard blocked — long-press to copy');
            body.appendChild(V.el('pre', { className: 'formula', text }));
          }
        }, 'btn-ghost'),
      );

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Quantities are summed across every planned serving and rounded up to ' +
                'something you can actually buy.',
        }),
      );
    });
  }

  // ========================================================= training programs

  function openProgramsSheet() {
    V.ui.sheet('Training programs', async (body) => {
      const active = await V.store.programs.active();

      if (active) {
        const program = V.PROGRAMS.find((p) => p.id === active.programId);
        if (program) {
          const adherence = V.plan.programAdherence(program, active.startedAt, active.completed || 0);
          const next = V.plan.nextSession(program, active.completed || 0);

          body.appendChild(
            V.ui.card({
              title: program.name,
              sub: `Week ${Math.ceil(adherence.weeks)} · ${active.completed || 0} sessions done`,
              children: [
                V.el('div', { className: 'grid-2' }, [
                  V.ui.stat({ label: 'Adherence', value: V.fmt(adherence.pct), unit: '%' }),
                  V.ui.stat({ label: 'Next up', value: next ? next.day.name : '–' }),
                ]),
                V.el('div', { style: { height: '10px' } }),
                V.ui.bar(adherence.pct, 100, 'var(--recovery)'),
              ],
            }),
          );

          if (next) {
            body.appendChild(
              V.ui.button('Start ' + next.day.name, () => startProgramSession(program, next, active), 'btn-primary'),
            );
          }

          body.appendChild(V.ui.sectionTitle('The rotation'));
          body.appendChild(
            V.ui.list(
              program.days.map((d, i) =>
                V.ui.row({
                  title: d.name,
                  sub: d.exercises.length + ' exercises',
                  value: next && next.index === i ? 'next' : '',
                }),
              ),
            ),
          );

          body.appendChild(V.el('div', { style: { height: '16px' } }));
          body.appendChild(
            V.ui.button('Leave this program', async () => {
              if (!V.confirm('Leave ' + program.name + '? Your workout history is kept.')) return;
              active.active = false;
              await V.store.programs.save(active);
              V.ui.refreshSheet();
              V.app.render();
            }, 'btn-danger'),
          );
          return;
        }
      }

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'A program tells you what to train each session. Loads are worked out from ' +
                'your own history, so it starts where you left off rather than from zero.',
        }),
      );

      for (const p of V.PROGRAMS) {
        body.appendChild(
          V.ui.card({
            title: p.name,
            sub: `${p.daysPerWeek}× per week · ${p.level} · ${p.focus}`,
            children: [
              V.el('div', { className: 'card-sub', text: p.description }),
              V.el('div', { className: 'hint', text: p.schedule }),
              V.el('div', { style: { height: '10px' } }),
              V.ui.button('Start ' + p.name, async () => {
                const existing = await V.store.programs.active();
                if (existing) {
                  existing.active = false;
                  await V.store.programs.save(existing);
                }
                await V.store.programs.save({
                  id: V.uid(), programId: p.id, startedAt: Date.now(), completed: 0, active: true,
                });
                V.toast('Program started');
                V.ui.refreshSheet();
                V.app.render();
              }, 'btn-primary'),
            ],
          }),
        );
      }
    });
  }

  async function startProgramSession(program, next, run) {
    const existing = await V.store.workouts.active();
    if (existing && !V.confirm('A workout is already in progress. Replace it?')) return;
    if (existing) await V.store.workouts.remove(existing.id);

    const [allSets, exercises] = await Promise.all([V.store.db.all('sets'), V.store.exercises.all()]);
    const exercisesById = {};
    for (const e of exercises) exercisesById[e.id] = e;

    const historyByExercise = {};
    for (const s of allSets) {
      if (!s.completed) continue;
      (historyByExercise[s.exerciseId] = historyByExercise[s.exerciseId] || []).push(s);
    }

    const workoutId = V.uid();
    await V.store.workouts.save({
      id: workoutId,
      date: V.today(),
      startedAt: Date.now(),
      name: program.name + ' — ' + next.day.name,
      programId: program.id,
      programDayIndex: next.index,
      programRunId: run.id,
    });

    const built = V.plan.buildSession(next.day, historyByExercise, exercisesById);
    let index = 0;
    for (const slot of built) {
      for (let i = 0; i < slot.sets; i++) {
        await V.store.sets.save({
          id: V.uid(),
          workoutId,
          exerciseId: slot.exerciseId,
          index: index++,
          weightKg: slot.weightKg,
          reps: slot.reps,
          type: 'working',
          completed: false,
        });
      }
    }

    V.ui.closeSheet(true);
    V.app.go('train');
    V.toast(next.day.name + ' ready — ' + built.length + ' exercises');
  }

  // ================================================================= insights

  /** Gather every daily series the insight engine can use, from one pass over storage. */
  async function buildSeriesBundle() {
    const [foodLogs, foods, workouts, sets, sleepLogs, studySessions, metrics, settings] =
      await Promise.all([
        V.store.db.all('foodLogs'), V.store.foods.all(), V.store.workouts.all(),
        V.store.db.all('sets'), V.store.sleep.all(), V.store.study.sessions(),
        V.store.db.all('metrics'), V.store.settings.get(),
      ]);

    const foodsById = {};
    for (const f of foods) foodsById[f.id] = f;

    // ---- nutrition, per day
    const byDate = V.groupBy(foodLogs, 'date');
    const calories = [], protein = [], nutritionScore = [], lateKcal = [];
    const targets = V.domain.macroTargets(settings);

    for (const date of Object.keys(byDate).sort()) {
      const entries = byDate[date]
        .map((l) => {
          const food = foodsById[l.foodId];
          if (!food) return null;
          return Object.assign({}, l, { food, nutrients: V.domain.scaleNutrients(food.per100, l.grams) });
        })
        .filter(Boolean);
      if (!entries.length) continue;

      const totals = V.domain.sumNutrients(entries.map((e) => e.nutrients));
      calories.push({ date, value: totals.kcal || 0 });
      protein.push({ date, value: totals.protein || 0 });

      const scored = V.domain.nutritionScore(entries, targets, settings);
      if (scored.score != null) nutritionScore.push({ date, value: scored.score });
      lateKcal.push({ date, value: scored.lateKcal || 0 });
    }

    // ---- training volume, per day
    const setsByWorkout = V.groupBy(sets, 'workoutId');
    const volumeByDate = {};
    for (const w of workouts) {
      if (!w.finishedAt) continue;
      const vol = V.domain.volume(setsByWorkout[w.id] || []);
      volumeByDate[w.date] = (volumeByDate[w.date] || 0) + vol;
    }
    const trainingVolume = Object.keys(volumeByDate).sort().map((date) => ({ date, value: volumeByDate[date] }));

    // ---- study minutes, per day
    const studyByDate = {};
    for (const s of studySessions) studyByDate[s.date] = (studyByDate[s.date] || 0) + (s.minutes || 0);
    const studyMinutes = Object.keys(studyByDate).sort().map((date) => ({ date, value: studyByDate[date] }));

    // ---- metrics
    const metricSeries = (type) => {
      const rows = metrics.filter((m) => m.type === type);
      const grouped = V.groupBy(rows, 'date');
      return Object.keys(grouped).sort().map((date) => ({
        date,
        value: V.sum(grouped[date], (x) => x.value) / grouped[date].length,
      }));
    };

    return {
      sleepHours: sleepLogs.sort((a, b) => (a.date < b.date ? -1 : 1)).map((l) => ({ date: l.date, value: l.hours })),
      calories, protein, nutritionScore, lateKcal,
      trainingVolume, studyMinutes,
      steps: metricSeries('steps'),
      weight: metricSeries('weight'),
    };
  }

  /** Small scatter plot for a correlation. */
  function scatter(pairs, color) {
    const W = 340, H = 160, pad = 22;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'chart');

    const xs = pairs.map((p) => p.x), ys = pairs.map((p) => p.y);
    let minX = Math.min(...xs), maxX = Math.max(...xs);
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    if (maxX === minX) { maxX += 1; minX -= 1; }
    if (maxY === minY) { maxY += 1; minY -= 1; }

    const px = (x) => pad + ((x - minX) / (maxX - minX)) * (W - pad * 2);
    const py = (y) => H - pad - ((y - minY) / (maxY - minY)) * (H - pad * 2);

    for (const frac of [0, 0.5, 1]) {
      const line = document.createElementNS(NS, 'line');
      const yy = pad + frac * (H - pad * 2);
      line.setAttribute('x1', pad); line.setAttribute('x2', W - pad);
      line.setAttribute('y1', yy); line.setAttribute('y2', yy);
      line.setAttribute('class', 'chart-grid');
      svg.appendChild(line);
    }

    // Regression line through the cloud, so the direction is visible not just implied.
    const fit = V.domain.linearRegression(pairs);
    if (fit) {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', px(minX)); line.setAttribute('y1', py(fit.predict(minX)));
      line.setAttribute('x2', px(maxX)); line.setAttribute('y2', py(fit.predict(maxX)));
      line.setAttribute('class', 'chart-proj');
      line.setAttribute('stroke', color || 'var(--info)');
      svg.appendChild(line);
    }

    for (const p of pairs) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', V.round(px(p.x), 2));
      c.setAttribute('cy', V.round(py(p.y), 2));
      c.setAttribute('r', 3);
      c.setAttribute('fill', color || 'var(--info)');
      c.setAttribute('opacity', '0.65');
      svg.appendChild(c);
    }

    return svg;
  }

  function openInsightsSheet() {
    V.ui.sheet('Insights', async (body) => {
      body.appendChild(V.el('div', { className: 'hint', text: 'Analysing your data…' }));
      const bundle = await buildSeriesBundle();
      body.innerHTML = '';

      const findings = V.insights.analyse(bundle);
      const observations = V.insights.observations(bundle);
      const ready = V.insights.readiness(bundle);

      // ---- Findings ---------------------------------------------------------
      if (findings.length) {
        body.appendChild(V.ui.sectionTitle('What your data suggests'));
        for (const f of findings) {
          const cls = f.strength === 'strong' ? 'strong' : f.strength === 'weak' ? 'weak' : '';
          const block = V.el('div', { className: 'insight ' + cls }, [
            V.el('div', { className: 'insight-title', text: f.title }),
            V.el('div', { className: 'insight-body', text: f.finding }),
            V.el('div', {
              className: 'insight-stat',
              text: `r = ${V.fmt(f.r, 2)} · ${f.n} paired days · p ≈ ${f.p < 0.001 ? '<0.001' : V.fmt(f.p, 3)}` +
                    (f.lag ? ' · next-day effect' : ''),
            }),
          ]);
          block.appendChild(scatter(f.pairs, 'var(--info)'));
          block.appendChild(
            V.el('div', { className: 'hint', text: `${f.aLabel} → ${f.bLabel}` }),
          );
          body.appendChild(block);
        }

        body.appendChild(
          V.el('div', {
            className: 'warn-box',
            text: 'These are correlations in your own data, not causes. Ygeia only tests a ' +
                  'short list of questions that have a plausible mechanism — testing every ' +
                  'combination would guarantee false findings from noise alone.',
          }),
        );
      }

      // ---- Observations -----------------------------------------------------
      if (observations.length) {
        body.appendChild(V.ui.sectionTitle('Observations'));
        body.appendChild(
          V.ui.list(observations.map((o) => V.ui.row({ title: o.title, sub: o.text }))),
        );
      }

      if (!findings.length && !observations.length) {
        body.appendChild(V.ui.empty('Not enough logged yet.'));
      }

      // ---- Data readiness ---------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Data collected'));
      body.appendChild(
        V.ui.list(
          Object.keys(V.insights.SERIES_META).map((k) => {
            const count = ready.counts[k] || 0;
            return V.ui.row({
              title: V.insights.SERIES_META[k].label,
              sub: count >= ready.minN ? 'enough to analyse' : `needs ${ready.minN - count} more days`,
              value: String(count),
            });
          }),
        ),
      );

      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(V.ui.button('Explore any two variables', () => openExplorerSheet(bundle), 'btn-ghost'));
    });
  }

  /** Custom analysis: pick any two series and a lag, see the real numbers. */
  function openExplorerSheet(bundle) {
    V.ui.sheet('Custom analysis', (body) => {
      const keys = Object.keys(V.insights.SERIES_META).filter((k) => (bundle[k] || []).length >= 3);

      if (keys.length < 2) {
        body.appendChild(V.ui.empty('Log at least two things for a few days first.'));
        return;
      }

      let a = keys[0], b = keys[1], lag = 0;
      const out = V.el('div');

      function render() {
        out.innerHTML = '';
        const result = V.insights.correlate(bundle[a], bundle[b], lag);

        if (!result) {
          out.appendChild(V.ui.empty('Not enough overlapping days.'));
          return;
        }

        out.appendChild(
          V.el('div', { className: 'grid-3' }, [
            V.ui.stat({ label: 'r', value: V.fmt(result.r, 2) }),
            V.ui.stat({ label: 'Paired days', value: String(result.n) }),
            V.ui.stat({ label: 'p', value: result.p < 0.001 ? '<0.001' : V.fmt(result.p, 3) }),
          ]),
        );

        if (result.pairs.length >= 3) out.appendChild(scatter(result.pairs, 'var(--recovery)'));

        const verdict = !result.reportable
          ? (result.n < V.insights.MIN_N
              ? `Only ${result.n} paired days. Below ${V.insights.MIN_N} this is noise, not a finding.`
              : `r = ${V.fmt(result.r, 2)} is too weak to mean anything.`)
          : `A ${result.strength} ${result.direction} relationship. Still a correlation, not a cause.`;

        out.appendChild(V.el('div', { className: result.reportable ? 'good-box' : 'warn-box', text: verdict }));
      }

      const opts = keys.map((k) => ({ value: k, label: V.insights.SERIES_META[k].label }));

      body.appendChild(V.ui.field('First variable', V.ui.select(opts, a, (v) => { a = v; render(); })));
      body.appendChild(V.ui.field('Second variable', V.ui.select(opts, b, (v) => { b = v; render(); })));

      const lagWrap = V.el('div');
      function renderLag() {
        lagWrap.innerHTML = '';
        lagWrap.appendChild(
          V.ui.segmented(
            [{ value: 0, label: 'Same day' }, { value: 1, label: 'Next day' }, { value: 2, label: '2 days later' }],
            lag,
            (v) => { lag = v; renderLag(); render(); },
          ),
        );
      }
      renderLag();
      body.appendChild(V.ui.field('Timing', lagWrap, 'Next day answers "does the first variable today relate to the second tomorrow".'));

      body.appendChild(out);
      render();
    });
  }

  V.planView = {
    buildHabitsCard, openHabitsManageSheet,
    openMealPlannerSheet, openShoppingListSheet,
    openProgramsSheet, openInsightsSheet,
    buildSeriesBundle,
  };
})(window.V);
