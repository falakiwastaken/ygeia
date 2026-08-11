/*
 * Ygeia — calendar and day timeline.
 *
 * A month grid showing which days have anything in them, and a day view that replays
 * everything in the order it actually happened.
 */
(function (V) {
  'use strict';

  const C = {};

  /** Load every store once and index by date — a month view touches all of them. */
  async function loadRange(fromDate, toDate) {
    const [
      foodLogs, foods, workouts, sets, sports, studySessions,
      sleepLogs, checkIns, metrics, subjects,
    ] = await Promise.all([
      V.store.db.all('foodLogs'), V.store.foods.all(), V.store.workouts.all(),
      V.store.db.all('sets'), V.store.sports.all(), V.store.study.sessions(),
      V.store.sleep.all(), V.store.checkIns.all(), V.store.db.all('metrics'),
      V.store.study.subjects(),
    ]);

    const foodsById = {};
    for (const f of foods) foodsById[f.id] = f;
    const subjectsById = {};
    for (const s of subjects) subjectsById[s.id] = s;

    const setsByWorkout = V.groupBy(sets, 'workoutId');
    const inRange = (date) => date >= fromDate && date <= toDate;

    const resolvedLogs = foodLogs.filter((l) => inRange(l.date)).map((l) => {
      const food = foodsById[l.foodId];
      if (!food) return null;
      return Object.assign({}, l, {
        food,
        nutrients: V.domain.scaleNutrients(food.per100, l.grams),
      });
    }).filter(Boolean);

    return {
      byDate: (date) => ({
        date,
        foodLogs: resolvedLogs.filter((l) => l.date === date),
        workouts: workouts.filter((w) => w.date === date),
        setsByWorkout,
        sports: sports.filter((s) => s.date === date),
        studySessions: studySessions.filter((s) => s.date === date),
        sleep: sleepLogs.find((s) => s.date === date) || null,
        checkIn: checkIns.find((c) => c.date === date) || null,
        metrics: metrics.filter((m) => m.date === date),
        subjectsById,
      }),
    };
  }

  // ============================================================ month view

  C.open = function (initialDate) {
    let cursor = V.parseKey(initialDate || V.app.state.date);

    V.ui.sheet('Calendar', async (body) => {
      const settings = await V.store.settings.get();
      const firstDay = settings.firstDayOfWeek == null ? 1 : settings.firstDayOfWeek;

      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const cells = V.timeline.monthGrid(year, month, firstDay);

      const from = cells.find(Boolean);
      const to = cells.slice().reverse().find(Boolean);
      const data = await loadRange(from, to);

      // ---- Header ----------------------------------------------------------
      const header = V.el('div', { className: 'cal-header' }, [
        V.el('button', {
          className: 'icon-btn', type: 'button', text: '‹', 'aria-label': 'Previous month',
          on: { click: () => { cursor = new Date(year, month - 1, 1); V.ui.refreshSheet(); } },
        }),
        V.el('div', { className: 'cal-title', text: cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }),
        V.el('button', {
          className: 'icon-btn', type: 'button', text: '›', 'aria-label': 'Next month',
          on: { click: () => { cursor = new Date(year, month + 1, 1); V.ui.refreshSheet(); } },
        }),
      ]);
      body.appendChild(header);

      // ---- Weekday row -----------------------------------------------------
      const dow = V.el('div', { className: 'cal-grid cal-dow' });
      for (const label of V.timeline.weekdayLabels(firstDay)) {
        dow.appendChild(V.el('div', { className: 'cal-dow-cell', text: label }));
      }
      body.appendChild(dow);

      // ---- Day grid --------------------------------------------------------
      const grid = V.el('div', { className: 'cal-grid' });
      const today = V.today();
      let activeDays = 0;

      for (const date of cells) {
        if (!date) {
          // Padding cell so the grid stays rectangular.
          grid.appendChild(V.el('div', { className: 'cal-cell cal-pad' }));
          continue;
        }

        const events = V.timeline.buildDay(data.byDate(date));
        const categories = V.timeline.daySummary(events);
        if (categories.length) activeDays++;

        const cell = V.el('button', {
          className: 'cal-cell' +
            (date === today ? ' is-today' : '') +
            (date === V.app.state.date ? ' is-selected' : '') +
            (date > today ? ' is-future' : '') +
            (categories.length ? '' : ' is-empty'),
          type: 'button',
        }, [
          V.el('div', { className: 'cal-num', text: String(V.parseKey(date).getDate()) }),
          V.el('div', { className: 'cal-dots' },
            categories.slice(0, 4).map((cat) =>
              V.el('span', {
                className: 'cal-dot',
                style: { background: V.timeline.CATEGORIES[cat].color },
                title: V.timeline.CATEGORIES[cat].label,
              }),
            ),
          ),
        ]);

        if (date <= today) cell.addEventListener('click', () => C.openDay(date));
        grid.appendChild(cell);
      }
      body.appendChild(grid);

      body.appendChild(
        V.el('div', { className: 'hint', text: `${activeDays} day(s) with activity this month.` }),
      );

      // ---- Legend ----------------------------------------------------------
      const legend = V.el('div', { className: 'cal-legend' });
      for (const key in V.timeline.CATEGORIES) {
        const cat = V.timeline.CATEGORIES[key];
        legend.appendChild(
          V.el('span', { className: 'cal-legend-item' }, [
            V.el('span', { className: 'cal-dot', style: { background: cat.color } }),
            V.el('span', { text: cat.label }),
          ]),
        );
      }
      body.appendChild(legend);

      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(
        V.ui.button('Jump to today', () => { C.openDay(today); }, 'btn-ghost'),
      );
    });
  };

  // ============================================================== day view

  C.openDay = function (date) {
    V.ui.sheet(V.friendlyDate(date), async (body) => {
      const data = await loadRange(date, date);
      const events = V.timeline.buildDay(data.byDate(date));

      body.appendChild(V.el('div', { className: 'card-sub', text: V.longDate(date) }));

      if (!events.length) {
        body.appendChild(V.ui.empty('Nothing logged on this day.'));
      } else {
        // ---- Summary strip --------------------------------------------------
        const byCat = V.groupBy(events, 'category');
        const tiles = [];
        if (byCat.meal) {
          const kcal = V.sum(byCat.meal, (e) => parseFloat(String(e.value).replace(/[^\d.]/g, '')) || 0);
          tiles.push(V.ui.stat({ label: 'Eaten', value: V.fmt(kcal), unit: ' kcal' }));
        }
        if (byCat.workout) tiles.push(V.ui.stat({ label: 'Workouts', value: String(byCat.workout.length) }));
        if (byCat.study) {
          const mins = V.sum(byCat.study, (e) => parseInt(e.value, 10) || 0);
          tiles.push(V.ui.stat({ label: 'Studied', value: String(mins), unit: ' min' }));
        }
        if (byCat.sleep) tiles.push(V.ui.stat({ label: 'Slept', value: byCat.sleep[0].value.replace(' h', ''), unit: ' h' }));

        if (tiles.length) {
          body.appendChild(V.el('div', { className: 'grid-' + Math.min(tiles.length, 3) }, tiles));
          body.appendChild(V.el('div', { style: { height: '16px' } }));
        }

        // ---- Timeline -------------------------------------------------------
        body.appendChild(V.ui.sectionTitle('Through the day'));
        const list = V.el('div', { className: 'tl' });

        for (const e of events) {
          const cat = V.timeline.CATEGORIES[e.category];
          const time = e.approximateTime ? '~' + V.timeOfDay(e.at) : V.timeOfDay(e.at);
          const span = e.endAt ? time + '–' + V.timeOfDay(e.endAt) : time;

          list.appendChild(
            V.el('div', { className: 'tl-row' }, [
              V.el('div', { className: 'tl-time', text: span }),
              V.el('div', { className: 'tl-marker', style: { background: cat.color } }),
              V.el('div', { className: 'tl-body' }, [
                V.el('div', { className: 'tl-title' }, [
                  document.createTextNode(cat.icon + '  ' + e.title),
                  e.value ? V.el('span', { className: 'tl-value', text: e.value }) : null,
                ]),
                e.detail ? V.el('div', { className: 'tl-detail', text: e.detail }) : null,
              ]),
            ]),
          );
        }
        body.appendChild(list);

        if (events.some((e) => e.approximateTime)) {
          body.appendChild(
            V.el('div', {
              className: 'hint',
              text: 'Times marked ~ are approximate. Apple Health exports are aggregated to ' +
                    'one value per day, so the exact moment is not preserved.',
            }),
          );
        }
      }

      // ---- Jump to that day -------------------------------------------------
      body.appendChild(V.el('div', { style: { height: '16px' } }));
      body.appendChild(
        V.ui.button('Open this day in the app', () => {
          V.ui.closeSheet(true);
          V.app.setDate(date);
        }, 'btn-primary'),
      );
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('Back to calendar', () => { V.ui.closeSheet(); }, 'btn-ghost'));
    });
  };

  V.calendar = C;
})(window.V);
