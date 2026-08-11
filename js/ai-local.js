/*
 * Ygeia — optional on-device language model.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONE PLACE YGEIA LOADS THIRD-PARTY CODE.
 *
 * Everything else in this app is hand-written with no dependencies and no build step.
 * Running a language model in a browser is not something you write yourself, so opting in
 * pulls WebLLM from a CDN and a model from Hugging Face.
 *
 * That trade is made ONLY when the user goes looking for it:
 *   - nothing here loads while using the rest of the app
 *   - the exact download size is shown before any model is fetched
 *   - it can be deleted, and the space is genuinely reclaimed
 *
 * Be precise about the timing: the runtime is imported when the model PICKER is opened,
 * not when a model is installed, because the picker reads the catalogue from the library
 * itself. So merely opening "Local AI coach" to look at it already discloses your IP to
 * the CDN. The UI says so.
 *
 * Known risk, stated plainly: this import is not version-pinned and ES modules cannot
 * carry an integrity hash. Once loaded, that third-party code runs in Ygeia's origin with
 * full access to IndexedDB. The Content-Security-Policy in index.html is the mitigation —
 * it restricts where anything on this page may connect, so substituted code still has
 * nowhere to send your data.
 *
 * Until then the app remains dependency-free and the default experience is unchanged.
 *
 * Once installed, inference is entirely local — the model runs on the GPU in the page and
 * no health data leaves the device. The network is used for the download, not for use.
 * ---------------------------------------------------------------------------
 */
(function (V) {
  'use strict';

  const L = {};

  const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm';

  /**
   * Anything much above this will not load on a phone, and will thrash on a laptop.
   * Sized in the VRAM the model reports needing, which is what actually constrains it.
   */
  const MAX_VRAM_MB = 2600;

  let webllm = null;   // the imported module
  let engine = null;   // the loaded engine
  let loadedId = null;

  // =========================================================================
  // Capability
  // =========================================================================

  /**
   * Whether this device can run a local model at all, and why not if it cannot.
   * Mirrors V.auth.unavailableReason() — a plain explanation beats a broken button.
   */
  L.capabilities = async function () {
    if (!navigator.gpu) {
      return {
        ok: false,
        reason: 'This browser has no WebGPU, which a local model needs. Chrome, Edge and ' +
                'Safari 26+ have it; older Safari and Firefox do not.',
      };
    }

    let adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (err) { /* handled below */ }
    if (!adapter) {
      return { ok: false, reason: 'WebGPU is present but no usable GPU was found on this device.' };
    }

    let quotaMB = null;
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      quotaMB = Math.round((est.quota || 0) / 1048576);
    }

    return {
      ok: true,
      quotaMB,
      maxBufferMB: Math.round((adapter.limits.maxBufferSize || 0) / 1048576),
    };
  };

  // =========================================================================
  // Models
  // =========================================================================

  /**
   * Read WebLLM's own catalogue rather than hard-coding model ids.
   *
   * Model names and quantisations change with every release; asking the library what it
   * actually ships means a rename here becomes a different list rather than a dead button.
   */
  L.listModels = async function () {
    if (!webllm) webllm = await import(/* webpackIgnore: true */ WEBLLM_URL);

    const all = (webllm.prebuiltAppConfig && webllm.prebuiltAppConfig.model_list) || [];

    return all
      .map((m) => ({
        id: m.model_id,
        vramMB: Math.round(m.vram_required_MB || 0),
        lowResource: !!m.low_resource_required,
      }))
      .filter((m) => m.vramMB > 0 && m.vramMB <= MAX_VRAM_MB)
      // Instruction-tuned models only — a base model will not hold a conversation.
      .filter((m) => /instruct|chat|it-/i.test(m.id))
      .sort((a, b) => a.vramMB - b.vramMB);
  };

  /** Which model the user installed, if any. Persisted so it survives a reload. */
  L.installedModel = async function () {
    const s = await V.store.settings.get();
    return s.localModelId || null;
  };

  L.isLoaded = () => !!engine;
  L.loadedId = () => loadedId;

  // =========================================================================
  // Loading
  // =========================================================================

  /**
   * Download and initialise a model.
   * @param {string} modelId
   * @param {function} onProgress receives { text, progress } where progress is 0..1
   */
  L.load = async function (modelId, onProgress) {
    const caps = await L.capabilities();
    if (!caps.ok) throw new Error(caps.reason);

    if (!webllm) {
      if (onProgress) onProgress({ text: 'Fetching the runtime…', progress: 0 });
      webllm = await import(/* webpackIgnore: true */ WEBLLM_URL);
    }

    if (engine && loadedId === modelId) return engine;
    if (engine) { await L.unload(); }

    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        if (!onProgress) return;
        onProgress({
          text: report.text || 'Loading…',
          progress: typeof report.progress === 'number' ? report.progress : 0,
        });
      },
    });

    loadedId = modelId;
    await V.store.settings.set({ localModelId: modelId });
    return engine;
  };

  L.unload = async function () {
    if (engine && engine.unload) {
      try { await engine.unload(); } catch (err) { /* the engine may already be gone */ }
    }
    engine = null;
    loadedId = null;
  };

  /**
   * Remove the downloaded weights.
   * WebLLM stores them in Cache Storage, so this is what actually frees the gigabyte —
   * a Settings row that only forgets the model id would be a lie.
   */
  L.deleteModel = async function () {
    await L.unload();

    let deleted = 0;
    for (const key of await caches.keys()) {
      // Ygeia's own shell cache must survive; everything WebLLM created must not.
      if (key.startsWith('ygeia-')) continue;
      if (await caches.delete(key)) deleted++;
    }

    await V.store.settings.set({ localModelId: null });
    return deleted;
  };

  /** Rough footprint of the model caches, for an honest "delete (N MB)" label. */
  L.cacheSizeMB = async function () {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const est = await navigator.storage.estimate();
    return Math.round((est.usage || 0) / 1048576);
  };

  // =========================================================================
  // Chat
  // =========================================================================

  /**
   * The model narrates; it never calculates.
   *
   * Every figure it is given has already been computed by the deterministic engines in
   * domain*.js. It is told not to invent numbers, because a hallucinated blood pressure or
   * calorie total in a health app is the failure mode that actually matters.
   */
  L.SYSTEM_PROMPT =
    'You are a concise, practical health and training coach inside an app called Ygeia.\n\n' +
    'Rules you must follow:\n' +
    '1. Only use numbers that appear in the data provided to you. Never estimate, compute ' +
    'or invent a figure. If a number is not given, say you do not have it.\n' +
    '2. Be brief. Two or three sentences unless asked for more.\n' +
    '3. Be concrete. "Add 2.5kg to your squat next session" beats "keep up the good work".\n' +
    '4. If the data is too thin to answer, say so plainly instead of guessing.\n' +
    '5. You are not a doctor. For anything medical, say so and suggest they see one.\n' +
    '6. Never moralise about food or weight.';

  /**
   * Stream a reply.
   * @param {Array} messages [{role, content}]
   * @param {function} onToken called with each chunk of text
   */
  L.chat = async function (messages, onToken) {
    if (!engine) throw new Error('No model loaded.');

    const full = [{ role: 'system', content: L.SYSTEM_PROMPT }].concat(messages);

    const stream = await engine.chat.completions.create({
      messages: full,
      temperature: 0.4,
      max_tokens: 400,
      stream: true,
    });

    let text = '';
    for await (const chunk of stream) {
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      const piece = (delta && delta.content) || '';
      if (piece) {
        text += piece;
        if (onToken) onToken(piece, text);
      }
    }
    return text;
  };

  L.WEBLLM_URL = WEBLLM_URL;
  L.MAX_VRAM_MB = MAX_VRAM_MB;
  V.aiLocal = L;
})(window.V);
