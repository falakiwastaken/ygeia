/*
 * Ygeia — choosing which features to use.
 *
 * One list, two places: the first-run wizard and Settings. They share this builder so the
 * wording and the switches cannot drift apart, and so turning something off later is the
 * same act as never turning it on.
 */
(function (V) {
  'use strict';

  /**
   * Build the list of switches.
   *
   * @param {object} draft     mutable map of key -> bool, edited in place
   * @param {Function} [onChange] called after any switch moves
   * @param {object} [opts]
   * @param {boolean} [opts.hideKeyed] leave out anything needing an API key. Set on first
   *   run: those features cannot work until the user brings a key from elsewhere, and
   *   first launch is the wrong moment to raise it. They stay available in Settings.
   * @returns {Element}
   */
  function buildList(draft, onChange, opts) {
    const hideKeyed = !!(opts && opts.hideKeyed);

    const visible = V.features.FEATURES
      .filter((f) => !f.essential)
      .filter((f) => !(hideKeyed && f.needsKey));

    const rows = visible.map((f) => {
      const toggle = V.ui.toggle(!!draft[f.key], (on) => {
        draft[f.key] = on;
        if (onChange) onChange(f.key, on);
      }, f.label);

      return V.el('div', { className: 'row feature-row' }, [
        V.el('div', { className: 'row-main' }, [
          V.el('div', { className: 'row-title', text: f.label }),
          V.el('div', { className: 'feature-blurb', text: f.blurb }),
        ]),
        toggle,
      ]);
    });

    return V.el('div', { className: 'list' }, rows);
  }

  /** The Settings sheet. Saves on every flip — there is no Save button to forget. */
  function openSheet() {
    V.ui.sheet('Features', async (body) => {
      const settings = await V.store.settings.get();
      const draft = V.features.normalise(settings.features);

      body.appendChild(
        V.el('div', {
          className: 'hint',
          style: { marginTop: '0' },
          text: 'Turn off anything you do not use and it disappears from the app. ' +
                'Nothing is deleted — switch it back on and your history is still there.',
        }),
      );

      body.appendChild(buildList(draft, async () => {
        await V.store.settings.set({ features: V.features.normalise(draft) });
        // Re-render behind the sheet so tabs appear and disappear immediately.
        V.app.applyFeatures();
        V.app.render();
      }));

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Features that carry their own data — the food library, the exercise ' +
                'library, maps, the question bank — are also left out of the offline ' +
                'cache while they are off, so they are not downloaded to your device.',
        }),
      );
    });
  }

  V.featuresView = { buildList, openSheet };
})(window.V);
