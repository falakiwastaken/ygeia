/*
 * Vitals — strength rating and rank progression.
 *
 * A chess-style rating for lifting. Unlike Elo, this is not zero-sum against opponents —
 * you are rated against published strength standards for your bodyweight and sex, so the
 * number means something absolute rather than only relative to other users.
 *
 * Standards are bodyweight multiples drawn from the widely used untrained → elite
 * progressions (ExRx / StrengthLevel style). They are population reference points, not
 * physical laws: novices with good leverages beat them and lifelong athletes miss them.
 * Treat the rank as a motivating summary, not a verdict.
 */
(function (V) {
  'use strict';

  const R = {};

  /**
   * Bodyweight multiples for a one-rep max, male reference, at each tier boundary.
   * [beginner, novice, intermediate, advanced, elite]
   */
  const STANDARDS_MALE = {
    'ex-back-squat':           [0.75, 1.25, 1.75, 2.50, 3.00],
    'ex-front-squat':          [0.60, 1.00, 1.40, 2.00, 2.40],
    'ex-barbell-bench-press':  [0.50, 0.75, 1.25, 1.75, 2.00],
    'ex-deadlift':             [1.00, 1.50, 2.00, 2.75, 3.25],
    'ex-sumo-deadlift':        [1.00, 1.50, 2.00, 2.75, 3.25],
    'ex-romanian-deadlift':    [0.75, 1.20, 1.65, 2.25, 2.70],
    'ex-overhead-press':       [0.35, 0.55, 0.80, 1.10, 1.35],
    'ex-barbell-row':          [0.50, 0.75, 1.10, 1.50, 1.85],
    'ex-hip-thrust':           [1.00, 1.50, 2.25, 3.00, 3.75],
    'ex-incline-barbell-bench-press': [0.40, 0.65, 1.00, 1.40, 1.70],
  };

  /**
   * Women lift roughly 60–70% of male standards on upper body and 70–80% on lower.
   * A single 0.72 factor is a simplification, but a defensible one at this resolution —
   * and far better than rating everyone against male standards.
   */
  const FEMALE_FACTOR = 0.72;

  /** Points awarded at each tier boundary. Linear interpolation between them. */
  const TIER_POINTS = [200, 400, 600, 800, 1000];

  /**
   * Guild ranks. Deliberately themed rather than Bronze/Silver/Gold — the point is a
   * long ladder where each step feels earned.
   */
  R.TIERS = [
    { name: 'Novice',      min: 0,   color: 'var(--text-dim)' },
    { name: 'Apprentice',  min: 200, color: 'var(--recovery)' },
    { name: 'Journeyman',  min: 380, color: 'var(--info)' },
    { name: 'Adept',       min: 550, color: 'var(--sleep)' },
    { name: 'Expert',      min: 700, color: 'var(--nutrition)' },
    { name: 'Master',      min: 830, color: 'var(--strain)' },
    { name: 'Grandmaster', min: 930, color: 'var(--stress)' },
    { name: 'Legend',      min: 990, color: 'var(--bad)' },
  ];

  /** Score one lift, 0–1000, from an estimated 1RM. */
  R.liftScore = function (exerciseId, oneRMKg, bodyweightKg, sex) {
    const base = STANDARDS_MALE[exerciseId];
    if (!base || !oneRMKg || !bodyweightKg) return null;

    const factor = sex === 'female' ? FEMALE_FACTOR : 1;
    const thresholds = base.map((x) => x * factor * bodyweightKg);
    const ratio = oneRMKg;

    if (ratio <= 0) return 0;
    // Below the first threshold, scale linearly up to it.
    if (ratio < thresholds[0]) return Math.round((ratio / thresholds[0]) * TIER_POINTS[0]);

    for (let i = 0; i < thresholds.length - 1; i++) {
      if (ratio < thresholds[i + 1]) {
        const span = thresholds[i + 1] - thresholds[i];
        const into = (ratio - thresholds[i]) / span;
        return Math.round(TIER_POINTS[i] + into * (TIER_POINTS[i + 1] - TIER_POINTS[i]));
      }
    }
    // Past elite the curve flattens hard — 1000 is not meant to be a ceiling you cruise past.
    const past = (ratio - thresholds[4]) / thresholds[4];
    return Math.round(Math.min(1200, 1000 + past * 400));
  };

  R.RATED_LIFTS = Object.keys(STANDARDS_MALE);

  /**
   * Overall rating from the best rated lifts.
   *
   * Averaging the top three (rather than all) stops the rating collapsing because you
   * have never benched, while still requiring breadth to climb — one huge deadlift and
   * nothing else caps out well below Master.
   */
  R.overall = function (liftScores) {
    const scores = liftScores.filter((s) => s != null && s.score != null).map((s) => s.score);
    if (!scores.length) return null;

    const sorted = scores.slice().sort((a, b) => b - a);
    const counted = sorted.slice(0, 3);
    const mean = V.sum(counted) / counted.length;

    // Breadth penalty: rating a single lift is a weaker signal than three.
    const breadth = counted.length === 1 ? 0.82 : counted.length === 2 ? 0.93 : 1;
    return Math.round(mean * breadth);
  };

  R.tierFor = function (rating) {
    if (rating == null) return R.TIERS[0];
    let tier = R.TIERS[0];
    for (const t of R.TIERS) if (rating >= t.min) tier = t;
    return tier;
  };

  /** How far through the current rank, and what the next one needs. */
  R.progress = function (rating) {
    if (rating == null) return null;
    const idx = R.TIERS.findIndex((t) => t === R.tierFor(rating));
    const current = R.TIERS[idx];
    const next = R.TIERS[idx + 1] || null;
    if (!next) return { current, next: null, pct: 100, pointsToNext: 0 };

    const span = next.min - current.min;
    return {
      current,
      next,
      pct: V.clamp(((rating - current.min) / span) * 100, 0, 100),
      pointsToNext: Math.max(0, next.min - rating),
    };
  };

  // =========================================================================
  // Training XP — short-term feedback between rank changes
  // =========================================================================

  /**
   * Rank moves slowly, because real strength does. XP gives something that moves every
   * session, so consistency is visibly rewarded rather than only peak performance.
   */
  R.XP = {
    perSession: 50,
    perWorkingSet: 8,
    perPR: 120,
    perSportSession: 35,
    // Weekly consistency bonus, awarded per session in a week with 3 or more.
    consistencyBonus: 25,
  };

  R.sessionXp = function (workingSets, prCount) {
    return R.XP.perSession + workingSets * R.XP.perWorkingSet + (prCount || 0) * R.XP.perPR;
  };

  /**
   * Level from cumulative XP, on a widening curve so early levels come quickly and
   * later ones take real work. level n requires 100 * n^1.6 XP in total.
   */
  R.levelFor = function (totalXp) {
    if (!totalXp || totalXp < 0) return { level: 1, into: 0, needed: 100, pct: 0 };
    let level = 1;
    while (100 * Math.pow(level + 1, 1.6) <= totalXp) level++;

    const currentFloor = level === 1 ? 0 : 100 * Math.pow(level, 1.6);
    const nextFloor = 100 * Math.pow(level + 1, 1.6);
    return {
      level,
      into: Math.round(totalXp - currentFloor),
      needed: Math.round(nextFloor - currentFloor),
      pct: V.clamp(((totalXp - currentFloor) / (nextFloor - currentFloor)) * 100, 0, 100),
    };
  };

  /**
   * Build the full rating picture from stored history.
   * Pure: takes data in, returns numbers out, so it is directly testable.
   */
  R.evaluate = function (o) {
    const { setsByExercise, bodyweightKg, sex, workoutCount, sportCount, prCount, totalWorkingSets } = o;

    const liftScores = [];
    for (const exId of R.RATED_LIFTS) {
      const sets = setsByExercise[exId];
      if (!sets || !sets.length) continue;
      const pr = V.domain.personalRecords(sets);
      if (!pr) continue;
      liftScores.push({
        exerciseId: exId,
        oneRM: pr.estimated1RM,
        score: R.liftScore(exId, pr.estimated1RM, bodyweightKg, sex),
        ratio: pr.estimated1RM / bodyweightKg,
      });
    }
    liftScores.sort((a, b) => (b.score || 0) - (a.score || 0));

    const rating = R.overall(liftScores);
    const totalXp =
      (workoutCount || 0) * R.XP.perSession +
      (totalWorkingSets || 0) * R.XP.perWorkingSet +
      (prCount || 0) * R.XP.perPR +
      (sportCount || 0) * R.XP.perSportSession;

    return {
      rating,
      tier: R.tierFor(rating),
      progress: R.progress(rating),
      liftScores,
      totalXp,
      level: R.levelFor(totalXp),
    };
  };

  V.rank = R;
})(window.V);
