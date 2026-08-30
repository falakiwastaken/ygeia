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
 * Where it goes depends on whose API key the user pasted — see js/ai-providers.js. That
 * makes the warning stronger, not weaker: it is now a different company's servers for
 * different users, and the UI has to name the one actually in use.
 *
 * It is off unless the user turns it on, the UI says plainly where the data goes, and
 * Google's free tier in particular may use submitted content for training with human
 * reviewers able to see it. Do not soften that wording, and do not enable this by default.
 * ---------------------------------------------------------------------------
 */
(function (V) {
  'use strict';

  const C = {};

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
   * Asking the provider which models the key can reach also stops the app offering one the
   * user cannot use. Google moves the free tier around — 2.0 Flash was withdrawn in June
   * 2026 and the Pro models left the free tier that April — so a hardcoded list goes stale.
   *
   * @returns {Promise<string[]>} usable model ids, newest-looking first
   */
  C.verifyKey = async function (key) {
    const clean = String(key || '').trim();
    if (!clean) throw new Error('Paste a key first.');

    const { models } = await V.aiProviders.listModels(clean);

    const usable = models.filter((id) => id && !/embedding|aqa|imagen|veo/i.test(id));
    if (!usable.length) throw new Error('That key works but cannot reach any chat models.');

    // Newer generations sort first so the picker's default is a current model. Numeric
    // collation does this correctly for both gemini-N.M and claude-name-N names.
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

    const chosen = model
      || (await V.store.settings.get()).visionModel
      || V.aiProviders.defaultModelFor(key);

    const turns = messages.map((m) => ({ role: m.role, content: m.content }));

    /*
     * The health summary is folded into the newest user turn rather than inserted as a
     * turn of its own. Two consecutive user messages are a 400 on some providers, and
     * attaching the data to the question being asked is the more accurate placement
     * anyway — it is current data, not something said earlier in the conversation.
     */
    const last = turns[turns.length - 1];
    if (context && last && last.role === 'user') {
      last.content = 'My current data:\n' + context + '\n\n' + last.content;
    }

    const out = await V.aiProviders.send({
      key,
      model: chosen,
      system: C.SYSTEM_PROMPT,
      messages: turns,
      // Short answers by design — the coach is a nudge, not an essay. Generous enough that
      // models which reason before replying still have room to finish.
      maxTokens: 4000,
      temperature: 0.4,
      effort: 'low',
      timeoutMs: 60000,
    });

    return out.text;
  };

  V.aiCloud = C;
})(window.V);
