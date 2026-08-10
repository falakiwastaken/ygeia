/*
 * Ygeia — bulk-store meal templates.
 *
 * Built around what warehouse stores (Costco, Sam's Club, Makro) and large supermarkets
 * actually sell in bulk: rotisserie chicken, frozen vegetables, rice, eggs, oats, tinned
 * fish, mince. Short ingredient lists, minimal technique, and they scale to batch cooking.
 *
 * Ingredients reference the bundled food library by id, so macros, cost-per-serving and
 * the shopping list are all computed rather than hard-coded — change a food and every
 * meal that uses it updates.
 */
(function (V) {
  'use strict';

  /**
   * [id, name, minutes, servings, tags, ingredients[[foodId, gramsPerServing]], steps[]]
   */
  const MEALS = [
    ['chicken-rice-broccoli', 'Chicken, rice & broccoli', 25, 4,
      ['high protein', 'batch cook', 'freezer'],
      [['seed-chicken-breast-cooked', 170], ['seed-rice-white-cooked', 200],
       ['seed-broccoli-steamed', 150], ['seed-olive-oil', 7]],
      ['Cook rice in bulk — a rice cooker does 6 portions unattended.',
       'Season chicken, bake at 200 °C for 20–22 min, or shred a rotisserie chicken.',
       'Steam or microwave frozen broccoli 4 min.',
       'Portion into containers, drizzle olive oil. Keeps 4 days refrigerated.']],

    ['rotisserie-wraps', 'Rotisserie chicken wraps', 8, 4,
      ['no cook', 'under 10 min', 'lunchbox'],
      [['seed-chicken-breast-cooked', 120], ['seed-tortilla-wrap-flour', 60],
       ['seed-avocado', 50], ['seed-spinach-raw', 30], ['seed-cheddar-cheese', 20]],
      ['Shred the rotisserie chicken — one bird gives roughly 500 g of meat.',
       'Layer wrap with spinach, chicken, sliced avocado, cheese.',
       'Roll tightly, halve. Assemble the morning of, or the avocado browns.']],

    ['overnight-oats', 'Overnight oats', 5, 4,
      ['no cook', 'meal prep', 'breakfast'],
      [['seed-oats-rolled-dry', 60], ['seed-greek-yoghurt-0-fat', 150],
       ['seed-milk-semi-skimmed', 120], ['seed-blueberries', 60], ['seed-honey', 10]],
      ['Combine oats, yoghurt and milk in a jar.',
       'Top with berries and honey.',
       'Refrigerate overnight. Makes four jars at once; keeps 4 days.']],

    ['beef-mince-pasta', 'Beef mince pasta', 25, 5,
      ['batch cook', 'freezer', 'family'],
      [['seed-beef-mince-5-fat-cooked', 130], ['seed-pasta-cooked', 220],
       ['seed-tomato', 120], ['seed-onion', 50], ['seed-olive-oil', 7]],
      ['Brown mince with diced onion, 8 min.',
       'Add chopped tomatoes, simmer 12 min.',
       'Cook pasta, combine. Freezes well in portions for up to 3 months.']],

    ['salmon-sweet-potato', 'Baked salmon & sweet potato', 30, 2,
      ['omega-3', 'one tray', 'high protein'],
      [['seed-salmon-cooked', 150], ['seed-sweet-potato-baked', 200],
       ['seed-green-beans', 120], ['seed-olive-oil', 7]],
      ['Cube sweet potato, toss in oil, roast 200 °C for 25 min.',
       'Add salmon fillets for the final 12–14 min.',
       'Steam green beans 4 min. One tray, one pan to wash.']],

    ['egg-fried-rice', 'Egg fried rice', 12, 3,
      ['under 15 min', 'uses leftovers', 'cheap'],
      [['seed-egg-whole-raw', 100], ['seed-rice-white-cooked', 220],
       ['seed-peas-frozen', 60], ['seed-sweetcorn', 50], ['seed-soy-sauce', 12]],
      ['Day-old cold rice works far better than fresh — less moisture.',
       'Scramble eggs in a hot pan, set aside.',
       'Fry rice with frozen peas and corn 4 min, return eggs, add soy sauce.']],

    ['tuna-jacket-potato', 'Tuna jacket potato', 12, 2,
      ['under 15 min', 'store cupboard', 'cheap'],
      [['seed-tuna-canned-in-water-drained', 100], ['seed-potato-baked-with-skin', 300],
       ['seed-cottage-cheese', 60], ['seed-sweetcorn', 40]],
      ['Microwave potato 8–10 min, or oven 45 min for a crisp skin.',
       'Mix drained tuna with cottage cheese and sweetcorn.',
       'Split potato, pile on top.']],

    ['chicken-burrito-bowl', 'Chicken burrito bowl', 20, 4,
      ['batch cook', 'high protein', 'meal prep'],
      [['seed-chicken-breast-cooked', 150], ['seed-rice-brown-cooked', 180],
       ['seed-black-beans-cooked', 100], ['seed-sweetcorn', 60],
       ['seed-avocado', 40], ['seed-tomato', 60]],
      ['Cook rice and season chicken with cumin and paprika.',
       'Warm drained black beans through.',
       'Layer everything in a container. Add avocado only when serving.']],

    ['lentil-curry', 'Lentil curry', 30, 5,
      ['vegetarian', 'batch cook', 'cheap', 'freezer'],
      [['seed-lentils-cooked', 200], ['seed-onion', 60], ['seed-tomato', 100],
       ['seed-carrot-raw', 60], ['seed-rice-white-cooked', 180], ['seed-olive-oil', 8]],
      ['Soften onion and carrot in oil, 8 min.',
       'Add curry powder, tinned tomatoes and lentils, simmer 20 min.',
       'Serve with rice. Doubles easily and freezes for 3 months.']],

    ['protein-smoothie', 'Protein smoothie', 3, 1,
      ['under 5 min', 'post workout', 'no cook'],
      [['seed-whey-protein-powder', 30], ['seed-banana', 118],
       ['seed-milk-semi-skimmed', 300], ['seed-peanut-butter', 16]],
      ['Everything in a blender, 30 seconds.',
       'Freeze bananas in advance for a thicker result.']],

    ['scrambled-eggs-toast', 'Scrambled eggs on toast', 8, 1,
      ['under 10 min', 'breakfast', 'cheap'],
      [['seed-egg-whole-raw', 150], ['seed-bread-wholemeal', 72],
       ['seed-butter', 8], ['seed-spinach-raw', 30]],
      ['Beat eggs, cook low and slow with butter, stirring constantly.',
       'Wilt spinach in the last 30 seconds.',
       'Take off the heat while still slightly wet — they carry on cooking.']],

    ['chickpea-salad', 'Chickpea & feta salad', 10, 3,
      ['no cook', 'vegetarian', 'lunchbox'],
      [['seed-chickpeas-cooked', 150], ['seed-tomato', 100], ['seed-cucumber', 80],
       ['seed-feta', 40], ['seed-olive-oil', 10]],
      ['Drain and rinse tinned chickpeas.',
       'Dice tomato and cucumber, crumble feta over.',
       'Dress with oil and lemon. Keeps 3 days without the dressing.']],

    ['stir-fry-tofu', 'Tofu stir fry', 15, 3,
      ['vegetarian', 'under 15 min', 'one pan'],
      [['seed-tofu-firm', 150], ['seed-bell-pepper-red', 80], ['seed-broccoli-raw', 100],
       ['seed-mushrooms', 60], ['seed-rice-white-cooked', 180], ['seed-soy-sauce', 15]],
      ['Press tofu 10 min, cube, fry hard until golden on all sides.',
       'Remove tofu, stir fry vegetables 4 min on high heat.',
       'Return tofu, add soy sauce, serve over rice.']],

    ['greek-yoghurt-bowl', 'Greek yoghurt bowl', 3, 1,
      ['under 5 min', 'no cook', 'high protein', 'breakfast'],
      [['seed-greek-yoghurt-full-fat', 200], ['seed-blueberries', 80],
       ['seed-almonds', 20], ['seed-honey', 10]],
      ['Yoghurt in a bowl, everything else on top.',
       'Buy the big tub — the single pots cost roughly triple per 100 g.']],

    ['chicken-soup', 'Chicken & vegetable soup', 35, 6,
      ['batch cook', 'freezer', 'cheap', 'uses leftovers'],
      [['seed-chicken-breast-cooked', 100], ['seed-carrot-raw', 70], ['seed-onion', 50],
       ['seed-potato-boiled', 120], ['seed-peas-frozen', 50]],
      ['Strip a rotisserie carcass and simmer the bones 30 min for stock.',
       'Add diced vegetables, simmer 20 min.',
       'Return shredded chicken. Freezes for 3 months.']],

    ['quinoa-salmon-bowl', 'Quinoa & salmon bowl', 25, 3,
      ['omega-3', 'meal prep', 'high protein'],
      [['seed-salmon-cooked', 130], ['seed-quinoa-cooked', 180],
       ['seed-spinach-raw', 40], ['seed-avocado', 50], ['seed-olive-oil', 7]],
      ['Cook quinoa 15 min, drain well.',
       'Bake or pan-sear salmon 12 min.',
       'Assemble over spinach. Good cold the next day.']],

    ['pb-banana-toast', 'Peanut butter banana toast', 4, 1,
      ['under 5 min', 'pre workout', 'cheap'],
      [['seed-bread-wholemeal', 72], ['seed-peanut-butter', 32], ['seed-banana', 118]],
      ['Toast, spread, slice banana over the top.',
       'Roughly 90 minutes before training is about right.']],

    ['beef-burrito-batch', 'Batch beef burritos', 35, 8,
      ['batch cook', 'freezer', 'family'],
      [['seed-beef-mince-5-fat-cooked', 110], ['seed-tortilla-wrap-flour', 62],
       ['seed-black-beans-cooked', 80], ['seed-rice-white-cooked', 100],
       ['seed-cheddar-cheese', 25]],
      ['Brown mince with cumin, paprika and garlic.',
       'Fill each wrap with rice, beans, mince and cheese.',
       'Wrap individually in foil and freeze. Reheat from frozen, 200 °C for 25 min.']],

    ['cottage-cheese-bowl', 'Cottage cheese & fruit', 3, 1,
      ['under 5 min', 'no cook', 'high protein', 'before bed'],
      [['seed-cottage-cheese', 200], ['seed-blueberries', 80], ['seed-almonds', 15]],
      ['Combine. Slow-digesting casein makes this a reasonable last meal of the day.']],

    ['mediterranean-chicken-tray', 'Mediterranean chicken tray bake', 35, 4,
      ['one tray', 'batch cook', 'family'],
      [['seed-chicken-thigh-skinless-cooked', 150], ['seed-potato-baked-with-skin', 200],
       ['seed-bell-pepper-red', 80], ['seed-courgette', 80],
       ['seed-onion', 50], ['seed-olive-oil', 10]],
      ['Chop everything to a similar size so it cooks evenly.',
       'Toss with oil, oregano and garlic on one tray.',
       'Roast 200 °C for 35 min, turning once.']],
  ];

  V.MEALS = MEALS.map(([id, name, timeMin, servings, tags, ingredients, steps]) => ({
    id: 'meal-' + id,
    name,
    timeMin,
    servings,
    tags,
    ingredients: ingredients.map(([foodId, grams]) => ({ foodId, grams })),
    steps,
  }));

  /** Tag filters offered in the UI, in the order people actually think about them. */
  V.MEAL_TAGS = [
    'under 5 min', 'under 10 min', 'under 15 min', 'no cook', 'batch cook',
    'freezer', 'high protein', 'vegetarian', 'cheap', 'breakfast',
    'lunchbox', 'one tray', 'one pan', 'meal prep', 'post workout',
    'pre workout', 'before bed', 'family', 'store cupboard', 'uses leftovers',
  ];
})(window.V);
