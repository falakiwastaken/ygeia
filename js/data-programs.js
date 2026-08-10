/*
 * Ygeia — training programs.
 *
 * Each program is a weekly template of exercise / sets / rep-range. Starting one generates
 * workout templates you can launch directly; progression is handled by the existing double-
 * progression logic in domain.js, so the program says WHAT to do and the app works out how
 * heavy over time.
 *
 * Structures follow long-established, widely used templates rather than anything invented
 * here. Rep ranges are deliberately broad — the exact number matters far less than showing
 * up and adding load when the top of the range is reached.
 */
(function (V) {
  'use strict';

  const ex = (exerciseId, sets, repMin, repMax) => ({ exerciseId, sets, repMin, repMax });

  const PROGRAMS = [
    {
      id: 'prog-full-body-3',
      name: 'Full Body 3×',
      daysPerWeek: 3,
      level: 'Beginner',
      focus: 'General strength',
      description:
        'Three full-body sessions a week. The most efficient structure for anyone under ' +
        'roughly a year of consistent training — every lift gets trained three times a week, ' +
        'which is where beginners progress fastest.',
      schedule: 'Mon / Wed / Fri, or any three non-consecutive days',
      days: [
        { name: 'Day A', exercises: [
          ex('ex-back-squat', 3, 5, 8), ex('ex-barbell-bench-press', 3, 5, 8),
          ex('ex-barbell-row', 3, 6, 10), ex('ex-plank', 3, 30, 60)] },
        { name: 'Day B', exercises: [
          ex('ex-deadlift', 3, 4, 6), ex('ex-overhead-press', 3, 5, 8),
          ex('ex-lat-pulldown', 3, 8, 12), ex('ex-hanging-leg-raise', 3, 8, 15)] },
        { name: 'Day C', exercises: [
          ex('ex-front-squat', 3, 6, 10), ex('ex-incline-dumbbell-press', 3, 8, 12),
          ex('ex-seated-cable-row', 3, 8, 12), ex('ex-dumbbell-curl', 2, 10, 15)] },
      ],
    },

    {
      id: 'prog-upper-lower-4',
      name: 'Upper / Lower 4×',
      daysPerWeek: 4,
      level: 'Intermediate',
      focus: 'Strength & size',
      description:
        'Four days split into two upper and two lower sessions. The best balance of ' +
        'frequency and recovery once full-body sessions start taking too long — everything ' +
        'is trained twice a week.',
      schedule: 'Mon / Tue / Thu / Fri',
      days: [
        { name: 'Upper A', exercises: [
          ex('ex-barbell-bench-press', 4, 5, 8), ex('ex-barbell-row', 4, 6, 10),
          ex('ex-overhead-press', 3, 6, 10), ex('ex-lat-pulldown', 3, 8, 12),
          ex('ex-lateral-raise', 3, 12, 20), ex('ex-tricep-pushdown', 3, 10, 15)] },
        { name: 'Lower A', exercises: [
          ex('ex-back-squat', 4, 5, 8), ex('ex-romanian-deadlift', 3, 8, 12),
          ex('ex-leg-press', 3, 10, 15), ex('ex-lying-leg-curl', 3, 10, 15),
          ex('ex-standing-calf-raise', 4, 10, 15)] },
        { name: 'Upper B', exercises: [
          ex('ex-incline-barbell-bench-press', 4, 6, 10), ex('ex-pull-up', 4, 5, 10),
          ex('ex-dumbbell-shoulder-press', 3, 8, 12), ex('ex-seated-cable-row', 3, 10, 15),
          ex('ex-dumbbell-curl', 3, 10, 15), ex('ex-cable-fly', 3, 12, 15)] },
        { name: 'Lower B', exercises: [
          ex('ex-deadlift', 3, 3, 6), ex('ex-bulgarian-split-squat', 3, 8, 12),
          ex('ex-leg-extension', 3, 12, 15), ex('ex-hip-thrust', 3, 8, 12),
          ex('ex-seated-calf-raise', 4, 12, 20)] },
      ],
    },

    {
      id: 'prog-ppl-6',
      name: 'Push / Pull / Legs 6×',
      daysPerWeek: 6,
      level: 'Advanced',
      focus: 'Hypertrophy',
      description:
        'Six days, each muscle group twice a week with high volume. Demanding on recovery ' +
        'and on your schedule — only worth running if sleep and food are already consistent.',
      schedule: 'Push / Pull / Legs, twice through, one rest day',
      days: [
        { name: 'Push A', exercises: [
          ex('ex-barbell-bench-press', 4, 5, 8), ex('ex-overhead-press', 3, 8, 12),
          ex('ex-incline-dumbbell-press', 3, 8, 12), ex('ex-lateral-raise', 4, 12, 20),
          ex('ex-tricep-pushdown', 3, 10, 15), ex('ex-overhead-tricep-extension', 3, 10, 15)] },
        { name: 'Pull A', exercises: [
          ex('ex-deadlift', 3, 4, 6), ex('ex-pull-up', 4, 6, 12),
          ex('ex-barbell-row', 4, 8, 12), ex('ex-face-pull', 3, 15, 20),
          ex('ex-barbell-curl', 3, 8, 12), ex('ex-hammer-curl', 3, 10, 15)] },
        { name: 'Legs A', exercises: [
          ex('ex-back-squat', 4, 5, 8), ex('ex-romanian-deadlift', 3, 8, 12),
          ex('ex-leg-press', 3, 10, 15), ex('ex-lying-leg-curl', 3, 12, 15),
          ex('ex-standing-calf-raise', 4, 12, 20)] },
        { name: 'Push B', exercises: [
          ex('ex-dumbbell-shoulder-press', 4, 8, 12), ex('ex-incline-barbell-bench-press', 4, 8, 12),
          ex('ex-cable-fly', 3, 12, 15), ex('ex-cable-lateral-raise', 4, 12, 20),
          ex('ex-close-grip-bench-press', 3, 8, 12), ex('ex-rope-pushdown', 3, 12, 15)] },
        { name: 'Pull B', exercises: [
          ex('ex-t-bar-row', 4, 8, 12), ex('ex-lat-pulldown', 4, 10, 15),
          ex('ex-chest-supported-row', 3, 10, 15), ex('ex-rear-delt-fly', 3, 15, 20),
          ex('ex-preacher-curl', 3, 10, 15), ex('ex-shrug', 3, 12, 15)] },
        { name: 'Legs B', exercises: [
          ex('ex-front-squat', 4, 6, 10), ex('ex-hip-thrust', 4, 8, 12),
          ex('ex-walking-lunge', 3, 10, 15), ex('ex-seated-leg-curl', 3, 12, 15),
          ex('ex-leg-extension', 3, 15, 20), ex('ex-seated-calf-raise', 4, 15, 20)] },
      ],
    },

    {
      id: 'prog-strength-3',
      name: 'Barbell Strength 3×',
      daysPerWeek: 3,
      level: 'Beginner',
      focus: 'Maximal strength',
      description:
        'Low reps, heavy compounds, minimal accessories. Built for adding weight to the bar ' +
        'rather than for size — expect slow, steady, boring progress, which is exactly what ' +
        'works.',
      schedule: 'Three non-consecutive days',
      days: [
        { name: 'Day A', exercises: [
          ex('ex-back-squat', 5, 5, 5), ex('ex-barbell-bench-press', 5, 5, 5),
          ex('ex-barbell-row', 5, 5, 5)] },
        { name: 'Day B', exercises: [
          ex('ex-back-squat', 5, 5, 5), ex('ex-overhead-press', 5, 5, 5),
          ex('ex-deadlift', 1, 5, 5)] },
        { name: 'Day C', exercises: [
          ex('ex-back-squat', 5, 5, 5), ex('ex-barbell-bench-press', 5, 5, 5),
          ex('ex-pull-up', 3, 5, 10)] },
      ],
    },

    {
      id: 'prog-home-bodyweight',
      name: 'Bodyweight 4×',
      daysPerWeek: 4,
      level: 'Beginner',
      focus: 'No equipment',
      description:
        'No gym, no bar, no plates. Progression comes from reps and harder variations ' +
        'rather than added load, so the rep ranges run higher than the barbell programs.',
      schedule: 'Any four days',
      days: [
        { name: 'Push', exercises: [
          ex('ex-push-up', 4, 8, 20), ex('ex-diamond-push-up', 3, 6, 15),
          ex('ex-dip-triceps', 3, 5, 12), ex('ex-plank', 3, 30, 90)] },
        { name: 'Pull', exercises: [
          ex('ex-pull-up', 4, 3, 10), ex('ex-chin-up', 3, 3, 10),
          ex('ex-dead-hang', 3, 20, 60), ex('ex-back-extension', 3, 10, 20)] },
        { name: 'Legs', exercises: [
          ex('ex-pistol-squat', 3, 3, 8), ex('ex-walking-lunge', 3, 10, 20),
          ex('ex-glute-bridge', 3, 12, 20), ex('ex-sissy-squat', 3, 8, 15)] },
        { name: 'Core & conditioning', exercises: [
          ex('ex-hanging-leg-raise', 3, 8, 15), ex('ex-mountain-climber', 3, 20, 40),
          ex('ex-burpee', 3, 10, 20), ex('ex-side-plank', 3, 20, 60)] },
      ],
    },

    {
      id: 'prog-fighter-4',
      name: 'Fighter Strength 4×',
      daysPerWeek: 4,
      level: 'Intermediate',
      focus: 'Combat sports',
      description:
        'Two short strength sessions and two conditioning-friendly ones, kept low in volume ' +
        'so it sits alongside skills training instead of competing with it. Strength work is ' +
        'heavy and brief; you are not trying to get sore.',
      schedule: 'Two lifting days, two supplementary, around your sport sessions',
      days: [
        { name: 'Strength A', exercises: [
          ex('ex-back-squat', 4, 3, 5), ex('ex-overhead-press', 4, 3, 6),
          ex('ex-pull-up', 4, 4, 8), ex('ex-pallof-press', 3, 10, 15)] },
        { name: 'Strength B', exercises: [
          ex('ex-trap-bar-deadlift', 4, 3, 5), ex('ex-barbell-bench-press', 4, 3, 6),
          ex('ex-barbell-row', 4, 6, 10), ex('ex-farmer-s-walk', 3, 30, 60)] },
        { name: 'Power', exercises: [
          ex('ex-power-clean', 5, 2, 3), ex('ex-kettlebell-swing', 4, 10, 15),
          ex('ex-turkish-get-up', 3, 3, 5), ex('ex-hanging-leg-raise', 3, 8, 15)] },
        { name: 'Neck & grip', exercises: [
          ex('ex-shrug', 3, 12, 15), ex('ex-dead-hang', 3, 30, 60),
          ex('ex-wrist-curl', 3, 12, 20), ex('ex-side-plank', 3, 30, 60)] },
      ],
    },
  ];

  V.PROGRAMS = PROGRAMS;
})(window.V);
