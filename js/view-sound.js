/*
 * Ygeia — live sound level meter.
 *
 * The one place in this app that reads a sensor in real time. It answers a single
 * question: is the room I am standing in loud enough to damage my hearing, and for
 * how long?
 *
 * What it is not: a calibrated sound level meter, and not a hearing test. A phone
 * microphone has no published sensitivity, is tuned for speech, and compresses and then
 * clips somewhere around 100–110 dBA — which is to say it is least trustworthy exactly
 * where the answer matters most. The UI says all of this out loud rather than burying it,
 * and offers a calibration offset for anyone who can check against a real meter.
 */
(function (V) {
  'use strict';

  /** Display smoothing constant. Raw RMS jitters far too fast to read. */
  const SMOOTHING = 0.15;
  /** Ignore the first moments — AGC and the mic settling produce a spurious spike. */
  const SETTLE_MS = 400;

  /**
   * Can we measure at all?
   * getUserMedia needs a secure context, and this app is sometimes opened from file://.
   */
  function micAvailable() {
    return !!(window.isSecureContext &&
              navigator.mediaDevices &&
              navigator.mediaDevices.getUserMedia &&
              (window.AudioContext || window.webkitAudioContext));
  }

  function friendlyMicError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Microphone access was denied. The app cannot measure sound without it — ' +
             'allow the microphone in your browser\'s site settings, or enter a reading ' +
             'by hand below.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No microphone found on this device.';
    }
    if (name === 'NotReadableError') {
      return 'The microphone is in use by another app. Close it and try again.';
    }
    return 'Could not start the microphone: ' + (err && err.message ? err.message : 'unknown error');
  }

  // =========================================================== the meter sheet

  function openMeterSheet() {
    V.ui.sheet('Sound level', async (body) => {
      const settings = await V.store.settings.get();
      const offset = settings.micOffsetDb == null
        ? V.sound.DEFAULT_MIC_OFFSET_DB
        : settings.micOffsetDb;

      // ---- Readout -------------------------------------------------------
      const bigValue = V.el('div', { className: 'timer-big', text: '—' });
      const bandLine = V.el('div', { className: 'band-line', style: { textAlign: 'center' } });
      const refLine = V.el('div', { className: 'hint', style: { textAlign: 'center', marginTop: '0' } });
      const statsWrap = V.el('div');
      const adviceWrap = V.el('div');

      body.appendChild(bigValue);
      body.appendChild(V.el('div', { className: 'hint', style: { textAlign: 'center', marginTop: '0' }, text: 'dBA (estimated)' }));
      body.appendChild(bandLine);
      body.appendChild(refLine);
      body.appendChild(statsWrap);
      body.appendChild(adviceWrap);

      if (!micAvailable()) {
        body.appendChild(
          V.el('div', {
            className: 'warn-box',
            style: { marginTop: '12px' },
            text: window.isSecureContext
              ? 'This browser cannot open a microphone, so live measurement is unavailable.'
              : 'Live measurement needs a secure connection. Opened from a file, the ' +
                'browser will not grant microphone access. Serve the app over https or ' +
                'localhost, or log a reading by hand.',
          }),
        );
        appendManualEntry(body);
        appendCaveat(body);
        return;
      }

      // ---- Live state ----------------------------------------------------
      let smoothed = null;
      let peak = null;
      let running = false;
      let startedAt = 0;
      let frame = null;
      let stream = null;
      let audioCtx = null;

      /**
       * Stop everything. Registered as sheet teardown so it also runs when the sheet is
       * dismissed by the backdrop, Escape or the auto-lock — not just by the Stop button.
       */
      function stop() {
        running = false;
        if (frame) { cancelAnimationFrame(frame); frame = null; }
        if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
        // close() returns a promise that can reject if the context is already closing.
        if (audioCtx) { const c = audioCtx; audioCtx = null; c.close().catch(() => {}); }
        V.platform.releaseWakeLock('sound-meter');
      }
      V.ui.onSheetTeardown(stop);

      function paint(dba) {
        bigValue.textContent = dba == null ? '—' : V.fmt(dba, 0);

        const band = V.sound.band(dba);
        bandLine.textContent = band ? band.label : '';
        bandLine.style.color = band ? band.color : 'var(--text-dim)';
        refLine.textContent = V.sound.reference(dba) || '';

        statsWrap.innerHTML = '';
        if (dba != null) {
          statsWrap.appendChild(
            V.el('div', { className: 'grid-3', style: { marginTop: '12px' } }, [
              V.ui.stat({ label: 'Peak', value: V.fmt(peak, 0), unit: ' dBA' }),
              V.ui.stat({ label: 'Safe for', value: V.sound.formatDuration(V.sound.allowedMinutes(dba)) }),
              V.ui.stat({ label: 'At peak', value: V.sound.formatDuration(V.sound.allowedMinutes(peak)) }),
            ]),
          );
        }

        adviceWrap.innerHTML = '';
        const advice = V.sound.advice(dba);
        if (advice) {
          const severe = band && !band.safe;
          adviceWrap.appendChild(
            V.el('div', { className: severe ? 'warn-box' : 'hint', style: { marginTop: '12px' }, text: advice }),
          );
        }
      }

      async function start() {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            // All three processors off. Automatic gain control in particular would pull
            // loud rooms back down towards a comfortable level, flattening exactly the
            // peaks this is meant to catch.
            audio: {
              echoCancellation: false,
              autoGainControl: false,
              noiseSuppression: false,
            },
          });
        } catch (err) {
          body.appendChild(V.el('div', { className: 'warn-box', style: { marginTop: '12px' }, text: friendlyMicError(err) }));
          toggleBtn.textContent = 'Try again';
          return;
        }

        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new Ctx();
        // Autoplay policy can hand back a suspended context even after a user gesture.
        if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        // Deliberately not connected to the destination — that would echo the room back
        // out of the speaker and feed straight into the microphone.
        source.connect(analyser);

        const buf = new Float32Array(analyser.fftSize);
        running = true;
        startedAt = Date.now();
        toggleBtn.textContent = 'Stop';

        /*
         * Hold the screen on for the duration of a measurement.
         *
         * This is not comfort. The loop below is driven by requestAnimationFrame, which
         * stops being called the moment the screen sleeps — so the meter would sit there
         * looking like it was running while measuring nothing, and the exposure total it
         * feeds would quietly under-count. An instrument that stops reading without saying
         * so is worse than one that refuses to start.
         */
        V.platform.keepAwake('sound-meter');

        function tick() {
          if (!running) return;
          analyser.getFloatTimeDomainData(buf);
          const dba = V.sound.rmsToDba(V.sound.rms(buf), offset);

          if (dba != null) {
            smoothed = smoothed == null ? dba : smoothed + (dba - smoothed) * SMOOTHING;
            if (Date.now() - startedAt > SETTLE_MS) {
              if (peak == null || dba > peak) peak = dba;
            }
            paint(smoothed);
          }
          frame = requestAnimationFrame(tick);
        }
        tick();
      }

      const toggleBtn = V.ui.button('Start measuring', async () => {
        if (running) {
          stop();
          toggleBtn.textContent = 'Start measuring';
        } else {
          await start();
        }
      }, 'btn-primary');

      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(toggleBtn);
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(
        V.ui.button('Save this reading', async () => {
          if (smoothed == null) return V.toast('Measure something first');
          const date = V.app.state.date;
          await V.store.metrics.save({
            id: V.uid(),
            type: 'sound_exposure',
            date,
            recordedAt: Date.now(),
            value: V.round(smoothed, 1),
            source: 'meter',
          });
          V.toast('Reading saved');
          V.app.render();
        }, 'btn-ghost'),
      );

      // ---- Calibration ----------------------------------------------------
      body.appendChild(V.ui.sectionTitle('Calibration'));
      const offsetInput = V.ui.input({ type: 'number', step: '1', value: String(offset) });
      body.appendChild(
        V.ui.field('Microphone offset (dB)', offsetInput,
          'If you can compare against a real sound level meter, adjust this until the ' +
          'numbers agree. Raising it by 1 raises every reading by 1 dB.'),
      );
      body.appendChild(
        V.ui.button('Save offset', async () => {
          await V.store.settings.set({ micOffsetDb: V.ui.num(offsetInput, V.sound.DEFAULT_MIC_OFFSET_DB) });
          V.toast('Calibration saved');
          V.ui.refreshSheet();
        }, 'btn-ghost'),
      );

      appendCaveat(body);
      paint(null);
    });
  }

  function appendCaveat(body) {
    body.appendChild(
      V.el('div', {
        className: 'hint',
        style: { marginTop: '16px' },
        text: 'These readings are estimates. A phone microphone is not a calibrated ' +
              'instrument: it has no published sensitivity, it is tuned for speech, and ' +
              'most compress and then clip somewhere above 100 dBA — so very loud rooms ' +
              'read lower than they really are. Treat the band as the useful part and the ' +
              'exact number as approximate. This is not a hearing test.',
      }),
    );
  }

  /** Fallback path when no microphone is available. */
  function appendManualEntry(body) {
    body.appendChild(V.ui.sectionTitle('Log a reading by hand'));
    const input = V.ui.input({ type: 'number', step: '1', placeholder: 'dBA' });
    body.appendChild(V.ui.field('Level (dBA)', input,
      'From a sound level meter app or a real meter.'));
    body.appendChild(
      V.ui.button('Save', async () => {
        const raw = V.ui.num(input, NaN);
        if (!Number.isFinite(raw) || raw <= 0) return V.toast('Enter a level');
        await V.store.metrics.save({
          id: V.uid(),
          type: 'sound_exposure',
          date: V.app.state.date,
          recordedAt: Date.now(),
          value: raw,
          source: 'manual',
        });
        V.toast('Saved');
        V.ui.closeSheet();
        V.app.render();
      }, 'btn-primary'),
    );
  }

  // ====================================================== headphone dose card

  /**
   * Apple's AirPods-style headphone warning, as far as the available data honestly allows.
   *
   * Apple can compute a true weekly dose because iOS knows how long you listened. This app
   * only has a daily average level, so it reports the WHO weekly *allowance* at that level
   * instead of pretending to know the duration. An allowance is still actionable — "at
   * your usual volume you get about 5 hours a week" tells you what you need to know.
   *
   * @returns {Element|null} null when there is no headphone data to talk about
   */
  async function buildHeadphoneCard() {
    const daily = await V.store.metrics.daily('headphone_exposure', (vals) => V.sound.meanDb(vals));
    if (!daily.length) return null;

    const recent = daily.slice(-7);
    const level = V.sound.meanDb(recent.map((d) => d.value));
    const band = V.sound.band(level);
    const weekly = V.sound.allowedMinutesWeekly(level);

    const children = [
      V.el('div', {
        className: 'band-line',
        style: { color: band.color },
        text: `${V.fmt(level, 0)} dBA average — ${band.label}`,
      }),
      V.el('div', { className: 'grid-2' }, [
        V.ui.stat({ label: 'Safe listening / week', value: V.sound.formatDuration(weekly) }),
        V.ui.stat({ label: 'Days measured', value: String(recent.length) }),
      ]),
    ];

    if (level >= V.sound.WHO_WEEKLY_CRITERION_DB) {
      children.push(
        V.el('div', {
          className: 'warn-box',
          style: { marginTop: '12px' },
          text: `At ${V.fmt(level, 0)} dBA you use up a week's safe listening in about ` +
                `${V.sound.formatDuration(weekly)}. Turning the volume down by 3 dB doubles ` +
                'that; noise-cancelling headphones help most because the reason people turn ' +
                'music up is to cover background noise.',
        }),
      );
    }

    children.push(
      V.el('div', {
        className: 'hint',
        text: 'Based on the WHO/ITU-T limit of 40 hours a week at 80 dBA — the same standard ' +
              'behind the headphone notifications on iPhone. This app does not know how long ' +
              'you actually listened, so this is your weekly allowance at that volume, not a ' +
              'dose already used.',
      }),
    );

    return V.ui.card({ title: 'Headphone listening', sub: 'Last 7 days', children });
  }

  V.soundView = { openMeterSheet, buildHeadphoneCard, micAvailable };
})(window.V);
