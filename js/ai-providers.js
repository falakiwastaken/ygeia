/*
 * Ygeia — which AI provider a key belongs to, and how to talk to it.
 *
 * The app used to speak only Google's API, so the key field was really a "Google key"
 * field. That made the free tier the only option: fine for most people, wrong for anyone
 * who already pays for a different provider and would rather use it.
 *
 * This module is the translation layer. It works out which provider a pasted key belongs
 * to from its format, then shapes the request and reads the response accordingly. The
 * callers — the study-photo helper, the scan-to-deck extractor and the coach — describe
 * what they want in neutral terms and never mention a provider.
 *
 * ADDING A PROVIDER is meant to be a data entry, not a refactor: append an object to
 * PROVIDERS with the same six functions and it works everywhere at once. Two things are
 * required of any candidate, and both are easy to get wrong:
 *
 *   1. It must permit direct browser calls. Ygeia has no server, so every request comes
 *      from the page. A provider that blocks cross-origin browser requests cannot be
 *      used here at all, however good its model is.
 *   2. Its host must be added to connect-src in index.html. The CSP enumerates every
 *      host the app may contact, and a missing entry fails silently.
 *
 * Pure request/response shaping. No DOM, and no storage access — the key is passed in.
 */
(function (V) {
  'use strict';

  const P = {};

  // =========================================================================
  // Google — Gemini
  // =========================================================================

  const google = {
    id: 'google',
    label: 'Google Gemini',
    keyHint: 'AIza…',
    /**
     * What this company does with what is sent. Shown verbatim in the key screen, because
     * "your data goes to a third party" is only meaningful if it says which one and what
     * they may do with it. Do not soften either line.
     */
    dataNote: 'Google’s free tier may use what you send to improve their models, and human ' +
              'reviewers can see it. Paid tiers do not.',
    host: 'https://generativelanguage.googleapis.com',

    detect: (key) => /^AIza[\w-]{10,}$/.test(key),

    /**
     * Google moves the free tier around — 2.0 Flash was withdrawn in June 2026 and the
     * Pro models left the free tier that April — so the list is asked for, never hardcoded.
     */
    async listModels(key) {
      const res = await fetch(`${google.host}/v1beta/models?pageSize=200`, {
        headers: { 'x-goog-api-key': key },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw P.normaliseError(res.status, data, google);

      return (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean)
        .sort()
        .reverse();
    },

    defaultModel: (models) =>
      models.find((m) => /2\.5-flash$/.test(m)) ||
      models.find((m) => /flash/.test(m)) ||
      models[0],

    /** Used before the model list has ever been fetched, so the app works on first run. */
    fallbackModel: 'gemini-2.5-flash',

    endpoint: (model) => `${google.host}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: (key) => ({ 'Content-Type': 'application/json', 'x-goog-api-key': key }),

    body(o) {
      const contents = (o.messages || []).map((m) => ({
        // Google calls its own turns 'model'; Anthropic calls them 'assistant'.
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const parts = [];
      for (const img of o.images || []) {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
      }
      if (o.text) parts.push({ text: o.text });
      if (parts.length) contents.push({ role: 'user', parts });

      const generationConfig = { maxOutputTokens: o.maxTokens };
      // Google accepts sampling parameters; Anthropic's current models reject them, which
      // is why this lives per-provider rather than in the shared caller.
      if (o.temperature != null) generationConfig.temperature = o.temperature;
      if (o.jsonSchema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = o.jsonSchema;
      }

      const req = { contents, generationConfig };
      if (o.system) req.systemInstruction = { parts: [{ text: o.system }] };
      return req;
    },

    parse(data) {
      const candidate = data && data.candidates && data.candidates[0];
      if (!candidate) return { text: '', stop: 'empty' };
      if (candidate.finishReason === 'SAFETY') return { text: '', stop: 'blocked' };
      if (candidate.finishReason === 'MAX_TOKENS') return { text: '', stop: 'truncated' };

      const text = ((candidate.content && candidate.content.parts) || [])
        .map((p) => p.text || '')
        .join('')
        .trim();
      return { text, stop: text ? 'ok' : 'empty' };
    },
  };

  // =========================================================================
  // Anthropic — Claude
  // =========================================================================

  const anthropic = {
    id: 'anthropic',
    label: 'Anthropic Claude',
    keyHint: 'sk-ant-…',
    dataNote: 'Anthropic does not train on API inputs by default. Requests are billed to ' +
              'your own account.',
    host: 'https://api.anthropic.com',
    apiVersion: '2023-06-01',

    detect: (key) => /^sk-ant-[\w-]{10,}$/.test(key),

    async listModels(key) {
      const res = await fetch(`${anthropic.host}/v1/models?limit=100`, {
        headers: anthropic.headers(key),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw P.normaliseError(res.status, data, anthropic);
      return (data.data || []).map((m) => m.id).filter(Boolean);
    },

    // The most capable model is the default. Anyone who would rather trade capability for
    // cost can pick a cheaper one from the list — that is the user's call, not the app's.
    defaultModel: (models) =>
      models.find((m) => m === 'claude-opus-5') ||
      models.find((m) => /^claude-sonnet-5/.test(m)) ||
      models[0],

    fallbackModel: 'claude-opus-5',

    endpoint: () => `${anthropic.host}/v1/messages`,

    headers: (key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': anthropic.apiVersion,
      /*
       * Required for a browser to call this API at all. The "dangerous" in the name warns
       * against shipping YOUR key in client code, where anyone could read it — it is not a
       * warning about this pattern. Here the key is the user's own, pasted on their own
       * device, and never leaves it except as an auth header to Anthropic.
       */
      'anthropic-dangerous-direct-browser-access': 'true',
    }),

    body(o) {
      const messages = (o.messages || []).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: m.content }],
      }));

      const content = [];
      for (const img of o.images || []) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
        });
      }
      if (o.text) content.push({ type: 'text', text: o.text });
      if (content.length) messages.push({ role: 'user', content });

      const req = {
        model: o.model,
        max_tokens: o.maxTokens,
        messages,
      };
      if (o.system) req.system = o.system;
      // No temperature: current Claude models reject sampling parameters outright.
      // Depth is controlled with effort instead.
      if (o.effort) req.output_config = { effort: o.effort };
      if (o.jsonSchema) {
        req.output_config = Object.assign({}, req.output_config, {
          format: { type: 'json_schema', schema: strictSchema(o.jsonSchema) },
        });
      }
      return req;
    },

    parse(data) {
      if (!data) return { text: '', stop: 'empty' };
      // Must be checked before reading content: a refusal returns HTTP 200 with content
      // either empty or partial, so indexing straight into it yields nothing useful.
      if (data.stop_reason === 'refusal') return { text: '', stop: 'blocked' };
      if (data.stop_reason === 'max_tokens') return { text: '', stop: 'truncated' };

      const text = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('')
        .trim();
      return { text, stop: text ? 'ok' : 'empty' };
    },
  };

  /**
   * The same schema, tightened for strict validation.
   *
   * Callers write one plain schema. Google's flavour is an OpenAPI subset that has no
   * concept of `additionalProperties` and ignores it; Anthropic validates strictly and
   * wants every object closed. Rather than make callers keep two copies in step, the
   * difference is absorbed here — which is the entire reason this file exists.
   */
  function strictSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(strictSchema);

    const out = {};
    for (const k of Object.keys(schema)) {
      out[k] = k === 'properties'
        ? Object.keys(schema[k]).reduce((acc, name) => {
            acc[name] = strictSchema(schema[k][name]);
            return acc;
          }, {})
        : strictSchema(schema[k]);
    }
    if (out.type === 'object' && out.additionalProperties === undefined) {
      out.additionalProperties = false;
    }
    return out;
  }

  P.PROVIDERS = [google, anthropic];

  // =========================================================================
  // Detection
  // =========================================================================

  /**
   * Which provider issued this key, by format.
   *
   * Prefix matching rather than trial requests: it is instant, works offline, and lets
   * the UI name the provider as the user types. A key that matches nothing is reported
   * as unknown rather than guessed at — sending a key to the wrong provider would leak
   * it to a company the user never chose.
   */
  P.detect = function (key) {
    const clean = String(key || '').trim();
    if (!clean) return null;
    return P.PROVIDERS.find((p) => p.detect(clean)) || null;
  };

  P.byId = function (id) {
    return P.PROVIDERS.find((p) => p.id === id) || null;
  };

  /** A usable model for this key without a network round trip. */
  P.defaultModelFor = function (key) {
    const provider = P.detect(key);
    return provider ? provider.fallbackModel : null;
  };

  /**
   * Which models this key can actually reach.
   *
   * Asked for rather than hardcoded, because both providers retire models on their own
   * schedule and an app offering one the user cannot use looks broken. Doubles as a key
   * check: it sends the key and nothing else — no health data, no photo.
   */
  P.listModels = async function (key) {
    const provider = P.detect(key);
    if (!provider) throw err('That key was not recognised as belonging to any supported provider.', 'auth');
    const models = await provider.listModels(key);
    return { provider: provider.id, models, suggested: provider.defaultModel(models) || provider.fallbackModel };
  };

  // =========================================================================
  // Errors
  // =========================================================================

  /**
   * Turn a provider's error response into one the user can act on.
   *
   * The 429 split matters more than it looks. Both providers use 429 for two different
   * situations — too many requests this minute, and the day's quota gone — and the advice
   * is opposite: wait a moment, versus stop until tomorrow. Telling someone to "try again
   * shortly" when their daily quota is spent sends them into a retry loop for hours.
   */
  P.normaliseError = function (status, data, provider) {
    const message =
      (data && data.error && (data.error.message || data.error.type)) ||
      (data && data.message) ||
      '';
    const label = provider ? provider.label : 'the provider';

    if (status === 400 && /api[- ]key not valid|invalid[_ ]api[_ ]key|x-api-key/i.test(message)) {
      return err('That API key was rejected. Check it in Settings.', 'auth');
    }
    if (status === 401 || status === 403) {
      return err(`${label} rejected that key. Check it is correct and still active.`, 'auth');
    }
    if (status === 404) {
      return err('That model was not found. Pick a different one in Settings.', 'model');
    }
    if (status === 413) {
      return err('Those images were too large. Try fewer pages, or photograph them closer.', 'size');
    }
    if (status === 429) {
      // Providers name the exhausted quota in the message. Per-day wording ("per day",
      // "daily", "requests per day", "PerDay") distinguishes it from a per-minute burst.
      const daily = /per[- ]?day|daily|quota.*exceeded|exhausted/i.test(message);
      return daily
        ? err(
            `You have used up today's free allowance on ${label}. It resets tomorrow — ` +
            'everything else in the app keeps working in the meantime.',
            'quota',
          )
        : err(`${label} is rate limiting you. Wait a moment and try again.`, 'rate');
    }
    if (status >= 500) {
      return err(`${label} is having trouble right now. Try again in a minute.`, 'server');
    }
    return err(message || `${label} returned ${status}.`, 'unknown');
  };

  function err(message, kind) {
    const e = new Error(message);
    e.kind = kind;
    return e;
  }

  /** Why a non-error response came back with nothing usable. */
  P.stopMessage = function (stop, provider) {
    const label = provider ? provider.label : 'The provider';
    switch (stop) {
      case 'blocked':
        return `${label} declined to answer that. Try photographing just the material itself.`;
      case 'truncated':
        return 'That was too much material for one go. Try fewer pages at a time.';
      case 'empty':
        return 'The reply came back empty. Try again, or use a clearer photo.';
      default:
        return null;
    }
  };

  // =========================================================================
  // The one call everything goes through
  // =========================================================================

  /**
   * Send a request to whichever provider the key belongs to.
   *
   * @param {object} o
   * @param {string} o.key        the user's API key — decides the provider
   * @param {string} [o.model]    provider-specific model id; falls back to their default
   * @param {string} [o.system]   system instruction
   * @param {Array}  [o.messages] prior conversation, [{ role: 'user'|'assistant', content }].
   *                              Roles must alternate — Anthropic rejects two user turns in
   *                              a row with a 400, so fold extra context into a turn rather
   *                              than inserting one.
   * @param {string} [o.text]     a final user turn, appended after `messages`
   * @param {Array}  [o.images]   [{ base64, mimeType }], attached to that final turn
   * @param {number} [o.maxTokens]
   * @param {number} [o.temperature] applied only where the provider accepts it
   * @param {string} [o.effort]      applied only where the provider accepts it
   * @param {object} [o.jsonSchema]  constrains the reply to a schema
   * @param {number} [o.timeoutMs]
   * @returns {Promise<{text: string, provider: string, model: string}>}
   */
  P.send = async function (o) {
    const provider = P.detect(o.key);
    if (!provider) {
      throw err(
        'That does not look like a key from any provider Ygeia supports. ' +
        P.PROVIDERS.map((p) => `${p.label} keys ${p.keyHint.toLowerCase()}`).join('; ') + '.',
        'auth',
      );
    }

    const model = o.model || null;
    if (!model) throw err('No model selected. Open Settings and pick one.', 'model');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs || 60000);

    let res;
    try {
      res = await fetch(provider.endpoint(model), {
        method: 'POST',
        headers: provider.headers(o.key),
        body: JSON.stringify(provider.body(Object.assign({}, o, { model }))),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      throw err(
        fetchErr.name === 'AbortError'
          ? 'That took too long and was given up on. Try fewer pages at once.'
          : `Could not reach ${provider.label}. Check your connection.`,
        fetchErr.name === 'AbortError' ? 'timeout' : 'network',
      );
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) throw P.normaliseError(res.status, data, provider);

    const parsed = provider.parse(data);
    if (parsed.stop !== 'ok') throw err(P.stopMessage(parsed.stop, provider), parsed.stop);

    return { text: parsed.text, provider: provider.id, model };
  };

  V.aiProviders = P;
})(window.V);
