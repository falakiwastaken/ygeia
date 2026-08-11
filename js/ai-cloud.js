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
 * What gets sent: a short summary — calorie and protein totals, food quality score, weight
 * trend, workout count, the gaps Ygeia calculated (which include sleep), and the next few
 * calendar notes. Not your full history, but unambiguously personal health data.
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

  C.SYSTEM_PROMPT = V.COACH_PROMPT;

  /**
   * Check a key works, and find out which models it can actually reach.
   *
   * Sends the key and nothing else — no health data, no photo. Worth doing at the moment
   * the user pastes it: a key that turns out to be wrong otherwise fails later, inside a
   * feature, looking like the feature is broken.
   *
   * Asking Google which models the key can reach also stops the app offering one the user
   * cannot use. Google moves the free tier around — 2.0 Flash was withdrawn in June 2026
   * and the Pro models left the free tier that April — so a hardcoded list goes stale.
   *
   * @returns {Promise<string[]>} model ids usable for generateContent, newest-looking first
   */
  C.verifyKey = async function (key) {
    const clean = String(key || '').trim();
    if (!clean) throw new Error('Paste a key first.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    let res;
    try {
      res = await fetch(ENDPOINT + '?pageSize=200', {
        headers: { 'x-goog-api-key': clean },
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(err.name === 'AbortError'
        ? 'Google did not respond. Check your connection.'
        : 'Could not reach Google. Check your connection.');
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new Error('Google rejected that key. Check you copied all of it.');
      }
      if (res.status === 429) throw new Error('Rate limited by Google. Wait a minute and retry.');
      const message = data && data.error && data.error.message;
      throw new Error(message || `Google returned ${res.status}.`);
    }

    const usable = ((data && data.models) || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter((id) => id && !/embedding|aqa|imagen|veo/i.test(id));

    if (!usable.length) throw new Error('That key works but cannot reach any chat models.');

    // Newer generations sort first so the picker's default is a current model. Plain
    // descending string order does this correctly for gemini-N.M names.
    return usable.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  };

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
      // The key goes in a header, never the query string — URLs end up in proxy and
      // browser logs, and a credential should not be sitting in one.
      res = await fetch(`${ENDPOINT}/${encodeURIComponent(chosen)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
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
