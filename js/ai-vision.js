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
 * That last sentence is now CHECKED, not merely asserted. tests.html has a group called
 * "The study-photo wall holds" which reads this file's source and fails if it references
 * any repository other than the `kv` primitives, any `kv` key other than `visionKey`, or
 * anything from the domain layer. Previously the wall was held up by this comment and by
 * whoever read it — which is to say a later edit could step straight over it while passing
 * review and every test. The UI tells users the boundary is enforced; that group is what
 * makes the sentence true.
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

  /*
   * Which company this talks to is decided by the key the user pasted, in
   * js/ai-providers.js. Nothing below names a provider or an endpoint.
   *
   * That indirection does not widen the privacy wall — it narrows it. There is exactly one
   * outbound call site per feature, it goes through one shared function, and that function
   * receives only what is passed to it here.
   */

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

          /*
           * Re-encoding through a canvas also strips the EXIF block, and with it the GPS
           * coordinates most phones write into a photo. That is a real privacy property of
           * this path and not an incidental one: a photograph of a homework page taken at
           * home would otherwise carry the location of the home to a third party, which is
           * exactly the kind of thing this app exists not to do. Do not replace this with a
           * direct file upload without stripping EXIF some other way.
           */
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

  /*
   * The tutoring brief.
   *
   * This used to say "work through it step by step" and "state the final answer clearly at
   * the end", which is a homework machine. A student who photographs a question and gets a
   * finished solution has learned how to photograph a question. The whole value of the
   * feature is that it is used the night before an exam by someone who then has to sit it.
   *
   * So it gives the next move and nothing beyond it. The refusal to finish the problem is
   * the product, not a limitation of it — rule 6 exists because "just tell me" is the most
   * predictable thing a stuck student will say, and folding on it makes every other rule
   * decorative.
   */
  const TUTOR_RULES =
    '1. Say what the question is asking, in one sentence, so they know you have read it ' +
    'correctly.\n' +
    '2. Name the method or idea that applies, and why this problem calls for it.\n' +
    '3. Give ONE next step — the immediate one, not the chain. Then stop and let them do it.\n' +
    '4. NEVER state the final answer. NEVER work the problem to completion. Not the ' +
    'numeric result, not the simplified expression, not the finished proof. Not in an ' +
    'aside, not as a check, not "for reference".\n' +
    '5. If they have shown working, find the FIRST place it goes wrong and point at it ' +
    'without fixing it — say what is wrong with that line and let them redo it. If the ' +
    'working is right so far, say so and give the next step.\n' +
    '6. If they ask you to just give the answer, do not. Give a stronger hint instead. ' +
    'Being asked directly is not a reason to hand it over.\n' +
    '7. End with a question that moves them forward — something they can answer by doing ' +
    'the step you described.\n' +
    '8. If the image is unreadable or ambiguous, say so and ask for a clearer one rather ' +
    'than guessing. If you are unsure of a step, say which part. Never present a guess ' +
    'as certain.\n' +
    'Keep it short — a few sentences. Plain text, no markdown headers.';

  const SYSTEM_PROMPT =
    'You are tutoring a student who is stuck on a problem they have photographed. Your job ' +
    'is to get them unstuck, not to solve it for them.\n\n' +
    'Rules, in order of importance:\n' + TUTOR_RULES;

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

    const question = String(o.question || '').trim();

    const out = await V.aiProviders.send({
      key,
      model: o.model || V.aiProviders.defaultModelFor(key),
      system: SYSTEM_PROMPT,
      text: question || 'I am stuck on this. Walk me through it.',
      images: [{ base64: o.base64, mimeType: o.mimeType || 'image/jpeg' }],
      // Room for a worked explanation, and for the reasoning some models do before it.
      maxTokens: 8000,
      temperature: 0.2,
      effort: 'high',
      timeoutMs: 90000,
    });

    return { text: out.text, model: out.model, provider: out.provider };
  };

  // =========================================================================
  // Helping with a boxed-off part of the whiteboard
  // =========================================================================

  const BOARD_PROMPT =
    'You are tutoring a student who has drawn a box around part of their whiteboard and ' +
    'asked for help with what is inside it. Your job is to get them unstuck, not to solve ' +
    'it for them.\n\n' +
    'The image is only the boxed region, so it may be the middle of a longer piece of ' +
    'work. Answer about what you can see, and say so if it is missing something you need.\n\n' +
    'Rules, in order of importance:\n' + TUTOR_RULES + '\n\n' +
    'SEPARATELY, list any variable definitions written in the region — anything of the ' +
    'form "x = 5", "let v = 3 m/s", "r = 2.5". Report the name and the value exactly as ' +
    'written, units included. These are remembered for later, so only report a definition ' +
    'you can actually read; a misread value would silently corrupt every later answer. ' +
    'If the region defines none, return an empty list. Do not report a variable that is ' +
    'merely used rather than defined, and do not report the thing being solved for.';

  /** Beyond this the context is noise, and a runaway list would fill the prompt. */
  A.MAX_VARIABLES = 40;

  const BOARD_SCHEMA = {
    type: 'object',
    properties: {
      help: { type: 'string' },
      variables: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, value: { type: 'string' } },
          required: ['name', 'value'],
        },
      },
    },
    required: ['help', 'variables'],
  };

  /**
   * Help with one boxed region of a whiteboard.
   *
   * @param {object} o
   * @param {string} o.base64        PNG of the region alone, rendered by the caller
   * @param {string} [o.mimeType]
   * @param {string} [o.question]    what they typed, if anything
   * @param {Array}  [o.variables]   [{name, value}] already known, passed back in as context
   * @param {string} [o.model]
   * @returns {Promise<{text, variables, model, provider}>}
   *
   * NOTE: the parameter list is exhaustive, like `solve` and `extractCards`. `variables`
   * is whiteboard content the caller read from the notebook it belongs to — it is the
   * user's own handwriting, in the same category as the image itself. It is passed in
   * explicitly rather than read here, so the rule that this file's only store access is
   * its own API key still holds exactly. Nothing derived from health data may be passed
   * in through this or any other parameter.
   */
  A.tutorRegion = async function (o) {
    const key = await readKey();
    if (!key) throw new Error('No API key set. Add one in Settings.');
    if (!o || !o.base64) throw new Error('Nothing was selected.');

    const known = (o.variables || []).slice(0, A.MAX_VARIABLES);
    const asked = String(o.question || '').trim();

    const text =
      (known.length
        ? 'Already established elsewhere on this board: ' +
          known.map((v) => `${v.name} = ${v.value}`).join(', ') +
          '. Use these if the boxed work refers to them.\n\n'
        : '') +
      (asked || 'Help me with what is in the box. Do not solve it for me.');

    const out = await V.aiProviders.send({
      key,
      model: o.model || V.aiProviders.defaultModelFor(key),
      system: BOARD_PROMPT,
      text,
      images: [{ base64: o.base64, mimeType: o.mimeType || 'image/png' }],
      maxTokens: 12000,
      temperature: 0.2,
      effort: 'high',
      timeoutMs: 90000,
      jsonSchema: BOARD_SCHEMA,
    });

    return {
      text: parseBoardHelp(out.text),
      variables: parseBoardVariables(out.text),
      model: out.model,
      provider: out.provider,
    };
  };

  function boardJson(text) {
    try {
      const raw = String(text || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  /** A schema is a strong constraint, not a guarantee — a plain-prose reply still reads. */
  A.parseBoardHelp = parseBoardHelp;
  function parseBoardHelp(text) {
    const parsed = boardJson(text);
    const help = parsed && typeof parsed.help === 'string' ? parsed.help.trim() : '';
    return help || String(text || '').trim();
  }

  /*
   * A backstop for when the tutoring prompt does not hold.
   *
   * Be clear about what this is: a heuristic, not a filter. It cannot tell a worked
   * final answer from a legitimate intermediate step, because they look identical —
   * "x = 5" is the answer to one problem and the first line of another. So it matches
   * only explicit *declarations* of an answer, the phrasings a model reaches for when it
   * has decided to hand over the result, and never bare arithmetic.
   *
   * It does not hide anything. The reply is shown with a warning above it, because
   * silently withholding a response the student paid for would be worse than the leak,
   * and a false positive would then be invisible and unfixable. The prompt remains the
   * real defence; this exists so prompt drift is noticeable rather than silent.
   */
  const ANSWER_TELLS = [
    /\bthe (?:final )?answer is\b/i,
    /\bthe (?:final )?answer:\s/i,
    /\btherefore,?\s+(?:the\s+)?(?:answer|solution|result)\b/i,
    /\bso the (?:answer|solution|result) is\b/i,
    /\bwhich gives us the (?:answer|solution|final)\b/i,
    /\bin conclusion,? the\b/i,
  ];

  A.looksLikeFinalAnswer = function (text) {
    const s = String(text || '');
    return ANSWER_TELLS.some((re) => re.test(s));
  };

  A.parseBoardVariables = parseBoardVariables;
  function parseBoardVariables(text) {
    const parsed = boardJson(text);
    if (!parsed || !Array.isArray(parsed.variables)) return [];

    const seen = new Set();
    const out = [];
    for (const v of parsed.variables) {
      if (!v || typeof v.name !== 'string' || v.value == null) continue;
      const name = v.name.trim();
      const value = String(v.value).trim();
      // A nameless or valueless binding is not a binding, and a duplicate would let the
      // same symbol hold two values in the context.
      if (!name || !value || name.length > 24 || value.length > 60) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, value });
      if (out.length >= A.MAX_VARIABLES) break;
    }
    return out;
  }

  // =========================================================================
  // Turning pages into flashcards
  // =========================================================================

  /**
   * The extraction brief.
   *
   * Two failure modes matter more than anything else here, and most of this prompt exists
   * to suppress them:
   *
   *   Inventing content. A model asked for "20 cards" from a page holding eight facts will
   *   pad. Padded cards look plausible and are wrong, and a wrong flashcard drilled twenty
   *   times is worse than no flashcard — spaced repetition is very good at teaching you
   *   whatever you put in it. Hence: only what is on the page, and no fixed quota.
   *
   *   Cards you cannot answer. "What is discussed in section 3?" is recognisable but not
   *   recallable. Each front has to be answerable from knowledge, not from having seen the
   *   layout of the page.
   */
  const DECK_PROMPT =
    'You turn photographed study material into flashcards.\n\n' +
    'Rules, in order of importance:\n' +
    '1. ONLY use what is actually on the page. Never add facts from your own knowledge, ' +
    'never infer beyond what is written, and never pad to reach a number. Ten good cards ' +
    'from a dense page is a better answer than thirty stretched ones.\n' +
    '2. Every front must be answerable by someone who studied the material and no longer ' +
    'has the page. Never write "what does the diagram show" or "what is in section 2".\n' +
    '3. One idea per card. Split a sentence carrying three facts into three cards.\n' +
    '4. Backs are short — a phrase or a sentence, not a paragraph. If an answer needs a ' +
    'paragraph, the question was too broad.\n' +
    '5. Prefer the page\'s own wording for technical terms so the card matches what will ' +
    'be examined.\n' +
    '6. For definitions put the term on the front. For cause and effect ask for the effect. ' +
    'For processes ask what comes next.\n' +
    '7. If the image is unreadable, or holds no material worth memorising, return an empty ' +
    'array. Returning nothing is a valid and useful answer.\n' +
    '8. Skip anything that is not study content: page numbers, headers, copyright lines, ' +
    'the student\'s own handwriting in the margin.\n\n' +
    'Return JSON only, matching the supplied schema.';

  /** Hard cap per request, so one blurry page cannot produce a hundred junk cards. */
  A.MAX_CARDS_PER_REQUEST = 40;

  /** Shape of the reply. Every provider used here can be constrained to a JSON schema. */
  const CARDS_SCHEMA = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            front: { type: 'string' },
            back: { type: 'string' },
          },
          required: ['front', 'back'],
        },
      },
    },
    required: ['cards'],
  };

  /**
   * Extract flashcards from one or more photographed pages.
   *
   * @param {object} o
   * @param {Array}  o.images  [{ base64, mimeType }] — prepared by A.prepareImage
   * @param {string} [o.hint]  optional steer, e.g. "only the vocabulary list"
   * @param {string} [o.model]
   * @returns {Promise<{cards: Array<{front, back}>, model: string}>}
   *
   * NOTE: like `solve`, the parameter list is exhaustive. Nothing from the store is
   * accepted, and nothing derived from health data may ever be passed in.
   */
  A.extractCards = async function (o) {
    const key = await readKey();
    if (!key) throw new Error('No API key set. Add one in Settings.');
    const images = (o && o.images) || [];
    if (!images.length) throw new Error('No images provided.');

    const hint = String((o && o.hint) || '').trim();

    const out = await V.aiProviders.send({
      key,
      model: (o && o.model) || V.aiProviders.defaultModelFor(key),
      system: DECK_PROMPT,
      text: hint
        ? `Make flashcards from these ${images.length} page(s). Focus: ${hint}`
        : `Make flashcards from these ${images.length} page(s).`,
      images: images.map((img) => ({
        base64: img.base64,
        mimeType: img.mimeType || 'image/jpeg',
      })),
      maxTokens: 16000,
      // Low temperature: this is extraction, not writing. Creativity here means invention.
      temperature: 0.1,
      // The equivalent lever on providers that reject sampling parameters. Extraction from
      // a page in front of it does not need deep deliberation, and speed matters more.
      effort: 'low',
      // Asking for structured output rather than parsing prose out of a reply. The model is
      // constrained to the schema, which removes a whole class of parse failures.
      jsonSchema: CARDS_SCHEMA,
      // Longer than solve(): several images and a large structured reply.
      timeoutMs: 120000,
    });

    return { cards: A.parseCardsJson(out.text), model: out.model, provider: out.provider };
  };

  /**
   * Parse and sanitise the model's reply.
   *
   * Separate from the request so it can be tested without a network call, and defensive
   * even though a schema was supplied: responseSchema is a strong constraint, not a
   * guarantee, and a malformed reply must produce a clear error rather than a deck of
   * `undefined`.
   */
  A.parseCardsJson = function (text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      // Occasionally a model wraps JSON in a ```json fence despite being told not to.
      const match = String(text).match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not read the reply as flashcards.');
      try { parsed = JSON.parse(match[0]); } catch (e2) {
        throw new Error('Could not read the reply as flashcards.');
      }
    }

    const raw = parsed && Array.isArray(parsed.cards) ? parsed.cards : null;
    if (!raw) throw new Error('Could not read the reply as flashcards.');

    const seen = new Set();
    const cards = [];
    for (const c of raw) {
      const front = String((c && c.front) || '').trim();
      const back = String((c && c.back) || '').trim();
      // A card missing either side is not a card. Dropping it silently is right: the
      // review step shows exactly what survived, so nothing is hidden.
      if (!front || !back) continue;
      // Models repeat themselves across pages that cover the same ground.
      const fingerprint = front.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      cards.push({ front, back });
      if (cards.length >= A.MAX_CARDS_PER_REQUEST) break;
    }
    return cards;
  };

  A.SYSTEM_PROMPT = SYSTEM_PROMPT;
  A.DECK_PROMPT = DECK_PROMPT;
  A.BOARD_PROMPT = BOARD_PROMPT;
  A.TUTOR_RULES = TUTOR_RULES;
  V.aiVision = A;
})(window.V);
