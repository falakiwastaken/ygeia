/*
 * Vitals — body composition indices and sport energy expenditure.
 *
 * Pure functions. No DOM, no storage.
 */
(function (V) {
  'use strict';

  const L = {};

  // =========================================================================
  // Body composition indices
  // =========================================================================

  /** Body Mass Index — mass in kg divided by height in metres squared. */
  L.bmi = function (weightKg, heightCm) {
    if (!weightKg || !heightCm) return null;
    const m = heightCm / 100;
    return weightKg / (m * m);
  };

  /** WHO categories. Note the caveat in `bmiCaveat` before showing these as advice. */
  L.bmiCategory = function (bmi) {
    if (bmi == null) return null;
    if (bmi < 16) return { label: 'Severely underweight', color: 'var(--bad)' };
    if (bmi < 18.5) return { label: 'Underweight', color: 'var(--warn)' };
    if (bmi < 25) return { label: 'Healthy range', color: 'var(--good)' };
    if (bmi < 30) return { label: 'Overweight', color: 'var(--warn)' };
    if (bmi < 35) return { label: 'Obese (class I)', color: 'var(--bad)' };
    if (bmi < 40) return { label: 'Obese (class II)', color: 'var(--bad)' };
    return { label: 'Obese (class III)', color: 'var(--bad)' };
  };

  /**
   * BMI cannot distinguish muscle from fat. In an app that also tracks barbell training
   * that limitation is not academic — a lifter at 15% body fat is routinely classed
   * "overweight". Where body fat is known, FFMI is the more informative number, so the
   * UI is told when to say so.
   */
  L.bmiCaveat = function (bmi, bodyFatPct) {
    if (bmi == null) return null;
    if (bodyFatPct != null && bmi >= 25 && bodyFatPct < 20) {
      return 'BMI classes you as overweight, but at ' + V.fmt(bodyFatPct, 1) +
             '% body fat that is muscle, not fat. Use FFMI below instead.';
    }
    if (bodyFatPct == null && bmi >= 25) {
      return 'BMI cannot tell muscle from fat. Log your body fat percentage for a ' +
             'measure that can.';
    }
    return 'BMI is a population screening tool, not a diagnosis. It ignores body ' +
           'composition, frame size and where fat is carried.';
  };

  /** Fat-free mass from weight and body fat percentage. */
  L.leanMass = function (weightKg, bodyFatPct) {
    if (!weightKg || bodyFatPct == null) return null;
    return weightKg * (1 - bodyFatPct / 100);
  };

  /**
   * Fat-Free Mass Index — lean mass scaled to height. Unlike BMI it responds to muscle
   * rather than total mass, so it actually tracks training progress.
   *
   * The normalised form adjusts to a 1.8 m reference height (Kouri et al., 1995), which
   * removes most of the height bias in the raw figure.
   */
  L.ffmi = function (weightKg, heightCm, bodyFatPct) {
    const lean = L.leanMass(weightKg, bodyFatPct);
    if (lean == null || !heightCm) return null;
    const m = heightCm / 100;
    const raw = lean / (m * m);
    return { raw, normalised: raw + 6.1 * (1.8 - m) };
  };

  /**
   * Interpretation bands for normalised FFMI.
   *
   * Around 25 is widely cited as the approximate ceiling for drug-free training, based on
   * Kouri's analysis of pre-steroid-era bodybuilders. It is a population observation with
   * real outliers, not a hard physical limit, and the wording reflects that.
   */
  L.ffmiBand = function (normalised, sex) {
    if (normalised == null) return null;
    // Women carry less fat-free mass at the same training age; bands shift down ~3 points.
    const shift = sex === 'female' ? -3 : 0;
    const n = normalised - shift;
    if (n < 18) return { label: 'Below average', color: 'var(--text-dim)' };
    if (n < 20) return { label: 'Average', color: 'var(--text-dim)' };
    if (n < 22) return { label: 'Above average', color: 'var(--recovery)' };
    if (n < 23.5) return { label: 'Well muscled', color: 'var(--good)' };
    if (n < 25.5) return { label: 'Very muscular', color: 'var(--good)' };
    return { label: 'Exceptional — above the usual drug-free range', color: 'var(--warn)' };
  };

  // =========================================================================
  // Sport energy expenditure
  // =========================================================================

  /**
   * MET values from the Compendium of Physical Activities (Ainsworth et al., 2011).
   * One MET is resting metabolism, so a 10-MET activity burns ten times resting rate.
   *
   * [name, MET at moderate effort, category]
   */
  const SPORTS = [
    ['Running — easy', 7.0, 'cardio'],
    ['Running — moderate (6 mph)', 9.8, 'cardio'],
    ['Running — fast (8 mph)', 11.8, 'cardio'],
    ['Walking', 3.5, 'cardio'],
    ['Hiking', 6.0, 'cardio'],
    ['Cycling — leisure', 6.0, 'cardio'],
    ['Cycling — vigorous', 10.0, 'cardio'],
    ['Swimming', 8.3, 'cardio'],
    ['Rowing machine', 7.0, 'cardio'],
    ['Jump rope', 12.3, 'cardio'],
    ['Stair climbing', 8.8, 'cardio'],
    ['HIIT / circuits', 8.0, 'cardio'],
    ['Elliptical', 5.0, 'cardio'],

    ['Boxing — sparring', 7.8, 'combat'],
    ['Boxing — bag work', 5.5, 'combat'],
    ['Brazilian jiu-jitsu', 10.3, 'combat'],
    ['Judo', 10.3, 'combat'],
    ['Wrestling', 6.0, 'combat'],
    ['Muay Thai / kickboxing', 10.3, 'combat'],
    ['MMA training', 10.3, 'combat'],
    ['Karate / taekwondo', 10.3, 'combat'],
    ['Fencing', 6.0, 'combat'],

    ['Football (soccer) — casual', 7.0, 'team'],
    ['Football (soccer) — competitive', 10.0, 'team'],
    ['Basketball', 6.5, 'team'],
    ['American football', 8.0, 'team'],
    ['Rugby', 8.3, 'team'],
    ['Volleyball', 4.0, 'team'],
    ['Hockey', 8.0, 'team'],
    ['Cricket', 4.8, 'team'],
    ['Netball', 6.0, 'team'],

    ['Tennis — singles', 8.0, 'racket'],
    ['Tennis — doubles', 6.0, 'racket'],
    ['Badminton', 5.5, 'racket'],
    ['Squash', 12.0, 'racket'],
    ['Padel', 7.0, 'racket'],
    ['Table tennis', 4.0, 'racket'],

    ['Yoga', 2.5, 'other'],
    ['Pilates', 3.0, 'other'],
    ['Stretching / mobility', 2.3, 'other'],
    ['Rock climbing', 8.0, 'other'],
    ['Skiing', 7.0, 'other'],
    ['Snowboarding', 5.3, 'other'],
    ['Surfing', 5.0, 'other'],
    ['Skateboarding', 5.0, 'other'],
    ['Dancing', 5.0, 'other'],
    ['Golf (walking)', 4.8, 'other'],
    ['Horse riding', 5.5, 'other'],
  ];

  L.SPORTS = SPORTS.map(([name, met, category]) => ({
    id: 'sport-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name, met, category,
  }));

  L.SPORT_CATEGORY_LABEL = {
    cardio: 'Cardio', combat: 'Combat sports', team: 'Team sports',
    racket: 'Racket sports', other: 'Other',
  };

  /** Effort multipliers applied to the base MET, so one entry covers a range of efforts. */
  L.INTENSITY = [
    { value: 'easy', label: 'Easy', factor: 0.75 },
    { value: 'moderate', label: 'Moderate', factor: 1.0 },
    { value: 'hard', label: 'Hard', factor: 1.25 },
    { value: 'max', label: 'All out', factor: 1.45 },
  ];

  /**
   * Energy cost of a session.
   *
   * kcal/min = MET x 3.5 x bodyweight(kg) / 200, the standard conversion from oxygen
   * uptake. This is gross expenditure — it includes the resting metabolism you would
   * have burned anyway, so do NOT add it on top of a TDEE that already accounts for
   * training. The UI shows it as information, never as calories to "eat back".
   */
  L.sportCalories = function (met, minutes, weightKg, intensityValue) {
    if (!met || !minutes || !weightKg) return 0;
    const intensity = L.INTENSITY.find((i) => i.value === intensityValue);
    const factor = intensity ? intensity.factor : 1;
    return (met * factor * 3.5 * weightKg / 200) * minutes;
  };

  /**
   * Weekly training load in MET-minutes.
   *
   * The WHO guideline is 150 min/week moderate or 75 min vigorous, which works out at
   * roughly 500–1000 MET-minutes. Reporting a single number lets lifting, running and
   * jiu-jitsu be compared on one scale.
   */
  L.metMinutes = function (sessions) {
    return V.sum(sessions, (s) => (s.met || 0) * (s.durationMin || 0));
  };

  L.loadBand = function (metMinutes) {
    if (metMinutes < 500) return { label: 'Below guideline', color: 'var(--warn)' };
    if (metMinutes < 1000) return { label: 'Meets guideline', color: 'var(--good)' };
    if (metMinutes < 2500) return { label: 'Well above guideline', color: 'var(--good)' };
    return { label: 'Very high — watch recovery', color: 'var(--warn)' };
  };

  V.life = L;
})(window.V);
