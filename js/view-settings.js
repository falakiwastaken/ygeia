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

  function openBackupSheet() {
    V.ui.sheet('Back up', async (body) => {
      const payload = await V.backup.collect();
      const counts = V.backup.counts(payload);
      const days = await V.backup.daysSinceBackup();

      body.appendChild(
        V.el('div', { className: 'hint' }, [
          document.createTextNode(
            `${V.fmt(counts.total)} records across ${Object.keys(counts.byStore).length} ` +
            'categories. ' +
            (days == null ? 'You have never backed up.' : days === 0 ? 'Last backed up today.' : `Last backed up ${days} day(s) ago.`),
          ),
        ]),
      );

      // ---- Encrypted --------------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Encrypted (recommended)'));

      if (!V.backup.available()) {
        body.appendChild(
          V.el('div', { className: 'warn-box', text: 'Encryption needs a secure context — open Ygeia over https:// or from localhost.' }),
        );
      } else {
        const pass = V.ui.input({ type: 'password', placeholder: 'Passphrase (8+ characters)', autocomplete: 'new-password' });
        const confirmPass = V.ui.input({ type: 'password', placeholder: 'Repeat it', autocomplete: 'new-password' });

        body.appendChild(V.ui.field('Passphrase', pass));
        body.appendChild(V.ui.field('Confirm', confirmPass));
        body.appendChild(
          V.ui.button('Download encrypted backup', async () => {
            if (pass.value !== confirmPass.value) return V.toast('The passphrases do not match');
            try {
              const result = await V.backup.exportEncrypted(pass.value);
              V.toast(`Backed up ${V.fmt(result.total)} records`);
              V.ui.closeSheet();
              V.app.render();
            } catch (err) { V.toast(err.message); }
          }, 'btn-primary'),
        );
        body.appendChild(
          V.el('div', {
            className: 'danger-box',
            style: { marginTop: '12px' },
            text: 'There is no way to recover this passphrase. Nobody holds a copy, because ' +
                  'nobody holds your data. Forget it and the backup is unreadable.',
          }),
        );
        body.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'Encrypted with AES-GCM under a PBKDF2 key. Safe to keep in iCloud, Drive ' +
                  'or email — none of which you would want holding a readable health diary. ' +
                  'The format is documented in js/backup.js so the data stays recoverable ' +
                  'with a short script even if this app disappears.',
          }),
        );
      }

      // ---- Plain ------------------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Plain JSON'));
      body.appendChild(
        V.ui.button('Download unencrypted backup', async () => {
          const result = await V.backup.exportPlain();
          V.toast(`Backed up ${V.fmt(result.total)} records`);
          V.ui.closeSheet();
          V.app.render();
        }, 'btn-ghost'),
      );
      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Readable and easy to inspect or parse, but anyone who opens the file can ' +
                'read your health diary. Keep it somewhere you control.',
        }),
      );

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Neither file contains your passcode or API key — those are stripped, since ' +
                'a backup is something people email to themselves.',
        }),
      );
    });
  }

  /**
   * The single privacy statement.
   *
   * This is the ONE place the app explains what it stores and what it sends. Do not
   * scatter restatements across other screens — a short point-of-use warning before
   * actually sending something is different and belongs where the sending happens, but
   * general reassurance belongs here and only here.
   *
   * Keep the outbound list complete. An earlier version claimed there was a single
   * network request long after there were several, which is how a privacy promise quietly
   * becomes a false statement.
   */
  function openPrivacySheet() {
    V.ui.sheet('Privacy', (body) => {
      body.appendChild(
        V.el('div', { className: 'good-box' }, [
          V.el('div', { html: '<strong>Your data is stored on your phone and never leaves it.</strong>' }),
          V.el('div', {
            style: { marginTop: '6px' },
            text: 'Every meal, workout, weight and note lives in this browser on this device. ' +
                  'There is no account, no server, no analytics and no tracking. Nobody else ' +
                  'can see any of it.',
          }),
        ]),
      );

      body.appendChild(V.ui.sectionTitle('What does leave your phone'));
      body.appendChild(
        V.ui.list([
          V.ui.row({ title: 'Food search', sub: 'The words you type go to Open Food Facts, while searching.' }),
          V.ui.row({ title: 'Nearby places', sub: 'Your approximate location goes to OpenStreetMap, only when you open Nearby.' }),
          V.ui.row({ title: 'Study photo help', sub: 'The photo and your note go to Google. Off unless you add your own key.' }),
          V.ui.row({ title: 'On-device coach', sub: 'Downloads a model. Nothing is uploaded — it then runs on your phone.' }),
        ]),
      );
      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'None of those carry anything you have logged, and everything except food ' +
                'search is off until you choose to use it.',
        }),
      );

      body.appendChild(V.ui.sectionTitle('Worth knowing'));
      body.appendChild(
        V.ui.list([
          V.ui.row({ title: 'There is no recovery', sub: 'Nobody holds a copy. Lose the phone without a backup and it is gone.' }),
          V.ui.row({ title: 'A passcode locks, it does not encrypt', sub: 'It stops someone opening the app; it does not scramble what is stored.' }),
          V.ui.row({ title: 'Encrypt backups before cloud storage', sub: 'The plain download is readable by anyone who opens it.' }),
          V.ui.row({ title: 'Open source', sub: 'All of this is checkable — the code is public under the MIT licence.' }),
        ]),
      );
    });
  }

  function openRestoreSheet() {
    V.ui.sheet('Restore from a backup', (body) => {
      body.appendChild(
        V.el('div', {
          className: 'warn-box',
          text: 'Restoring replaces everything currently in the app. Back up first if there ' +
                'is anything here you want to keep. Your passcode is also removed — backups ' +
                'deliberately do not contain it, so restoring one turns the lock off and you ' +
                'will need to set it again.',
        }),
      );

      const input = V.el('input', { type: 'file', accept: '.json,application/json', style: { marginTop: '16px' } });
      const status = V.el('div', { className: 'hint' });
      const passWrap = V.el('div');
      body.appendChild(input);
      body.appendChild(passWrap);
      body.appendChild(status);

      async function apply(payload) {
        if (!V.confirm('Replace all current data with this backup?')) return;
        const n = await V.backup.restore(payload);
        await V.app.applyTheme();
        V.ui.closeSheet();
        V.toast(`Restored ${V.fmt(n)} records`);
        V.app.render();
      }

      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        passWrap.innerHTML = '';
        status.textContent = '';

        try {
          const info = await V.backup.inspect(file);
          const made = info.exportedAt ? new Date(info.exportedAt).toLocaleString() : 'unknown date';

          if (!info.encrypted) {
            status.textContent = `Plain backup from ${made}.`;
            passWrap.appendChild(V.el('div', { style: { height: '10px' } }));
            passWrap.appendChild(V.ui.button('Restore it', () => apply(info.payload), 'btn-primary'));
            return;
          }

          status.textContent = `Encrypted backup from ${made}.`;
          const pass = V.ui.input({ type: 'password', placeholder: 'Passphrase', autocomplete: 'current-password' });
          passWrap.appendChild(V.el('div', { style: { height: '10px' } }));
          passWrap.appendChild(V.ui.field('Passphrase', pass));
          passWrap.appendChild(
            V.ui.button('Decrypt and restore', async () => {
              try {
                const payload = await V.backup.decrypt(info.envelope, pass.value);
                await apply(payload);
              } catch (err) { status.textContent = err.message; }
            }, 'btn-primary'),
          );
          pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') passWrap.querySelector('.btn').click(); });
        } catch (err) {
          status.textContent = err.message;
        }
      });
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

      const reminder = await V.backup.reminderState();
      const days = await V.backup.daysSinceBackup();

      if (reminder.show) {
        root.appendChild(
          V.el('div', { className: reminder.urgent ? 'danger-box' : 'warn-box' }, [
            V.el('div', { text: reminder.message }),
            V.el('div', {
              style: { marginTop: '6px' },
              text: 'Ygeia has no server by design, so a backup is the only way to recover ' +
                    'your data if this device is lost.',
            }),
          ]),
        );
      }

      root.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Import from Apple Health',
            sub: 'Read your Health export file',
            onClick: openHealthImportSheet,
          }),
          // One tap, no questions — the version people will actually use. The warning has
          // to be here rather than only inside the encrypted sheet, since this is the row
          // most people will tap.
          V.ui.row({
            title: 'Download my data',
            sub: (days == null ? 'Never backed up' : (days === 0 ? 'Backed up today' : `Last backup ${days} day(s) ago`)) +
                 ' · unencrypted, readable by anyone who opens it',
            value: reminder.urgent ? '!' : '↓',
            onClick: async () => {
              try {
                const result = await V.backup.exportPlain();
                V.toast(`Downloaded ${V.fmt(result.total)} records`);
                V.app.render();
              } catch (err) { V.toast(err.message); }
            },
          }),
          V.ui.row({
            title: 'Import data',
            sub: 'Restore from a file you downloaded',
            value: '↑',
            onClick: openRestoreSheet,
          }),
          V.ui.row({
            title: 'Encrypted backup',
            sub: 'Password-protected, safe for cloud storage',
            value: '›',
            onClick: openBackupSheet,
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

      // ---- Security -----------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Security'));

      const passcodeSet = await V.auth.isSet();
      const cryptoReason = V.auth.unavailableReason();

      if (cryptoReason) {
        root.appendChild(V.el('div', { className: 'warn-box', text: cryptoReason }));
      } else {
        const securityRows = [
          V.ui.row({
            title: 'Passcode lock',
            sub: passcodeSet ? 'On — required to open Ygeia' : 'Off — anyone with your phone can open it',
            value: passcodeSet ? 'On' : 'Off',
            onClick: async () => {
              if (passcodeSet) {
                const current = await V.lockScreen.confirmExisting('Change passcode');
                if (current == null) return;
                await V.lockScreen.setNewPasscode(current);
                V.toast('Passcode updated');
              } else {
                const done = await V.lockScreen.setNewPasscode();
                if (done) V.toast('Passcode set');
              }
              V.app.render();
            },
          }),
        ];

        if (passcodeSet) {
          securityRows.push(
            V.ui.row({
              title: 'Auto-lock',
              accessory: V.ui.segmented(
                [{ value: 0, label: 'Never' }, { value: 1, label: '1 min' },
                 { value: 5, label: '5 min' }, { value: 30, label: '30 min' }],
                s.autoLockMinutes,
                async (v) => { await V.store.settings.set({ autoLockMinutes: v }); s.autoLockMinutes = v; V.app.render(); },
              ),
            }),
          );
          securityRows.push(
            V.ui.row({
              title: 'Remove passcode',
              sub: 'Ygeia will open without one',
              onClick: async () => {
                const current = await V.lockScreen.confirmExisting('Remove passcode');
                if (current == null) return;
                try {
                  await V.auth.removePasscode(current);
                  V.toast('Passcode removed');
                  V.app.render();
                } catch (err) { V.toast(err.message); }
              },
            }),
          );
        }

        root.appendChild(V.ui.list(securityRows));
        root.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'The passcode is never stored — only a salted PBKDF2 hash, so reading the ' +
                  'database does not reveal it. It locks the app, but it does NOT encrypt your ' +
                  'logged data: anyone with developer tools on this device could still read it. ' +
                  'There is no account and no recovery, so if you forget it you will need to ' +
                  'erase and restore from a backup.',
          }),
        );
      }

      // ---- On-device coach ----------------------------------------------------
      root.appendChild(V.ui.sectionTitle('On-device coach'));
      const localModel = await V.aiLocal.installedModel();
      root.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Local AI coach',
            sub: localModel ? localModel.replace(/-MLC$/, '') : 'Not installed — optional, few hundred MB',
            value: localModel ? 'On' : 'Off',
            onClick: () => V.coachView.openManager(),
          }),
          localModel
            ? V.ui.row({
                title: 'Open the coach',
                sub: 'Chat about your own data, entirely offline',
                onClick: () => V.coachView.openChat(),
              })
            : null,
        ].filter(Boolean)),
      );
      root.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Optional. Ygeia ships with no dependencies; installing this pulls a runtime ' +
                'and a model from the internet once, after which it runs on your device and ' +
                'nothing you type leaves it. Every number it quotes comes from the ordinary ' +
                'calculations — it is told not to invent figures.',
        }),
      );

      // ---- Study photo help ---------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Study photo help'));
      root.appendChild(V.ui.list(await V.solveView.buildSettingsRows()));
      root.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'This is the only feature that sends anything off your device, and only ever ' +
                'the photo you take plus your note — never your health data, which is enforced ' +
                'in code. Google\'s free tier may use submitted images for training and human ' +
                'reviewers can see them, so photograph the question and nothing else.',
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

      // ---- About --------------------------------------------------------------
      // The full privacy statement lives in one sheet rather than being repeated across
      // the app. It is the single source of truth: every outbound request must be listed
      // there, and nowhere else needs to restate it.
      root.appendChild(V.ui.sectionTitle('About'));
      root.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Privacy statement',
            sub: 'What is stored, and everything that leaves your phone',
            value: '>',
            onClick: openPrivacySheet,
          }),
          V.ui.row({
            title: 'Run setup again',
            sub: 'Re-enter your age, weight and goal',
            value: '>',
            onClick: () => V.onboard.open({ rerun: true }),
          }),
        ]),
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
