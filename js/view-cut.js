/*
 * Vitals — weight cut UI for combat sports.
 *
 * Opened from the Body tab. The safety state produced by V.cut.plan() drives what this
 * screen shows: an unsafe plan renders the reasons and the alternatives, and no schedule.
 */
(function (V) {
  'use strict';

  const RISK = {
    none:    { label: 'Already on weight', box: 'good-box' },
    safe:    { label: 'Within safe limits', box: 'good-box' },
    caution: { label: 'Manageable — you will feel it', box: 'warn-box' },
    high:    { label: 'High risk — supervision required', box: 'danger-box' },
    unsafe:  { label: 'Unsafe — do not attempt', box: 'danger-box' },
  };

  // ============================================================ create plan

  function openNewCutSheet() {
    V.ui.sheet('Plan a weight cut', async (body) => {
      const s = await V.store.settings.get();
      const unit = s.weightUnit;

      body.appendChild(
        V.el('div', { className: 'danger-box' }, [
          V.el('div', { html: '<strong>Read this first.</strong>' }),
          V.el('div', {
            text: 'Acute weight cutting has killed athletes — dehydration has caused deaths ' +
                  'in MMA and collegiate wrestling. This tool plans a cut using published ' +
                  'sport-science guidance and refuses to schedule one it considers unsafe. ' +
                  'It is not medical advice and does not replace a coach or a doctor.',
          }),
        ]),
      );

      const name = V.ui.input({ placeholder: 'e.g. Regional qualifier' });
      const current = V.ui.input({ type: 'number', step: '0.1', value: String(V.round(V.kgToDisplay(s.weightKg, unit), 1)) });
      const target = V.ui.input({ type: 'number', step: '0.1', placeholder: 'Weight class limit' });
      const weighIn = V.ui.input({ type: 'datetime-local' });
      const hoursToCompete = V.ui.input({ type: 'number', step: '1', value: '24' });
      const bodyFat = V.ui.input({ type: 'number', step: '0.1', placeholder: 'Optional but recommended' });

      // Default the weigh-in to a week out at 9am — the usual shape of a fight camp.
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      weighIn.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

      body.appendChild(V.ui.field('Event name', name));
      body.appendChild(V.el('div', { className: 'grid-2' }, [
        V.ui.field(`Current weight (${unit})`, current),
        V.ui.field(`Target weight (${unit})`, target),
      ]));
      body.appendChild(V.ui.field('Weigh-in date & time', weighIn));
      body.appendChild(V.el('div', { className: 'grid-2' }, [
        V.ui.field('Hours from weigh-in to first fight', hoursToCompete),
        V.ui.field('Body fat %', bodyFat),
      ]));

      const preview = V.el('div');
      body.appendChild(preview);

      function renderPreview() {
        const currentKg = V.displayToKg(V.ui.num(current, 0), unit);
        const targetKg = V.displayToKg(V.ui.num(target, 0), unit);
        const weighInAt = weighIn.value ? new Date(weighIn.value).getTime() : null;
        preview.innerHTML = '';
        if (!currentKg || !targetKg || !weighInAt) return;

        const bf = bodyFat.value.trim() ? V.ui.num(bodyFat, null) : null;
        const plan = V.cut.plan({
          currentKg, targetKg, weighInAt, sex: s.sex,
          bodyFatPct: bf,
          hoursToCompete: V.ui.num(hoursToCompete, 24),
        });
        preview.appendChild(renderAssessment(plan, unit));
      }

      for (const inp of [current, target, weighIn, bodyFat, hoursToCompete]) {
        inp.addEventListener('input', renderPreview);
        inp.addEventListener('change', renderPreview);
      }
      renderPreview();

      body.appendChild(V.el('div', { style: { height: '16px' } }));
      body.appendChild(
        V.ui.button('Start this cut', async () => {
          const currentKg = V.displayToKg(V.ui.num(current, 0), unit);
          const targetKg = V.displayToKg(V.ui.num(target, 0), unit);
          if (!currentKg || !targetKg) return V.toast('Enter both weights');
          if (!weighIn.value) return V.toast('Set the weigh-in time');
          if (targetKg >= currentKg) return V.toast('Target must be below your current weight');

          const existing = await V.store.cuts.active();
          if (existing) {
            if (!V.confirm('You already have an active cut. Replace it?')) return;
            existing.active = false;
            await V.store.cuts.save(existing);
          }

          await V.store.cuts.save({
            id: V.uid(),
            name: name.value.trim() || 'Weight cut',
            startKg: currentKg,
            targetKg,
            weighInAt: new Date(weighIn.value).getTime(),
            hoursToCompete: V.ui.num(hoursToCompete, 24),
            bodyFatPct: bodyFat.value.trim() ? V.ui.num(bodyFat, null) : null,
            createdAt: Date.now(),
            active: true,
            log: [],
          });

          V.ui.closeSheet(true);
          V.toast('Cut started');
          openCutSheet();
        }, 'btn-primary'),
      );
    });
  }

  // ============================================================== assessment

  function renderAssessment(plan, unit) {
    const wrap = V.el('div');
    const risk = RISK[plan.risk] || RISK.safe;

    wrap.appendChild(V.ui.sectionTitle('Assessment'));
    wrap.appendChild(
      V.el('div', { className: 'grid-3' }, [
        V.ui.stat({ label: 'Total', value: V.fmt(V.kgToDisplay(plan.totalKg, unit), 1), unit: ' ' + unit }),
        V.ui.stat({ label: 'Gradual', value: V.fmt(V.kgToDisplay(plan.chronicKg, unit), 1), unit: ' ' + unit }),
        V.ui.stat({ label: 'Final days', value: V.fmt(plan.acutePct * 100, 1), unit: '%' }),
      ]),
    );

    const box = V.el('div', { className: risk.box, style: { marginTop: '12px' } });
    box.appendChild(V.el('div', { html: '<strong>' + V.esc(risk.label) + '</strong>' }));
    for (const w of plan.warnings) box.appendChild(V.el('div', { text: w, style: { marginTop: '6px' } }));
    for (const n of plan.notes) box.appendChild(V.el('div', { text: n, style: { marginTop: '6px' } }));
    wrap.appendChild(box);

    if (plan.daysOut != null && plan.daysOut >= 0) {
      wrap.appendChild(
        V.el('div', { className: 'hint', text: `${V.fmt(plan.daysOut, 1)} days until weigh-in.` }),
      );
    }

    return wrap;
  }

  // ============================================================ active plan

  function openCutSheet() {
    V.ui.sheet('Weight cut', async (body) => {
      const s = await V.store.settings.get();
      const unit = s.weightUnit;
      const cutPlan = await V.store.cuts.active();

      if (!cutPlan) {
        body.appendChild(V.ui.empty('No active cut.'));
        body.appendChild(V.ui.button('Plan a cut', () => { V.ui.closeSheet(); openNewCutSheet(); }, 'btn-primary'));
        return;
      }

      const latest = cutPlan.log.length ? cutPlan.log[cutPlan.log.length - 1].kg : cutPlan.startKg;
      const plan = V.cut.plan({
        currentKg: latest,
        targetKg: cutPlan.targetKg,
        weighInAt: cutPlan.weighInAt,
        sex: s.sex,
        bodyFatPct: cutPlan.bodyFatPct,
        hoursToCompete: cutPlan.hoursToCompete,
      });

      body.appendChild(V.el('div', { className: 'card-sub', text: cutPlan.name }));

      // ---- Current state ---------------------------------------------------
      body.appendChild(
        V.el('div', { className: 'grid-3', style: { marginTop: '12px' } }, [
          V.ui.stat({ label: 'Now', value: V.fmt(V.kgToDisplay(latest, unit), 1), unit: ' ' + unit }),
          V.ui.stat({ label: 'Target', value: V.fmt(V.kgToDisplay(cutPlan.targetKg, unit), 1), unit: ' ' + unit }),
          V.ui.stat({ label: 'To go', value: V.fmt(V.kgToDisplay(Math.max(0, latest - cutPlan.targetKg), unit), 1), unit: ' ' + unit }),
        ]),
      );

      body.appendChild(renderAssessment(plan, unit));

      // ---- Daily weigh-in --------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Log today’s weight'));
      const todayKg = V.ui.input({ type: 'number', step: '0.1', placeholder: `Weight in ${unit}` });
      body.appendChild(todayKg);
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(
        V.ui.button('Save weigh-in', async () => {
          const kg = V.displayToKg(V.ui.num(todayKg, 0), unit);
          if (!kg) return V.toast('Enter a weight');

          cutPlan.log.push({ at: Date.now(), date: V.today(), kg });
          await V.store.cuts.save(cutPlan);

          // Also record it as a normal weight metric so trends stay complete.
          await V.store.metrics.save({
            id: V.uid(), type: 'weight', date: V.today(),
            recordedAt: Date.now(), value: kg, source: 'manual',
          });

          const pctLost = ((cutPlan.startKg - kg) / cutPlan.startKg) * 100;
          if (pctLost > 4) {
            V.toast('⚠ Over 4% of bodyweight lost — monitor closely');
          } else {
            V.toast('Logged');
          }
          V.ui.refreshSheet();
        }, 'btn-primary'),
      );

      if (cutPlan.log.length >= 2) {
        body.appendChild(
          V.charts.line(
            cutPlan.log.map((l) => ({ date: l.date, value: V.kgToDisplay(l.kg, unit) })),
            { color: 'var(--strain)', dp: 1, min: V.kgToDisplay(cutPlan.targetKg, unit) },
          ),
        );
      }

      // ---- Hydration check -------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Hydration check'));
      body.appendChild(V.el('div', { className: 'hint', text: 'Tap the shade closest to your urine colour.' }));

      const scale = V.el('div', { className: 'urine-scale' });
      const urineStatus = V.el('div', { className: 'hint' });
      for (const u of V.cut.URINE_SCALE) {
        scale.appendChild(
          V.el('div', {
            className: 'urine-swatch',
            style: { background: u.hex },
            title: u.label,
            on: {
              click: () => {
                V.$$('.urine-swatch', scale).forEach((n) => n.classList.remove('on'));
                event.currentTarget.classList.add('on');
                urineStatus.textContent = `${u.label} — ${u.status}`;
                urineStatus.style.color = u.ok ? 'var(--text-faint)' : 'var(--bad)';
              },
            },
          }),
        );
      }
      body.appendChild(scale);
      body.appendChild(urineStatus);

      // ---- Protocol --------------------------------------------------------
      if (plan.phases.length) {
        body.appendChild(V.ui.sectionTitle('Protocol'));
        for (const ph of plan.phases) {
          const el = V.el('div', { className: 'phase' + (ph.danger ? ' danger' : '') }, [
            V.el('div', { className: 'phase-day', text: ph.day === 0 ? 'Weigh-in day' : `Day ${ph.day}` }),
            V.el('div', { className: 'phase-title', text: ph.title }),
            V.el('ul', { className: 'phase-actions' }, ph.actions.map((a) => V.el('li', { text: a }))),
            V.el('div', { className: 'phase-why', text: ph.why }),
          ]);
          body.appendChild(el);
        }
      }

      // ---- Rehydration -----------------------------------------------------
      if (plan.rehydration) {
        body.appendChild(V.ui.sectionTitle('After the weigh-in'));
        const r = plan.rehydration;
        body.appendChild(
          V.el('div', { className: r.complete ? 'good-box' : 'warn-box' }, [
            V.el('div', { html: '<strong>Rehydration plan</strong>' }),
            V.el('ul', { className: 'phase-actions', style: { marginTop: '6px' } },
              r.advice.map((a) => V.el('li', { text: a }))),
          ]),
        );
        body.appendChild(
          V.el('div', { className: 'grid-3', style: { marginTop: '12px' } }, [
            V.ui.stat({ label: 'Fluid', value: V.fmt(r.fluidL, 1), unit: ' L' }),
            V.ui.stat({ label: 'Sodium', value: V.fmt(r.sodiumMg / 1000, 1), unit: ' g' }),
            V.ui.stat({ label: 'Carbs', value: V.fmt(r.carbsG), unit: ' g' }),
          ]),
        );
      }

      // ---- End -------------------------------------------------------------
      body.appendChild(V.el('div', { style: { height: '20px' } }));
      body.appendChild(
        V.ui.button('End this cut', async () => {
          if (!V.confirm('End this cut? The weigh-in log is kept.')) return;
          cutPlan.active = false;
          cutPlan.endedAt = Date.now();
          await V.store.cuts.save(cutPlan);
          V.ui.closeSheet();
          V.toast('Cut ended');
          V.app.render();
        }, 'btn-danger'),
      );
    });
  }

  V.cutView = { openNewCutSheet, openCutSheet, renderAssessment };
})(window.V);
