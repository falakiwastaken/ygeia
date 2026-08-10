/* Vitals — Body: measurements, trends and 30-day projections. */
(function (V) {
  'use strict';

  V.views = V.views || {};

  /** Display metadata per metric. `dp` controls rounding; `higherIsBetter` colours deltas. */
  const METRICS = [
    { type: 'weight',        label: 'Weight',         unit: 'kg',   dp: 1, convert: true,  color: 'var(--info)' },
    { type: 'body_fat_pct',  label: 'Body fat',       unit: '%',    dp: 1, higherIsBetter: false, color: 'var(--strain)' },
    { type: 'lean_mass',     label: 'Lean mass',      unit: 'kg',   dp: 1, convert: true, higherIsBetter: true, color: 'var(--recovery)' },
    { type: 'resting_hr',    label: 'Resting HR',     unit: 'bpm',  dp: 0, higherIsBetter: false, color: 'var(--stress)' },
    { type: 'hrv',           label: 'HRV (SDNN)',     unit: 'ms',   dp: 0, higherIsBetter: true,  color: 'var(--recovery)' },
    { type: 'systolic',      label: 'Systolic BP',    unit: 'mmHg', dp: 0, higherIsBetter: false, color: 'var(--stress)' },
    { type: 'diastolic',     label: 'Diastolic BP',   unit: 'mmHg', dp: 0, higherIsBetter: false, color: 'var(--stress)' },
    { type: 'sleep_hours',   label: 'Sleep',          unit: 'h',    dp: 1, higherIsBetter: true,  color: 'var(--sleep)' },
    { type: 'steps',         label: 'Steps',          unit: '',     dp: 0, higherIsBetter: true,  color: 'var(--strain)' },
    { type: 'vo2max',        label: 'VO₂ max',        unit: '',     dp: 1, higherIsBetter: true,  color: 'var(--recovery)' },
  ];

  /** Weight-like metrics are stored in kg and displayed in the user's chosen unit. */
  function toDisplay(meta, valueKg, settings) {
    return meta.convert ? V.kgToDisplay(valueKg, settings.weightUnit) : valueKg;
  }
  function fromDisplay(meta, value, settings) {
    return meta.convert ? V.displayToKg(value, settings.weightUnit) : value;
  }
  function unitLabel(meta, settings) {
    return meta.convert ? settings.weightUnit : meta.unit;
  }

  // ============================================================= detail sheet

  function openMetricSheet(meta) {
    V.ui.sheet(meta.label, async (body) => {
      const settings = await V.store.settings.get();
      const daily = await V.store.metrics.daily(meta.type);
      const u = unitLabel(meta, settings);

      // ---- Log a value ----------------------------------------------------
      const input = V.ui.input({
        type: 'number',
        step: meta.dp > 0 ? '0.1' : '1',
        placeholder: daily.length ? V.fmt(toDisplay(meta, daily[daily.length - 1].value, settings), meta.dp) : '',
      });

      const dateInput = V.ui.input({ type: 'date', value: V.app.state.date, max: V.today() });

      body.appendChild(V.ui.field(`New reading (${u})`, input));
      body.appendChild(V.ui.field('Date', dateInput));
      body.appendChild(
        V.ui.button('Save', async () => {
          const raw = V.ui.num(input, NaN);
          if (!Number.isFinite(raw) || raw <= 0) return V.toast('Enter a value');
          const date = dateInput.value || V.app.state.date;

          await V.store.metrics.save({
            id: V.uid(),
            type: meta.type,
            date,
            // Midday keeps same-day ordering stable regardless of when it was entered.
            recordedAt: V.parseKey(date).getTime() + 12 * 3600 * 1000,
            value: fromDisplay(meta, raw, settings),
            source: 'manual',
          });

          // Body weight feeds BMR, so keep the profile in step automatically.
          if (meta.type === 'weight') {
            await V.store.settings.set({ weightKg: fromDisplay(meta, raw, settings) });
          }

          input.value = '';
          V.toast('Saved');
          V.ui.refreshSheet();
          V.app.render();
        }, 'btn-primary'),
      );

      if (!daily.length) {
        body.appendChild(V.ui.empty('No readings yet.'));
        return;
      }

      // ---- Trend and projection -------------------------------------------
      const display = daily.map((d) => ({ date: d.date, value: toDisplay(meta, d.value, settings) }));
      const trend = V.domain.trend(display, 30);

      body.appendChild(V.ui.sectionTitle('Trend'));
      body.appendChild(
        V.charts.line(display, {
          color: meta.color,
          dp: meta.dp,
          projection: trend && trend.reliable ? trend.projection : null,
          projColor: meta.color,
          height: 140,
        }),
      );

      if (trend) {
        body.appendChild(
          V.el('div', { className: 'grid-3', style: { marginTop: '12px' } }, [
            V.ui.stat({
              label: 'Per week',
              value: (trend.perWeek >= 0 ? '+' : '') + V.fmt(trend.perWeek, meta.dp + 1),
              unit: ' ' + u,
            }),
            V.ui.stat({
              label: 'In 30 days',
              value: V.fmt(trend.projected, meta.dp),
              unit: ' ' + u,
            }),
            V.ui.stat({ label: 'Fit (r²)', value: V.fmt(trend.r2, 2) }),
          ]),
        );

        body.appendChild(
          V.el('div', {
            className: trend.reliable ? 'hint' : 'warn-box',
            style: { marginTop: '12px' },
            text: trend.reliable
              ? `Projection assumes the current trend continues. Based on ${trend.n} days.`
              : `Too noisy to project — r² is ${V.fmt(trend.r2, 2)} across ${trend.n} readings. ` +
                'Log more consistently for a meaningful trend line.',
          }),
        );
      }

      // ---- Weight-specific calorie feedback --------------------------------
      if (meta.type === 'weight' && trend && trend.reliable) {
        const perWeekKg = meta.convert ? V.displayToKg(trend.perWeek, settings.weightUnit) : trend.perWeek;
        const adj = V.domain.suggestCalorieAdjustment(settings.goal, perWeekKg, settings.weightKg);
        const targets = V.domain.macroTargets(settings);

        body.appendChild(V.ui.sectionTitle('Calorie check'));
        if (adj === 0) {
          body.appendChild(
            V.el('div', { className: 'hint', text: 'Your weight trend matches your goal. No change needed.' }),
          );
        } else {
          body.appendChild(
            V.ui.card({
              children: [
                V.el('div', {
                  className: 'card-sub',
                  text: `You're trending ${V.fmt(Math.abs(trend.perWeek), 2)} ${u}/week ` +
                        `${trend.perWeek < 0 ? 'down' : 'up'}, which is ` +
                        `${adj > 0 ? 'faster' : 'slower'} than your ${V.domain.GOAL_LABEL[settings.goal].toLowerCase()} target.`,
                }),
                V.el('div', { style: { height: '12px' } }),
                V.ui.button(
                  `${adj > 0 ? 'Increase' : 'Reduce'} target by ${Math.abs(adj)} kcal → ${V.fmt(targets.kcal + adj)}`,
                  async () => {
                    await V.store.settings.set({ kcalOverride: targets.kcal + adj });
                    V.toast('Calorie target updated');
                    V.ui.refreshSheet();
                    V.app.render();
                  },
                  'btn-primary',
                ),
              ],
            }),
          );
        }
      }

      // ---- Raw history ------------------------------------------------------
      const samples = (await V.store.metrics.series(meta.type)).slice(-40).reverse();
      body.appendChild(V.ui.sectionTitle('History'));
      body.appendChild(
        V.ui.list(
          samples.map((s) =>
            V.ui.row({
              title: V.fmt(toDisplay(meta, s.value, settings), meta.dp) + ' ' + u,
              sub: V.friendlyDate(s.date) + (s.source !== 'manual' ? ' · imported' : ''),
              accessory: V.el('button', {
                className: 'icon-btn', type: 'button', text: '×', 'aria-label': 'Delete',
                on: {
                  click: async (e) => {
                    e.stopPropagation();
                    await V.store.metrics.remove(s.id);
                    V.ui.refreshSheet();
                    V.app.render();
                  },
                },
              }),
            }),
          ),
        ),
      );
    });
  }

  // =================================================================== view

  V.views.body = {
    async render() {
      const settings = await V.store.settings.get();
      const root = V.el('div');

      const rows = [];
      let anyData = false;

      for (const meta of METRICS) {
        const daily = await V.store.metrics.daily(meta.type);
        const u = unitLabel(meta, settings);

        if (!daily.length) {
          rows.push(
            V.ui.row({
              title: meta.label,
              sub: 'No data',
              value: '＋',
              onClick: () => openMetricSheet(meta),
            }),
          );
          continue;
        }

        anyData = true;
        const latest = daily[daily.length - 1];
        const display = daily.map((d) => ({ date: d.date, value: toDisplay(meta, d.value, settings) }));
        const trend = V.domain.trend(display.slice(-30), 30);

        rows.push(
          V.ui.row({
            title: meta.label,
            sub: trend && trend.reliable
              ? `${trend.perWeek >= 0 ? '+' : ''}${V.fmt(trend.perWeek, meta.dp + 1)} ${u}/week`
              : V.friendlyDate(latest.date),
            value: V.fmt(toDisplay(meta, latest.value, settings), meta.dp) + ' ' + u,
            accessory: display.length >= 3
              ? V.charts.sparkline(display.slice(-20).map((d) => d.value), { color: meta.color })
              : null,
            onClick: () => openMetricSheet(meta),
          }),
        );
      }

      root.appendChild(V.ui.sectionTitle('Measurements'));
      root.appendChild(V.ui.list(rows));

      if (!anyData) {
        root.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'Tap any measurement to log it. To bring in years of history at once, ' +
                  'import your Apple Health export from Settings.',
          }),
        );
      }

      return root;
    },
  };
})(window.V);
