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
    V.ui.sheet('On-device coach', async (body) => {
      const caps = await V.aiLocal.capabilities();

      body.appendChild(
        V.el('div', { className: 'warn-box' }, [
          V.el('div', { html: '<strong>This is the only large download in Ygeia.</strong>' }),
          V.el('div', {
            style: { marginTop: '6px' },
            text: 'Everything else is hand-written with no dependencies. Running a language ' +
                  'model in a browser is not something you write yourself, so turning this on ' +
                  'fetches a runtime and a model — a few hundred megabytes. Once installed it ' +
                  'runs entirely on this device and nothing you say leaves it.',
          }),
        ]),
      );

      if (!caps.ok) {
        body.appendChild(V.el('div', { className: 'danger-box', style: { marginTop: '12px' }, text: caps.reason }));
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
      body.appendChild(V.ui.sectionTitle('Choose a model'));
      const listWrap = V.el('div');
      body.appendChild(listWrap);
      listWrap.appendChild(V.el('div', { className: 'hint', text: 'Reading the available models…' }));

      let models = [];
      try {
        models = await V.aiLocal.listModels();
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

      listWrap.appendChild(
        V.ui.list(
          models.slice(0, 12).map((m) =>
            V.ui.row({
              title: m.id.replace(/-MLC$/, ''),
              sub: `about ${m.vramMB} MB` + (m.lowResource ? ' · runs on modest hardware' : ''),
              value: '↓',
              onClick: () => install(m),
            }),
          ),
        ),
      );

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

    const [entries, workouts, sleepLog, notes, weightDaily] = await Promise.all([
      V.store.foodLog.resolved(date),
      V.store.workouts.byDate(date),
      V.store.sleep.byDate(date),
      V.store.notes.upcoming(7),
      V.store.metrics.daily('weight'),
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
    if (sleepLog) lines.push(`Slept: ${V.fmt(sleepLog.hours, 1)} hours`);
    if (workouts.length) lines.push(`Workouts today: ${workouts.length}`);
    // Upcoming notes give the model context it cannot infer — an exam changes what good
    // advice looks like.
    for (const n of notes.slice(0, 3)) {
      lines.push(`Note for ${n.date}: ${n.text}`);
    }
    if (trend && trend.reliable) {
      lines.push(`Weight trend: ${V.fmt(trend.perWeek, 2)} kg per week over ${trend.n} days`);
    }

    return lines.join('\n');
  }

  // ==================================================================== chat

  C.openChat = function () {
    V.ui.sheet('Coach', async (body) => {
      const installed = await V.aiLocal.installedModel();
      if (!installed) {
        body.appendChild(V.ui.empty('No model installed.'));
        body.appendChild(V.ui.button('Set one up', () => { V.ui.closeSheet(); C.openManager(); }, 'btn-primary'));
        return;
      }

      const log = V.el('div', { className: 'chat-log' });
      const input = V.ui.input({ placeholder: 'Ask about your training, food or sleep' });
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
          text: 'Runs on this device — nothing you type is sent anywhere. It can only use the ' +
                'figures Ygeia already calculated, and is told not to invent numbers. It is ' +
                'not a doctor.',
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
          if (!V.aiLocal.isLoaded()) {
            reply.textContent = 'Loading the model…';
            await V.aiLocal.load(installed, (p) => { reply.textContent = p.text; });
          }

          const context = await buildContext();
          const messages = history.concat([
            { role: 'user', content: 'Here is my data:\n' + context + '\n\nQuestion: ' + question },
          ]);

          reply.textContent = '';
          const full = await V.aiLocal.chat(messages, (piece, sofar) => {
            reply.textContent = sofar;
            log.scrollTop = log.scrollHeight;
          });

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
