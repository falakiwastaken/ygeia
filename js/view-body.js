/* Ygeia — Body: measurements, trends and 30-day projections. */
(function (V) {
  'use strict';

  V.views = V.views || {};

  /**
   * Display metadata per metric. `dp` controls rounding; `higherIsBetter` colours deltas.
   *
   * Optional keys:
   *   group     which section of the Body tab it appears under (see GROUPS)
   *   convert   'weight' | 'temp' — stored canonically, shown in the user's unit
   *   band      (value, ctx) => {label, color} — the interpretation line under the value
   *   aggregate (values[]) => number — how same-day samples collapse; default is the mean
   *
   * Band and aggregate are wrapped rather than referenced directly so they resolve at
   * call time. This array is built when the file loads, and load order should not be
   * able to silently turn one of them into undefined.
   */
  const METRICS = [
    { type: 'weight',        label: 'Weight',         unit: 'kg',   dp: 1, group: 'composition', convert: 'weight', color: 'var(--info)' },
    { type: 'body_fat_pct',  label: 'Body fat',       unit: '%',    dp: 1, group: 'composition', higherIsBetter: false, color: 'var(--strain)' },
    { type: 'lean_mass',     label: 'Lean mass',      unit: 'kg',   dp: 1, group: 'composition', convert: 'weight', higherIsBetter: true, color: 'var(--recovery)' },

    { type: 'resting_hr',    label: 'Resting HR',     unit: 'bpm',  dp: 0, group: 'vitals', higherIsBetter: false, color: 'var(--stress)',
      band: (v) => V.vitals.restingHrBand(v) },
    { type: 'hrv',           label: 'HRV (SDNN)',     unit: 'ms',   dp: 0, group: 'vitals', higherIsBetter: true,  color: 'var(--recovery)',
      band: (v, ctx) => V.vitals.hrvBand(v, ctx.baseline) },
    { type: 'respiratory_rate', label: 'Respiratory rate', unit: 'br/min', dp: 0, group: 'vitals', higherIsBetter: false, color: 'var(--info)',
      band: (v) => V.vitals.respiratoryRateBand(v) },
    { type: 'spo2',          label: 'Blood oxygen',   unit: '%',    dp: 0, group: 'vitals', higherIsBetter: true, color: 'var(--recovery)',
      band: (v) => V.vitals.spo2Band(v), caveat: (v) => V.vitals.spo2Caveat(v) },
    { type: 'systolic',      label: 'Systolic BP',    unit: 'mmHg', dp: 0, group: 'vitals', higherIsBetter: false, color: 'var(--stress)' },
    { type: 'diastolic',     label: 'Diastolic BP',   unit: 'mmHg', dp: 0, group: 'vitals', higherIsBetter: false, color: 'var(--stress)' },
    { type: 'body_temp',     label: 'Body temperature', unit: '°C', dp: 1, group: 'vitals', convert: 'temp', color: 'var(--warn)',
      band: (v) => V.vitals.bodyTempBand(v) },

    { type: 'sound_exposure',     label: 'Environmental sound', unit: 'dBA', dp: 0, group: 'hearing', higherIsBetter: false, color: 'var(--sound)',
      band: (v) => V.sound.band(v), aggregate: (vals) => V.sound.meanDb(vals) },
    { type: 'headphone_exposure', label: 'Headphone sound',     unit: 'dBA', dp: 0, group: 'hearing', higherIsBetter: false, color: 'var(--sound)',
      band: (v) => V.sound.band(v), aggregate: (vals) => V.sound.meanDb(vals) },

    { type: 'sleep_hours',   label: 'Sleep',          unit: 'h',    dp: 1, group: 'activity', higherIsBetter: true,  color: 'var(--sleep)' },
    { type: 'steps',         label: 'Steps',          unit: '',     dp: 0, group: 'activity', higherIsBetter: true,  color: 'var(--strain)' },
    { type: 'vo2max',        label: 'VO₂ max',        unit: '',     dp: 1, group: 'activity', higherIsBetter: true,  color: 'var(--recovery)' },
  ];

  /** Section order and headings for the measurement list. */
  const GROUPS = [
    { key: 'composition', label: 'Body composition' },
    { key: 'vitals',      label: 'Vitals' },
    { key: 'hearing',     label: 'Hearing' },
    { key: 'activity',    label: 'Activity & sleep' },
  ];

  /** Metrics are stored canonically (kg, °C) and displayed in the user's chosen unit. */
  function toDisplay(meta, value, settings) {
    if (meta.convert === 'weight') return V.kgToDisplay(value, settings.weightUnit);
    if (meta.convert === 'temp') return V.cToDisplay(value, settings.tempUnit);
    return value;
  }
  function fromDisplay(meta, value, settings) {
    if (meta.convert === 'weight') return V.displayToKg(value, settings.weightUnit);
    if (meta.convert === 'temp') return V.displayToC(value, settings.tempUnit);
    return value;
  }
  function unitLabel(meta, settings) {
    if (meta.convert === 'weight') return settings.weightUnit;
    if (meta.convert === 'temp') return settings.tempUnit === 'f' ? '°F' : '°C';
    return meta.unit;
  }

  /**
   * Interpretation band for a reading, in canonical units.
   * `daily` is passed so bands that need the person's own history (HRV) can build one.
   */
  function bandFor(meta, canonicalValue, daily) {
    if (!meta.band) return null;
    const baseline = V.vitals.baseline(daily);
    return meta.band(canonicalValue, { baseline, daily });
  }

  // ============================================================= detail sheet

  function openMetricSheet(meta) {
    V.ui.sheet(meta.label, async (body) => {
      const settings = await V.store.settings.get();
      const daily = await V.store.metrics.daily(meta.type, meta.aggregate);
      const u = unitLabel(meta, settings);

      // ---- Where this reading sits ----------------------------------------
      if (daily.length) {
        const latestValue = daily[daily.length - 1].value;
        const band = bandFor(meta, latestValue, daily);
        if (band) {
          body.appendChild(
            V.el('div', {
              className: 'band-line',
              style: { color: band.color },
              text: `${V.fmt(toDisplay(meta, latestValue, settings), meta.dp)} ${u} — ${band.label}`,
            }),
          );
        }
        if (meta.caveat) {
          body.appendChild(V.el('div', { className: 'hint', text: meta.caveat(latestValue) }));
        }
      }

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

      // ---- Body composition -------------------------------------------------
      const [latestWeight, latestBf] = await Promise.all([
        V.store.metrics.latest('weight'),
        V.store.metrics.latest('body_fat_pct'),
      ]);
      const weightKg = latestWeight ? latestWeight.value : settings.weightKg;
      const bfPct = latestBf ? latestBf.value : null;

      const bmi = V.life.bmi(weightKg, settings.heightCm);
      const bmiCat = V.life.bmiCategory(bmi);
      const ffmi = V.life.ffmi(weightKg, settings.heightCm, bfPct);

      if (bmi != null) {
        const tiles = [
          V.ui.stat({ label: 'BMI', value: V.fmt(bmi, 1) }),
        ];
        if (ffmi) {
          const band = V.life.ffmiBand(ffmi.normalised, settings.sex);
          tiles.push(V.ui.stat({ label: 'FFMI', value: V.fmt(ffmi.normalised, 1) }));
          tiles.push(V.ui.stat({ label: 'Lean mass', value: V.fmt(V.kgToDisplay(V.life.leanMass(weightKg, bfPct), settings.weightUnit), 1), unit: ' ' + settings.weightUnit }));
          void band;
        }

        const children = [V.el('div', { className: 'grid-3' }, tiles)];

        children.push(
          V.el('div', {
            className: 'hint',
            style: { color: bmiCat.color },
            text: bmiCat.label,
          }),
        );

        if (ffmi) {
          const band = V.life.ffmiBand(ffmi.normalised, settings.sex);
          children.push(
            V.el('div', { className: 'hint', style: { color: band.color }, text: 'FFMI: ' + band.label }),
          );
        }

        children.push(V.el('div', { className: 'hint', text: V.life.bmiCaveat(bmi, bfPct) }));

        root.appendChild(V.ui.card({ title: 'Body composition', children }));
      }

      // ---- Weight cut -------------------------------------------------------
      const hearingOn = V.features.enabled(settings, 'hearing');

      if (V.features.enabled(settings, 'cut')) {
        const activeCut = await V.store.cuts.active();
        root.appendChild(
          V.ui.list([
            V.ui.row({
              title: 'Weight cut',
              sub: activeCut
                ? `${activeCut.name} · weigh-in ${V.friendlyDate(V.dateKey(new Date(activeCut.weighInAt)))}`
                : 'For combat sports — plan a cut safely',
              value: activeCut ? '●' : '›',
              onClick: () => (activeCut ? V.cutView.openCutSheet() : V.cutView.openNewCutSheet()),
            }),
          ]),
        );
      }

      const rowsByGroup = {};
      let anyData = false;

      for (const meta of METRICS) {
        // Skip the query entirely for a group that is switched off.
        if (meta.group === 'hearing' && !hearingOn) continue;
        const daily = await V.store.metrics.daily(meta.type, meta.aggregate);
        const u = unitLabel(meta, settings);
        const group = (rowsByGroup[meta.group] = rowsByGroup[meta.group] || []);

        if (!daily.length) {
          group.push(
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
        const band = bandFor(meta, latest.value, daily);

        group.push(
          V.ui.row({
            title: meta.label,
            // The band says more than the slope, so it wins the subtitle where there is one.
            sub: band
              ? band.label
              : trend && trend.reliable
                ? `${trend.perWeek >= 0 ? '+' : ''}${V.fmt(trend.perWeek, meta.dp + 1)} ${u}/week`
                : V.friendlyDate(latest.date),
            subColor: band ? band.color : null,
            value: V.fmt(toDisplay(meta, latest.value, settings), meta.dp) + ' ' + u,
            accessory: display.length >= 3
              ? V.charts.sparkline(display.slice(-20).map((d) => d.value), { color: meta.color })
              : null,
            onClick: () => openMetricSheet(meta),
          }),
        );
      }

      const headphoneCard = hearingOn ? await V.soundView.buildHeadphoneCard() : null;

      for (const g of GROUPS) {
        if (g.key === 'hearing' && !hearingOn) continue;
        const rows = rowsByGroup[g.key];
        if (!rows || !rows.length) continue;
        root.appendChild(V.ui.sectionTitle(g.label));

        if (g.key === 'hearing') {
          if (headphoneCard) root.appendChild(headphoneCard);
          root.appendChild(
            V.ui.button('Measure the room now', () => V.soundView.openMeterSheet(), 'btn-primary'),
          );
          root.appendChild(V.el('div', { style: { height: '10px' } }));
        }

        root.appendChild(V.ui.list(rows));
      }

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
