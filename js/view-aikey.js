/*
 * Ygeia — one place to add an AI key.
 *
 * The key used to be buried inside the study-photo sheet, which meant the cloud coach told
 * you to "add it first" and then sent you somewhere named after a different feature. One
 * key unlocks both, so it gets one screen, in Settings, where someone would look for it.
 *
 * It also used to be a Google key specifically. It is now whatever key the user has: the
 * format identifies who issued it (js/ai-providers.js) and the app adapts. Paid or free is
 * not this screen's business — there is no signup funnel here, no recommended provider and
 * nothing to click through. Someone who has a key pastes it; someone who does not has an
 * app that already works.
 *
 * Nothing here is required. The app's logs, calculations and gap analysis all work with no
 * key and no internet. Ygeia has no built-in model and downloads nothing, so without a key
 * there is simply no AI.
 */
(function (V) {
  'use strict';

  const K = {};

  /** e.g. "Google Gemini (AIza…) or Anthropic Claude (sk-ant-…)" */
  function acceptedKeys() {
    return V.aiProviders.PROVIDERS.map((p) => `${p.label} (${p.keyHint})`).join(' or ');
  }

  K.openSheet = function () {
    V.ui.sheet('AI features', async (body) => {
      const savedKey = await V.aiVision.getKey();
      const hasKey = !!savedKey;
      const provider = savedKey ? V.aiProviders.detect(savedKey) : null;
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
              ? `Using ${provider ? provider.label : 'an unrecognised provider'}. Remove the key ` +
                'at any time and the rest of the app carries on unchanged.'
              : 'Your logs, every calculation and the “what you’re missing” analysis need no ' +
                'key and no internet. A key only adds the two features below. If you already ' +
                'have one, paste it — Ygeia uses your key against your own account and adds ' +
                'nothing on top.',
          }),
        ]),
      );

      body.appendChild(V.ui.sectionTitle('What a key unlocks'));
      body.appendChild(
        V.ui.list([
          V.ui.row({
            title: 'Coach',
            sub: provider
              ? `Ask about meals, training and studying — your summary goes to ${provider.label}`
              : 'Ask about meals, training and studying — your summary is sent to your provider',
            value: hasKey ? '✓' : '—',
          }),
          V.ui.row({
            title: 'Study photo help',
            sub: 'Photograph a problem and get the working. Never sees your health data.',
            value: hasKey ? '✓' : '—',
          }),
        ]),
      );

      // ---- The field ---------------------------------------------------------
      body.appendChild(V.ui.sectionTitle(hasKey ? 'Replace the key' : 'Your key'));

      const keyInput = V.ui.input({
        type: 'password',
        placeholder: hasKey ? 'Paste a new key to replace it' : 'Paste your API key',
        autocomplete: 'off',
      });
      body.appendChild(V.ui.field('API key', keyInput));

      if (!hasKey) {
        body.appendChild(V.el('div', { className: 'hint', text: 'Accepts ' + acceptedKeys() + '.' }));
      }

      const status = V.el('div', { className: 'hint' });
      body.appendChild(status);

      /*
       * Name the provider as soon as the key is pasted, before anything is sent.
       * A typo, or a key from somewhere unsupported, is otherwise only discovered after a
       * round trip, reported as a rejection, and reads as "my key is broken".
       */
      const detected = () => V.aiProviders.detect(keyInput.value.trim());
      const showDetected = () => {
        const value = keyInput.value.trim();
        if (!value) {
          status.className = 'hint';
          status.textContent = '';
          return;
        }
        const p = detected();
        status.className = p ? 'hint' : 'warn-box';
        status.textContent = p
          ? `Recognised as a key for ${p.label}.`
          : 'Not recognised. Ygeia accepts ' + acceptedKeys() + '.';
      };
      keyInput.addEventListener('input', showDetected);

      body.appendChild(V.el('div', { style: { height: '8px' } }));

      const saveBtn = V.ui.button('Save and check', async () => {
        const value = keyInput.value.trim();
        if (!value) return V.toast('Paste a key first');

        const p = detected();
        if (!p) return showDetected();

        saveBtn.disabled = true;
        status.className = 'hint';
        status.textContent = `Checking the key with ${p.label}…`;

        let models;
        try {
          models = await V.aiCloud.verifyKey(value);
        } catch (err) {
          saveBtn.disabled = false;
          status.className = 'warn-box';
          status.textContent = err.message;
          return;   // A key the provider rejects is not saved — it would only fail again later.
        }

        await V.aiVision.setKey(value);

        // Pin a model the key can actually reach, rather than a hardcoded name that may
        // have been withdrawn since this was written. Switching providers always re-picks,
        // because a model id from the old one is meaningless to the new one.
        const current = settings.visionModel;
        if (!current || !models.includes(current)) {
          await V.store.settings.set({ visionModel: p.defaultModel(models) || models[0] });
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
        modelRow.appendChild(
          V.el('div', {
            className: 'hint',
            text: `Asking ${provider ? provider.label : 'your provider'} which models your key can use…`,
          }),
        );

        V.aiCloud.verifyKey(savedKey).then((models) => {
          modelRow.innerHTML = '';

          /*
           * A dropdown rather than a list of rows. Providers return dozens of model ids —
           * the previous list was truncated to the first handful, which quietly hid the
           * rest. A select holds all of them without taking over the sheet, and does not
           * need the sheet rebuilt to show the new tick.
           */
          const current = settings.visionModel || '';
          const shown = models.includes(current) ? current : models[0];

          // The saved model can go stale — providers withdraw them. Write back what the
          // dropdown is actually showing, or the app keeps calling a model that is gone.
          if (shown !== current) V.store.settings.set({ visionModel: shown });

          modelRow.appendChild(
            V.ui.select(
              models.map((id) => ({ value: id, label: id })),
              shown,
              async (id) => {
                await V.store.settings.set({ visionModel: id });
                V.toast('Using ' + id);
              },
            ),
          );
          modelRow.appendChild(
            V.el('div', {
              className: 'hint',
              text: `${models.length} model${models.length === 1 ? '' : 's'} available. This ` +
                    'list comes from your key, so it only offers ones you can actually reach. ' +
                    'Whichever you pick is the one your account is charged for.',
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
                'backups so it cannot leak through an export. It is sent as a request header — ' +
                'never in a web address, which would put it in server logs. It goes only to ' +
                `${provider ? provider.label : 'the provider that issued it'} and nowhere else; ` +
                'Ygeia has no server of its own.' +
                (provider ? ' ' + provider.dataNote : ''),
        }),
      );
    });
  };

  /** The Settings rows. Deliberately the only entry point people need to find. */
  K.buildSettingsRows = async function () {
    const savedKey = await V.aiVision.getKey();
    const provider = savedKey ? V.aiProviders.detect(savedKey) : null;
    return [
      V.ui.row({
        title: 'AI API key',
        sub: savedKey
          ? `${provider ? provider.label : 'Unrecognised key'} — cloud coach and photo help unlocked`
          : 'Optional. Paste an API key to unlock the AI features.',
        value: savedKey ? 'On' : 'Off',
        onClick: () => K.openSheet(),
      }),
    ];
  };

  V.aiKeyView = K;
})(window.V);
