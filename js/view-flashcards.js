/*
 * Ygeia — flashcards.
 *
 * Decks of two-sided cards with four study modes. Every mode feeds the existing Leitner
 * scheduling in domain-study.js rather than replacing it, so however you choose to drill a
 * deck, the spacing schedule stays consistent.
 */
(function (V) {
  'use strict';

  const F = {};

  const MODES = [
    { value: 'flip', label: 'Flip', note: 'See the front, recall it, reveal the back.' },
    { value: 'choice', label: 'Multiple choice', note: 'Pick the right answer from four. Needs at least 3 cards.' },
    { value: 'type', label: 'Type the answer', note: 'Strongest recall. Typos are forgiven.' },
    { value: 'match', label: 'Match', note: 'Pair terms to definitions against the clock.' },
  ];

  // =============================================================== deck list

  F.openDecks = function () {
    V.ui.sheet('Flashcards', async (body) => {
      const [decks, allCards, subjects] = await Promise.all([
        V.store.study.decks(),
        V.store.study.reviews(),
        V.store.study.subjects(),
      ]);
      const subById = {};
      for (const s of subjects) subById[s.id] = s;

      // Cards migrated from the old one-sided format need an answer before they can be
      // used in any mode except flip. Surface that rather than letting them fail silently.
      const unfinished = allCards.filter((c) => !c.back);
      if (unfinished.length) {
        body.appendChild(
          V.el('div', { className: 'warn-box' }, [
            V.el('div', {
              text: `${unfinished.length} card(s) have no answer yet — they were created before ` +
                    'cards had two sides. Add the answers to use them in quizzes.',
            }),
            V.el('div', { style: { height: '10px' } }),
            V.ui.button('Finish them now', () => openFinishUnfinished(unfinished), 'btn-ghost'),
          ]),
        );
      }

      if (!decks.length) {
        body.appendChild(V.ui.empty('No decks yet.'));
      } else {
        body.appendChild(
          V.ui.list(
            decks.map((d) => {
              const cards = allCards.filter((c) => c.deckId === d.id);
              const due = V.study.dueItems(cards).length;
              const sub = subById[d.subjectId];
              return V.ui.row({
                title: d.name,
                sub: [sub && sub.name, `${cards.length} card(s)`, due ? `${due} due` : null]
                  .filter(Boolean).join(' · '),
                value: due ? String(due) : '',
                accessory: sub ? V.el('div', { className: 'subject-dot', style: { background: sub.color } }) : null,
                onClick: () => F.openDeck(d),
              });
            }),
          ),
        );
      }

      body.appendChild(V.el('div', { style: { height: '14px' } }));
      body.appendChild(V.ui.button('New deck', () => openDeckEditor(null), 'btn-primary'));
    });
  };

  function openDeckEditor(deck) {
    V.ui.sheet(deck ? 'Edit deck' : 'New deck', async (body) => {
      const subjects = await V.store.study.subjects();
      const name = V.ui.input({ placeholder: 'Name', value: deck ? deck.name : '' });
      let subjectId = deck ? deck.subjectId : (subjects[0] ? subjects[0].id : null);

      body.appendChild(V.ui.field('Deck name', name));

      if (subjects.length) {
        const wrap = V.el('div');
        const render = () => {
          wrap.innerHTML = '';
          wrap.appendChild(
            V.ui.segmented(
              [{ value: null, label: 'None' }].concat(subjects.map((s) => ({ value: s.id, label: s.name }))),
              subjectId,
              (v) => { subjectId = v; render(); },
            ),
          );
        };
        render();
        body.appendChild(V.ui.field('Subject', wrap));
      }

      body.appendChild(V.el('div', { style: { height: '10px' } }));
      body.appendChild(
        V.ui.button('Save', async () => {
          if (!name.value.trim()) return V.toast('Give the deck a name');
          const saved = {
            id: deck ? deck.id : V.uid(),
            name: name.value.trim(),
            subjectId,
            createdAt: deck ? deck.createdAt : Date.now(),
          };
          await V.store.study.saveDeck(saved);
          V.ui.closeSheet();
          F.openDeck(saved);
        }, 'btn-primary'),
      );

      if (deck) {
        body.appendChild(V.el('div', { style: { height: '8px' } }));
        body.appendChild(
          V.ui.button('Delete deck', async () => {
            if (!V.confirm(`Delete "${deck.name}" and all its cards?`)) return;
            await V.store.study.removeDeck(deck.id);
            V.ui.closeSheet(true);
            V.toast('Deck deleted');
            F.openDecks();
          }, 'btn-danger'),
        );
      }
    });
  }

  // ============================================================== deck detail

  F.openDeck = function (deck) {
    V.ui.sheet(deck.name, async (body) => {
      const cards = await V.store.study.cardsInDeck(deck.id);
      const due = V.study.dueItems(cards);
      const ready = cards.filter((c) => c.back);

      body.appendChild(
        V.el('div', { className: 'grid-3' }, [
          V.ui.stat({ label: 'Cards', value: String(cards.length) }),
          V.ui.stat({ label: 'Due now', value: String(due.length) }),
          V.ui.stat({ label: 'Mastered', value: String(cards.filter((c) => c.box >= 3).length) }),
        ]),
      );

      // ---- Study modes -----------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Study'));
      if (!cards.length) {
        body.appendChild(V.ui.empty('Add some cards first.'));
      } else {
        body.appendChild(
          V.ui.list(
            MODES.map((m) => {
              const blocked =
                (m.value === 'choice' && !V.study.canMultipleChoice(cards)) ||
                (m.value !== 'flip' && !ready.length) ||
                (m.value === 'match' && ready.length < 2);
              return V.ui.row({
                title: m.label,
                sub: blocked ? 'Needs more cards with answers' : m.note,
                value: blocked ? '' : '›',
                onClick: blocked ? null : () => startSession(deck, cards, m.value),
              });
            }),
          ),
        );

        if (due.length) {
          body.appendChild(V.el('div', { style: { height: '10px' } }));
          body.appendChild(
            V.ui.button(`Review ${due.length} due card(s)`, () => startSession(deck, due, 'flip'), 'btn-good'),
          );
        }
      }

      // ---- Cards ------------------------------------------------------------
      body.appendChild(V.ui.sectionTitle(`Cards (${cards.length})`));
      if (cards.length) {
        body.appendChild(
          V.ui.list(
            cards.slice(0, 100).map((c) =>
              V.ui.row({
                title: c.front,
                sub: c.back || 'No answer yet',
                value: 'Box ' + (c.box + 1),
                onClick: () => openCardEditor(c, deck.id),
              }),
            ),
          ),
        );
      }

      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(V.ui.button('Add card', () => openCardEditor(null, deck.id), 'btn-primary'));
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('Import / export', () => openImport(deck), 'btn-ghost'));
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('Deck settings', () => openDeckEditor(deck), 'btn-ghost'));
    });
  };

  function openCardEditor(card, deckId) {
    V.ui.sheet(card ? 'Edit card' : 'New card', async (body) => {
      const front = V.el('textarea', { rows: 2, placeholder: 'Term or question', value: card ? card.front : '' });
      const back = V.el('textarea', { rows: 3, placeholder: 'Answer', value: card ? card.back : '' });

      body.appendChild(V.ui.field('Front', front));
      body.appendChild(V.ui.field('Back', back,
        'Separate several acceptable answers with a slash — "kidney / renal organ".'));

      body.appendChild(
        V.ui.button('Save', async () => {
          if (!front.value.trim()) return V.toast('The front cannot be empty');

          if (card) {
            card.front = front.value.trim();
            card.back = back.value.trim();
            card.title = card.front;
            card.needsAnswer = !card.back;
            await V.store.study.saveReview(card);
          } else {
            const deck = await V.store.study.getDeck(deckId);
            await V.store.study.saveReview(
              V.study.newCard({
                deckId,
                subjectId: deck ? deck.subjectId : null,
                front: front.value.trim(),
                back: back.value.trim(),
              }),
            );
          }
          V.ui.closeSheet();
          V.toast('Saved');
        }, 'btn-primary'),
      );

      if (card) {
        body.appendChild(V.el('div', { style: { height: '8px' } }));
        body.appendChild(
          V.ui.button('Delete card', async () => {
            if (!V.confirm('Delete this card?')) return;
            await V.store.study.removeReview(card.id);
            V.ui.closeSheet();
            V.toast('Deleted');
          }, 'btn-danger'),
        );
      }
    });
  }

  /** Quick pass to add answers to cards migrated from the one-sided format. */
  function openFinishUnfinished(cards) {
    let index = 0;
    V.ui.sheet('Add answers', (body) => {
      const render = () => {
        body.innerHTML = '';
        if (index >= cards.length) {
          body.appendChild(V.ui.empty('All done.'));
          return;
        }
        const card = cards[index];
        body.appendChild(V.el('div', { className: 'hint', text: `${index + 1} of ${cards.length}` }));
        body.appendChild(V.ui.card({ title: card.front, children: [] }));

        const back = V.el('textarea', { rows: 3, placeholder: 'Answer' });
        body.appendChild(V.ui.field('Back', back));
        body.appendChild(
          V.el('div', { className: 'btn-row' }, [
            V.ui.button('Skip', () => { index++; render(); }, 'btn-ghost'),
            V.ui.button('Save & next', async () => {
              if (back.value.trim()) {
                card.back = back.value.trim();
                card.needsAnswer = false;
                await V.store.study.saveReview(card);
              }
              index++;
              render();
            }, 'btn-primary'),
          ]),
        );
      };
      render();
    });
  }

  // ================================================================== import

  function openImport(deck) {
    V.ui.sheet('Import / export', async (body) => {
      const existing = await V.store.study.cardsInDeck(deck.id);

      body.appendChild(V.ui.sectionTitle('Paste cards'));
      const area = V.el('textarea', { rows: 8, placeholder: 'photosynthesis - converting light into chemical energy\nmitochondrion - the site of respiration' });
      const preview = V.el('div', { className: 'hint' });

      area.addEventListener('input', () => {
        const { rows, skipped } = V.study.parseBulk(area.value);
        preview.textContent = rows.length
          ? `${rows.length} card(s) ready` + (skipped.length ? `, ${skipped.length} line(s) could not be split` : '')
          : 'Nothing parsed yet.';
      });

      body.appendChild(area);
      body.appendChild(preview);
      body.appendChild(
        V.el('div', { className: 'hint', text: 'One card per line. Separate the two sides with a dash, tab, colon or comma.' }),
      );
      body.appendChild(V.el('div', { style: { height: '10px' } }));
      body.appendChild(
        V.ui.button('Import', async () => {
          const { rows, skipped } = V.study.parseBulk(area.value);
          if (!rows.length) return V.toast('Nothing to import');
          for (const r of rows) {
            await V.store.study.saveReview(
              V.study.newCard({ deckId: deck.id, subjectId: deck.subjectId, front: r.front, back: r.back }),
            );
          }
          V.ui.closeSheet();
          V.toast(`Imported ${rows.length}` + (skipped.length ? `, skipped ${skipped.length}` : ''));
        }, 'btn-primary'),
      );

      if (existing.length) {
        body.appendChild(V.ui.sectionTitle('Export'));
        body.appendChild(V.el('pre', { className: 'formula', text: V.study.toBulkText(existing) }));
        body.appendChild(V.el('div', { style: { height: '8px' } }));
        body.appendChild(
          V.ui.button('Copy all cards', async () => {
            try {
              await navigator.clipboard.writeText(V.study.toBulkText(existing));
              V.toast('Copied');
            } catch (err) { V.toast('Clipboard blocked — select the text above'); }
          }, 'btn-ghost'),
        );
      }
    });
  }

  // ================================================================ sessions

  function startSession(deck, cards, mode) {
    const pool = cards.filter((c) => (mode === 'flip' ? true : c.back));
    const queue = V.study.shuffle(pool);
    const results = { right: 0, wrong: 0, total: queue.length };
    let index = 0;

    if (mode === 'match') return runMatch(deck, pool);

    V.ui.sheet(deck.name, (body) => {
      const render = async () => {
        body.innerHTML = '';

        if (index >= queue.length) return renderSummary(body, deck, cards, results, mode);

        const card = queue[index];
        body.appendChild(
          V.el('div', { className: 'macro-row' }, [
            V.el('span', { className: 'row-sub', text: `${index + 1} of ${queue.length}` }),
            V.el('span', { className: 'row-sub', text: `${results.right} right · ${results.wrong} wrong` }),
          ]),
        );
        body.appendChild(V.ui.bar(index, queue.length, 'var(--recovery)'));
        body.appendChild(V.el('div', { style: { height: '16px' } }));

        const advance = async (remembered) => {
          await V.store.study.saveReview(V.study.gradeReview(card, remembered));
          if (remembered) results.right++; else results.wrong++;
          index++;
          render();
        };

        if (mode === 'flip') renderFlip(body, card, advance);
        else if (mode === 'choice') renderChoice(body, card, pool, advance);
        else renderTyped(body, card, advance);
      };
      render();
    });
  }

  function renderFlip(body, card, advance) {
    const face = V.el('div', { className: 'fc-card' }, [
      V.el('div', { className: 'fc-face', text: card.front }),
    ]);
    body.appendChild(face);

    const actions = V.el('div');
    body.appendChild(actions);

    const reveal = () => {
      face.innerHTML = '';
      face.appendChild(V.el('div', { className: 'fc-front-small', text: card.front }));
      face.appendChild(V.el('div', { className: 'fc-face', text: card.back || '(no answer yet)' }));
      actions.innerHTML = '';
      actions.appendChild(
        V.el('div', { className: 'btn-row' }, [
          V.ui.button('Forgot', () => advance(false), 'btn-danger'),
          V.ui.button('Got it', () => advance(true), 'btn-good'),
        ]),
      );
    };

    face.addEventListener('click', reveal);
    actions.appendChild(V.ui.button('Show answer', reveal, 'btn-primary'));
  }

  function renderChoice(body, card, pool, advance) {
    const options = V.study.shuffle([card.back].concat(V.study.distractors(card, pool, 3)));
    body.appendChild(V.el('div', { className: 'fc-card' }, [V.el('div', { className: 'fc-face', text: card.front })]));

    const list = V.el('div');
    body.appendChild(list);

    let answered = false;
    for (const opt of options) {
      const btn = V.el('button', { className: 'btn fc-option', type: 'button', text: opt });
      btn.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        const right = V.study.normaliseAnswer(opt) === V.study.normaliseAnswer(card.back);
        btn.classList.add(right ? 'fc-right' : 'fc-wrong');
        if (!right) {
          for (const other of V.$$('.fc-option', list)) {
            if (V.study.normaliseAnswer(other.textContent) === V.study.normaliseAnswer(card.back)) {
              other.classList.add('fc-right');
            }
          }
        }
        setTimeout(() => advance(right), right ? 450 : 1200);
      });
      list.appendChild(btn);
    }
  }

  function renderTyped(body, card, advance) {
    body.appendChild(V.el('div', { className: 'fc-card' }, [V.el('div', { className: 'fc-face', text: card.front })]));

    const input = V.ui.input({ placeholder: 'Your answer', autocomplete: 'off', autocapitalize: 'off' });
    const feedback = V.el('div', { className: 'hint' });
    body.appendChild(input);
    body.appendChild(feedback);
    body.appendChild(V.el('div', { style: { height: '10px' } }));

    let settled = false;

    const submit = () => {
      if (settled) return;
      const result = V.study.checkAnswer(input.value, card.back);
      if (result.empty) return V.toast('Type something first');

      settled = true;
      if (result.correct) {
        feedback.textContent = 'Correct.';
        feedback.style.color = 'var(--good)';
        setTimeout(() => advance(true), 500);
        return;
      }

      // A near miss is shown side by side and handed back to the learner to judge —
      // marking a one-letter typo as a failure would reset the card to box 0 unfairly.
      if (result.nearMiss) {
        feedback.innerHTML =
          'Very close. You wrote <strong>' + V.esc(input.value) + '</strong>, the answer is <strong>' +
          V.esc(card.back) + '</strong>.';
        feedback.style.color = 'var(--warn)';
        actions.innerHTML = '';
        actions.appendChild(
          V.el('div', { className: 'btn-row' }, [
            V.ui.button('Count as wrong', () => advance(false), 'btn-ghost'),
            V.ui.button('Close enough', () => advance(true), 'btn-good'),
          ]),
        );
        return;
      }

      feedback.innerHTML = 'The answer is <strong>' + V.esc(card.back) + '</strong>.';
      feedback.style.color = 'var(--bad)';
      setTimeout(() => advance(false), 1600);
    };

    const actions = V.el('div', {}, [V.ui.button('Check', submit, 'btn-primary')]);
    body.appendChild(actions);

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 80);
  }

  function renderSummary(body, deck, cards, results, mode) {
    const pct = results.total ? Math.round((results.right / results.total) * 100) : 0;
    body.appendChild(
      V.el('div', { className: 'grid-3' }, [
        V.ui.stat({ label: 'Right', value: String(results.right) }),
        V.ui.stat({ label: 'Wrong', value: String(results.wrong) }),
        V.ui.stat({ label: 'Score', value: String(pct), unit: '%' }),
      ]),
    );
    body.appendChild(V.el('div', { style: { height: '14px' } }));
    body.appendChild(
      V.el('div', {
        className: pct >= 80 ? 'good-box' : 'warn-box',
        text: pct >= 80
          ? 'Strong. Those cards move to longer intervals.'
          : 'The ones you missed come back tomorrow — that is the schedule working, not a failure.',
      }),
    );
    body.appendChild(V.el('div', { style: { height: '14px' } }));
    body.appendChild(V.ui.button('Study again', () => { V.ui.closeSheet(); startSession(deck, cards, mode); }, 'btn-primary'));
    body.appendChild(V.el('div', { style: { height: '8px' } }));
    body.appendChild(V.ui.button('Done', () => { V.ui.closeSheet(); V.app.render(); }, 'btn-ghost'));
  }

  // =================================================================== match

  function runMatch(deck, pool) {
    const picked = V.study.shuffle(pool).slice(0, 6);
    const startedAt = Date.now();
    let matched = 0;
    let selected = null;
    let timerHandle = null;

    V.ui.sheet(deck.name + ' — Match', (body) => {
      const timer = V.el('div', { className: 'hint', style: { textAlign: 'center' } });
      body.appendChild(timer);

      const grid = V.el('div', { className: 'fc-match' });
      body.appendChild(grid);

      const tiles = V.study.shuffle(
        picked.flatMap((c) => [
          { cardId: c.id, text: c.front, side: 'front' },
          { cardId: c.id, text: c.back, side: 'back' },
        ]),
      );

      for (const t of tiles) {
        const tile = V.el('button', { className: 'fc-tile', type: 'button', text: t.text });
        tile.dataset.cardId = t.cardId;

        tile.addEventListener('click', () => {
          if (tile.classList.contains('gone')) return;

          if (!selected) {
            selected = tile;
            tile.classList.add('sel');
            return;
          }
          if (selected === tile) {
            tile.classList.remove('sel');
            selected = null;
            return;
          }

          const isPair = selected.dataset.cardId === tile.dataset.cardId;
          if (isPair) {
            selected.classList.add('gone');
            tile.classList.add('gone');
            selected.classList.remove('sel');
            selected = null;
            matched++;
            V.haptic(10);
            if (matched === picked.length) finish();
          } else {
            const a = selected;
            a.classList.add('bad');
            tile.classList.add('bad');
            selected = null;
            setTimeout(() => { a.classList.remove('bad', 'sel'); tile.classList.remove('bad'); }, 400);
          }
        });

        grid.appendChild(tile);
      }

      function finish() {
        clearInterval(timerHandle);
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        body.innerHTML = '';
        body.appendChild(
          V.el('div', { className: 'good-box', text: `All ${picked.length} pairs matched in ${seconds} seconds.` }),
        );
        body.appendChild(V.el('div', { style: { height: '14px' } }));
        body.appendChild(V.ui.button('Play again', () => { V.ui.closeSheet(); runMatch(deck, pool); }, 'btn-primary'));
        body.appendChild(V.el('div', { style: { height: '8px' } }));
        body.appendChild(V.ui.button('Done', () => { V.ui.closeSheet(); V.app.render(); }, 'btn-ghost'));
      }

      timerHandle = setInterval(() => {
        // Wall clock, not a tick counter — background throttling would otherwise
        // under-report the time.
        timer.textContent = ((Date.now() - startedAt) / 1000).toFixed(1) + 's · ' +
          matched + ' of ' + picked.length + ' pairs';
      }, 100);
    });
  }

  F.MODES = MODES;
  V.flashcards = F;
})(window.V);
