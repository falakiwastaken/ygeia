/*
 * Ygeia — sleep and study.
 *
 * Pure functions. The two live together because they are genuinely coupled: sleep is
 * when memory consolidates, so a study plan that costs you sleep is usually a bad trade.
 */
(function (V) {
  'use strict';

  const S = {};

  // =========================================================================
  // Sleep
  // =========================================================================

  /**
   * A full sleep cycle averages ~90 minutes. Waking at the end of one, in light sleep,
   * feels far better than being pulled out of deep sleep mid-cycle — which is why the
   * planner works in whole cycles rather than round hours.
   *
   * It is a population average. Individual cycles run roughly 80–110 minutes.
   */
  S.CYCLE_MIN = 90;

  /** Typical time to fall asleep. Used as the default offset when planning a bedtime. */
  S.LATENCY_MIN = 15;

  /** Minutes since local midnight, from "HH:MM". */
  S.parseTime = function (hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };

  S.formatTime = function (minutes) {
    const m = ((minutes % 1440) + 1440) % 1440; // wrap across midnight, both directions
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  };

  /**
   * Bedtimes that land a wake-up at the end of a sleep cycle.
   * Returned longest-sleep-first, since more sleep is usually the better option.
   */
  S.bedtimesFor = function (wakeTimeMin, latencyMin) {
    const latency = latencyMin == null ? S.LATENCY_MIN : latencyMin;
    const out = [];
    for (const cycles of [6, 5, 4, 3]) {
      const sleepMin = cycles * S.CYCLE_MIN;
      out.push({
        cycles,
        hours: sleepMin / 60,
        bedtime: S.formatTime(wakeTimeMin - sleepMin - latency),
        // Under 6 hours is where cognitive impairment reliably shows up in the research.
        adequate: cycles >= 5,
      });
    }
    return out;
  };

  /** Wake times that complete whole cycles from a given bedtime. */
  S.wakeTimesFor = function (bedTimeMin, latencyMin) {
    const latency = latencyMin == null ? S.LATENCY_MIN : latencyMin;
    return [4, 5, 6].map((cycles) => ({
      cycles,
      hours: (cycles * S.CYCLE_MIN) / 60,
      wake: S.formatTime(bedTimeMin + latency + cycles * S.CYCLE_MIN),
      adequate: cycles >= 5,
    }));
  };

  /** Hours slept, handling the usual case where bedtime is before midnight. */
  S.duration = function (bedTimeMin, wakeTimeMin) {
    let mins = wakeTimeMin - bedTimeMin;
    if (mins <= 0) mins += 1440; // crossed midnight
    return mins / 60;
  };

  /**
   * Accumulated sleep debt over a window, in hours.
   * Only shortfalls count — a ten-hour Sunday does not repay a week of five-hour nights,
   * so surplus is deliberately not credited back.
   */
  S.sleepDebt = function (logs, targetHours, days) {
    const window = days || 14;
    const cutoff = V.addDays(V.today(), -window);
    let debt = 0;
    for (const l of logs) {
      if (l.date < cutoff) continue;
      const short = targetHours - l.hours;
      if (short > 0) debt += short;
    }
    return debt;
  };

  /**
   * Consistency score, 0–100, from the spread of bed and wake times.
   *
   * Regularity independently predicts health outcomes — arguably more strongly than
   * duration — so it is scored separately rather than folded into a single number.
   * A standard deviation of 30 minutes or less scores full marks; 2 hours scores zero.
   */
  S.consistency = function (logs) {
    const recent = logs.slice(-14).filter((l) => l.bedTimeMin != null && l.wakeTimeMin != null);
    if (recent.length < 3) return null;

    // Bedtimes near midnight wrap (23:50 and 00:10 are 20 minutes apart, not 23 hours),
    // so they are unwrapped relative to the first value before taking a deviation.
    const unwrap = (values) => {
      const base = values[0];
      return values.map((v) => {
        let d = v - base;
        if (d > 720) d -= 1440;
        if (d < -720) d += 1440;
        return base + d;
      });
    };

    const sd = (values) => {
      const mean = V.sum(values) / values.length;
      return Math.sqrt(V.sum(values.map((v) => (v - mean) ** 2)) / values.length);
    };

    const bedSd = sd(unwrap(recent.map((l) => l.bedTimeMin)));
    const wakeSd = sd(unwrap(recent.map((l) => l.wakeTimeMin)));
    const avgSd = (bedSd + wakeSd) / 2;

    return Math.round(V.clamp(100 - ((avgSd - 30) / 90) * 100, 0, 100));
  };

  /**
   * Overall sleep score for a night: duration against target, plus subjective quality
   * when it was recorded. Oversleeping is mildly penalised — consistently long sleep
   * tracks poorer outcomes, though usually as a symptom rather than a cause.
   */
  S.nightScore = function (log, targetHours) {
    if (!log || log.hours == null) return null;
    const ratio = log.hours / targetHours;
    let duration;
    if (ratio >= 0.95 && ratio <= 1.15) duration = 100;
    else if (ratio < 0.95) duration = V.clamp((ratio / 0.95) * 100, 0, 100);
    else duration = V.clamp(100 - (ratio - 1.15) * 120, 55, 100);

    if (log.quality == null) return Math.round(duration);
    // Subjective quality is 1–5; weighted lightly against measured duration.
    return Math.round(duration * 0.7 + ((log.quality - 1) / 4) * 100 * 0.3);
  };

  // =========================================================================
  // Spaced repetition (Leitner)
  // =========================================================================

  /**
   * Days until the next review for each box. Expanding intervals exploit the spacing
   * effect: each successful recall at a longer delay strengthens retention more than
   * massed repetition does.
   */
  S.LEITNER_INTERVALS = [1, 3, 7, 16, 35];

  /**
   * Create a two-sided card.
   *
   * `title` is still written alongside `front` because cards created before v4 had only a
   * title, and older backups restore into this shape. Keeping both means an old export can
   * be re-imported without special-casing.
   */
  S.newCard = function (o) {
    const front = (o.front || '').trim();
    const back = (o.back || '').trim();
    return {
      id: V.uid(),
      subjectId: o.subjectId || null,
      deckId: o.deckId || null,
      front,
      back,
      title: front,
      needsAnswer: !back,
      box: 0,
      createdAt: Date.now(),
      dueDate: V.addDays(V.today(), S.LEITNER_INTERVALS[0]),
      reviews: 0,
      lapses: 0,
    };
  };

  /** Retained for older call sites: a one-sided card is just a card with no back yet. */
  S.newReviewItem = function (subjectId, title) {
    return S.newCard({ subjectId, front: title });
  };

  /**
   * Grade a review.
   *
   * Remembering promotes the item one box. Forgetting sends it back to box 0 rather than
   * down one — a card you have genuinely lost needs rebuilding from short intervals, and
   * demoting gently is how leeches accumulate.
   */
  S.gradeReview = function (item, remembered) {
    const next = Object.assign({}, item);
    next.reviews = (item.reviews || 0) + 1;

    if (remembered) {
      next.box = Math.min(item.box + 1, S.LEITNER_INTERVALS.length - 1);
    } else {
      next.box = 0;
      next.lapses = (item.lapses || 0) + 1;
    }

    next.dueDate = V.addDays(V.today(), S.LEITNER_INTERVALS[next.box]);
    next.lastReviewedAt = Date.now();
    return next;
  };

  /** Items whose interval has elapsed, most overdue first. */
  S.dueItems = function (items, date) {
    const today = date || V.today();
    return items
      .filter((i) => i.dueDate <= today)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  };

  // =========================================================================
  // Answer checking
  // =========================================================================

  /**
   * Reduce an answer to what actually matters.
   *
   * Marking someone wrong for a capital letter, a trailing full stop or writing "the
   * mitochondrion" instead of "mitochondrion" teaches nothing and just breeds resentment
   * at the app. Accents are folded too, so "resume" matches "résumé".
   */
  S.normaliseAnswer = function (s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritics
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')             // punctuation to space
      .replace(/\b(a|an|the)\b/g, ' ')      // leading articles carry no meaning here
      .replace(/\s+/g, ' ')
      .trim();
  };

  /** Levenshtein distance, iterative with a single row. */
  function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(
          prev[j] + 1,
          row[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      prev = row;
    }
    return prev[b.length];
  }

  S.editDistance = editDistance;

  /**
   * Grade a typed answer.
   *
   * Returns `nearMiss` for a small number of typos, scaled to answer length — one slip in
   * a short word is proportionally a much bigger error than one in a long phrase. The UI
   * shows near misses as "you typed X, the answer was Y" and lets the learner decide,
   * rather than silently accepting or rejecting.
   */
  S.checkAnswer = function (typed, correct) {
    const a = S.normaliseAnswer(typed);
    const b = S.normaliseAnswer(correct);

    if (!a) return { correct: false, nearMiss: false, empty: true };
    if (a === b) return { correct: true, nearMiss: false };

    // Multiple acceptable answers can be written "x / y" or "x; y" on the back.
    const alternatives = String(correct || '').split(/[/;]|,\s(?=\w)/).map(S.normaliseAnswer).filter(Boolean);
    if (alternatives.length > 1 && alternatives.includes(a)) return { correct: true, nearMiss: false };

    const tolerance = b.length <= 4 ? 0 : b.length <= 8 ? 1 : 2;
    const distance = editDistance(a, b);

    return { correct: false, nearMiss: distance > 0 && distance <= tolerance, distance };
  };

  // =========================================================================
  // Quiz construction
  // =========================================================================

  /** Fisher-Yates. Returns a new array; the input is not mutated. */
  S.shuffle = function (arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  /**
   * Wrong answers for a multiple-choice question, drawn from other cards in the same deck
   * so they are plausible rather than absurd.
   *
   * Deduplicated by normalised text, and the correct answer can never appear as a
   * distractor even if another card happens to share it.
   */
  S.distractors = function (card, pool, count) {
    const want = count == null ? 3 : count;
    const correct = S.normaliseAnswer(card.back);
    const seen = new Set([correct]);
    const options = [];

    for (const other of S.shuffle(pool)) {
      if (other.id === card.id || !other.back) continue;
      const key = S.normaliseAnswer(other.back);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(other.back);
      if (options.length >= want) break;
    }
    return options;
  };

  /** True when a deck can support multiple choice at all. */
  S.canMultipleChoice = function (cards) {
    const distinct = new Set(cards.filter((c) => c.back).map((c) => S.normaliseAnswer(c.back)));
    return distinct.size >= 3;
  };

  // =========================================================================
  // Bulk import
  // =========================================================================

  /**
   * Parse pasted text into cards. Tries the given separator, then falls back to tab and
   * common dashes, so material copied out of a table or a revision guide mostly just works.
   */
  S.parseBulk = function (text, separator) {
    const seps = [separator, '\t', ' - ', ' — ', ' – ', ':', ','].filter(Boolean);
    const rows = [];
    const skipped = [];

    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      let split = null;
      for (const sep of seps) {
        const idx = line.indexOf(sep);
        // Require something on both sides, or it is not really a pair.
        if (idx > 0 && idx < line.length - sep.length) {
          split = [line.slice(0, idx).trim(), line.slice(idx + sep.length).trim()];
          break;
        }
      }

      if (split && split[0] && split[1]) rows.push({ front: split[0], back: split[1] });
      else skipped.push(line);
    }

    return { rows, skipped };
  };

  /** Serialise a deck back to pasteable text. */
  S.toBulkText = function (cards, separator) {
    const sep = separator || ' - ';
    return cards.map((c) => `${c.front}${sep}${c.back}`).join('\n');
  };

  // =========================================================================
  // Study planning
  // =========================================================================

  S.TECHNIQUES = [
    { value: 'recall', label: 'Active recall', quality: 1.0, note: 'Testing yourself. The most effective use of an hour.' },
    { value: 'practice', label: 'Practice problems', quality: 1.0, note: 'Applying it. As strong as recall for most subjects.' },
    { value: 'flashcards', label: 'Flashcards', quality: 0.95, note: 'Spaced recall — excellent for facts and vocabulary.' },
    { value: 'notes', label: 'Making notes', quality: 0.7, note: 'Useful for structuring, weaker for retention.' },
    { value: 'reading', label: 'Re-reading', quality: 0.4, note: 'Feels productive, retains poorly. Use sparingly.' },
    { value: 'lecture', label: 'Lectures / videos', quality: 0.5, note: 'Passive. Pair it with recall afterwards.' },
  ];

  /** Effective study minutes, discounting passive techniques. */
  S.effectiveMinutes = function (sessions) {
    return V.sum(sessions, (s) => {
      const t = S.TECHNIQUES.find((x) => x.value === s.technique);
      return (s.minutes || 0) * (t ? t.quality : 0.7);
    });
  };

  S.daysUntil = function (dateKey) {
    return V.daysBetween(V.today(), dateKey);
  };

  /**
   * Allocate remaining study time across subjects before their exams.
   *
   * Weighted by urgency (how soon) and by how far each subject is behind its target
   * hours, so the nearest and least-prepared subject gets the most time.
   */
  S.allocate = function (subjects, dailyMinutes, loggedBySubject) {
    const active = subjects
      .filter((s) => s.examDate && S.daysUntil(s.examDate) >= 0)
      .map((s) => {
        const days = Math.max(1, S.daysUntil(s.examDate));
        const targetMin = (s.targetHours || 20) * 60;
        const doneMin = loggedBySubject[s.id] || 0;
        const remaining = Math.max(0, targetMin - doneMin);
        return { subject: s, days, remaining, urgency: remaining / days };
      })
      .filter((x) => x.remaining > 0);

    const totalUrgency = V.sum(active, (x) => x.urgency);
    if (!totalUrgency) return [];

    return active
      .map((x) => ({
        subject: x.subject,
        daysLeft: x.days,
        remainingHours: x.remaining / 60,
        minutesToday: Math.round((x.urgency / totalUrgency) * dailyMinutes),
        // Needing more per day than the whole daily budget means the plan doesn't fit.
        behind: x.remaining / x.days > dailyMinutes,
      }))
      .sort((a, b) => a.daysLeft - b.daysLeft);
  };

  /**
   * Guidance on studying against a wake time.
   *
   * Two things drive this: memory consolidates during sleep, so material reviewed shortly
   * before bed is retained well; and cutting sleep to study is close to always a net loss,
   * because the deficit costs more recall than the extra hour adds.
   */
  S.studyWindowAdvice = function (wakeTimeMin, targetHours, plannedStudyEndMin) {
    const bedtime = wakeTimeMin - targetHours * 60 - S.LATENCY_MIN;
    const advice = [];

    // Screens and hard cognitive work delay sleep onset; leave a wind-down buffer.
    const lastStudy = bedtime - 60;
    advice.push({
      key: 'cutoff',
      text: `Stop studying by ${S.formatTime(lastStudy)} to protect a ${targetHours}h night ` +
            `(lights out ${S.formatTime(bedtime)}).`,
    });
    advice.push({
      key: 'review',
      text: `A short review in the 30 minutes before bed is well timed — sleep is when ` +
            `what you studied gets consolidated.`,
    });
    advice.push({
      key: 'morning',
      text: `Your sharpest window is roughly 2–4 hours after waking ` +
            `(${S.formatTime(wakeTimeMin + 120)}–${S.formatTime(wakeTimeMin + 240)}). ` +
            `Put your hardest subject there.`,
    });

    if (plannedStudyEndMin != null && plannedStudyEndMin > lastStudy) {
      const lost = (plannedStudyEndMin - lastStudy) / 60;
      advice.push({
        key: 'warning',
        warning: true,
        text: `Studying until ${S.formatTime(plannedStudyEndMin)} costs about ` +
              `${V.fmt(lost, 1)}h of sleep. Below ~6 hours, recall and attention degrade ` +
              `faster than the extra study adds. Sleep is usually the better trade.`,
      });
    }

    return advice;
  };

  /** Pomodoro-style block. 50/10 suits most study; 25/5 helps when focus is poor. */
  S.FOCUS_PRESETS = [
    { value: '25_5', label: '25 / 5', focusMin: 25, breakMin: 5, note: 'Classic Pomodoro — good when starting is hard' },
    { value: '50_10', label: '50 / 10', focusMin: 50, breakMin: 10, note: 'Deeper work, fewer interruptions' },
    { value: '90_20', label: '90 / 20', focusMin: 90, breakMin: 20, note: 'One full ultradian cycle — for strong focus days' },
  ];

  V.study = S;
})(window.V);
