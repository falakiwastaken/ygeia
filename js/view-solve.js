/*
 * Ygeia — "stuck on a problem" photo help.
 *
 * Photograph a question, get it worked through step by step, and turn it into a flashcard.
 *
 * This is the one screen in the app that sends anything to a third party, and it says so
 * on the screen rather than burying it in a privacy page. See js/ai-vision.js for the
 * wall that keeps health data out of it.
 */
(function (V) {
  'use strict';

  const S = {};

  // The banner below is not dismissible on purpose. Language models get arithmetic wrong,
  // and a student is precisely the wrong audience to hide that from.
  const VERIFY_NOTE =
    'Check this yourself before trusting it. AI gets arithmetic and algebra wrong more ' +
    'often than it sounds like it does — use the working to understand the method, not as ' +
    'a correct answer.';

  S.openSolveSheet = function () {
    V.ui.sheet('Stuck on a problem?', async (body) => {
      const hasKey = await V.aiVision.hasKey();

      // Key entry lives in one place — Settings → AI features — because the same key also
      // unlocks the cloud coach. Duplicating the form here is how the two drift apart.
      if (!hasKey) {
        body.appendChild(
          V.el('div', { className: 'warn-box' }, [
            V.el('div', { html: '<strong>This one needs a free Google API key.</strong>' }),
            V.el('div', {
              style: { marginTop: '6px' },
              text: 'Everything else in Ygeia runs on your device. Reading handwriting and ' +
                    'working through maths is the one job a small on-device model cannot do ' +
                    'reliably, so this uses Google Gemini instead.',
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
            text: 'It is free and takes about a minute. The next screen explains where to get ' +
                  'one and what it unlocks.',
          }),
        );
        return;
      }

      // ---- Capture ----------------------------------------------------------
      let image = null;

      const fileInput = V.el('input', {
        type: 'file',
        accept: 'image/*',
        // On a phone this opens the camera directly rather than the photo library.
        capture: 'environment',
      });

      const previewWrap = V.el('div');
      const question = V.el('textarea', {
        rows: 2,
        placeholder: 'Anything to add? e.g. "I got stuck at the second line"',
      });
      const output = V.el('div');
      const solveBtn = V.ui.button('Explain it step by step', run, 'btn-primary');

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        previewWrap.innerHTML = '';
        output.innerHTML = '';
        try {
          image = await V.aiVision.prepareImage(file);
          previewWrap.appendChild(
            V.el('img', {
              src: image.dataUrl,
              className: 'solve-preview',
              alt: 'The problem you photographed',
            }),
          );
          previewWrap.appendChild(
            V.el('div', { className: 'hint', text: `${image.width}×${image.height}, about ${image.approxKB} KB` }),
          );
        } catch (err) {
          previewWrap.appendChild(V.el('div', { className: 'warn-box', text: err.message }));
        }
      });

      async function run() {
        if (!image) return V.toast('Take or choose a photo first');

        output.innerHTML = '';
        output.appendChild(V.el('div', { className: 'hint', text: 'Reading the problem…' }));
        solveBtn.disabled = true;

        try {
          const settings = await V.store.settings.get();
          const result = await V.aiVision.solve({
            base64: image.base64,
            mimeType: image.mimeType,
            question: question.value,
            model: settings.visionModel || V.aiVision.DEFAULT_MODEL,
          });

          output.innerHTML = '';
          output.appendChild(V.el('div', { className: 'danger-box', text: VERIFY_NOTE }));
          output.appendChild(V.el('div', { className: 'solve-answer', text: result.text }));
          output.appendChild(V.el('div', { style: { height: '12px' } }));
          output.appendChild(
            V.ui.button('Save as a flashcard', () => saveAsCard(result.text), 'btn-good'),
          );
          output.appendChild(V.el('div', { className: 'hint', text: 'Answered by ' + result.model + '.' }));
        } catch (err) {
          output.innerHTML = '';
          output.appendChild(V.el('div', { className: 'warn-box', text: err.message }));
        } finally {
          solveBtn.disabled = false;
        }
      }

      body.appendChild(fileInput);
      body.appendChild(previewWrap);
      body.appendChild(V.el('div', { style: { height: '10px' } }));
      body.appendChild(V.ui.field('Extra context (optional)', question));
      body.appendChild(solveBtn);
      body.appendChild(output);

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Only the photo and your note are sent. None of your health data goes ' +
                'anywhere — that is enforced in code, not just policy.',
        }),
      );
    });
  };

  /**
   * Turn a worked answer into a card.
   *
   * The front is left for the student to write in their own words on purpose — copying the
   * question verbatim produces a card you recognise rather than one you can answer.
   */
  function saveAsCard(answerText) {
    V.ui.sheet('Save as flashcard', async (body) => {
      const decks = await V.store.study.decks();
      const front = V.el('textarea', { rows: 2, placeholder: 'What should the card ask? Write it in your own words.' });
      const back = V.el('textarea', { rows: 6, value: answerText });

      let deckId = decks.length ? decks[0].id : null;

      if (decks.length) {
        const wrap = V.el('div');
        const render = () => {
          wrap.innerHTML = '';
          wrap.appendChild(
            V.ui.segmented(decks.map((d) => ({ value: d.id, label: d.name })), deckId,
              (v) => { deckId = v; render(); }),
          );
        };
        render();
        body.appendChild(V.ui.field('Deck', wrap));
      } else {
        body.appendChild(V.el('div', { className: 'hint', text: 'No decks yet — one called "Problems" will be created.' }));
      }

      body.appendChild(V.ui.field('Front', front));
      body.appendChild(V.ui.field('Back', back, 'Trim this down to the part worth remembering.'));

      body.appendChild(
        V.ui.button('Save card', async () => {
          if (!front.value.trim()) return V.toast('Write the question side first');

          if (!deckId) {
            const deck = { id: V.uid(), name: 'Problems', subjectId: null, createdAt: Date.now() };
            await V.store.study.saveDeck(deck);
            deckId = deck.id;
          }

          await V.store.study.saveReview(
            V.study.newCard({ deckId, front: front.value.trim(), back: back.value.trim() }),
          );

          V.ui.closeSheet(true);
          V.toast('Card saved');
          V.app.render();
        }, 'btn-primary'),
      );
    });
  }

  /**
   * Settings row. The key and model now live under AI features, which owns them for both
   * this and the cloud coach, so this is just the way in to the feature itself.
   */
  S.buildSettingsRows = async function () {
    const hasKey = await V.aiVision.hasKey();
    return [
      V.ui.row({
        title: 'Study photo help',
        sub: hasKey ? 'Ready — photograph a problem for step-by-step working' : 'Needs an API key',
        value: hasKey ? 'On' : 'Off',
        onClick: () => S.openSolveSheet(),
      }),
    ];
  };

  S.VERIFY_NOTE = VERIFY_NOTE;
  V.solveView = S;
})(window.V);
