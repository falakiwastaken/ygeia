/*
 * Vitals — weight cutting for combat sports.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE CHANGING ANYTHING IN HERE.
 *
 * Acute weight cutting has killed athletes. Documented deaths include Yang Jian Bing
 * (ONE Championship, 2015) and Leandro Souza (2013), both from complications of extreme
 * dehydration. Three US collegiate wrestlers died in a single 1997 season.
 *
 * The safety limits below are therefore part of the feature, not decoration. This module
 * will not emit a dehydration schedule for a cut it considers unsafe; it returns an
 * `unsafe` risk level and tells the athlete to move up a weight class instead. If you
 * relax a threshold, you are changing a safety control.
 * ---------------------------------------------------------------------------
 *
 * Protocol structure follows the published applied-sport-science consensus on acute
 * weight loss in combat sports (Reale, Slater & Burke, 2017): make most of the weight
 * chronically through fat loss, and reserve the final days for gut content, glycogen
 * water and — last and least — fluid.
 *
 * Not medical advice. Intended for use alongside a coach and a doctor.
 */
(function (V) {
  'use strict';

  const C = {};

  // =========================================================================
  // Safety thresholds
  // =========================================================================

  /**
   * Acute loss (final ~72h) as a fraction of bodyweight.
   *
   * Performance decrements appear from roughly 2–3% fluid loss and become severe past 5%.
   * Beyond 8% the risk of heat illness, rhabdomyolysis, kidney injury and cardiovascular
   * collapse rises sharply — that is the region where fighters have died.
   */
  C.ACUTE_IDEAL_PCT = 0.03;   // comfortably manageable
  C.ACUTE_CAUTION_PCT = 0.05; // meaningful performance cost
  C.ACUTE_MAX_PCT = 0.08;     // hard refusal above this

  /** Sustainable chronic loss per week, as a fraction of bodyweight. */
  C.CHRONIC_RATE_PCT = 0.007;

  /**
   * Essential body fat. Cutting below these leaves no fat to lose, so any further weight
   * must come from muscle or water — the point at which a cut stops being a diet.
   */
  C.ESSENTIAL_FAT_PCT = { male: 5, female: 12, unspecified: 8 };

  // =========================================================================
  // Planning
  // =========================================================================

  /**
   * Build a cut plan.
   *
   * @param {object} o
   * @param {number} o.currentKg  today's weight
   * @param {number} o.targetKg   the weight class limit
   * @param {number} o.weighInAt  epoch ms of the official weigh-in
   * @param {number} [o.nowMs]    injectable clock, for tests
   * @param {number} [o.bodyFatPct]
   * @param {string} [o.sex]
   * @param {number} [o.hoursToCompete] hours between weigh-in and first fight
   */
  C.plan = function (o) {
    const now = o.nowMs || Date.now();
    const msOut = o.weighInAt - now;
    const daysOut = msOut / 86400000;
    const weeksOut = daysOut / 7;

    const totalKg = o.currentKg - o.targetKg;
    const totalPct = totalKg / o.currentKg;

    const warnings = [];
    const notes = [];

    // ---- Already made weight -------------------------------------------
    if (totalKg <= 0) {
      return {
        daysOut, totalKg, totalPct: 0, chronicKg: 0, acuteKg: 0, acutePct: 0,
        risk: 'none', warnings: [], notes: ['You are already at or under the limit.'],
        phases: [], feasible: true,
      };
    }

    if (daysOut < 0) {
      return {
        daysOut, totalKg, totalPct, chronicKg: 0, acuteKg: totalKg, acutePct: totalPct,
        risk: 'unsafe', feasible: false, phases: [],
        warnings: ['That weigh-in has already passed.'], notes: [],
      };
    }

    // ---- Split the cut: chronic first, acute only with what's left ------
    // Everything achievable through fat loss should be, because acute loss is the part
    // that carries the risk.
    const chronicCapacityKg = Math.max(0, weeksOut - 0.5) * C.CHRONIC_RATE_PCT * o.currentKg;
    const chronicKg = Math.min(totalKg, chronicCapacityKg);
    const acuteKg = Math.max(0, totalKg - chronicKg);

    // Acute percentage is taken against the weight the athlete will actually be at when
    // the acute phase starts, not today's weight.
    const weightAtAcute = o.currentKg - chronicKg;
    const acutePct = acuteKg / weightAtAcute;

    // ---- Risk classification -------------------------------------------
    let risk = 'safe';
    if (acutePct > C.ACUTE_MAX_PCT) risk = 'unsafe';
    else if (acutePct > C.ACUTE_CAUTION_PCT) risk = 'high';
    else if (acutePct > C.ACUTE_IDEAL_PCT) risk = 'caution';

    if (risk === 'unsafe') {
      warnings.push(
        `This needs ${V.fmt(acutePct * 100, 1)}% of your bodyweight cut acutely. That is ` +
        'above the level where athletes have died. No schedule will be generated.',
      );
      warnings.push(
        `Realistic options: move up a weight class, or start the cut earlier — you would ` +
        `need about ${Math.ceil(totalKg / (C.CHRONIC_RATE_PCT * o.currentKg))} weeks to do ` +
        'this through fat loss alone.',
      );
    } else if (risk === 'high') {
      warnings.push(
        `${V.fmt(acutePct * 100, 1)}% acute loss will measurably degrade your performance ` +
        'and needs medical supervision. Under 5% is strongly preferable.',
      );
    } else if (risk === 'caution') {
      warnings.push(
        `${V.fmt(acutePct * 100, 1)}% acute loss is manageable but you will feel it. ` +
        'Expect reduced power and worse heat tolerance.',
      );
    }

    // ---- Body fat floor -------------------------------------------------
    if (o.bodyFatPct != null) {
      const essential = C.ESSENTIAL_FAT_PCT[o.sex] || C.ESSENTIAL_FAT_PCT.unspecified;
      const leanKg = o.currentKg * (1 - o.bodyFatPct / 100);
      const minViableKg = leanKg / (1 - essential / 100);
      if (o.targetKg < minViableKg) {
        warnings.push(
          `At ${V.fmt(o.bodyFatPct, 1)}% body fat, ${V.fmt(o.targetKg, 1)}kg would put you ` +
          `below essential fat (~${essential}%). Your realistic floor is about ` +
          `${V.fmt(minViableKg, 1)}kg without losing muscle.`,
        );
        risk = risk === 'safe' ? 'high' : risk;
      }
    }

    if (chronicKg > 0) {
      notes.push(
        `Lose ${V.fmt(chronicKg, 1)}kg gradually over the next ` +
        `${Math.max(1, Math.floor(weeksOut))} week(s) — about ` +
        `${V.fmt(C.CHRONIC_RATE_PCT * o.currentKg, 2)}kg per week.`,
      );
    }

    const phases = risk === 'unsafe' ? [] : buildPhases(daysOut, weightAtAcute, acuteKg, acutePct);

    return {
      daysOut, weeksOut, totalKg, totalPct,
      chronicKg, acuteKg, acutePct, weightAtAcute,
      risk, feasible: risk !== 'unsafe',
      warnings, notes, phases,
      rehydration: C.rehydration(acuteKg, o.hoursToCompete == null ? 24 : o.hoursToCompete, weightAtAcute),
    };
  };

  /**
   * Day-by-day schedule for the final week.
   *
   * The acute total is filled in a deliberate order — gut content first, then glycogen
   * water, and only the remainder from fluid. Dehydration is the last resort because it
   * is the component that actually hurts people.
   */
  function buildPhases(daysOut, weightKg, acuteKg, acutePct) {
    const phases = [];

    // Typical yields, as a fraction of bodyweight.
    const gutKg = Math.min(acuteKg, weightKg * 0.01);        // low-residue diet, ~1%
    const glycogenKg = Math.min(acuteKg - gutKg, weightKg * 0.01); // depletion, ~1%
    const fluidKg = Math.max(0, acuteKg - gutKg - glycogenKg);

    const mlPerKg = (n) => Math.round(weightKg * n);

    if (daysOut >= 5) {
      phases.push({
        day: -5,
        title: 'Water loading begins',
        actions: [
          `Drink ${mlPerKg(100) / 1000} L per day (100 ml/kg) for three days`,
          'Eat normally — full carbohydrate, normal sodium',
          'Train as usual',
        ],
        why: 'High intake for several days downregulates vasopressin, so when you cut ' +
             'fluid the kidneys keep excreting for a while. It makes the final drop ' +
             'faster and shallower.',
      });
    }

    if (daysOut >= 2) {
      phases.push({
        day: -2,
        title: 'Low-residue diet + sodium restriction',
        actions: [
          'Remove high-fiber foods: wholegrains, legumes, raw vegetables, skins',
          'Sodium under 500 mg/day',
          `Keep fluid at ${mlPerKg(100) / 1000} L today`,
          gutKg > 0 ? `Expect roughly ${V.fmt(gutKg, 1)}kg from reduced gut content` : null,
        ].filter(Boolean),
        why: 'Undigested food and its water sit in the gut and weigh something. Clearing ' +
             'it costs no hydration at all, which is why it comes first.',
      });
    }

    phases.push({
      day: -1,
      title: 'Fluid restriction + carb depletion',
      actions: [
        `Drop fluid to about ${mlPerKg(15) / 1000} L (15 ml/kg) across the whole day`,
        'Carbohydrate under 50 g',
        'Continue low residue, minimal sodium',
        glycogenKg > 0 ? `Expect roughly ${V.fmt(glycogenKg, 1)}kg from glycogen water` : null,
        'Weigh yourself before bed and again on waking',
      ].filter(Boolean),
      why: 'Each gram of stored glycogen holds about 3 g of water. Depleting it sheds ' +
           'that water without heat stress.',
    });

    if (fluidKg > 0.2) {
      phases.push({
        day: 0,
        title: 'Weigh-in morning — passive dehydration',
        actions: [
          `About ${V.fmt(fluidKg, 1)}kg still to lose through sweat`,
          'Hot bath (38–40 °C) or sauna in short bouts of 10–15 minutes',
          'Never train in a sweat suit to make weight',
          'Someone must be with you the entire time — no solo sauna work',
          'Stop immediately if dizzy, nauseous, cramping or your heart is racing',
        ],
        why: 'This is the dangerous part. Keep it as short as possible and never do it ' +
             'alone. If the number is not moving, stop and accept the miss.',
        danger: true,
      });
    } else {
      phases.push({
        day: 0,
        title: 'Weigh-in morning',
        actions: ['No dehydration needed — the diet phases should cover it', 'Weigh in, then start rehydrating immediately'],
        why: 'A cut that needs no sauna is a cut done properly.',
      });
    }

    void acutePct;
    return phases;
  }

  /**
   * Rehydration plan for after the weigh-in.
   *
   * Replacing ~150% of the fluid deficit accounts for continued urine losses. Sodium is
   * essential — plain water dilutes plasma, drives urine output and rehydrates worse.
   * Carbohydrate refills the glycogen that was deliberately depleted.
   */
  C.rehydration = function (lostKg, hoursToCompete, weightKg) {
    if (lostKg <= 0) return null;

    const fluidL = lostKg * 1.5;
    const hours = Math.max(1, hoursToCompete);

    return {
      fluidL,
      perHourL: fluidL / Math.min(hours, 12),
      // 50–60 mmol/L sodium; ~1 g salt provides ~17 mmol.
      sodiumMg: Math.round(fluidL * 60 * 23),
      carbsG: Math.round(weightKg * (hours >= 24 ? 8 : hours >= 12 ? 5 : 2)),
      hours,
      advice: [
        `Drink ${V.fmt(fluidL, 1)} L over the next ${Math.min(hours, 12)} hours — sipped, not gulped`,
        'Use an electrolyte drink, not plain water — sodium is what keeps it in you',
        `Aim for about ${V.fmt(weightKg * (hours >= 24 ? 8 : 5))} g of carbohydrate to refill glycogen`,
        'Start with small, low-residue meals; a large meal on an empty gut will not sit well',
        hours < 6
          ? 'Under 6 hours is not enough to fully rehydrate. Expect to compete impaired.'
          : 'Weigh yourself hourly — you should be regaining steadily.',
      ],
      // Full recovery from a meaningful cut takes longer than a same-day turnaround allows.
      complete: hours >= 24,
    };
  };

  // =========================================================================
  // Hydration monitoring
  // =========================================================================

  /**
   * Urine colour scale (Armstrong). A practical field check — it needs no equipment and
   * correlates well enough with hydration status to be useful day to day.
   */
  C.URINE_SCALE = [
    { shade: 1, hex: '#F7F4C8', label: 'Very pale', status: 'Well hydrated', ok: true },
    { shade: 2, hex: '#F2EC9B', label: 'Pale straw', status: 'Well hydrated', ok: true },
    { shade: 3, hex: '#EEE36B', label: 'Straw', status: 'Hydrated', ok: true },
    { shade: 4, hex: '#E9D93F', label: 'Yellow', status: 'Mild dehydration', ok: true },
    { shade: 5, hex: '#E3C81F', label: 'Dark yellow', status: 'Dehydrated — drink now', ok: false },
    { shade: 6, hex: '#D9AE12', label: 'Amber', status: 'Significantly dehydrated', ok: false },
    { shade: 7, hex: '#C8890C', label: 'Dark amber', status: 'Severely dehydrated', ok: false },
    { shade: 8, hex: '#A9640A', label: 'Brown', status: 'Seek medical advice', ok: false },
  ];

  /**
   * Percentage of bodyweight lost so far, against the plan.
   * Losing faster than planned is the warning sign that matters most in-cut.
   */
  C.progress = function (plan, currentKg, targetKg) {
    const remainingKg = currentKg - targetKg;
    const doneKg = plan.startKg - currentKg;
    const pctOfBody = plan.startKg > 0 ? (doneKg / plan.startKg) * 100 : 0;

    return {
      doneKg,
      remainingKg,
      pctOfBody,
      onTrack: remainingKg <= plan.acuteKg + 0.3,
      // Any single day above 4% of bodyweight is a red flag regardless of the plan.
      dailyRedFlag: pctOfBody > 4,
    };
  };

  V.cut = C;
})(window.V);
