/* Vitals — Train: live workout logging, progression, plate maths. */
(function (V) {
  'use strict';

  V.views = V.views || {};

  const SET_TYPES = [
    { value: 'working', label: 'Working' },
    { value: 'warmup', label: 'Warm-up' },
    { value: 'drop', label: 'Drop' },
    { value: 'failure', label: 'To failure' },
  ];

  // ============================================================== rest timer

  let restTimer = null;

  /**
   * Audible cue at zero. Built with the Web Audio API rather than an <audio> file so the
   * app stays a single self-contained folder with no binary assets.
   */
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      setTimeout(() => ctx.close(), 800);
    } catch (err) {
      /* Audio is a convenience; a blocked AudioContext must not break the workout. */
    }
  }

  function startRest(seconds) {
    if (restTimer) clearInterval(restTimer.handle);

    // Store the wall-clock deadline rather than decrementing a counter: setInterval is
    // throttled hard in background tabs, so a tick-based countdown drifts badly.
    const endsAt = Date.now() + seconds * 1000;

    V.ui.sheet('Rest', (body) => {
      const display = V.el('div', { className: 'timer-big' });
      body.appendChild(display);
      body.appendChild(V.el('div', { style: { height: '20px' } }));

      const adjust = V.el('div', { className: 'btn-row' }, [
        V.ui.button('−30s', () => { restTimer.endsAt -= 30000; tick(); }),
        V.ui.button('+30s', () => { restTimer.endsAt += 30000; tick(); }),
      ]);
      body.appendChild(adjust);
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('Skip', () => { stopRest(); V.ui.closeSheet(); }, 'btn-ghost'));

      function tick() {
        const left = Math.max(0, Math.round((restTimer.endsAt - Date.now()) / 1000));
        display.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
        if (left <= 0) {
          stopRest();
          beep();
          V.haptic(200);
          V.toast('Rest complete');
          V.ui.closeSheet();
        }
      }

      restTimer = { endsAt, handle: setInterval(tick, 250) };
      tick();
    });
  }

  function stopRest() {
    if (restTimer) clearInterval(restTimer.handle);
    restTimer = null;
  }

  // ========================================================= plate calculator

  function openPlateCalculator(targetKg) {
    V.ui.sheet('Plate calculator', async (body) => {
      const settings = await V.store.settings.get();
      let target = targetKg || 60;

      const input = V.ui.input({ type: 'number', value: String(target), step: '2.5' });
      const out = V.el('div');

      function render() {
        const res = V.domain.platesPerSide(target, settings.barWeightKg, settings.availablePlatesKg);
        out.innerHTML = '';

        if (res.perSide <= 0) {
          out.appendChild(V.ui.empty('Below the weight of the empty bar.'));
          return;
        }

        out.appendChild(
          V.ui.stat({ label: 'Per side', value: V.fmt(res.perSide, 2), unit: ' kg' }),
        );

        const chips = V.el('div', { className: 'chips', style: { marginTop: '12px' } });
        if (!res.plates.length) chips.appendChild(V.ui.empty('No plates needed.'));
        for (const p of res.plates) {
          chips.appendChild(V.el('span', { className: 'chip on', text: p + ' kg' }));
        }
        out.appendChild(chips);

        if (res.remainderKg > 0.01) {
          out.appendChild(
            V.el('div', {
              className: 'warn-box',
              style: { marginTop: '12px' },
              text: `${V.fmt(res.remainderKg, 2)} kg per side can't be made with your plates. ` +
                    `Closest loadable weight is ${V.fmt(target - res.remainderKg * 2, 2)} kg.`,
            }),
          );
        }
      }

      input.addEventListener('input', () => { target = V.ui.num(input, 0); render(); });
      body.appendChild(V.ui.field('Target weight (kg)', input));
      body.appendChild(out);
      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: `Bar ${settings.barWeightKg} kg · plates ${settings.availablePlatesKg.join(', ')} kg. ` +
                'Change these in Settings.',
        }),
      );
      render();
    });
  }

  // ============================================================ exercise pick

  function openExercisePicker(onPick) {
    V.ui.sheet('Add exercise', async (body) => {
      const all = await V.store.exercises.all();
      all.sort((a, b) => a.name.localeCompare(b.name));

      let filter = '';
      let muscle = 'all';

      const input = V.ui.input({ type: 'search', placeholder: 'Search exercises' });
      const listWrap = V.el('div');

      const muscles = ['all'].concat(Object.keys(V.MUSCLE_LABEL));

      function render() {
        const q = filter.toLowerCase();
        const shown = all.filter(
          (e) =>
            (muscle === 'all' || e.primary === muscle) &&
            (!q || e.name.toLowerCase().includes(q)),
        );

        listWrap.innerHTML = '';
        if (!shown.length) {
          listWrap.appendChild(V.ui.empty('No matching exercises.'));
        } else {
          listWrap.appendChild(
            V.ui.list(
              shown.slice(0, 80).map((e) =>
                V.ui.row({
                  title: e.name,
                  sub: `${V.MUSCLE_LABEL[e.primary]} · ${V.EQUIPMENT_LABEL[e.equipment]}`,
                  onClick: () => { V.ui.closeSheet(); onPick(e); },
                }),
              ),
            ),
          );
        }
      }

      input.addEventListener('input', () => { filter = input.value; render(); });

      const chipWrap = V.el('div');
      function renderChips() {
        chipWrap.innerHTML = '';
        chipWrap.appendChild(
          V.ui.segmented(
            muscles.map((m) => ({ value: m, label: m === 'all' ? 'All' : V.MUSCLE_LABEL[m] })),
            muscle,
            (v) => { muscle = v; renderChips(); render(); },
          ),
        );
      }
      renderChips();

      body.appendChild(input);
      body.appendChild(V.el('div', { style: { height: '10px' } }));
      body.appendChild(chipWrap);
      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(listWrap);
      render();
    });
  }

  // ============================================================ live workout

  async function renderActiveWorkout(workout, root) {
    const settings = await V.store.settings.get();
    const [sets, exercises] = await Promise.all([
      V.store.sets.byWorkout(workout.id),
      V.store.exercises.all(),
    ]);
    const exById = {};
    for (const e of exercises) exById[e.id] = e;

    const elapsed = Math.round((Date.now() - workout.startedAt) / 60000);
    const volume = V.domain.volume(sets);

    root.appendChild(
      V.ui.card({
        title: workout.name,
        sub: `${elapsed} min · ${V.domain.workingSets(sets).length} sets · ${V.fmt(volume)} kg`,
        children: [
          V.el('div', { className: 'btn-row' }, [
            V.ui.button('Finish', async () => {
              if (!V.confirm('Finish this workout?')) return;
              const completed = sets.filter((s) => s.completed);
              // Uncompleted rows are scaffolding the user never filled in; keeping them
              // would inflate set counts and pollute progression history.
              for (const s of sets) if (!s.completed) await V.store.sets.remove(s.id);
              workout.finishedAt = Date.now();
              await V.store.workouts.save(workout);
              stopRest();
              V.toast(`Workout saved · ${completed.length} sets`);
              V.app.render();
            }, 'btn-good'),
            V.ui.button('Plates', () => openPlateCalculator(), 'btn-ghost'),
          ]),
        ],
      }),
    );

    // Group sets by exercise, preserving the order they were added.
    const order = [];
    const byExercise = {};
    for (const s of sets.sort((a, b) => a.index - b.index)) {
      if (!byExercise[s.exerciseId]) { byExercise[s.exerciseId] = []; order.push(s.exerciseId); }
      byExercise[s.exerciseId].push(s);
    }

    for (const exId of order) {
      const ex = exById[exId];
      if (!ex) continue;
      const exSets = byExercise[exId];

      // Previous performance on this lift, excluding the current session.
      const history = (await V.store.sets.byExercise(exId)).filter((s) => s.workoutId !== workout.id);
      const pr = V.domain.personalRecords(history);

      const card = V.ui.card({
        title: ex.name,
        sub: pr ? `Best ${V.fmt(pr.estimated1RM, 1)} kg est. 1RM` : 'No history yet',
        children: [],
      });

      const grid = V.el('div');
      grid.appendChild(
        V.el('div', { className: 'set-grid' }, [
          V.el('div', { className: 'set-head', text: '#' }),
          V.el('div', { className: 'set-head', text: 'kg' }),
          V.el('div', { className: 'set-head', text: 'reps' }),
          V.el('div', { className: 'set-head', text: 'rpe' }),
          V.el('div', { className: 'set-head', text: '' }),
        ]),
      );

      exSets.forEach((s, i) => {
        const weight = V.ui.input({ type: 'number', value: s.weightKg ? String(s.weightKg) : '', step: '2.5' });
        const reps = V.ui.input({ type: 'number', value: s.reps ? String(s.reps) : '', step: '1' });
        const rpe = V.ui.input({ type: 'number', value: s.rpe != null ? String(s.rpe) : '', step: '0.5', placeholder: '–' });

        const save = V.debounce(async () => {
          s.weightKg = V.ui.num(weight, 0);
          s.reps = Math.round(V.ui.num(reps, 0));
          const r = V.ui.num(rpe, 0);
          s.rpe = r > 0 ? r : undefined;
          await V.store.sets.save(s);
        }, 400);

        weight.addEventListener('input', save);
        reps.addEventListener('input', save);
        rpe.addEventListener('input', save);

        const done = V.el('button', {
          className: 'set-done' + (s.completed ? ' on' : ''),
          type: 'button',
          text: '✓',
          on: {
            click: async () => {
              s.weightKg = V.ui.num(weight, 0);
              s.reps = Math.round(V.ui.num(reps, 0));
              const r = V.ui.num(rpe, 0);
              s.rpe = r > 0 ? r : undefined;

              if (!s.completed && s.reps <= 0) return V.toast('Enter reps first');

              s.completed = !s.completed;
              await V.store.sets.save(s);

              if (s.completed) {
                V.haptic(12);
                if (V.domain.isPR(s, history)) V.toast('🏆 New PR on ' + ex.name);
                if (s.type !== 'warmup') startRest(settings.defaultRestSec);
              }
              V.app.render();
            },
          },
        });

        const row = V.el('div', { className: 'set-grid' + (s.type === 'warmup' ? ' set-warmup' : '') }, [
          V.el('div', {
            className: 'set-idx',
            text: s.type === 'warmup' ? 'W' : String(i + 1),
            title: 'Tap to change set type',
            on: {
              click: async () => {
                const idx = SET_TYPES.findIndex((t) => t.value === s.type);
                s.type = SET_TYPES[(idx + 1) % SET_TYPES.length].value;
                await V.store.sets.save(s);
                V.app.render();
              },
            },
          }),
          weight, reps, rpe, done,
        ]);
        grid.appendChild(row);
      });

      card.appendChild(grid);

      // Suggest the next set from what was just done, so the common case is one tap.
      card.appendChild(
        V.el('div', { className: 'btn-row', style: { marginTop: '10px' } }, [
          V.ui.button('Add set', async () => {
            const last = exSets[exSets.length - 1];
            await V.store.sets.save({
              id: V.uid(),
              workoutId: workout.id,
              exerciseId: exId,
              index: sets.length,
              weightKg: last ? last.weightKg : 0,
              reps: last ? last.reps : 0,
              type: 'working',
              completed: false,
            });
            V.app.render();
          }, 'btn-ghost'),
          V.ui.button('Remove', async () => {
            if (!V.confirm(`Remove ${ex.name} from this workout?`)) return;
            for (const s of exSets) await V.store.sets.remove(s.id);
            V.app.render();
          }, 'btn-ghost'),
        ]),
      );

      if (pr) {
        const suggestion = V.domain.suggestProgression(history.filter(
          (h) => h.workoutId === history[history.length - 1].workoutId,
        ), ex);
        if (suggestion) {
          card.appendChild(V.el('div', { className: 'hint', text: '→ ' + suggestion.reason }));
        }
      }

      root.appendChild(card);
    }

    root.appendChild(
      V.ui.button('Add exercise', () =>
        openExercisePicker(async (ex) => {
          const current = await V.store.sets.byWorkout(workout.id);
          const history = (await V.store.sets.byExercise(ex.id)).filter((s) => s.workoutId !== workout.id);

          // Pre-fill from the last time this lift was trained — most sessions repeat or
          // slightly beat the previous one, so a blank row is almost never what's wanted.
          let weight = 0, reps = 0;
          if (history.length) {
            const lastWorkoutId = history[history.length - 1].workoutId;
            const lastSets = V.domain.workingSets(history.filter((h) => h.workoutId === lastWorkoutId));
            const suggestion = V.domain.suggestProgression(lastSets, ex);
            if (suggestion) { weight = suggestion.weightKg; reps = suggestion.reps; }
          }

          await V.store.sets.save({
            id: V.uid(),
            workoutId: workout.id,
            exerciseId: ex.id,
            index: current.length,
            weightKg: weight,
            reps,
            type: 'working',
            completed: false,
          });
          V.app.render();
        }),
      'btn-primary'),
    );
  }

  // =================================================================== view

  V.views.train = {
    async render(state) {
      const root = V.el('div');
      const active = await V.store.workouts.active();

      if (active) {
        await renderActiveWorkout(active, root);
        return root;
      }

      // ---- Start ------------------------------------------------------------
      root.appendChild(
        V.ui.card({
          title: 'Start a workout',
          children: [
            V.ui.button('Empty workout', async () => {
              const name = new Date().getHours() < 12 ? 'Morning workout'
                : new Date().getHours() < 18 ? 'Afternoon workout' : 'Evening workout';
              await V.store.workouts.save({
                id: V.uid(),
                date: V.today(),
                startedAt: Date.now(),
                name,
              });
              V.app.render();
            }, 'btn-primary'),
            V.el('div', { style: { height: '8px' } }),
            V.ui.button('Plate calculator', () => openPlateCalculator(), 'btn-ghost'),
          ],
        }),
      );

      // ---- History ----------------------------------------------------------
      const recent = await V.store.workouts.recent(20);
      root.appendChild(V.ui.sectionTitle('History'));

      if (!recent.length) {
        root.appendChild(V.ui.empty('No workouts yet. Your first one starts above.'));
      } else {
        const rows = [];
        for (const w of recent) {
          const sets = await V.store.sets.byWorkout(w.id);
          const working = V.domain.workingSets(sets);
          rows.push(
            V.ui.row({
              title: w.name,
              sub: `${V.friendlyDate(w.date)} · ${working.length} sets · ${V.fmt(V.domain.volume(sets))} kg`,
              value: Math.round((w.finishedAt - w.startedAt) / 60000) + ' min',
              onClick: () => openWorkoutDetail(w),
            }),
          );
        }
        root.appendChild(V.ui.list(rows));
      }

      // ---- Progression ------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Progression'));
      root.appendChild(
        V.ui.button('Browse exercise history', () =>
          openExercisePicker((ex) => openExerciseHistory(ex)), 'btn-ghost'),
      );

      return root;
    },
  };

  // ---------------------------------------------------------------- details --

  function openWorkoutDetail(workout) {
    V.ui.sheet(workout.name, async (body) => {
      const [sets, exercises] = await Promise.all([
        V.store.sets.byWorkout(workout.id),
        V.store.exercises.all(),
      ]);
      const exById = {};
      for (const e of exercises) exById[e.id] = e;

      body.appendChild(
        V.el('div', { className: 'grid-3' }, [
          V.ui.stat({ label: 'Sets', value: String(V.domain.workingSets(sets).length) }),
          V.ui.stat({ label: 'Volume', value: V.fmt(V.domain.volume(sets)), unit: ' kg' }),
          V.ui.stat({
            label: 'Duration',
            value: String(Math.round((workout.finishedAt - workout.startedAt) / 60000)),
            unit: ' min',
          }),
        ]),
      );

      const grouped = V.groupBy(sets.sort((a, b) => a.index - b.index), 'exerciseId');
      for (const exId in grouped) {
        const ex = exById[exId];
        if (!ex) continue;
        body.appendChild(V.ui.sectionTitle(ex.name));
        body.appendChild(
          V.ui.list(
            grouped[exId].map((s, i) =>
              V.ui.row({
                title: `${s.type === 'warmup' ? 'Warm-up' : 'Set ' + (i + 1)}`,
                sub: s.rpe ? 'RPE ' + s.rpe : undefined,
                value: `${V.fmt(s.weightKg, 1)} kg × ${s.reps}`,
              }),
            ),
          ),
        );
      }

      body.appendChild(V.el('div', { style: { height: '16px' } }));
      body.appendChild(
        V.ui.button('Delete workout', async () => {
          if (!V.confirm('Delete this workout and all its sets?')) return;
          await V.store.workouts.remove(workout.id);
          V.ui.closeSheet();
          V.toast('Deleted');
          V.app.render();
        }, 'btn-danger'),
      );
    });
  }

  function openExerciseHistory(ex) {
    V.ui.sheet(ex.name, async (body) => {
      const sets = await V.store.sets.byExercise(ex.id);
      const working = V.domain.workingSets(sets);

      if (!working.length) {
        body.appendChild(V.ui.empty('No completed sets for this exercise yet.'));
        return;
      }

      const pr = V.domain.personalRecords(sets);
      body.appendChild(
        V.el('div', { className: 'grid-3' }, [
          V.ui.stat({ label: 'Est. 1RM', value: V.fmt(pr.estimated1RM, 1), unit: ' kg' }),
          V.ui.stat({ label: 'Heaviest', value: V.fmt(pr.heaviest.weightKg, 1), unit: ' kg' }),
          V.ui.stat({ label: 'Most reps', value: String(pr.mostReps.reps) }),
        ]),
      );

      // Best estimated 1RM per session, which is the cleanest single progression signal.
      const byWorkout = V.groupBy(working, 'workoutId');
      const points = [];
      for (const wid in byWorkout) {
        const w = await V.store.workouts.get(wid);
        if (!w) continue;
        points.push({
          date: w.date,
          value: Math.max(...byWorkout[wid].map((s) => V.domain.estimate1RM(s.weightKg, s.reps))),
        });
      }
      points.sort((a, b) => (a.date < b.date ? -1 : 1));

      if (points.length >= 2) {
        body.appendChild(V.ui.sectionTitle('Estimated 1RM'));
        body.appendChild(V.charts.line(points, { color: 'var(--strain)', dp: 1 }));
      }

      body.appendChild(V.ui.sectionTitle('Recent sets'));
      body.appendChild(
        V.ui.list(
          working.slice(-30).reverse().map((s) =>
            V.ui.row({
              title: `${V.fmt(s.weightKg, 1)} kg × ${s.reps}`,
              sub: s.rpe ? 'RPE ' + s.rpe : undefined,
              value: V.fmt(V.domain.estimate1RM(s.weightKg, s.reps), 1) + ' kg',
            }),
          ),
        ),
      );
    });
  }
})(window.V);
