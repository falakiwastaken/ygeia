/*
 * Ygeia — one place to add an AI key.
 *
 * The key used to be buried inside the study-photo sheet, which meant the cloud coach told
 * you to "add it first" and then sent you somewhere named after a different feature. One
 * key unlocks both, so it gets one screen, in Settings, where someone would look for it.
 *
 * Nothing here is required. The app's logs, calculations and gap analysis all work with no
 * key and no internet — this only unlocks the two features that need Google. Ygeia has no
 * built-in model and downloads nothing, so without a key there is simply no AI.
 */
(function (V) {
  'use strict';

  const K = {};

  /** Free, no card. Kept as data so the steps and the link cannot drift apart. */
  const CONSOLE_URL = 'https://aistudio.google.com/apikey';

  K.openSheet = function () {
    V.ui.sheet('AI features', async (body) => {
      const hasKey = await V.aiVision.hasKey();
      const settings = await V.store.settings.get();

      // ---- What a key is for ------------------------------------------------
      body.appendChild(
        V.el('div', { className: hasKey ? 'good-box' : 'hint' }, [
          V.el('div', {
            html: hasKey
              ? '<strong>Key saved.</strong> The cloud coach and study photo help are unlocked.'
              : '<strong>Ygeia works fully without a key.</strong>',
          }),
          V.el('div', {
            style: { marginTop: '6px' },
            text: hasKey
              ? 'Remove it at any time and the rest of the app carries on unchanged.'
              : 'Your logs, every calculation and the “what you’re missing” analysis need no ' +
                'key and no internet. A key only adds the two features below, which run on ' +
                'Google.',
          }),
        ]),
      );

      body.appendChild(V.ui.sectionTitle('What a key unlocks'));
      body.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Coach',
            sub: 'Ask about meals, training and studying — your summary goes to Google',
            value: hasKey ? '✓' : '—',
          }),
          V.ui.row({
            title: 'Study photo help',
            sub: 'Photograph a problem and get the working. Never sees your health data.',
            value: hasKey ? '✓' : '—',
          }),
        ]),
      );

      // ---- Getting one -------------------------------------------------------
      if (!hasKey) {
        body.appendChild(V.ui.sectionTitle('Getting a free key'));
        body.appendChild(
          V.ui.list([
            V.ui.row({ title: '1. Open Google AI Studio', sub: CONSOLE_URL }),
            V.ui.row({ title: '2. Sign in with a Google account' }),
            V.ui.row({ title: '3. Click “Create API key”' }),
            V.ui.row({ title: '4. Copy it and paste it below' }),
          ]),
        );
        body.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'Free, and it does not ask for a card. The free tier has generous daily ' +
                  'limits — well beyond what this app uses. Ygeia speaks Google\'s API, so a ' +
                  'key from another provider will not work here.',
          }),
        );
        body.appendChild(V.el('div', { style: { height: '10px' } }));
        body.appendChild(
          V.ui.button('Copy the link', async () => {
            try {
              await navigator.clipboard.writeText(CONSOLE_URL);
              V.toast('Link copied — paste it in your browser');
            } catch (err) {
              // Clipboard can be blocked; the address is on screen above either way.
              V.toast(CONSOLE_URL);
            }
          }),
        );
      }

      // ---- The field ---------------------------------------------------------
      body.appendChild(V.ui.sectionTitle(hasKey ? 'Replace the key' : 'Your key'));

      const keyInput = V.ui.input({
        type: 'password',
        placeholder: hasKey ? 'Paste a new key to replace it' : 'Paste your API key',
        autocomplete: 'off',
      });
      body.appendChild(V.ui.field('API key', keyInput));

      const status = V.el('div', { className: 'hint' });
      body.appendChild(status);
      body.appendChild(V.el('div', { style: { height: '8px' } }));

      const saveBtn = V.ui.button('Save and check', async () => {
        const value = keyInput.value.trim();
        if (!value) return V.toast('Paste a key first');

        saveBtn.disabled = true;
        status.className = 'hint';
        status.textContent = 'Checking the key with Google…';

        let models;
        try {
          models = await V.aiCloud.verifyKey(value);
        } catch (err) {
          saveBtn.disabled = false;
          status.className = 'warn-box';
          status.textContent = err.message;
          return;   // A key Google rejects is not saved — it would only fail again later.
        }

        await V.aiVision.setKey(value);

        // Pin a model the key can actually reach, rather than a hardcoded name that may
        // have been withdrawn from the free tier since this was written.
        const current = settings.visionModel;
        if (!current || !models.includes(current)) {
          const preferred = models.find((m) => /flash/i.test(m) && !/lite|preview/i.test(m))
            || models.find((m) => /flash/i.test(m))
            || models[0];
          await V.store.settings.set({ visionModel: preferred });
        }

        V.toast('Key saved — AI features unlocked');
        V.ui.refreshSheet();
        V.app.render();
      }, 'btn-primary');
      body.appendChild(saveBtn);

      // ---- Model picker ------------------------------------------------------
      if (hasKey) {
        body.appendChild(V.ui.sectionTitle('Model'));
        const modelRow = V.el('div');
        body.appendChild(modelRow);
        modelRow.appendChild(V.el('div', { className: 'hint', text: 'Asking Google which models your key can use…' }));

        V.aiCloud.verifyKey(await V.aiVision.getKey()).then((models) => {
          modelRow.innerHTML = '';
          modelRow.appendChild(
            V.ui.list(
              models.slice(0, 6).map((id) =>
                V.ui.row({
                  title: id,
                  value: (settings.visionModel || '') === id ? '✓' : '',
                  onClick: async () => {
                    await V.store.settings.set({ visionModel: id });
                    V.toast('Using ' + id);
                    V.ui.refreshSheet();
                  },
                }),
              ),
            ),
          );
          modelRow.appendChild(
            V.el('div', {
              className: 'hint',
              text: 'This list comes from your key, so it only offers models you can actually ' +
                    'reach. Flash models are the fast, free-tier ones.',
            }),
          );
        }).catch((err) => {
          modelRow.innerHTML = '';
          modelRow.appendChild(V.el('div', { className: 'warn-box', text: err.message }));
        });

        body.appendChild(V.el('div', { style: { height: '14px' } }));
        body.appendChild(
          V.ui.button('Remove key', async () => {
            if (!V.confirm('Remove the saved API key?\n\nThe cloud coach and study photo help ' +
                           'will stop working. Everything else is unaffected.')) return;
            await V.aiVision.clearKey();
            await V.aiCloud.setEnabled(false);
            V.toast('Key removed');
            V.ui.refreshSheet();
            V.app.render();
          }, 'btn-danger'),
        );
      }

      // ---- Where it lives ----------------------------------------------------
      body.appendChild(
        V.el('div', {
          className: 'hint',
          style: { marginTop: '14px' },
          text: 'The key is stored on this device only, in its own record, and is left out of ' +
                'backups so it cannot leak through an export. It is sent to Google as a request ' +
                'header — never in a web address, which would put it in server logs. Google\'s ' +
                'free tier may use what you send to improve their models, and human reviewers ' +
                'can see it.',
        }),
      );
    });
  };

  /** The Settings rows. Deliberately the only entry point people need to find. */
  K.buildSettingsRows = async function () {
    const hasKey = await V.aiVision.hasKey();
    return [
      V.ui.row({
        title: 'AI API key',
        sub: hasKey
          ? 'Saved — cloud coach and photo help unlocked'
          : 'Optional. Add a free Google key to unlock the AI features.',
        value: hasKey ? 'On' : 'Off',
        onClick: () => K.openSheet(),
      }),
    ];
  };

  K.CONSOLE_URL = CONSOLE_URL;
  V.aiKeyView = K;
})(window.V);
