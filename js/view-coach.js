/*
 * Ygeia — the coach.
 *
 * Chat over your own data. This needs a Google API key, which the user supplies; there is
 * no bundled model and nothing to download.
 *
 * Ygeia previously offered an on-device model as a private alternative. It was removed
 * deliberately: it meant importing a runtime from a CDN that then ran in this origin with
 * full IndexedDB access and could not be pinned with an integrity hash, and it asked people
 * to give up ~1 GB of phone storage for replies a hosted model does far better. The result
 * is that the coach is now the one feature that sends health data, which the UI states
 * plainly rather than burying.
 *
 * The context handed to the model is built HERE, from figures the deterministic engines
 * already computed. The model is told it may not invent numbers, and it never calculates
 * anything the user sees — it puts sentences around values that came from domain*.js.
 */
(function (V) {
  'use strict';

  const C = {};

  // =============================================================== setup sheet

  C.openManager = function () {
    V.ui.sheet('Coach', async (body) => {
      const hasKey = await V.aiCloud.hasKey();
      const cloudOn = await V.aiCloud.isEnabled();

      if (!hasKey) {
        body.appendChild(
          V.el('div', { className: 'warn-box' }, [
            V.el('div', { html: '<strong>The coach needs an API key.</strong>' }),
            V.el('div', {
              style: { marginTop: '6px' },
              text: 'Ygeia has no built-in model and downloads nothing. The coach runs on ' +
                    'Google, using a free key you provide.',
            }),
          ]),
        );
        body.appendChild(V.el('div', { style: { height: '12px' } }));
        body.appendChild(
          V.ui.button('Add a key', () => { V.ui.closeSheet(); V.aiKeyView.openSheet(); }, 'btn-primary'),
        );
        body.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'Free and takes about a minute. Everything else in Ygeia — your logs, the ' +
                  'calculations, and the “what you’re missing” analysis — works without one ' +
                  'and never leaves this device.',
          }),
        );
        return;
      }

      body.appendChild(V.ui.sectionTitle('Coach'));
      body.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Enable the coach',
            sub: cloudOn ? 'On — your summary goes to Google with each question' : 'Off',
            accessory: V.ui.segmented(
              [{ value: false, label: 'Off' }, { value: true, label: 'On' }],
              cloudOn,
              async (v) => {
                if (v && !V.confirm(
                  'Turn on the coach?\n\n' +
                  'Sent to Google with every question: your calorie and protein totals, food ' +
                  'quality score, weight trend, workout count, the gaps Ygeia has calculated ' +
                  '(including sleep), and your next few calendar notes — so do not write ' +
                  'anything private in those.\n\n' +
                  'On the free tier that content may be used for training and seen by human ' +
                  'reviewers.',
                )) { V.ui.refreshSheet(); return; }
                await V.aiCloud.setEnabled(v);
                V.ui.refreshSheet();
                V.app.render();
              },
            ),
          }),
        ]),
      );

      body.appendChild(
        V.el('div', {
          className: cloudOn ? 'danger-box' : 'hint',
          text: cloudOn
            ? 'Your daily summary and upcoming calendar notes are sent to Google on every ' +
              'question. Turn this off to keep everything on your phone.'
            : 'This is the only feature that sends anything you have logged. It stays off ' +
              'until you turn it on here.',
        }),
      );

      if (cloudOn) {
        body.appendChild(V.el('div', { style: { height: '12px' } }));
        body.appendChild(V.ui.button('Open the coach', () => { V.ui.closeSheet(); C.openChat(); }, 'btn-primary'));
      }

      body.appendChild(
        V.el('div', {
          className: 'hint',
          style: { marginTop: '12px' },
          text: V.COACH_SCOPE_NOTE,
        }),
      );
    });
  };

  // ===================================================== context for the model

  /**
   * A compact snapshot of figures the deterministic engines already produced.
   *
   * Deliberately small: a long dump makes replies slower and vaguer, and every line here is
   * a line of health data leaving the device. Only numbers that already exist go in —
   * nothing is computed here for the model's benefit.
   */
  async function buildContext() {
    const date = V.app.state.date;
    const settings = await V.store.settings.get();
    const targets = V.domain.macroTargets(settings);

    const [entries, workouts, notes, weightDaily, gaps] = await Promise.all([
      V.store.foodLog.resolved(date),
      V.store.workouts.byDate(date),
      V.store.notes.upcoming(7),
      V.store.metrics.daily('weight'),
      C.findGaps(),
    ]);

    const totals = V.domain.sumNutrients(entries.map((e) => e.nutrients));
    const scored = V.domain.nutritionScore(entries, targets, settings);
    const trend = weightDaily.length >= 2 ? V.domain.trend(weightDaily.slice(-30), 30) : null;

    const lines = [
      `Date: ${date}`,
      `Goal: ${V.domain.GOAL_LABEL[settings.goal]}`,
      `Calorie target: ${targets.kcal} kcal, protein ${targets.protein} g`,
      `Eaten today: ${V.fmt(totals.kcal || 0)} kcal, ${V.fmt(totals.protein || 0)} g protein`,
    ];

    if (scored.score != null) lines.push(`Food quality score today: ${scored.score}/100`);
    if (workouts.length) lines.push(`Workouts today: ${workouts.length}`);
    if (trend && trend.reliable) {
      lines.push(`Weight trend: ${V.fmt(trend.perWeek, 2)} kg per week over ${trend.n} days`);
    }
    for (const n of notes.slice(0, 3)) lines.push(`Note for ${n.date}: ${n.text}`);

    // The gaps arrive already computed against published guidelines. Handing them over as
    // finished figures is what stops the model inventing a protein target of its own.
    if (gaps.length) {
      lines.push('', 'Gaps the app calculated against published guidelines:');
      for (const g of gaps) {
        lines.push(`- ${g.label}: ${g.message}` + (g.source ? ` [source: ${g.source}]` : ''));
      }
    }

    return lines.join('\n');
  }

  /**
   * Gather what V.gaps needs. This lives here rather than in the domain layer because it
   * reads storage; the analysis itself stays pure and testable.
   *
   * Note this runs for the Today card too, with no key and no network — the gap analysis
   * is not an AI feature and must never depend on one.
   */
  C.findGaps = async function () {
    const date = V.app.state.date;
    const settings = await V.store.settings.get();
    const week = V.lastNDays(7, date);

    const [entries, allLogs, workouts, sports, sleepAll, subjects, studySessions] = await Promise.all([
      V.store.foodLog.resolved(date),
      V.store.db.all('foodLogs'),
      V.store.workouts.all(),
      V.store.sports.all(),
      V.store.sleep.series(),
      V.store.study.subjects(),
      V.store.study.sessions(),
    ]);

    const minutesBySubject = {};
    for (const s of studySessions) {
      minutesBySubject[s.subjectId] = (minutesBySubject[s.subjectId] || 0) + (s.minutes || 0);
    }
    const dailyBudgetHours = (settings.dailyStudyMinutes || 180) / 60;
    const subjectsBehind = subjects
      .filter((s) => s.examDate && V.study.daysUntil(s.examDate) >= 0)
      .map((s) => ({
        name: s.name,
        daysLeft: Math.max(1, V.study.daysUntil(s.examDate)),
        remainingHours: Math.max(0, (s.targetHours || 20) - (minutesBySubject[s.id] || 0) / 60),
      }))
      .filter((s) => s.remainingHours > 0 && s.remainingHours / s.daysLeft > dailyBudgetHours);

    return V.gaps.find({
      settings,
      todayTotals: V.domain.sumNutrients(entries.map((e) => e.nutrients)),
      recentSleep: sleepAll.filter((s) => week.includes(s.date)),
      strengthSessions7: workouts.filter((w) => w.finishedAt && week.includes(w.date)).length,
      metMinutes7: V.life.metMinutes(sports.filter((s) => week.includes(s.date))),
      daysLogged7: new Set(allLogs.filter((l) => week.includes(l.date)).map((l) => l.date)).size,
      subjectsBehind,
    });
  };

  // ==================================================================== chat

  C.openChat = function () {
    V.ui.sheet('Coach', async (body) => {
      if (!(await V.aiCloud.isEnabled())) {
        body.appendChild(V.ui.empty('The coach is off.'));
        body.appendChild(V.ui.button('Set it up', () => { V.ui.closeSheet(); C.openManager(); }, 'btn-primary'));
        return;
      }

      body.appendChild(
        V.el('div', {
          className: 'warn-box',
          text: 'Your daily summary and upcoming notes are sent to Google with each question.',
        }),
      );

      const log = V.el('div', { className: 'chat-log' });
      const input = V.ui.input({ placeholder: 'Ask about meals, training or studying' });
      const history = [];

      body.appendChild(log);
      body.appendChild(V.el('div', { style: { height: '10px' } }));
      body.appendChild(input);
      body.appendChild(V.el('div', { style: { height: '8px' } }));

      const sendBtn = V.ui.button('Ask', send, 'btn-primary');
      body.appendChild(sendBtn);

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: V.COACH_SCOPE_NOTE + ' It can only use figures Ygeia has already calculated, ' +
                'and is told never to work one out itself.',
        }),
      );

      function bubble(role, text) {
        const node = V.el('div', { className: 'chat-msg chat-' + role, text });
        log.appendChild(node);
        log.scrollTop = log.scrollHeight;
        return node;
      }

      async function send() {
        const question = input.value.trim();
        if (!question) return;

        input.value = '';
        bubble('user', question);
        sendBtn.disabled = true;

        const reply = bubble('bot', 'Thinking…');

        try {
          const context = await buildContext();
          const full = await V.aiCloud.chat(
            history.concat([{ role: 'user', content: question }]),
            context,
          );
          reply.textContent = full;

          history.push({ role: 'user', content: question });
          history.push({ role: 'assistant', content: full });
          // Keep the window short — every turn resent is more data over the wire.
          while (history.length > 6) history.shift();
        } catch (err) {
          reply.textContent = 'Failed: ' + err.message;
        } finally {
          sendBtn.disabled = false;
        }
      }

      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    });
  };

  V.coachView = C;
})(window.V);
