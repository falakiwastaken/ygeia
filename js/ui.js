/* Ygeia — reusable UI pieces. Plain DOM construction, no framework. */
(function (V) {
  'use strict';

  const ui = {};
  const el = V.el;

  // ---------------------------------------------------------------- sheet --

  let sheetStack = [];
  /**
   * The stack entry whose DOM is currently on screen. Tracked separately from the top of
   * the stack because the two diverge for exactly as long as it takes to swap them, and
   * that is the window in which teardown has to run.
   */
  let mounted = null;

  /**
   * Open a bottom sheet. `build` receives the body element and returns nothing.
   * Sheets stack: opening one from another (food search -> portion picker) restores the
   * previous sheet on close rather than dumping the user back to the root view.
   */
  ui.sheet = function (title, build, opts) {
    const body = V.$('#sheet-body');

    if (sheetStack.length) {
      sheetStack[sheetStack.length - 1].scroll = body.scrollTop;
    }
    sheetStack.push({ title, build, opts: opts || {}, scroll: 0, teardown: [] });
    renderSheet();
  };

  /**
   * Register cleanup for the sheet being built right now.
   *
   * Anything a builder starts that outlives a paint — a timer, an animation frame loop,
   * a microphone stream — has to be stoppable, and the sheet can go away by six different
   * routes (the × button, the backdrop, Escape, a nested sheet opening, a refresh, the
   * auto-lock). Registering here covers all of them; remembering to clear it in one
   * particular button handler does not.
   */
  ui.onSheetTeardown = function (fn) {
    const top = sheetStack[sheetStack.length - 1];
    if (top) top.teardown.push(fn);
  };

  function unmount() {
    if (!mounted) return;
    const fns = mounted.teardown;
    mounted.teardown = [];
    mounted = null;
    for (const fn of fns) {
      /*
       * One broken cleanup must not strand the others — a mic left recording is worse
       * than a swallowed error.
       *
       * Some teardown callbacks are async (the notebook flushes its last unsaved
       * keystrokes here). A bare `try { fn() }` returns the moment such a function hits
       * its first await, so the catch could never see a rejection and the failure went to
       * the console as an unhandled one. Handle both shapes.
       */
      try {
        const r = fn();
        if (r && typeof r.then === 'function') {
          r.catch((err) => console.error('sheet teardown failed (async)', err));
        }
      } catch (err) {
        console.error('sheet teardown failed', err);
      }
    }
  }

  /**
   * Show a failed sheet as a failure, rather than as nothing.
   *
   * Whatever the builder managed to render before it threw is discarded on purpose. A
   * half-built sheet is worse than an empty one — a Save button whose inputs never got
   * appended looks operable and is not — so the partial UI goes and an explanation with
   * a retry takes its place.
   */
  function showSheetError(body, err) {
    console.error('[Ygeia] sheet failed to build:', err);
    body.innerHTML = '';
    body.appendChild(
      el('div', { className: 'warn-box' }, [
        el('div', { html: '<strong>This didn’t load.</strong>' }),
        el('div', {
          style: { marginTop: '6px' },
          text: String(err && err.message ? err.message : err),
        }),
      ]),
    );
    body.appendChild(el('div', { style: { height: '12px' } }));
    body.appendChild(ui.button('Try again', () => ui.refreshSheet(), 'btn-primary'));
    body.appendChild(
      el('div', {
        className: 'hint',
        text: 'If it keeps failing, reload the app. Nothing has been deleted.',
      }),
    );
  }

  /*
   * Focus management.
   *
   * #sheet has declared role="dialog" aria-modal="true" since it was written, and nothing
   * ever enforced it: focus stayed on whatever button opened the sheet, Tab walked straight
   * out of the "modal" into the tab bar behind it, a screen reader could swipe through the
   * whole app underneath, and closing dropped focus to <body> so a keyboard user restarted
   * from the top of the page every time.
   *
   * This is done with `inert` plus a Tab trap rather than by converting to <dialog>.
   * <dialog>.showModal() would supply all of it natively and delete code — but it renders
   * in the top layer, which is above every z-index, and #lock-screen is a plain element at
   * z-index 100. A sheet promoted to the top layer would therefore paint OVER the passcode
   * gate. Fixing that means converting the lock screen too and getting their order right,
   * which is not a change to make casually to the thing standing between a stranger and
   * someone's health record.
   */
  const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
    'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  /** Whatever had focus when the first sheet in a stack opened, so it can be handed back. */
  let restoreFocusTo = null;

  const backgroundEls = () => [V.$('.app-header'), V.$('#views'), V.$('#tabbar')].filter(Boolean);

  function setBackgroundInert(on) {
    for (const node of backgroundEls()) {
      if (on) node.setAttribute('inert', '');
      else node.removeAttribute('inert');
    }
  }

  /** Move focus into the sheet: the first real control, or the panel itself. */
  function focusIntoSheet() {
    const panel = V.$('#sheet');
    if (!panel) return;
    const body = V.$('#sheet-body');
    const first = body && body.querySelector(FOCUSABLE);
    // Prefer a control inside the body over the close button, which is the least useful
    // thing to land on, but fall back to the panel so focus is never left outside.
    (first || panel).focus({ preventScroll: true });
  }

  /*
   * Keep Tab inside the sheet. `inert` already stops the background taking focus in
   * browsers that support it; this closes the loop at the ends of the sheet's own order
   * and covers the rest.
   */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !sheetStack.length) return;
    const panel = V.$('#sheet');
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll(FOCUSABLE))
      .filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) { e.preventDefault(); panel.focus({ preventScroll: true }); return; }

    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  function renderSheet() {
    const backdrop = V.$('#sheet-backdrop');
    const body = V.$('#sheet-body');
    const top = sheetStack[sheetStack.length - 1];

    const wasClosed = backdrop.hidden;

    unmount();
    if (!top) { backdrop.hidden = true; return; }

    // Remember the opener only for the outermost sheet — a nested sheet should hand focus
    // back to the sheet that opened it, not all the way out to the view behind.
    if (wasClosed) restoreFocusTo = document.activeElement;

    V.$('#sheet-title').textContent = top.title;
    body.innerHTML = '';
    backdrop.hidden = false;
    setBackgroundInert(true);
    mounted = top;

    /*
     * Builders are routinely async — nearly all of them read from IndexedDB first. An
     * unhandled rejection in one used to leave the sheet sitting there blank and silent,
     * which reads as the app having swallowed the tap. Both failure modes are caught:
     * a synchronous throw, and a rejected promise.
     */
    let result;
    try {
      result = top.build(body);
    } catch (err) {
      showSheetError(body, err);
      return;
    }
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
        // Only report if this sheet is still the one on screen; by the time a slow
        // builder fails the user may well have moved on, and hijacking whatever they
        // opened next would be worse than staying quiet.
        if (mounted === top) showSheetError(body, err);
        else console.error('[Ygeia] sheet failed after dismissal:', err);
      });
    }
    body.scrollTop = top.scroll || 0;

    /*
     * After the builder has run, so there is something to focus. Async builders have not
     * populated the body yet at this point, so this runs again on the next frame — landing
     * on the panel first is still correct, and much better than leaving focus outside.
     */
    focusIntoSheet();
    // setTimeout rather than requestAnimationFrame: rAF is throttled to nothing while the
    // page is hidden, and this must still settle focus correctly when the app is restored.
    setTimeout(() => { if (mounted === top) focusIntoSheet(); }, 0);
  }

  /** Close the top sheet, revealing whatever was underneath. */
  ui.closeSheet = function (all) {
    if (all) sheetStack = [];
    else sheetStack.pop();
    if (!sheetStack.length) {
      unmount();
      V.$('#sheet-backdrop').hidden = true;
      V.$('#sheet-body').innerHTML = '';
      setBackgroundInert(false);
      // Hand focus back to whatever opened the sheet, so a keyboard user carries on from
      // where they were instead of restarting at the top of the page.
      if (restoreFocusTo && document.contains(restoreFocusTo)) {
        restoreFocusTo.focus({ preventScroll: true });
      }
      restoreFocusTo = null;
    } else {
      renderSheet();
    }
  };

  /** Re-run the current sheet's builder — used after a mutation to refresh in place. */
  ui.refreshSheet = function () {
    if (!sheetStack.length) return;
    const body = V.$('#sheet-body');
    sheetStack[sheetStack.length - 1].scroll = body.scrollTop;
    renderSheet();
  };

  ui.sheetOpen = () => sheetStack.length > 0;

  // ----------------------------------------------------------------- ring --

  /**
   * Progress ring. `value/max` fills the arc; overflow past 100% is clamped visually but
   * reported honestly in the centre label (eating 2400 of 2000 kcal shows a full ring and
   * the real number, never a partial one).
   */
  ui.ring = function (o) {
    const size = o.size || 96;
    const stroke = o.stroke || 9;
    const r = (size - stroke) / 2;
    const circumference = 2 * Math.PI * r;
    const pct = o.max > 0 ? V.clamp(o.value / o.max, 0, 1) : 0;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const mk = (cls, extra) => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', size / 2);
      c.setAttribute('cy', size / 2);
      c.setAttribute('r', r);
      c.setAttribute('stroke-width', stroke);
      c.setAttribute('class', cls);
      for (const k in extra || {}) c.setAttribute(k, extra[k]);
      return c;
    };

    svg.appendChild(mk('ring-track'));
    svg.appendChild(mk('ring-fill', {
      stroke: o.color || 'var(--info)',
      'stroke-dasharray': circumference,
      'stroke-dashoffset': circumference * (1 - pct),
    }));

    const centre = el('div', { className: 'ring-center' }, [
      el('div', { className: 'ring-value', text: o.centerText != null ? o.centerText : V.fmt(o.value) }),
      o.centerSub ? el('div', { className: 'ring-unit', text: o.centerSub }) : null,
    ]);

    const ring = el('div', { className: 'ring', style: { width: size + 'px', height: size + 'px' } });
    ring.appendChild(svg);
    ring.appendChild(centre);

    return el('div', { className: 'ring-wrap' }, [
      ring,
      o.label ? el('div', { className: 'ring-label', text: o.label }) : null,
    ]);
  };

  // ------------------------------------------------------------------ bar --

  ui.bar = function (value, max, color) {
    const pct = max > 0 ? V.clamp(value / max, 0, 1) * 100 : 0;
    return el('div', { className: 'bar' }, [
      el('div', { className: 'bar-fill', style: { width: pct + '%', background: color || 'var(--info)' } }),
    ]);
  };

  /** Labelled macro bar: "Protein  120 / 150 g". */
  ui.macroBar = function (label, value, target, color, unit) {
    return el('div', { className: 'macro-block' }, [
      el('div', { className: 'macro-row' }, [
        el('span', { text: label }),
        el('span', { className: 'num', text: `${V.fmt(value)} / ${V.fmt(target)}${unit || 'g'}` }),
      ]),
      ui.bar(value, target, color),
    ]);
  };

  // ----------------------------------------------------------------- rows --

  /** `subColor` tints the subtitle — used to show an interpretation band in its colour. */
  ui.row = function (o) {
    const node = el(o.onClick ? 'button' : 'div', { className: 'row', type: 'button' }, [
      el('div', { className: 'row-main' }, [
        el('div', { className: 'row-title', text: o.title }),
        o.sub ? el('div', { className: 'row-sub', text: o.sub, style: o.subColor ? { color: o.subColor } : null }) : null,
      ]),
      o.value != null ? el('div', { className: 'row-value', text: o.value }) : null,
      o.accessory || null,
    ]);
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  };

  ui.list = function (rows) {
    const items = rows.filter(Boolean);
    if (!items.length) return null;
    return el('div', { className: 'list' }, items);
  };

  ui.empty = (text) => el('div', { className: 'empty', text });

  // ---------------------------------------------------------------- cards --

  ui.card = function (o) {
    const head = (o.title || o.action)
      ? el('div', { className: 'card-head' }, [
          el('div', {}, [
            el('h3', { className: 'card-title', text: o.title || '' }),
            o.sub ? el('div', { className: 'card-sub', text: o.sub }) : null,
          ]),
          o.action || null,
        ])
      : null;
    return el('div', { className: 'card' }, [head].concat(o.children || []));
  };

  /**
   * A grid of tiles for "open a thing" destinations.
   *
   * Several places had grown a run of cards that were each a title, a line of subtitle and
   * one full-width button — structurally identical, so a screen of them reads as a stack of
   * grey rectangles and nothing looks more important than anything else. A card should earn
   * its width by holding something: a number, a chart, a state. A door does not, and belongs
   * in a grid with the other doors.
   *
   * @param {Array} items [{ icon, label, sub, accent, onClick }]
   */
  ui.tiles = function (items) {
    const live = (items || []).filter(Boolean);
    return el('div', { className: 'tile-grid' }, live.map((t) =>
      el('button', {
        className: 'tile',
        type: 'button',
        on: { click: t.onClick },
      }, [
        el('span', {
          className: 'tile-icon',
          // The accent is the only thing separating one tile from the next at a glance,
          // so it is per-destination rather than a single theme colour.
          style: t.accent ? { background: `color-mix(in srgb, ${t.accent} 18%, transparent)` } : null,
          text: t.icon,
        }),
        // Wrapped so a lone final tile can lay itself out as a row without the label and
        // its subtitle ending up side by side.
        el('span', { className: 'tile-text' }, [
          el('span', { className: 'tile-label', text: t.label }),
          t.sub ? el('span', { className: 'tile-sub', text: t.sub }) : null,
        ]),
      ]),
    ));
  };

  ui.stat = function (o) {
    let deltaClass = 'delta-flat';
    if (o.delta != null && o.delta !== 0) {
      // `higherIsBetter: false` flips the colour so falling weight reads as progress.
      const good = o.higherIsBetter === false ? o.delta < 0 : o.delta > 0;
      deltaClass = good ? 'delta-up' : 'delta-down';
    }
    return el('div', { className: 'stat' }, [
      el('div', { className: 'stat-label', text: o.label }),
      el('div', { className: 'stat-value' }, [
        document.createTextNode(o.value),
        o.unit ? el('span', { className: 'stat-unit', text: o.unit }) : null,
      ]),
      o.deltaText ? el('div', { className: 'stat-delta ' + deltaClass, text: o.deltaText }) : null,
    ]);
  };

  ui.sectionTitle = (text) => el('div', { className: 'section-title', text });

  // --------------------------------------------------------------- inputs --

  ui.field = function (label, input, hint) {
    return el('div', { className: 'field' }, [
      el('label', { text: label }),
      input,
      hint ? el('div', { className: 'hint', text: hint }) : null,
    ]);
  };

  ui.input = function (o) {
    return el('input', Object.assign({
      type: 'text',
      // 'decimal' gives iOS a numeric keypad with a decimal point but no +/- clutter.
      inputMode: o.type === 'number' ? 'decimal' : undefined,
    }, o));
  };

  ui.select = function (options, value, onChange) {
    const sel = el('select', { on: { change: (e) => onChange(e.target.value) } });
    for (const opt of options) {
      sel.appendChild(el('option', { value: opt.value, text: opt.label, selected: opt.value === value }));
    }
    return sel;
  };

  ui.segmented = function (options, value, onChange) {
    const wrap = el('div', { className: 'chips' });
    for (const opt of options) {
      wrap.appendChild(el('button', {
        className: 'chip' + (opt.value === value ? ' on' : ''),
        type: 'button',
        text: opt.label,
        on: { click: () => onChange(opt.value) },
      }));
    }
    return wrap;
  };

  /**
   * On/off switch. `onChange` receives the new boolean.
   * A real checkbox underneath, so it is keyboard-reachable and reads correctly to
   * assistive tech; the visual track and knob are drawn by CSS from :checked.
   */
  ui.toggle = function (checked, onChange, label) {
    const input = el('input', { type: 'checkbox', checked: !!checked, className: 'toggle-input' });
    if (label) input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.checked));
    return el('label', { className: 'toggle' }, [input, el('span', { className: 'toggle-track' })]);
  };

  ui.button = function (label, onClick, variant) {
    return el('button', {
      className: 'btn ' + (variant || ''),
      type: 'button',
      text: label,
      on: { click: onClick },
    });
  };

  // -------------------------------------------------------------- helpers --

  /** Read a numeric input, returning `fallback` for blank or non-numeric values. */
  ui.num = function (input, fallback) {
    const v = parseFloat(String(input.value).replace(',', '.'));
    return Number.isFinite(v) ? v : (fallback != null ? fallback : 0);
  };

  V.ui = ui;
})(window.V);
