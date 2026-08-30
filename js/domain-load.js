/*
 * Ygeia — daily training load: cardio, strength and a combined strain figure.
 *
 * Everything here is derived from data the app already holds — completed sets and logged
 * sport sessions. Nothing new is stored, so these numbers can never drift out of step
 * with the training history behind them.
 *
 * A NOTE ON "STRAIN", because the word is borrowed and the borrowing matters:
 *
 *   Whoop popularised a 0–21 strain score, and theirs is computed from time spent in
 *   heart-rate zones. This app has no continuous heart rate, so this one is computed
 *   from training volume instead — tonnage lifted and MET-minutes worked. It uses the
 *   same 0–21 range because that range is familiar and the app already needed a scale,
 *   NOT because the two are interchangeable. They will disagree, most obviously on a
 *   day that was physiologically hard but mechanically light (heat, illness, stress) or
 *   the reverse. The explain sheet says this outright and so does the UI.
 *
 * The scale is also personal rather than absolute. A day is scored against your own
 * trailing load, because "hard" only means anything relative to what you usually do.
 *
 * Pure functions. No DOM, no storage.
 */
(function (V) {
  'use strict';

  const L = {};

  /** Trailing window used to work out what a normal day looks like for this person. */
  L.BASELINE_DAYS = 28;
  /** The top of the scale, matching the range people already recognise. */
  L.MAX_STRAIN = 21;

  // =========================================================================
  // Component loads
  // =========================================================================

  /**
   * Strength load for a day, in kg of tonnage.
   *
   * Reuses V.domain.volume so warmup handling stays in one place — that function already
   * excludes warmups and incomplete sets, and duplicating the rule here is exactly how
   * the two would quietly diverge later.
   */
  L.strengthLoad = function (sets) {
    return V.domain.volume(sets || []);
  };

  /**
   * Cardio load for a day, in MET-minutes.
   *
   * Sport sessions carry their own MET value (see V.life.SPORTS). Steps are folded in at
   * a walking equivalent, but only the portion above a sedentary baseline — counting all
   * 8000 daily steps as deliberate exercise would make a desk day look like training.
   */
  L.SEDENTARY_STEPS = 3000;
  L.WALKING_MET = 3.5;
  /** Roughly 100 steps a minute at a normal walking cadence. */
  L.STEPS_PER_MINUTE = 100;

  L.cardioLoad = function (sportSessions, steps) {
    const fromSport = V.life.metMinutes(sportSessions || []);
    const active = Math.max(0, (steps || 0) - L.SEDENTARY_STEPS);
    const fromSteps = (active / L.STEPS_PER_MINUTE) * L.WALKING_MET;
    return fromSport + fromSteps;
  };

  /**
   * Put strength and cardio on one scale so they can be added.
   *
   * There is no principled physical conversion between a kilogram lifted and a MET-minute
   * worked — they measure different things. What can be done honestly is to express each
   * as a fraction of the person's own typical day and add those fractions. A day that is
   * average at both comes out at 1.0.
   */
  L.combinedLoad = function (cardio, strength, baseline) {
    const c = baseline && baseline.cardio > 0 ? cardio / baseline.cardio : 0;
    const s = baseline && baseline.strength > 0 ? strength / baseline.strength : 0;
    return c + s;
  };

  // =========================================================================
  // Baseline
  // =========================================================================

  /**
   * Typical daily load over the trailing window.
   *
   * Rest days are included in the mean on purpose: they are part of the training week,
   * and averaging over training days only would make every actual session look ordinary.
   *
   * @param {Array} days [{ date, cardio, strength }] oldest first
   */
  L.baseline = function (days, windowDays) {
    const window = (days || []).slice(-(windowDays || L.BASELINE_DAYS));
    if (!window.length) return null;
    return {
      cardio: V.sum(window, (d) => d.cardio || 0) / window.length,
      strength: V.sum(window, (d) => d.strength || 0) / window.length,
      n: window.length,
    };
  };

  // =========================================================================
  // Strain
  // =========================================================================

  /**
   * Reference relative load — the value that maps to the middle of the scale.
   *
   * relative = 1.0 is one average day's worth of one component, so an ordinary day that
   * has both cardio and lifting in it comes to 2.0. That is the day that should read as
   * "middle of the scale", which fixes the constant at 8: 21 × √(2/8) = 10.5.
   */
  L.REFERENCE_RELATIVE = 8;

  /**
   * Today's strain, 0–21.
   *
   * A day at exactly your average load scores about 10.5 — the middle of the scale — and
   * the curve compresses above that so a genuinely enormous day cannot run away with it.
   * Four times an average day is needed to reach 21. The square-root shape is chosen for
   * that compression, not fitted to anything; it is a presentation choice, and the
   * explain sheet says so.
   *
   * @returns {{value, label, color, cardio, strength, relative}|null}
   */
  L.strain = function (cardio, strength, baseline) {
    if (!baseline || (!baseline.cardio && !baseline.strength)) return null;

    const relative = L.combinedLoad(cardio, strength, baseline);
    const value = V.round(
      V.clamp(L.MAX_STRAIN * Math.sqrt(relative / L.REFERENCE_RELATIVE), 0, L.MAX_STRAIN),
      1,
    );
    const band = L.strainBand(value);

    return { value, relative, cardio, strength, label: band.label, color: band.color };
  };

  L.strainBand = function (value) {
    if (value == null) return { label: 'No data', color: 'var(--text-dim)' };
    if (value < 4) return { label: 'Rest', color: 'var(--text-dim)' };
    if (value < 9) return { label: 'Light', color: 'var(--recovery)' };
    if (value < 14) return { label: 'Moderate', color: 'var(--good)' };
    if (value < 18) return { label: 'Hard', color: 'var(--strain)' };
    return { label: 'All out', color: 'var(--bad)' };
  };

  /**
   * Acute:chronic workload ratio — the last 7 days against the last 28.
   *
   * A ratio much above 1.5 means load has ramped faster than the body has had time to
   * adapt to, which is associated with injury risk in team-sport cohorts (Gabbett, BJSM
   * 2016). The association is real but the method has been criticised heavily since
   * (Impellizzeri et al., 2020), so this is framed as a flag to look at, never a verdict.
   */
  L.acuteChronicRatio = function (days) {
    const list = days || [];
    if (list.length < 14) return null;

    const total = (window) => V.sum(window, (d) => (d.cardio || 0) + (d.strength || 0));
    const acute = total(list.slice(-7)) / 7;
    const chronic = total(list.slice(-28)) / Math.min(28, list.length);
    if (!chronic) return null;

    const ratio = acute / chronic;
    let label = 'Steady';
    let color = 'var(--good)';
    if (ratio > 1.5) { label = 'Ramping up fast'; color = 'var(--warn)'; }
    else if (ratio < 0.8) { label = 'Backing off'; color = 'var(--text-dim)'; }

    return { ratio: V.round(ratio, 2), label, color, acute, chronic };
  };

  V.load = L;
})(window.V);
