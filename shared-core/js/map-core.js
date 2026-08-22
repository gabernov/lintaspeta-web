let MaplibreStarfieldLayer;
let starfieldPromise = null;

export function preloadStarfield() {
  if (!starfieldPromise) {
    starfieldPromise = import(
      "https://esm.sh/jsr/@geoql/maplibre-gl-starfield@0.1.2"
    ).then(mod => {
      MaplibreStarfieldLayer = mod.MaplibreStarfieldLayer;
      return MaplibreStarfieldLayer;
    });
  }
  return starfieldPromise;
}

async function waitForStyle(map) {
  for (let i = 0; i < 60; i++) {
    try {
      if (map.isStyleLoaded()) return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

export async function waitForMapReady(map) {
  for (let i = 0; i < 200; i++) {
    try {
      if (map.loaded() && map.areTilesLoaded() && map.isStyleLoaded() && !map.isMoving()) {
        return true;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

// Serializes addStarfield calls: mode switches and basemap reloads
// both invoke it, and concurrent calls race on the shared WebGL layer
// ("Layer starfield already exists"). Chaining guarantees one at a time.
let starfieldQueue = Promise.resolve();

export function addStarfield(map) {
  starfieldQueue = starfieldQueue.then(() => addStarfieldInner(map));
  return starfieldQueue;
}

async function addStarfieldInner(map) {
  if (!MaplibreStarfieldLayer) {
    await preloadStarfield();
  }
  if (!MaplibreStarfieldLayer || !map.getStyle) return;

  await waitForStyle(map);

  // Remove any existing starfield layer via the map API (custom layers
  // are not always reflected in getStyle().layers, so iterate both).
  try {
    if (map.getLayer("starfield")) map.removeLayer("starfield");
  } catch (e) {}
  const style = map.getStyle();
  if (style && style.layers) {
    for (const layer of style.layers) {
      if (layer.id === "starfield" || /star/i.test(layer.id)) {
        try { map.removeLayer(layer.id); } catch (e) {}
      }
    }
  }

  try {
    map.setProjection({ type: "globe" });
  } catch (e) {
    console.warn("setProjection failed:", e);
  }

  const layers = map.getStyle().layers;
  const firstLayerId = layers && layers.length > 0 ? layers[0].id : undefined;

  const starfield = new MaplibreStarfieldLayer({
    starCount: 4000,
    starSize: 1.6,
    galaxyBrightness: 0.3,
    galaxyTextureUrl: "milkyway.jpg",
  });

  try {
    map.addLayer(starfield, firstLayerId);
  } catch (e) {
    console.warn("addLayer failed:", e);
  }

  try {
    if (map.isStyleLoaded()) {
      map.setProjection({ type: "globe" });
    }
  } catch (e) {}
  map.triggerRepaint();
}

export function initMap({ container }) {
  preloadStarfield();

  const map = new maplibregl.Map({
    container,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [0, 0],
    zoom: 0,
    pitch: 0,
    attributionControl: false,
  });

  // Custom controls: zoom+zoom- in a pill, compass as separate circle
  map.addControl({
    onAdd() {
      const el = document.createElement("div");
      el.className = "maplibregl-ctrl custom-controls";

      // Compass button (separate circle above zoom). The needle
      // rotates to always point north: transform = -bearing deg.
      const compassBtn = document.createElement("button");
      compassBtn.className = "ctrl-compass";
      compassBtn.title = "Arah utara";
      compassBtn.setAttribute("aria-label", "Kembalikan arah utara");
      compassBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2 18 12 12 22 6 12Z" fill="#475569"/><path d="M12 2 18 12 6 12Z" fill="#EF4444"/></svg>`;
      const compassIcon = compassBtn.querySelector("svg");
      const updateCompass = () => {
        const bearing = map.getBearing();
        compassIcon.style.transform = `rotate(${-bearing}deg)`;
      };
      compassBtn.addEventListener("click", () => {
        map.resetNorth({ duration: 300 });
      });
      map.on("rotate", updateCompass);
      map.on("load", updateCompass);
      // Disable the CSS transition while the user drags so the
      // needle tracks the pointer without lag.
      map.on("rotatestart", () => compassIcon.classList.add("no-transition"));
      map.on("rotateend", () => compassIcon.classList.remove("no-transition"));
      el.appendChild(compassBtn);

      // Zoom container (+/- in a pill)
      const zoomContainer = document.createElement("div");
      zoomContainer.className = "ctrl-zoom";
      const zoomIn = document.createElement("button");
      zoomIn.className = "ctrl-zoom-in";
      zoomIn.title = "Perbesar";
      zoomIn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" width="16" height="16" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>`;
      zoomIn.addEventListener("click", () => map.zoomIn({ duration: 200 }));

      const zoomOut = document.createElement("button");
      zoomOut.className = "ctrl-zoom-out";
      zoomOut.title = "Perkecil";
      zoomOut.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" width="16" height="16" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15"/></svg>`;
      zoomOut.addEventListener("click", () => map.zoomOut({ duration: 200 }));

      zoomContainer.appendChild(zoomIn);
      zoomContainer.appendChild(zoomOut);
      el.appendChild(zoomContainer);

      return el;
    },
    onRemove() {}
  }, "top-left");

  // Attribution toggle (bottom-right)
  map.addControl({
    onAdd() {
      const el = document.createElement("div");
      el.className = "maplibregl-ctrl attrib-toggle";
      const btn = document.createElement("button");
      btn.className = "attrib-toggle-btn";
      btn.setAttribute("aria-label", "Informasi atribusi");
      btn.innerHTML = `<svg viewBox="0 0 512 512" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/></svg>`;
      const text = document.createElement("div");
      text.className = "attrib-toggle-text";
      text.innerHTML = `<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a> | <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> — data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>`;
      btn.addEventListener("click", () => el.classList.toggle("open"));
      el.appendChild(btn);
      el.appendChild(text);
      return el;
    },
    onRemove() {}
  }, "bottom-right");

  map.addControl(new maplibregl.ScaleControl({ maxWidth: 200 }), "bottom-left");

  // Set globe projection as soon as the style is loaded — this fires
  // before the first render frame, eliminating the "flat -> globe" flash.
  map.on("style.load", () => {
    map.setProjection({ type: "globe" });
  });

  return map;
}
// ═══════════════════════════════════════════════════════════
// JAWA BARAT FLY-TO
// ═══════════════════════════════════════════════════════════
// Hardcoded center of Jawa Barat — used for the cinematic fly-in
// after the globe + stars are ready. Independent of data loading.
export const JABAR_CENTER = [107.6, -6.9];

export function flyToJabar(map, opts = {}) {
  if (!map) return Promise.resolve();
  const duration = opts.duration ?? 2000;
  const zoom = opts.zoom ?? 8;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      map.off("moveend", onEnd);
      resolve();
    };
    const onEnd = () => finish();
    map.on("moveend", onEnd);
    try {
      map.flyTo({
        center: JABAR_CENTER,
        zoom,
        pitch: 0,
        bearing: 0,
        duration,
        essential: true,
      });
    } catch (e) {
      finish();
    }
    // Safety fallback
    setTimeout(finish, duration + 300);
  });
}

// ═══════════════════════════════════════════════════════════
// GLOBE-SAFE CAMERA
// ═══════════════════════════════════════════════════════════
// map.fitBounds() / cameraForBounds() are unreliable in the globe
// projection for small bounding boxes: they can compute a reversed /
// inconsistent camera and animate the user out to the whole planet
// (maplibre-gl-js issues #5375, #5439). Instead we compute the zoom
// directly from the span and use flyTo(), which animates reliably.
export function flyToBounds(map, bounds, opts = {}) {
  if (!bounds || bounds.isEmpty()) return;
  const maxZoom = opts.maxZoom ?? 16;
  const minZoom = opts.minZoom ?? 10;
  const duration = opts.duration ?? 800;
  const padding = opts.padding ?? 0;
  const center = bounds.getCenter();
  if (!center || !isFinite(center.lng) || !isFinite(center.lat)) return;

  const span = Math.max(
    Math.abs(bounds.getEast() - bounds.getWest()),
    Math.abs(bounds.getNorth() - bounds.getSouth()),
    1e-6
  );
  // ~360° of longitude is visible at zoom 0; each zoom level halves the
  // visible span. The constant (9) leaves comfortable padding around the
  // feature on screen.
  let zoom = Math.round(9 - Math.log2(span));
  zoom = Math.max(minZoom, Math.min(zoom, maxZoom));

  map.flyTo({ center, zoom, duration, padding, essential: true });
}

// Fly the camera out to a full-globe view (center 0/0, zoom min, no
// pitch/bearing). Resolves on the moveend event so callers can sequence
// teardown + new-mode init after the zoom-out has visually completed.
export function flyToGlobe(map, opts = {}) {
  if (!map) return Promise.resolve();
  const duration = opts.duration ?? 700;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      map.off("moveend", onEnd);
      resolve();
    };
    const onEnd = () => finish();
    map.on("moveend", onEnd);
    try {
      map.flyTo({
        center: [0, 0],
        zoom: 0,
        pitch: 0,
        bearing: 0,
        duration,
        essential: true,
      });
    } catch (e) {
      finish();
    }
    // Safety fallback in case moveend never fires (style swap mid-flight).
    setTimeout(finish, duration + 300);
  });
}

// Flatten any road geometry (LineString / MultiLineString / Point /
// MultiPoint / Polygon) into a list of [lng, lat] pairs.
function geoPoints(coords) {
  const pts = [];
  if (!Array.isArray(coords)) return pts;
  const flat = coords.flat(Infinity);
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i], y = flat[i + 1];
    if (isFinite(x) && isFinite(y)) pts.push([x, y]);
  }
  return pts;
}

// Fit the camera to a road's coordinates (globe-safe, MultiLineString-safe).
export function flyToCoords(map, coords, opts = {}) {
  const pts = geoPoints(coords);
  if (!pts.length) return;
  const b = new maplibregl.LngLatBounds();
  pts.forEach(p => b.extend(p));
  flyToBounds(map, b, opts);
}

// Recursively extract [lng, lat] pairs from any GeoJSON geometry
// Handles Point, LineString, Polygon, MultiPolygon, MultiLineString
export function geometryBounds(geom) {
  const b = new maplibregl.LngLatBounds();
  if (!geom || !geom.coordinates) return b;
  function walk(c) {
    if (!Array.isArray(c) || c.length === 0) return;
    if (typeof c[0] === "number") {
      const [lng, lat] = c;
      if (isFinite(lng) && isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
        b.extend([lng, lat]);
      }
      return;
    }
    for (const child of c) walk(child);
  }
  walk(geom.coordinates);
  return b;
}

// Single popup at a time — opening a new one closes the previous one so
// search results never stack popups on top of each other.
let activePopup = null;
export function showPopup(map, lngLat, html, opts = {}) {
  if (activePopup) activePopup.remove();
  activePopup = new maplibregl.Popup({ maxWidth: "320px", ...opts })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);
  return activePopup;
}

export function closePopup() {
  if (activePopup) { activePopup.remove(); activePopup = null; }
}

// ═══════════════════════════════════════════════════════════
// BASEMAP GALLERY
// ═══════════════════════════════════════════════════════════
export const BASEMAPS = {
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  bright: "https://tiles.openfreemap.org/styles/bright",
  positron: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
  fiord: "https://tiles.openfreemap.org/styles/fiord",
};

let styleSwitchInFlight = false;

export async function setBasemap(map, styleName) {
  if (!BASEMAPS[styleName] || styleSwitchInFlight) return;
  styleSwitchInFlight = true;
  try {
    // Inject globe projection into the style spec itself: MapLibre v5
    // resets projection to the style's default (Mercator) on every
    // setStyle, and calling setProjection afterwards is unreliable for
    // custom 3D layers. The starfield skybox only renders in globe mode.
    map.setStyle(BASEMAPS[styleName], {
      transformStyle: (_, next) => ({
        ...next,
        projection: { type: "globe" },
      }),
    });
    await waitForMapReady(map);
    await addStarfield(map);
    await waitForMapReady(map);
    // setStyle dropped the mode's data layers (sources + layers are not
    // part of the style spec). style.load can race the source teardown,
    // so fire an explicit event for the active module to re-add them.
    map.fire("basemap-changed");
  } finally {
    styleSwitchInFlight = false;
  }
}

export function layoutTopLeftControls() {
  const isMobile = window.matchMedia("(max-width: 600px)").matches;
  // Anchor on #panel, falling back to #panel-skeleton — identical
  // geometry, so tools hold their position through the swap instead of
  // collapsing to the edge and jumping back on panel mount.
  const anchor =
    document.getElementById("panel") ||
    document.getElementById("panel-skeleton");
  let left = 12;
  if (!isMobile && anchor) {
    const rect = anchor.getBoundingClientRect();
    if (rect.width > 0) left = Math.round(rect.right) + 12;
  }

  const locateBtn = document.getElementById("locate-btn");
  const toolbar = document.getElementById("toolbar");
  const basemapGallery = document.getElementById("basemap-gallery");
  const ctrl = document.querySelector(".maplibregl-ctrl-top-left");

  if (locateBtn) locateBtn.style.left = (isMobile ? 8 : left) + "px";
  if (toolbar) toolbar.style.left = (isMobile ? 8 : left) + "px";
  if (basemapGallery) basemapGallery.style.left = (isMobile ? 8 : left) + "px";
  if (ctrl) ctrl.style.left = (isMobile ? 8 : left) + "px";
}
