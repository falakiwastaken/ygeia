/*
 * Ygeia — free-text food parsing.
 *
 * Turns "200g chicken breast, 2 eggs and a banana" into diary entries.
 *
 * Deliberately NOT a language model. This is a bounded problem — numbers, units and a
 * lookup against a known food library — and a purpose-built parser beats a small on-device
 * model at it on every axis that matters: it is instant, works offline, needs no download,
 * and is deterministic enough to unit-test. A 1B model would be slower, ~700 MB, and would
 * occasionally invent a quantity.
 *
 * Pure functions except `resolve`, which reads the food library.
 */
(function (V) {
  'use strict';

  const P = {};

  // =========================================================================
  // Vocabulary
  // =========================================================================

  const NUMBER_WORDS = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
    half: 0.5, quarter: 0.25, couple: 2, few: 3, several: 3,
  };

  /** Mass and volume units, expressed in grams (volume assumes water-like density). */
  const UNITS = {
    g: 1, gram: 1, grams: 1, gramme: 1, grammes: 1,
    kg: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000,
    mg: 0.001,
    oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
    lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
    ml: 1, millilitre: 1, milliliter: 1, millilitres: 1, milliliters: 1,
    l: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000,
    cl: 10,
  };

  /**
   * Units that only mean something relative to the food itself — a "slice" of bread and a
   * "slice" of cake weigh different amounts. These are resolved against the food's own
   * named servings, and fall back to a rough default only when there is nothing better.
   */
  const SERVING_UNITS = {
    slice: 'slice', slices: 'slice',
    piece: 'piece', pieces: 'piece',
    scoop: 'scoop', scoops: 'scoop',
    cup: 'cup', cups: 'cup',
    tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
    tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
    handful: 'handful', handfuls: 'handful',
    glass: 'glass', glasses: 'glass',
    bowl: 'bowl', bowls: 'bowl',
    can: 'can', cans: 'can', tin: 'can', tins: 'can',
    bottle: 'bottle', bottles: 'bottle',
    packet: 'packet', packets: 'packet', pack: 'packet',
    serving: 'serving', servings: 'serving', portion: 'serving', portions: 'serving',
    bar: 'bar', bars: 'bar',
    egg: 'egg', eggs: 'egg',
    square: 'square', squares: 'square',
    rasher: 'rasher', rashers: 'rasher',
    fillet: 'fillet', fillets: 'fillet',
    breast: 'breast', breasts: 'breast',
  };

  /** Rough fallbacks when a food has no matching named serving. Grams. */
  const SERVING_FALLBACK = {
    cup: 240, tbsp: 15, tsp: 5, glass: 250, bowl: 300, can: 330, bottle: 500,
    handful: 30, scoop: 30, slice: 30, piece: 50, serving: 100, packet: 50,
    bar: 50, square: 10, rasher: 12, fillet: 140, breast: 170, egg: 50,
  };

  /** Words that carry no meaning for matching and would only pollute the food name. */
  const NOISE = new Set([
    'of', 'some', 'the', 'a', 'an', 'with', 'and', 'plus', 'my', 'i', 'ate', 'had',
    'having', 'eaten', 'for', 'breakfast', 'lunch', 'dinner', 'snack', 'today',
    'about', 'approx', 'approximately', 'roughly', 'around', 'like', 'just',
    // Size adjectives describe the portion, not the food. Without these, "large coffee"
    // fails to match "Coffee, black" because "large" is nowhere in the name.
    'large', 'small', 'medium', 'big', 'regular', 'extra', 'tall', 'grande', 'venti',
  ]);

  // =========================================================================
  // Tokenising
  // =========================================================================

  /** Split a sentence into individual food phrases. */
  P.splitItems = function (text) {
    return String(text || '')
      .replace(/\band\b/gi, ',')
      .replace(/\bwith\b/gi, ',')
      .replace(/\bplus\b/gi, ',')
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  };

  /** "1/2" and "1 1/2" and "½" all become numbers. */
  function parseNumber(token) {
    if (token == null) return null;
    const t = String(token).trim().toLowerCase();

    if (NUMBER_WORDS[t] != null) return NUMBER_WORDS[t];

    const vulgar = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
    if (vulgar[t] != null) return vulgar[t];

    const mixed = /^(\d+)\s*(½|¼|¾)$/.exec(t);
    if (mixed) return Number(mixed[1]) + vulgar[mixed[2]];

    const fraction = /^(\d+)\/(\d+)$/.exec(t);
    if (fraction) return Number(fraction[1]) / Number(fraction[2]);

    const plain = /^\d+(?:\.\d+)?$/.exec(t);
    if (plain) return Number(t);

    return null;
  }

  P.parseNumber = parseNumber;

  /**
   * Parse one phrase into quantity, unit and food name.
   *
   * Handles both orders, because people write both:
   *   "200g chicken breast"   quantity first
   *   "chicken breast 200g"   quantity last
   */
  P.parseItem = function (phrase) {
    const raw = String(phrase || '').trim();
    if (!raw) return null;

    // Normalise "200g" into "200 g" so a single tokenizer handles both spellings.
    let text = raw
      .toLowerCase()
      .replace(/(\d)\s*([a-z]+)/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();

    const tokens = text.split(' ');
    let qty = null;
    let unit = null;
    const nameTokens = [];

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i].replace(/[^\w/½¼¾⅓⅔.]/g, '');
      if (!tok) continue;

      const asNumber = parseNumber(tok);
      // A bare number only counts as a quantity the first time — "chicken 2 eggs" is
      // two items badly written, not a quantity of 2 for chicken.
      if (asNumber != null && qty == null) {
        qty = asNumber;
        continue;
      }

      if (UNITS[tok] != null && unit == null && qty != null) { unit = tok; continue; }

      if (SERVING_UNITS[tok] && unit == null) {
        // A serving word normally needs a number in front of it ("2 slices"). The one
        // exception is when it is followed by "of" — "handful of almonds" clearly means
        // one handful, and without this the word ends up in the food name and matches
        // nothing. Requiring "of" keeps "chicken breast" intact, since "breast" is also
        // in the serving list.
        const followedByOf = (tokens[i + 1] || '').replace(/[^\w]/g, '') === 'of';
        if (qty != null || followedByOf) {
          unit = tok;
          if (qty == null) qty = 1;
          continue;
        }
      }

      if (!NOISE.has(tok)) nameTokens.push(tok);
    }

    // "egg" and "banana" are both a unit-ish noun and the food itself. If stripping the
    // unit left nothing behind, it was the food.
    if (!nameTokens.length && unit && SERVING_UNITS[unit]) {
      nameTokens.push(unit);
      unit = null;
    }

    const name = nameTokens.join(' ').trim();
    if (!name) return null;

    return {
      raw,
      qty: qty == null ? 1 : qty,
      hadExplicitQty: qty != null,
      unit,
      name,
    };
  };

  P.parse = function (text) {
    return P.splitItems(text).map(P.parseItem).filter(Boolean);
  };

  // =========================================================================
  // Resolving to grams
  // =========================================================================

  /**
   * Work out how many grams an item means for a specific food.
   * Returns the grams plus how it was decided, so the UI can flag guesses.
   */
  P.toGrams = function (item, food) {
    const qty = item.qty == null ? 1 : item.qty;

    // 1. An explicit weight or volume is unambiguous.
    if (item.unit && UNITS[item.unit] != null) {
      return { grams: qty * UNITS[item.unit], basis: 'measured', confident: true };
    }

    const servings = (food && food.servings) || [];

    // 2. A named unit — match it against the food's own servings first, since a slice of
    //    bread and a slice of cake are not the same weight.
    if (item.unit && SERVING_UNITS[item.unit]) {
      const key = SERVING_UNITS[item.unit];
      const match = servings.find((s) => s.label.toLowerCase().includes(key));
      if (match) return { grams: qty * match.grams, basis: match.label, confident: true };

      const fallback = SERVING_FALLBACK[key];
      if (fallback) return { grams: qty * fallback, basis: key + ' (approx)', confident: false };
    }

    // 3. A bare count with no unit — "2 bananas". Use the food's first named serving,
    //    which for whole foods is the natural single item.
    if (item.hadExplicitQty && servings.length) {
      return { grams: qty * servings[0].grams, basis: servings[0].label, confident: true };
    }

    // 4. Nothing to go on. 100 g is the conventional reference portion, and the UI shows
    //    this as a guess so it gets corrected rather than silently logged.
    if (item.hadExplicitQty) {
      return { grams: qty * 100, basis: '100 g each (guess)', confident: false };
    }
    if (servings.length) {
      return { grams: servings[0].grams, basis: servings[0].label, confident: true };
    }
    return { grams: 100, basis: '100 g (guess)', confident: false };
  };

  /**
   * Match parsed items against the food library.
   * Returns candidates so the UI can offer a correction rather than forcing the top hit.
   */
  P.resolve = async function (items) {
    const out = [];
    for (const item of items) {
      const candidates = await V.store.foods.search(item.name, 5);
      const food = candidates[0] || null;
      const portion = food ? P.toGrams(item, food) : null;

      out.push({
        item,
        food,
        candidates,
        grams: portion ? V.round(portion.grams, 1) : null,
        basis: portion ? portion.basis : null,
        confident: portion ? portion.confident : false,
        matched: !!food,
      });
    }
    return out;
  };

  /** Convenience: text straight to resolved rows. */
  P.parseAndResolve = async function (text) {
    return P.resolve(P.parse(text));
  };

  P.UNITS = UNITS;
  P.SERVING_UNITS = SERVING_UNITS;
  P.NUMBER_WORDS = NUMBER_WORDS;
  V.foodParser = P;
})(window.V);
