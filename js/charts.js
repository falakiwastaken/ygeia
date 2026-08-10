/*
 * Vitals — hand-rolled SVG charts.
 *
 * No charting library. These render a fixed viewBox scaled by CSS, so they stay crisp at
 * any width and cost nothing to load.
 */
(function (V) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const charts = {};

  function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs || {}) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    return node;
  }

  function frame(w, h) {
    const svg = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`,
      class: 'chart',
      preserveAspectRatio: 'xMidYMid meet',
    });
    return svg;
  }

  /**
   * Line chart over {date, value} points, with an optional dashed projection.
   *
   * The y-axis is padded by 8% of the range so the line never touches the edges, and a
   * flat series (every value identical) gets an artificial range so it renders as a
   * centred horizontal line instead of dividing by zero.
   */
  charts.line = function (data, opts) {
    const o = opts || {};
    const W = 340, H = o.height || 120;
    const padL = 4, padR = 4, padT = 10, padB = 16;
    const svg = frame(W, H);

    const all = data.concat(o.projection || []);
    if (data.length < 2) {
      svg.appendChild(svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart-label' }));
      svg.lastChild.textContent = 'Not enough data yet';
      return svg;
    }

    let min = Math.min(...all.map((d) => d.value));
    let max = Math.max(...all.map((d) => d.value));
    if (o.min != null) min = Math.min(min, o.min);
    if (o.max != null) max = Math.max(max, o.max);
    if (max === min) { max += 1; min -= 1; }
    const range = max - min;
    min -= range * 0.08;
    max += range * 0.08;

    const firstDate = all[0].date;
    const lastDate = all[all.length - 1].date;
    const spanDays = Math.max(1, V.daysBetween(firstDate, lastDate));

    const x = (d) => padL + (V.daysBetween(firstDate, d.date) / spanDays) * (W - padL - padR);
    const y = (d) => padT + (1 - (d.value - min) / (max - min)) * (H - padT - padB);

    // Horizontal guide lines at the extremes and midpoint.
    for (const frac of [0, 0.5, 1]) {
      const yy = padT + frac * (H - padT - padB);
      svg.appendChild(svgEl('line', { x1: padL, y1: yy, x2: W - padR, y2: yy, class: 'chart-grid' }));
    }

    const color = o.color || 'var(--info)';
    const path = data.map((d, i) => `${i ? 'L' : 'M'}${V.round(x(d), 2)},${V.round(y(d), 2)}`).join(' ');

    if (o.fill !== false) {
      const area = `${path} L${V.round(x(data[data.length - 1]), 2)},${H - padB} L${V.round(x(data[0]), 2)},${H - padB} Z`;
      svg.appendChild(svgEl('path', { d: area, class: 'chart-area', fill: color }));
    }

    svg.appendChild(svgEl('path', { d: path, class: 'chart-line', stroke: color }));

    if (o.projection && o.projection.length) {
      const start = data[data.length - 1];
      const proj = [start].concat(o.projection);
      const pPath = proj.map((d, i) => `${i ? 'L' : 'M'}${V.round(x(d), 2)},${V.round(y(d), 2)}`).join(' ');
      svg.appendChild(svgEl('path', { d: pPath, class: 'chart-proj', stroke: o.projColor || 'var(--text-faint)' }));
    }

    // Emphasise the most recent actual reading.
    const last = data[data.length - 1];
    svg.appendChild(svgEl('circle', { cx: x(last), cy: y(last), r: 3.5, fill: color, class: 'chart-dot' }));

    if (o.showBounds !== false) {
      const hi = svgEl('text', { x: padL, y: padT - 2, class: 'chart-label' });
      hi.textContent = V.fmt(max, o.dp == null ? 0 : o.dp);
      const lo = svgEl('text', { x: padL, y: H - 4, class: 'chart-label' });
      lo.textContent = V.fmt(min, o.dp == null ? 0 : o.dp);
      svg.appendChild(hi);
      svg.appendChild(lo);
    }

    return svg;
  };

  /**
   * Bar chart over {label, value} points. Bars below `target` are dimmed so adherence is
   * readable at a glance without a legend.
   */
  charts.bars = function (data, opts) {
    const o = opts || {};
    const W = 340, H = o.height || 110;
    const padT = 8, padB = 16;
    const svg = frame(W, H);

    if (!data.length) return svg;

    const max = Math.max(o.target || 0, ...data.map((d) => d.value)) || 1;
    const slot = W / data.length;
    const barW = Math.min(slot * 0.62, 26);

    if (o.target) {
      const ty = padT + (1 - o.target / max) * (H - padT - padB);
      svg.appendChild(svgEl('line', { x1: 0, y1: ty, x2: W, y2: ty, class: 'chart-grid' }));
    }

    data.forEach((d, i) => {
      const h = Math.max(2, (d.value / max) * (H - padT - padB));
      const bx = i * slot + (slot - barW) / 2;
      const by = H - padB - h;
      svg.appendChild(svgEl('rect', {
        x: V.round(bx, 2), y: V.round(by, 2), width: V.round(barW, 2), height: V.round(h, 2),
        class: 'chart-bar',
        fill: o.color || 'var(--info)',
        opacity: o.target && d.value < o.target * 0.9 ? 0.4 : 1,
      }));

      if (d.label) {
        const t = svgEl('text', {
          x: V.round(i * slot + slot / 2, 2), y: H - 4,
          'text-anchor': 'middle', class: 'chart-label',
        });
        t.textContent = d.label;
        svg.appendChild(t);
      }
    });

    return svg;
  };

  /** Compact inline trend line with no axes, for stat tiles. */
  charts.sparkline = function (values, opts) {
    const o = opts || {};
    const W = 100, H = o.height || 28;
    const svg = frame(W, H);
    if (values.length < 2) return svg;

    let min = Math.min(...values), max = Math.max(...values);
    if (max === min) { max += 1; min -= 1; }

    const path = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * W;
        const y = 2 + (1 - (v - min) / (max - min)) * (H - 4);
        return `${i ? 'L' : 'M'}${V.round(x, 2)},${V.round(y, 2)}`;
      })
      .join(' ');

    svg.appendChild(svgEl('path', { d: path, class: 'chart-line', stroke: o.color || 'var(--info)' }));
    return svg;
  };

  V.charts = charts;
})(window.V);
