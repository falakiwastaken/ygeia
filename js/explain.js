/*
 * Ygeia — calculation transparency.
 *
 * Every derived number in this app should be auditable. A health tracker that shows you a
 * score without showing its working is asking for trust it hasn't earned — and if the
 * maths is wrong, nobody can tell.
 *
 * Each builder here returns a plain spec: the formula, the actual inputs used, the
 * step-by-step arithmetic, the result, and the source it came from. `open()` renders that
 * as a sheet with a "report a problem" button that pre-fills a GitHub issue containing the
 * full working, so a bug report arrives with everything needed to reproduce it.
 *
 * Nothing is transmitted automatically. The report button opens a pre-filled form that the
 * user submits themselves, or doesn't.
 */
(function (V) {
  'use strict';

  const REPO = 'https://github.com/falakiwastaken/ygeia';
  const E = {};

  const n = (x, dp) => V.fmt(x, dp == null ? 1 : dp);

  // =========================================================================
  // Builders — one per calculation
  // =========================================================================

  E.calorieTarget = function (s) {
    const bmr = V.domain.bmr(s);
    const mult = V.domain.ACTIVITY_MULTIPLIER[s.activityLevel];
    const tdee = V.domain.tdee(s);
    const goalMult = V.domain.GOAL_MULTIPLIER[s.goal];
    const sexConst = s.sex === 'male' ? 5 : s.sex === 'female' ? -161 : -78;
    const t = V.domain.macroTargets(s);

    return {
      key: 'calorie-target',
      title: 'Daily calorie target',
      formula:
        'BMR  = 10×weight + 6.25×height − 5×age + sex constant\n' +
        'TDEE = BMR × activity multiplier\n' +
        'Target = TDEE × goal multiplier  (never below BMR)',
      inputs: [
        ['Weight', n(s.weightKg) + ' kg'],
        ['Height', n(s.heightCm, 0) + ' cm'],
        ['Age', s.age + ' years'],
        ['Sex constant', String(sexConst) + (s.sex === 'unspecified' ? ' (midpoint of +5 and −161)' : '')],
        ['Activity', s.activityLevel + ' (×' + mult + ')'],
        ['Goal', V.domain.GOAL_LABEL[s.goal] + ' (×' + goalMult + ')'],
      ],
      steps: [
        ['BMR', `10×${n(s.weightKg)} + 6.25×${n(s.heightCm, 0)} − 5×${s.age} + ${sexConst}`, n(bmr, 0) + ' kcal'],
        ['TDEE', `${n(bmr, 0)} × ${mult}`, n(tdee, 0) + ' kcal'],
        ['Goal', `${n(tdee, 0)} × ${goalMult}`, n(tdee * goalMult, 0) + ' kcal'],
      ].concat(
        s.calorieMargin
          ? [['Safety margin', `${n(tdee * goalMult, 0)} × (1 − ${s.calorieMargin})`,
              n(tdee * goalMult * (1 - s.calorieMargin), 0) + ' kcal']]
          : [],
      ).concat([
        ['Floored at BMR',
          `max(${n(tdee * goalMult * (1 - (s.calorieMargin || 0)), 0)}, ${n(bmr, 0)})`,
          n(V.domain.calorieTarget(s), 0) + ' kcal'],
      ]),
      result: n(t.kcal, 0) + ' kcal' + (s.kcalOverride != null ? ' (manually overridden)' : ''),
      source: 'Mifflin MD, St Jeor ST et al. (1990), "A new predictive equation for resting ' +
              'energy expenditure in healthy individuals", Am J Clin Nutr 51(2):241–7.',
      notes: [
        'The activity multiplier already includes your training. Exercise calories are ' +
        'deliberately NOT added on top — that would double-count them.',
        'Predictive equations are typically within about ±10% for any given individual. ' +
        'Log your weight for a couple of weeks and the app will correct the target against ' +
        'what the scale actually does.',
        s.calorieMargin
          ? `A ${Math.round(s.calorieMargin * 100)}% safety margin is applied, so the ` +
            'target sits near the bottom of the estimated range rather than its middle. ' +
            'Both of the big errors here — the equation and portion size — push the same ' +
            'way, towards eating more than intended, so aiming low absorbs them. The ' +
            'target is still never taken below your BMR.'
          : 'No safety margin is applied, so this is the middle of the estimate. Settings ' +
            'can shift it towards the bottom of the range if you would rather the usual ' +
            'under-logging error left you on target than over it.',
      ],
    };
  };

  E.macroTargets = function (s) {
    const t = V.domain.macroTargets(s);
    const perKg = s.proteinPerKg || V.domain.DEFAULT_PROTEIN_PER_KG;
    const fatFromPct = (t.kcal * 0.25) / 9;
    const fatFloor = s.weightKg * 0.6;

    return {
      key: 'macro-targets',
      title: 'Macro targets',
      formula:
        'Protein = bodyweight × g/kg\n' +
        'Fat     = max(25% of calories ÷ 9, bodyweight × 0.6)\n' +
        'Carbs   = (calories − protein×4 − fat×9) ÷ 4',
      inputs: [
        ['Calorie target', n(t.kcal, 0) + ' kcal'],
        ['Weight', n(s.weightKg) + ' kg'],
        ['Protein setting', perKg + ' g/kg'],
      ],
      steps: [
        ['Protein', `${n(s.weightKg)} × ${perKg}`, n(t.protein, 0) + ' g'],
        ['Fat from %', `${n(t.kcal, 0)} × 0.25 ÷ 9`, n(fatFromPct) + ' g'],
        ['Fat floor', `${n(s.weightKg)} × 0.6`, n(fatFloor) + ' g'],
        ['Fat (greater of the two)', `max(${n(fatFromPct)}, ${n(fatFloor)})`, n(t.fat, 0) + ' g'],
        ['Carbs', `(${n(t.kcal, 0)} − ${t.protein}×4 − ${t.fat}×9) ÷ 4`, n(t.carbs, 0) + ' g'],
      ],
      result: `${t.kcal} kcal · ${t.protein}g protein · ${t.carbs}g carbs · ${t.fat}g fat`,
      source: 'Protein range from Morton et al. (2018) meta-analysis, Br J Sports Med — ' +
              'benefits for muscle growth plateau around 1.6 g/kg. Higher intakes preserve ' +
              'lean mass in a deficit (Helms et al., IJSNEM 2014). Fat floor keeps ' +
              'hormone-supporting intake adequate in a deficit.',
      notes: [
        `${perKg} g/kg is the top of the supported range rather than the plateau. Above ` +
        'about 1.6 the extra is not buying more muscle — it is buying margin, because ' +
        'protein is the macro most often under-eaten and under-logged, and it is the most ' +
        'filling per calorie. Overshooting a target that has plateaued costs nothing.',
        'Carbohydrate absorbs the remainder, so it flexes with the calorie goal instead of ' +
        'squeezing protein.',
        'To use a different number, set a protein target in grams under Targets — that ' +
        'overrides this calculation entirely.',
      ],
    };
  };

  E.nutritionScore = function (scored) {
    if (!scored || scored.score == null) return null;
    const totalWeight = V.sum(scored.components, (c) => c.weight);

    return {
      key: 'nutrition-score',
      title: 'Nutrition quality score',
      formula:
        'score = Σ(component value × weight) ÷ Σ(weights)\n\n' +
        'Components with no data are dropped, and the remaining weights are\n' +
        'renormalised — so missing information never counts against you.',
      inputs: scored.components.map((c) => [c.label, `${n(c.value, 0)}/100 (weight ${c.weight})`]),
      steps: scored.components
        .map((c) => [c.label, `${n(c.value, 0)} × ${c.weight}`, n(c.value * c.weight, 0)])
        .concat([
          ['Sum', scored.components.map((c) => n(c.value * c.weight, 0)).join(' + '),
            n(V.sum(scored.components, (c) => c.value * c.weight), 0)],
          ['Divide by total weight', `÷ ${totalWeight}`, String(scored.score)],
        ]),
      result: scored.score + '/100 — ' + V.domain.scoreBand(scored.score).label,
      source: 'Component targets: fiber 14 g per 1000 kcal (US Institute of Medicine ' +
              'adequate intake); added sugar under 10% of energy (WHO); saturated fat under ' +
              '10% of energy; sodium under 2300 mg. Processing level from the NOVA ' +
              'classification (Monteiro et al.) via Open Food Facts.',
      notes: [
        'This scores the whole day, not individual foods. A biscuit is not "bad" on its own — ' +
        'it only means something against everything else you ate.',
        totalWeight < 100
          ? `Only ${totalWeight} of the 100 available weight points had data today, so the ` +
            'score is based on what is known.'
          : 'All components had data today.',
      ],
    };
  };

  E.oneRepMax = function (weightKg, reps) {
    const r = Math.min(reps, 12);
    const brzycki = weightKg * (36 / (37 - r));
    const epley = weightKg * (1 + r / 30);
    const w = V.clamp((r - 2) / 20, 0, 0.5);

    return {
      key: 'one-rep-max',
      title: 'Estimated one-rep max',
      formula:
        'Brzycki = weight × 36 ÷ (37 − reps)\n' +
        'Epley   = weight × (1 + reps ÷ 30)\n' +
        'blend   = (reps − 2) ÷ 20, clamped to 0–0.5\n' +
        '1RM     = Brzycki×(1 − blend) + Epley×blend',
      inputs: [['Weight', n(weightKg) + ' kg'], ['Reps', String(reps)],
        reps > 12 ? ['Reps used', '12 (capped)'] : null].filter(Boolean),
      steps: [
        ['Brzycki', `${n(weightKg)} × 36 ÷ (37 − ${r})`, n(brzycki) + ' kg'],
        ['Epley', `${n(weightKg)} × (1 + ${r} ÷ 30)`, n(epley) + ' kg'],
        ['Blend weight', `(${r} − 2) ÷ 20`, n(w, 3)],
        ['Result', `${n(brzycki)}×${n(1 - w, 2)} + ${n(epley)}×${n(w, 2)}`,
          n(V.domain.estimate1RM(weightKg, reps)) + ' kg'],
      ],
      result: n(V.domain.estimate1RM(weightKg, reps)) + ' kg',
      source: 'Brzycki M (1993), NSCA; Epley B (1985). Brzycki is more accurate at low reps, ' +
              'Epley at higher ones, so this blends them by rep count instead of picking one.',
      notes: ['Above 12 reps every 1RM formula degrades badly, so reps are capped there.',
              'This is an estimate. The only way to know your 1RM is to lift it.'],
    };
  };

  E.strengthRank = function (ev, bodyweightKg, sex, exById) {
    if (!ev || ev.rating == null) return null;
    const counted = ev.liftScores.slice(0, 3);
    const breadth = counted.length === 1 ? 0.82 : counted.length === 2 ? 0.93 : 1;
    const mean = V.sum(counted, (c) => c.score) / counted.length;

    return {
      key: 'strength-rank',
      title: 'Strength rating',
      formula:
        'Each lift is scored 0–1000 by interpolating your estimated 1RM\n' +
        'between published bodyweight-multiple standards:\n' +
        '  beginner 200 · novice 400 · intermediate 600 · advanced 800 · elite 1000\n\n' +
        'rating = mean(best 3 lift scores) × breadth factor',
      inputs: [
        ['Bodyweight', n(bodyweightKg) + ' kg'],
        ['Standards used', sex === 'female' ? 'female (male × 0.72)' : 'male'],
      ].concat(
        ev.liftScores.map((l) => [
          (exById[l.exerciseId] || {}).name || l.exerciseId,
          `${n(l.oneRM)} kg = ${n(l.ratio, 2)}× bodyweight → ${l.score}`,
        ]),
      ),
      steps: [
        ['Best three', counted.map((c) => String(c.score)).join(', '), n(mean, 1)],
        ['Breadth factor', `${counted.length} lift(s) rated`, '×' + breadth],
        ['Rating', `${n(mean, 1)} × ${breadth}`, String(ev.rating)],
        ['Rank', `${ev.rating} ≥ ${ev.tier.min}`, ev.tier.name],
      ],
      result: `${ev.rating} — ${ev.tier.name}`,
      source: 'Bodyweight-multiple standards follow the widely used untrained→elite ' +
              'progressions (ExRx / StrengthLevel style). The female factor of 0.72 is a ' +
              'simplification of the roughly 60–70% upper-body and 70–80% lower-body ratios.',
      notes: [
        'Only your best three rated lifts count, so never training a lift cannot drag you ' +
        'down — but rating a single lift is capped at 82%, so breadth still matters.',
        'These are population reference points. Limb lengths and leverages move the real ' +
        'number in both directions.',
        'Nothing is compared against other users. This is computed entirely on your device.',
      ],
    };
  };

  E.bmi = function (weightKg, heightCm, bodyFatPct, sex) {
    const bmi = V.life.bmi(weightKg, heightCm);
    const m = heightCm / 100;
    const f = V.life.ffmi(weightKg, heightCm, bodyFatPct);

    const spec = {
      key: 'bmi',
      title: 'BMI and FFMI',
      formula: 'BMI  = weight ÷ height²\n' +
               'lean = weight × (1 − bodyfat%)\n' +
               'FFMI = lean ÷ height²\n' +
               'normalised FFMI = FFMI + 6.1 × (1.8 − height)',
      inputs: [['Weight', n(weightKg) + ' kg'], ['Height', n(heightCm, 0) + ' cm (' + n(m, 2) + ' m)'],
        bodyFatPct != null ? ['Body fat', n(bodyFatPct) + '%'] : ['Body fat', 'not logged — FFMI unavailable']],
      steps: [['BMI', `${n(weightKg)} ÷ ${n(m, 2)}²`, n(bmi, 1)]],
      result: 'BMI ' + n(bmi, 1) + ' — ' + V.life.bmiCategory(bmi).label,
      source: 'BMI: Quetelet (1832), adopted by WHO. FFMI normalisation: Kouri EM et al. ' +
              '(1995), Clin J Sport Med — the analysis behind the widely cited ~25 ceiling ' +
              'for drug-free training.',
      notes: [V.life.bmiCaveat(bmi, bodyFatPct)],
    };

    if (f) {
      const lean = V.life.leanMass(weightKg, bodyFatPct);
      spec.steps.push(['Lean mass', `${n(weightKg)} × (1 − ${n(bodyFatPct)}/100)`, n(lean) + ' kg']);
      spec.steps.push(['FFMI', `${n(lean)} ÷ ${n(m, 2)}²`, n(f.raw, 1)]);
      spec.steps.push(['Normalised', `${n(f.raw, 1)} + 6.1 × (1.8 − ${n(m, 2)})`, n(f.normalised, 1)]);
      spec.result += ' · FFMI ' + n(f.normalised, 1) + ' — ' + V.life.ffmiBand(f.normalised, sex).label;
    }
    return spec;
  };

  E.sportCalories = function (sport, minutes, weightKg, intensityValue) {
    const intensity = V.life.INTENSITY.find((i) => i.value === intensityValue) || V.life.INTENSITY[1];
    const kcal = V.life.sportCalories(sport.met, minutes, weightKg, intensityValue);

    return {
      key: 'sport-calories',
      title: 'Sport energy cost',
      formula: 'kcal/min = MET × intensity × 3.5 × weight ÷ 200\n' +
               'total    = kcal/min × minutes',
      inputs: [
        ['Activity', sport.name],
        ['MET value', String(sport.met)],
        ['Effort', intensity.label + ' (×' + intensity.factor + ')'],
        ['Duration', minutes + ' min'],
        ['Weight', n(weightKg) + ' kg'],
      ],
      steps: [
        ['Per minute', `${sport.met} × ${intensity.factor} × 3.5 × ${n(weightKg)} ÷ 200`, n(kcal / minutes, 2) + ' kcal/min'],
        ['Total', `${n(kcal / minutes, 2)} × ${minutes}`, n(kcal, 0) + ' kcal'],
      ],
      result: n(kcal, 0) + ' kcal',
      source: 'MET values from Ainsworth BE et al. (2011), "2011 Compendium of Physical ' +
              'Activities", Med Sci Sports Exerc 43(8):1575–81. The ×3.5÷200 conversion comes ' +
              'from 1 MET ≈ 3.5 ml O₂/kg/min and ≈5 kcal per litre of oxygen.',
      notes: [
        'This is GROSS energy cost — it includes the calories you would have burned at rest ' +
        'anyway. Do not add it to your food budget: your target already accounts for your ' +
        'activity level, and eating these back double-counts them.',
      ],
    };
  };

  E.trend = function (label, daily, unit) {
    const tr = V.domain.trend(daily, 30);
    if (!tr) return null;

    return {
      key: 'trend',
      title: label + ' trend & projection',
      formula:
        'Ordinary least squares over (day, value):\n' +
        '  slope = Σ((x−x̄)(y−ȳ)) ÷ Σ((x−x̄)²)\n' +
        '  r² = 1 − (residual sum of squares ÷ total sum of squares)\n' +
        'projection = slope × future day + intercept',
      inputs: [
        ['Data points', String(tr.n)],
        ['Range', daily[0].date + ' → ' + daily[daily.length - 1].date],
      ],
      steps: [
        ['Slope per day', '', n(tr.slope, 4) + ' ' + unit],
        ['Slope per week', `${n(tr.slope, 4)} × 7`, n(tr.perWeek, 3) + ' ' + unit],
        ['Fit quality (r²)', '', n(tr.r2, 3)],
        ['Projected in 30 days', '', n(tr.projected, 1) + ' ' + unit],
      ],
      result: tr.reliable
        ? `${n(tr.perWeek, 2)} ${unit}/week — projection shown`
        : `${n(tr.perWeek, 2)} ${unit}/week — too noisy to project`,
      source: 'Standard ordinary least squares linear regression.',
      notes: [
        'A projection is only drawn when r² ≥ 0.3 and there are at least 5 readings. ' +
        'Below that the scatter is mostly noise, and a confident-looking line would be ' +
        'misleading.',
        'r² of ' + n(tr.r2, 2) + ' means about ' + n(tr.r2 * 100, 0) + '% of the variation is ' +
        'explained by the trend; the rest is day-to-day noise.',
      ],
    };
  };

  E.weightCut = function (plan, unit) {
    return {
      key: 'weight-cut',
      title: 'Weight cut split',
      formula:
        'gradual capacity = (weeks − 0.5) × 0.7% × bodyweight\n' +
        'gradual = min(total, capacity)\n' +
        'acute   = total − gradual\n' +
        'acute %  = acute ÷ weight at start of the acute phase',
      inputs: [
        ['Total to lose', n(V.kgToDisplay(plan.totalKg, unit)) + ' ' + unit],
        ['Time available', n(plan.daysOut, 1) + ' days'],
      ],
      steps: [
        ['Gradual (fat loss)', 'at 0.7% bodyweight/week', n(V.kgToDisplay(plan.chronicKg, unit)) + ' ' + unit],
        ['Acute (final days)', `${n(V.kgToDisplay(plan.totalKg, unit))} − ${n(V.kgToDisplay(plan.chronicKg, unit))}`,
          n(V.kgToDisplay(plan.acuteKg, unit)) + ' ' + unit],
        ['Acute as % bodyweight', '', n(plan.acutePct * 100, 1) + '%'],
        ['Risk band', `ideal ≤3% · caution ≤5% · refuse >8%`, plan.risk],
      ],
      result: plan.feasible
        ? `${n(plan.acutePct * 100, 1)}% acute — ${plan.risk}`
        : `${n(plan.acutePct * 100, 1)}% acute — refused, no schedule generated`,
      source: 'Reale R, Slater G, Burke LM (2017), "Acute-Weight-Loss Strategies for Combat ' +
              'Sports and Effects on Competitive Performance", Int J Sports Physiol Perform ' +
              '12(2):142–151.',
      notes: [
        'The acute total is filled from gut content first, then glycogen water, and only ' +
        'the remainder from fluid — dehydration is last because it is the part that hurts people.',
        'Above 8% acute loss no schedule is produced at all. Athletes have died in that range.',
      ],
    };
  };

  E.sleepConsistency = function (logs) {
    const c = V.study.consistency(logs);
    if (c == null) return null;
    return {
      key: 'sleep-consistency',
      title: 'Sleep consistency',
      formula:
        'For bed and wake times, unwrapped across midnight:\n' +
        '  sd = standard deviation of the last 14 nights\n' +
        '  score = 100 − ((mean sd − 30 min) ÷ 90) × 100, clamped 0–100',
      inputs: [['Nights used', String(Math.min(14, logs.length))]],
      steps: [['Score', '30 min spread = 100 · 120 min spread = 0', String(c)]],
      result: c + '/100',
      source: 'Regularity is scored separately from duration because it independently ' +
              'predicts cardiometabolic and mortality outcomes — see Windred et al. (2024), ' +
              'SLEEP 47(1), where regularity outperformed duration.',
      notes: ['Times near midnight are unwrapped before averaging, so 23:50 and 00:10 count ' +
              'as 20 minutes apart rather than 23 hours.'],
    };
  };

  E.strain = function (strain, baseline) {
    if (!strain || !baseline) return null;
    const relCardio = baseline.cardio > 0 ? strain.cardio / baseline.cardio : 0;
    const relStrength = baseline.strength > 0 ? strain.strength / baseline.strength : 0;

    return {
      key: 'strain',
      title: 'Strain',
      formula:
        'relative = today_cardio ÷ usual_cardio  +  today_strength ÷ usual_strength\n' +
        'strain   = 21 × √(relative ÷ 8), clamped to 0–21',
      inputs: [
        ['Cardio today', n(strain.cardio, 0) + ' MET-min'],
        ['Usual cardio', n(baseline.cardio, 0) + ' MET-min/day'],
        ['Strength today', n(strain.strength, 0) + ' kg lifted'],
        ['Usual strength', n(baseline.strength, 0) + ' kg/day'],
        ['Baseline window', baseline.n + ' days'],
      ],
      steps: [
        ['Cardio ratio', `${n(strain.cardio, 0)} ÷ ${n(baseline.cardio, 0)}`, n(relCardio, 2)],
        ['Strength ratio', `${n(strain.strength, 0)} ÷ ${n(baseline.strength, 0)}`, n(relStrength, 2)],
        ['Relative load', `${n(relCardio, 2)} + ${n(relStrength, 2)}`, n(strain.relative, 2)],
        ['Strain', `21 × √(${n(strain.relative, 2)} ÷ 8)`, n(strain.value, 1) + ' / 21'],
      ],
      result: n(strain.value, 1) + ' / 21 — ' + strain.label,
      source: 'MET values from Ainsworth BE et al. (2011), "2011 Compendium of Physical ' +
              'Activities", Med Sci Sports Exerc 43(8):1575–81. Tonnage is the standard ' +
              'sets × reps × load measure of strength work.',
      notes: [
        'This is NOT the Whoop strain score, despite sharing the 0–21 range. Whoop derives ' +
        'theirs from time spent in heart rate zones; this app has no continuous heart rate, ' +
        'so this is computed from training volume instead. The two will disagree — most ' +
        'obviously on a day that was physiologically hard but mechanically light, such as ' +
        'training in heat or while ill.',
        'The scale is personal, not absolute. A day at exactly your usual load scores about ' +
        '10.5, so the number only means anything relative to your own recent training.',
        'The square root is a presentation choice — it compresses the top of the scale so a ' +
        'single enormous day cannot dominate. It is not fitted to any physiological model.',
        'Steps above 3000 a day are counted as walking at 3.5 METs. The first 3000 are ' +
        'treated as ordinary movement rather than training.',
      ],
    };
  };

  E.physiologicalStress = function (physio, rhrBaseline, hrvBaseline) {
    if (!physio) return null;
    return {
      key: 'physiological-stress',
      title: 'Body stress',
      formula:
        'z       = (today − your mean) ÷ your standard deviation\n' +
        'combine = mean of (z of resting HR) and (−z of HRV)\n' +
        'score   = 50 + combine × 25, clamped 0–100',
      inputs: physio.parts.map((p) => [
        p.key === 'rhr' ? 'Resting HR (z)' : 'HRV (z, sign flipped)',
        n(p.z, 2),
      ]).concat([
        ['Resting HR baseline', rhrBaseline ? `${n(rhrBaseline.mean, 0)} ± ${n(rhrBaseline.sd, 1)} bpm over ${rhrBaseline.n} days` : 'not enough data'],
        ['HRV baseline', hrvBaseline ? `${n(hrvBaseline.mean, 0)} ± ${n(hrvBaseline.sd, 1)} ms over ${hrvBaseline.n} days` : 'not enough data'],
      ]),
      steps: [
        ['Combined z', physio.parts.map((p) => n(p.z, 2)).join(' + ') + ' ÷ ' + physio.parts.length,
          n(V.sum(physio.parts, (p) => p.z) / physio.parts.length, 2)],
        ['Score', `50 + ${n(V.sum(physio.parts, (p) => p.z) / physio.parts.length, 2)} × 25`, String(physio.score) + '/100'],
      ],
      result: physio.score + '/100 — ' + physio.label,
      source: 'Sympathetic activation raises resting heart rate and suppresses heart rate ' +
              'variability. Task Force of the European Society of Cardiology and NASPE ' +
              '(1996), "Heart rate variability: standards of measurement, physiological ' +
              'interpretation, and clinical use", Circulation 93(5):1043–65.',
      notes: [
        'Judged entirely against your own history, never a population range. Absolute HRV ' +
        'varies several-fold between healthy people, so a population band would be noise.',
        'This is not how stressed you feel, which the app asks you separately. When the two ' +
        'disagree, that disagreement is the useful signal.',
        physio.single
          ? 'Only one of the two signals was available today, so this is weaker than it ' +
            'looks. Logging both makes it considerably more reliable.'
          : 'Both resting heart rate and HRV contributed.',
        'Illness, alcohol, poor sleep and heat all move these markers as much as training ' +
        'does. A high score says the load is there, not where it came from.',
      ],
    };
  };

  E.soundExposure = function (dba) {
    if (dba == null) return null;
    const allowed = V.sound.allowedMinutes(dba);
    return {
      key: 'sound-exposure',
      title: 'Safe listening time',
      formula: 'T = 480 minutes ÷ 2^((L − 85) ÷ 3)',
      inputs: [
        ['Measured level', n(dba, 0) + ' dBA'],
        ['Criterion', '85 dBA for 480 minutes'],
        ['Exchange rate', '3 dB doubles the energy, so halves the time'],
      ],
      steps: [
        ['Excess over 85 dBA', `${n(dba, 0)} − 85`, n(dba - 85, 0) + ' dB'],
        ['Halvings', `${n(dba - 85, 0)} ÷ 3`, n((dba - 85) / 3, 2)],
        ['Allowed time', `480 ÷ 2^${n((dba - 85) / 3, 2)}`, V.sound.formatDuration(allowed)],
      ],
      result: V.sound.formatDuration(allowed) + ' at ' + n(dba, 0) + ' dBA',
      source: 'NIOSH (1998), "Criteria for a Recommended Standard: Occupational Noise ' +
              'Exposure", DHHS Publication 98-126. Headphone figures instead use the WHO / ' +
              'ITU-T H.870 limit of 40 hours per week at 80 dBA.',
      notes: [
        'The 3 dB exchange rate is the physically correct one and is used by NIOSH and the ' +
        'EU. The older OSHA regulatory limit uses 5 dB, which is more permissive and is not ' +
        'considered protective.',
        'Levels measured with the phone microphone are estimates. Phone mics have no ' +
        'published sensitivity and most compress and then clip above roughly 100 dBA, so ' +
        'very loud rooms read lower than they really are.',
        'Hearing damage is cumulative across the day. A loud commute and a loud gym add ' +
        'together — neither is assessed in isolation.',
      ],
    };
  };

  // =========================================================================
  // Rendering
  // =========================================================================

  /**
   * Build the bug report as text.
   *
   * This used to be stuffed into a GitHub issue URL as a query parameter. That was a
   * privacy bug: `inputs` contains real body metrics — weight, height, body fat, age, sex
   * — and simply CLICKING the link issued a GET carrying them to GitHub, where they landed
   * in request logs whether or not the issue was ever submitted. The copy underneath even
   * claimed nothing was sent until you submitted it.
   *
   * Now the report is copied to the clipboard and a blank issue form is opened, so the
   * data only travels if the user pastes it and presses submit.
   */
  function reportText(spec) {
    const body = [
      '**Calculation:** ' + spec.title,
      '',
      '**What I think is wrong:**',
      '<!-- describe what looks incorrect, and what you expected instead -->',
      '',
      '---',
      '',
      '### Formula used',
      '```',
      spec.formula,
      '```',
      '',
      '### Inputs',
      ...spec.inputs.map(([k, v]) => `- ${k}: ${v}`),
      '',
      '### Steps',
      ...spec.steps.map(([k, expr, val]) => `- ${k}: ${expr ? expr + ' = ' : ''}${val}`),
      '',
      '### Result',
      spec.result,
      '',
      '### Source',
      spec.source,
      '',
      '---',
      `_App: ${location.origin}${location.pathname} · reported ${new Date().toISOString()}_`,
    ].join('\n');

    return body;
  }

  /** Render a spec as a sheet. */
  E.open = function (spec) {
    if (!spec) return V.toast('Not enough data to explain this yet');

    V.ui.sheet(spec.title, (body) => {
      body.appendChild(
        V.el('div', { className: 'good-box' }, [
          V.el('div', { html: '<strong>Result: </strong>' + V.esc(spec.result) }),
        ]),
      );

      body.appendChild(V.ui.sectionTitle('Formula'));
      body.appendChild(V.el('pre', { className: 'formula', text: spec.formula }));

      body.appendChild(V.ui.sectionTitle('Your inputs'));
      body.appendChild(V.ui.list(spec.inputs.map(([k, v]) => V.ui.row({ title: k, value: String(v) }))));

      body.appendChild(V.ui.sectionTitle('Step by step'));
      body.appendChild(
        V.ui.list(spec.steps.map(([k, expr, val]) =>
          V.ui.row({ title: k, sub: expr || undefined, value: String(val) }))),
      );

      body.appendChild(V.ui.sectionTitle('Source'));
      body.appendChild(V.el('div', { className: 'hint', text: spec.source }));

      if (spec.notes && spec.notes.length) {
        body.appendChild(V.ui.sectionTitle('Worth knowing'));
        for (const note of spec.notes.filter(Boolean)) {
          body.appendChild(V.el('div', { className: 'hint', text: note }));
        }
      }

      body.appendChild(V.el('div', { style: { height: '20px' } }));

      const reportBox = V.el('div');
      body.appendChild(
        V.ui.button('Report a problem with this calculation', async () => {
          const text = reportText(spec);
          let copied = false;
          try {
            await navigator.clipboard.writeText(text);
            copied = true;
          } catch (err) {
            /* Clipboard can be blocked; the text is shown below either way. */
          }

          reportBox.innerHTML = '';
          reportBox.appendChild(
            V.el('div', {
              className: 'hint',
              text: copied
                ? 'Report copied. Paste it into the issue, check nothing personal is in it, then submit.'
                : 'Clipboard was blocked — select and copy the text below, then paste it into the issue.',
            }),
          );
          if (!copied) reportBox.appendChild(V.el('pre', { className: 'formula', text }));

          reportBox.appendChild(V.el('div', { style: { height: '8px' } }));
          reportBox.appendChild(
            V.el('a', {
              className: 'btn btn-danger',
              // A blank form — no query string, so nothing personal is in the request.
              href: REPO + '/issues/new',
              target: '_blank',
              rel: 'noopener noreferrer',
              text: 'Open a blank GitHub issue',
              style: { textDecoration: 'none' },
            }),
          );
        }, 'btn-danger'),
      );
      body.appendChild(reportBox);
      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'The report contains the formula, your inputs and every step above, so the ' +
                'problem can be reproduced. Those inputs include real body measurements, so ' +
                'it is copied to your clipboard rather than put in a link — nothing reaches ' +
                'GitHub until you paste it in and submit.',
        }),
      );
    });
  };

  /** Small circled-i button that opens an explanation. */
  E.button = function (buildSpec) {
    return V.el('button', {
      className: 'explain-btn',
      type: 'button',
      text: 'ⓘ',
      title: 'How is this calculated?',
      'aria-label': 'How is this calculated?',
      on: {
        click: async (e) => {
          e.stopPropagation();
          try {
            E.open(await buildSpec());
          } catch (err) {
            V.toast('Could not build the explanation');
            console.error(err);
          }
        },
      },
    });
  };

  E.REPO = REPO;
  V.explain = E;
})(window.V);
