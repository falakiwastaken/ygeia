/*
 * Ygeia — cloud coach (optional, off by default).
 *
 * ---------------------------------------------------------------------------
 * THIS ONE DOES SEND YOUR HEALTH DATA. That is the whole point of the file, and the
 * reason it is separate from js/ai-vision.js.
 *
 * ai-vision.js has a hard wall: it may only ever receive a photograph and a typed note,
 * and an audit verified that its only store access is reading its own API key. Routing
 * health data through that module would have quietly destroyed a guarantee the app makes
 * in writing. So the cloud coach lives here instead, clearly labelled, and the wall over
 * there stays intact.
 *
 * What gets sent: a short summary — calorie target, what was eaten, sleep hours, weight
 * trend, upcoming notes. Not your full history, but unambiguously personal health data.
 *
 * It is off unless the user turns it on, the UI says plainly where the data goes, and
 * Google's free tier may use submitted content for training with human reviewers able to
 * see it. Do not soften that wording, and do not enable this by default.
 * ---------------------------------------------------------------------------
 */
(function (V) {
  'use strict';

  const C = {};

  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

  /** Shares the key with the study-photo feature — one key, two clearly separate uses. */
  C.hasKey = async function () {
    const rec = await V.store.db.get('kv', 'visionKey');
    return !!(rec && rec.value);
  };

  /** Whether the user has explicitly opted the coach into using the cloud. */
  C.isEnabled = async function () {
    const s = await V.store.settings.get();
    return !!s.cloudCoachEnabled;
  };

  C.setEnabled = async function (on) {
    await V.store.settings.set({ cloudCoachEnabled: !!on });
    return !!on;
  };

  C.SYSTEM_PROMPT =
    'You are a concise, practical health and training coach inside an app called Ygeia.\n\n' +
    'Rules you must follow:\n' +
    '1. Only use numbers that appear in the data provided. Never estimate, compute or ' +
    'invent a figure. If a number is not given, say you do not have it.\n' +
    '2. Be brief — two or three sentences unless asked for more.\n' +
    '3. Be concrete. "Add 2.5kg to your squat next session" beats "keep up the good work".\n' +
    '4. If the data is too thin to answer, say so rather than guessing.\n' +
    '5. You are not a doctor. For anything medical, say so and suggest they see one.\n' +
    '6. Never moralise about food or weight.';

  /**
   * Ask the cloud coach.
   *
   * @param {Array}  messages [{role:'user'|'assistant', content}]
   * @param {string} context  the health summary built by the caller
   */
  C.chat = async function (messages, context, model) {
    if (!(await C.isEnabled())) throw new Error('The cloud coach is off. Turn it on in Settings.');

    const rec = await V.store.db.get('kv', 'visionKey');
    const key = rec && rec.value;
    if (!key) throw new Error('No API key set. Add one in Settings.');

    const chosen = model || (await V.store.settings.get()).visionModel || 'gemini-2.5-flash';

    // Gemini uses 'model' rather than 'assistant' for its own turns.
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    if (context) {
      contents.unshift({ role: 'user', parts: [{ text: 'My current data:\n' + context }] });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);

    let res;
    try {
      res = await fetch(`${ENDPOINT}/${encodeURIComponent(chosen)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: C.SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'Timed out.' : 'Could not reach Google.');
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = data && data.error && data.error.message;
      if (res.status === 429) throw new Error('Rate limited by Google. Wait a minute.');
      if (res.status === 404) throw new Error(`Model "${chosen}" not found. Change it in Settings.`);
      throw new Error(message || `Google returned ${res.status}.`);
    }

    const candidate = data && data.candidates && data.candidates[0];
    if (!candidate) throw new Error('No answer came back.');

    const text = ((candidate.content && candidate.content.parts) || [])
      .map((p) => p.text || '').join('').trim();
    if (!text) throw new Error('The answer came back empty.');
    return text;
  };

  V.aiCloud = C;
})(window.V);
