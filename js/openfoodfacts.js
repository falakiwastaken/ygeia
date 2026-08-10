/*
 * Ygeia — Open Food Facts client.
 *
 * Free, open database of ~3M packaged products. No API key, no account, no rate-limit
 * signup. Chosen over USDA FoodData Central specifically because FDC sends no CORS
 * headers and therefore cannot be called from a browser without a proxy server, which
 * would defeat the point of a dependency-free offline app.
 *
 * Every call degrades gracefully: offline or blocked, the bundled seed library still works.
 */
(function (V) {
  'use strict';

  const BASE = 'https://world.openfoodfacts.org';

  // Only ask for the fields actually used — OFF product records are enormous otherwise.
  const FIELDS = [
    'code', 'product_name', 'brands', 'nutriments', 'nova_group',
    'serving_size', 'serving_quantity', 'quantity',
  ].join(',');

  const TIMEOUT_MS = 8000;

  function fetchJson(url) {
    // OFF is a volunteer-run service; a hung request must not hang the search box.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    return fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error('Open Food Facts returned ' + r.status);
        return r.json();
      })
      .finally(() => clearTimeout(timer));
  }

  /** Read a nutriment, preferring the per-100g key OFF normalises to. */
  function n100(nutriments, key) {
    if (!nutriments) return null;
    const v = nutriments[key + '_100g'];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  /**
   * Convert an OFF product into our Food shape.
   * Returns null for records too incomplete to be useful — OFF has many stub entries with
   * a name and nothing else, and silently logging those as 0 kcal would corrupt the diary.
   */
  function toFood(p) {
    if (!p || !p.product_name) return null;
    const nut = p.nutriments || {};

    let kcal = n100(nut, 'energy-kcal');
    if (kcal == null) {
      const kj = n100(nut, 'energy');
      if (kj != null) kcal = kj / 4.184;
    }
    if (kcal == null) return null;

    const salt = n100(nut, 'salt');
    let sodium = n100(nut, 'sodium');
    // OFF stores sodium in g/100g; our canonical unit is mg. Salt converts at 1/2.5.
    if (sodium != null) sodium *= 1000;
    else if (salt != null) sodium = (salt / 2.5) * 1000;

    const servings = [];
    if (p.serving_quantity && Number(p.serving_quantity) > 0) {
      servings.push({ label: p.serving_size || 'serving', grams: Number(p.serving_quantity) });
    }

    return {
      id: 'off-' + p.code,
      name: p.product_name.trim(),
      brand: (p.brands || '').split(',')[0].trim() || undefined,
      barcode: p.code,
      source: 'off',
      novaGroup: p.nova_group ? Number(p.nova_group) : undefined,
      per100: {
        kcal,
        protein: n100(nut, 'proteins') || 0,
        carbs: n100(nut, 'carbohydrates') || 0,
        fat: n100(nut, 'fat') || 0,
        fiber: n100(nut, 'fiber'),
        sugar: n100(nut, 'sugars'),
        // OFF has no "added sugar" field. For ultra-processed products total sugar is
        // overwhelmingly added; below NOVA 4 it is left unknown rather than guessed.
        addedSugar: Number(p.nova_group) >= 4 ? n100(nut, 'sugars') : null,
        saturatedFat: n100(nut, 'saturated-fat'),
        sodium,
      },
      servings,
    };
  }

  const off = {
    available: () => typeof fetch === 'function' && navigator.onLine !== false,

    /** Look up one product by barcode. Resolves null when not found. */
    async barcode(code) {
      const clean = String(code).replace(/\D/g, '');
      if (!clean) return null;
      const data = await fetchJson(`${BASE}/api/v2/product/${clean}.json?fields=${FIELDS}`);
      if (!data || data.status !== 1) return null;
      return toFood(data.product);
    },

    /**
     * Search products by name. Results are ranked by OFF's own popularity ordering,
     * which puts widely-scanned products first — usually what the user meant.
     */
    async search(query, limit) {
      const q = String(query || '').trim();
      if (q.length < 2) return [];
      const url =
        `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
        `&search_simple=1&action=process&json=1&page_size=${limit || 20}&fields=${FIELDS}`;
      const data = await fetchJson(url);
      return (data.products || []).map(toFood).filter(Boolean);
    },
  };

  V.off = off;
})(window.V);
