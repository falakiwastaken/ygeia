/* Vitals — small shared helpers. Loaded first; everything else builds on window.V. */
window.V = window.V || {};

(function (V) {
  'use strict';

  // ------------------------------------------------------------------ DOM --

  V.$ = (sel, root) => (root || document).querySelector(sel);
  V.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Build an element. `attrs.html` sets innerHTML, `attrs.on` binds listeners. */
  V.el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'on') for (const ev in v) node.addEventListener(ev, v[ev]);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k in node && k !== 'list') node[k] = v;
        else node.setAttribute(k, v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  };

  /** Escape untrusted text before it goes anywhere near innerHTML. */
  V.esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // ----------------------------------------------------------------- ids ---

  /**
   * Sortable unique id: time prefix + randomness. crypto.randomUUID isn't available
   * on file:// in every browser, so this avoids depending on a secure context.
   */
  V.uid = function () {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  };

  // ---------------------------------------------------------------- dates --

  /**
   * Local calendar day as 'YYYY-MM-DD'.
   * Built from local getters, never toISOString() — that converts to UTC and silently
   * shifts the date by one for anyone west of Greenwich after their local evening.
   */
  V.dateKey = function (d) {
    d = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  V.parseKey = function (key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  V.addDays = function (key, n) {
    const d = V.parseKey(key);
    d.setDate(d.getDate() + n);
    return V.dateKey(d);
  };

  V.today = () => V.dateKey(new Date());

  V.daysBetween = function (a, b) {
    return Math.round((V.parseKey(b) - V.parseKey(a)) / 86400000);
  };

  /** Last n days ending at `end` (inclusive), oldest first. */
  V.lastNDays = function (n, end) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(V.addDays(end || V.today(), -i));
    return out;
  };

  V.friendlyDate = function (key) {
    const t = V.today();
    if (key === t) return 'Today';
    if (key === V.addDays(t, -1)) return 'Yesterday';
    if (key === V.addDays(t, 1)) return 'Tomorrow';
    return V.parseKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  V.longDate = (key) =>
    V.parseKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  V.timeOfDay = function (ms) {
    return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  // ----------------------------------------------------------------- fmt ---

  V.round = (n, dp) => {
    const f = Math.pow(10, dp || 0);
    return Math.round((Number(n) || 0) * f) / f;
  };

  V.fmt = function (n, dp) {
    const r = V.round(n, dp == null ? 0 : dp);
    return Number.isFinite(r) ? r.toLocaleString(undefined, { maximumFractionDigits: dp == null ? 0 : dp }) : '–';
  };

  V.clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  V.pluralise = (n, one, many) => `${V.fmt(n)} ${n === 1 ? one : (many || one + 's')}`;

  V.sum = (arr, pick) => arr.reduce((a, x) => a + (pick ? pick(x) || 0 : x || 0), 0);

  V.groupBy = function (arr, key) {
    const out = {};
    for (const x of arr) {
      const k = typeof key === 'function' ? key(x) : x[key];
      (out[k] = out[k] || []).push(x);
    }
    return out;
  };

  V.debounce = function (fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  // --------------------------------------------------------------- units ---

  V.KG_PER_LB = 0.45359237;
  V.CM_PER_IN = 2.54;

  V.kgToDisplay = (kg, unit) => (unit === 'lb' ? kg / V.KG_PER_LB : kg);
  V.displayToKg = (v, unit) => (unit === 'lb' ? v * V.KG_PER_LB : v);
  V.cmToDisplay = (cm, unit) => (unit === 'in' ? cm / V.CM_PER_IN : cm);
  V.displayToCm = (v, unit) => (unit === 'in' ? v * V.CM_PER_IN : v);

  /** Round a weight to the smallest increment that gym plates actually allow. */
  V.roundToIncrement = (kg, unit) => {
    const inc = unit === 'lb' ? 1.13398 : 1.25; // 2.5 lb or 2.5 kg total (both sides)
    return Math.round(kg / inc) * inc;
  };

  // ------------------------------------------------------------ feedback ---

  let toastTimer = null;
  V.toast = function (msg) {
    const t = V.$('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  };

  V.haptic = function (ms) {
    // Absent on iOS Safari — call is harmless there, so no capability branch needed.
    if (navigator.vibrate) navigator.vibrate(ms || 8);
  };

  V.confirm = (msg) => window.confirm(msg);

})(window.V);
