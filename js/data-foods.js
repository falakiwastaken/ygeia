/*
 * Ygeia — bundled offline food seed.
 *
 * ~130 staples so the app is useful the moment it opens, with no network and no account.
 * Open Food Facts covers packaged/branded products; this covers the whole foods that
 * make up most of what people actually cook, which OFF is weakest at.
 *
 * Values are per 100 g edible portion, from public reference data (USDA SR Legacy /
 * FoodData Central Foundation Foods). They are reference figures, not lab analyses of
 * any specific item — real foods vary, and that is expected.
 *
 * Compact tuple format keeps the file small:
 *   [name, kcal, protein, carbs, fat, fiber, sugar, satFat, sodium_mg, nova, servings]
 * A null nutrient means "unknown" and is excluded from scoring, not treated as zero.
 */
(function (V) {
  'use strict';

  const F = [
    // ---- Poultry, meat, fish -------------------------------------------------
    ['Chicken breast, skinless, raw', 120, 22.5, 0, 2.6, 0, 0, 0.7, 45, 1, [['breast', 174], ['100 g', 100]]],
    ['Chicken breast, cooked', 165, 31, 0, 3.6, 0, 0, 1, 74, 1, [['breast', 172]]],
    ['Chicken thigh, skinless, cooked', 209, 26, 0, 10.9, 0, 0, 3, 88, 1, [['thigh', 111]]],
    ['Turkey breast, cooked', 147, 30, 0, 2, 0, 0, 0.6, 60, 1, [['slice', 28]]],
    ['Beef mince, 5% fat, cooked', 174, 27, 0, 6.8, 0, 0, 3, 70, 1, []],
    ['Beef mince, 20% fat, cooked', 254, 26, 0, 16, 0, 0, 6.2, 78, 1, []],
    ['Beef steak, sirloin, cooked', 212, 30, 0, 9.6, 0, 0, 3.7, 55, 1, [['steak', 200]]],
    ['Pork loin, cooked', 209, 29, 0, 9.5, 0, 0, 3.4, 60, 1, [['chop', 150]]],
    ['Bacon, cooked', 541, 37, 1.4, 42, 0, 0, 14, 1717, 4, [['rasher', 12]]],
    ['Lamb, cooked', 258, 25, 0, 17, 0, 0, 7.5, 72, 1, []],
    ['Salmon, raw', 208, 20, 0, 13, 0, 0, 3.1, 59, 1, [['fillet', 150]]],
    ['Salmon, cooked', 232, 25, 0, 14, 0, 0, 3.2, 61, 1, [['fillet', 130]]],
    ['Tuna, canned in water, drained', 116, 26, 0, 0.8, 0, 0, 0.2, 320, 3, [['can', 142]]],
    ['Cod, cooked', 105, 23, 0, 0.9, 0, 0, 0.2, 78, 1, [['fillet', 150]]],
    ['Prawns, cooked', 99, 24, 0.2, 0.3, 0, 0, 0.1, 111, 1, []],
    ['Sardines, canned in oil', 208, 25, 0, 11, 0, 0, 1.5, 307, 3, [['tin', 92]]],
    ['Mackerel, cooked', 262, 24, 0, 18, 0, 0, 4.2, 83, 1, [['fillet', 88]]],

    // ---- Eggs and dairy ------------------------------------------------------
    ['Egg, whole, raw', 143, 12.6, 0.7, 9.5, 0, 0.4, 3.1, 142, 1, [['large egg', 50], ['medium egg', 44]]],
    ['Egg white', 52, 10.9, 0.7, 0.2, 0, 0.7, 0, 166, 1, [['white', 33]]],
    ['Milk, whole', 61, 3.2, 4.8, 3.3, 0, 5.1, 1.9, 43, 1, [['glass 250 ml', 258]]],
    ['Milk, semi-skimmed', 50, 3.4, 4.9, 1.8, 0, 5, 1.1, 44, 1, [['glass 250 ml', 258]]],
    ['Milk, skimmed', 34, 3.4, 5, 0.1, 0, 5.1, 0.1, 42, 1, [['glass 250 ml', 255]]],
    ['Greek yoghurt, 0% fat', 59, 10.3, 3.6, 0.4, 0, 3.2, 0.1, 36, 1, [['pot 170 g', 170]]],
    ['Greek yoghurt, full fat', 97, 9, 3.9, 5, 0, 4, 3.2, 35, 1, [['pot 170 g', 170]]],
    ['Natural yoghurt', 61, 3.5, 4.7, 3.3, 0, 4.7, 2.1, 46, 1, [['pot 150 g', 150]]],
    ['Cottage cheese', 98, 11, 3.4, 4.3, 0, 2.7, 1.7, 364, 3, [['pot 200 g', 200]]],
    ['Cheddar cheese', 403, 25, 1.3, 33, 0, 0.5, 19, 621, 3, [['slice', 28]]],
    ['Mozzarella', 280, 22, 2.2, 20, 0, 1, 12, 627, 3, [['ball', 125]]],
    ['Parmesan', 392, 36, 3.2, 25, 0, 0.8, 16, 1529, 3, [['tbsp grated', 5]]],
    ['Feta', 264, 14, 4.1, 21, 0, 4.1, 15, 917, 3, [['portion', 30]]],
    ['Butter', 717, 0.9, 0.1, 81, 0, 0.1, 51, 11, 2, [['tsp', 5], ['tbsp', 14]]],
    ['Cream cheese', 342, 6, 5.5, 34, 0, 3.8, 19, 314, 3, [['tbsp', 15]]],

    // ---- Grains and starches -------------------------------------------------
    ['Oats, rolled, dry', 379, 13.2, 67.7, 6.5, 10.1, 1, 1.1, 6, 1, [['40 g serving', 40], ['cup', 81]]],
    ['Rice, white, cooked', 130, 2.7, 28, 0.3, 0.4, 0.1, 0.1, 1, 1, [['cup', 158]]],
    ['Rice, brown, cooked', 123, 2.7, 26, 1, 1.6, 0.4, 0.2, 4, 1, [['cup', 195]]],
    ['Pasta, cooked', 158, 5.8, 31, 0.9, 1.8, 0.6, 0.2, 1, 3, [['cup', 140]]],
    ['Wholewheat pasta, cooked', 149, 6, 30, 1.4, 4.5, 1, 0.3, 4, 3, [['cup', 140]]],
    ['Bread, white', 265, 9, 49, 3.2, 2.7, 5, 0.7, 491, 4, [['slice', 36]]],
    ['Bread, wholemeal', 252, 12, 43, 3.5, 6, 4.4, 0.8, 455, 4, [['slice', 36]]],
    ['Sourdough bread', 289, 12, 56, 1.8, 2.4, 2.5, 0.4, 552, 3, [['slice', 50]]],
    ['Potato, boiled', 87, 2, 20, 0.1, 1.8, 0.9, 0, 4, 1, [['medium', 173]]],
    ['Potato, baked with skin', 93, 2.5, 21, 0.1, 2.2, 1.2, 0, 10, 1, [['medium', 173]]],
    ['Sweet potato, baked', 90, 2, 21, 0.1, 3.3, 6.5, 0, 36, 1, [['medium', 151]]],
    ['Quinoa, cooked', 120, 4.4, 21, 1.9, 2.8, 0.9, 0.2, 7, 1, [['cup', 185]]],
    ['Couscous, cooked', 112, 3.8, 23, 0.2, 1.4, 0.1, 0, 5, 3, [['cup', 157]]],
    ['Tortilla wrap, flour', 306, 8, 51, 7.5, 3, 2.4, 1.9, 616, 4, [['wrap', 49]]],
    ['Bagel, plain', 250, 10, 49, 1.5, 2.1, 5.4, 0.2, 439, 4, [['bagel', 98]]],
    ['Cornflakes', 357, 7.5, 84, 0.4, 3, 8, 0.1, 729, 4, [['30 g bowl', 30]]],
    ['Granola', 471, 10, 64, 20, 7, 22, 3, 30, 4, [['50 g serving', 50]]],
    ['Weetabix', 362, 12, 69, 2, 10, 4.4, 0.5, 275, 4, [['biscuit', 19]]],
    ['Rice cakes', 387, 8, 82, 2.8, 4, 0.7, 0.6, 30, 3, [['cake', 9]]],
    ['Noodles, egg, cooked', 138, 4.5, 25, 2.1, 1.2, 0.4, 0.4, 5, 3, [['portion', 150]]],

    // ---- Legumes, nuts, seeds ------------------------------------------------
    ['Lentils, cooked', 116, 9, 20, 0.4, 7.9, 1.8, 0.1, 2, 1, [['cup', 198]]],
    ['Chickpeas, cooked', 164, 8.9, 27, 2.6, 7.6, 4.8, 0.3, 7, 1, [['cup', 164]]],
    ['Black beans, cooked', 132, 8.9, 24, 0.5, 8.7, 0.3, 0.1, 2, 1, [['cup', 172]]],
    ['Kidney beans, cooked', 127, 8.7, 23, 0.5, 6.4, 0.3, 0.1, 2, 1, [['cup', 177]]],
    ['Baked beans in tomato sauce', 94, 4.8, 15, 0.6, 3.7, 5.2, 0.1, 388, 4, [['half tin', 200]]],
    ['Peanut butter', 588, 25, 20, 50, 6, 9, 10, 429, 3, [['tbsp', 16]]],
    ['Peanuts', 567, 26, 16, 49, 8.5, 4.7, 6.3, 18, 1, [['handful 30 g', 30]]],
    ['Almonds', 579, 21, 22, 50, 12.5, 4.4, 3.8, 1, 1, [['handful 30 g', 30], ['almond', 1.2]]],
    ['Walnuts', 654, 15, 14, 65, 6.7, 2.6, 6.1, 2, 1, [['handful 30 g', 30]]],
    ['Cashews', 553, 18, 30, 44, 3.3, 5.9, 7.8, 12, 1, [['handful 30 g', 30]]],
    ['Chia seeds', 486, 17, 42, 31, 34, 0, 3.3, 16, 1, [['tbsp', 12]]],
    ['Flaxseed, ground', 534, 18, 29, 42, 27, 1.6, 3.7, 30, 1, [['tbsp', 7]]],
    ['Pumpkin seeds', 559, 30, 11, 49, 6, 1.4, 8.7, 7, 1, [['30 g', 30]]],
    ['Tofu, firm', 144, 17, 2.8, 8.7, 2.3, 0.6, 1.3, 14, 3, [['block', 350]]],
    ['Tempeh', 192, 20, 7.6, 11, 0, 0, 2.2, 9, 3, [['100 g', 100]]],
    ['Hummus', 166, 7.9, 14, 9.6, 6, 0.3, 1.4, 379, 3, [['tbsp', 15]]],

    // ---- Vegetables ----------------------------------------------------------
    ['Broccoli, raw', 34, 2.8, 6.6, 0.4, 2.6, 1.7, 0, 33, 1, [['cup', 91]]],
    ['Broccoli, steamed', 35, 2.4, 7.2, 0.4, 3.3, 1.4, 0, 41, 1, [['cup', 156]]],
    ['Spinach, raw', 23, 2.9, 3.6, 0.4, 2.2, 0.4, 0.1, 79, 1, [['cup', 30], ['handful', 25]]],
    ['Kale, raw', 49, 4.3, 8.8, 0.9, 3.6, 2.3, 0.1, 38, 1, [['cup', 67]]],
    ['Carrot, raw', 41, 0.9, 9.6, 0.2, 2.8, 4.7, 0, 69, 1, [['medium', 61]]],
    ['Tomato', 18, 0.9, 3.9, 0.2, 1.2, 2.6, 0, 5, 1, [['medium', 123]]],
    ['Cucumber', 15, 0.7, 3.6, 0.1, 0.5, 1.7, 0, 2, 1, [['medium', 301]]],
    ['Bell pepper, red', 31, 1, 6, 0.3, 2.1, 4.2, 0, 4, 1, [['medium', 119]]],
    ['Onion', 40, 1.1, 9.3, 0.1, 1.7, 4.2, 0, 4, 1, [['medium', 110]]],
    ['Courgette', 17, 1.2, 3.1, 0.3, 1, 2.5, 0.1, 8, 1, [['medium', 196]]],
    ['Aubergine', 25, 1, 5.9, 0.2, 3, 3.5, 0, 2, 1, [['medium', 458]]],
    ['Mushrooms', 22, 3.1, 3.3, 0.3, 1, 2, 0, 5, 1, [['cup sliced', 70]]],
    ['Cauliflower', 25, 1.9, 5, 0.3, 2, 1.9, 0.1, 30, 1, [['cup', 107]]],
    ['Green beans', 31, 1.8, 7, 0.2, 2.7, 3.3, 0, 6, 1, [['cup', 100]]],
    ['Peas, frozen', 77, 5.2, 14, 0.4, 5.1, 5.7, 0.1, 72, 1, [['cup', 134]]],
    ['Sweetcorn', 86, 3.3, 19, 1.4, 2, 3.2, 0.2, 15, 1, [['cup', 145]]],
    ['Asparagus', 20, 2.2, 3.9, 0.1, 2.1, 1.9, 0, 2, 1, [['spear', 16]]],
    ['Brussels sprouts', 43, 3.4, 9, 0.3, 3.8, 2.2, 0.1, 25, 1, [['cup', 88]]],
    ['Cabbage', 25, 1.3, 5.8, 0.1, 2.5, 3.2, 0, 18, 1, [['cup', 89]]],
    ['Lettuce, romaine', 17, 1.2, 3.3, 0.3, 2.1, 1.2, 0, 8, 1, [['cup', 47]]],
    ['Avocado', 160, 2, 8.5, 14.7, 6.7, 0.7, 2.1, 7, 1, [['medium', 150], ['half', 75]]],
    ['Beetroot, cooked', 44, 1.7, 10, 0.2, 2, 8, 0, 77, 1, [['beet', 82]]],
    ['Butternut squash', 45, 1, 12, 0.1, 2, 2.2, 0, 4, 1, [['cup cubed', 140]]],

    // ---- Fruit ---------------------------------------------------------------
    ['Banana', 89, 1.1, 23, 0.3, 2.6, 12, 0.1, 1, 1, [['medium', 118], ['large', 136]]],
    ['Apple', 52, 0.3, 14, 0.2, 2.4, 10, 0, 1, 1, [['medium', 182]]],
    ['Orange', 47, 0.9, 12, 0.1, 2.4, 9.4, 0, 0, 1, [['medium', 131]]],
    ['Strawberries', 32, 0.7, 7.7, 0.3, 2, 4.9, 0, 1, 1, [['cup', 152]]],
    ['Blueberries', 57, 0.7, 14, 0.3, 2.4, 10, 0, 1, 1, [['cup', 148]]],
    ['Raspberries', 52, 1.2, 12, 0.7, 6.5, 4.4, 0, 1, 1, [['cup', 123]]],
    ['Grapes', 69, 0.7, 18, 0.2, 0.9, 16, 0.1, 2, 1, [['cup', 151]]],
    ['Mango', 60, 0.8, 15, 0.4, 1.6, 14, 0.1, 1, 1, [['cup', 165]]],
    ['Pineapple', 50, 0.5, 13, 0.1, 1.4, 10, 0, 1, 1, [['cup', 165]]],
    ['Watermelon', 30, 0.6, 7.6, 0.2, 0.4, 6.2, 0, 1, 1, [['cup', 152]]],
    ['Pear', 57, 0.4, 15, 0.1, 3.1, 9.8, 0, 1, 1, [['medium', 178]]],
    ['Peach', 39, 0.9, 10, 0.3, 1.5, 8.4, 0, 0, 1, [['medium', 150]]],
    ['Kiwi', 61, 1.1, 15, 0.5, 3, 9, 0, 3, 1, [['fruit', 69]]],
    ['Dates, medjool', 277, 1.8, 75, 0.2, 6.7, 66, 0, 1, 1, [['date', 24]]],
    ['Raisins', 299, 3.1, 79, 0.5, 3.7, 59, 0.1, 11, 1, [['30 g', 30]]],

    // ---- Fats and oils -------------------------------------------------------
    ['Olive oil', 884, 0, 0, 100, 0, 0, 13.8, 2, 2, [['tbsp', 13.5], ['tsp', 4.5]]],
    ['Rapeseed oil', 884, 0, 0, 100, 0, 0, 7.4, 0, 2, [['tbsp', 14]]],
    ['Coconut oil', 892, 0, 0, 99, 0, 0, 82, 0, 2, [['tbsp', 14]]],
    ['Mayonnaise', 680, 1, 0.6, 75, 0, 0.6, 12, 635, 4, [['tbsp', 14]]],

    // ---- Drinks --------------------------------------------------------------
    ['Water', 0, 0, 0, 0, 0, 0, 0, 0, 1, [['glass 250 ml', 250], ['bottle 500 ml', 500]]],
    ['Coffee, black', 2, 0.3, 0, 0, 0, 0, 0, 5, 1, [['cup 240 ml', 240]]],
    ['Tea, black, no milk', 1, 0, 0.3, 0, 0, 0, 0, 3, 1, [['cup 240 ml', 240]]],
    ['Orange juice', 45, 0.7, 10, 0.2, 0.2, 8.4, 0, 1, 3, [['glass 250 ml', 250]]],
    ['Cola', 42, 0, 11, 0, 0, 11, 0, 4, 4, [['can 330 ml', 330]]],
    ['Diet cola', 0.4, 0, 0, 0, 0, 0, 0, 6, 4, [['can 330 ml', 330]]],
    ['Beer, lager', 43, 0.5, 3.6, 0, 0, 0, 0, 4, 3, [['pint 568 ml', 568]]],
    ['Wine, red', 85, 0.1, 2.6, 0, 0, 0.6, 0, 4, 3, [['glass 175 ml', 175]]],
    ['Whey protein powder', 375, 78, 8, 4, 1, 5, 2, 300, 4, [['scoop 30 g', 30]]],
    ['Oat milk', 45, 0.8, 6.7, 1.5, 0.8, 4, 0.2, 42, 4, [['glass 250 ml', 250]]],
    ['Almond milk, unsweetened', 15, 0.5, 0.3, 1.2, 0.3, 0, 0.1, 63, 4, [['glass 250 ml', 250]]],

    // ---- Snacks and prepared -------------------------------------------------
    ['Dark chocolate, 70%', 598, 7.8, 46, 43, 11, 24, 24, 20, 4, [['square', 10], ['bar 100 g', 100]]],
    ['Milk chocolate', 535, 7.6, 59, 30, 3.4, 52, 18, 79, 4, [['square', 8]]],
    ['Crisps, salted', 536, 7, 53, 34, 4.4, 0.3, 3.1, 525, 4, [['small bag', 25]]],
    ['Biscuit, digestive', 471, 6.7, 63, 21, 3, 17, 10, 600, 4, [['biscuit', 15]]],
    ['Protein bar', 350, 30, 35, 9, 6, 4, 4, 250, 4, [['bar', 60]]],
    ['Pizza, cheese', 266, 11, 33, 10, 2.3, 3.6, 4.5, 598, 4, [['slice', 107]]],
    ['Chips / fries, baked', 168, 2.5, 27, 5.6, 2.6, 0.3, 0.9, 266, 4, [['portion', 150]]],
    ['Ice cream, vanilla', 207, 3.5, 24, 11, 0.7, 21, 6.8, 80, 4, [['scoop', 66]]],
    ['Honey', 304, 0.3, 82, 0, 0.2, 82, 0, 4, 2, [['tsp', 7], ['tbsp', 21]]],
    ['Sugar, white', 387, 0, 100, 0, 0, 100, 0, 1, 2, [['tsp', 4], ['tbsp', 12]]],
    ['Tomato ketchup', 101, 1.2, 26, 0.1, 0.3, 21, 0, 907, 4, [['tbsp', 17]]],
    ['Soy sauce', 53, 8.1, 4.9, 0.6, 0.8, 0.4, 0, 5493, 3, [['tbsp', 16]]],
  ];

  /**
   * Added sugar is estimated rather than measured: for NOVA 4 (ultra-processed) items the
   * total sugar is overwhelmingly added, whereas in whole fruit, milk and vegetables it is
   * intrinsic. Marking intrinsic sugar as "added" would wrongly tank the score of anyone
   * eating fruit, which is the opposite of what the metric is for.
   */
  function estimateAddedSugar(sugar, nova) {
    if (sugar == null) return null;
    if (nova >= 4) return sugar;
    if (nova === 3) return sugar * 0.5;
    return 0;
  }

  /**
   * Search synonyms.
   *
   * This library was written in British English, so "yogurt" returned nothing while
   * "yoghurt" worked, and "coke" found nothing at all. Rather than duplicate entries, the
   * query is expanded at search time — each word is also tried as its synonyms.
   *
   * Pairs are bidirectional and mirrored automatically; the one-way table is for cases
   * where the reverse makes no sense (typing "cola" should not suggest "Pepsi").
   */
  const SYNONYM_PAIRS = [
    ['yogurt', 'yoghurt'], ['cilantro', 'coriander'], ['zucchini', 'courgette'],
    ['eggplant', 'aubergine'], ['arugula', 'rocket'], ['shrimp', 'prawns'],
    ['garbanzo', 'chickpeas'], ['capsicum', 'pepper'], ['cookie', 'biscuit'],
    ['fries', 'chips'], ['soda', 'cola'], ['wholewheat', 'wholemeal'],
    ['oatmeal', 'oats'], ['porridge', 'oats'], ['beetroot', 'beet'],
    ['swede', 'rutabaga'], ['maize', 'sweetcorn'], ['corn', 'sweetcorn'],
    ['soya', 'soy'], ['aubergine', 'brinjal'], ['coriander', 'dhania'],
  ];

  const SYNONYM_ONE_WAY = {
    coke: 'cola', pepsi: 'cola', sprite: 'cola', fanta: 'cola', pop: 'cola', fizzy: 'cola',
    // Keys are matched per word, so multi-word keys would never fire.
    ground: 'mince', hamburger: 'mince', wheat: 'wholemeal', whole: 'wholemeal',
    hummous: 'hummus', houmous: 'hummus', yoghourt: 'yoghurt',
    spud: 'potato', tatties: 'potato', chook: 'chicken', poultry: 'chicken',
    mayo: 'mayonnaise', joe: 'coffee', brew: 'tea', crisps: 'chips',
    scallion: 'onion', shallot: 'onion', greens: 'spinach',
    protein: 'whey', shake: 'whey', pasta: 'pasta', noodle: 'noodles',
    curd: 'cottage cheese', quark: 'cottage cheese',
  };

  V.FOOD_SYNONYMS = (function () {
    const map = {};
    const add = (from, to) => {
      if (from === to) return;
      map[from] = map[from] || [];
      if (!map[from].includes(to)) map[from].push(to);
    };
    for (const [a, b] of SYNONYM_PAIRS) { add(a, b); add(b, a); }
    for (const k in SYNONYM_ONE_WAY) add(k, SYNONYM_ONE_WAY[k]);
    return map;
  })();

  V.seedFoods = function () {
    return F.map((r) => {
      const [name, kcal, protein, carbs, fat, fiber, sugar, satFat, sodium, nova, servings] = r;
      return {
        // Stable, derived id: re-seeding can't create duplicates, and a user's log entries
        // keep resolving across app updates.
        id: 'seed-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name,
        source: 'seed',
        novaGroup: nova,
        per100: {
          kcal, protein, carbs, fat, fiber, sugar,
          addedSugar: estimateAddedSugar(sugar, nova),
          saturatedFat: satFat, sodium,
        },
        servings: (servings || []).map(([label, grams]) => ({ label, grams })),
      };
    });
  };
})(window.V);
