/*
 * Vitals — minimal slippy map.
 *
 * Renders OpenStreetMap raster tiles with drag-to-pan and zoom, in about 150 lines.
 * Leaflet would do this too, but pulling in a library would break the app's one hard
 * rule: no dependencies, no build step.
 *
 * Tiles come from the public OSM tile servers. Attribution is required and is rendered
 * by `attach()` — do not remove it. Their usage policy expects light, human-scale
 * traffic, which is what a personal tracker generates.
 */
(function (V) {
  'use strict';

  const TILE = 256;
  const MAX_ZOOM = 19;
  const MIN_ZOOM = 3;

  // --------------------------------------------------------- projection ----

  /**
   * Web Mercator. Returns world pixel coordinates at the given zoom, where the whole
   * world is (256 * 2^zoom) pixels square.
   */
  function project(lat, lon, zoom) {
    const scale = TILE * Math.pow(2, zoom);
    const x = ((lon + 180) / 360) * scale;
    // Clamp latitude to the Mercator limit — the projection diverges at the poles.
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const s = Math.sin((clamped * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
    return { x, y };
  }

  function unproject(x, y, zoom) {
    const scale = TILE * Math.pow(2, zoom);
    const lon = (x / scale) * 360 - 180;
    const n = Math.PI - 2 * Math.PI * (y / scale);
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat, lon };
  }

  /** Great-circle distance in metres. */
  function distance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // -------------------------------------------------------------- map ------

  /**
   * Attach a map to a container element.
   * @returns a handle with setView / setMarkers / destroy
   */
  function attach(container, opts) {
    const o = opts || {};
    let centerLat = o.lat == null ? 51.5074 : o.lat;
    let centerLon = o.lon == null ? -0.1278 : o.lon;
    let zoom = o.zoom == null ? 15 : o.zoom;
    let markers = [];

    container.classList.add('map-wrap');
    container.innerHTML = '';

    const tileLayer = V.el('div', { className: 'map-tiles' });
    const pinLayer = V.el('div', { className: 'map-tiles' });
    container.appendChild(tileLayer);
    container.appendChild(pinLayer);

    const controls = V.el('div', { className: 'map-controls' }, [
      V.el('button', { className: 'map-btn', type: 'button', text: '+', 'aria-label': 'Zoom in',
        on: { click: () => setView(centerLat, centerLon, Math.min(zoom + 1, MAX_ZOOM)) } }),
      V.el('button', { className: 'map-btn', type: 'button', text: '−', 'aria-label': 'Zoom out',
        on: { click: () => setView(centerLat, centerLon, Math.max(zoom - 1, MIN_ZOOM)) } }),
    ]);
    container.appendChild(controls);

    container.appendChild(
      V.el('div', { className: 'map-attrib', html: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }),
    );

    function render() {
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 300;
      const centre = project(centerLat, centerLon, zoom);
      const originX = centre.x - w / 2;
      const originY = centre.y - h / 2;

      const n = Math.pow(2, zoom);
      const minTx = Math.floor(originX / TILE);
      const maxTx = Math.floor((originX + w) / TILE);
      const minTy = Math.floor(originY / TILE);
      const maxTy = Math.floor((originY + h) / TILE);

      const frag = document.createDocumentFragment();
      for (let ty = minTy; ty <= maxTy; ty++) {
        // Vertical wrap is meaningless; skip tiles outside the world.
        if (ty < 0 || ty >= n) continue;
        for (let tx = minTx; tx <= maxTx; tx++) {
          const wrappedX = ((tx % n) + n) % n; // horizontal wrap around the date line
          const img = V.el('img', {
            className: 'map-tile',
            src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`,
            loading: 'lazy',
            alt: '',
            style: {
              left: (tx * TILE - originX) + 'px',
              top: (ty * TILE - originY) + 'px',
            },
          });
          frag.appendChild(img);
        }
      }
      tileLayer.innerHTML = '';
      tileLayer.appendChild(frag);

      // --- pins
      pinLayer.innerHTML = '';
      for (const m of markers) {
        const p = project(m.lat, m.lon, zoom);
        const px = p.x - originX;
        const py = p.y - originY;
        if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;

        const pin = V.el('div', {
          className: 'map-pin' + (m.kind === 'me' ? ' me' : ''),
          title: m.title || '',
          style: { left: px + 'px', top: py + 'px', background: m.color || undefined },
        });
        if (m.onClick) pin.addEventListener('click', (e) => { e.stopPropagation(); m.onClick(m); });
        pinLayer.appendChild(pin);
      }
    }

    // ------------------------------------------------------------ panning --

    let dragging = false, lastX = 0, lastY = 0, moved = 0;

    function pointer(e) {
      const t = e.touches && e.touches[0];
      return { x: t ? t.clientX : e.clientX, y: t ? t.clientY : e.clientY };
    }

    function onDown(e) {
      dragging = true; moved = 0;
      const p = pointer(e);
      lastX = p.x; lastY = p.y;
    }

    function onMove(e) {
      if (!dragging) return;
      const p = pointer(e);
      const dx = p.x - lastX, dy = p.y - lastY;
      lastX = p.x; lastY = p.y;
      moved += Math.abs(dx) + Math.abs(dy);

      const centre = project(centerLat, centerLon, zoom);
      const next = unproject(centre.x - dx, centre.y - dy, zoom);
      centerLat = next.lat; centerLon = next.lon;
      render();
      // Only swallow the gesture once it is clearly a pan, so a tap still works.
      if (moved > 6 && e.cancelable) e.preventDefault();
    }

    function onUp() { dragging = false; }

    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    container.addEventListener('touchstart', onDown, { passive: true });
    container.addEventListener('touchmove', onMove, { passive: false });
    container.addEventListener('touchend', onUp);

    function setView(lat, lon, z) {
      centerLat = lat; centerLon = lon;
      if (z != null) zoom = V.clamp(z, MIN_ZOOM, MAX_ZOOM);
      render();
    }

    function setMarkers(list) { markers = list || []; render(); }

    render();
    // The container often has no width yet on first paint inside a sheet.
    setTimeout(render, 60);

    return {
      setView,
      setMarkers,
      getCenter: () => ({ lat: centerLat, lon: centerLon, zoom }),
      render,
      destroy() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        container.innerHTML = '';
      },
    };
  }

  V.map = { attach, project, unproject, distance };
})(window.V);
