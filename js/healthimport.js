/*
 * Ygeia — Apple Health export importer.
 *
 * There is no browser API for HealthKit; a web app cannot read Apple Health directly.
 * What it CAN do is read the export the Health app produces:
 *
 *   Health app -> profile picture -> Export All Health Data -> Save to Files
 *   -> tap the .zip in Files to uncompress it -> import apple_health_export/export.xml
 *
 * The file is routinely 200 MB–1 GB. It is therefore streamed and aggregated to daily
 * values as it is read; the full document is never held in memory and never parsed with
 * DOMParser, which would exhaust the tab on a phone.
 */
(function (V) {
  'use strict';

  /** HealthKit record type -> our metric type. Anything unlisted is ignored. */
  const TYPE_MAP = {
    HKQuantityTypeIdentifierStepCount: 'steps',
    HKQuantityTypeIdentifierBodyMass: 'weight',
    HKQuantityTypeIdentifierBodyFatPercentage: 'body_fat_pct',
    HKQuantityTypeIdentifierLeanBodyMass: 'lean_mass',
    HKQuantityTypeIdentifierRestingHeartRate: 'resting_hr',
    HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'hrv',
    HKQuantityTypeIdentifierBloodPressureSystolic: 'systolic',
    HKQuantityTypeIdentifierBloodPressureDiastolic: 'diastolic',
    HKQuantityTypeIdentifierVO2Max: 'vo2max',
  };

  /** Metrics that accumulate across a day rather than being point readings. */
  const SUMMED = { steps: true };

  /**
   * Parse Apple's timestamp format: "2024-03-01 07:14:22 +0000".
   * Safari will not parse that string directly, so it is normalised to ISO 8601 first.
   */
  function parseDate(s) {
    if (!s) return null;
    const iso = s.replace(' ', 'T').replace(/ ([+-])(\d{2})(\d{2})$/, '$1$2:$3');
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Normalise to our canonical units. HealthKit emits whatever the source app wrote. */
  function normalise(metric, value, unit) {
    const u = (unit || '').toLowerCase();
    if ((metric === 'weight' || metric === 'lean_mass') && (u === 'lb' || u === 'lbs')) {
      return value * V.KG_PER_LB;
    }
    if (metric === 'weight' && u === 'st') return value * 6.35029;
    return value;
  }

  const RECORD_RE = /<Record\s([^>]*?)\/?>/g;
  const ATTR_RE = /(\w+)="([^"]*)"/g;

  function attrs(chunk) {
    const out = {};
    let m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(chunk))) out[m[1]] = m[2];
    return out;
  }

  /**
   * Stream the XML, accumulating one bucket per (metric, day).
   *
   * Records are self-closing or opened-and-closed, and can straddle a chunk boundary, so
   * the tail of each chunk after the last complete record is carried into the next read.
   */
  async function parseXmlStream(file, onProgress) {
    const buckets = new Map(); // "metric|date" -> { sum, count, metric, date }
    const reader = file.stream().getReader();
    const decoder = new TextDecoder('utf-8');

    let carry = '';
    let bytesRead = 0;
    let recordCount = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      const text = carry + decoder.decode(value, { stream: true });

      // Keep everything after the final '<' so a split tag is completed next round.
      const lastOpen = text.lastIndexOf('<');
      const scannable = lastOpen === -1 ? text : text.slice(0, lastOpen);
      carry = lastOpen === -1 ? '' : text.slice(lastOpen);

      RECORD_RE.lastIndex = 0;
      let m;
      while ((m = RECORD_RE.exec(scannable))) {
        const a = attrs(m[1]);
        const metric = TYPE_MAP[a.type];
        if (!metric) continue;

        const value = parseFloat(a.value);
        if (!Number.isFinite(value)) continue;

        const when = parseDate(a.startDate);
        if (!when) continue;

        const date = V.dateKey(when);
        const key = metric + '|' + date;
        let b = buckets.get(key);
        if (!b) { b = { metric, date, sum: 0, count: 0, last: when.getTime() }; buckets.set(key, b); }
        b.sum += normalise(metric, value, a.unit);
        b.count++;
        b.last = Math.max(b.last, when.getTime());
        recordCount++;
      }

      if (onProgress) onProgress({ bytesRead, records: recordCount, totalBytes: file.size });
      // Yield so the progress UI can actually paint between chunks.
      await new Promise((r) => setTimeout(r, 0));
    }

    return { buckets, recordCount };
  }

  const health = {
    /**
     * Import an Apple Health export.xml.
     * Existing samples for the same metric+day are replaced, so re-importing a newer
     * export updates rather than duplicating.
     */
    async importFile(file, onProgress) {
      if (/\.zip$/i.test(file.name)) {
        throw new Error(
          'That is the zipped export. Tap the .zip in the Files app first to uncompress it, ' +
          'then choose apple_health_export/export.xml.',
        );
      }
      if (!/\.xml$/i.test(file.name)) {
        throw new Error('Expected export.xml from the Apple Health export.');
      }

      const { buckets, recordCount } = await parseXmlStream(file, onProgress);
      if (!buckets.size) {
        throw new Error('No recognised health records found in that file.');
      }

      // Index existing samples so an import is idempotent per metric+day.
      const existing = new Map();
      for (const m of await V.store.db.all('metrics')) {
        if (m.source === 'import') existing.set(m.type + '|' + m.date, m.id);
      }

      const rows = [];
      for (const b of buckets.values()) {
        const value = SUMMED[b.metric] ? b.sum : b.sum / b.count;
        rows.push({
          id: existing.get(b.metric + '|' + b.date) || V.uid(),
          type: b.metric,
          date: b.date,
          recordedAt: b.last,
          value: V.round(value, 2),
          source: 'import',
        });
      }

      await V.store.db.putMany('metrics', rows);

      const byMetric = {};
      for (const r of rows) byMetric[r.type] = (byMetric[r.type] || 0) + 1;

      return { days: rows.length, records: recordCount, byMetric };
    },

    TYPE_MAP,
  };

  V.health = health;
})(window.V);
