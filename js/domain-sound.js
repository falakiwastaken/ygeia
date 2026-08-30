/*
 * Ygeia — noise exposure and hearing risk.
 *
 * Noise-induced hearing loss is cumulative, painless and permanent. It is also almost
 * entirely preventable, and the thing that prevents it is knowing that the room you are
 * standing in is loud enough to matter. A number on its own does not do that — "97 dBA"
 * means nothing to most people, while "you have about 30 minutes at this level" does.
 * So everything here converts a level into a time.
 *
 * Two exposure models, because they answer different questions:
 *
 *   NIOSH occupational — a daily dose. 85 dBA for 8 hours, halving the allowed time for
 *   every 3 dB, which is what "equal energy" means physically. Use for a room you are in.
 *
 *   WHO/ITU-T H.870 — a weekly dose for personal listening: 80 dBA for 40 hours a week
 *   in adults. This is the model behind Apple's headphone notifications, which is why
 *   the headphone figures here use it rather than the occupational one.
 *
 * Pure functions. No DOM, no storage.
 */
(function (V) {
  'use strict';

  const S = {};

  // =========================================================================
  // Reference constants
  // =========================================================================

  /** NIOSH REL: 85 dBA time-weighted over 8 hours (NIOSH Publication 98-126). */
  S.NIOSH_CRITERION_DB = 85;
  S.NIOSH_CRITERION_MIN = 480;
  /**
   * The exchange rate: how many dB it takes to double the sound energy, and therefore
   * to halve the safe time. 3 dB is the physically correct figure and the one NIOSH and
   * the EU use. OSHA's older US regulatory limit uses 5 dB, which is more permissive and
   * not protective — this app follows NIOSH.
   */
  S.EXCHANGE_RATE_DB = 3;

  /** WHO / ITU-T H.870: 80 dBA for 40 hours per week for adults. */
  S.WHO_WEEKLY_CRITERION_DB = 80;
  S.WHO_WEEKLY_MIN = 40 * 60;

  /** Above this, exposure is hazardous however brief (NIOSH ceiling guidance). */
  S.PAIN_THRESHOLD_DB = 120;

  // =========================================================================
  // Decibel arithmetic
  // =========================================================================

  /**
   * The energy mean of a set of levels.
   *
   * Decibels are logarithmic, so they cannot be averaged directly. An hour at 60 dB and
   * an hour at 90 dB is not 75 dB of exposure — the 90 dB hour carries a thousand times
   * the energy and dominates completely, giving about 87. Averaging arithmetically would
   * understate a day's real exposure by an enormous margin, always in the unsafe
   * direction, which is why this exists rather than reusing a plain mean anywhere.
   */
  S.meanDb = function (levels) {
    const vals = (levels || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length) return null;
    const energy = V.sum(vals, (v) => Math.pow(10, v / 10)) / vals.length;
    return 10 * Math.log10(energy);
  };

  /** Combine two independent sources — two 60 dB sources together make 63 dB, not 120. */
  S.addDb = function (a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return 10 * Math.log10(Math.pow(10, a / 10) + Math.pow(10, b / 10));
  };

  // =========================================================================
  // Risk bands
  // =========================================================================

  /**
   * What a level means. This is the "safe / loud / dangerous" call.
   *
   * Boundaries: 70 dBA is the level below which the EPA found no measurable hearing loss
   * over a lifetime of exposure; 85 is the NIOSH action level; 100 leaves only minutes;
   * 120 is around the threshold of pain and risks immediate injury.
   */
  S.band = function (dba) {
    if (dba == null) return null;
    if (dba < 55) return { key: 'quiet', label: 'Quiet', color: 'var(--good)', safe: true };
    if (dba < 70) return { key: 'safe', label: 'Safe — no time limit', color: 'var(--good)', safe: true };
    if (dba < 85) return { key: 'elevated', label: 'Elevated — fine for a while', color: 'var(--warn)', safe: true };
    if (dba < 100) return { key: 'loud', label: 'Loud — damage accumulates', color: 'var(--warn)', safe: false };
    if (dba < S.PAIN_THRESHOLD_DB) return { key: 'dangerous', label: 'Dangerous — minutes, not hours', color: 'var(--bad)', safe: false };
    return { key: 'painful', label: 'Painful — immediate risk', color: 'var(--bad)', safe: false };
  };

  /** Everyday anchors, so a number lands somewhere recognisable. */
  S.reference = function (dba) {
    if (dba == null) return null;
    if (dba < 40) return 'about as quiet as a library';
    if (dba < 55) return 'about the level of a quiet home';
    if (dba < 65) return 'about the level of a normal conversation';
    if (dba < 75) return 'about the level of a busy street';
    if (dba < 85) return 'about the level of heavy traffic';
    if (dba < 95) return 'about the level of a food blender or a motorbike';
    if (dba < 105) return 'about the level of a nightclub or a power tool';
    if (dba < 115) return 'about the level of a rock concert';
    return 'about the level of a siren at close range';
  };

  // =========================================================================
  // Exposure time
  // =========================================================================

  /**
   * How long this level is safe for in one day, in minutes (NIOSH).
   *
   *   T = 480 / 2^((L - 85) / 3)
   *
   * So 85 dBA gives 8 hours, 88 gives 4, 91 gives 2, and 100 gives 15 minutes.
   * Returns Infinity below 70 dBA, where no cumulative limit applies.
   */
  S.allowedMinutes = function (dba) {
    if (dba == null) return null;
    if (dba < 70) return Infinity;
    return S.NIOSH_CRITERION_MIN / Math.pow(2, (dba - S.NIOSH_CRITERION_DB) / S.EXCHANGE_RATE_DB);
  };

  /** The same calculation against the WHO weekly allowance, used for headphones. */
  S.allowedMinutesWeekly = function (dba) {
    if (dba == null) return null;
    if (dba < 70) return Infinity;
    return S.WHO_WEEKLY_MIN / Math.pow(2, (dba - S.WHO_WEEKLY_CRITERION_DB) / S.EXCHANGE_RATE_DB);
  };

  /** Human phrasing for an allowance. */
  S.formatDuration = function (minutes) {
    if (minutes == null) return null;
    if (!Number.isFinite(minutes)) return 'no limit';
    if (minutes < 1) return 'under a minute';
    if (minutes < 90) return V.pluralise(Math.round(minutes), 'minute');
    const hours = minutes / 60;
    return V.pluralise(V.round(hours, hours < 10 ? 1 : 0), 'hour');
  };

  // =========================================================================
  // Dose
  // =========================================================================

  /**
   * Percentage of a day's safe exposure used up.
   *
   * @param {Array} samples [{ dba, minutes }]
   * @returns {{percent, overLimit, equivalentDb}}
   */
  S.dailyDose = function (samples) {
    let percent = 0;
    let totalMinutes = 0;
    let energyMinutes = 0;

    for (const s of samples || []) {
      if (s == null || s.dba == null || !s.minutes) continue;
      const allowed = S.allowedMinutes(s.dba);
      if (Number.isFinite(allowed)) percent += (s.minutes / allowed) * 100;
      totalMinutes += s.minutes;
      energyMinutes += Math.pow(10, s.dba / 10) * s.minutes;
    }

    // The single steady level that would have done the same damage over the same time.
    const equivalentDb = totalMinutes > 0 ? 10 * Math.log10(energyMinutes / totalMinutes) : null;

    return { percent: V.round(percent, 1), overLimit: percent > 100, equivalentDb, totalMinutes };
  };

  /**
   * Apple's AirPods-style headphone dose: a rolling 7-day percentage against the WHO
   * weekly allowance, where 100% is the point their Health app flags as too loud.
   *
   * @param {Array} days [{ date, dba, minutes }] the last seven days
   */
  S.weeklyHeadphoneDose = function (days) {
    let percent = 0;
    for (const d of days || []) {
      if (d == null || d.dba == null || !d.minutes) continue;
      const allowed = S.allowedMinutesWeekly(d.dba);
      if (Number.isFinite(allowed)) percent += (d.minutes / allowed) * 100;
    }
    percent = V.round(percent, 0);

    let label = 'Within the weekly limit';
    let color = 'var(--good)';
    if (percent > 100) { label = 'Over the weekly limit'; color = 'var(--bad)'; }
    else if (percent >= 80) { label = 'Close to the weekly limit'; color = 'var(--warn)'; }

    return { percent, label, color, overLimit: percent > 100 };
  };

  /**
   * What to actually do about a level.
   * Deliberately concrete — "wear plugs" is useful, "consider your hearing health" is not.
   */
  S.advice = function (dba) {
    if (dba == null) return null;
    const band = S.band(dba);
    if (band.safe && dba < 70) return null;
    if (dba < 85) {
      return 'Not damaging on its own, but a whole day at this level is tiring and it ' +
             'adds to everything else you were exposed to today.';
    }
    const time = S.formatDuration(S.allowedMinutes(dba));
    if (dba < 100) {
      return `At this level you have about ${time} before the exposure starts doing ` +
             'permanent damage. Foam plugs cut 25–30 dB and would take that back to a ' +
             'full day.';
    }
    if (dba < S.PAIN_THRESHOLD_DB) {
      return `About ${time} at this level is enough to cause permanent hearing loss. ` +
             'Put plugs in or move away from the source.';
    }
    return 'This is loud enough to injure your hearing immediately, with no safe ' +
           'duration. Leave or protect your ears now.';
  };

  // =========================================================================
  // Microphone estimation
  // =========================================================================

  /**
   * Convert an RMS amplitude from the Web Audio API into an estimated dBA.
   *
   * The RMS of a float sample buffer gives dBFS — decibels relative to digital full
   * scale, which is a number between roughly -100 and 0 with no fixed relationship to
   * sound pressure in the room. Turning it into dB SPL needs to know the microphone's
   * sensitivity, and a browser cannot ask for that. So the app carries a single offset
   * constant that the user can calibrate against a real meter.
   *
   * This is an estimate, and the UI must say so. Phone microphones also compress and
   * then clip somewhere around 100–110 dBA, which means the levels that matter most are
   * exactly the ones measured worst.
   */
  S.DEFAULT_MIC_OFFSET_DB = 90;

  S.rmsToDba = function (rms, offsetDb) {
    // Guard the log: a perfectly silent buffer is 0, and log10(0) is -Infinity.
    if (!rms || rms <= 0) return null;
    const dbfs = 20 * Math.log10(rms);
    return dbfs + (offsetDb == null ? S.DEFAULT_MIC_OFFSET_DB : offsetDb);
  };

  /** RMS of a float time-domain buffer. */
  S.rms = function (buffer) {
    if (!buffer || !buffer.length) return 0;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
  };

  V.sound = S;
})(window.V);
