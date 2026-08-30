/*
 * Ygeia — interpretation bands for vital signs.
 *
 * A number with no context is not actionable. "SpO2 94%" means nothing to most people;
 * "slightly below the usual range — worth a mention if it stays there" does.
 *
 * Two hard rules run through this file:
 *
 *   1. Nothing here diagnoses. These are reference ranges for a healthy adult at rest.
 *      Where a reading falls outside one, the wording points at a clinician and stops.
 *      A tracking app is not in a position to know why a number moved.
 *
 *   2. Where a range is personal rather than population-wide it takes a baseline
 *      argument. HRV is the clearest case: 30 ms is unremarkable for one person and
 *      alarming for another, so an absolute HRV band would be actively misleading.
 *
 * Pure functions. No DOM, no storage.
 */
(function (V) {
  'use strict';

  const T = {};

  /** How many days of history a personal baseline is built from. */
  T.BASELINE_DAYS = 28;
  /** Below this many samples a baseline is too thin to compare against. */
  T.BASELINE_MIN_SAMPLES = 7;

  // =========================================================================
  // Personal baselines
  // =========================================================================

  /**
   * Trailing mean and standard deviation of a daily series.
   *
   * @param {Array} series [{date, value}] oldest first, as V.store.metrics.daily returns
   * @param {number} [days] window length, default BASELINE_DAYS
   * @returns {{mean, sd, n}|null} null when there is not enough history to be meaningful
   */
  T.baseline = function (series, days) {
    if (!series || !series.length) return null;
    const window = series.slice(-(days || T.BASELINE_DAYS));
    const n = window.length;
    if (n < T.BASELINE_MIN_SAMPLES) return null;

    const mean = V.sum(window, (x) => x.value) / n;
    // Population SD, not sample SD: this describes the window we have, it does not
    // try to infer the spread of some larger population the days were drawn from.
    const variance = V.sum(window, (x) => (x.value - mean) * (x.value - mean)) / n;
    return { mean, sd: Math.sqrt(variance), n };
  };

  /**
   * How far a reading sits from the person's own normal, in standard deviations.
   *
   * Returns null when the baseline is flat (sd 0) — dividing by it would produce
   * Infinity and paint every reading as an emergency.
   */
  T.deviation = function (value, baseline) {
    if (value == null || !baseline || !baseline.sd) return null;
    return (value - baseline.mean) / baseline.sd;
  };

  // =========================================================================
  // Population reference bands
  // =========================================================================

  /**
   * Peripheral oxygen saturation.
   *
   * 95–100% is the normal resting range for a healthy adult at sea level; below 95%
   * is hypoxaemia and below 90% is the threshold at which clinical guidance treats it
   * as urgent (WHO Pulse Oximetry Training Manual, 2011; NICE NG191).
   *
   * The skin-tone caveat is not optional. Pulse oximeters work by shining light through
   * tissue, and melanin absorbs some of it. Occult hypoxaemia — a true SpO2 below 88%
   * while the device reads 92–96% — was roughly three times more common in Black than
   * White patients (Sjoding et al., NEJM 2020). A consumer wrist sensor is less accurate
   * than the hospital fingertip devices in that study, not more. Reading high is the
   * dangerous direction to be wrong in, so the app says so rather than burying it.
   */
  T.spo2Band = function (pct) {
    if (pct == null) return null;
    if (pct >= 95) return { label: 'Normal range', color: 'var(--good)' };
    if (pct >= 91) return { label: 'Below the usual range', color: 'var(--warn)' };
    return { label: 'Low — worth medical advice', color: 'var(--bad)' };
  };

  T.spo2Caveat = function (pct) {
    const base = 'Wrist and fingertip sensors are consumer devices, not medical ones. ' +
                 'They read high on darker skin, so a normal number is weaker evidence ' +
                 'than a low one.';
    if (pct != null && pct < 95) {
      return 'A single low reading is often just a bad seal, a cold hand or movement — ' +
             're-measure at rest before reading anything into it. If it stays here, or ' +
             'you are breathless, that is a conversation for a doctor. ' + base;
    }
    return base;
  };

  /**
   * Respiratory rate at rest.
   *
   * 12–20 breaths/min is the standard adult reference range, and 12–25 the range most
   * early-warning scores treat as unremarkable (Royal College of Physicians NEWS2, 2017).
   * Sleep-tracking wearables report a nightly average, which typically runs at the lower
   * end — an overnight figure of 14 is not the same measurement as a clinic one.
   */
  T.respiratoryRateBand = function (brpm) {
    if (brpm == null) return null;
    if (brpm < 10) return { label: 'Unusually low', color: 'var(--warn)' };
    if (brpm <= 20) return { label: 'Normal range', color: 'var(--good)' };
    if (brpm <= 24) return { label: 'Slightly raised', color: 'var(--warn)' };
    return { label: 'High — worth medical advice', color: 'var(--bad)' };
  };

  /**
   * Resting heart rate.
   *
   * 60–100 bpm is the textbook adult range, but the lower bound is close to useless for
   * anyone who trains: endurance athletes routinely sit in the 40s, and calling that
   * bradycardia would be nonsense in an app that also tracks barbell work. So a low RHR
   * is reported as the fitness marker it usually is, and only the genuinely low end is
   * flagged (Nanchen, Heart 2018; Jensen et al., Heart 2013).
   */
  T.restingHrBand = function (bpm) {
    if (bpm == null) return null;
    if (bpm < 40) return { label: 'Very low — worth mentioning to a doctor', color: 'var(--warn)' };
    if (bpm < 50) return { label: 'Athletic', color: 'var(--good)' };
    if (bpm < 60) return { label: 'Excellent', color: 'var(--good)' };
    if (bpm <= 70) return { label: 'Healthy range', color: 'var(--good)' };
    if (bpm <= 80) return { label: 'Average', color: 'var(--text-dim)' };
    if (bpm <= 100) return { label: 'Above average — trainable', color: 'var(--warn)' };
    return { label: 'High at rest — worth medical advice', color: 'var(--bad)' };
  };

  /**
   * Heart rate variability (SDNN), judged only against the person's own history.
   *
   * Absolute HRV varies several-fold between healthy people — by age, sex, measurement
   * window and device — so a population band would be meaningless. What carries
   * information is the direction of travel against your own normal (Plews et al.,
   * Sports Medicine 2013). With no baseline yet, this says so rather than guessing.
   */
  T.hrvBand = function (ms, baseline) {
    if (ms == null) return null;
    if (!baseline) {
      return { label: 'Building your baseline', color: 'var(--text-dim)', needsBaseline: true };
    }
    const z = T.deviation(ms, baseline);
    if (z == null) return { label: 'Steady', color: 'var(--text-dim)' };
    if (z <= -1.5) return { label: 'Well below your normal', color: 'var(--bad)' };
    if (z <= -0.75) return { label: 'Below your normal', color: 'var(--warn)' };
    if (z < 0.75) return { label: 'Around your normal', color: 'var(--good)' };
    return { label: 'Above your normal', color: 'var(--good)' };
  };

  /**
   * Body temperature.
   *
   * 36.1–37.2 °C is the commonly cited normal oral range, and 38 °C is the standard
   * fever threshold (NICE CG160). Normal body temperature is not 37.0 — that figure
   * comes from Wunderlich's 1868 dataset and modern populations average around 36.6,
   * with roughly half a degree of daily swing (Protsiv et al., eLife 2020).
   */
  T.bodyTempBand = function (c) {
    if (c == null) return null;
    if (c < 35) return { label: 'Hypothermic — seek help', color: 'var(--bad)' };
    if (c < 36.1) return { label: 'Below the usual range', color: 'var(--warn)' };
    if (c <= 37.2) return { label: 'Normal range', color: 'var(--good)' };
    if (c < 38) return { label: 'Slightly raised', color: 'var(--warn)' };
    if (c < 39.5) return { label: 'Fever', color: 'var(--bad)' };
    return { label: 'High fever — seek help', color: 'var(--bad)' };
  };

  // =========================================================================
  // Physiological stress signal
  // =========================================================================

  /**
   * A stress estimate from autonomic markers, on 0–100 where higher means more strain.
   *
   * The physiology is well established: sympathetic activation raises resting heart rate
   * and suppresses heart rate variability, and both respond to training load, illness,
   * alcohol and poor sleep (Task Force of the ESC/NASPE, Circulation 1996). Combining
   * the two z-scores is a deliberately crude summary of that, and it is only as good as
   * the baseline behind it.
   *
   * This is NOT the same thing as how stressed you feel, which is why the app collects
   * that separately and shows them side by side. The interesting case is when they
   * disagree.
   *
   * @returns {{score, label, color, parts}|null} null without enough baseline history
   */
  T.physiologicalStress = function (o) {
    const rhrZ = T.deviation(o.restingHr, o.restingHrBaseline);
    const hrvZ = T.deviation(o.hrv, o.hrvBaseline);
    if (rhrZ == null && hrvZ == null) return null;

    // A raised RHR and a suppressed HRV both point the same way, so HRV's sign flips.
    const parts = [];
    if (rhrZ != null) parts.push({ key: 'rhr', z: rhrZ });
    if (hrvZ != null) parts.push({ key: 'hrv', z: -hrvZ });

    const meanZ = V.sum(parts, (p) => p.z) / parts.length;
    // Map roughly -2..+2 SD onto 0..100. Two SD either side covers ~95% of days, so the
    // scale spends its resolution where the data actually lives instead of on outliers.
    const score = Math.round(V.clamp(50 + meanZ * 25, 0, 100));
    // Recovery is the same measurement read the other way up. Shown as well as the stress
    // figure because "62% recovered" is the form people act on, and inverting a score in
    // your head is a needless step.
    const recovery = 100 - score;

    let label = 'Typical for you';
    let color = 'var(--good)';
    if (score >= 80) { label = 'High strain'; color = 'var(--bad)'; }
    else if (score >= 65) { label = 'Elevated'; color = 'var(--warn)'; }
    else if (score <= 30) { label = 'Well recovered'; color = 'var(--good)'; }

    // Name the actual numbers behind the score. "Resting HR 6 bpm above your normal" is
    // checkable against the Body tab; a bare 75/100 is not.
    const bits = [];
    if (o.restingHr != null && o.restingHrBaseline) {
      const d = o.restingHr - o.restingHrBaseline.mean;
      bits.push(`resting HR ${V.fmt(Math.abs(d), 0)} bpm ${d >= 0 ? 'above' : 'below'} your normal`);
    }
    if (o.hrv != null && o.hrvBaseline) {
      const d = o.hrv - o.hrvBaseline.mean;
      bits.push(`HRV ${V.fmt(Math.abs(d), 0)} ms ${d >= 0 ? 'above' : 'below'} your normal`);
    }
    const detail = bits.length
      ? bits.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.'
      : null;

    return { score, recovery, label, color, detail, parts, single: parts.length === 1 };
  };

  V.vitals = T;
})(window.V);
