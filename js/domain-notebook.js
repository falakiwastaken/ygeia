/*
 * Ygeia — notebook and whiteboard geometry.
 *
 * The whiteboard stores strokes as vectors, not as an image. Three reasons, in order of
 * how much trouble the alternative would have caused:
 *
 *   1. Backups. js/backup.js serialises every store through JSON.stringify. A Blob or an
 *      ImageData survives IndexedDB's structured clone perfectly well and then serialises
 *      to `{}` — so every drawing would vanish from exports silently, and nobody would
 *      find out until they tried to restore.
 *   2. Size. A page of handwriting is a few kB of coordinates against a few hundred kB
 *      of PNG, and this is a database that has to live in a phone's storage quota.
 *   3. Resolution. Vectors redraw crisply at any zoom and any device pixel ratio. The
 *      canvas is a view of the strokes, never the source of truth.
 *
 * Coordinates are in world space: an unbounded plane where one unit is one CSS pixel at
 * zoom 1. The canvas pans and zooms over it, like Microsoft Whiteboard, so there is no
 * page boundary to normalise against.
 *
 * Pure functions. No DOM, no storage.
 */
(function (V) {
  'use strict';

  const N = {};

  /**
   * Simplification tolerance in world units.
   *
   * A pointer at 120 Hz emits hundreds of points a second, most of them within a pixel of
   * the line they sit on. Below about 0.7 units the discarded points are invisible; above
   * about 1.5 the curves start to visibly corner.
   */
  N.SIMPLIFY_TOLERANCE = 0.8;

  /** Stored coordinate precision. One decimal is well below what any screen resolves. */
  N.PRECISION = 1;

  // =========================================================================
  // Stroke simplification
  // =========================================================================

  /** Perpendicular distance from p to the line through a and b. */
  function perpendicularDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    // Degenerate segment: a and b are the same point, so fall back to point distance.
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    return Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.hypot(dx, dy);
  }

  /**
   * Ramer–Douglas–Peucker, iterative rather than recursive.
   *
   * A long stroke can run to thousands of points, and the recursive form is a stack
   * overflow waiting for the one user who draws a very long continuous line.
   *
   * @param {Array<number>} pts flat [x, y, x, y, ...]
   * @returns {Array<number>} the same format, with redundant points removed
   */
  N.simplify = function (pts, tolerance) {
    const tol = tolerance == null ? N.SIMPLIFY_TOLERANCE : tolerance;
    const n = pts.length / 2;
    if (n < 3) return pts.slice();

    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;

    const stack = [[0, n - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      if (last <= first + 1) continue;

      let maxDist = -1;
      let index = first;
      const ax = pts[first * 2], ay = pts[first * 2 + 1];
      const bx = pts[last * 2], by = pts[last * 2 + 1];

      for (let i = first + 1; i < last; i++) {
        const d = perpendicularDistance(pts[i * 2], pts[i * 2 + 1], ax, ay, bx, by);
        if (d > maxDist) { maxDist = d; index = i; }
      }

      if (maxDist > tol) {
        keep[index] = 1;
        stack.push([first, index], [index, last]);
      }
    }

    const out = [];
    for (let i = 0; i < n; i++) {
      if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
    }
    return out;
  };

  /** Round coordinates before storing. Halves the JSON size for no visible loss. */
  N.quantise = function (pts) {
    return pts.map((v) => V.round(v, N.PRECISION));
  };

  // =========================================================================
  // Geometry
  // =========================================================================

  /** Bounding box of one stroke, or null for an empty one. */
  N.strokeBounds = function (stroke) {
    const pts = stroke && stroke.pts;
    if (!pts || pts.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < minX) minX = pts[i];
      if (pts[i] > maxX) maxX = pts[i];
      if (pts[i + 1] < minY) minY = pts[i + 1];
      if (pts[i + 1] > maxY) maxY = pts[i + 1];
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  };

  /** Bounding box of everything drawn — used to fit the view to the content. */
  N.contentBounds = function (strokes) {
    let box = null;
    for (const s of strokes || []) {
      const b = N.strokeBounds(s);
      if (!b) continue;
      if (!box) { box = Object.assign({}, b); continue; }
      box.minX = Math.min(box.minX, b.minX);
      box.minY = Math.min(box.minY, b.minY);
      box.maxX = Math.max(box.maxX, b.maxX);
      box.maxY = Math.max(box.maxY, b.maxY);
    }
    if (!box) return null;
    box.width = box.maxX - box.minX;
    box.height = box.maxY - box.minY;
    return box;
  };

  /** Shortest distance from a point to a stroke's polyline. */
  N.distanceToStroke = function (stroke, x, y) {
    const pts = stroke && stroke.pts;
    if (!pts || pts.length < 2) return Infinity;
    // A single-point stroke is a dot, which is still erasable.
    if (pts.length === 2) return Math.hypot(x - pts[0], y - pts[1]);

    let best = Infinity;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i], ay = pts[i + 1];
      const bx = pts[i + 2], by = pts[i + 3];
      const dx = bx - ax, dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      // Project onto the segment and clamp, so the nearest point is on the segment
      // itself rather than on the infinite line through it.
      const t = lenSq === 0 ? 0 : V.clamp(((x - ax) * dx + (y - ay) * dy) / lenSq, 0, 1);
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < best) best = d;
    }
    return best;
  };

  /**
   * Whole-stroke eraser: drop every stroke passing within `radius` of the point.
   *
   * Erasing whole strokes rather than pixels is what keeps the vector model intact, and
   * it is also what most people actually want from a digital eraser — a scribble comes
   * off in one pass instead of needing to be scrubbed out.
   *
   * @returns {{strokes, removed}} a new array; the input is not mutated
   */
  N.eraseAt = function (strokes, x, y, radius) {
    const r = radius == null ? 8 : radius;
    const kept = [];
    let removed = 0;
    for (const s of strokes || []) {
      // The stroke's own width counts: a fat line should be erasable from its edge.
      if (N.distanceToStroke(s, x, y) <= r + (s.width || 1) / 2) removed++;
      else kept.push(s);
    }
    return { strokes: kept, removed };
  };

  // =========================================================================
  // Pages
  // =========================================================================

  /** Renumber pages 0..n-1 after an insert or delete, preserving order. */
  N.reindexPages = function (pages) {
    return (pages || [])
      .slice()
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p, i) => Object.assign({}, p, { index: i }));
  };

  /** Rough serialised size of a page, so the UI can warn before a notebook gets silly. */
  N.estimateBytes = function (page) {
    if (!page) return 0;
    if (page.kind === 'text') return (page.text || '').length;
    // Each coordinate serialises to about 6 characters including the separator.
    return V.sum(page.strokes || [], (s) => (s.pts ? s.pts.length * 6 + 40 : 0));
  };

  /** First line of a text page, or a stroke count — used as the page's label in the list. */
  N.pageSummary = function (page) {
    if (!page) return '';
    if (page.kind === 'text') {
      const first = (page.text || '').split('\n').find((l) => l.trim());
      return first ? first.trim().slice(0, 60) : 'Empty page';
    }
    const count = (page.strokes || []).length;
    return count ? V.pluralise(count, 'stroke') : 'Blank';
  };

  // ======================================================================
  // Boxing off a region to ask about
  // ======================================================================

  /**
   * Turn two drag corners into a rectangle.
   *
   * Dragging up-and-left is just as natural as down-and-right, and produces negative
   * width. Everything downstream — hit testing, cropping, the canvas call that renders
   * the region — assumes positive extents.
   */
  N.normaliseRect = function (x0, y0, x1, y1) {
    return {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0),
      h: Math.abs(y1 - y0),
    };
  };

  /** Too small to be deliberate — a click that moved a few pixels is not a selection. */
  N.MIN_REGION = 24;

  N.isUsableRect = function (rect) {
    return !!rect && rect.w >= N.MIN_REGION && rect.h >= N.MIN_REGION;
  };

  /**
   * Strokes that intersect the box.
   *
   * Intersecting, not contained. Requiring full containment would drop the long division
   * bar or the equals sign whose tail pokes out of the box, and the student would be asked
   * about a fragment of their own working. Overshooting slightly is the safe direction.
   */
  N.strokesInRect = function (strokes, rect) {
    if (!rect) return [];
    const x2 = rect.x + rect.w;
    const y2 = rect.y + rect.h;
    return (strokes || []).filter((s) => {
      // strokeBounds reports min/max corners, not an x/y/w/h box.
      const b = N.strokeBounds(s);
      if (!b) return false;
      return b.minX <= x2 && b.maxX >= rect.x && b.minY <= y2 && b.maxY >= rect.y;
    });
  };

  /** Grow a rect on every side, so ink at the very edge is not clipped mid-glyph. */
  N.padRect = function (rect, pad) {
    const p = pad == null ? 12 : pad;
    return { x: rect.x - p, y: rect.y - p, w: rect.w + p * 2, h: rect.h + p * 2 };
  };

  // ======================================================================
  // Remembered variables
  // ======================================================================

  /** Beyond this the list stops being context and starts being noise. */
  N.MAX_VARIABLES = 40;

  /**
   * Fold newly-read definitions into the ones already known.
   *
   * A later definition wins: redefining `x` further down the board is the student changing
   * their mind, not a conflict to preserve. Order is kept stable — first-seen first — so a
   * refresh does not reshuffle the list under them, with the newest appended at the end.
   */
  N.mergeVariables = function (existing, incoming) {
    const out = [];
    const index = new Map();

    for (const v of (existing || []).concat(incoming || [])) {
      if (!v || !v.name) continue;
      const name = String(v.name).trim();
      const value = String(v.value == null ? '' : v.value).trim();
      if (!name || !value) continue;

      if (index.has(name)) out[index.get(name)] = { name, value };
      else {
        index.set(name, out.length);
        out.push({ name, value });
      }
    }

    // Keep the most recent when over the cap: the working end of the board is the
    // relevant end, and the earliest definitions are the ones already used up.
    return out.slice(-N.MAX_VARIABLES);
  };

  N.forgetVariable = function (list, name) {
    return (list || []).filter((v) => v.name !== name);
  };

  V.notebook = N;
})(window.V);
