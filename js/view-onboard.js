/*
 * Ygeia — first run.
 *
 * There is no login, because there is no account and no server. What a health tracker
 * actually needs on first run is not an identity, it is a body: age, height, weight and
 * roughly how active you are. Without those, the calorie and macro targets are computed
 * for a fictional 30-year-old and are wrong for everyone.
 *
 * So this asks for those, shows what they produce as you type, and then offers a passcode
 * for people who share a device. Every step is skippable — someone who just wants to poke
 * around should not have to fill in a form first, and the defaults are sane enough that
 * skipping leaves a working app.
 */
(function (V) {
  'use strict';

  const O = {};

  O.shouldShow = async function () {
    const s = await V.store.settings.get();
    return !s.onboarded;
  };

  /** Mark it done regardless of how it ended, so it never nags twice. */
  async function finish() {
    await V.store.settings.set({ onboarded: true });
    V.ui.closeSheet(true);
    V.app.render();
  }

  O.open = function (opts) {
    const isRerun = !!(opts && opts.rerun);
    let step = 0;

    V.ui.sheet('Welcome to Ygeia', async (body) => {
      const settings = await V.store.settings.get();

      // Working copy — nothing is written until the user moves on from the profile step.
      const draft = {
        sex: settings.sex,
        age: settings.age,
        heightCm: settings.heightCm,
        weightKg: settings.weightKg,
        activityLevel: settings.activityLevel,
        goal: settings.goal,
        weightUnit: settings.weightUnit,
        heightUnit: settings.heightUnit,
      };

      const host = V.el('div');
      body.appendChild(host);

      const steps = [renderWelcome, renderProfile, renderLock, renderDone];

      function go(n) {
        step = V.clamp(n, 0, steps.length - 1);
        V.$('#sheet-title').textContent =
          ['Welcome to Ygeia', 'About you', 'Keep it private?', 'All set'][step];
        host.innerHTML = '';
        steps[step](host);
        body.scrollTop = 0;
      }

      // ------------------------------------------------------------ welcome --

      function renderWelcome(el) {
        el.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'No account, no sign-up. Everything is stored on your phone.',
          }),
        );

        el.appendChild(V.ui.sectionTitle('What it tracks'));
        el.appendChild(
          V.ui.list([
            V.ui.row({ title: 'Food', sub: 'Macros, a daily quality score, 133 foods built in' }),
            V.ui.row({ title: 'Training', sub: 'Lifts, sport, progression and your own strength progress' }),
            V.ui.row({ title: 'Body', sub: 'Weight, body fat, blood pressure, trends and projections' }),
            V.ui.row({ title: 'Sleep & study', sub: 'Sleep cycles, flashcards, focus blocks' }),
          ]),
        );

        el.appendChild(V.el('div', { style: { height: '16px' } }));
        el.appendChild(
          V.ui.button('Set up — takes a minute', () => go(1), 'btn-primary'),
        );
        el.appendChild(V.el('div', { style: { height: '8px' } }));
        el.appendChild(
          V.ui.button('Skip and just use it', finish, 'btn-ghost'),
        );
        el.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'Skipping is fine — you can fill this in later from Settings.',
          }),
        );
      }

      // ------------------------------------------------------------ profile --

      function renderProfile(el) {
        el.appendChild(
          V.el('div', { className: 'hint', text: 'Used to work out your calorie and macro targets.' }),
        );

        const age = V.ui.input({ type: 'number', value: String(draft.age), step: '1' });
        const height = V.ui.input({
          type: 'number', step: '1',
          value: String(V.round(V.cmToDisplay(draft.heightCm, draft.heightUnit), 1)),
        });
        const weight = V.ui.input({
          type: 'number', step: '0.1',
          value: String(V.round(V.kgToDisplay(draft.weightKg, draft.weightUnit), 1)),
        });

        const sexWrap = V.el('div');
        const actWrap = V.el('div');
        const goalWrap = V.el('div');
        const unitWrap = V.el('div');
        const preview = V.el('div');

        function current() {
          return {
            sex: draft.sex,
            age: V.ui.num(age, 30),
            heightCm: V.displayToCm(V.ui.num(height, 175), draft.heightUnit),
            weightKg: V.displayToKg(V.ui.num(weight, 75), draft.weightUnit),
            activityLevel: draft.activityLevel,
            goal: draft.goal,
            proteinPerKg: 1.8,
          };
        }

        function redraw() {
          unitWrap.innerHTML = '';
          unitWrap.appendChild(
            V.ui.segmented(
              [{ value: 'kg', label: 'kg / cm' }, { value: 'lb', label: 'lb / in' }],
              draft.weightUnit,
              (v) => {
                // Convert what is on screen so the number stays the same body, not the
                // same digits.
                const w = V.displayToKg(V.ui.num(weight, 75), draft.weightUnit);
                const h = V.displayToCm(V.ui.num(height, 175), draft.heightUnit);
                draft.weightUnit = v;
                draft.heightUnit = v === 'kg' ? 'cm' : 'in';
                weight.value = String(V.round(V.kgToDisplay(w, draft.weightUnit), 1));
                height.value = String(V.round(V.cmToDisplay(h, draft.heightUnit), 1));
                redraw();
              },
            ),
          );

          sexWrap.innerHTML = '';
          sexWrap.appendChild(
            V.ui.segmented(
              [
                { value: 'female', label: 'Female' },
                { value: 'male', label: 'Male' },
                { value: 'unspecified', label: 'Rather not say' },
              ],
              draft.sex,
              (v) => { draft.sex = v; redraw(); },
            ),
          );

          actWrap.innerHTML = '';
          actWrap.appendChild(
            V.ui.segmented(
              Object.keys(V.domain.ACTIVITY_MULTIPLIER).map((k) => ({
                value: k,
                label: k.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase()),
              })),
              draft.activityLevel,
              (v) => { draft.activityLevel = v; redraw(); },
            ),
          );

          goalWrap.innerHTML = '';
          goalWrap.appendChild(
            V.ui.segmented(
              Object.keys(V.domain.GOAL_LABEL).map((k) => ({ value: k, label: V.domain.GOAL_LABEL[k] })),
              draft.goal,
              (v) => { draft.goal = v; redraw(); },
            ),
          );

          // Showing the result as they type is the whole reason this step is worth doing.
          const p = current();
          const t = V.domain.macroTargets(p);
          preview.innerHTML = '';
          preview.appendChild(
            V.el('div', { className: 'grid-2' }, [
              V.ui.stat({ label: 'Daily calories', value: V.fmt(t.kcal), unit: ' kcal' }),
              V.ui.stat({ label: 'Protein', value: V.fmt(t.protein), unit: ' g' }),
              V.ui.stat({ label: 'Carbs', value: V.fmt(t.carbs), unit: ' g' }),
              V.ui.stat({ label: 'Fat', value: V.fmt(t.fat), unit: ' g' }),
            ]),
          );
          preview.appendChild(
            V.el('div', {
              className: 'hint',
              text: V.domain.ACTIVITY_LABEL[draft.activityLevel] +
                    '. Activity already includes your training, so never add workout calories on top.',
            }),
          );
        }

        for (const inp of [age, height, weight]) inp.addEventListener('input', redraw);

        el.appendChild(V.ui.field('Units', unitWrap));
        el.appendChild(V.ui.field('Sex', sexWrap,
          'The BMR equation has a sex term. "Rather not say" averages the two constants.'));
        el.appendChild(V.el('div', { className: 'grid-2' }, [
          V.ui.field('Age', age),
          V.ui.field(draft.heightUnit === 'cm' ? 'Height (cm)' : 'Height (in)', height),
        ]));
        el.appendChild(V.ui.field(draft.weightUnit === 'kg' ? 'Weight (kg)' : 'Weight (lb)', weight));
        el.appendChild(V.ui.field('How active are you?', actWrap));
        el.appendChild(V.ui.field('Goal', goalWrap));

        el.appendChild(V.ui.sectionTitle('Your targets'));
        el.appendChild(preview);

        el.appendChild(V.el('div', { style: { height: '16px' } }));
        el.appendChild(
          V.ui.button('Continue', async () => {
            const p = current();
            await V.store.settings.set({
              sex: p.sex, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg,
              activityLevel: p.activityLevel, goal: p.goal,
              weightUnit: draft.weightUnit, heightUnit: draft.heightUnit,
              kcalOverride: null, proteinOverride: null, carbsOverride: null, fatOverride: null,
            });
            // Seed the first weight reading so trends have somewhere to start.
            await V.store.metrics.save({
              id: V.uid(), type: 'weight', date: V.today(),
              recordedAt: Date.now(), value: p.weightKg, source: 'manual',
            });
            go(2);
          }, 'btn-primary'),
        );
        el.appendChild(V.el('div', { style: { height: '8px' } }));
        el.appendChild(V.ui.button('Skip this', finish, 'btn-ghost'));

        redraw();
      }

      // --------------------------------------------------------------- lock --

      function renderLock(el) {
        const reason = V.auth.unavailableReason();

        el.appendChild(
          V.el('div', { className: 'hint' }, [
            document.createTextNode(
              'Optional. A passcode stops someone who picks up your phone from opening ' +
              'Ygeia. Most people on their own device do not need one.',
            ),
          ]),
        );

        if (reason) {
          el.appendChild(V.el('div', { className: 'warn-box', style: { marginTop: '12px' }, text: reason }));
        } else {
          el.appendChild(V.el('div', { style: { height: '12px' } }));
          el.appendChild(
            V.ui.button('Set a passcode', async () => {
              const done = await V.lockScreen.setNewPasscode();
              if (done) { V.toast('Passcode set'); go(3); }
            }, 'btn-primary'),
          );
        }

        el.appendChild(V.el('div', { style: { height: '8px' } }));
        el.appendChild(V.ui.button('No passcode', () => go(3), 'btn-ghost'));

        el.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'It locks the app but does not encrypt what is stored, and there is no way ' +
                  'to reset it — no server means nobody can let you back in. You can add or ' +
                  'remove one later in Settings.',
          }),
        );
      }

      // --------------------------------------------------------------- done --

      function renderDone(el) {
        el.appendChild(
          V.el('div', { className: 'good-box' }, [
            V.el('div', { html: '<strong>Ready.</strong>' }),
            V.el('div', {
              style: { marginTop: '6px' },
              text: 'Log a meal from the Food tab, start a workout from Train, or just look ' +
                    'around. Nothing needs setting up.',
            }),
          ]),
        );

        el.appendChild(V.ui.sectionTitle('Worth knowing'));
        el.appendChild(
          V.ui.list([
            V.ui.row({
              title: 'Back up now and then',
              sub: 'With no server, a backup is the only way to recover if this device is lost',
            }),
            V.ui.row({
              title: 'Add it to your home screen',
              sub: 'Runs fullscreen and offline, and stops the browser clearing your data',
            }),
            V.ui.row({
              title: 'Every number shows its working',
              sub: 'Tap ⓘ anywhere to see the formula and where it came from',
            }),
          ]),
        );

        el.appendChild(V.el('div', { style: { height: '16px' } }));
        el.appendChild(V.ui.button('Start using Ygeia', finish, 'btn-primary'));
      }

      go(isRerun ? 1 : 0);
    });
  };

  V.onboard = O;
})(window.V);
