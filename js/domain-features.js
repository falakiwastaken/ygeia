/*
 * Ygeia — optional features.
 *
 * Not everyone wants the whole app. Someone tracking lifting does not need sleep cycles
 * and flashcards in the way; someone using it to revise does not need a weight-cut planner.
 * Carrying features you will never open is not free — it is more tabs to skim past, more
 * cards on Today, and a Body tab with fourteen rows in it.
 *
 * So every non-essential area is a switch, chosen on first run and changeable at any time.
 *
 * WHAT A SWITCH ACTUALLY DOES, precisely, because it would be easy to overclaim:
 *
 *   - It hides the feature: its tab, its cards, its rows, its Settings entries.
 *   - It stops the feature's code running, so the queries behind it never execute.
 *   - It removes the feature's data files from the offline pre-cache, so they are not
 *     downloaded for offline use (see `precachePaths`).
 *
 * What it does NOT do is delete anything. Turning a feature off leaves every record it
 * ever wrote exactly where it is, and turning it back on shows the lot. That is the only
 * safe behaviour for a switch someone might flip while exploring — a toggle that quietly
 * destroyed a year of logs would be indefensible.
 *
 * Nor does it shrink the initial download of the app's own logic: this is one bundle of
 * plain scripts with no build step, and splitting it would mean adding one. The data files
 * are the large part and those genuinely are skipped.
 *
 * Pure functions. No DOM, no storage.
 */
(function (V) {
  'use strict';

  const F = {};

  /**
   * Every switchable feature.
   *
   *   key       stored under settings.features
   *   tab       the tab it owns, if it owns one
   *   essential cannot be turned off
   *   heavy     the data files skipped when it is off
   */
  F.FEATURES = [
    {
      key: 'today', label: 'Today', essential: true, tab: 'today',
      blurb: 'The daily summary. Always on.',
    },
    {
      key: 'nutrition', label: 'Food & nutrition', tab: 'food',
      blurb: 'Meal logging, macros, a food library and a daily quality score.',
      heavy: ['./js/data-foods.js', './js/data-meals.js'],
    },
    {
      key: 'training', label: 'Strength training', tab: 'train',
      blurb: 'Workouts, sets, 1RM estimates, progression and strength rank.',
      heavy: ['./js/data-exercises.js', './js/data-programs.js'],
    },
    {
      key: 'study', label: 'Study', tab: 'study',
      blurb: 'Sleep, focus blocks, subjects, flashcards, notebooks and the daily question.',
    },
    {
      key: 'body', label: 'Body & vitals', tab: 'body',
      blurb: 'Weight, body composition, heart rate, blood pressure and trends.',
    },
    {
      key: 'hearing', label: 'Hearing & noise',
      blurb: 'Sound level meter and headphone exposure. Part of Body.',
    },
    {
      key: 'stress', label: 'Strain, stress & energy',
      blurb: 'Daily strain, self-rated stress and energy, and a stress estimate from your ' +
             'heart rate. Shown on Today.',
    },
    {
      key: 'notebooks', label: 'Notebooks & whiteboard',
      blurb: 'Written notes and a drawing canvas. Part of Study.',
    },
    {
      key: 'dailyQuestion', label: 'Question of the day',
      blurb: 'One practice question and one fact each day. Part of Study.',
      heavy: ['./js/data-daily.js'],
    },
    {
      key: 'sport', label: 'Sport sessions',
      blurb: 'Non-gym activity and weekly training load in MET-minutes.',
    },
    {
      key: 'cut', label: 'Weight cutting',
      blurb: 'Combat-sports weight cut planning. Skip this unless you compete.',
    },
    {
      key: 'places', label: 'Nearby places',
      blurb: 'Find restaurants, gyms and libraries on a map. Uses the network.',
      heavy: ['./js/map.js', './js/places.js'],
    },
    /*
     * `needsKey` keeps these two out of the first-run chooser.
     *
     * They do nothing without an API key the user has to go and obtain elsewhere, so
     * offering them to someone who has just opened the app for the first time asks a
     * question they cannot answer yet — and puts "bring an AI key" in front of them as
     * though it were part of setting the app up. It is not. They live in Settings, where
     * someone who has a key will go looking.
     */
    {
      key: 'coach', label: 'AI coach', needsKey: true,
      blurb: 'Optional, off unless you add your own API key. Uses the network.',
    },
    {
      key: 'scanDeck', label: 'Photo to flashcards', needsKey: true,
      blurb: 'Photograph notes and have them turned into cards you then review. Needs your ' +
             'own API key, and sends the photos to whichever provider issued it.',
    },
    {
      key: 'photoHelp', label: 'Photo problem help', needsKey: true,
      blurb: 'Photograph a question you are stuck on and get a nudge towards the next step. Needs your ' +
             'own API key, and sends the photo to whichever provider issued it.',
    },
  ];

  /** Sensible starting point: the core trackers on, the specialised extras off. */
  F.DEFAULTS = {
    today: true,
    nutrition: true,
    training: true,
    study: true,
    body: true,
    hearing: true,
    stress: true,
    notebooks: true,
    dailyQuestion: true,
    sport: true,
    cut: false,
    places: false,
    coach: false,
    // Off by default: these are the study features that send something off the device, and
    // neither does anything until the user supplies an API key.
    scanDeck: false,
    photoHelp: false,
  };

  F.byKey = function (key) {
    return F.FEATURES.find((f) => f.key === key) || null;
  };

  /**
   * Is a feature on?
   *
   * Unknown keys return true rather than false. A feature added in a later version must
   * appear for people upgrading, not silently vanish because their stored settings predate
   * it — failing open is the only behaviour that does not lose functionality on upgrade.
   */
  F.enabled = function (settings, key) {
    const def = F.byKey(key);
    if (def && def.essential) return true;
    const flags = (settings && settings.features) || {};
    if (!(key in flags)) return key in F.DEFAULTS ? F.DEFAULTS[key] : true;
    return !!flags[key];
  };

  /** Tabs to show, in the fixed order the shell declares them. */
  F.visibleTabs = function (settings, allTabs) {
    return (allTabs || []).filter((tab) => {
      const def = F.FEATURES.find((f) => f.tab === tab);
      // Settings has no feature entry and must never disappear — it is the only way back.
      if (!def) return true;
      return F.enabled(settings, def.key);
    });
  };

  /**
   * Data files that should NOT be held for offline use, given a set of choices.
   *
   * Only `heavy` data files are listed. Everything else in the shell is either needed to
   * boot or small enough that omitting it would complicate the cache for no real saving.
   */
  F.skippedPaths = function (settings) {
    const skip = [];
    for (const f of F.FEATURES) {
      if (!f.heavy || F.enabled(settings, f.key)) continue;
      for (const p of f.heavy) skip.push(p);
    }
    return skip;
  };

  /** The complement: what the service worker should keep, out of a full shell list. */
  F.precachePaths = function (settings, allPaths) {
    const skip = new Set(F.skippedPaths(settings));
    return (allPaths || []).filter((p) => !skip.has(String(p).split('?')[0]));
  };

  /** Merge a set of choices onto the defaults, ignoring anything unrecognised. */
  F.normalise = function (chosen) {
    const out = Object.assign({}, F.DEFAULTS);
    for (const f of F.FEATURES) {
      if (f.essential) { out[f.key] = true; continue; }
      if (chosen && f.key in chosen) out[f.key] = !!chosen[f.key];
    }
    return out;
  };

  /** How many optional features are on, for the Settings summary line. */
  F.summary = function (settings) {
    const optional = F.FEATURES.filter((f) => !f.essential);
    const on = optional.filter((f) => F.enabled(settings, f.key));
    return { on: on.length, total: optional.length };
  };

  V.features = F;
})(window.V);
