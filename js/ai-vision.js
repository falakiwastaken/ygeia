/*
 * Ygeia — study photo help.
 *
 * ---------------------------------------------------------------------------
 * PRIVACY WALL — READ BEFORE CHANGING ANYTHING IN HERE.
 *
 * This is the ONLY part of Ygeia that sends anything to a third party, and it exists
 * solely for photographing a study problem. It must never touch health data.
 *
 * The module is written so that it cannot. `solve()` takes an exhaustive parameter list —
 * an image, a mime type, an optional question string and a model name — and nothing else.
 * There is no code path from a food log, weight reading, workout or check-in into this
 * file. Do not add one, and do not pass it anything derived from the store.
 *
 * It does read the store, but only to fetch its own API key from the `kv` record named
 * `visionKey`. That is the sole store access in this file, and it must stay that way.
 *
 * The reasoning behind the split: a photo of a textbook question is not personal health
 * data, so the privacy cost of sending it to a cloud model is low and the answers are
 * actually correct. Blood pressure and food diaries are a different matter, and they stay
 * on the device.
 *
 * Google's free tier may use submitted content for training and human reviewers may see
 * it. The UI states that plainly. Do not soften it.
 * ---------------------------------------------------------------------------
 */
(function (V) {
  'use strict';

  const A = {};

  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

  /**
   * Model names move faster than this file will. It is a setting, and an unknown model
   * surfaces Google's own error rather than failing silently.
   */
  A.DEFAULT_MODEL = 'gemini-2.5-flash';

  A.MODELS = [
    { value: 'gemini-2.5-flash', label: 'Flash', note: 'Fast and free-tier friendly' },
    { value: 'gemini-2.5-pro', label: 'Pro', note: 'Slower, better at hard problems' },
  ];

  // =========================================================================
  // Key handling
  // =========================================================================

  /**
   * The key lives in its own record, not in the settings blob, so it is obvious in an
   * export and easy to strip. It never leaves the device except as an API parameter.
   */
  A.getKey = async function () {
    const rec = await V.store.db.get('kv', 'visionKey');
    return (rec && rec.value) || null;
  };

  A.setKey = async function (key) {
    const clean = String(key || '').trim();
    if (!clean) return A.clearKey();
    // keyPath for the kv store is `key`, so the record name goes there and the secret
    // itself under `value`.
    await V.store.db.put('kv', { key: 'visionKey', value: clean });
    return true;
  };

  A.clearKey = async function () {
    await V.store.db.remove('kv', 'visionKey');
    return true;
  };

  A.hasKey = async function () {
    const rec = await V.store.db.get('kv', 'visionKey');
    return !!(rec && rec.value);
  };

  async function readKey() {
    const rec = await V.store.db.get('kv', 'visionKey');
    return (rec && rec.value) || null;
  }

  // =========================================================================
  // Image preparation
  // =========================================================================

  /**
   * Downscale and re-encode before upload.
   *
   * A modern phone photo is 3–5 MB, which is slow on mobile data and wasteful when the
   * model only needs to read the text. 1600px on the long edge keeps handwriting legible
   * at a fraction of the size.
   */
  A.prepareImage = function (file, maxEdge) {
    return new Promise((resolve, reject) => {
      const limit = maxEdge || 1600;
      const reader = new FileReader();

      reader.onerror = () => reject(new Error('Could not read that image.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not a readable image.'));
        img.onload = () => {
          const scale = Math.min(1, limit / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({
            base64: dataUrl.split(',')[1],
            mimeType: 'image/jpeg',
            dataUrl,
            width: w,
            height: h,
            approxKB: Math.round((dataUrl.length * 0.75) / 1024),
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  };

  // =========================================================================
  // Solving
  // =========================================================================

  const SYSTEM_PROMPT =
    'You are helping a student who is stuck on a problem they have photographed.\n\n' +
    'Rules:\n' +
    '1. First state what the question is asking, in one sentence.\n' +
    '2. Then work through it step by step. Show every step, including the arithmetic.\n' +
    '3. Explain WHY each step follows, not just what it is. The point is that they can do ' +
    'the next one themselves.\n' +
    '4. State the final answer clearly at the end.\n' +
    '5. If the photo is unreadable or ambiguous, say so and ask for a clearer one rather ' +
    'than guessing.\n' +
    '6. If you are unsure of a step, say which part you are unsure about. Do not present a ' +
    'guess as certain.\n' +
    'Keep it concise. Plain text, no markdown headers.';

  /**
   * Send an image and a question to Gemini.
   *
   * @param {object} o
   * @param {string} o.base64     image data, no data-url prefix
   * @param {string} o.mimeType
   * @param {string} [o.question] optional extra context from the student
   * @param {string} [o.model]
   * @returns {Promise<{text: string, model: string}>}
   *
   * NOTE: the parameter list is exhaustive on purpose. Nothing from the store is accepted.
   */
  A.solve = async function (o) {
    const key = await readKey();
    if (!key) throw new Error('No API key set. Add one in Settings.');
    if (!o || !o.base64) throw new Error('No image provided.');

    const model = o.model || A.DEFAULT_MODEL;
    const question = String(o.question || '').trim();

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: o.mimeType || 'image/jpeg', data: o.base64 } },
          { text: question || 'I am stuck on this. Walk me through it.' },
        ],
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    let res;
    try {
      res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        err.name === 'AbortError'
          ? 'Timed out after 60 seconds.'
          : 'Could not reach Google. Check your connection.',
      );
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const message = data && data.error && data.error.message;
      if (res.status === 400 && /API key not valid/i.test(message || '')) {
        throw new Error('That API key was rejected. Check it in Settings.');
      }
      if (res.status === 429) throw new Error('Rate limited by Google. Wait a minute and try again.');
      if (res.status === 404) {
        throw new Error(`Model "${model}" was not found. Pick a different one in Settings.`);
      }
      throw new Error(message || `Google returned ${res.status}.`);
    }

    const candidate = data && data.candidates && data.candidates[0];
    if (!candidate) throw new Error('No answer came back. Try a clearer photo.');

    if (candidate.finishReason === 'SAFETY') {
      throw new Error('Google blocked that image. Try photographing just the question.');
    }

    const text = (candidate.content && candidate.content.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) throw new Error('The answer came back empty. Try again.');
    return { text, model };
  };

  A.SYSTEM_PROMPT = SYSTEM_PROMPT;
  V.aiVision = A;
})(window.V);
