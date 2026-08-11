/*
 * Ygeia — data analysis and insights.
 *
 * Correlations between the things you log. Pure functions, no DOM, no storage.
 *
 * ---------------------------------------------------------------------------
 * A note on honesty, because this is where health apps usually start lying.
 *
 * Testing every pair of variables until something looks significant is p-hacking: with
 * ~12 tracked variables there are 66 pairs, and at the usual thresholds you would expect
 * several "findings" from pure noise. So this module only tests a CURATED list of pairs
 * that have a plausible mechanism behind them, refuses to report anything below a minimum
 * sample size, and always shows r and n next to the claim.
 *
 * It also never says "X causes Y". It cannot know that, and neither can you from
 * observational data you collected on yourself.
 * ---------------------------------------------------------------------------
 */
(function (V) {
  'use strict';

  const I = {};

  /** Below this many paired observations, nothing is reported at all. */
  I.MIN_N = 10;
  /** Below this |r|, the relationship is too weak to be worth a sentence. */
  I.MIN_R = 0.45;

  // =========================================================================
  // Statistics
  // =========================================================================

  /** Pearson product-moment correlation over [{x, y}] pairs. */
  I.pearson = function (pairs) {
    const n = pairs.length;
    if (n < 3) return null;

    const meanX = V.sum(pairs, (p) => p.x) / n;
    const meanY = V.sum(pairs, (p) => p.y) / n;

    let num = 0, dx2 = 0, dy2 = 0;
    for (const p of pairs) {
      const dx = p.x - meanX, dy = p.y - meanY;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    // No variance in one variable means correlation is undefined, not zero.
    if (dx2 === 0 || dy2 === 0) return null;

    return num / Math.sqrt(dx2 * dy2);
  };

  /**
   * Two-tailed p-value for a correlation, via the t statistic and a normal approximation
   * to the t-distribution. Rough, but enough to keep obviously-noise results out of the UI.
   */
  I.pValue = function (r, n) {
    if (r == null || n < 3) return null;
    const absR = Math.min(Math.abs(r), 0.999999);
    const t = absR * Math.sqrt((n - 2) / (1 - absR * absR));
    // Normal approximation, adequate for n >= 10.
    const z = t;
    const p = 2 * (1 - normalCdf(z));
    return V.clamp(p, 0, 1);
  };

  /** Abramowitz & Stegun 7.1.26 approximation to the error function. */
  function normalCdf(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.sqrt(2);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
          a4 = -1.453152027, a5 = 1.061405429, pC = 0.3275911;
    const t = 1 / (1 + pC * ax);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return 0.5 * (1 + sign * y);
  }

  I.strength = function (r) {
    const a = Math.abs(r);
    if (a >= 0.7) return 'strong';
    if (a >= 0.5) return 'moderate';
    if (a >= 0.3) return 'weak';
    return 'negligible';
  };

  /**
   * Pair up two daily series by date.
   * `lagDays` shifts series A forward — lag 1 answers "does A on the previous day relate
   * to B today", which is the shape of most of the interesting questions here.
   */
  I.align = function (seriesA, seriesB, lagDays) {
    const lag = lagDays || 0;
    const bByDate = {};
    for (const b of seriesB) bByDate[b.date] = b.value;

    const pairs = [];
    for (const a of seriesA) {
      const targetDate = lag ? V.addDays(a.date, lag) : a.date;
      if (bByDate[targetDate] == null) continue;
      pairs.push({ x: a.value, y: bByDate[targetDate], date: targetDate });
    }
    return pairs;
  };

  /** Correlate two series and return everything needed to report it honestly. */
  I.correlate = function (seriesA, seriesB, lagDays) {
    const pairs = I.align(seriesA, seriesB, lagDays);
    const r = I.pearson(pairs);
    if (r == null) return null;

    return {
      r,
      n: pairs.length,
      p: I.pValue(r, pairs.length),
      pairs,
      strength: I.strength(r),
      direction: r > 0 ? 'positive' : 'negative',
      reportable: pairs.length >= I.MIN_N && Math.abs(r) >= I.MIN_R,
    };
  };

  // =========================================================================
  // Curated questions
  // =========================================================================

  /**
   * Each entry is a question with a plausible mechanism. `lag: 1` means "A yesterday
   * against B today". Only these are tested — see the note at the top of the file.
   */
  I.QUESTIONS = [
    { a: 'sleepHours', b: 'trainingVolume', lag: 1,
      title: 'Sleep and training volume',
      positive: 'You lift more volume after longer nights.',
      negative: 'You lift more volume after shorter nights — unusual; check whether long ' +
                'sleep is landing on your rest days.' },

    { a: 'sleepHours', b: 'studyMinutes', lag: 1,
      title: 'Sleep and study output',
      positive: 'You study more, and for longer, after a full night.',
      negative: 'You study more after short nights — likely late cramming rather than sleep ' +
                'causing anything.' },

    { a: 'protein', b: 'trainingVolume', lag: 1,
      title: 'Protein and next-day training',
      positive: 'Higher protein days are followed by better training sessions.',
      negative: 'Higher protein is followed by lower volume — probably coincidence rather ' +
                'than anything causal.' },

    { a: 'calories', b: 'trainingVolume', lag: 0,
      title: 'Calories and training',
      positive: 'You eat more on days you train harder.',
      negative: 'You eat less on your hardest training days — worth fixing, that is when ' +
                'fuel matters most.' },

    { a: 'steps', b: 'sleepHours', lag: 0,
      title: 'Activity and sleep',
      positive: 'More movement during the day goes with longer sleep that night.',
      negative: 'More steps is going with shorter sleep.' },

    { a: 'lateKcal', b: 'sleepHours', lag: 0,
      title: 'Late meals and sleep',
      positive: 'Eating late is going with longer sleep.',
      negative: 'Bigger late meals are going with shorter sleep.' },

    { a: 'studyMinutes', b: 'sleepHours', lag: 0,
      title: 'Study load and sleep',
      positive: 'Heavy study days go with longer sleep.',
      negative: 'You lose sleep on heavy study days — the trade that costs more recall than ' +
                'it buys.' },
  ];

  /** Human-readable metadata for each series, used in the UI and the custom explorer. */
  I.SERIES_META = {
    sleepHours:     { label: 'Sleep hours', unit: 'h' },
    calories:       { label: 'Calories', unit: 'kcal' },
    protein:        { label: 'Protein', unit: 'g' },
    nutritionScore: { label: 'Nutrition score', unit: '/100' },
    lateKcal:       { label: 'Late-meal calories', unit: 'kcal' },
    trainingVolume: { label: 'Training volume', unit: 'kg' },
    studyMinutes:   { label: 'Study minutes', unit: 'min' },
    steps:          { label: 'Steps', unit: '' },
    weight:         { label: 'Weight', unit: 'kg' },
  };

  /**
   * Run the curated questions against a bundle of daily series.
   * Returns only reportable results, strongest first.
   */
  I.analyse = function (seriesBundle) {
    const out = [];

    for (const q of I.QUESTIONS) {
      const a = seriesBundle[q.a];
      const b = seriesBundle[q.b];
      if (!a || !b || a.length < I.MIN_N || b.length < I.MIN_N) continue;

      const result = I.correlate(a, b, q.lag);
      if (!result || !result.reportable) continue;

      out.push({
        question: q,
        title: q.title,
        finding: result.r > 0 ? q.positive : q.negative,
        r: result.r,
        n: result.n,
        p: result.p,
        strength: result.strength,
        lag: q.lag,
        aLabel: I.SERIES_META[q.a].label,
        bLabel: I.SERIES_META[q.b].label,
        pairs: result.pairs,
      });
    }

    return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  };

  /**
   * Descriptive observations that need no correlation — safe to show early, when there is
   * not yet enough data for anything inferential.
   */
  I.observations = function (bundle) {
    const out = [];
    const mean = (s) => (s && s.length ? V.sum(s, (x) => x.value) / s.length : null);

    const avgSleep = mean(bundle.sleepHours);
    if (avgSleep != null && bundle.sleepHours.length >= 5) {
      out.push({
        title: 'Average sleep',
        text: `${V.fmt(avgSleep, 1)} hours across ${bundle.sleepHours.length} logged nights.` +
              (avgSleep < 7 ? ' Consistently under 7 hours is where cognitive and recovery costs start showing.' : ''),
        n: bundle.sleepHours.length,
      });
    }

    const avgProtein = mean(bundle.protein);
    if (avgProtein != null && bundle.protein.length >= 5) {
      out.push({
        title: 'Average protein',
        text: `${V.fmt(avgProtein)} g per logged day.`,
        n: bundle.protein.length,
      });
    }

    if (bundle.trainingVolume && bundle.trainingVolume.length >= 3) {
      const best = bundle.trainingVolume.reduce((a, b) => (b.value > a.value ? b : a));
      out.push({
        title: 'Biggest session',
        text: `${V.fmt(best.value)} kg of volume on ${V.friendlyDate(best.date)}.`,
        n: bundle.trainingVolume.length,
      });
    }

    // Day-of-week pattern in training — cheap to compute and often genuinely useful.
    if (bundle.trainingVolume && bundle.trainingVolume.length >= 8) {
      const byDow = {};
      for (const d of bundle.trainingVolume) {
        const dow = V.parseKey(d.date).getDay();
        (byDow[dow] = byDow[dow] || []).push(d.value);
      }
      let bestDow = null, bestAvg = -1;
      for (const dow in byDow) {
        const avg = V.sum(byDow[dow]) / byDow[dow].length;
        if (avg > bestAvg) { bestAvg = avg; bestDow = +dow; }
      }
      if (bestDow != null) {
        const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        out.push({
          title: 'Strongest day',
          text: `${names[bestDow]} is your highest-volume day on average (${V.fmt(bestAvg)} kg).`,
          n: bundle.trainingVolume.length,
        });
      }
    }

    return out;
  };

  /** How close the data is to supporting analysis, for the "not yet" state. */
  I.readiness = function (bundle) {
    const counts = {};
    let usable = 0;
    for (const key in I.SERIES_META) {
      const n = (bundle[key] || []).length;
      counts[key] = n;
      if (n >= I.MIN_N) usable++;
    }
    return { counts, usable, minN: I.MIN_N };
  };

  V.insights = I;
})(window.V);
