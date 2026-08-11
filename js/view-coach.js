/*
 * Ygeia — on-device coach.
 *
 * Chat over your own data, with the model running on this device. Optional, opt-in, and
 * the only part of the app that downloads anything substantial.
 *
 * The context handed to the model is built HERE, from figures the deterministic engines
 * already computed. The model is told it may not invent numbers, and it never calculates
 * anything the user sees — it puts sentences around values that came from domain*.js.
 */
(function (V) {
  'use strict';

  const C = {};

  // =========================================================== model manager

  C.openManager = function () {
    V.ui.sheet('Coach', async (body) => {
      const caps = await V.aiLocal.capabilities();
      const hasKey = await V.aiCloud.hasKey();
      const cloudOn = await V.aiCloud.isEnabled();

      // ---- Cloud option ------------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Use Google instead'));
      body.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Cloud coach',
            sub: !hasKey
              ? 'Needs an API key — add one under AI features in Settings'
              : (cloudOn ? 'On — much better answers, but your data goes to Google' : 'Off'),
            accessory: hasKey
              ? V.ui.segmented(
                  [{ value: false, label: 'Off' }, { value: true, label: 'On' }],
                  cloudOn,
                  async (v) => {
                    if (v && !V.confirm(
                      'Turn on the cloud coach?\n\n' +
                      'Sent to Google with every question: your calorie and protein totals, ' +
                      'food quality score, weight trend, workout count, the gaps Ygeia has ' +
                      'calculated (including sleep), and your next few calendar notes — so ' +
                      'do not write anything private in those.\n\n' +
                      'On the free tier that content may be used for training and seen by ' +
                      'human reviewers.',
                    )) { V.ui.refreshSheet(); return; }
                    await V.aiCloud.setEnabled(v);
                    V.ui.refreshSheet();
                    V.app.render();
                  },
                )
              : null,
            onClick: hasKey ? null : () => { V.ui.closeSheet(); V.aiKeyView.openSheet(); },
          }),
        ]),
      );
      body.appendChild(
        V.el('div', {
          className: cloudOn ? 'danger-box' : 'hint',
          text: cloudOn
            ? 'Your daily summary and upcoming calendar notes are sent to Google on every ' +
              'question. Turn this off to keep everything on your phone.'
            : 'Far better answers than anything that fits on a phone, but unlike the rest of ' +
              'Ygeia it sends your health summary off the device.',
        }),
      );

      if (cloudOn) {
        body.appendChild(V.el('div', { style: { height: '12px' } }));
        body.appendChild(V.ui.button('Open the coach', () => { V.ui.closeSheet(); C.openChat(); }, 'btn-primary'));
        return;
      }

      // ---- Local option ------------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Or run one on your phone'));
      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Downloads a runtime and a model once — a few hundred megabytes — then runs ' +
                'entirely on this device with nothing leaving it. Weaker than the cloud, but ' +
                'private and free.',
        }),
      );

      if (!caps.ok) {
        body.appendChild(V.el('div', { className: 'warn-box', style: { marginTop: '12px' }, text: caps.reason }));
        return;
      }

      const installed = await V.aiLocal.installedModel();

      if (installed) {
        const usedMB = await V.aiLocal.cacheSizeMB();
        body.appendChild(
          V.ui.card({
            title: 'Installed',
            sub: installed,
            children: [
              V.ui.button('Open the coach', () => { V.ui.closeSheet(); C.openChat(); }, 'btn-primary'),
              V.el('div', { style: { height: '8px' } }),
              V.ui.button(
                usedMB ? `Delete model (about ${usedMB} MB)` : 'Delete model',
                async () => {
                  if (!V.confirm('Delete the downloaded model? You can reinstall it later.')) return;
                  await V.aiLocal.deleteModel();
                  V.toast('Model deleted');
                  V.ui.refreshSheet();
                  V.app.render();
                },
                'btn-danger',
              ),
            ],
          }),
        );
        return;
      }

      // ---- Model picker ------------------------------------------------------
      const listWrap = V.el('div');
      body.appendChild(listWrap);
      listWrap.appendChild(V.el('div', { className: 'hint', text: 'Reading the available models…' }));

      let models = [];
      let recommended = [];
      try {
        models = await V.aiLocal.listModels();
        recommended = await V.aiLocal.recommended();
      } catch (err) {
        listWrap.innerHTML = '';
        listWrap.appendChild(V.el('div', { className: 'warn-box', text: 'Could not reach the model catalogue: ' + err.message }));
        return;
      }

      listWrap.innerHTML = '';
      if (!models.length) {
        listWrap.appendChild(V.ui.empty('No small enough models are available.'));
        return;
      }

      // A shortlist first — 77 ids sorted by megabytes is not a choice anyone can make.
      if (recommended.length) {
        listWrap.appendChild(V.ui.sectionTitle('Recommended'));
        listWrap.appendChild(
          V.ui.list(
            recommended.map((r) =>
              V.ui.row({
                title: r.label,
                sub: `${r.vramMB} MB · ${r.note}`,
                value: '↓',
                onClick: () => install({ id: r.id, vramMB: r.vramMB }),
              }),
            ),
          ),
        );
      }

      const allWrap = V.el('div');
      listWrap.appendChild(V.el('div', { style: { height: '10px' } }));
      listWrap.appendChild(
        V.ui.button(`Show all ${models.length} models`, () => {
          allWrap.innerHTML = '';
          allWrap.appendChild(V.ui.sectionTitle('Everything that fits'));
          allWrap.appendChild(
            V.ui.list(
              models.map((m) =>
                V.ui.row({
                  title: m.id.replace(/-MLC$/, ''),
                  sub: `about ${m.vramMB} MB` + (m.lowResource ? ' · runs on modest hardware' : ''),
                  value: '↓',
                  onClick: () => install(m),
                }),
              ),
            ),
          );
        }, 'btn-ghost'),
      );
      listWrap.appendChild(allWrap);

      listWrap.appendChild(
        V.el('div', {
          className: 'hint',
          text: caps.quotaMB
            ? `This browser will let Ygeia store about ${caps.quotaMB} MB in total. Pick a model ` +
              'comfortably under that.'
            : 'Smaller models answer faster but less well.',
        }),
      );

      function install(model) {
        V.ui.sheet('Installing', (sheet) => {
          const label = V.el('div', { className: 'hint', text: 'Starting…' });
          const barWrap = V.el('div', { className: 'bar' }, [
            V.el('div', { className: 'bar-fill', style: { width: '0%', background: 'var(--recovery)' } }),
          ]);

          sheet.appendChild(V.el('div', { className: 'card-sub', text: model.id }));
          sheet.appendChild(V.el('div', { style: { height: '12px' } }));
          sheet.appendChild(barWrap);
          sheet.appendChild(label);
          sheet.appendChild(
            V.el('div', {
              className: 'hint',
              text: 'Keep this screen open. The download is cached, so it only happens once.',
            }),
          );

          V.aiLocal
            .load(model.id, (p) => {
              barWrap.firstChild.style.width = Math.round((p.progress || 0) * 100) + '%';
              label.textContent = p.text;
            })
            .then(() => {
              V.ui.closeSheet(true);
              V.toast('Model ready');
              C.openChat();
            })
            .catch((err) => {
              label.textContent = '';
              sheet.appendChild(V.el('div', { className: 'danger-box', text: err.message }));
            });
        });
      }
    });
  };

  // ===================================================== context for the model

  /**
   * A compact snapshot of figures the deterministic engines already produced.
   *
   * Deliberately small: a local model has a limited context window, and a long dump makes
   * replies slower and vaguer. Only numbers that already exist go in — nothing is
   * computed here for the model's benefit.
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
      const useCloud = await V.aiCloud.isEnabled();
      const installed = await V.aiLocal.installedModel();

      if (!useCloud && !installed) {
        body.appendChild(V.ui.empty('No coach set up yet.'));
        body.appendChild(V.ui.button('Set one up', () => { V.ui.closeSheet(); C.openManager(); }, 'btn-primary'));
        return;
      }

      body.appendChild(
        V.el('div', {
          className: useCloud ? 'warn-box' : 'hint',
          text: useCloud
            ? 'Using Google. Your daily summary and upcoming notes are sent with each question.'
            : 'Running on this device. Nothing you type leaves it.',
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

        const reply = bubble('bot', '…');

        try {
          const context = await buildContext();
          let full;

          if (useCloud) {
            reply.textContent = 'Thinking…';
            full = await V.aiCloud.chat(
              history.concat([{ role: 'user', content: question }]),
              context,
            );
            reply.textContent = full;
          } else {
            if (!V.aiLocal.isLoaded()) {
              reply.textContent = 'Loading the model…';
              await V.aiLocal.load(installed, (p) => { reply.textContent = p.text; });
            }

            const messages = history.concat([
              { role: 'user', content: 'Here is my data:\n' + context + '\n\nQuestion: ' + question },
            ]);

            reply.textContent = '';
            full = await V.aiLocal.chat(messages, (piece, sofar) => {
              reply.textContent = sofar;
              log.scrollTop = log.scrollHeight;
            });
          }

          history.push({ role: 'user', content: question });
          history.push({ role: 'assistant', content: full });
          // Keep the window short — a small model degrades quickly with a long history.
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
