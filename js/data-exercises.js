/*
 * Ygeia — bundled exercise library.
 *
 * ~130 movements covering the common barbell/dumbbell/machine/bodyweight vocabulary.
 * Users can add their own; these exist so a first workout can be logged immediately.
 *
 * Tuple: [name, primaryMuscle, secondaryMuscles, equipment, isLowerBody]
 *
 * `isLowerBody` drives the progression increment — lower-body lifts recruit more muscle
 * and tolerate 5 kg jumps where upper-body lifts need 2.5 kg. See domain.suggestProgression.
 */
(function (V) {
  'use strict';

  const E = [
    // ---- Chest ---------------------------------------------------------------
    ['Barbell Bench Press', 'chest', ['triceps', 'shoulders'], 'barbell', 0],
    ['Incline Barbell Bench Press', 'chest', ['shoulders', 'triceps'], 'barbell', 0],
    ['Decline Barbell Bench Press', 'chest', ['triceps'], 'barbell', 0],
    ['Dumbbell Bench Press', 'chest', ['triceps', 'shoulders'], 'dumbbell', 0],
    ['Incline Dumbbell Press', 'chest', ['shoulders', 'triceps'], 'dumbbell', 0],
    ['Dumbbell Fly', 'chest', ['shoulders'], 'dumbbell', 0],
    ['Cable Fly', 'chest', ['shoulders'], 'cable', 0],
    ['Cable Crossover', 'chest', ['shoulders'], 'cable', 0],
    ['Machine Chest Press', 'chest', ['triceps'], 'machine', 0],
    ['Pec Deck', 'chest', [], 'machine', 0],
    ['Push-up', 'chest', ['triceps', 'core'], 'bodyweight', 0],
    ['Dip (Chest)', 'chest', ['triceps', 'shoulders'], 'bodyweight', 0],

    // ---- Back ----------------------------------------------------------------
    ['Deadlift', 'back', ['hamstrings', 'glutes', 'core'], 'barbell', 1],
    ['Sumo Deadlift', 'back', ['glutes', 'quads'], 'barbell', 1],
    ['Trap Bar Deadlift', 'back', ['quads', 'glutes'], 'barbell', 1],
    ['Barbell Row', 'back', ['biceps', 'forearms'], 'barbell', 0],
    ['Pendlay Row', 'back', ['biceps'], 'barbell', 0],
    ['T-Bar Row', 'back', ['biceps'], 'barbell', 0],
    ['Dumbbell Row', 'back', ['biceps', 'forearms'], 'dumbbell', 0],
    ['Chest-Supported Row', 'back', ['biceps'], 'machine', 0],
    ['Seated Cable Row', 'back', ['biceps'], 'cable', 0],
    ['Lat Pulldown', 'back', ['biceps'], 'cable', 0],
    ['Close-Grip Lat Pulldown', 'back', ['biceps'], 'cable', 0],
    ['Straight-Arm Pulldown', 'back', [], 'cable', 0],
    ['Pull-up', 'back', ['biceps', 'forearms'], 'bodyweight', 0],
    ['Chin-up', 'back', ['biceps'], 'bodyweight', 0],
    ['Face Pull', 'back', ['shoulders'], 'cable', 0],
    ['Shrug', 'back', ['forearms'], 'barbell', 0],
    ['Dumbbell Shrug', 'back', ['forearms'], 'dumbbell', 0],
    ['Rack Pull', 'back', ['glutes'], 'barbell', 1],
    ['Good Morning', 'back', ['hamstrings', 'glutes'], 'barbell', 1],
    ['Back Extension', 'back', ['glutes', 'hamstrings'], 'bodyweight', 1],

    // ---- Shoulders -----------------------------------------------------------
    ['Overhead Press', 'shoulders', ['triceps', 'core'], 'barbell', 0],
    ['Seated Barbell Press', 'shoulders', ['triceps'], 'barbell', 0],
    ['Dumbbell Shoulder Press', 'shoulders', ['triceps'], 'dumbbell', 0],
    ['Arnold Press', 'shoulders', ['triceps'], 'dumbbell', 0],
    ['Push Press', 'shoulders', ['triceps', 'quads'], 'barbell', 0],
    ['Lateral Raise', 'shoulders', [], 'dumbbell', 0],
    ['Cable Lateral Raise', 'shoulders', [], 'cable', 0],
    ['Front Raise', 'shoulders', [], 'dumbbell', 0],
    ['Rear Delt Fly', 'shoulders', ['back'], 'dumbbell', 0],
    ['Reverse Pec Deck', 'shoulders', ['back'], 'machine', 0],
    ['Upright Row', 'shoulders', ['back', 'biceps'], 'barbell', 0],
    ['Machine Shoulder Press', 'shoulders', ['triceps'], 'machine', 0],

    // ---- Biceps --------------------------------------------------------------
    ['Barbell Curl', 'biceps', ['forearms'], 'barbell', 0],
    ['EZ-Bar Curl', 'biceps', ['forearms'], 'barbell', 0],
    ['Dumbbell Curl', 'biceps', ['forearms'], 'dumbbell', 0],
    ['Hammer Curl', 'biceps', ['forearms'], 'dumbbell', 0],
    ['Incline Dumbbell Curl', 'biceps', [], 'dumbbell', 0],
    ['Preacher Curl', 'biceps', [], 'barbell', 0],
    ['Concentration Curl', 'biceps', [], 'dumbbell', 0],
    ['Cable Curl', 'biceps', ['forearms'], 'cable', 0],
    ['Spider Curl', 'biceps', [], 'dumbbell', 0],

    // ---- Triceps -------------------------------------------------------------
    ['Close-Grip Bench Press', 'triceps', ['chest', 'shoulders'], 'barbell', 0],
    ['Skull Crusher', 'triceps', [], 'barbell', 0],
    ['Tricep Pushdown', 'triceps', [], 'cable', 0],
    ['Rope Pushdown', 'triceps', [], 'cable', 0],
    ['Overhead Tricep Extension', 'triceps', [], 'dumbbell', 0],
    ['Cable Overhead Extension', 'triceps', [], 'cable', 0],
    ['Dip (Triceps)', 'triceps', ['chest'], 'bodyweight', 0],
    ['Tricep Kickback', 'triceps', [], 'dumbbell', 0],
    ['Diamond Push-up', 'triceps', ['chest'], 'bodyweight', 0],

    // ---- Quads ---------------------------------------------------------------
    ['Back Squat', 'quads', ['glutes', 'core', 'hamstrings'], 'barbell', 1],
    ['Front Squat', 'quads', ['glutes', 'core'], 'barbell', 1],
    ['High-Bar Squat', 'quads', ['glutes'], 'barbell', 1],
    ['Box Squat', 'quads', ['glutes'], 'barbell', 1],
    ['Goblet Squat', 'quads', ['glutes', 'core'], 'dumbbell', 1],
    ['Hack Squat', 'quads', ['glutes'], 'machine', 1],
    ['Leg Press', 'quads', ['glutes', 'hamstrings'], 'machine', 1],
    ['Bulgarian Split Squat', 'quads', ['glutes'], 'dumbbell', 1],
    ['Walking Lunge', 'quads', ['glutes', 'hamstrings'], 'dumbbell', 1],
    ['Reverse Lunge', 'quads', ['glutes'], 'dumbbell', 1],
    ['Step-up', 'quads', ['glutes'], 'dumbbell', 1],
    ['Leg Extension', 'quads', [], 'machine', 1],
    ['Sissy Squat', 'quads', [], 'bodyweight', 1],
    ['Pistol Squat', 'quads', ['glutes', 'core'], 'bodyweight', 1],

    // ---- Hamstrings and glutes ----------------------------------------------
    ['Romanian Deadlift', 'hamstrings', ['glutes', 'back'], 'barbell', 1],
    ['Dumbbell Romanian Deadlift', 'hamstrings', ['glutes'], 'dumbbell', 1],
    ['Stiff-Leg Deadlift', 'hamstrings', ['glutes'], 'barbell', 1],
    ['Lying Leg Curl', 'hamstrings', ['calves'], 'machine', 1],
    ['Seated Leg Curl', 'hamstrings', [], 'machine', 1],
    ['Nordic Curl', 'hamstrings', [], 'bodyweight', 1],
    ['Hip Thrust', 'glutes', ['hamstrings'], 'barbell', 1],
    ['Glute Bridge', 'glutes', ['hamstrings'], 'bodyweight', 1],
    ['Cable Kickback', 'glutes', [], 'cable', 1],
    ['Hip Abduction', 'glutes', [], 'machine', 1],
    ['Kettlebell Swing', 'glutes', ['hamstrings', 'back', 'core'], 'kettlebell', 1],

    // ---- Calves --------------------------------------------------------------
    ['Standing Calf Raise', 'calves', [], 'machine', 1],
    ['Seated Calf Raise', 'calves', [], 'machine', 1],
    ['Dumbbell Calf Raise', 'calves', [], 'dumbbell', 1],
    ['Smith Machine Calf Raise', 'calves', [], 'machine', 1],

    // ---- Core ----------------------------------------------------------------
    ['Plank', 'core', ['shoulders'], 'bodyweight', 0],
    ['Side Plank', 'core', [], 'bodyweight', 0],
    ['Hanging Leg Raise', 'core', ['forearms'], 'bodyweight', 0],
    ['Cable Crunch', 'core', [], 'cable', 0],
    ['Crunch', 'core', [], 'bodyweight', 0],
    ['Sit-up', 'core', [], 'bodyweight', 0],
    ['Russian Twist', 'core', [], 'bodyweight', 0],
    ['Ab Wheel Rollout', 'core', ['shoulders'], 'other', 0],
    ['Dead Bug', 'core', [], 'bodyweight', 0],
    ['Mountain Climber', 'core', ['shoulders'], 'bodyweight', 0],
    ['Farmer’s Walk', 'core', ['forearms', 'back'], 'dumbbell', 0],
    ['Pallof Press', 'core', [], 'cable', 0],

    // ---- Forearms ------------------------------------------------------------
    ['Wrist Curl', 'forearms', [], 'barbell', 0],
    ['Reverse Curl', 'forearms', ['biceps'], 'barbell', 0],
    ['Dead Hang', 'forearms', ['back'], 'bodyweight', 0],

    // ---- Full body / conditioning -------------------------------------------
    ['Clean and Press', 'full_body', ['shoulders', 'quads', 'back'], 'barbell', 1],
    ['Power Clean', 'full_body', ['back', 'quads'], 'barbell', 1],
    ['Snatch', 'full_body', ['shoulders', 'back'], 'barbell', 1],
    ['Thruster', 'full_body', ['quads', 'shoulders'], 'barbell', 1],
    ['Burpee', 'full_body', ['chest', 'quads'], 'bodyweight', 0],
    ['Turkish Get-up', 'full_body', ['core', 'shoulders'], 'kettlebell', 0],
    ['Battle Ropes', 'full_body', ['shoulders', 'core'], 'other', 0],
    ['Sled Push', 'full_body', ['quads', 'glutes'], 'other', 1],
  ];

  V.MUSCLE_LABEL = {
    chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps',
    triceps: 'Triceps', quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes',
    calves: 'Calves', core: 'Core', forearms: 'Forearms', full_body: 'Full body',
  };

  V.EQUIPMENT_LABEL = {
    barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable',
    bodyweight: 'Bodyweight', kettlebell: 'Kettlebell', band: 'Band', other: 'Other',
  };

  V.seedExercises = function () {
    return E.map((r) => {
      const [name, primary, secondary, equipment, isLowerBody] = r;
      return {
        // Derived id keeps re-seeding idempotent and preserves history across updates.
        id: 'ex-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name,
        primary,
        secondary: secondary || [],
        equipment,
        isLowerBody: !!isLowerBody,
      };
    });
  };
})(window.V);
