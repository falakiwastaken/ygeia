/* Ygeia — Settings: profile, targets, data import/export. */
(function (V) {
  'use strict';

  V.views = V.views || {};

  // ============================================================ profile sheet

  function openProfileSheet() {
    V.ui.sheet('Profile & targets', async (body) => {
      const s = await V.store.settings.get();

      const age = V.ui.input({ type: 'number', value: String(s.age), step: '1' });
      const height = V.ui.input({
        type: 'number', step: '1',
        value: String(V.round(V.cmToDisplay(s.heightCm, s.heightUnit), 1)),
      });
      const weight = V.ui.input({
        type: 'number', step: '0.1',
        value: String(V.round(V.kgToDisplay(s.weightKg, s.weightUnit), 1)),
      });
      const proteinPerKg = V.ui.input({ type: 'number', step: '0.1', value: String(s.proteinPerKg) });

      let sex = s.sex, activity = s.activityLevel, goal = s.goal;

      const sexWrap = V.el('div');
      const actWrap = V.el('div');
      const goalWrap = V.el('div');
      const preview = V.el('div');

      function currentProfile() {
        return {
          sex,
          age: V.ui.num(age, 30),
          heightCm: V.displayToCm(V.ui.num(height, 175), s.heightUnit),
          weightKg: V.displayToKg(V.ui.num(weight, 75), s.weightUnit),
          activityLevel: activity,
          goal,
          proteinPerKg: V.ui.num(proteinPerKg, 1.8),
          // Overrides are deliberately ignored here so the preview shows what the
          // profile *would* produce, which is what the user is editing.
        };
      }

      function renderAll() {
        sexWrap.innerHTML = '';
        sexWrap.appendChild(
          V.ui.segmented(
            [
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'unspecified', label: 'Prefer not to say' },
            ],
            sex,
            (v) => { sex = v; renderAll(); },
          ),
        );

        actWrap.innerHTML = '';
        actWrap.appendChild(
          V.ui.segmented(
            Object.keys(V.domain.ACTIVITY_MULTIPLIER).map((k) => ({
              value: k,
              label: k.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase()),
            })),
            activity,
            (v) => { activity = v; renderAll(); },
          ),
        );

        goalWrap.innerHTML = '';
        goalWrap.appendChild(
          V.ui.segmented(
            Object.keys(V.domain.GOAL_LABEL).map((k) => ({ value: k, label: V.domain.GOAL_LABEL[k] })),
            goal,
            (v) => { goal = v; renderAll(); },
          ),
        );

        const p = currentProfile();
        const t = V.domain.macroTargets(p);
        preview.innerHTML = '';
        preview.appendChild(
          V.el('div', { className: 'grid-2' }, [
            V.ui.stat({ label: 'BMR', value: V.fmt(V.domain.bmr(p)), unit: ' kcal' }),
            V.ui.stat({ label: 'Maintenance', value: V.fmt(V.domain.tdee(p)), unit: ' kcal' }),
            V.ui.stat({ label: 'Daily target', value: V.fmt(t.kcal), unit: ' kcal' }),
            V.ui.stat({ label: 'Protein', value: V.fmt(t.protein), unit: ' g' }),
          ]),
        );
        preview.appendChild(
          V.el('div', {
            className: 'hint',
            text: `${V.domain.ACTIVITY_LABEL[activity]}. Activity already includes training — ` +
                  'don\'t add workout calories on top.',
          }),
        );
      }

      for (const inp of [age, height, weight, proteinPerKg]) inp.addEventListener('input', renderAll);

      body.appendChild(V.ui.field('Sex (for BMR equation)', sexWrap,
        'Mifflin-St Jeor uses a sex term. "Prefer not to say" averages the two constants.'));
      body.appendChild(V.el('div', { className: 'grid-2' }, [
        V.ui.field('Age', age),
        V.ui.field(`Height (${s.heightUnit})`, height),
        V.ui.field(`Weight (${s.weightUnit})`, weight),
        V.ui.field('Protein g/kg', proteinPerKg),
      ]));
      body.appendChild(V.ui.field('Activity level', actWrap));
      body.appendChild(V.ui.field('Goal', goalWrap));
      body.appendChild(V.ui.sectionTitle('Calculated'));
      body.appendChild(preview);

      body.appendChild(V.el('div', { style: { height: '16px' } }));
      body.appendChild(
        V.ui.button('Save', async () => {
          const p = currentProfile();
          await V.store.settings.set({
            sex: p.sex, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg,
            activityLevel: p.activityLevel, goal: p.goal, proteinPerKg: p.proteinPerKg,
            // Editing the profile means the user wants derived targets again.
            kcalOverride: null, proteinOverride: null, carbsOverride: null, fatOverride: null,
          });
          V.ui.closeSheet();
          V.toast('Profile saved');
          V.app.render();
        }, 'btn-primary'),
      );

      renderAll();
    });
  }

  // ======================================================== health import UI

  function openHealthImportSheet() {
    V.ui.sheet('Import Apple Health', (body) => {
      body.appendChild(
        V.el('div', { className: 'hint' }, [
          document.createTextNode(
            'A web app cannot read Apple Health directly — Apple provides no browser API for it. ' +
            'What it can read is the export file:',
          ),
        ]),
      );

      const steps = [
        'Open the Health app on your iPhone',
        'Tap your profile picture (top right)',
        'Scroll down and tap “Export All Health Data”',
        'Save the zip to Files (this takes a few minutes)',
        'In Files, tap the zip once to uncompress it',
        'Come back here and choose apple_health_export/export.xml',
      ];
      body.appendChild(
        V.ui.list(steps.map((t, i) => V.ui.row({ title: `${i + 1}. ${t}` }))),
      );

      const fileInput = V.el('input', { type: 'file', accept: '.xml,text/xml', style: { marginTop: '16px' } });
      const status = V.el('div', { className: 'hint' });
      const progress = V.el('div', { className: 'bar', style: { marginTop: '12px', display: 'none' } }, [
        V.el('div', { className: 'bar-fill', style: { width: '0%', background: 'var(--info)' } }),
      ]);

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;

        progress.style.display = 'block';
        const fill = progress.firstChild;
        status.textContent = 'Reading… this can take a few minutes for a large export.';
        fileInput.disabled = true;

        try {
          const result = await V.health.importFile(file, (p) => {
            const pct = p.totalBytes ? (p.bytesRead / p.totalBytes) * 100 : 0;
            fill.style.width = pct.toFixed(1) + '%';
            status.textContent = `${V.fmt(p.records)} records read (${pct.toFixed(0)}%)`;
          });

          fill.style.width = '100%';
          const summary = Object.keys(result.byMetric)
            .map((k) => `${k.replace(/_/g, ' ')}: ${result.byMetric[k]} days`)
            .join(' · ');
          status.textContent = `Imported ${V.fmt(result.days)} daily values from ${V.fmt(result.records)} records. ${summary}`;
          V.toast('Import complete');
          V.app.render();
        } catch (err) {
          progress.style.display = 'none';
          status.textContent = err.message;
        } finally {
          fileInput.disabled = false;
        }
      });

      body.appendChild(fileInput);
      body.appendChild(progress);
      body.appendChild(status);
      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Nothing is uploaded. The file is parsed on this device and only daily ' +
                'summaries are stored. Re-importing a newer export updates existing days.',
        }),
      );
    });
  }

  // ============================================================ backup / wipe

  async function exportBackup() {
    const stores = ['foods', 'foodLogs', 'recipes', 'exercises', 'templates', 'workouts', 'sets', 'metrics', 'kv'];
    const data = { format: 'ygeia-backup', version: 1, exportedAt: new Date().toISOString(), stores: {} };
    for (const s of stores) data.stores[s] = await V.store.db.all(s);

    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = V.el('a', { href: url, download: `ygeia-backup-${V.today()}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick — revoking synchronously can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    V.toast('Backup downloaded');
  }

  function openRestoreSheet() {
    V.ui.sheet('Restore backup', (body) => {
      body.appendChild(
        V.el('div', {
          className: 'warn-box',
          text: 'Restoring replaces everything currently in the app. Export a backup first ' +
                'if you might want to come back to the current data.',
        }),
      );

      const input = V.el('input', { type: 'file', accept: '.json,application/json', style: { marginTop: '16px' } });
      const status = V.el('div', { className: 'hint' });

      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          // 'vitals-backup' was the tag before the app was renamed — still accepted so
          // early backups keep restoring.
          const ACCEPTED = ['ygeia-backup', 'Ygeia-backup', 'vitals-backup'];
          if (!ACCEPTED.includes(data.format)) throw new Error('That is not a Ygeia backup file.');
          if (!V.confirm('Replace all current data with this backup?')) return;

          for (const name in data.stores) {
            if (!V.store.SCHEMA[name]) continue; // ignore stores from a future version
            await V.store.db.clear(name);
            if (data.stores[name].length) await V.store.db.putMany(name, data.stores[name]);
          }

          V.store.settings.invalidate();
          await V.app.applyTheme();
          V.ui.closeSheet();
          V.toast('Backup restored');
          V.app.render();
        } catch (err) {
          status.textContent = err.message;
        }
      });

      body.appendChild(input);
      body.appendChild(status);
    });
  }

  // =================================================================== view

  V.views.settings = {
    async render() {
      const s = await V.store.settings.get();
      const targets = V.domain.macroTargets(s);
      const root = V.el('div');

      // ---- Targets ----------------------------------------------------------
      root.appendChild(
        V.ui.card({
          title: 'Daily targets',
          sub: (s.kcalOverride != null ? 'Manually adjusted' : 'Calculated from your profile'),
          children: [
            V.el('div', { className: 'grid-2' }, [
              V.ui.stat({ label: 'Calories', value: V.fmt(targets.kcal), unit: ' kcal' }),
              V.ui.stat({ label: 'Protein', value: V.fmt(targets.protein), unit: ' g' }),
              V.ui.stat({ label: 'Carbs', value: V.fmt(targets.carbs), unit: ' g' }),
              V.ui.stat({ label: 'Fat', value: V.fmt(targets.fat), unit: ' g' }),
            ]),
            V.el('div', { style: { height: '12px' } }),
            V.ui.button('Edit profile & goal', openProfileSheet, 'btn-primary'),
            s.kcalOverride != null
              ? V.el('div', {}, [
                  V.el('div', { style: { height: '8px' } }),
                  V.ui.button('Reset to calculated', async () => {
                    await V.store.settings.set({ kcalOverride: null });
                    V.toast('Reset');
                    V.app.render();
                  }, 'btn-ghost'),
                ])
              : null,
          ],
        }),
      );

      // ---- Units and appearance --------------------------------------------
      root.appendChild(V.ui.sectionTitle('Units & appearance'));

      const unitWrap = V.el('div');
      function renderUnits() {
        unitWrap.innerHTML = '';
        unitWrap.appendChild(
          V.ui.list([
            V.ui.row({
              title: 'Weight',
              accessory: V.ui.segmented(
                [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }],
                s.weightUnit,
                async (v) => { await V.store.settings.set({ weightUnit: v }); s.weightUnit = v; renderUnits(); V.app.render(); },
              ),
            }),
            V.ui.row({
              title: 'Height',
              accessory: V.ui.segmented(
                [{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }],
                s.heightUnit,
                async (v) => { await V.store.settings.set({ heightUnit: v }); s.heightUnit = v; renderUnits(); },
              ),
            }),
            V.ui.row({
              title: 'Theme',
              accessory: V.ui.segmented(
                [{ value: 'auto', label: 'Auto' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
                s.theme,
                async (v) => {
                  await V.store.settings.set({ theme: v });
                  s.theme = v;
                  await V.app.applyTheme();
                  renderUnits();
                },
              ),
            }),
          ]),
        );
      }
      renderUnits();
      root.appendChild(unitWrap);

      // ---- Nutrition rules --------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Nutrition rules'));

      const lateHour = V.ui.input({ type: 'number', value: String(s.lateMealHour), min: '12', max: '23' });
      const lateKcal = V.ui.input({ type: 'number', value: String(s.lateMealMinKcal), min: '0' });
      lateHour.addEventListener('change', () => V.store.settings.set({ lateMealHour: Math.round(V.ui.num(lateHour, 21)) }));
      lateKcal.addEventListener('change', () => V.store.settings.set({ lateMealMinKcal: Math.round(V.ui.num(lateKcal, 150)) }));

      root.appendChild(
        V.ui.card({
          children: [
            V.el('div', { className: 'grid-2' }, [
              V.ui.field('Late meal after (hour)', lateHour),
              V.ui.field('Minimum kcal to count', lateKcal),
            ]),
            V.el('div', {
              className: 'hint',
              text: 'The calorie floor stops water, tea and supplements being flagged as late meals.',
            }),
          ],
        }),
      );

      // ---- Training ---------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Training'));

      const bar = V.ui.input({ type: 'number', value: String(s.barWeightKg), step: '0.5' });
      const plates = V.ui.input({ type: 'text', value: s.availablePlatesKg.join(', ') });
      const rest = V.ui.input({ type: 'number', value: String(s.defaultRestSec), step: '15' });

      bar.addEventListener('change', () => V.store.settings.set({ barWeightKg: V.ui.num(bar, 20) }));
      rest.addEventListener('change', () => V.store.settings.set({ defaultRestSec: Math.round(V.ui.num(rest, 120)) }));
      plates.addEventListener('change', () => {
        const parsed = plates.value
          .split(',')
          .map((x) => parseFloat(x.trim()))
          .filter((x) => Number.isFinite(x) && x > 0)
          .sort((a, b) => b - a);
        if (parsed.length) V.store.settings.set({ availablePlatesKg: parsed });
        else V.toast('Enter plate weights separated by commas');
      });

      root.appendChild(
        V.ui.card({
          children: [
            V.el('div', { className: 'grid-2' }, [
              V.ui.field('Bar weight (kg)', bar),
              V.ui.field('Rest timer (sec)', rest),
            ]),
            V.ui.field('Available plates (kg, per side)', plates),
          ],
        }),
      );

      // ---- Data -------------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Data'));
      root.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Import from Apple Health',
            sub: 'Read your Health export file',
            onClick: openHealthImportSheet,
          }),
          V.ui.row({
            title: 'Export backup',
            sub: 'Download everything as JSON',
            onClick: exportBackup,
          }),
          V.ui.row({
            title: 'Restore backup',
            sub: 'Replace all data from a file',
            onClick: openRestoreSheet,
          }),
        ]),
      );

      const counts = await Promise.all([
        V.store.db.count('foods'), V.store.db.count('foodLogs'),
        V.store.db.count('workouts'), V.store.db.count('metrics'),
      ]);
      root.appendChild(
        V.el('div', {
          className: 'hint',
          text: `${counts[0]} foods · ${counts[1]} diary entries · ${counts[2]} workouts · ${counts[3]} measurements`,
        }),
      );

      // ---- How it's calculated ----------------------------------------------
      root.appendChild(V.ui.sectionTitle('How it’s calculated'));
      root.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Calorie target',
            sub: 'Mifflin-St Jeor → TDEE → goal',
            value: '›',
            onClick: async () => V.explain.open(V.explain.calorieTarget(await V.store.settings.get())),
          }),
          V.ui.row({
            title: 'Macro targets',
            sub: 'Protein per kg, fat floor, carbs as remainder',
            value: '›',
            onClick: async () => V.explain.open(V.explain.macroTargets(await V.store.settings.get())),
          }),
          V.ui.row({
            title: 'Nutrition score',
            sub: 'Weighted components, renormalised',
            value: '›',
            onClick: async () => {
              const st = await V.store.settings.get();
              const entries = await V.store.foodLog.resolved(V.app.state.date);
              const scored = V.domain.nutritionScore(entries, V.domain.macroTargets(st), st);
              V.explain.open(V.explain.nutritionScore(scored));
            },
          }),
          V.ui.row({
            title: 'Estimated 1RM',
            sub: 'Blended Brzycki / Epley',
            value: '›',
            onClick: () => V.explain.open(V.explain.oneRepMax(100, 5)),
          }),
          V.ui.row({
            title: 'BMI and FFMI',
            sub: 'Including why BMI misreads lifters',
            value: '›',
            onClick: async () => {
              const st = await V.store.settings.get();
              const bf = await V.store.metrics.latest('body_fat_pct');
              V.explain.open(V.explain.bmi(st.weightKg, st.heightCm, bf ? bf.value : null, st.sex));
            },
          }),
          V.ui.row({
            title: 'Weight cut split',
            sub: 'Gradual vs acute, and the safety limits',
            value: '›',
            onClick: async () => {
              const st = await V.store.settings.get();
              const plan = V.cut.plan({
                currentKg: st.weightKg,
                targetKg: st.weightKg - 3,
                weighInAt: Date.now() + 7 * 86400000,
                sex: st.sex,
              });
              V.explain.open(V.explain.weightCut(plan, st.weightUnit));
            },
          }),
        ]),
      );
      root.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Every derived number can show its working — formula, your actual inputs, ' +
                'each step, and the source. If something looks wrong, the same screen has a ' +
                'button that opens a pre-filled bug report.',
        }),
      );

      // ---- Privacy ----------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Privacy'));
      root.appendChild(
        V.ui.card({
          children: [
            V.el('div', {
              className: 'card-sub',
              text: 'Everything you log is stored only in this browser, on this device. There is no ' +
                    'account, no server and no analytics. The single network request the app can make ' +
                    'is a food lookup to Open Food Facts when you search — and only then.',
            }),
          ],
        }),
      );

      // ---- Danger -----------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Danger zone'));
      root.appendChild(
        V.ui.button('Erase all data', async () => {
          if (!V.confirm('Erase everything? This cannot be undone.')) return;
          if (!V.confirm('Really erase all logs, workouts and measurements?')) return;
          for (const name in V.store.SCHEMA) await V.store.db.clear(name);
          V.store.settings.invalidate();
          V.toast('All data erased');
          location.reload();
        }, 'btn-danger'),
      );

      root.appendChild(
        V.el('div', {
          className: 'hint',
          style: { textAlign: 'center', marginTop: '24px' },
          text: 'Ygeia · free and open source · MIT licence',
        }),
      );

      return root;
    },
  };
})(window.V);
