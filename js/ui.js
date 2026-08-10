/* Vitals — reusable UI pieces. Plain DOM construction, no framework. */
(function (V) {
  'use strict';

  const ui = {};
  const el = V.el;

  // ---------------------------------------------------------------- sheet --

  let sheetStack = [];

  /**
   * Open a bottom sheet. `build` receives the body element and returns nothing.
   * Sheets stack: opening one from another (food search -> portion picker) restores the
   * previous sheet on close rather than dumping the user back to the root view.
   */
  ui.sheet = function (title, build, opts) {
    const backdrop = V.$('#sheet-backdrop');
    const body = V.$('#sheet-body');
    const titleEl = V.$('#sheet-title');

    if (sheetStack.length) {
      sheetStack[sheetStack.length - 1].scroll = body.scrollTop;
    }
    sheetStack.push({ title, build, opts: opts || {}, scroll: 0 });
    renderSheet();
  };

  function renderSheet() {
    const backdrop = V.$('#sheet-backdrop');
    const body = V.$('#sheet-body');
    const top = sheetStack[sheetStack.length - 1];
    if (!top) { backdrop.hidden = true; return; }

    V.$('#sheet-title').textContent = top.title;
    body.innerHTML = '';
    backdrop.hidden = false;
    top.build(body);
    body.scrollTop = top.scroll || 0;
  }

  /** Close the top sheet, revealing whatever was underneath. */
  ui.closeSheet = function (all) {
    if (all) sheetStack = [];
    else sheetStack.pop();
    if (!sheetStack.length) {
      V.$('#sheet-backdrop').hidden = true;
      V.$('#sheet-body').innerHTML = '';
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

  ui.row = function (o) {
    const node = el(o.onClick ? 'button' : 'div', { className: 'row', type: 'button' }, [
      el('div', { className: 'row-main' }, [
        el('div', { className: 'row-title', text: o.title }),
        o.sub ? el('div', { className: 'row-sub', text: o.sub }) : null,
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
