/* Ygeia — Food: the day's diary, search, portions, custom foods. */
(function (V) {
  'use strict';

  V.views = V.views || {};

  const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
  const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

  /** Pick a sensible default meal from the clock, so the common case needs no thought. */
  function defaultMeal() {
    const h = new Date().getHours();
    if (h < 11) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 21) return 'dinner';
    return 'snack';
  }

  // =========================================================== portion sheet

  /**
   * Choose a portion and log it.
   * `existing` switches the sheet into edit mode, reusing the same UI.
   */
  function openPortionSheet(food, opts) {
    const o = opts || {};
    const existing = o.existing || null;

    V.ui.sheet(food.name, (body) => {
      let grams = existing ? existing.grams : (food.servings[0] ? food.servings[0].grams : 100);
      let meal = existing ? existing.meal : (o.meal || defaultMeal());

      if (food.brand) {
        body.appendChild(V.el('div', { className: 'card-sub', text: food.brand }));
      }

      const preview = V.el('div', { className: 'grid-3', style: { marginTop: '12px' } });

      function renderPreview() {
        const n = V.domain.scaleNutrients(food.per100, grams);
        preview.innerHTML = '';
        preview.appendChild(V.ui.stat({ label: 'Calories', value: V.fmt(n.kcal), unit: '' }));
        preview.appendChild(V.ui.stat({ label: 'Protein', value: V.fmt(n.protein, 1), unit: 'g' }));
        preview.appendChild(V.ui.stat({ label: 'Carbs', value: V.fmt(n.carbs, 1), unit: 'g' }));
        preview.appendChild(V.ui.stat({ label: 'Fat', value: V.fmt(n.fat, 1), unit: 'g' }));
        if (n.fiber != null) preview.appendChild(V.ui.stat({ label: 'Fiber', value: V.fmt(n.fiber, 1), unit: 'g' }));
        if (n.sodium != null) preview.appendChild(V.ui.stat({ label: 'Sodium', value: V.fmt(n.sodium), unit: 'mg' }));
      }

      const gramsInput = V.ui.input({
        type: 'number', value: String(V.round(grams, 1)), min: '0', step: '1',
        on: {
          input: () => { grams = V.ui.num(gramsInput, 0); renderPreview(); },
        },
      });

      // Named servings — one tap for "1 medium egg" instead of recalling it weighs 44 g.
      if (food.servings.length) {
        const chips = V.el('div', { className: 'chips', style: { marginBottom: '12px' } });
        for (const s of food.servings) {
          chips.appendChild(V.el('button', {
            className: 'chip', type: 'button', text: s.label,
            on: {
              click: () => {
                grams = s.grams;
                gramsInput.value = String(V.round(grams, 1));
                renderPreview();
              },
            },
          }));
        }
        body.appendChild(chips);
      }

      body.appendChild(V.ui.field('Amount (g)', gramsInput));

      const mealWrap = V.el('div');
      function renderMealChips() {
        mealWrap.innerHTML = '';
        mealWrap.appendChild(
          V.ui.segmented(
            MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m] })),
            meal,
            (v) => { meal = v; renderMealChips(); },
          ),
        );
      }
      renderMealChips();
      body.appendChild(V.ui.field('Meal', mealWrap));

      renderPreview();
      body.appendChild(preview);

      body.appendChild(V.el('div', { style: { height: '16px' } }));
      body.appendChild(
        V.ui.button(existing ? 'Save changes' : 'Add to diary', async () => {
          if (grams <= 0) return V.toast('Enter an amount');

          // A food found via Open Food Facts only exists remotely until it is logged;
          // persisting it here means the diary still resolves offline afterwards.
          if (!(await V.store.foods.get(food.id))) await V.store.foods.save(food);

          await V.store.foodLog.save({
            id: existing ? existing.id : V.uid(),
            date: V.app.state.date,
            loggedAt: existing ? existing.loggedAt : Date.now(),
            foodId: food.id,
            meal,
            grams,
          });

          V.ui.closeSheet(true);
          V.toast(existing ? 'Updated' : 'Added');
          V.app.render();
        }, 'btn-primary'),
      );

      if (existing) {
        body.appendChild(V.el('div', { style: { height: '8px' } }));
        body.appendChild(
          V.ui.button('Remove from diary', async () => {
            await V.store.foodLog.remove(existing.id);
            V.ui.closeSheet(true);
            V.toast('Removed');
            V.app.render();
          }, 'btn-danger'),
        );
      }
    });
  }

  // ============================================================ search sheet

  function openSearchSheet(meal) {
    V.ui.sheet('Add food', (body) => {
      const results = V.el('div');
      let lastQuery = '';
      let remoteFailed = false;

      const input = V.ui.input({
        type: 'search',
        placeholder: 'Search foods or paste a barcode',
        autocomplete: 'off',
      });

      const runSearch = V.debounce(async () => {
        const q = input.value.trim();
        lastQuery = q;
        if (!q) { renderResults([], []); return; }

        // Barcodes are all-digits and 8+ long — treat those as a direct lookup.
        if (/^\d{8,14}$/.test(q)) {
          renderStatus('Looking up barcode…');
          try {
            const local = await V.store.foods.byBarcode(q);
            if (local) return renderResults([local], []);
            const found = await V.off.barcode(q);
            if (q !== lastQuery) return;
            if (found) renderResults([found], []);
            else renderStatus('No product found for that barcode.');
          } catch (err) {
            renderStatus('Barcode lookup failed — you are probably offline.');
          }
          return;
        }

        const local = await V.store.foods.search(q, 25);
        if (q !== lastQuery) return;
        renderResults(local, []);

        // Remote results append after local ones, so the offline library is always
        // usable immediately and the network is pure upside.
        try {
          const remote = await V.off.search(q, 20);
          if (q !== lastQuery) return;
          const seen = new Set(local.map((f) => f.id));
          remoteFailed = false;
          renderResults(local, remote.filter((f) => !seen.has(f.id)));
        } catch (err) {
          // Open Food Facts' text search is frequently unreachable from a browser even
          // when their barcode endpoint is fine. Say so rather than showing an empty list
          // that looks like "this food does not exist".
          remoteFailed = true;
          renderResults(local, []);
        }
      }, 280);

      input.addEventListener('input', runSearch);

      function renderStatus(text) {
        results.innerHTML = '';
        results.appendChild(V.ui.empty(text));
      }

      function renderResults(local, remote) {
        results.innerHTML = '';

        if (!local.length && !remote.length) {
          results.appendChild(V.ui.empty(input.value.trim() ? 'No matches.' : 'Start typing to search.'));
        }

        if (local.length) {
          results.appendChild(V.ui.sectionTitle('Your library'));
          results.appendChild(V.ui.list(local.map(foodRow)));
        }
        if (remote.length) {
          results.appendChild(V.ui.sectionTitle('Open Food Facts'));
          results.appendChild(V.ui.list(remote.map(foodRow)));
        }

        if (remoteFailed && input.value.trim()) {
          results.appendChild(
            V.el('div', {
              className: 'hint',
              style: { marginTop: '10px' },
              text: 'Could not reach Open Food Facts, so only your own library is shown. ' +
                    'Scanning or typing a barcode still works, and you can add the food yourself below.',
            }),
          );
        }

        results.appendChild(V.el('div', { style: { height: '12px' } }));
        results.appendChild(
          V.ui.button('Create a custom food', () => openCustomFoodSheet(meal), 'btn-ghost'),
        );
      }

      function foodRow(f) {
        return V.ui.row({
          title: f.name,
          sub: [f.brand, `${V.fmt(f.per100.kcal)} kcal · P${V.fmt(f.per100.protein)} C${V.fmt(f.per100.carbs)} F${V.fmt(f.per100.fat)} per 100g`]
            .filter(Boolean).join(' · '),
          onClick: () => openPortionSheet(f, { meal }),
        });
      }

      body.appendChild(input);
      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(results);
      renderResults([], []);
      setTimeout(() => input.focus(), 60);
    });
  }

  // ========================================================== quick log sheet

  /**
   * Type a whole meal in one line and log it.
   *
   * Everything parsed stays editable before anything is written — a wrong match or a
   * guessed portion is a tap away from being corrected, and guesses are visibly marked
   * so they get looked at rather than silently accepted.
   */
  function openQuickLogSheet(meal) {
    V.ui.sheet('Quick log', (body) => {
      let rows = [];
      let slot = meal || defaultMeal();

      const input = V.el('textarea', {
        rows: 3,
        placeholder: '200g chicken breast, 2 eggs and a banana',
      });
      const preview = V.el('div');
      const totals = V.el('div', { className: 'hint' });

      const rerender = () => {
        preview.innerHTML = '';

        if (!rows.length) {
          totals.textContent = '';
          return;
        }

        preview.appendChild(V.ui.sectionTitle('Parsed'));
        preview.appendChild(
          V.ui.list(
            rows.map((row, i) => {
              if (!row.matched) {
                return V.ui.row({
                  title: row.item.name,
                  sub: 'No match in your library — tap to search',
                  value: '?',
                  onClick: () => {
                    V.ui.closeSheet();
                    openSearchSheet(slot);
                  },
                });
              }

              const nutrients = V.domain.scaleNutrients(row.food.per100, row.grams);
              const gramsInput = V.ui.input({
                type: 'number',
                value: String(V.round(row.grams, 1)),
                style: { width: '84px', textAlign: 'right', padding: '6px 8px' },
              });
              gramsInput.addEventListener('input', () => {
                rows[i].grams = V.ui.num(gramsInput, 0);
                updateTotals();
              });
              gramsInput.addEventListener('click', (e) => e.stopPropagation());

              return V.ui.row({
                title: row.food.name,
                sub: (row.confident ? row.basis : '⚠ ' + row.basis) +
                     ' · ' + V.fmt(nutrients.kcal) + ' kcal',
                accessory: V.el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
                  gramsInput,
                  V.el('span', { className: 'row-sub', text: 'g' }),
                ]),
                // Tapping the row cycles to the next candidate, so a wrong match is one tap
                // to fix rather than a trip back to search.
                onClick: row.candidates.length > 1
                  ? () => {
                      const next = (row.candidates.indexOf(row.food) + 1) % row.candidates.length;
                      rows[i].food = row.candidates[next];
                      const portion = V.foodParser.toGrams(row.item, rows[i].food);
                      rows[i].grams = V.round(portion.grams, 1);
                      rows[i].basis = portion.basis;
                      rows[i].confident = portion.confident;
                      rerender();
                    }
                  : null,
              });
            }),
          ),
        );

        if (rows.some((r) => r.matched && r.candidates.length > 1)) {
          preview.appendChild(
            V.el('div', { className: 'hint', text: 'Wrong food? Tap the row to cycle through the other matches.' }),
          );
        }
        updateTotals();
      };

      function updateTotals() {
        const matched = rows.filter((r) => r.matched);
        const sum = V.domain.sumNutrients(
          matched.map((r) => V.domain.scaleNutrients(r.food.per100, r.grams)),
        );
        const unmatched = rows.length - matched.length;
        totals.textContent =
          `${matched.length} item(s) · ${V.fmt(sum.kcal)} kcal · ${V.fmt(sum.protein)}g protein` +
          (unmatched ? ` · ${unmatched} not matched` : '');
      }

      const runParse = V.debounce(async () => {
        const text = input.value.trim();
        if (!text) { rows = []; rerender(); return; }
        rows = await V.foodParser.parseAndResolve(text);
        rerender();
      }, 300);

      input.addEventListener('input', runParse);

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Write it how you would say it. Weights, counts and portions all work.',
        }),
      );
      body.appendChild(input);

      const slotWrap = V.el('div');
      const renderSlot = () => {
        slotWrap.innerHTML = '';
        slotWrap.appendChild(
          V.ui.segmented(
            MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m] })),
            slot,
            (v) => { slot = v; renderSlot(); },
          ),
        );
      };
      renderSlot();
      body.appendChild(V.el('div', { style: { height: '10px' } }));
      body.appendChild(V.ui.field('Meal', slotWrap));

      body.appendChild(preview);
      body.appendChild(totals);
      body.appendChild(V.el('div', { style: { height: '14px' } }));

      body.appendChild(
        V.ui.button('Log everything', async () => {
          const matched = rows.filter((r) => r.matched && r.grams > 0);
          if (!matched.length) return V.toast('Nothing to log yet');

          const now = Date.now();
          for (const row of matched) {
            if (!(await V.store.foods.get(row.food.id))) await V.store.foods.save(row.food);
            await V.store.foodLog.save({
              id: V.uid(),
              date: V.app.state.date,
              loggedAt: now,
              foodId: row.food.id,
              meal: slot,
              grams: row.grams,
            });
          }

          V.ui.closeSheet(true);
          V.toast(`Logged ${matched.length} item(s)`);
          V.app.render();
        }, 'btn-primary'),
      );

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Parsed on your device with no model and no network — instant, and it works ' +
                'in airplane mode.',
        }),
      );

      setTimeout(() => input.focus(), 60);
    });
  }

  // ======================================================= custom food sheet

  function openCustomFoodSheet(meal) {
    V.ui.sheet('Custom food', (body) => {
      const f = {
        name: V.ui.input({ placeholder: 'Name' }),
        brand: V.ui.input({ placeholder: 'Optional' }),
        kcal: V.ui.input({ type: 'number', placeholder: '0' }),
        protein: V.ui.input({ type: 'number', placeholder: '0' }),
        carbs: V.ui.input({ type: 'number', placeholder: '0' }),
        fat: V.ui.input({ type: 'number', placeholder: '0' }),
        fiber: V.ui.input({ type: 'number', placeholder: 'Optional' }),
        serving: V.ui.input({ type: 'number', placeholder: 'Optional' }),
      };

      body.appendChild(V.ui.field('Name', f.name));
      body.appendChild(V.ui.field('Brand', f.brand));
      body.appendChild(V.ui.sectionTitle('Per 100 g'));
      body.appendChild(V.el('div', { className: 'grid-2' }, [
        V.ui.field('Calories', f.kcal),
        V.ui.field('Protein (g)', f.protein),
        V.ui.field('Carbs (g)', f.carbs),
        V.ui.field('Fat (g)', f.fat),
        V.ui.field('Fiber (g)', f.fiber),
        V.ui.field('One serving (g)', f.serving),
      ]));

      const mismatch = V.el('div', { className: 'warn-box', hidden: true });
      body.appendChild(mismatch);

      // Cross-check declared calories against the macros. Off-by-10x typos in a custom
      // food silently poison every future day it appears in, so it's worth catching.
      function checkConsistency() {
        const stated = V.ui.num(f.kcal, 0);
        const implied = V.domain.kcalFromMacros({
          protein: V.ui.num(f.protein, 0), carbs: V.ui.num(f.carbs, 0), fat: V.ui.num(f.fat, 0),
        });
        const off = stated > 0 && Math.abs(stated - implied) / stated > 0.25;
        mismatch.hidden = !off;
        if (off) {
          mismatch.textContent =
            `Macros work out to about ${V.fmt(implied)} kcal but you entered ${V.fmt(stated)}. ` +
            'Worth double-checking — one of them is probably a typo.';
        }
      }
      for (const k of ['kcal', 'protein', 'carbs', 'fat']) f[k].addEventListener('input', checkConsistency);

      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(
        V.ui.button('Save food', async () => {
          const name = f.name.value.trim();
          if (!name) return V.toast('Give it a name');

          const servingG = V.ui.num(f.serving, 0);
          const food = {
            id: V.uid(),
            name,
            brand: f.brand.value.trim() || undefined,
            source: 'custom',
            // Home-cooked food is genuinely minimally processed; assuming otherwise would
            // unfairly drag down the whole-food component of the score.
            novaGroup: 1,
            per100: {
              kcal: V.ui.num(f.kcal, 0),
              protein: V.ui.num(f.protein, 0),
              carbs: V.ui.num(f.carbs, 0),
              fat: V.ui.num(f.fat, 0),
              fiber: f.fiber.value.trim() ? V.ui.num(f.fiber, 0) : null,
              addedSugar: 0,
            },
            servings: servingG > 0 ? [{ label: '1 serving', grams: servingG }] : [],
          };

          await V.store.foods.save(food);
          V.ui.closeSheet();
          openPortionSheet(food, { meal });
        }, 'btn-primary'),
      );
    });
  }

  // ==================================================================== view

  V.views.food = {
    async render(state) {
      const settings = await V.store.settings.get();
      const targets = V.domain.macroTargets(settings);
      const entries = await V.store.foodLog.resolved(state.date);
      const totals = V.domain.sumNutrients(entries.map((e) => e.nutrients));
      const scored = V.domain.nutritionScore(entries, targets, settings);

      const root = V.el('div');

      // ---- Summary ---------------------------------------------------------
      root.appendChild(
        V.ui.card({
          children: [
            V.el('div', { className: 'grid-2' }, [
              V.ui.stat({
                label: 'Calories',
                value: V.fmt(totals.kcal || 0),
                unit: ` / ${V.fmt(targets.kcal)}`,
              }),
              V.ui.stat({
                label: 'Quality score',
                value: scored.score != null ? String(scored.score) : '–',
                unit: scored.score != null ? '/100' : '',
              }),
            ]),
            V.el('div', { style: { height: '12px' } }),
            V.ui.macroBar('Protein', totals.protein || 0, targets.protein, 'var(--protein)'),
            V.ui.macroBar('Carbs', totals.carbs || 0, targets.carbs, 'var(--carbs)'),
            V.ui.macroBar('Fat', totals.fat || 0, targets.fat, 'var(--fat)'),
          ],
        }),
      );

      if (scored.isLateMeal) {
        root.appendChild(
          V.el('div', { className: 'warn-box' }, [
            document.createTextNode(
              `${V.fmt(scored.lateKcal)} kcal logged after ${settings.lateMealHour}:00. ` +
              `Entries under ${settings.lateMealMinKcal} kcal don't count as a late meal.`,
            ),
          ]),
        );
      }

      // ---- Meals ------------------------------------------------------------
      const byMeal = V.groupBy(entries, 'meal');

      for (const meal of MEALS) {
        const list = (byMeal[meal] || []).slice();
        const mealKcal = V.sum(list, (e) => e.nutrients.kcal || 0);

        root.appendChild(
          V.el('div', { className: 'card-head', style: { marginTop: '20px', marginBottom: '8px' } }, [
            V.el('div', {}, [
              V.el('h3', { className: 'card-title', text: MEAL_LABEL[meal] }),
              V.el('div', { className: 'card-sub', text: list.length ? V.fmt(mealKcal) + ' kcal' : 'Nothing yet' }),
            ]),
            V.el('button', {
              className: 'icon-btn', type: 'button', text: '+',
              'aria-label': 'Add to ' + MEAL_LABEL[meal],
              on: { click: () => openSearchSheet(meal) },
            }),
          ]),
        );

        if (list.length) {
          root.appendChild(
            V.ui.list(
              list.map((e) =>
                V.ui.row({
                  title: e.food.name,
                  sub: `${V.fmt(e.grams)} g · ${V.timeOfDay(e.loggedAt)}`,
                  value: V.fmt(e.nutrients.kcal) + ' kcal',
                  onClick: () => openPortionSheet(e.food, { existing: e }),
                }),
              ),
            ),
          );
        }
      }

      root.appendChild(V.el('div', { style: { height: '16px' } }));
      root.appendChild(V.ui.button('Add food', () => openSearchSheet(defaultMeal()), 'btn-primary'));
      root.appendChild(V.el('div', { style: { height: '8px' } }));
      root.appendChild(V.ui.button('Quick log — type a whole meal', () => openQuickLogSheet(defaultMeal()), 'btn-ghost'));
      root.appendChild(V.el('div', { style: { height: '8px' } }));
      root.appendChild(V.ui.button('Meal ideas & shopping list', () => V.planView.openMealPlannerSheet(), 'btn-ghost'));
      root.appendChild(V.el('div', { style: { height: '8px' } }));
      root.appendChild(V.ui.button('Find somewhere to eat', () => V.places.openPlacesSheet(), 'btn-ghost'));

      // ---- Score breakdown --------------------------------------------------
      if (scored.score != null && scored.components.length) {
        root.appendChild(V.ui.sectionTitle('Score breakdown'));
        root.appendChild(
          V.ui.list(
            scored.components.map((c) =>
              V.ui.row({
                title: c.label,
                sub: c.detail,
                value: V.fmt(c.value) + '/100',
              }),
            ),
          ),
        );
        root.appendChild(
          V.el('div', {
            className: 'hint',
            text: 'Components without data are excluded and the rest reweighted, so missing ' +
                  'micronutrient info never counts against you.',
          }),
        );
      }

      return root;
    },
  };
})(window.V);
