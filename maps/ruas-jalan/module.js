import { initParquet, loadParquetToGeoJSON } from "../../shared-core/js/parquet-loader.js";
import { flyToBounds, flyToCoords, showPopup, closePopup, geometryBounds } from "../../shared-core/js/map-core.js";
import { escHtml, toast, initBottomSheet } from "../../shared-core/js/ui-core.js";
import config from "./config.js";

export { config };

const UPTD_COLORS = config.UPTD_COLORS || {
  "UPTD-I": "#E11D48", "UPTD-II": "#2563EB",
  "UPTD-III": "#059669", "UPTD-IV": "#7C3AED",
};
const UPTD_DEFAULT = config.UPTD_DEFAULT || "#6B7280";

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let map = null;
let roadsGeoJSON = null;
let activeFilters = new Set();
let selectedRoadId = null;
let hoveredRoadId = null;
let coordMarker = null;
let roadIndexCache = null;
let roadIndexOwner = null;
let nomTimer = null;
let nomAbort = null;
let geomAbort = null;
let dragCounter = 0;

// ═══════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════
let searchBar, searchBox, searchInput, searchDropdown, searchClear, locateBtn;
let panel, panelHeader, panelBody, panelToggle, sheetHandle;
let fileDrop, fileInput, fileStatus;
let uptdList, legendEl, legendRoads;
let dropOverlay;

// ═══════════════════════════════════════════════════════════
// HANDLER REFS (for teardown)
// ═══════════════════════════════════════════════════════════
let styleLoadHandler = null;
let basemapChangedHandler = null;
let mapClickHandler = null;
let roadMouseEnterHandler = null;
let roadMouseMoveHandler = null;
let roadMouseLeaveHandler = null;
let roadClickHandler = null;
let outsideClickHandler = null;
let resizeHandler = null;
let sheetTeardown = null;
let searchInputHandler = null;
let searchKeydownHandler = null;
let searchFocusHandler = null;
let searchBlurHandler = null;
let searchClearHandler = null;
let locateClickHandler = null;
let dropdownClickHandler = null;
let fileDropClickHandler = null;
let fileInputChangeHandler = null;
let dragEnterHandler = null;
let dragLeaveHandler = null;
let dragOverHandler = null;
let dropHandler = null;

const ROAD_PROXIMITY_M = 50;

// ═══════════════════════════════════════════════════════════
// GEO HELPERS (faithful port from source)
// ═══════════════════════════════════════════════════════════
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

function geoMidpoint(coords) {
  const pts = geoPoints(coords);
  return pts[Math.floor((pts.length - 1) / 2)] || pts[0];
}

// ═══════════════════════════════════════════════════════════
// ROAD INDEX & PROXIMITY (faithful port)
// ═══════════════════════════════════════════════════════════
function buildRoadIndex() {
  if (!roadsGeoJSON) return null;
  const pts = roadsGeoJSON.features.map(f => geoPoints(f.geometry.coordinates));
  const bboxes = pts.map(p => {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [x, y] of p) {
      if (x < minLng) minLng = x; if (x > maxLng) maxLng = x;
      if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
    }
    return [minLng, minLat, maxLng, maxLat];
  });
  return { features: roadsGeoJSON.features, pts, bboxes };
}

function nearestRoad(lng, lat) {
  if (roadIndexOwner !== roadsGeoJSON) {
    roadIndexOwner = roadsGeoJSON;
    roadIndexCache = buildRoadIndex();
  }
  if (!roadIndexCache) return null;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const mPerDegLng = 111320 * cosLat;
  const qx = lng * mPerDegLng, qy = lat * 111320;
  let bestFeature = null, bestDist = Infinity;
  for (let i = 0; i < roadIndexCache.features.length; i++) {
    const bb = roadIndexCache.bboxes[i];
    const dxB = Math.max(bb[0] - lng, 0, lng - bb[2]) * mPerDegLng;
    const dyB = Math.max(bb[1] - lat, 0, lat - bb[3]) * 111320;
    if (Math.sqrt(dxB * dxB + dyB * dyB) >= bestDist) continue;
    const pts = roadIndexCache.pts[i];
    let d = Infinity;
    for (let j = 0; j + 1 < pts.length; j++) {
      const [ax, ay] = pts[j], [bx, by] = pts[j + 1];
      const p1x = ax * mPerDegLng, p1y = ay * 111320;
      const p2x = bx * mPerDegLng, p2y = by * 111320;
      const dx = p2x - p1x, dy = p2y - p1y;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((qx - p1x) * dx + (qy - p1y) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = p1x + t * dx, cy = p1y + t * dy;
      const ddx = qx - cx, ddy = qy - cy;
      const dseg = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dseg < d) d = dseg;
    }
    if (d < bestDist) { bestDist = d; bestFeature = roadIndexCache.features[i]; }
  }
  return { feature: bestFeature, distanceM: bestDist };
}

function checkLocation(lng, lat, accuracyM = null) {
  if (coordMarker) coordMarker.remove();
  const el = document.createElement("div");
  el.className = "coord-marker";
  el.title = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  coordMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);

  const accHtml = accuracyM != null
    ? `<span style="color:#94a3b8;">Akurasi GPS: ±${Math.round(accuracyM)} m</span><br/>`
    : "";
  const res = nearestRoad(lng, lat);
  let html;
  if (!res || !res.feature) {
    html = `<div>
      <b>📍 Koordinat</b><br/>
      ${accHtml}
      <span style="color:#94a3b8;">Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}</span><br/><br/>
      <span style="font-size:11px;color:#64748b;">Data jalan belum dimuat.</span>
    </div>`;
  } else if (res.distanceM <= ROAD_PROXIMITY_M) {
    const p = res.feature.properties;
    const color = UPTD_COLORS[p.unit_kerja_kode] || UPTD_DEFAULT;
    selectRoad(res.feature);
    html = `<div>
      <b style="color:#22c55e;font-size:13px;">✅ DI JALAN PROVINSI</b><br/>
      ${accHtml}
      <span style="color:#94a3b8;">Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}</span><br/><br/>
      <b>Jalan:</b> ${escHtml(p.nama || "N/A")}<br/>
      <b>Kode:</b> ${escHtml(p.kode_number || "N/A")}<br/>
      <b>UPTD:</b> <span style="color:${color};font-weight:700;">${escHtml(p.unit_kerja_kode || "N/A")}</span><br/>
      <b>Jarak dari titik:</b> ~${Math.round(res.distanceM)} m
    </div>`;
  } else {
    const p = res.feature.properties;
    deselectRoad();
    html = `<div>
      <b style="color:#ef4444;font-size:13px;">❌ BUKAN JALAN PROVINSI</b><br/>
      ${accHtml}
      <span style="color:#94a3b8;">Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}</span><br/><br/>
      <b>Jalan provinsi terdekat:</b> ${escHtml(p.nama || "N/A")}<br/>
      <b>Jarak:</b> ~${Math.round(res.distanceM)} m<br/>
      <span style="font-size:11px;color:#64748b;">Titik ini tidak berada di ruas jalan provinsi.</span>
    </div>`;
  }
  coordMarker.setPopup(new maplibregl.Popup({ maxWidth: "300px" }).setHTML(html));
  coordMarker.togglePopup();
  map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), duration: 600, essential: true });
}

// ═══════════════════════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════════════════════
function selectRoad(feature) {
  selectedRoadId = feature.id;
  if (map.getLayer("roads-selected")) {
    map.setFilter("roads-selected", ["==", ["id"], selectedRoadId]);
  }
}

function deselectRoad() {
  selectedRoadId = null;
  if (map.getLayer("roads-selected")) {
    map.setFilter("roads-selected", ["==", ["id"], -999]);
  }
}

// ═══════════════════════════════════════════════════════════
// LAYERS
// ═══════════════════════════════════════════════════════════
function addRoadsLayer(forceReadd = false) {
  if (!forceReadd && map.getSource("roads")) {
    map.getSource("roads").setData(roadsGeoJSON);
    return;
  }

  // Hygiene: remove old handlers before re-adding (prevents duplicates on basemap switch)
  if (forceReadd) {
    if (roadMouseEnterHandler) map.off("mouseenter", "roads-hitbox", roadMouseEnterHandler);
    if (roadMouseMoveHandler) map.off("mousemove", "roads-hitbox", roadMouseMoveHandler);
    if (roadMouseLeaveHandler) map.off("mouseleave", "roads-hitbox", roadMouseLeaveHandler);
    if (roadClickHandler) map.off("click", "roads-hitbox", roadClickHandler);
    if (mapClickHandler) map.off("click", mapClickHandler);
  }

  if (map.getSource("roads")) {
    ["roads-hitbox", "roads-line", "roads-selected"].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    map.removeSource("roads");
  }

  map.addSource("roads", { type: "geojson", data: roadsGeoJSON });

  map.addLayer({
    id: "roads-hitbox", type: "line", source: "roads",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "transparent", "line-width": 14 }
  });
  map.addLayer({
    id: "roads-line", type: "line", source: "roads",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": [
        "match", ["get", "unit_kerja_kode"],
        "UPTD-I", UPTD_COLORS["UPTD-I"], "UPTD-II", UPTD_COLORS["UPTD-II"],
        "UPTD-III", UPTD_COLORS["UPTD-III"], "UPTD-IV", UPTD_COLORS["UPTD-IV"],
        UPTD_DEFAULT
      ],
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2.5, 16, 4, 20, 6],
      "line-opacity": 0.85
    }
  });
  map.addLayer({
    id: "roads-selected", type: "line", source: "roads",
    layout: { "line-join": "round", "line-cap": "round" },
    filter: ["==", ["id"], -999],
    paint: {
      "line-color": "#2563EB",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 12, 7, 16, 10, 20, 14],
      "line-opacity": 1
    }
  });

  roadMouseEnterHandler = () => { map.getCanvas().style.cursor = "pointer"; };
  roadMouseMoveHandler = (e) => {
    if (!e.features.length) return;
    if (hoveredRoadId !== null) map.setFeatureState({ source: "roads", id: hoveredRoadId }, { hover: false });
    hoveredRoadId = e.features[0].id;
    map.setFeatureState({ source: "roads", id: hoveredRoadId }, { hover: true });
  };
  roadMouseLeaveHandler = () => {
    map.getCanvas().style.cursor = "";
    if (hoveredRoadId !== null) {
      map.setFeatureState({ source: "roads", id: hoveredRoadId }, { hover: false });
      hoveredRoadId = null;
    }
  };
  roadClickHandler = (e) => {
    e.preventDefault();
    if (!e.features.length) return;
    const feature = e.features[0];
    const p = feature.properties;
    const color = UPTD_COLORS[p.unit_kerja_kode] || UPTD_DEFAULT;

    selectRoad(feature);
    const coords = feature.geometry.coordinates;
    flyToCoords(map, coords, { padding: 80, maxZoom: 16 });

    const mid = geoMidpoint(coords);
    setTimeout(() => {
      showPopup(map, mid, `<div>
        <b style="font-size:14px;">${escHtml(p.nama || "Jalan")}</b><br/>
        <span style="color:#94a3b8;">${escHtml(p.kode_number || "")}</span><br/><br/>
        <b>Kode:</b> ${escHtml(p.kode || "N/A")}<br/>
        <b>Panjang:</b> ${escHtml(p.panjang_km || "N/A")} km<br/>
        <b>Status:</b> ${escHtml(p.status || "N/A")}<br/>
        <b>UPTD:</b> <span style="color:${color};font-weight:700;">${escHtml(p.unit_kerja_kode || "N/A")}</span><br/>
        <b>Lokasi:</b> ${escHtml(p.lokasi_kode || "N/A")}
      </div>`);
    }, 900);
  };

  map.on("mouseenter", "roads-hitbox", roadMouseEnterHandler);
  map.on("mousemove", "roads-hitbox", roadMouseMoveHandler);
  map.on("mouseleave", "roads-hitbox", roadMouseLeaveHandler);
  map.on("click", "roads-hitbox", roadClickHandler);

  mapClickHandler = (e) => {
    if (e.defaultPrevented) return;
    deselectRoad();
    checkLocation(e.lngLat.lng, e.lngLat.lat);
  };
  map.on("click", mapClickHandler);
}

function reAddLayers() {
  if (!roadsGeoJSON) return;
  addRoadsLayer(true);
  updateRoadVisibility();
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function updateRoadVisibility() {
  if (!map.getLayer("roads-line")) return;
  const filter = activeFilters.size >= 4 ? null : ["in", ["get", "unit_kerja_kode"], ["literal", Array.from(activeFilters)]];
  map.setFilter("roads-line", filter);
  map.setFilter("roads-hitbox", filter);
}

// ═══════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════
function showUI() {
  panel.style.display = "block";
  document.getElementById("uptd-section").style.display = "block";

  if (roadsGeoJSON) {
    const codes = {};
    roadsGeoJSON.features.forEach(f => {
      const c = f.properties.unit_kerja_kode;
      if (c) codes[c] = (codes[c] || 0) + 1;
    });
    uptdList.innerHTML = "";
    legendRoads.innerHTML = "";

    Object.entries(codes).sort().forEach(([code, count]) => {
      activeFilters.add(code);
      const color = UPTD_COLORS[code] || UPTD_DEFAULT;
      const item = document.createElement("label");
      item.className = "uptd-item";
      item.style.setProperty("--uptd-color", color);
      item.setAttribute("role", "checkbox");
      item.setAttribute("aria-checked", "true");
      item.setAttribute("aria-label", `Filter ${code} - ${count} ruas jalan`);
      item.innerHTML = `
        <input type="checkbox" checked data-code="${code}" aria-hidden="true" tabindex="-1" />
        <span class="uptd-item-check" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
          </svg>
        </span>
        <span class="uptd-item-dot"></span>
        <span class="uptd-item-name">${code}</span>
        <span class="uptd-item-count">${count} ruas</span>
      `;
      item.addEventListener("click", (e) => {
        const checkbox = item.querySelector("input[type='checkbox']");
        const isChecked = !checkbox.checked;
        checkbox.checked = isChecked;
        item.setAttribute("aria-checked", String(isChecked));
        if (isChecked) activeFilters.add(code); else activeFilters.delete(code);
        updateRoadVisibility();
      });
      uptdList.appendChild(item);

      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `
        <span class="legend-color-dot" style="background:${color}"></span>
        <span class="legend-label">${code}</span>
      `;
      legendRoads.appendChild(row);
    });
  }
}

function updateStats() {
  if (roadsGeoJSON?.features?.length > 0) {
    document.getElementById("stat-roads").textContent = roadsGeoJSON.features.length.toLocaleString();
    const totalKm = roadsGeoJSON.features.reduce((sum, f) => sum + (parseFloat(f.properties?.panjang_km) || 0), 0);
    document.getElementById("stat-km").textContent = totalKm.toFixed(1);
    const uptdSet = new Set();
    roadsGeoJSON.features.forEach(f => { if (f.properties?.unit_kerja_kode) uptdSet.add(f.properties.unit_kerja_kode); });
    document.getElementById("stat-uptd").textContent = uptdSet.size;
    const kabSet = new Set();
    roadsGeoJSON.features.forEach(f => { if (f.properties?.kode) kabSet.add(f.properties.kode); });
    document.getElementById("stat-kab").textContent = kabSet.size;
    document.getElementById("road-badge").textContent = roadsGeoJSON.features.length.toLocaleString();
  }
}

function fitBounds() {
  const coords = [];
  if (roadsGeoJSON) roadsGeoJSON.features.forEach(f => {
    const flat = f.geometry.coordinates.flat(2);
    for (let i = 0; i < flat.length; i += 2) coords.push([flat[i], flat[i + 1]]);
  });
  if (coords.length) {
    const bounds = new maplibregl.LngLatBounds();
    coords.forEach(c => bounds.extend(c));
    flyToBounds(map, bounds, { padding: 40 });
  }
}

// ═══════════════════════════════════════════════════════════
// HIGHLIGHT
// ═══════════════════════════════════════════════════════════
function clearHighlight() {
  if (!map) return;
  ["hl-fill", "hl-line", "hl-glow"].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource("hl")) map.removeSource("hl");
}

function renderHighlight(geojson) {
  if (!map) return;
  clearHighlight();
  if (!geojson || !geojson.geometry) return;
  const t = geojson.geometry.type;
  map.addSource("hl", { type: "geojson", data: geojson });
  if (t === "Polygon" || t === "MultiPolygon") {
    map.addLayer({ id: "hl-fill", type: "fill", source: "hl",
      paint: { "fill-color": "#2563EB", "fill-opacity": 0.10, "fill-outline-color": "#2563EB" } });
    map.addLayer({ id: "hl-line", type: "line", source: "hl",
      paint: { "line-color": "#2563EB", "line-width": 2, "line-opacity": 0.9 } });
  } else if (t === "LineString" || t === "MultiLineString") {
    map.addLayer({ id: "hl-glow", type: "line", source: "hl",
      paint: { "line-color": "#2563EB", "line-width": 8, "line-opacity": 0.25 } });
    map.addLayer({ id: "hl-line", type: "line", source: "hl",
      paint: { "line-color": "#2563EB", "line-width": 3, "line-opacity": 0.9 } });
  }
}

async function loadOSMGeometry(osmType, osmId) {
  if (!osmType || !osmId) return null;
  if (geomAbort) geomAbort.abort();
  geomAbort = new AbortController();
  const signal = geomAbort.signal;
  const typeChar = osmType.charAt(0).toUpperCase();
  const url = `https://nominatim.openstreetmap.org/details?osmtype=${typeChar}&osmid=${osmId}&format=json&polygon_geojson=1&accept-language=id`;
  try {
    const resp = await fetch(url, { signal, headers: { "User-Agent": "PetaJalanProvinsi/1.0" } });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.geometry || !data.geometry.coordinates) return null;
    return { type: "Feature", geometry: data.geometry, properties: data };
  } catch (e) {
    if (e.name !== "AbortError") console.warn("Nominatim details:", e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════
function setActiveSearchItem(items, idx) {
  items.forEach(el => el.classList.remove("active"));
  if (items[idx]) {
    items[idx].classList.add("active");
    items[idx].scrollIntoView({ block: "nearest" });
  }
}

function activateSearchItem(item) {
  if (!item) return;

  const type = item.dataset.type;
  if (type === "coord") {
    const lat = parseFloat(item.dataset.lat);
    const lng = parseFloat(item.dataset.lng);
    checkLocation(lng, lat);
  } else if (item.dataset.nom !== undefined) {
    const r = searchDropdown._nomResults[parseInt(item.dataset.nom)];
    if (r) {
      const lng = parseFloat(r.lon);
      const lat = parseFloat(r.lat);

      if (coordMarker) coordMarker.remove();
      deselectRoad();
      clearHighlight();

      const bbox = r.boundingbox;
      if (bbox && bbox.length === 4) {
        const minLat = parseFloat(bbox[0]);
        const maxLat = parseFloat(bbox[1]);
        const minLng = parseFloat(bbox[2]);
        const maxLng = parseFloat(bbox[3]);
        if (isFinite(minLat) && isFinite(maxLat) && isFinite(minLng) && isFinite(maxLng)) {
          flyToBounds(map, new maplibregl.LngLatBounds([minLng, minLat], [maxLng, maxLat]), { maxZoom: 15 });
        } else {
          map.flyTo({ center: [lng, lat], zoom: 14, duration: 800, essential: true });
        }
      } else {
        map.flyTo({ center: [lng, lat], zoom: 14, duration: 800, essential: true });
      }

      loadOSMGeometry(r.osm_type, r.osm_id).then(geojson => {
        if (!geojson) return;
        if (geomAbort && geomAbort.signal.aborted) return;
        renderHighlight(geojson);
      });

      setTimeout(() => {
        showPopup(map, [lng, lat], `<div><b>📍 ${escHtml(r.display_name.split(",")[0])}</b><br/><span style="color:#94a3b8;">${escHtml(r.display_name)}</span></div>`);
      }, 1100);
    }
  } else {
    const idx = parseInt(item.dataset.idx);
    const feature = searchDropdown._results[idx];
    if (feature) {
      selectRoad(feature);
      const coords = feature.geometry.coordinates;
      flyToCoords(map, coords, { padding: 80, maxZoom: 16 });
      const mid = geoMidpoint(coords);
      const p = feature.properties;
      const color = UPTD_COLORS[p.unit_kerja_kode] || UPTD_DEFAULT;
      setTimeout(() => {
        showPopup(map, mid, `<div>
          <b style="font-size:14px;">${escHtml(p.nama || "Jalan")}</b><br/>
          <span style="color:#94a3b8;">${escHtml(p.kode_number || "")}</span><br/><br/>
          <b>Kode:</b> ${escHtml(p.kode || "N/A")}<br/>
          <b>Panjang:</b> ${escHtml(p.panjang_km || "N/A")} km<br/>
          <b>UPTD:</b> <span style="color:${color};font-weight:700;">${escHtml(p.unit_kerja_kode || "N/A")}</span><br/>
          <b>Lokasi:</b> ${escHtml(p.lokasi_kode || "N/A")}
        </div>`);
      }, 900);
    }
  }

  searchDropdown.style.display = "none";
  searchInput.value = "";
  updateSearchClear();
}

function updateSearchClear() {
  searchClear.style.display = searchInput.value ? "flex" : "none";
}

// ═══════════════════════════════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════════════════════════════
async function handleFiles(files) {
  const fileArr = Array.from(files);
  const roadsFile = fileArr.find(f => f.name.includes("jalan") || f.name.includes("ruas"));

  if (!roadsFile) {
    fileStatus.className = "file-status file-status--error";
    fileStatus.textContent = "Need ruas_jalan.parquet";
    return;
  }

  try {
    fileStatus.className = "file-status file-status--loading";
    fileStatus.textContent = `Loading ${roadsFile.name} (streaming)...`;
    roadsGeoJSON = await loadParquetToGeoJSON(roadsFile, (batch, total) => {
      fileStatus.textContent = `Roads: batch ${batch}, ${total} features...`;
    });
    addRoadsLayer();
    fileDrop.classList.add("file-drop-zone--loaded");
    fileStatus.className = "file-status file-status--success";
    fileStatus.textContent = `Loaded ${roadsGeoJSON.features.length} ruas jalan`;
    showUI();
    setTimeout(updateStats, 100);
    fitBounds();
  } catch (err) {
    console.error("handleFiles error:", err);
    fileStatus.className = "file-status file-status--error";
    fileStatus.textContent = `Error: ${err.message}`;
  }
}

// ═══════════════════════════════════════════════════════════
// DOM CREATION
// ═══════════════════════════════════════════════════════════
function createDOM() {
  const mapContainer = document.getElementById("map");

  // Search bar lives in the shell (shared-core) — grab the shared DOM.
  searchBox = document.getElementById("search-box");
  searchInput = document.getElementById("search-input");
  searchDropdown = document.getElementById("search-dropdown");
  searchClear = document.getElementById("search-clear");
  locateBtn = document.getElementById("locate-btn");
  if (searchInput) searchInput.placeholder = "Cari jalan / kode / koordinat...";

  // Panel
  panel = document.createElement("div");
  panel.id = "panel";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Panel informasi peta jalan");
  panel.innerHTML = `
    <div id="sheet-handle" aria-hidden="true"></div>
    <div id="panel-header">
      <span class="panel-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0z"/>
        </svg>
      </span>
      <h1 class="panel-title">Peta Jalan Provinsi Jabar</h1>
      <span class="badge" id="road-badge" aria-label="Jumlah ruas jalan">0</span>
      <button id="panel-toggle" 
              class="panel-toggle-btn"
              title="Minimalkan panel" 
              aria-label="Minimalkan panel" 
              aria-expanded="true"
              aria-controls="panel-body">
        <svg viewBox="0 0 512 512" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 81.4 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/>
        </svg>
      </button>
    </div>
    <div id="panel-body" role="region" aria-label="Informasi data jalan">
      <!-- Stats Section -->
      <section class="panel-section" aria-label="Statistik jalan">
        <div class="stats-grid" role="list">
          <div class="stat-card" role="listitem">
            <div class="stat-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z"/>
              </svg>
            </div>
            <div class="stat-content">
              <div class="stat-label">Total Ruas</div>
              <div class="stat-value" id="stat-roads">0</div>
            </div>
          </div>
          <div class="stat-card stat-card--blue" role="listitem">
            <div class="stat-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/>
              </svg>
            </div>
            <div class="stat-content">
              <div class="stat-label">Total KM</div>
              <div class="stat-value stat-value--blue" id="stat-km">0</div>
            </div>
          </div>
          <div class="stat-card stat-card--green" role="listitem">
            <div class="stat-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"/>
              </svg>
            </div>
            <div class="stat-content">
              <div class="stat-label">UPTD Active</div>
              <div class="stat-value stat-value--green" id="stat-uptd">0</div>
            </div>
          </div>
          <div class="stat-card stat-card--purple" role="listitem">
            <div class="stat-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>
              </svg>
            </div>
            <div class="stat-content">
              <div class="stat-label">Kab/Kota</div>
              <div class="stat-value stat-value--purple" id="stat-kab">0</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Data File Section -->
      <section class="panel-section" aria-label="Upload data">
        <div class="section-header">
          <span class="section-chevron" aria-hidden="true">▸</span>
          <h2 class="section-title">Data File</h2>
        </div>
        <div class="section-content">
          <div id="file-drop" 
               class="file-drop-zone"
               role="button"
               tabindex="0"
               aria-label="Klik atau drag file parquet ke sini">
            <div class="file-drop-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
              </svg>
            </div>
            <p class="file-drop-text">Drag & drop <strong>ruas_jalan.parquet</strong></p>
            <p class="file-drop-hint">atau klik untuk memilih file</p>
            <input type="file" id="file-input" accept=".parquet" style="display:none;" aria-hidden="true" />
            <div class="status" id="file-status" role="status" aria-live="polite"></div>
          </div>
        </div>
      </section>

      <!-- UPTD Filter Section -->
      <section class="panel-section" id="uptd-section" aria-label="Filter UPTD">
        <div class="section-header">
          <span class="section-chevron" aria-hidden="true">▸</span>
          <h2 class="section-title">UPTD</h2>
        </div>
        <div class="section-content">
          <div class="uptd-list" id="uptd-list" role="group" aria-label="Daftar UPTD"></div>
        </div>
      </section>
    </div>
  `;
  // Mount the panel on <body>, NOT inside #map: #map has its own
  // stacking context (z-index:1) which would trap the panel's z-index
  // below the shell buttons. On body the panel's z-index (10) wins.
  document.body.appendChild(panel);

  panelHeader = document.getElementById("panel-header");
  panelBody = document.getElementById("panel-body");
  panelToggle = document.getElementById("panel-toggle");
  sheetHandle = document.getElementById("sheet-handle");
  fileDrop = document.getElementById("file-drop");
  fileInput = document.getElementById("file-input");
  fileStatus = document.getElementById("file-status");
  uptdList = document.getElementById("uptd-list");

  // Section collapse: clicking a .section-header toggles the parent
  // .panel-section between expanded (default) and .collapsed.
  panelBody?.querySelectorAll(".panel-section .section-header").forEach((header) => {
    const section = header.closest(".panel-section");
    if (!section) return;
    header.addEventListener("click", () => {
      const collapsed = section.classList.toggle("collapsed");
      header.setAttribute("aria-expanded", String(!collapsed));
    });
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", String(!section.classList.contains("collapsed")));
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        header.click();
      }
    });
  });

  // Legend
  legendEl = document.createElement("div");
  legendEl.id = "legend";
  legendEl.setAttribute("role", "region");
  legendEl.setAttribute("aria-label", "Legenda peta");
  legendEl.innerHTML = `
    <h4 class="legend-title">Legend - UPTD</h4>
    <div id="legend-roads" class="legend-content"></div>
  `;
  mapContainer.appendChild(legendEl);
  legendRoads = document.getElementById("legend-roads");

  // Drop overlay
  dropOverlay = document.createElement("div");
  dropOverlay.id = "drop-overlay";
  dropOverlay.setAttribute("role", "dialog");
  dropOverlay.setAttribute("aria-modal", "true");
  dropOverlay.setAttribute("aria-label", "Drop file parquet");
  dropOverlay.innerHTML = `
    <div class="drop-overlay-box">
      <div class="drop-overlay-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
        </svg>
      </div>
      <h2 class="drop-overlay-title">Drop .parquet file here</h2>
      <p class="drop-overlay-text">ruas_jalan.parquet</p>
    </div>
  `;
  document.body.appendChild(dropOverlay);
}

function removeDOM() {
  if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  if (legendEl && legendEl.parentNode) legendEl.parentNode.removeChild(legendEl);
  if (dropOverlay && dropOverlay.parentNode) dropOverlay.parentNode.removeChild(dropOverlay);
  searchBox = searchInput = searchDropdown = searchClear = locateBtn = null;
  panel = panelHeader = panelBody = panelToggle = sheetHandle = null;
  fileDrop = fileInput = fileStatus = uptdList = legendEl = legendRoads = null;
  dropOverlay = null;
}

// ═══════════════════════════════════════════════════════════
// PANEL COLLAPSE — handled by shared initBottomSheet (ui-core.js)

// ═══════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════
function setupSearch() {
  searchFocusHandler = () => { searchBox.classList.add("has-focus"); };
  searchBlurHandler = () => { setTimeout(() => searchBox.classList.remove("has-focus"), 150); };
  searchInput.addEventListener("focus", searchFocusHandler);
  searchInput.addEventListener("blur", searchBlurHandler);

  searchClearHandler = () => {
    searchInput.value = "";
    searchDropdown.style.display = "none";
    updateSearchClear();
    searchInput.focus();
  };
  searchClear.addEventListener("click", searchClearHandler);
  updateSearchClear();

  searchKeydownHandler = (e) => {
    const visible = searchDropdown.style.display !== "none";
    if (!visible && e.key === "Escape") { searchInput.blur(); return; }
    if (!visible) return;
    const items = Array.from(searchDropdown.querySelectorAll(".search-item"));
    if (!items.length) return;
    let idx = items.findIndex(el => el.classList.contains("active"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSearchItem(items, idx < items.length - 1 ? idx + 1 : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSearchItem(items, idx > 0 ? idx - 1 : items.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = idx >= 0 ? items[idx] : items[0];
      if (target) activateSearchItem(target);
    } else if (e.key === "Escape") {
      e.preventDefault();
      searchDropdown.style.display = "none";
    }
  };
  searchInput.addEventListener("keydown", searchKeydownHandler);

  searchInputHandler = (e) => {
    const raw = e.target.value.trim();
    const q = raw.toLowerCase();
    updateSearchClear();
    if (q.length < 2) { searchDropdown.style.display = "none"; return; }

    if (nomAbort) { nomAbort.abort(); nomAbort = null; }
    if (nomTimer) { clearTimeout(nomTimer); nomTimer = null; }

    const coordMatch = raw.match(/^-?\d+\.?\d*\s*[,\s]\s*-?\d+\.?\d*$/);
    if (coordMatch) {
      const parts = raw.split(/[,\s]+/).map(Number);
      let lat, lng;
      if (Math.abs(parts[0]) <= 90 && Math.abs(parts[1]) <= 180) {
        lat = parts[0]; lng = parts[1];
      } else if (Math.abs(parts[0]) <= 180 && Math.abs(parts[1]) <= 90) {
        lng = parts[0]; lat = parts[1];
      } else {
        searchDropdown.style.display = "none";
        return;
      }
      searchDropdown.innerHTML = `
        <div class="search-item" data-lat="${lat}" data-lng="${lng}" data-type="coord">
          <div class="s-name">📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
          <div class="s-meta">Klik untuk menampilkan di peta</div>
        </div>`;
      searchDropdown.style.display = "block";
      return;
    }

    let roadHtml = "";
    let roadTotal = 0;
    let roadResults = [];
    if (roadsGeoJSON) {
      const allRoads = roadsGeoJSON.features.filter(f => {
        const name = (f.properties.nama || "").toLowerCase();
        const kode = (f.properties.kode_number || "").toLowerCase();
        const code = (f.properties.kode || "").toLowerCase();
        return name.includes(q) || kode.includes(q) || code.includes(q);
      });
      roadTotal = allRoads.length;
      roadResults = allRoads.slice(0, 10);

      if (roadResults.length > 0) {
        roadHtml = roadResults.map((f, i) => {
          const p = f.properties;
          const color = UPTD_COLORS[p.unit_kerja_kode] || UPTD_DEFAULT;
          return `<div class="search-item" data-idx="${i}">
            <div class="s-name">${escHtml(p.nama || "Jalan")}
              <span class="s-uptd" style="background:${color};color:#fff;">${escHtml(p.unit_kerja_kode || "?")}</span>
            </div>
            <div class="s-meta">${escHtml(p.kode_number || "")} &middot; ${escHtml(p.panjang_km || "?")} km &middot; ${escHtml(p.kode || "")}</div>
          </div>`;
        }).join("");
      }
    }

    searchDropdown._results = roadResults;
    searchDropdown._roadTotal = roadTotal;
    searchDropdown._nomResults = null;

    if (roadHtml) {
      if (roadTotal > roadResults.length) {
        roadHtml += `<div class="search-info">${roadTotal - roadResults.length} jalan lainnya...</div>`;
      }
      searchDropdown.innerHTML = roadHtml;
    } else {
      searchDropdown.innerHTML = `<div class="search-empty">Mencari...</div>`;
    }
    searchDropdown.style.display = "block";

    nomTimer = setTimeout(async () => {
      nomAbort = new AbortController();
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(raw)}&format=json&limit=5&accept-language=id`,
          { signal: nomAbort.signal, headers: { 'User-Agent': 'PetaJalanProvinsi/1.0' } }
        );
        const data = await resp.json();
        const hasPlaces = data && data.length > 0;
        const hasRoads = roadHtml.length > 0;
        let html = "";
        if (hasPlaces) {
          html += `<div class="search-section-header">📍 Places</div>`;
          html += data.map((r, i) => `
            <div class="search-item" data-nom="${i}" data-osm-type="${r.osm_type}" data-osm-id="${r.osm_id}">
              <div class="s-name">${escHtml(r.display_name.split(",")[0])}</div>
              <div class="s-meta">${escHtml(r.display_name.split(",").slice(1).join(",").trim())}</div>
            </div>
          `).join("");
          html += `<div class="search-info">${data.length} hasil</div>`;
        }
        if (hasRoads) {
          if (hasPlaces) html += `<div class="search-section-header"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14" style="vertical-align:-2px;"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0z"/></svg> Jalan</div>`;
          html += roadHtml;
          if (roadTotal > roadResults.length) {
            html += `<div class="search-info">${roadTotal - roadResults.length} jalan lainnya...</div>`;
          }
        }
        if (!hasPlaces && !hasRoads) {
          html = `<div class="search-empty">Tidak ditemukan</div>`;
        }
        searchDropdown.innerHTML = html;
        searchDropdown._nomResults = data;
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("Nominatim:", err.message);
          if (!roadHtml) {
            searchDropdown.innerHTML = `<div class="search-empty">Tidak ditemukan. Periksa kembali kata kunci.</div>`;
          }
        }
      }
    }, 400);
  };
  searchInput.addEventListener("input", searchInputHandler);

  dropdownClickHandler = (e) => {
    const item = e.target.closest(".search-item");
    if (item) activateSearchItem(item);
  };
  searchDropdown.addEventListener("click", dropdownClickHandler);

  outsideClickHandler = (e) => {
    if (!e.target.closest("#search-box")) searchDropdown.style.display = "none";
  };
  document.addEventListener("click", outsideClickHandler);

  locateClickHandler = () => {
    if (!navigator.geolocation) { toast("Browser ini tidak mendukung geolocation."); return; }
    locateBtn.disabled = true; locateBtn.style.opacity = "0.6";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtn.disabled = false; locateBtn.style.opacity = "";
        checkLocation(pos.coords.longitude, pos.coords.latitude, pos.coords.accuracy);
      },
      (err) => {
        locateBtn.disabled = false; locateBtn.style.opacity = "";
        const msg = err && err.code === 1
          ? "Izin lokasi ditolak. Izinkan akses lokasi di browser untuk fitur ini."
          : err && err.code === 3
            ? "Waktu habis mengambil lokasi. Coba lagi."
            : "Tidak dapat mengambil lokasi saat ini.";
        toast(msg, 4000);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  };
  locateBtn.addEventListener("click", locateClickHandler);
}

function setupDragDrop() {
  fileDropClickHandler = (e) => { e.stopPropagation(); fileInput.click(); };
  fileDrop.addEventListener("click", fileDropClickHandler);

  fileInputChangeHandler = async (e) => {
    if (e.target.files.length) await handleFiles(e.target.files);
  };
  fileInput.addEventListener("change", fileInputChangeHandler);

  dragEnterHandler = (e) => { e.preventDefault(); dragCounter++; dropOverlay.classList.add("active"); };
  dragLeaveHandler = (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove("active"); } };
  dragOverHandler = (e) => { e.preventDefault(); };
  dropHandler = async (e) => {
    e.preventDefault(); dragCounter = 0;
    dropOverlay.classList.remove("active");
    if (e.dataTransfer.files.length) await handleFiles(e.dataTransfer.files);
  };

  document.body.addEventListener("dragenter", dragEnterHandler);
  document.body.addEventListener("dragleave", dragLeaveHandler);
  document.body.addEventListener("dragover", dragOverHandler);
  document.body.addEventListener("drop", dropHandler);
}

// ═══════════════════════════════════════════════════════════
// MODULE EXPORTS
async function loadParquetData(ctx) {
  ctx?.ui?.Loading?.mini?.("Memuat data jalan…");
  await initParquet();
  const dataUrl = new URL('data/ruas_jalan.parquet', import.meta.url);
  roadsGeoJSON = await loadParquetToGeoJSON(dataUrl);

  addRoadsLayer();
  showUI();
  updateStats();
  ctx?.ui?.Loading?.hideMini?.();

  fileDrop.classList.add("file-drop-zone--loaded");
  fileStatus.className = "file-status file-status--success";
  fileStatus.textContent = `Auto-loaded ${roadsGeoJSON.features.length} ruas jalan`;
}

// ═══════════════════════════════════════════════════════════
export const module = {
  async init(ctx) {
    map = ctx.map;

    createDOM();
    setupSearch();
    setupDragDrop();
    sheetTeardown = initBottomSheet({ panel, handle: sheetHandle, toggle: panelToggle, header: panelHeader });

    styleLoadHandler = () => {
      if (!map.getSource('roads')) {
        reAddLayers();
      }
    };
    map.on('style.load', styleLoadHandler);
    basemapChangedHandler = () => {
      if (!map.getSource('roads')) reAddLayers();
    };
    map.on('basemap-changed', basemapChangedHandler);

    return loadParquetData(ctx);
  },

  teardown() {
    if (!map) return;

    // Remove style.load listener
    if (styleLoadHandler) {
      map.off('style.load', styleLoadHandler);
      styleLoadHandler = null;
    }
    if (basemapChangedHandler) {
      map.off('basemap-changed', basemapChangedHandler);
      basemapChangedHandler = null;
    }

    // Remove map event handlers
    if (mapClickHandler) {
      map.off('click', mapClickHandler);
      mapClickHandler = null;
    }
    if (roadMouseEnterHandler) {
      map.off('mouseenter', 'roads-hitbox', roadMouseEnterHandler);
      roadMouseEnterHandler = null;
    }
    if (roadMouseMoveHandler) {
      map.off('mousemove', 'roads-hitbox', roadMouseMoveHandler);
      roadMouseMoveHandler = null;
    }
    if (roadMouseLeaveHandler) {
      map.off('mouseleave', 'roads-hitbox', roadMouseLeaveHandler);
      roadMouseLeaveHandler = null;
    }
    if (roadClickHandler) {
      map.off('click', 'roads-hitbox', roadClickHandler);
      roadClickHandler = null;
    }

    // Remove layers (reverse order)
    const layerIds = ["hl-glow", "hl-line", "hl-fill", "roads-selected", "roads-line", "roads-hitbox"];
    for (const id of layerIds) {
      if (map.getLayer(id)) map.removeLayer(id);
    }

    // Remove sources
    if (map.getSource('roads')) map.removeSource('roads');
    if (map.getSource('hl')) map.removeSource('hl');

    // Clear popup
    closePopup();

    // Remove coord marker
    if (coordMarker) { coordMarker.remove(); coordMarker = null; }

    // Clear highlight
    clearHighlight();

    // Clear timers & aborts
    if (nomTimer) { clearTimeout(nomTimer); nomTimer = null; }
    if (nomAbort) { nomAbort.abort(); nomAbort = null; }
    if (geomAbort) { geomAbort.abort(); geomAbort = null; }

    // Remove document/window listeners
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler);
      outsideClickHandler = null;
    }
    if (searchInput) {
      if (searchFocusHandler) searchInput.removeEventListener('focus', searchFocusHandler);
      if (searchBlurHandler) searchInput.removeEventListener('blur', searchBlurHandler);
      if (searchKeydownHandler) searchInput.removeEventListener('keydown', searchKeydownHandler);
      if (searchInputHandler) searchInput.removeEventListener('input', searchInputHandler);
      searchFocusHandler = searchBlurHandler = searchKeydownHandler = searchInputHandler = null;
    }
    if (searchClear) {
      if (searchClearHandler) searchClear.removeEventListener('click', searchClearHandler);
      searchClearHandler = null;
    }
    if (searchDropdown) {
      if (dropdownClickHandler) searchDropdown.removeEventListener('click', dropdownClickHandler);
      dropdownClickHandler = null;
    }
    if (locateBtn) {
      if (locateClickHandler) locateBtn.removeEventListener('click', locateClickHandler);
      locateClickHandler = null;
    }
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    // Shared bottom sheet teardown (header/handle/toggle listeners)
    if (sheetTeardown) {
      sheetTeardown();
      sheetTeardown = null;
    }
    if (dragEnterHandler) {
      document.body.removeEventListener('dragenter', dragEnterHandler);
      dragEnterHandler = null;
    }
    if (dragLeaveHandler) {
      document.body.removeEventListener('dragleave', dragLeaveHandler);
      dragLeaveHandler = null;
    }
    if (dragOverHandler) {
      document.body.removeEventListener('dragover', dragOverHandler);
      dragOverHandler = null;
    }
    if (dropHandler) {
      document.body.removeEventListener('drop', dropHandler);
      dropHandler = null;
    }

    // Remove DOM
    removeDOM();

    // Reset state
    roadsGeoJSON = null;
    activeFilters.clear();
    selectedRoadId = null;
    hoveredRoadId = null;
    roadIndexCache = null;
    roadIndexOwner = null;
    dragCounter = 0;
    map = null;
  }
};
