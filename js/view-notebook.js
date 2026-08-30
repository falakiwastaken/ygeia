/*
 * Ygeia — notebooks and whiteboards.
 *
 * Two editors over one storage model:
 *
 *   text  a lined page you type on, for notes and worked prose
 *   draw  an unbounded whiteboard you draw on, pannable and zoomable
 *
 * The whiteboard is the app's first real drawing surface, and most of the code below is
 * there to make it behave on a phone: device pixel ratio so strokes are not blurry,
 * touch-action off so drawing does not scroll the sheet, pointer capture so a stroke that
 * leaves the canvas still ends cleanly, coalesced events so fast strokes are not polygons,
 * and palm rejection once a stylus has been seen.
 *
 * The canvas is a view. V.notebook holds the geometry, the page's stroke array is the
 * truth, and every redraw comes from that array — never from the bitmap.
 */
(function (V) {
  'use strict';

  /**
   * Quick swatches.
   *
   * The first is the theme's ink token rather than a fixed colour, so a default stroke
   * stays readable when the user switches between light and dark. Every other swatch is a
   * literal hex, and so is anything picked from the wheel: a drawing the user deliberately
   * made red should stay that red, not shift with the theme.
   */
  const INK = 'var(--text)';
  const SWATCHES = [
    INK, '#C0392B', '#E67E22', '#D4A017',
    '#2E8B57', '#2E86C1', '#6C4CB5', '#C2185B',
  ];

  const TOOLS = [
    { value: 'pen', label: 'Pen', icon: '✏️' },
    { value: 'highlighter', label: 'Marker', icon: '🖍' },
    { value: 'eraser', label: 'Eraser', icon: '🧽' },
    // Only offered when the AI feature is on and a key is saved — see toolsFor().
    { value: 'select', label: 'Ask about a part', icon: '🔍', ai: true },
  ];

  /**
   * Which tools this board offers.
   *
   * Gated on the feature switch alone, not on the key as well. Requiring both meant the
   * tool silently did not exist for anyone who had turned the feature on but not yet
   * pasted a key — indistinguishable from the feature being broken. The sheet asks for a
   * key when it needs one, which is a thing the user can act on.
   */
  async function toolsFor(settings) {
    const on = V.features.enabled(settings, 'photoHelp');
    return TOOLS.filter((t) => !t.ai || on);
  }

  const WIDTHS = [
    { value: 2, label: 'Fine' },
    { value: 4, label: 'Medium' },
    { value: 8, label: 'Thick' },
    { value: 14, label: 'Broad' },
  ];

  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 4;
  /** Autosave delay. Long enough not to write on every stroke of fast handwriting. */
  const SAVE_MS = 600;

  // ============================================================== notebook list

  function openNotebooks(subjectId) {
    V.ui.sheet('Notebooks', async (body) => {
      const [all, subjects] = await Promise.all([
        V.store.notebooks.all(),
        V.store.study.subjects(),
      ]);
      const subjectById = {};
      for (const s of subjects) subjectById[s.id] = s;

      const list = subjectId ? all.filter((nb) => nb.subjectId === subjectId) : all;
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      body.appendChild(
        V.el('div', { className: 'grid-2' }, [
          V.ui.button('＋ Notebook', () => openNewSheet('text', subjectId), 'btn-primary'),
          V.ui.button('＋ Whiteboard', () => openNewSheet('draw', subjectId), 'btn-primary'),
        ]),
      );
      body.appendChild(V.el('div', { style: { height: '12px' } }));

      if (!list.length) {
        body.appendChild(V.ui.empty('Nothing yet. A notebook is for writing, a whiteboard is for drawing.'));
        return;
      }

      const rows = [];
      for (const nb of list) {
        const count = await V.store.notebooks.pageCount(nb.id);
        const subject = nb.subjectId ? subjectById[nb.subjectId] : null;
        rows.push(
          V.ui.row({
            title: nb.name,
            sub: `${nb.kind === 'draw' ? 'Whiteboard' : 'Notebook'} · ` +
                 `${V.pluralise(count, 'page')}` +
                 (nb.updatedAt ? ` · ${V.friendlyDate(V.dateKey(new Date(nb.updatedAt)))}` : ''),
            accessory: subject
              ? V.el('div', { className: 'subject-dot', style: { background: subject.color } })
              : null,
            onClick: () => openNotebook(nb),
          }),
        );
      }
      body.appendChild(V.ui.list(rows));
    });
  }

  function openNewSheet(kind, subjectId) {
    V.ui.sheet(kind === 'draw' ? 'New whiteboard' : 'New notebook', async (body) => {
      const subjects = await V.store.study.subjects();
      const name = V.ui.input({ placeholder: kind === 'draw' ? 'Physics diagrams' : 'Lecture notes' });

      let chosen = subjectId || null;
      const subWrap = V.el('div');
      function renderSubs() {
        subWrap.innerHTML = '';
        subWrap.appendChild(
          V.ui.segmented(
            [{ value: null, label: 'None' }].concat(subjects.map((s) => ({ value: s.id, label: s.name }))),
            chosen,
            (v) => { chosen = v; renderSubs(); },
          ),
        );
      }
      renderSubs();

      body.appendChild(V.ui.field('Name', name));
      body.appendChild(V.ui.field('Subject', subWrap, 'Optional — links it to a subject.'));
      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(
        V.ui.button('Create', async () => {
          const title = name.value.trim();
          if (!title) return V.toast('Give it a name');

          const nb = {
            id: V.uid(), name: title, subjectId: chosen, kind, createdAt: Date.now(),
          };
          await V.store.notebooks.save(nb);
          await V.store.notebooks.savePage({
            id: V.uid(), notebookId: nb.id, index: 0, kind,
            text: kind === 'text' ? '' : null,
            strokes: kind === 'draw' ? [] : null,
          });

          V.ui.closeSheet();
          openNotebook(nb);
        }, 'btn-primary'),
      );
    });
  }

  // =================================================================== editor

  async function openNotebook(nb) {
    const pages = await V.store.notebooks.pages(nb.id);
    openPage(nb, pages.length ? pages[0].index : 0);
  }

  function openPage(nb, pageIndex) {
    V.ui.sheet(nb.name, async (body) => {
      let pages = await V.store.notebooks.pages(nb.id);

      if (!pages.length) {
        const blank = {
          id: V.uid(), notebookId: nb.id, index: 0, kind: nb.kind,
          text: nb.kind === 'text' ? '' : null,
          strokes: nb.kind === 'draw' ? [] : null,
        };
        await V.store.notebooks.savePage(blank);
        pages = [blank];
      }

      const idx = V.clamp(pageIndex, 0, pages.length - 1);
      const page = pages[idx];

      body.appendChild(buildPageNav(nb, pages, idx));

      if (nb.kind === 'draw') {
        buildWhiteboard(body, nb, page, await toolsFor(await V.store.settings.get()));
      } else buildTextPage(body, nb, page);

      body.appendChild(V.el('div', { style: { height: '16px' } }));
      body.appendChild(
        V.ui.button('Delete this notebook', async () => {
          if (!V.confirm(`Delete "${nb.name}" and all ${pages.length} of its pages?`)) return;
          await V.store.notebooks.remove(nb.id);
          V.ui.closeSheet();
          V.toast('Deleted');
          V.app.render();
        }, 'btn-danger'),
      );
    });
  }

  function buildPageNav(nb, pages, idx) {
    return V.el('div', { className: 'nb-pagenav' }, [
      V.el('button', {
        className: 'icon-btn', type: 'button', text: '‹', 'aria-label': 'Previous page',
        disabled: idx === 0,
        on: { click: () => { V.ui.closeSheet(); openPage(nb, idx - 1); } },
      }),
      V.el('div', { className: 'nb-pagelabel', text: `Page ${idx + 1} of ${pages.length}` }),
      V.el('button', {
        className: 'icon-btn', type: 'button', text: '›', 'aria-label': 'Next page',
        disabled: idx >= pages.length - 1,
        on: { click: () => { V.ui.closeSheet(); openPage(nb, idx + 1); } },
      }),
      V.el('button', {
        className: 'icon-btn', type: 'button', text: '＋', 'aria-label': 'Add page',
        on: {
          click: async () => {
            await V.store.notebooks.savePage({
              id: V.uid(), notebookId: nb.id, index: pages.length, kind: nb.kind,
              text: nb.kind === 'text' ? '' : null,
              strokes: nb.kind === 'draw' ? [] : null,
            });
            V.ui.closeSheet();
            openPage(nb, pages.length);
          },
        },
      }),
    ]);
  }

  // ------------------------------------------------------------- text page --

  function buildTextPage(body, nb, page) {
    const area = V.el('textarea', {
      className: 'nb-text',
      value: page.text || '',
      placeholder: 'Start writing…',
      rows: 18,
    });

    const status = V.el('div', { className: 'hint', text: 'Saved' });

    const save = V.debounce(async () => {
      page.text = area.value;
      await V.store.notebooks.savePage(page);
      await V.store.notebooks.save(nb);
      status.textContent = 'Saved';
    }, SAVE_MS);

    area.addEventListener('input', () => {
      status.textContent = 'Saving…';
      save();
    });

    // A debounced save can still be pending when the sheet closes. Flush it, or the last
    // few keystrokes before dismissal are lost — which is the moment people notice most.
    V.ui.onSheetTeardown(async () => {
      if (area.value !== (page.text || '')) {
        page.text = area.value;
        await V.store.notebooks.savePage(page);
        await V.store.notebooks.save(nb);
      }
    });

    body.appendChild(area);
    body.appendChild(status);
  }

  // ------------------------------------------------------------ whiteboard --

  function buildWhiteboard(body, nb, page, tools) {
    let strokes = (page.strokes || []).slice();
    let tool = 'pen';
    let color = INK;
    let width = 4;

    const toolset = tools && tools.length ? tools : TOOLS.filter((t) => !t.ai);

    /*
     * The box the student is dragging, or has dragged, in world coordinates.
     *
     * World and not screen: the selection has to survive a pan or a zoom between drawing
     * the box and asking about it, and it is used to decide which strokes get rendered
     * into the image, which is a world-space question.
     */
    let marquee = null;
    let marqueeLive = false;

    /** Variable definitions read off this board so far, remembered on the notebook. */
    let variables = (nb.vars || []).slice();

    // View transform over the unbounded world plane.
    let zoom = 1;
    let panX = 0;
    let panY = 0;

    // The stroke currently being drawn. Declared up here with the rest of the view state
    // because redraw() paints it, and redraw() is defined before the input handlers are.
    let live = null;

    const canvas = V.el('canvas', { className: 'nb-canvas' });
    const ctx = canvas.getContext('2d');

    /**
     * Resolve a CSS colour token to something canvas can paint with.
     * Canvas cannot take `var(--info)`, and the value differs per theme, so it is read
     * back from the live computed style each time rather than hard-coded.
     */
    const rootStyle = getComputedStyle(document.documentElement);
    function resolve(c) {
      const m = /^var\((--[\w-]+)\)$/.exec(c);
      return m ? rootStyle.getPropertyValue(m[1]).trim() || '#000' : c;
    }

    // ---- rendering ------------------------------------------------------
    function worldToScreen(x, y) {
      return [(x + panX) * zoom, (y + panY) * zoom];
    }
    function screenToWorld(sx, sy) {
      return [sx / zoom - panX, sy / zoom - panY];
    }

    function drawStroke(s) {
      if (!s.pts || s.pts.length < 2) return;
      ctx.strokeStyle = resolve(s.color);
      ctx.lineWidth = Math.max(0.5, s.width * zoom);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // A highlighter is a wide, translucent pen — same geometry, different compositing.
      ctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;

      ctx.beginPath();
      const [x0, y0] = worldToScreen(s.pts[0], s.pts[1]);
      if (s.pts.length === 2) {
        // A single point is a dot, which a zero-length path would not paint.
        ctx.arc(x0, y0, Math.max(0.5, s.width * zoom) / 2, 0, Math.PI * 2);
        ctx.fillStyle = resolve(s.color);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      ctx.moveTo(x0, y0);
      for (let i = 2; i < s.pts.length; i += 2) {
        const [x, y] = worldToScreen(s.pts[i], s.pts[i + 1]);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function redraw() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      drawGrid(w, h);
      for (const s of strokes) drawStroke(s);
      if (live) drawStroke(live);
      drawMarquee();
    }

    /** The selection box: a dashed outline over a light wash, so the ink stays readable. */
    function drawMarquee() {
      const r = currentRect();
      if (!r) return;

      const [sx, sy] = worldToScreen(r.x, r.y);
      const sw = r.w * zoom;
      const sh = r.h * zoom;

      ctx.save();
      ctx.fillStyle = resolve('var(--info)');
      ctx.globalAlpha = 0.10;
      ctx.fillRect(sx, sy, sw, sh);

      ctx.globalAlpha = 1;
      ctx.strokeStyle = resolve('var(--info)');
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.restore();
    }

    function currentRect() {
      if (!marquee) return null;
      return V.notebook.normaliseRect(marquee.x0, marquee.y0, marquee.x1, marquee.y1);
    }

    /** A faint dot grid, so panning an empty plane does not feel like nothing is happening. */
    function drawGrid(w, h) {
      const step = 32 * zoom;
      if (step < 8) return;
      ctx.fillStyle = rootStyle.getPropertyValue('--border').trim() || '#ddd';
      ctx.globalAlpha = 0.5;
      const offX = ((panX * zoom) % step + step) % step;
      const offY = ((panY * zoom) % step + step) % step;
      for (let x = offX; x < w; x += step) {
        for (let y = offY; y < h; y += step) ctx.fillRect(x, y, 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    /**
     * Match the backing store to the display size and the device pixel ratio.
     * Without this the canvas renders at 1x and every stroke looks soft on a phone.
     */
    /** Room left under the canvas for the save status and the delete button. */
    const CANVAS_FOOTER_PX = 92;
    const CANVAS_MIN_PX = 220;

    /**
     * Give the canvas the height that is actually left in the sheet.
     *
     * It used to be a flat 58vh, which is a fraction of the *viewport* — but the canvas
     * lives inside a sheet that has already spent space on the page nav and the toolbar,
     * and the toolbar changes height with the selected tool. On a phone that overflowed
     * the sheet and cut the bottom off the drawing surface. Measuring the gap between the
     * canvas's own top and the foot of the scroll area is self-correcting: the toolbar can
     * grow a row and the canvas simply gets shorter.
     */
    function fitCanvasHeight() {
      const holder = canvas.parentNode && canvas.parentNode.closest('#sheet-body');
      if (!holder) return;
      const available = holder.clientHeight
        - (canvas.getBoundingClientRect().top - holder.getBoundingClientRect().top)
        - CANVAS_FOOTER_PX;
      canvas.style.height = Math.max(CANVAS_MIN_PX, Math.round(available)) + 'px';
    }

    function resize() {
      fitCanvasHeight();
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;

      // Assigning width/height clears the bitmap, so skip when nothing actually changed —
      // this runs after every stroke via renderToolbar, and a full repaint each time is
      // wasted work on a page with a lot of ink.
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width === bw && canvas.height === bh) return;

      canvas.width = bw;
      canvas.height = bh;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    // ---- persistence ----------------------------------------------------
    const status = V.el('div', { className: 'hint', text: 'Saved' });
    let dirty = false;

    const save = V.debounce(async () => {
      page.strokes = strokes;
      await V.store.notebooks.savePage(page);
      await V.store.notebooks.save(nb);
      dirty = false;
      status.textContent = 'Saved';
    }, SAVE_MS);

    function markDirty() {
      dirty = true;
      status.textContent = 'Saving…';
      save();
    }

    V.ui.onSheetTeardown(async () => {
      if (!dirty) return;
      page.strokes = strokes;
      await V.store.notebooks.savePage(page);
      await V.store.notebooks.save(nb);
    });

    // ---- input ----------------------------------------------------------
    let drawingId = null;       // pointerId that owns the current stroke
    let seenPen = false;        // once a stylus appears, ignore touch (palm rejection)
    const pointers = new Map(); // active pointers, for pinch-zoom
    let pinchStart = null;

    function localPoint(e) {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    function shouldIgnore(e) {
      // Once the user has drawn with a stylus, their palm is on the glass too. Every
      // touch from that point on is far more likely to be the hand than the intent.
      return seenPen && e.pointerType === 'touch';
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') seenPen = true;
      pointers.set(e.pointerId, localPoint(e));

      // Two fingers means pan and zoom, not draw. Abandon any stroke the first finger began.
      if (pointers.size === 2) {
        live = null;
        drawingId = null;
        const [a, b] = Array.from(pointers.values());
        pinchStart = {
          dist: Math.hypot(a[0] - b[0], a[1] - b[1]),
          mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
          zoom, panX, panY,
        };
        redraw();
        return;
      }

      if (shouldIgnore(e) || drawingId != null) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawingId = e.pointerId;

      const [sx, sy] = localPoint(e);
      const [wx, wy] = screenToWorld(sx, sy);

      if (tool === 'eraser') {
        applyErase(wx, wy);
        return;
      }
      if (tool === 'select') {
        // Starting a new box discards the old one, so there is never a stale selection
        // sitting behind the one being drawn.
        marquee = { x0: wx, y0: wy, x1: wx, y1: wy };
        marqueeLive = true;
        redraw();
        return;
      }
      live = {
        tool,
        color,
        width: tool === 'highlighter' ? width * 3 : width,
        pts: [wx, wy],
      };
      redraw();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, localPoint(e));

      if (pointers.size === 2 && pinchStart) {
        const [a, b] = Array.from(pointers.values());
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const nextZoom = V.clamp(pinchStart.zoom * (dist / pinchStart.dist), MIN_ZOOM, MAX_ZOOM);

        // Keep the world point under the pinch midpoint stationary as the zoom changes,
        // otherwise the drawing slides away from under the fingers.
        const wx = pinchStart.mid[0] / pinchStart.zoom - pinchStart.panX;
        const wy = pinchStart.mid[1] / pinchStart.zoom - pinchStart.panY;
        zoom = nextZoom;
        panX = mid[0] / zoom - wx;
        panY = mid[1] / zoom - wy;
        redraw();
        return;
      }

      if (e.pointerId !== drawingId) return;
      e.preventDefault();

      // Coalesced events carry every sample the OS captured between frames. Without them
      // a fast stroke is drawn as a handful of straight segments.
      // A box only needs its far corner, so coalesced samples are irrelevant to it.
      if (marqueeLive && marquee) {
        const [sx, sy] = localPoint(e);
        const [wx, wy] = screenToWorld(sx, sy);
        marquee.x1 = wx;
        marquee.y1 = wy;
        redraw();
        return;
      }

      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [sx, sy] = localPoint(ev);
        const [wx, wy] = screenToWorld(sx, sy);
        if (tool === 'eraser') applyErase(wx, wy);
        else if (live) live.pts.push(wx, wy);
      }
      redraw();
    });

    function endStroke(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (e.pointerId !== drawingId) return;

      drawingId = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

      if (marqueeLive) {
        marqueeLive = false;
        // A click, or a twitch, is not a selection. Clearing it rather than keeping a
        // sliver avoids an invisible box that swallows the next tap.
        if (!V.notebook.isUsableRect(currentRect())) marquee = null;
        redraw();
        renderToolbar();
        return;
      }

      if (live) {
        live.pts = V.notebook.quantise(V.notebook.simplify(live.pts));
        strokes.push(live);
        live = null;
        // Drawing something new invalidates the redo stack — reapplying those strokes
        // afterwards would drop them onto a drawing they no longer belong to.
        redoStack = [];
        markDirty();
      }
      redraw();
      // Undo and redo are only enabled when there is something to act on, so the toolbar
      // has to be rebuilt whenever the stroke list changes or the buttons go stale.
      renderToolbar();
    }

    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    // A pointer that leaves without capture (a mouse dragged off the window) still has to
    // terminate the stroke, or the next click continues the old one.
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerId === drawingId) endStroke(e); });

    function applyErase(wx, wy) {
      const res = V.notebook.eraseAt(strokes, wx, wy, 10 / zoom);
      if (!res.removed) return;
      strokes = res.strokes;
      redoStack = [];
      markDirty();
    }

    // Desktop: wheel zooms with ctrl/⌘ held, and pans otherwise.
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const [sx, sy] = localPoint(e);
        const [wx, wy] = screenToWorld(sx, sy);
        zoom = V.clamp(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_ZOOM, MAX_ZOOM);
        panX = sx / zoom - wx;
        panY = sy / zoom - wy;
      } else {
        panX -= e.deltaX / zoom;
        panY -= e.deltaY / zoom;
      }
      redraw();
    }, { passive: false });

    // ---- undo / redo ------------------------------------------------------
    /*
     * Redo holds strokes popped by undo, and is cleared by any new stroke — the standard
     * rule, and the only one that avoids a redo stack that reapplies work onto a drawing
     * it no longer belongs to.
     */
    let redoStack = [];

    function undo() {
      if (!strokes.length) return;
      redoStack.push(strokes.pop());
      markDirty();
      redraw();
      renderToolbar();
    }
    function redo() {
      if (!redoStack.length) return;
      strokes.push(redoStack.pop());
      markDirty();
      redraw();
      renderToolbar();
    }

    // ---- asking about a boxed region --------------------------------------

    /** Wider than the on-screen zoom, so handwriting stays legible in the sent image. */
    const REGION_SCALE = 2;
    const REGION_MAX_PX = 1600;

    /**
     * Paint just the boxed strokes onto their own canvas and return it as a PNG.
     *
     * Redrawn from the stroke list rather than cropped out of the visible canvas: the
     * visible one is at the current zoom, may be scrolled so the box is half off-screen,
     * and carries the dot grid and the selection outline. Re-rendering gives a clean,
     * consistently-scaled image of the work alone, whatever the view is doing.
     */
    function renderRegion(rect) {
      const padded = V.notebook.padRect(rect);
      const scale = Math.min(
        REGION_SCALE,
        REGION_MAX_PX / Math.max(padded.w, padded.h, 1),
      );

      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(padded.w * scale));
      off.height = Math.max(1, Math.round(padded.h * scale));
      const octx = off.getContext('2d');

      // An opaque light background regardless of theme. A dark-theme board would otherwise
      // send white ink on transparency, which flattens to white-on-black or vanishes.
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, off.width, off.height);

      octx.setTransform(scale, 0, 0, scale, -padded.x * scale, -padded.y * scale);
      octx.lineCap = 'round';
      octx.lineJoin = 'round';

      for (const s of V.notebook.strokesInRect(strokes, padded)) {
        if (!s.pts || s.pts.length < 2) continue;
        // Ink is forced dark for the same reason the background is forced light.
        octx.strokeStyle = s.color === INK ? '#111111' : resolve(s.color);
        octx.lineWidth = Math.max(0.5, s.width);
        octx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
        octx.beginPath();
        octx.moveTo(s.pts[0], s.pts[1]);
        if (s.pts.length === 2) octx.lineTo(s.pts[0] + 0.1, s.pts[1] + 0.1);
        for (let i = 2; i < s.pts.length; i += 2) octx.lineTo(s.pts[i], s.pts[i + 1]);
        octx.stroke();
      }

      return off.toDataURL('image/png').split(',')[1];
    }

    async function persistVariables() {
      nb.vars = variables;
      await V.store.notebooks.save(nb);
    }

    function openAskSheet() {
      const rect = currentRect();
      if (!V.notebook.isUsableRect(rect)) return V.toast('Drag a box around the part you want help with');

      const inRegion = V.notebook.strokesInRect(strokes, V.notebook.padRect(rect)).length;
      if (!inRegion) return V.toast('There is nothing inside that box');

      const base64 = renderRegion(rect);

      V.ui.sheet('Help with this bit', async (sheetBody) => {
        // Asked here rather than by hiding the tool, so "nothing happens" is never the
        // answer — there is always a next thing to tap.
        if (!(await V.aiVision.hasKey())) {
          sheetBody.appendChild(
            V.el('img', {
              className: 'nb-region-preview',
              src: 'data:image/png;base64,' + base64,
              alt: 'The part of the board you boxed off',
            }),
          );
          sheetBody.appendChild(
            V.el('div', {
              className: 'hint',
              text: 'This needs an API key, which Ygeia does not have yet. Everything else ' +
                    'on the whiteboard works without one.',
            }),
          );
          sheetBody.appendChild(V.el('div', { style: { height: '10px' } }));
          sheetBody.appendChild(
            V.ui.button('Add a key', () => V.aiKeyView.openSheet(), 'btn-primary'),
          );
          return;
        }

        sheetBody.appendChild(
          V.el('img', {
            className: 'nb-region-preview',
            src: 'data:image/png;base64,' + base64,
            alt: 'The part of the board you boxed off',
          }),
        );

        /*
         * Rebuilt in place rather than rendered once.
         *
         * Variables are learned by the very request this sheet sends, so a section drawn
         * at build time is always one answer behind — the values would sit in storage,
         * silently shaping later replies, with nothing on screen admitting it.
         */
        const varsWrap = V.el('div');
        sheetBody.appendChild(varsWrap);

        function renderVars() {
          varsWrap.innerHTML = '';
          if (!variables.length) return;

          varsWrap.appendChild(V.ui.sectionTitle('Remembered from this board'));
          varsWrap.appendChild(
            V.el('div', { className: 'nb-vars' }, variables.map((v) =>
              V.el('span', { className: 'nb-var', text: `${v.name} = ${v.value}` }))),
          );
          varsWrap.appendChild(
            V.el('div', {
              className: 'hint',
              text: 'Read off the board and sent along so the answer can use them.',
            }),
          );
          varsWrap.appendChild(
            V.ui.button('Forget these', async () => {
              variables = [];
              await persistVariables();
              renderVars();
              V.toast('Forgotten');
            }, 'btn-ghost btn-sm'),
          );
        }
        renderVars();

        const question = V.el('textarea', {
          rows: 2,
          placeholder: 'What do you want to know? (optional)',
        });
        sheetBody.appendChild(V.ui.field('Your question', question));

        const output = V.el('div');
        const askBtn = V.ui.button('Ask', async () => {
          askBtn.disabled = true;
          output.innerHTML = '';
          output.appendChild(V.el('div', { className: 'hint', text: 'Reading your working…' }));

          try {
            const settings = await V.store.settings.get();
            const result = await V.aiVision.tutorRegion({
              base64,
              mimeType: 'image/png',
              question: question.value,
              variables,
              model: settings.visionModel || null,
            });

            output.innerHTML = '';
            if (V.aiVision.looksLikeFinalAnswer(result.text)) {
              output.appendChild(
                V.el('div', {
                  className: 'warn-box',
                  text: 'Heads up — this reply looks like it gave away the answer rather ' +
                        'than a hint. Try to redo the step yourself before reading it.',
                }),
              );
            }
            output.appendChild(V.el('div', { className: 'solve-answer', text: result.text }));

            if (result.variables.length) {
              variables = V.notebook.mergeVariables(variables, result.variables);
              await persistVariables();
              renderVars();
              output.appendChild(
                V.el('div', {
                  className: 'good-box',
                  style: { marginTop: '10px' },
                  text: 'Noted for later: ' +
                        result.variables.map((v) => `${v.name} = ${v.value}`).join(', '),
                }),
              );
            }

            output.appendChild(V.el('div', { style: { height: '10px' } }));
            output.appendChild(
              V.ui.button('Save as a flashcard', () => V.solveView.saveAsCard(result.text), 'btn-good'),
            );
            output.appendChild(
              V.el('div', { className: 'hint', text: 'Answered by ' + result.model + '.' }),
            );
          } catch (err) {
            output.innerHTML = '';
            output.appendChild(V.el('div', { className: 'warn-box', text: err.message }));
          } finally {
            askBtn.disabled = false;
          }
        }, 'btn-primary');

        sheetBody.appendChild(askBtn);
        sheetBody.appendChild(output);

        sheetBody.appendChild(
          V.el('div', {
            className: 'hint',
            style: { marginTop: '12px' },
            text: 'It will point you at the next step rather than finishing the problem — ' +
                  'that is deliberate. Only the boxed part of the board and anything ' +
                  'remembered above is sent. None of your health data goes anywhere.',
          }),
        );
      });
    }

    // ---- toolbar ---------------------------------------------------------
    /*
     * One compact bar rather than three stacked segmented controls.
     *
     * The old version pushed the canvas halfway down the sheet and re-flowed every time
     * the tool changed, which moved the drawing surface under the user's hand mid-session.
     * This keeps a fixed height and a stable layout: tools on the left, the current nib on
     * the right, and everything else on one row underneath.
     */
    const toolbar = V.el('div', { className: 'nb-toolbar' });

    function iconButton(label, title, onClick, opts) {
      return V.el('button', {
        className: 'nb-tool' + ((opts && opts.active) ? ' on' : ''),
        type: 'button',
        title,
        'aria-label': title,
        'aria-pressed': opts && opts.active ? 'true' : 'false',
        disabled: !!(opts && opts.disabled),
        text: label,
        on: { click: onClick },
      });
    }

    /** Native colour input — this is what gives the OS colour wheel, free and accessible. */
    const colorInput = V.el('input', {
      type: 'color',
      className: 'nb-colorinput',
      value: color === INK ? resolve(INK) : color,
      'aria-label': 'Choose a colour',
    });
    colorInput.addEventListener('input', () => {
      color = colorInput.value;
      renderToolbar();
    });

    function renderToolbar() {
      toolbar.innerHTML = '';

      // Row 1 — tools, and a live preview of the nib they will draw with.
      const toolRow = V.el('div', { className: 'nb-row' });
      const group = V.el('div', { className: 'nb-group' });
      for (const t of toolset) {
        group.appendChild(iconButton(t.icon, t.label, () => {
          // Leaving the select tool drops the box — a selection outline lingering while
          // the pen is active reads as though drawing were still constrained to it.
          if (tool === 'select' && t.value !== 'select') marquee = null;
          tool = t.value;
          renderToolbar();
          redraw();
        }, { active: tool === t.value }));
      }
      toolRow.appendChild(group);

      toolRow.appendChild(V.el('div', { className: 'nb-spacer' }));

      // The nib preview is about ink, which the select tool does not lay down.
      if (tool !== 'select') {
        const preview = V.el('span', { className: 'nb-nib' });
        const nibPx = V.clamp((tool === 'highlighter' ? width * 3 : width), 2, 22);
        Object.assign(preview.style, {
          width: nibPx + 'px',
          height: nibPx + 'px',
          background: tool === 'eraser' ? 'transparent' : resolve(color),
          opacity: tool === 'highlighter' ? '0.4' : '1',
          border: tool === 'eraser' ? '2px dashed var(--text-faint)' : '0',
        });
        toolRow.appendChild(V.el('div', { className: 'nb-nibwrap' }, [preview]));
      }
      toolbar.appendChild(toolRow);

      // Row 2, select tool — the action for the box, or how to draw one.
      if (tool === 'select') {
        const askRow = V.el('div', { className: 'nb-row' });
        if (V.notebook.isUsableRect(currentRect())) {
          askRow.appendChild(V.ui.button('Ask about the box', openAskSheet, 'btn-primary btn-sm'));
          askRow.appendChild(V.el('div', { className: 'nb-spacer' }));
          askRow.appendChild(iconButton('✕', 'Clear the box', () => {
            marquee = null;
            renderToolbar();
            redraw();
          }));
        } else {
          askRow.appendChild(
            V.el('div', { className: 'nb-hint', text: 'Drag a box around the part you want help with' }),
          );
        }
        toolbar.appendChild(askRow);
      }

      // Row 2 — size and colour. Hidden for the eraser and select, which have neither.
      if (tool !== 'eraser' && tool !== 'select') {
        const styleRow = V.el('div', { className: 'nb-row' });

        const sizes = V.el('div', { className: 'nb-group' });
        for (const w of WIDTHS) {
          /*
           * w is {value, label} — clamping the object yields NaN, which renders as
           * `width: NaNpx`, which the browser drops, leaving an invisible dot.
           *
           * Offset rather than used raw, too: a 4px floor made Fine and Medium the same
           * two nib widths on screen, so the picker showed three sizes for four options.
           */
          const dotPx = V.clamp(w.value + 3, 5, 18);
          const dot = V.el('span', {
            className: 'nb-sizedot',
            style: { width: dotPx + 'px', height: dotPx + 'px' },
          });
          const btn = V.el('button', {
            className: 'nb-tool nb-sizebtn' + (width === w.value ? ' on' : ''),
            type: 'button', title: w.label, 'aria-label': w.label,
            'aria-pressed': width === w.value ? 'true' : 'false',
            on: { click: () => { width = w.value; renderToolbar(); } },
          }, [dot]);
          sizes.appendChild(btn);
        }
        styleRow.appendChild(sizes);

        styleRow.appendChild(V.el('div', { className: 'nb-spacer' }));

        const swatches = V.el('div', { className: 'nb-swatches' });
        for (const c of SWATCHES) {
          swatches.appendChild(V.el('button', {
            className: 'nb-swatch' + (color === c ? ' on' : ''),
            type: 'button',
            style: { background: resolve(c) },
            title: c === INK ? 'Default ink' : c,
            'aria-label': c === INK ? 'Default ink' : 'Colour ' + c,
            on: { click: () => { color = c; renderToolbar(); } },
          }));
        }
        // The wheel sits at the end of the swatch strip, showing the live colour.
        const wheel = V.el('label', { className: 'nb-swatch nb-wheel', title: 'Custom colour' }, [colorInput]);
        wheel.style.background = resolve(color);
        swatches.appendChild(wheel);
        styleRow.appendChild(swatches);

        toolbar.appendChild(styleRow);
      }

      // Row 3 — actions. Scrolls sideways rather than wrapping: a toolbar that grows a
      // row when the window narrows shoves the drawing surface down mid-session.
      const actionRow = V.el('div', { className: 'nb-row nb-actions' }, [
        V.el('div', { className: 'nb-group' }, [
          iconButton('↶', 'Undo', undo, { disabled: !strokes.length }),
          iconButton('↷', 'Redo', redo, { disabled: !redoStack.length }),
        ]),
        V.el('div', { className: 'nb-spacer' }),
        V.el('div', { className: 'nb-group' }, [
          iconButton('⤢', 'Fit to drawing', fitToContent),
          iconButton('1:1', 'Reset zoom', () => { zoom = 1; panX = 0; panY = 0; redraw(); }),
          iconButton('🗑', 'Clear page', () => {
            if (!strokes.length) return;
            if (!V.confirm('Clear this whiteboard page?')) return;
            redoStack = strokes.slice();
            strokes = [];
            markDirty();
            redraw();
            renderToolbar();
          }, { disabled: !strokes.length }),
        ]),
      ]);
      toolbar.appendChild(actionRow);

      // The toolbar just changed height, so the canvas's share of the sheet changed with
      // it. Without this the drawing surface keeps the height it had for the old layout.
      fitCanvasHeight();
      resize();
    }

    function fitToContent() {
      const box = V.notebook.contentBounds(strokes);
      if (!box) { zoom = 1; panX = 0; panY = 0; redraw(); return; }
      const pad = 24;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      zoom = V.clamp(
        Math.min((w - pad * 2) / (box.width || 1), (h - pad * 2) / (box.height || 1)),
        MIN_ZOOM, MAX_ZOOM,
      );
      panX = (w / zoom - box.width) / 2 - box.minX;
      panY = (h / zoom - box.height) / 2 - box.minY;
      redraw();
    }

    renderToolbar();

    body.appendChild(toolbar);
    body.appendChild(canvas);
    body.appendChild(status);
    body.appendChild(
      V.el('div', {
        className: 'hint',
        text: 'Pinch or ctrl-scroll to zoom, two fingers or scroll to pan. Drawing with a ' +
              'stylus turns off touch input so your palm does not draw.',
      }),
    );

    /*
     * Keep the backing store matched to the laid-out size.
     *
     * Measured synchronously first. The canvas is already in the document by this point,
     * so reading clientWidth forces layout and gives a real answer immediately. The
     * obvious alternative — deferring the first measurement to requestAnimationFrame —
     * fails in a tab that is not rendering: rAF is throttled to nothing when the document
     * is hidden, leaving the canvas at its 300x150 default. Every stroke then lands in
     * the wrong place, because the drawing coordinate space no longer matches the element.
     *
     * The observer then handles everything afterwards: the sheet's open animation,
     * rotation, and a window resize, without needing separate listeners for each.
     */
    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);
    V.ui.onSheetTeardown(() => observer.disconnect());
  }

  // =============================================================== study card

  /** Card for the Study tab. */
  async function buildCard() {
    const all = await V.store.notebooks.all();
    const recent = all.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];

    return V.ui.card({
      title: 'Notebooks',
      sub: all.length
        ? `${V.pluralise(all.length, 'notebook')}` + (recent ? ` · last: ${recent.name}` : '')
        : 'Write notes, or draw on a whiteboard',
      children: [
        V.ui.button(all.length ? 'Open notebooks' : 'Create your first notebook',
          () => openNotebooks(), 'btn-primary'),
      ],
    });
  }

  V.notebookView = { openNotebooks, openNotebook, buildCard };
})(window.V);
