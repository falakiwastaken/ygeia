/*
 * Ygeia — photograph pages, get a deck.
 *
 * Three steps, and the third is not optional:
 *
 *   1. Capture   add one or more photos of the material
 *   2. Extract   send them to Gemini, which returns candidate cards
 *   3. Review    read every card, fix or delete what is wrong, then save
 *
 * The review step is the whole design. Spaced repetition is extremely good at teaching
 * you whatever you feed it, which means a wrong card is not a neutral failure — it is an
 * efficient way to memorise something false, and you will not notice for weeks. So no
 * card reaches a deck without a human having seen it, there is no "save all without
 * looking" button, and the copy says why rather than pretending the model is reliable.
 *
 * Privacy: this sends photographs to Google, exactly like the existing solve feature and
 * subject to the same warning. It goes through js/ai-vision.js, which is walled off from
 * health data — see the header of that file before changing anything here.
 */
(function (V) {
  'use strict';

  /** More than this and the request gets slow and the model starts losing pages. */
  const MAX_PAGES = 5;

  function openScanSheet(subjectId) {
    V.ui.sheet('Make a deck from a photo', async (body) => {
      const hasKey = await V.aiVision.hasKey();

      if (!hasKey) {
        body.appendChild(
          V.el('div', {
            className: 'warn-box',
            text: 'This needs a Google AI API key, which you add yourself and which stays ' +
                  'on your device. Everything else in Ygeia works offline; this does not.',
          }),
        );
        body.appendChild(V.el('div', { style: { height: '12px' } }));
        body.appendChild(
          V.ui.button('Add a key', () => { V.ui.closeSheet(); V.aiKeyView.openSheet(); }, 'btn-primary'),
        );
        return;
      }

      /** Prepared images, newest last. */
      const pages = [];
      const gallery = V.el('div', { className: 'scan-gallery' });
      const status = V.el('div');

      const fileInput = V.el('input', {
        type: 'file', accept: 'image/*', capture: 'environment', multiple: true,
        style: { display: 'none' },
      });

      function renderGallery() {
        gallery.innerHTML = '';
        pages.forEach((p, i) => {
          gallery.appendChild(
            V.el('div', { className: 'scan-thumb' }, [
              V.el('img', { src: p.dataUrl, alt: 'Page ' + (i + 1) }),
              V.el('button', {
                className: 'scan-remove', type: 'button', text: '×',
                'aria-label': 'Remove page ' + (i + 1),
                on: { click: () => { pages.splice(i, 1); renderGallery(); } },
              }),
            ]),
          );
        });
        addBtn.disabled = pages.length >= MAX_PAGES;
        extractBtn.disabled = !pages.length;
        pageCount.textContent = pages.length
          ? `${V.pluralise(pages.length, 'page')} ready` +
            (pages.length >= MAX_PAGES ? ' — that is the limit for one go' : '')
          : 'No pages yet.';
      }

      fileInput.addEventListener('change', async () => {
        const files = Array.from(fileInput.files || []);
        // Reset immediately so picking the same file twice still fires a change event.
        fileInput.value = '';
        for (const f of files) {
          if (pages.length >= MAX_PAGES) { V.toast(`Maximum ${MAX_PAGES} pages`); break; }
          try {
            pages.push(await V.aiVision.prepareImage(f));
          } catch (err) {
            V.toast(err.message || 'Could not read that image');
          }
        }
        renderGallery();
      });

      const addBtn = V.ui.button('📷 Add a page', () => fileInput.click(), 'btn-primary');
      const pageCount = V.el('div', { className: 'hint' });

      const hint = V.ui.input({ placeholder: 'e.g. only the vocabulary list' });

      const extractBtn = V.ui.button('Make cards', async () => {
        extractBtn.disabled = true;
        addBtn.disabled = true;
        status.innerHTML = '';
        status.appendChild(
          V.el('div', { className: 'hint', text: 'Reading the pages… this can take up to a minute.' }),
        );

        let result;
        try {
          result = await V.aiVision.extractCards({
            images: pages.map((p) => ({ base64: p.base64, mimeType: p.mimeType })),
            hint: hint.value,
          });
        } catch (err) {
          status.innerHTML = '';
          status.appendChild(V.el('div', { className: 'warn-box', text: err.message }));
          extractBtn.disabled = false;
          addBtn.disabled = pages.length >= MAX_PAGES;
          return;
        }

        if (!result.cards.length) {
          status.innerHTML = '';
          status.appendChild(
            V.el('div', {
              className: 'warn-box',
              text: 'No cards came back. Either the photo was too hard to read, or there was ' +
                    'nothing on it worth memorising. A sharper, closer photo of just the ' +
                    'material usually fixes it.',
            }),
          );
          extractBtn.disabled = false;
          addBtn.disabled = pages.length >= MAX_PAGES;
          return;
        }

        openReviewSheet(result.cards, subjectId, result.model);
      }, 'btn-good');

      body.appendChild(V.ui.sectionTitle('Pages'));
      body.appendChild(gallery);
      body.appendChild(pageCount);
      body.appendChild(V.el('div', { style: { height: '10px' } }));
      body.appendChild(addBtn);
      body.appendChild(fileInput);
      body.appendChild(
        V.ui.field('Anything to focus on?', hint,
          'Optional. Leave blank to make cards from everything on the page.'),
      );
      body.appendChild(extractBtn);
      body.appendChild(status);
      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Your photos are sent to Google to be read. On the free tier they may be ' +
                'used for training and seen by human reviewers, so do not photograph ' +
                'anything private. Nothing else in Ygeia is ever sent anywhere.',
        }),
      );

      renderGallery();
    });
  }

  // =============================================================== review step

  /**
   * Read, fix, and choose what to keep.
   *
   * Every card starts included, but every card is also visible and editable, and the save
   * button names the number so nobody saves forty cards thinking they checked them.
   */
  function openReviewSheet(cards, subjectId, model) {
    V.ui.sheet('Check the cards', async (body) => {
      const [decks, subjects] = await Promise.all([
        V.store.study.decks(),
        V.store.study.subjects(),
      ]);

      // Working copies. Nothing is written until Save.
      const draft = cards.map((c) => ({ front: c.front, back: c.back, keep: true }));

      let deckMode = 'new';
      let existingDeckId = decks.length ? decks[0].id : null;
      let chosenSubject = subjectId || null;
      const deckName = V.ui.input({ placeholder: 'Deck name', value: suggestName() });

      function suggestName() {
        return 'Scanned ' + V.parseKey(V.today()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }

      body.appendChild(
        V.el('div', {
          className: 'warn-box',
          style: { marginTop: '0' },
          text: 'These were written by a model reading your photo, and some will be wrong. ' +
                'Read each one before saving — a flashcard you drill twenty times teaches ' +
                'you whatever it says, right or not.',
        }),
      );

      const listWrap = V.el('div');
      const countLine = V.el('div', { className: 'hint' });

      function kept() { return draft.filter((d) => d.keep); }

      function renderCount() {
        countLine.textContent =
          `${kept().length} of ${draft.length} will be saved.` +
          (model ? ` Written by ${model}.` : '');
        saveBtn.textContent = kept().length
          ? `Save ${V.pluralise(kept().length, 'card')}`
          : 'Nothing selected';
        saveBtn.disabled = !kept().length;
      }

      function renderList() {
        listWrap.innerHTML = '';
        draft.forEach((card, i) => {
          const front = V.el('textarea', { className: 'fc-input', rows: 2, value: card.front });
          const back = V.el('textarea', { className: 'fc-input', rows: 2, value: card.back });
          front.addEventListener('input', () => { card.front = front.value; });
          back.addEventListener('input', () => { card.back = back.value; });

          listWrap.appendChild(
            V.el('div', { className: 'scan-card' + (card.keep ? '' : ' dropped') }, [
              V.el('div', { className: 'scan-card-head' }, [
                V.el('span', { className: 'scan-card-n', text: '#' + (i + 1) }),
                V.ui.toggle(card.keep, (on) => {
                  card.keep = on;
                  renderList();
                  renderCount();
                }, 'Keep card ' + (i + 1)),
              ]),
              front,
              back,
            ]),
          );
        });
      }

      // ---- destination ------------------------------------------------------
      const destWrap = V.el('div');
      function renderDest() {
        destWrap.innerHTML = '';
        if (decks.length) {
          destWrap.appendChild(
            V.ui.segmented(
              [{ value: 'new', label: 'New deck' }, { value: 'existing', label: 'Add to a deck' }],
              deckMode,
              (v) => { deckMode = v; renderDest(); },
            ),
          );
        }
        if (deckMode === 'new' || !decks.length) {
          destWrap.appendChild(V.ui.field('Name', deckName));
          if (subjects.length) {
            destWrap.appendChild(
              V.ui.field('Subject', V.ui.segmented(
                [{ value: null, label: 'None' }].concat(subjects.map((s) => ({ value: s.id, label: s.name }))),
                chosenSubject,
                (v) => { chosenSubject = v; renderDest(); },
              )),
            );
          }
        } else {
          destWrap.appendChild(V.ui.field('Deck', V.ui.segmented(
            decks.map((d) => ({ value: d.id, label: d.name })),
            existingDeckId,
            (v) => { existingDeckId = v; renderDest(); },
          )));
        }
      }

      const saveBtn = V.ui.button('Save', async () => {
        const keeping = kept().filter((c) => c.front.trim() && c.back.trim());
        if (!keeping.length) return V.toast('Nothing to save');

        let deckId;
        if (deckMode === 'existing' && decks.length && existingDeckId) {
          deckId = existingDeckId;
        } else {
          const name = deckName.value.trim() || suggestName();
          const deck = { id: V.uid(), name, subjectId: chosenSubject, createdAt: Date.now() };
          await V.store.study.saveDeck(deck);
          deckId = deck.id;
        }

        for (const c of keeping) {
          const card = V.study.newCard({
            deckId,
            subjectId: chosenSubject,
            front: c.front.trim(),
            back: c.back.trim(),
          });
          // Marked so a card's origin stays knowable long after the photo is gone.
          card.source = 'ai';
          await V.store.study.saveReview(card);
        }

        V.ui.closeSheet(true);
        V.toast(`${V.pluralise(keeping.length, 'card')} saved`);
        V.app.render();
      }, 'btn-primary');

      body.appendChild(countLine);
      body.appendChild(listWrap);
      body.appendChild(V.ui.sectionTitle('Save to'));
      body.appendChild(destWrap);
      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(saveBtn);
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(V.ui.button('Discard these', () => {
        if (!V.confirm('Throw away these cards?')) return;
        V.ui.closeSheet(true);
      }, 'btn-ghost'));

      renderList();
      renderDest();
      renderCount();
    });
  }

  /** Card for the Study tab. */
  function buildCard() {
    return V.ui.card({
      title: 'Photograph your notes',
      sub: 'Turn a page of notes or a textbook into a deck of flashcards',
      children: [V.ui.button('Scan a page', () => openScanSheet(), 'btn-ghost')],
    });
  }

  V.scanDeckView = { openScanSheet, buildCard };
})(window.V);
