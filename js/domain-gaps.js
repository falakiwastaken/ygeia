/*
 * Ygeia — what you are missing.
 *
 * Compares what you actually did against published guidelines and returns the gaps.
 *
 * This is deterministic on purpose. "You averaged 112 g of protein; in a deficit the
 * evidence supports 2.0–2.2 g/kg, which is 168 g for you" is a subtraction against a cited
 * number, not an opinion. The coach reads these and puts sentences around them — it never
 * works out the figures itself, because a model asked to compute a protein target will
 * produce a plausible one rather than a correct one.
 *
 * Everything here is a POPULATION guideline. None of it is advice about a person's
 * condition, and nothing in this file interprets a symptom or a clinical measurement.
 * Blood pressure and biomarkers are deliberately absent.
 *
 * Pure functions. No DOM, no storage.
 */
(function (V) {
  'use strict';

  const G = {};

  /**
   * Protein per kg of bodyweight.
   *
   * Benefits plateau around 1.6 g/kg for muscle gain (Morton et al. 2018), but in an
   * energy deficit the requirement rises — higher intakes preserve lean mass while losing
   * fat (Helms et al. 2014; Murphy & Koehler 2022). Hence the goal-dependent target: the
   * usual 1.8 becomes 2.2 when cutting, which is where "168 g" comes from for a 76 kg
   * lifter rather than the 137 g a flat 1.8 would suggest.
   */
  G.proteinPerKg = function (goal) {
    if (goal === 'cut') return 2.2;
    if (goal === 'lean_bulk') return 1.8;
    return 1.8;
  };

  /** Sleep. 7–9 hours for adults (AASM & Sleep Research Society consensus, 2015). */
  G.SLEEP_MIN_HOURS = 7;
  G.SLEEP_IDEAL_HOURS = 8;

  /** Fibre. 14 g per 1000 kcal (US Institute of Medicine adequate intake). */
  G.FIBRE_PER_1000_KCAL = 14;

  /** WHO 2020: 150+ min moderate activity weekly, and muscle strengthening on 2+ days. */
  G.WEEKLY_MET_MINUTES = 500;
  G.WEEKLY_STRENGTH_SESSIONS = 2;

  const severityFor = (ratio) => (ratio < 0.6 ? 'high' : ratio < 0.85 ? 'medium' : 'low');

  /**
   * Work out the gaps.
   *
   * @param {object} d
   * @param {object} d.settings          user profile
   * @param {object} d.todayTotals       summed nutrients for the day
   * @param {Array}  d.recentSleep       [{date, hours}] most recent last
   * @param {number} d.strengthSessions7 completed workouts in the last 7 days
   * @param {number} d.metMinutes7       MET-minutes in the last 7 days
   * @param {number} d.daysLogged7       days with any food logged in the last 7
   * @param {Array}  [d.subjectsBehind]  [{name, remainingHours, daysLeft}]
   * @returns {Array} gaps, most important first
   */
  G.find = function (d) {
    const gaps = [];
    const s = d.settings || {};
    const totals = d.todayTotals || {};

    // ---- Protein -----------------------------------------------------------
    if (s.weightKg) {
      const perKg = G.proteinPerKg(s.goal);
      const target = Math.round(s.weightKg * perKg);
      const actual = Math.round(totals.protein || 0);

      if (target > 0 && actual < target * 0.85) {
        gaps.push({
          key: 'protein',
          label: 'Protein',
          actual, target, unit: 'g',
          short: target - actual,
          severity: severityFor(actual / target),
          message: s.goal === 'cut'
            ? `${actual} g today against ${target} g. In a deficit, ${perKg} g/kg is what ` +
              'protects muscle while you lose fat — under-eating protein while cutting is ' +
              'how people lose the wrong tissue.'
            : `${actual} g today against ${target} g.`,
          source: 'Morton et al. (2018) for the plateau; Helms et al. (2014) for the higher ' +
                  'requirement in a deficit.',
        });
      }
    }

    // ---- Fibre -------------------------------------------------------------
    if (totals.kcal > 500 && totals.fiber != null) {
      const target = Math.round(Math.max((totals.kcal / 1000) * G.FIBRE_PER_1000_KCAL, 12));
      const actual = Math.round(totals.fiber);
      if (actual < target * 0.7) {
        gaps.push({
          key: 'fibre',
          label: 'Fibre',
          actual, target, unit: 'g',
          short: target - actual,
          severity: severityFor(actual / target),
          message: `${actual} g today against about ${target} g for what you ate.`,
          source: 'US Institute of Medicine adequate intake, 14 g per 1000 kcal.',
        });
      }
    }

    // ---- Sleep -------------------------------------------------------------
    const nights = (d.recentSleep || []).slice(-7);
    if (nights.length >= 3) {
      const avg = V.sum(nights, (n) => n.hours) / nights.length;
      if (avg < G.SLEEP_MIN_HOURS) {
        gaps.push({
          key: 'sleep',
          label: 'Sleep',
          actual: V.round(avg, 1), target: G.SLEEP_IDEAL_HOURS, unit: 'h',
          short: V.round(G.SLEEP_IDEAL_HOURS - avg, 1),
          severity: severityFor(avg / G.SLEEP_IDEAL_HOURS),
          message: `Averaging ${V.fmt(avg, 1)} hours across ${nights.length} nights. ` +
                   'The general guidance for adults is 7 to 9.',
          source: 'American Academy of Sleep Medicine & Sleep Research Society (2015).',
        });
      }
    }

    // ---- Strength frequency -------------------------------------------------
    if (d.strengthSessions7 != null && d.strengthSessions7 < G.WEEKLY_STRENGTH_SESSIONS) {
      gaps.push({
        key: 'strength',
        label: 'Strength training',
        actual: d.strengthSessions7, target: G.WEEKLY_STRENGTH_SESSIONS, unit: ' sessions',
        short: G.WEEKLY_STRENGTH_SESSIONS - d.strengthSessions7,
        severity: d.strengthSessions7 === 0 ? 'high' : 'medium',
        message: `${d.strengthSessions7} this week. The guideline is at least 2 days of ` +
                 'muscle-strengthening activity.',
        source: 'WHO physical activity guidelines (2020).',
      });
    }

    // ---- Overall activity ----------------------------------------------------
    if (d.metMinutes7 != null && d.metMinutes7 < G.WEEKLY_MET_MINUTES) {
      gaps.push({
        key: 'activity',
        label: 'Weekly activity',
        actual: Math.round(d.metMinutes7), target: G.WEEKLY_MET_MINUTES, unit: ' MET-min',
        short: Math.round(G.WEEKLY_MET_MINUTES - d.metMinutes7),
        severity: severityFor(d.metMinutes7 / G.WEEKLY_MET_MINUTES),
        message: `${Math.round(d.metMinutes7)} MET-minutes this week against roughly 500, ` +
                 'which is about 150 minutes of moderate activity.',
        source: 'WHO physical activity guidelines (2020).',
      });
    }

    // ---- Logging consistency -------------------------------------------------
    // Not a health guideline — but every number above is wrong if the diary is half empty,
    // so it belongs in the same list.
    if (d.daysLogged7 != null && d.daysLogged7 < 5) {
      gaps.push({
        key: 'logging',
        label: 'Logging',
        actual: d.daysLogged7, target: 7, unit: ' days',
        short: 7 - d.daysLogged7,
        severity: d.daysLogged7 <= 2 ? 'high' : 'medium',
        message: `Food logged on ${d.daysLogged7} of the last 7 days. Everything else here ` +
                 'is only as good as what is in the diary.',
        source: null,
      });
    }

    // ---- Study ---------------------------------------------------------------
    for (const sub of d.subjectsBehind || []) {
      gaps.push({
        key: 'study:' + sub.name,
        label: sub.name,
        actual: null, target: null, unit: '',
        short: null,
        severity: sub.daysLeft <= 3 ? 'high' : 'medium',
        message: `${V.fmt(sub.remainingHours, 1)} hours still planned with ${sub.daysLeft} ` +
                 'day(s) until the exam.',
        source: null,
      });
    }

    const rank = { high: 0, medium: 1, low: 2 };
    return gaps.sort((a, b) => rank[a.severity] - rank[b.severity]);
  };

  /** One-line summary for the coach context and the Today card. */
  G.summarise = function (gaps) {
    if (!gaps.length) return 'Nothing obviously missing.';
    return gaps.map((g) => g.label + (g.short != null ? ` short by ${g.short}${g.unit}` : '')).join('; ');
  };

  V.gaps = G;
})(window.V);
