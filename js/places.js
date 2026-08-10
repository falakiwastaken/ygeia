/*
 * Ygeia — nearby places.
 *
 * Data comes from OpenStreetMap via the Overpass API: free, no key, no account, and
 * CORS-enabled so it works straight from the browser.
 *
 * ---------------------------------------------------------------------------
 * ON MENUS: there is no free API that returns restaurant menus. Google Places and Yelp
 * both require paid keys and neither exposes structured dish-level data; OSM carries a
 * `website` tag at best. So this shows what genuinely exists — name, cuisine, opening
 * hours, a website link — and lets you log what you ate. It does not pretend to know
 * the menu.
 * ---------------------------------------------------------------------------
 *
 * Overpass is volunteer-run infrastructure. Queries are kept narrow, capped, and are
 * only issued on an explicit user action — never on a timer.
 */
(function (V) {
  'use strict';

  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

  const CATEGORIES = [
    { value: 'restaurant', label: 'Restaurants', filter: '["amenity"="restaurant"]', icon: '🍽' },
    { value: 'cafe', label: 'Cafés', filter: '["amenity"="cafe"]', icon: '☕' },
    { value: 'fast_food', label: 'Fast food', filter: '["amenity"="fast_food"]', icon: '🍔' },
    { value: 'library', label: 'Libraries', filter: '["amenity"="library"]', icon: '📚' },
    { value: 'gym', label: 'Gyms', filter: '["leisure"="fitness_centre"]', icon: '🏋' },
    { value: 'supermarket', label: 'Supermarkets', filter: '["shop"="supermarket"]', icon: '🛒' },
  ];

  function timedFetch(url, init, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms || 25000);
    return fetch(url, Object.assign({ signal: controller.signal }, init || {}))
      .finally(() => clearTimeout(timer));
  }

  /** Query Overpass for one category around a point. */
  async function search(lat, lon, category, radiusM) {
    const cat = CATEGORIES.find((c) => c.value === category) || CATEGORIES[0];
    const r = Math.round(radiusM || 1200);

    // Both nodes and ways: a large restaurant is often mapped as a building outline.
    // `out center` gives ways a single representative coordinate.
    const query =
      `[out:json][timeout:25];(` +
      `node${cat.filter}(around:${r},${lat},${lon});` +
      `way${cat.filter}(around:${r},${lat},${lon});` +
      `);out center 60;`;

    const res = await timedFetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error('Overpass returned ' + res.status);

    const data = await res.json();
    return (data.elements || [])
      .map((e) => {
        const plat = e.lat != null ? e.lat : (e.center && e.center.lat);
        const plon = e.lon != null ? e.lon : (e.center && e.center.lon);
        const tags = e.tags || {};
        if (plat == null || plon == null || !tags.name) return null;
        return {
          id: e.type + '/' + e.id,
          name: tags.name,
          lat: plat,
          lon: plon,
          category,
          cuisine: tags.cuisine ? tags.cuisine.replace(/[_;]/g, ' ') : null,
          openingHours: tags.opening_hours || null,
          website: tags.website || tags['contact:website'] || null,
          phone: tags.phone || tags['contact:phone'] || null,
          vegetarian: tags['diet:vegetarian'] || null,
          vegan: tags['diet:vegan'] || null,
          takeaway: tags.takeaway || null,
          wheelchair: tags.wheelchair || null,
          distance: V.map.distance(lat, lon, plat, plon),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);
  }

  /** Free-text place search, for when geolocation is unavailable or denied. */
  async function geocode(query) {
    const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=5`;
    const res = await timedFetch(url, { headers: { Accept: 'application/json' } }, 15000);
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    return data.map((d) => ({ name: d.display_name, lat: +d.lat, lon: +d.lon }));
  }

  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('This browser has no location support.'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(new Error(
          err.code === 1
            ? 'Location permission was denied. Search for a place name instead.'
            : 'Could not get your location.',
        )),
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
      );
    });
  }

  const fmtDistance = (m) => (m < 1000 ? Math.round(m) + ' m' : V.fmt(m / 1000, 1) + ' km');

  // =========================================================================
  // UI
  // =========================================================================

  function openPlacesSheet() {
    V.ui.sheet('Nearby', (body) => {
      let category = 'restaurant';
      let centre = null;
      let mapHandle = null;
      let results = [];

      const mapEl = V.el('div', { style: { height: '260px', marginBottom: '12px' } });
      const chipWrap = V.el('div', { style: { marginBottom: '12px' } });
      const status = V.el('div', { className: 'hint' });
      const listWrap = V.el('div');

      function renderChips() {
        chipWrap.innerHTML = '';
        chipWrap.appendChild(
          V.ui.segmented(
            CATEGORIES.map((c) => ({ value: c.value, label: c.icon + ' ' + c.label })),
            category,
            (v) => { category = v; renderChips(); run(); },
          ),
        );
      }

      function renderList() {
        listWrap.innerHTML = '';
        if (!results.length) return;

        listWrap.appendChild(V.ui.sectionTitle(`${results.length} found`));
        listWrap.appendChild(
          V.ui.list(
            results.slice(0, 40).map((p) =>
              V.ui.row({
                title: p.name,
                sub: [p.cuisine, p.openingHours].filter(Boolean).join(' · ') || undefined,
                value: fmtDistance(p.distance),
                onClick: () => openPlaceDetail(p),
              }),
            ),
          ),
        );
      }

      async function run() {
        if (!centre) return;
        status.textContent = 'Searching OpenStreetMap…';
        listWrap.innerHTML = '';
        try {
          results = await search(centre.lat, centre.lon, category);
          status.textContent = results.length ? '' : 'Nothing of that type mapped nearby.';

          if (mapHandle) {
            mapHandle.setMarkers(
              [{ lat: centre.lat, lon: centre.lon, kind: 'me', title: 'You' }].concat(
                results.slice(0, 40).map((p) => ({
                  lat: p.lat, lon: p.lon, title: p.name, onClick: () => openPlaceDetail(p),
                })),
              ),
            );
          }
          renderList();
        } catch (err) {
          status.textContent = 'Search failed: ' + err.message;
        }
      }

      function setCentre(lat, lon, label) {
        centre = { lat, lon };
        if (!mapHandle) mapHandle = V.map.attach(mapEl, { lat, lon, zoom: 15 });
        else mapHandle.setView(lat, lon, 15);
        if (label) status.textContent = label;
        run();
      }

      // --- location controls
      const searchInput = V.ui.input({ type: 'search', placeholder: 'Or search a town, postcode or address' });
      searchInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const q = searchInput.value.trim();
        if (!q) return;
        status.textContent = 'Looking up “' + q + '”…';
        try {
          const hits = await geocode(q);
          if (!hits.length) { status.textContent = 'No match for that place.'; return; }
          setCentre(hits[0].lat, hits[0].lon);
        } catch (err) {
          status.textContent = err.message;
        }
      });

      body.appendChild(
        V.ui.button('Use my location', async () => {
          status.textContent = 'Getting your location…';
          try {
            const pos = await locate();
            setCentre(pos.lat, pos.lon);
          } catch (err) {
            status.textContent = err.message;
          }
        }, 'btn-primary'),
      );
      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(searchInput);
      body.appendChild(V.el('div', { style: { height: '12px' } }));
      body.appendChild(mapEl);
      body.appendChild(chipWrap);
      body.appendChild(status);
      body.appendChild(listWrap);
      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'Places come from OpenStreetMap. Menus are not available — no free API ' +
                'provides them — so open the website to check, then log what you ate.',
        }),
      );

      renderChips();
    });
  }

  function openPlaceDetail(place) {
    V.ui.sheet(place.name, async (body) => {
      const facts = [
        ['Distance', fmtDistance(place.distance)],
        ['Cuisine', place.cuisine],
        ['Opening hours', place.openingHours],
        ['Phone', place.phone],
        ['Vegetarian options', place.vegetarian],
        ['Vegan options', place.vegan],
        ['Takeaway', place.takeaway],
        ['Step-free access', place.wheelchair],
      ].filter(([, v]) => v);

      body.appendChild(V.ui.list(facts.map(([k, v]) => V.ui.row({ title: k, value: String(v) }))));

      if (place.website) {
        body.appendChild(V.el('div', { style: { height: '12px' } }));
        const link = V.el('a', {
          href: place.website, target: '_blank', rel: 'noopener noreferrer',
          className: 'btn', text: 'Open website (check the menu here)',
          style: { textDecoration: 'none' },
        });
        body.appendChild(link);
      }

      body.appendChild(V.el('div', { style: { height: '8px' } }));
      body.appendChild(
        V.ui.button('Log a meal from here', () => {
          V.ui.closeSheet(true);
          V.app.go('food');
          V.toast('Search for what you ate at ' + place.name);
        }, 'btn-primary'),
      );

      body.appendChild(V.el('div', { style: { height: '8px' } }));

      const saved = await V.store.places.get(place.id);
      body.appendChild(
        V.ui.button(saved ? 'Remove from saved' : 'Save this place', async () => {
          if (saved) {
            await V.store.places.remove(place.id);
            V.toast('Removed');
          } else {
            await V.store.places.save(Object.assign({}, place, { savedAt: Date.now() }));
            V.toast('Saved');
          }
          V.ui.refreshSheet();
        }, 'btn-ghost'),
      );

      body.appendChild(
        V.el('div', {
          className: 'hint',
          text: 'No free API exposes restaurant menus, so Ygeia cannot import dishes ' +
                'automatically. Open the website to see what they serve.',
        }),
      );
    });
  }

  V.places = { search, geocode, locate, CATEGORIES, openPlacesSheet, openPlaceDetail, fmtDistance };
})(window.V);
