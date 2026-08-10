/* Ygeia — Study: sleep, focus sessions, subjects and spaced repetition. */
(function (V) {
  'use strict';

  V.views = V.views || {};

  const SUBJECT_COLORS = [
    'var(--info)', 'var(--recovery)', 'var(--nutrition)',
    'var(--sleep)', 'var(--strain)', 'var(--stress)',
  ];

  // ============================================================ focus timer

  let focusTimer = null;

  function openFocusTimer(subject, preset) {
    // Wall-clock deadline, not a tick counter: background tabs are throttled hard and a
    // decrementing timer drifts badly over a 50-minute block.
    const endsAt = Date.now() + preset.focusMin * 60000;
    const startedAt = Date.now();

    V.ui.sheet('Focus — ' + subject.name, (body) => {
      const display = V.el('div', { className: 'timer-big' });
      body.appendChild(display);
      body.appendChild(V.el('div', { className: 'hint', style: { textAlign: 'center' }, text: preset.note }));
      body.appendChild(V.el('div', { style: { height: '20px' } }));

      async function finish(completed) {
        if (focusTimer) clearInterval(focusTimer.handle);
        focusTimer = null;
        const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));

        await V.store.study.saveSession({
          id: V.uid(),
          date: V.today(),
          subjectId: subject.id,
          startedAt,
          endedAt: Date.now(),
          minutes,
          technique: 'recall',
          completed,
        });

        V.ui.closeSheet(true);
        V.toast(`${minutes} min logged`);
        V.app.render();
      }

      body.appendChild(V.ui.button('Finish & log', () => finish(true), 'btn-good'));
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('Cancel', () => {
        if (focusTimer) clearInterval(focusTimer.handle);
        focusTimer = null;
        V.ui.closeSheet();
      }, 'btn-ghost'));

      function tick() {
        const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
        display.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
        if (left <= 0) {
          V.haptic(200);
          V.toast(`Block complete — take ${preset.breakMin} minutes`);
          finish(true);
        }
      }

      focusTimer = { endsAt, handle: setInterval(tick, 250) };
      tick();
    });
  }

  // ================================================================ sleep

  function openSleepSheet() {
    V.ui.sheet('Sleep', async (body) => {
      const s = await V.store.settings.get();
      const target = s.sleepTargetHours || 8;
      const logs = await V.store.sleep.series();

      // ---- Log last night --------------------------------------------------
      const existing = await V.store.sleep.byDate(V.app.state.date);
      const bed = V.ui.input({ type: 'time', value: existing ? V.study.formatTime(existing.bedTimeMin) : '23:00' });
      const wake = V.ui.input({ type: 'time', value: existing ? V.study.formatTime(existing.wakeTimeMin) : '07:00' });

      let quality = existing ? existing.quality : 3;
      const qualityWrap = V.el('div');
      function renderQuality() {
        qualityWrap.innerHTML = '';
        qualityWrap.appendChild(
          V.ui.segmented(
            [1, 2, 3, 4, 5].map((n) => ({ value: n, label: '★'.repeat(n) })),
            quality,
            (v) => { quality = v; renderQuality(); },
          ),
        );
      }
      renderQuality();

      const durationOut = V.el('div', { className: 'hint' });
      function renderDuration() {
        const b = V.study.parseTime(bed.value);
        const w = V.study.parseTime(wake.value);
        if (b == null || w == null) return;
        const h = V.study.duration(b, w);
        durationOut.textContent = `${V.fmt(h, 1)} hours — ${V.fmt(h / 1.5, 1)} sleep cycles`;
      }
      bed.addEventListener('input', renderDuration);
      wake.addEventListener('input', renderDuration);
      renderDuration();

      body.appendChild(V.ui.sectionTitle('Log a night'));
      body.appendChild(V.el('div', { className: 'grid-2' }, [
        V.ui.field('Lights out', bed),
        V.ui.field('Woke up', wake),
      ]));
      body.appendChild(V.ui.field('How did it feel?', qualityWrap));
      body.appendChild(durationOut);
      body.appendChild(V.el('div', { style: { height: '10px' } }));
      body.appendChild(
        V.ui.button('Save', async () => {
          const b = V.study.parseTime(bed.value);
          const w = V.study.parseTime(wake.value);
          if (b == null || w == null) return V.toast('Enter both times');

          const hours = V.study.duration(b, w);
          await V.store.sleep.save({
            id: existing ? existing.id : V.uid(),
            date: V.app.state.date,
            bedTimeMin: b,
            wakeTimeMin: w,
            hours,
            quality,
          });
          // Mirror into metrics so sleep shows up in Body trends alongside everything else.
          await V.store.metrics.save({
            id: V.uid(), type: 'sleep_hours', date: V.app.state.date,
            recordedAt: Date.now(), value: hours, source: 'manual',
          });

          V.toast('Sleep logged');
          V.ui.refreshSheet();
          V.app.render();
        }, 'btn-primary'),
      );

      // ---- Bedtime planner -------------------------------------------------
      body.appendChild(V.ui.sectionTitle('When should I go to bed?'));
      const wakeTarget = V.ui.input({ type: 'time', value: s.wakeTarget || '07:00' });
      const plannerOut = V.el('div');

      function renderPlanner() {
        const w = V.study.parseTime(wakeTarget.value);
        plannerOut.innerHTML = '';
        if (w == null) return;
        plannerOut.appendChild(
          V.ui.list(
            V.study.bedtimesFor(w).map((b) =>
              V.ui.row({
                title: 'Bed at ' + b.bedtime,
                sub: `${b.cycles} cycles · ${V.fmt(b.hours, 1)}h` + (b.adequate ? '' : ' — short'),
                value: b.adequate ? '✓' : '⚠',
              }),
            ),
          ),
        );
        plannerOut.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'Sleep runs in ~90 minute cycles. Waking at the end of one feels better ' +
                  'than being pulled out of deep sleep, so these bedtimes assume 15 minutes ' +
                  'to fall asleep.',
          }),
        );
      }
      wakeTarget.addEventListener('input', async () => {
        renderPlanner();
        await V.store.settings.set({ wakeTarget: wakeTarget.value });
      });
      body.appendChild(V.ui.field('I need to wake at', wakeTarget));
      body.appendChild(plannerOut);
      renderPlanner();

      // ---- Study timing advice ---------------------------------------------
      const w = V.study.parseTime(wakeTarget.value);
      if (w != null) {
        body.appendChild(V.ui.sectionTitle('Studying around sleep'));
        for (const a of V.study.studyWindowAdvice(w, target)) {
          body.appendChild(V.el('div', { className: a.warning ? 'warn-box' : 'hint', text: a.text }));
        }
      }

      // ---- History ----------------------------------------------------------
      if (logs.length >= 2) {
        body.appendChild(V.ui.sectionTitle('Recent nights'));
        body.appendChild(
          V.charts.line(logs.slice(-30).map((l) => ({ date: l.date, value: l.hours })), {
            color: 'var(--sleep)', dp: 1, height: 120,
          }),
        );

        const debt = V.study.sleepDebt(logs, target);
        const consistency = V.study.consistency(logs);
        body.appendChild(
          V.el('div', { className: 'grid-3', style: { marginTop: '12px' } }, [
            V.ui.stat({ label: 'Sleep debt (14d)', value: V.fmt(debt, 1), unit: ' h' }),
            V.ui.stat({ label: 'Consistency', value: consistency == null ? '–' : String(consistency), unit: consistency == null ? '' : '/100' }),
            V.ui.stat({ label: 'Average', value: V.fmt(V.sum(logs.slice(-7), (l) => l.hours) / Math.min(7, logs.length), 1), unit: ' h' }),
          ]),
        );
        if (consistency != null && consistency < 60) {
          body.appendChild(
            V.el('div', {
              className: 'warn-box',
              text: 'Your sleep and wake times vary a lot. Regularity predicts health outcomes ' +
                    'at least as strongly as total hours — a fixed wake time is the easiest fix.',
            }),
          );
        }
      }
    });
  }

  // ============================================================== subjects

  function openSubjectSheet(existing) {
    V.ui.sheet(existing ? existing.name : 'New subject', async (body) => {
      const name = V.ui.input({ placeholder: 'Name', value: existing ? existing.name : '' });
      const exam = V.ui.input({ type: 'date', value: existing && existing.examDate ? existing.examDate : '' });
      const hours = V.ui.input({ type: 'number', step: '1', value: existing ? String(existing.targetHours || 20) : '20' });

      let color = existing ? existing.color : SUBJECT_COLORS[0];
      const colorWrap = V.el('div');
      function renderColors() {
        colorWrap.innerHTML = '';
        colorWrap.appendChild(
          V.ui.segmented(
            SUBJECT_COLORS.map((c, i) => ({ value: c, label: '●' + (i + 1) })),
            color,
            (v) => { color = v; renderColors(); },
          ),
        );
      }
      renderColors();

      body.appendChild(V.ui.field('Subject', name));
      body.appendChild(V.ui.field('Exam date', exam, 'Optional — drives the countdown and study allocation.'));
      body.appendChild(V.ui.field('Target study hours', hours));
      body.appendChild(V.ui.field('Colour', colorWrap));

      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(
        V.ui.button('Save', async () => {
          if (!name.value.trim()) return V.toast('Give it a name');
          await V.store.study.saveSubject({
            id: existing ? existing.id : V.uid(),
            name: name.value.trim(),
            examDate: exam.value || null,
            targetHours: V.ui.num(hours, 20),
            color,
          });
          V.ui.closeSheet();
          V.toast('Saved');
          V.app.render();
        }, 'btn-primary'),
      );

      if (existing) {
        body.appendChild(V.el('div', { style: { height: '8px' } }));
        body.appendChild(
          V.ui.button('Delete subject', async () => {
            if (!V.confirm('Delete this subject with all its sessions and review cards?')) return;
            await V.store.study.removeSubject(existing.id);
            V.ui.closeSheet();
            V.toast('Deleted');
            V.app.render();
          }, 'btn-danger'),
        );
      }
    });
  }

  // =================================================================== view

  V.views.study = {
    async render(state) {
      const root = V.el('div');
      const s = await V.store.settings.get();
      const target = s.sleepTargetHours || 8;

      const [subjects, sessions, reviews, sleepLog] = await Promise.all([
        V.store.study.subjects(),
        V.store.study.sessions(),
        V.store.study.reviews(),
        V.store.sleep.byDate(state.date),
      ]);

      // ---- Sleep card -------------------------------------------------------
      const nightScore = V.study.nightScore(sleepLog, target);
      root.appendChild(
        V.ui.card({
          title: 'Sleep',
          sub: sleepLog ? `${V.fmt(sleepLog.hours, 1)}h · ${V.study.formatTime(sleepLog.bedTimeMin)}–${V.study.formatTime(sleepLog.wakeTimeMin)}` : 'Not logged',
          action: nightScore != null
            ? V.el('div', { className: 'stat-value', style: { color: V.domain.scoreBand(nightScore).color }, text: String(nightScore) })
            : null,
          children: [V.ui.button(sleepLog ? 'Edit sleep' : 'Log sleep', openSleepSheet, sleepLog ? 'btn-ghost' : 'btn-primary')],
        }),
      );

      // ---- Today's study ----------------------------------------------------
      const todaySessions = sessions.filter((x) => x.date === state.date);
      const todayMin = V.sum(todaySessions, (x) => x.minutes || 0);
      const effective = V.study.effectiveMinutes(todaySessions);

      root.appendChild(
        V.ui.card({
          title: 'Study today',
          sub: todaySessions.length ? `${todaySessions.length} session(s)` : 'Nothing logged',
          action: V.el('div', { className: 'stat-value', text: V.fmt(todayMin) + 'm' }),
          children: [
            todayMin > 0
              ? V.el('div', { className: 'hint', text: `About ${V.fmt(effective)} minutes of that was high-value practice.` })
              : null,
            V.el('div', { style: { height: '10px' } }),
            V.ui.button('Start a focus block', () => {
              if (!subjects.length) { V.toast('Add a subject first'); return openSubjectSheet(); }
              openPresetPicker(subjects);
            }, 'btn-primary'),
          ],
        }),
      );

      // ---- Flashcards --------------------------------------------------------
      const decks = await V.store.study.decks();

      root.appendChild(
        V.ui.card({
          title: 'Flashcards',
          sub: decks.length
            ? `${decks.length} deck(s) · ${reviews.length} card(s)`
            : 'Make a deck, type your cards in, study it',
          children: [
            V.ui.button(
              decks.length ? 'Open decks' : 'Create your first deck',
              () => V.flashcards.openDecks(),
              'btn-primary',
            ),
          ],
        }),
      );

      // ---- Subjects ---------------------------------------------------------
      root.appendChild(V.ui.sectionTitle('Subjects'));

      if (!subjects.length) {
        root.appendChild(V.ui.empty('No subjects yet.'));
      } else {
        const minutesBySubject = {};
        for (const x of sessions) minutesBySubject[x.subjectId] = (minutesBySubject[x.subjectId] || 0) + (x.minutes || 0);

        root.appendChild(
          V.ui.list(
            subjects.map((sub) => {
              const done = (minutesBySubject[sub.id] || 0) / 60;
              const days = sub.examDate ? V.study.daysUntil(sub.examDate) : null;
              return V.ui.row({
                title: sub.name,
                sub: `${V.fmt(done, 1)}h of ${V.fmt(sub.targetHours || 20)}h` +
                     (days != null ? (days >= 0 ? ` · exam in ${days} day(s)` : ' · exam passed') : ''),
                value: days != null && days >= 0 ? String(days) + 'd' : undefined,
                accessory: V.el('div', { className: 'subject-dot', style: { background: sub.color } }),
                onClick: () => openSubjectSheet(sub),
              });
            }),
          ),
        );

        // ---- Allocation -----------------------------------------------------
        const alloc = V.study.allocate(subjects, (s.dailyStudyMinutes || 180), minutesBySubject);
        if (alloc.length) {
          root.appendChild(V.ui.sectionTitle('Suggested for today'));
          root.appendChild(
            V.ui.list(
              alloc.map((a) =>
                V.ui.row({
                  title: a.subject.name,
                  sub: `${V.fmt(a.remainingHours, 1)}h left · ${a.daysLeft} day(s) to go`,
                  value: V.fmt(a.minutesToday) + 'm',
                }),
              ),
            ),
          );
          if (alloc.some((a) => a.behind)) {
            root.appendChild(
              V.el('div', {
                className: 'warn-box',
                text: 'At your current daily study time you will not reach your target hours ' +
                      'for at least one subject. Either raise the daily budget or lower the target — ' +
                      'cutting sleep to catch up costs more recall than it buys.',
              }),
            );
          }
        }
      }

      root.appendChild(V.el('div', { style: { height: '12px' } }));
      root.appendChild(V.ui.button('Add subject', () => openSubjectSheet(), 'btn-ghost'));

      return root;
    },
  };

  function openPresetPicker(subjects) {
    V.ui.sheet('Focus block', (body) => {
      let subjectId = subjects[0].id;
      const subWrap = V.el('div');
      function renderSubs() {
        subWrap.innerHTML = '';
        subWrap.appendChild(
          V.ui.segmented(subjects.map((s) => ({ value: s.id, label: s.name })), subjectId,
            (v) => { subjectId = v; renderSubs(); }),
        );
      }
      renderSubs();

      body.appendChild(V.ui.field('Subject', subWrap));
      body.appendChild(V.ui.sectionTitle('Block length'));
      body.appendChild(
        V.ui.list(
          V.study.FOCUS_PRESETS.map((p) =>
            V.ui.row({
              title: p.label,
              sub: p.note,
              onClick: () => {
                V.ui.closeSheet();
                openFocusTimer(subjects.find((s) => s.id === subjectId), p);
              },
            }),
          ),
        ),
      );
    });
  }
})(window.V);
