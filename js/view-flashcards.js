/*
 * Ygeia — flashcards.
 *
 * Decks of two-sided cards with four study modes.
 *
 * The interface is deliberately Quizlet-shaped: make a deck, type your cards into a list,
 * study it. Spaced repetition still runs underneath — cards you keep missing come back
 * earlier in the queue — but none of that vocabulary ("due today", "box 3 of 5") is shown,
 * because it made the feature feel like homework about homework.
 */
(function (V) {
  'use strict';

  const F = {};

  const MODES = [
    { value: 'flip', label: 'Flip', note: 'See the term, recall it, flip it over.' },
    { value: 'choice', label: 'Multiple choice', note: 'Pick from four. Needs at least 3 cards.' },
    { value: 'type', label: 'Write it', note: 'Type the answer. Typos are forgiven.' },
    { value: 'match', label: 'Match', note: 'Pair terms to definitions against the clock.' },
  ];

  /**
   * Study order: the cards you keep getting wrong come first.
   * Uses the Leitner box and lapse count as a priority signal only — never shown.
   */
  function byWeakest(cards) {
    return cards.slice().sort((a, b) => (a.box - b.box) || ((b.lapses || 0) - (a.lapses || 0)));
  }

  const learned = (c) => c.box >= 3;

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

      // Cards created before decks existed have no deckId and would otherwise be invisible.
      const loose = allCards.filter((c) => !c.deckId);
      if (loose.length) {
        body.appendChild(
          V.el('div', { className: 'warn-box' }, [
            V.el('div', { text: `${loose.length} card(s) are not in a deck yet.` }),
            V.el('div', { style: { height: '10px' } }),
            V.ui.button('Put them in a deck', () => adoptLooseCards(loose), 'btn-ghost'),
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
              const sub = subById[d.subjectId];
              const done = cards.filter(learned).length;
              return V.ui.row({
                title: d.name,
                sub: [
                  sub && sub.name,
                  `${cards.length} card${cards.length === 1 ? '' : 's'}`,
                  cards.length ? `${done} learned` : null,
                ].filter(Boolean).join(' · '),
                value: '›',
                accessory: sub ? V.el('div', { className: 'subject-dot', style: { background: sub.color } }) : null,
                onClick: () => F.openDeck(d),
              });
            }),
          ),
        );
      }

      body.appendChild(V.el('div', { style: { height: '14px' } }));
      body.appendChild(V.ui.button('New deck', createDeck, 'btn-primary'));
    });
  };

  /** Making a deck drops you straight into typing cards — that is the whole point. */
  function createDeck() {
    V.ui.sheet('New deck', async (body) => {
      const subjects = await V.store.study.subjects();
      const name = V.ui.input({ placeholder: 'e.g. Biology — Cells' });
      let subjectId = null;

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
        body.appendChild(V.ui.field('Subject (optional)', wrap));
      }

      body.appendChild(V.el('div', { style: { height: '10px' } }));
      body.appendChild(
        V.ui.button('Create and add cards', async () => {
          if (!name.value.trim()) return V.toast('Give the deck a name');
          const deck = { id: V.uid(), name: name.value.trim(), subjectId, createdAt: Date.now() };
          await V.store.study.saveDeck(deck);
          V.ui.closeSheet();
          F.openBuilder(deck);
        }, 'btn-primary'),
      );

      setTimeout(() => name.focus(), 60);
    });
  }

  // ============================================================ card builder

  /**
   * The Quizlet-style editor: a numbered list of term/definition rows.
   *
   * A blank row is always kept at the bottom and a new one appears as soon as you type in
   * it, so adding twenty cards never requires twenty trips through a dialog. Everything is
   * saved in one pass at the end.
   */
  F.openBuilder = function (deck) {
    V.ui.sheet(deck.name, async (body) => {
      const existing = await V.store.study.cardsInDeck(deck.id);
      const rows = [];
      const list = V.el('div');

      const addRow = (card) => {
        const row = { id: card ? card.id : null, original: card || null };

        const front = V.el('textarea', { rows: 1, className: 'fc-input', placeholder: 'Term', value: card ? card.front : '' });
        const back = V.el('textarea', { rows: 1, className: 'fc-input', placeholder: 'Definition', value: card ? card.back : '' });
        row.front = front;
        row.back = back;

        // Typing in the final row spawns the next one.
        const maybeGrow = () => {
          if (rows[rows.length - 1] === row && (front.value.trim() || back.value.trim())) addRow(null);
        };
        front.addEventListener('input', maybeGrow);
        back.addEventListener('input', maybeGrow);

        const node = V.el('div', { className: 'fc-row' }, [
          V.el('div', { className: 'fc-row-head' }, [
            V.el('span', { className: 'fc-row-num', text: String(rows.length + 1) }),
            V.el('button', {
              className: 'icon-btn', type: 'button', text: '×', 'aria-label': 'Remove card',
              on: {
                click: () => {
                  row.removed = true;
                  node.remove();
                  renumber();
                },
              },
            }),
          ]),
          front,
          back,
        ]);

        row.node = node;
        rows.push(row);
        list.appendChild(node);
        return row;
      };

      const renumber = () => {
        let n = 1;
        for (const r of rows) {
          if (r.removed) continue;
          V.$('.fc-row-num', r.node).textContent = String(n++);
        }
      };

      for (const card of existing) addRow(card);
      addRow(null); // always one blank row waiting

      body.appendChild(
        V.el('div', { className: 'hint', text: 'Type a term and its definition. A new row appears as you go.' }),
      );
      body.appendChild(list);
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('+ Add another', () => { addRow(null); renumber(); }, 'btn-ghost'));

      body.appendChild(V.el('div', { style: { height: '16px' } }));
      body.appendChild(
        V.ui.button('Save deck', async () => {
          let created = 0, updated = 0, deleted = 0;

          for (const r of rows) {
            const front = r.front.value.trim();
            const back = r.back.value.trim();

            if (r.removed || (!front && !back)) {
              // An emptied existing card is a deletion; an empty new row is just noise.
              if (r.original) { await V.store.study.removeReview(r.original.id); deleted++; }
              continue;
            }
            if (!front) continue; // a definition with no term is not a card

            if (r.original) {
              const card = r.original;
              if (card.front !== front || card.back !== back) {
                card.front = front;
                card.back = back;
                card.title = front;
                card.needsAnswer = !back;
                await V.store.study.saveReview(card);
                updated++;
              }
            } else {
              await V.store.study.saveReview(
                V.study.newCard({ deckId: deck.id, subjectId: deck.subjectId, front, back }),
              );
              created++;
            }
          }

          V.ui.closeSheet();
          V.toast(
            [created && `${created} added`, updated && `${updated} updated`, deleted && `${deleted} removed`]
              .filter(Boolean).join(', ') || 'No changes',
          );
          F.openDeck(deck);
          V.app.render();
        }, 'btn-primary'),
      );

      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('Import from a list', () => openImport(deck), 'btn-ghost'));
    });
  };

  // ============================================================== deck detail

  F.openDeck = function (deck) {
    V.ui.sheet(deck.name, async (body) => {
      const cards = await V.store.study.cardsInDeck(deck.id);
      const ready = cards.filter((c) => c.back);

      if (!cards.length) {
        body.appendChild(V.ui.empty('This deck is empty.'));
        body.appendChild(V.ui.button('Add cards', () => F.openBuilder(deck), 'btn-primary'));
        body.appendChild(V.el('div', { style: { height: '8px' } }));
        body.appendChild(V.ui.button('Deck settings', () => openDeckSettings(deck), 'btn-ghost'));
        return;
      }

      body.appendChild(
        V.el('div', { className: 'grid-2' }, [
          V.ui.stat({ label: 'Cards', value: String(cards.length) }),
          V.ui.stat({ label: 'Learned', value: String(cards.filter(learned).length) }),
        ]),
      );

      // ---- Study -----------------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Study'));
      body.appendChild(
        V.ui.list(
          MODES.map((m) => {
            const blocked =
              (m.value === 'choice' && !V.study.canMultipleChoice(cards)) ||
              (m.value !== 'flip' && !ready.length) ||
              (m.value === 'match' && ready.length < 2);
            return V.ui.row({
              title: m.label,
              sub: blocked ? 'Add more cards with definitions to unlock' : m.note,
              value: blocked ? '' : '›',
              onClick: blocked ? null : () => startSession(deck, cards, m.value),
            });
          }),
        ),
      );

      // ---- Cards ------------------------------------------------------------
      body.appendChild(V.ui.sectionTitle(`${cards.length} card${cards.length === 1 ? '' : 's'}`));
      body.appendChild(
        V.ui.list(
          cards.slice(0, 60).map((c) =>
            V.ui.row({
              title: c.front,
              sub: c.back || 'No definition yet',
              accessory: learned(c)
                ? V.el('span', { className: 'tag', text: 'learned' })
                : null,
              onClick: () => F.openBuilder(deck),
            }),
          ),
        ),
      );
      if (cards.length > 60) {
        body.appendChild(V.el('div', { className: 'hint', text: `and ${cards.length - 60} more…` }));
      }

      body.appendChild(V.el('div', { style: { height: '14px' } }));
      body.appendChild(V.ui.button('Edit cards', () => F.openBuilder(deck), 'btn-primary'));
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('Import / export', () => openImport(deck), 'btn-ghost'));
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('Deck settings', () => openDeckSettings(deck), 'btn-ghost'));
    });
  };

  function openDeckSettings(deck) {
    V.ui.sheet('Deck settings', async (body) => {
      const subjects = await V.store.study.subjects();
      const name = V.ui.input({ value: deck.name });
      let subjectId = deck.subjectId;

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
          deck.name = name.value.trim() || deck.name;
          deck.subjectId = subjectId;
          await V.store.study.saveDeck(deck);
          V.ui.closeSheet();
          V.toast('Saved');
          V.app.render();
        }, 'btn-primary'),
      );

      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(
        V.ui.button('Reset progress', async () => {
          if (!V.confirm('Mark every card in this deck as new again?')) return;
          for (const c of await V.store.study.cardsInDeck(deck.id)) {
            c.box = 0; c.lapses = 0; c.reviews = 0;
            c.dueDate = V.today();
            await V.store.study.saveReview(c);
          }
          V.toast('Progress reset');
          V.ui.closeSheet();
        }, 'btn-ghost'),
      );

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
    });
  }

  /** Move pre-deck cards into a real deck so they stop being orphaned. */
  function adoptLooseCards(loose) {
    V.ui.sheet('Tidy up', async (body) => {
      const decks = await V.store.study.decks();
      body.appendChild(
        V.el('div', { className: 'hint', text: `${loose.length} card(s) were made before decks existed. Pick where they should live.` }),
      );

      const move = async (deckId) => {
        for (const c of loose) { c.deckId = deckId; await V.store.study.saveReview(c); }
        V.ui.closeSheet(true);
        V.toast('Moved');
        F.openDecks();
      };

      if (decks.length) {
        body.appendChild(V.ui.sectionTitle('Existing decks'));
        body.appendChild(V.ui.list(decks.map((d) => V.ui.row({ title: d.name, onClick: () => move(d.id) }))));
      }

      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(
        V.ui.button('Put them in a new deck', async () => {
          const deck = { id: V.uid(), name: 'My cards', subjectId: null, createdAt: Date.now() };
          await V.store.study.saveDeck(deck);
          await move(deck.id);
        }, 'btn-primary'),
      );
    });
  }

  // ================================================================== import

  function openImport(deck) {
    V.ui.sheet('Import / export', async (body) => {
      const existing = await V.store.study.cardsInDeck(deck.id);

      body.appendChild(V.ui.sectionTitle('Paste a list'));
      const area = V.el('textarea', {
        rows: 8,
        placeholder: 'photosynthesis - converting light into chemical energy\nmitochondrion - the site of respiration',
      });
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
        V.el('div', { className: 'hint', text: 'One card per line, term and definition separated by a dash, tab, colon or comma.' }),
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
          F.openDeck(deck);
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
    if (mode === 'match') return runMatch(deck, pool);

    // Weakest first, then shuffled within that so the order is not identical every time.
    const weakest = byWeakest(pool);
    const half = Math.ceil(weakest.length / 2);
    const queue = V.study.shuffle(weakest.slice(0, half)).concat(V.study.shuffle(weakest.slice(half)));

    const results = { right: 0, wrong: 0, total: queue.length };
    let index = 0;

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
    const face = V.el('div', { className: 'fc-card' }, [V.el('div', { className: 'fc-face', text: card.front })]);
    body.appendChild(face);

    const actions = V.el('div');
    body.appendChild(actions);

    const reveal = () => {
      face.innerHTML = '';
      face.appendChild(V.el('div', { className: 'fc-front-small', text: card.front }));
      face.appendChild(V.el('div', { className: 'fc-face', text: card.back || '(no definition yet)' }));
      actions.innerHTML = '';
      actions.appendChild(
        V.el('div', { className: 'btn-row' }, [
          V.ui.button('Still learning', () => advance(false), 'btn-danger'),
          V.ui.button('Got it', () => advance(true), 'btn-good'),
        ]),
      );
    };

    face.addEventListener('click', reveal);
    actions.appendChild(V.ui.button('Flip', reveal, 'btn-primary'));
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
    const actions = V.el('div');

    body.appendChild(input);
    body.appendChild(feedback);
    body.appendChild(V.el('div', { style: { height: '10px' } }));
    body.appendChild(actions);

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

      // A near miss is handed back to the learner. Marking a one-letter typo as a failure
      // would wipe the card's progress unfairly.
      if (result.nearMiss) {
        feedback.innerHTML =
          'Very close. You wrote <strong>' + V.esc(input.value) +
          '</strong>, the answer is <strong>' + V.esc(card.back) + '</strong>.';
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

    actions.appendChild(V.ui.button('Check', submit, 'btn-primary'));
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
          ? 'Strong round.'
          : 'The ones you missed will come up first next time.',
      }),
    );
    body.appendChild(V.el('div', { style: { height: '14px' } }));
    body.appendChild(V.ui.button('Go again', () => { V.ui.closeSheet(); startSession(deck, cards, mode); }, 'btn-primary'));
    body.appendChild(V.el('div', { style: { height: '8px' } }));
    body.appendChild(V.ui.button('Done', () => { V.ui.closeSheet(true); V.app.render(); }, 'btn-ghost'));
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
        picked.reduce((acc, c) => acc.concat(
          [{ cardId: c.id, text: c.front }, { cardId: c.id, text: c.back }],
        ), []),
      );

      for (const t of tiles) {
        const tile = V.el('button', { className: 'fc-tile', type: 'button', text: t.text });
        tile.dataset.cardId = t.cardId;

        tile.addEventListener('click', () => {
          if (tile.classList.contains('gone')) return;

          if (!selected) { selected = tile; tile.classList.add('sel'); return; }
          if (selected === tile) { tile.classList.remove('sel'); selected = null; return; }

          if (selected.dataset.cardId === tile.dataset.cardId) {
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
        body.appendChild(V.el('div', { className: 'good-box', text: `All ${picked.length} pairs matched in ${seconds} seconds.` }));
        body.appendChild(V.el('div', { style: { height: '14px' } }));
        body.appendChild(V.ui.button('Play again', () => { V.ui.closeSheet(); runMatch(deck, pool); }, 'btn-primary'));
        body.appendChild(V.el('div', { style: { height: '8px' } }));
        body.appendChild(V.ui.button('Done', () => { V.ui.closeSheet(true); V.app.render(); }, 'btn-ghost'));
      }

      // Wall clock, not a tick counter — background throttling would under-report time.
      timerHandle = setInterval(() => {
        timer.textContent = ((Date.now() - startedAt) / 1000).toFixed(1) + 's · ' +
          matched + ' of ' + picked.length + ' pairs';
      }, 100);
    });
  }

  F.MODES = MODES;
  F.byWeakest = byWeakest;
  F.openCardBuilder = F.openBuilder; // alias kept for readability at call sites
  V.flashcards = F;
})(window.V);
