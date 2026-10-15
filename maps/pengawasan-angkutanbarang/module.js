import { initParquet, loadParquetToGeoJSON } from "../../shared-core/js/parquet-loader.js";
import { flyToBounds, showPopup, closePopup } from "../../shared-core/js/map-core.js";
import { escHtml, initBottomSheet, registerSearch } from "../../shared-core/js/ui-core.js";
import { parseCoordInput, geocodePlaces, GEO_ATTRIBUTION } from "../../shared-core/js/geocode-core.js";
import { ensureXLSX, exportFeaturesToXLSX } from "../../shared-core/js/export-core.js";
import config, {
  JENIS, JENIS_ORDER, JENIS_COLORS, JENIS_LABELS,
  KELAS_ORDER,
  UPTD_COLORS, UPTD_ORDER, UPTD_DEFAULT, UPTD_LABEL,
  enrichPengawasan, kabkotaLabel,
} from "./config.js";

export { config };

const CHEVRON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>`;
const TOGGLE_CHEVRON = `<svg viewBox="0 0 512 512" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 81.4 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg>`;

let map = null;
let pengawasanGeoJSON = null;
let ruasGeoJSON = null;

let activeJenis = new Set(JENIS_ORDER);
let activeKelas = new Set(KELAS_ORDER);
let activeUPTD = new Set(UPTD_ORDER);
let activeKabkota = new Set();
let allKabkota = [];

// Layer visibility is separate from data filtering: hiding a layer only
// changes what is drawn, never the panel statistics.
let layerVis = { pengawasan: true };
let ruasShown = true;
let ruasUPTD = new Set(UPTD_ORDER);
let dragCounter = 0;
let coordMarker = null;

let panel, panelHeader, panelBody, panelToggle, sheetHandle;
let fileDrop, fileInput, fileStatus;
let heroTotal, heroDenom, heroLabel, heroUnit, kpiRuas, kpiUptd, kpiKab, badgeEl;
let barsJenis, barsUptd, barsKab, kabCountEl;
let chipEls = {};
let layerRows;
let exportCountEl;
let sheetTeardown = null;

const domListeners = [];
function track(el, type, fn, opts) {
  el.addEventListener(type, fn, opts);
  domListeners.push([el, type, fn]);
}
function clearListeners() {
  for (const [el, type, fn] of domListeners) el.removeEventListener(type, fn);
  domListeners.length = 0;
}

const persistentHandlers = [];
function trackMap(type, layerOrFn, fn) {
  if (fn) map.on(type, layerOrFn, fn);
  else map.on(type, layerOrFn);
  persistentHandlers.push([type, layerOrFn, fn]);
}

const featureHandlers = [];
function trackFeature(type, layerOrFn, fn) {
  map.on(type, layerOrFn, fn);
  featureHandlers.push([type, layerOrFn, fn]);
}

function countByMap(features, getKey) {
  const m = new Map();
  for (const f of features) {
    const k = getKey(f.properties || {});
    if (k === undefined || k === null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function sumCounts(m) {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

function toggleInSet(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function setMatch(set, order, value) {
  if (set.size === 0) return false;
  if (set.size >= order.length) return true;
  return set.has(value);
}

function matches(ft, skip) {
  const p = ft.properties;
  if (!p) return false;
  if (skip !== "jenis" && !setMatch(activeJenis, JENIS_ORDER, p.jenis)) return false;
  if (skip !== "uptd" && !setMatch(activeUPTD, UPTD_ORDER, p.uptd)) return false;
  if (skip !== "kelas" && !setMatch(activeKelas, KELAS_ORDER, p.kelas_jalan)) return false;
  if (skip !== "kabkota" && activeKabkota.size > 0 && activeKabkota.size < allKabkota.length && !activeKabkota.has(p.kabkota)) return false;
  return true;
}

function buildFilter() {
  const conds = [];
  if (activeJenis.size === 0) conds.push(["==", ["get", "jenis"], "__none__"]);
  else if (activeJenis.size < JENIS_ORDER.length) conds.push(["in", ["get", "jenis"], ["literal", Array.from(activeJenis)]]);

  if (activeUPTD.size === 0) conds.push(["==", ["get", "uptd"], "__none__"]);
  else if (activeUPTD.size < UPTD_ORDER.length) conds.push(["in", ["get", "uptd"], ["literal", Array.from(activeUPTD)]]);

  if (activeKelas.size === 0) conds.push(["==", ["get", "kelas_jalan"], "__none__"]);
  else if (activeKelas.size < KELAS_ORDER.length) conds.push(["in", ["get", "kelas_jalan"], ["literal", Array.from(activeKelas)]]);

  if (activeKabkota.size > 0 && activeKabkota.size < allKabkota.length) conds.push(["in", ["get", "kabkota"], ["literal", Array.from(activeKabkota)]]);

  return conds.length ? ["all", ...conds] : null;
}

function applyFilters() {
  if (!map) return;
  const f = buildFilter();
  for (const id of ["pengawasan-points", "pengawasan-hitbox"]) {
    if (map.getLayer(id)) map.setFilter(id, f);
  }
  updateStats();
  renderBars();
  renderChips();
}

function applyLayerVisibility() {
  if (!map) return;
  const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
  vis("pengawasan-points", layerVis.pengawasan);
  vis("pengawasan-hitbox", layerVis.pengawasan);

  const ruasOn = ruasShown && ruasUPTD.size > 0;
  const ruasFilter = ruasUPTD.size < UPTD_ORDER.length
    ? ["in", ["get", "unit_kerja_kode"], ["literal", Array.from(ruasUPTD)]]
    : null;
  for (const id of ["ruas-casing", "ruas-line", "ruas-hit"]) {
    vis(id, ruasOn);
    if (ruasOn && map.getLayer(id)) map.setFilter(id, ruasFilter);
  }
}

// Label the hero by what the points actually are. The dataset is road signs,
// so naming them "Titik Pengawasan" reads wrong: when every jenis is a rambu
// (or a single jenis is present) say so instead of a generic "titik".
function heroNoun(features) {
  const keys = new Set(features.map((f) => f.properties?.jenis).filter(Boolean));
  if (keys.size === 1) return JENIS_LABELS[[...keys][0]] || "Titik Pengawasan";
  if (keys.size > 0 && [...keys].every((k) => String(k).startsWith("rambu"))) return "Rambu Jalan";
  return "Titik Pengawasan";
}

function updateStats() {
  if (!pengawasanGeoJSON) return;
  const all = pengawasanGeoJSON.features;
  const shown = all.filter((f) => matches(f, null));
  const noun = heroNoun(all);
  if (heroLabel) heroLabel.textContent = `Total ${noun}`;
  if (heroUnit) heroUnit.textContent = noun.startsWith("Rambu") ? "rambu" : "titik";
  if (heroTotal) heroTotal.textContent = shown.length.toLocaleString();
  if (heroDenom) heroDenom.textContent = all.length.toLocaleString();
  if (badgeEl) badgeEl.textContent = shown.length.toLocaleString();
  if (kpiRuas) kpiRuas.textContent = countByMap(shown, (p) => p.kode_ruas).size.toLocaleString();
  if (kpiUptd) kpiUptd.textContent = countByMap(shown, (p) => p.uptd).size.toLocaleString();
  if (kpiKab) kpiKab.textContent = countByMap(shown, (p) => p.kabkota).size.toLocaleString();
  if (exportCountEl) exportCountEl.textContent = shown.length.toLocaleString();
}

function barHTML({ value, label, color, n, total, on, group }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `<button type="button" class="pw-bar${on ? " on" : ""}" data-group="${escHtml(group)}" data-value="${escHtml(value)}" aria-pressed="${on}">
    <div class="bar-head">
      <span class="bar-label"><span class="bar-dot" style="background:${color}"></span>${escHtml(label)}</span>
      <span class="bar-count">${n.toLocaleString()}<em>${pct}%</em></span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
  </button>`;
}

// A bar group counts against everything EXCEPT its own dimension, so a
// partly-filtered group stays readable and its bars stay re-selectable.
function renderFixedBars(el, order, getKey, activeSet, group, colorFn, labelFn) {
  if (!el || !pengawasanGeoJSON) return;
  const feats = pengawasanGeoJSON.features.filter((f) => matches(f, group));
  const counts = countByMap(feats, getKey);
  const total = sumCounts(counts);
  el.innerHTML = order.map((k) => barHTML({
    value: k, label: labelFn(k), color: colorFn(k), n: counts.get(k) || 0, total,
    on: activeSet.has(k), group,
  })).join("");
}

function renderBars() {
  if (!pengawasanGeoJSON) return;
  renderFixedBars(barsJenis, JENIS_ORDER, (p) => p.jenis, activeJenis, "jenis",
    (k) => JENIS_COLORS[k] || UPTD_DEFAULT, (k) => JENIS_LABELS[k] || k);
  renderFixedBars(barsUptd, UPTD_ORDER, (p) => p.uptd, activeUPTD, "uptd",
    (k) => UPTD_COLORS[k] || UPTD_DEFAULT, (k) => UPTD_LABEL[k] || k);

  if (barsKab) {
    const feats = pengawasanGeoJSON.features.filter((f) => matches(f, "kabkota"));
    const counts = countByMap(feats, (p) => p.kabkota);
    const total = sumCounts(counts);
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    barsKab.innerHTML = entries.map(([k, n]) => barHTML({
      value: k, label: kabkotaLabel(k), color: "#60A5FA", n, total,
      on: activeKabkota.has(k), group: "kabkota",
    })).join("") || `<div class="pw-empty">Tidak ada data</div>`;
    if (kabCountEl) kabCountEl.textContent = `${entries.length} kab/kota`;
  }
}

function renderChips() {
  for (const def of config.filterChips) {
    const el = chipEls[def.key];
    if (!el) continue;
    const isJenis = def.key === "jenis";
    const options = isJenis
      ? JENIS.map((j) => [j.key, j.label])
      : KELAS_ORDER.map((k) => [k, `Kelas ${k}`]);
    const sel = isJenis ? activeJenis : activeKelas;
    el.innerHTML = options.map(([val, label]) => {
      const on = sel.has(val);
      return `<button type="button" class="chip-btn${on ? " active" : ""}" data-chip="${escHtml(def.key)}" data-value="${escHtml(val)}" aria-pressed="${on}">${escHtml(label)}</button>`;
    }).join("");
  }
}

function renderLayerRows() {
  if (!layerRows) return;
  const row = (group, value, label, color, on) => `<button type="button" class="pw-layer-row${on ? " on" : ""}" data-layer-group="${group}" data-layer-value="${escHtml(value)}" aria-pressed="${on}">
    <span class="pw-layer-swatch" style="background:${color}"></span>
    <span class="pw-layer-label">${escHtml(label)}</span>
    <span class="pw-layer-state">${on ? "On" : "Off"}</span>
  </button>`;
  const dot = (label, color) => `<div class="pw-layer-row is-key">
    <span class="pw-layer-swatch is-dot" style="background:${color}"></span>
    <span class="pw-layer-label">${escHtml(label)}</span>
  </div>`;

  layerRows.innerHTML = `
    <div class="pw-layer-group">Titik Pengawasan</div>
    ${row("pengawasan", "pengawasan", "Titik Pengawasan", "#94A3B8", layerVis.pengawasan)}
    ${JENIS.map((j) => dot(j.label, j.color)).join("")}
    <div class="pw-layer-group">Jalan Provinsi (Referensi)</div>
    ${row("ruas", "__master__", "Semua Ruas", UPTD_DEFAULT, ruasShown)}
    ${UPTD_ORDER.map((u) => row("ruas", u, UPTD_LABEL[u] || u, UPTD_COLORS[u] || UPTD_DEFAULT, ruasUPTD.has(u))).join("")}
  `;
}

function toggleLayer(group, value) {
  if (group === "pengawasan") layerVis.pengawasan = !layerVis.pengawasan;
  else if (group === "ruas") {
    if (value === "__master__") {
      ruasShown = !ruasShown;
      if (ruasShown && ruasUPTD.size === 0) ruasUPTD = new Set(UPTD_ORDER);
    } else {
      toggleInSet(ruasUPTD, value);
      ruasShown = ruasUPTD.size > 0;
    }
  }
  renderLayerRows();
  applyLayerVisibility();
}

function resetFilters() {
  activeJenis = new Set(JENIS_ORDER);
  activeKelas = new Set(KELAS_ORDER);
  activeUPTD = new Set(UPTD_ORDER);
  activeKabkota = new Set(allKabkota);
  applyFilters();
}

function layerDefs(sourceId) {
  return config.layers.filter((l) => l.source === sourceId);
}

function setSource(id, data, forceReadd, layerIds) {
  if (!forceReadd && map.getSource(id)) {
    map.getSource(id).setData(data);
    return;
  }
  for (const lid of layerIds) if (map.getLayer(lid)) map.removeLayer(lid);
  if (map.getSource(id)) map.removeSource(id);
  map.addSource(id, { type: "geojson", data });
  for (const def of layerDefs(id)) map.addLayer(def);
}

function addDataLayers(forceReadd = false) {
  if (!map) return;
  ensureIcons();
  if (ruasGeoJSON) setSource("ruas", ruasGeoJSON, forceReadd, ["ruas-casing", "ruas-line", "ruas-hit"]);
  if (pengawasanGeoJSON) setSource("pengawasan", pengawasanGeoJSON, forceReadd, ["pengawasan-hitbox", "pengawasan-points"]);
  wireFeatureHandlers();
  applyFilters();
  applyLayerVisibility();
}

function wireFeatureHandlers() {
  for (const [type, layerOrFn, fn] of featureHandlers) map.off(type, layerOrFn, fn);
  featureHandlers.length = 0;

  trackFeature("click", "ruas-hit", (e) => {
    if (!e.features?.length) return;
    const p = e.features[0].properties;
    const color = UPTD_COLORS[p.unit_kerja_kode] || UPTD_DEFAULT;
    showPopup(map, e.lngLat, `<div>
      <b style="font-size:14px;color:${color};">Ruas Jalan Provinsi</b><br/><br/>
      <b>Nama:</b> ${escHtml(p.nama || "N/A")}<br/>
      <b>Kode:</b> ${escHtml(p.kode_number || "N/A")}<br/>
      <b>Kelas:</b> ${escHtml(p.kelas_jalan || "N/A")}<br/>
      <b>UPTD:</b> <span style="color:${color};font-weight:700;">${escHtml(UPTD_LABEL[p.unit_kerja_kode] || p.unit_kerja_kode || "N/A")}</span><br/>
      <b>Kab/Kota:</b> ${escHtml(kabkotaLabel(p.kode))}<br/>
      <b>Panjang:</b> ${escHtml(p.panjang_km ?? "N/A")} km
    </div>`);
  });
  trackFeature("click", "pengawasan-hitbox", (e) => {
    if (!e.features?.length) return;
    showPopup(map, e.lngLat, config.popup(e.features[0]), { maxWidth: "340px" });
  });
  trackFeature("mouseenter", "pengawasan-hitbox", () => { map.getCanvas().style.cursor = "pointer"; });
  trackFeature("mouseleave", "pengawasan-hitbox", () => { map.getCanvas().style.cursor = ""; });
  trackFeature("mouseenter", "ruas-hit", () => { map.getCanvas().style.cursor = "pointer"; });
  trackFeature("mouseleave", "ruas-hit", () => { map.getCanvas().style.cursor = ""; });
}

function reAddLayers() {
  addDataLayers(true);
}

function finishLoad() {
  allKabkota = [...countByMap(pengawasanGeoJSON?.features || [], (p) => p.kabkota).keys()];
  activeKabkota = new Set(allKabkota);
  addDataLayers();
  renderLayerRows();
  renderChips();
  updateStats();
}

async function loadParquetData(ctx) {
  ctx?.ui?.Loading?.mini?.("Memuat data pengawasan…");
  await initParquet();

  const [pengawasan, ruas] = await Promise.allSettled([
    loadParquetToGeoJSON(new URL("data/pengawasan.parquet", import.meta.url)),
    loadParquetToGeoJSON(new URL("data/ruas_jalan.parquet", import.meta.url)),
  ]);
  if (pengawasan.status === "fulfilled") pengawasanGeoJSON = pengawasan.value;
  else console.error("Failed to load pengawasan:", pengawasan.reason);
  if (ruas.status === "fulfilled") ruasGeoJSON = ruas.value;
  else console.error("Failed to load ruas:", ruas.reason);

  if (pengawasanGeoJSON && ruasGeoJSON) enrichPengawasan(pengawasanGeoJSON, ruasGeoJSON);

  finishLoad();
  ctx?.ui?.Loading?.hideMini?.();

  if (pengawasanGeoJSON && ruasGeoJSON) {
    fileDrop?.classList.add("loaded");
    if (fileStatus) {
      fileStatus.className = "status ok";
      fileStatus.textContent = `Auto-loaded ${pengawasanGeoJSON.features.length} titik, ${ruasGeoJSON.features.length} ruas`;
    }
  }

  fitBounds();
  registerPwSearch();
}

function focusCoord(lng, lat, title, subtitle) {
  if (!map) return;
  if (coordMarker) { coordMarker.remove(); coordMarker = null; }
  const el = document.createElement("div");
  el.className = "coord-marker";
  coordMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  const head = title ? escHtml(title) : `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  showPopup(map, [lng, lat], `<div><b style="font-size:13px;">${head}</b>${subtitle ? `<br/><span style="color:#94a3b8;font-size:11px;">${escHtml(subtitle)}</span>` : ""}</div>`, { maxWidth: "300px" });
}

function focusPlace(place) {
  if (!map) return;
  map.flyTo({ center: [place.lng, place.lat], zoom: 15, duration: 800, essential: true });
  focusCoord(place.lng, place.lat, place.title, place.subtitle);
}

function registerPwSearch() {
  registerSearch({
    placeholder: "Cari titik / ruas / UPTD / koordinat…",
    attribution: GEO_ATTRIBUTION,
    onQuery: async (q, { signal } = {}) => {
      const coord = parseCoordInput(q);
      if (coord) {
        return [{
          group: "Koordinat",
          title: `📍 ${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`,
          subtitle: "Tampilkan titik di peta",
          action: () => focusCoord(coord.lng, coord.lat, null, null),
        }];
      }
      const center = map ? [map.getCenter().lng, map.getCenter().lat] : null;
      const places = await geocodePlaces(q, { center, signal });
      if (signal?.aborted) return [];
      const results = [];
      for (const pl of places) {
        results.push({ group: "Lokasi", title: pl.title, subtitle: pl.subtitle, action: () => focusPlace(pl) });
      }
      if (pengawasanGeoJSON) {
        const term = q.toLowerCase();
        const found = pengawasanGeoJSON.features.filter((f) => {
          const p = f.properties || {};
          return String(p.nama_ruas || "").toLowerCase().includes(term)
            || String(p.kode_ruas || "").toLowerCase().includes(term)
            || String(p.rambu_id || "").toLowerCase().includes(term)
            || String(p.kabkota_label || "").toLowerCase().includes(term);
        }).slice(0, 10);
        for (const f of found) {
          const p = f.properties;
          const c = f.geometry?.coordinates;
          results.push({
            group: "Pengawasan",
            title: p.nama_ruas || "Titik Pengawasan",
            subtitle: `${JENIS_LABELS[p.jenis] || p.jenis || "-"} · ${p.kode_ruas || "-"} · ${UPTD_LABEL[p.uptd] || p.uptd || "-"}`,
            action: () => {
              if (!c || !map) return;
              map.flyTo({ center: c, zoom: 15, duration: 800, essential: true });
              showPopup(map, c, config.popup(f), { maxWidth: "320px" });
            },
          });
        }
      }
      return results;
    },
  });
}

function fitBounds() {
  const valid = (c) => c && isFinite(c[0]) && isFinite(c[1]) && c[0] >= 104 && c[0] <= 110 && c[1] >= -9.5 && c[1] <= -4.5;
  const coords = [];
  [pengawasanGeoJSON, ruasGeoJSON].forEach((gj) => {
    if (!gj) return;
    for (const f of gj.features) {
      if (f.geometry?.type === "Point") {
        if (valid(f.geometry.coordinates)) coords.push(f.geometry.coordinates);
      } else {
        const flat = f.geometry?.coordinates?.flat?.(2) || [];
        for (let i = 0; i + 1 < flat.length; i += 2) {
          const c = [flat[i], flat[i + 1]];
          if (valid(c)) coords.push(c);
        }
      }
    }
  });
  if (coords.length) {
    const bounds = new maplibregl.LngLatBounds();
    coords.forEach((c) => bounds.extend(c));
    flyToBounds(map, bounds, { padding: 50, minZoom: 9, maxZoom: 14, duration: 1500 });
  }
}

// ── Canvas-drawn map icons ──────────────────────────────────
// MapLibre v5 addImage() takes raw RGBA pixels, so every icon is rendered on an
// offscreen canvas (no external assets or icon fonts). The three rambu jenis are
// drawn as the actual Indonesian signs — a white disc inside a red ring with the
// sign's own pictogram — while tambang/posko are not traffic signs and use a
// white badge carrying their illustration.
// ICON_UNITS is the design grid the glyph coordinates below are written in;
// ICON_SIZE is the actual canvas resolution. Drawing at a higher resolution
// than the grid keeps the sign detail (numbers, axle pictogram) crisp once the
// icons are scaled up on the map.
const ICON_UNITS = 40;
const ICON_SIZE = 64;
const SIGN_RED = "#EF4444";
const INK = "#111827";
const OUTLINE = "#0F172A";

// MST tonnage follows the road class: kelas I carries 10 T, kelas II/III 8 T.
const MST_TON_BY_KELAS = { I: 10, II: 8, III: 8 };

const ICON_SPECS = [
  { id: "pw-kelas-I", jenis: "rambu_kelas_jalan", kelas: "I" },
  { id: "pw-kelas-II", jenis: "rambu_kelas_jalan", kelas: "II" },
  { id: "pw-kelas-III", jenis: "rambu_kelas_jalan", kelas: "III" },
  { id: "pw-mst-10", jenis: "rambu_mst", kelas: "I" },
  { id: "pw-mst-8", jenis: "rambu_mst", kelas: "II" },
  { id: "pw-jenis-rambu_kelas_jalan", jenis: "rambu_kelas_jalan", kelas: "I" },
  { id: "pw-jenis-rambu_mst", jenis: "rambu_mst", kelas: "II" },
  { id: "pw-jenis-rambu_pembatasan", jenis: "rambu_pembatasan", kelas: "" },
  { id: "pw-jenis-tambang", jenis: "tambang", kelas: "" },
  { id: "pw-jenis-posko", jenis: "posko", kelas: "" },
];

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function signBase(ctx, S) {
  const c = S / 2;
  ctx.beginPath();
  ctx.arc(c, c, S / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c, c, S / 2 - 5, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = SIGN_RED;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, S / 2 - 2.5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(15,23,42,0.55)";
  ctx.stroke();
}

function badgeBase(ctx, S) {
  const m = 3;
  roundRectPath(ctx, m, m, S - 2 * m, S - 2 * m, 9);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 5;
  ctx.stroke();
  roundRectPath(ctx, m, m, S - 2 * m, S - 2 * m, 9);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawRomanGlyph(ctx, kelas) {
  const bars = kelas === "I" ? 1 : kelas === "II" ? 2 : 3;
  const w = 3.4;
  const gap = 5.2;
  const total = bars * w + (bars - 1) * gap;
  let x = -total / 2;
  ctx.fillStyle = INK;
  for (let i = 0; i < bars; i++) {
    ctx.fillRect(x, -11, w, 22);
    x += w + gap;
  }
}

function drawMstGlyph(ctx, ton) {
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "bold 13px 'Fira Sans', system-ui, sans-serif";
  ctx.fillText(String(ton), -2, -1.5);
  ctx.font = "bold 6.5px 'Fira Sans', system-ui, sans-serif";
  ctx.fillText("T", 8.5, -6.5);

  ctx.fillRect(-1.1, 0.8, 2.2, 3.2);
  ctx.beginPath();
  ctx.moveTo(-3.3, 3.8);
  ctx.lineTo(3.3, 3.8);
  ctx.lineTo(0, 6.8);
  ctx.closePath();
  ctx.fill();

  for (const x of [-11, -8.4, 8.4, 11]) {
    roundRectPath(ctx, x - 1.2, 6.4, 2.4, 6.6, 1.1);
    ctx.fill();
  }
  roundRectPath(ctx, -11, 8.5, 22, 2.4, 1.2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 9.7, 3.9, 2.7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTruckSilhouette(ctx) {
  ctx.fillStyle = INK;
  roundRectPath(ctx, -3, -8, 16, 10.5, 0.8);
  ctx.fill();
  roundRectPath(ctx, -6.5, 1.8, 22.5, 2.2, 0.6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-13.5, 4);
  ctx.lineTo(-13.5, -0.5);
  ctx.quadraticCurveTo(-13.5, -3.6, -10.5, -3.6);
  ctx.lineTo(-3, -3.6);
  ctx.lineTo(-3, 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.moveTo(-11.6, -2.2);
  ctx.lineTo(-4.4, -2.2);
  ctx.lineTo(-4.4, 1);
  ctx.lineTo(-11.6, 1);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = INK;
  for (const x of [-9, 8.5]) {
    ctx.beginPath();
    ctx.arc(x, 4.6, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#FFFFFF";
  for (const x of [-9, 8.5]) {
    ctx.beginPath();
    ctx.arc(x, 4.6, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawProhibitSlash(ctx, S) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 6.2, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(-S, -3.5, S * 2, 7);
  ctx.fillStyle = SIGN_RED;
  ctx.fillRect(-S, -2.2, S * 2, 4.4);
  ctx.restore();
}

function drawMineGlyph(ctx) {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const topY = -4;
  const baseY = 14;
  const topL = -3;
  const topR = 0;
  const baseL = -8;
  const baseR = 5;
  const xAt = (t, l, r) => l + (r - l) * t;

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.moveTo(topL, topY);
  ctx.lineTo(topR, topY);
  ctx.lineTo(baseR, baseY);
  ctx.lineTo(baseL, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const rails = [topY, 2.5, 9, baseY];
  for (let i = 1; i < rails.length - 1; i++) {
    const t = (rails[i] - topY) / (baseY - topY);
    ctx.beginPath();
    ctx.moveTo(xAt(t, topL, baseL), rails[i]);
    ctx.lineTo(xAt(t, topR, baseR), rails[i]);
    ctx.stroke();
  }
  for (let i = 0; i < rails.length - 1; i++) {
    const t1 = (rails[i] - topY) / (baseY - topY);
    const t2 = (rails[i + 1] - topY) / (baseY - topY);
    ctx.beginPath();
    ctx.moveTo(xAt(t1, topL, baseL), rails[i]);
    ctx.lineTo(xAt(t2, topR, baseR), rails[i + 1]);
    ctx.moveTo(xAt(t1, topR, baseR), rails[i]);
    ctx.lineTo(xAt(t2, topL, baseL), rails[i + 1]);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(baseL - 2.5, baseY);
  ctx.lineTo(baseR + 2.5, baseY);
  ctx.stroke();

  ctx.save();
  ctx.translate(-4.2, -1.2);
  ctx.rotate(-0.43);
  ctx.fillStyle = "#B6BEC9";
  roundRectPath(ctx, -10.2, -1.9, 20.4, 3.8, 1.9);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(-13.2, 2.9, 1.7, 0, Math.PI * 2);
  ctx.fillStyle = "#B6BEC9";
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = 9 + Math.cos(a) * 5.2;
    const py = -7.5 + Math.sin(a) * 5.2;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#29B6F6";
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(9, -7.5, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(9, -7.5, 1.1, 0, Math.PI * 2);
  ctx.fillStyle = "#94A3B8";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(9, -2.3);
  ctx.lineTo(9, 1.4);
  ctx.stroke();

  ctx.fillStyle = "#64748B";
  roundRectPath(ctx, 6.9, 1.4, 4.2, 5.6, 1);
  ctx.fill();
  ctx.stroke();
}

function drawTentGlyph(ctx) {
  ctx.fillStyle = INK;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "round";

  const apexY = -11.5;
  const eaveY = 2.5;
  const bodyTopY = 4.1;
  const bodyBotY = 14.5;
  const bodyTopHalf = 11.5;
  const bodyBotHalf = 13.5;

  ctx.beginPath();
  ctx.moveTo(-bodyTopHalf, bodyTopY);
  ctx.lineTo(bodyTopHalf, bodyTopY);
  ctx.lineTo(bodyBotHalf, bodyBotY);
  ctx.lineTo(-bodyBotHalf, bodyBotY);
  ctx.closePath();
  ctx.fill();

  const wedges = [
    [-12.5, -8],
    [-6.5, -2],
    [2, 6.5],
    [8.5, 12.5],
  ];
  for (const [a, b] of wedges) {
    ctx.beginPath();
    ctx.moveTo(0, apexY);
    ctx.lineTo(a, eaveY);
    ctx.lineTo(b, eaveY);
    ctx.closePath();
    ctx.fill();
  }
  for (const [a, b] of wedges) {
    const r = Math.min(2.1, (b - a) / 2);
    ctx.beginPath();
    ctx.arc((a + b) / 2, eaveY + 1.1, r, 0, Math.PI);
    ctx.fill();
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.moveTo(-3.2, bodyTopY + 2.6);
  ctx.lineTo(3.2, bodyTopY + 2.6);
  ctx.lineTo(4.8, bodyBotY);
  ctx.lineTo(-4.8, bodyBotY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(0.6, -15);
  ctx.lineTo(0.6, -11.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.9, -15);
  ctx.lineTo(5.4, -13.6);
  ctx.lineTo(0.9, -12.2);
  ctx.closePath();
  ctx.fill();
}

function drawGlyph(ctx, jenis, kelas) {
  if (jenis === "rambu_kelas_jalan") drawRomanGlyph(ctx, kelas);
  else if (jenis === "rambu_mst") drawMstGlyph(ctx, MST_TON_BY_KELAS[kelas] ?? 8);
  else if (jenis === "rambu_pembatasan") drawTruckSilhouette(ctx);
  else if (jenis === "tambang") drawMineGlyph(ctx);
  else drawTentGlyph(ctx);
}

function newIconCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.lineJoin = "round";
  return { canvas, ctx };
}

function toIconImage(ctx) {
  return {
    width: ICON_SIZE,
    height: ICON_SIZE,
    data: new Uint8Array(ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data),
  };
}

const SIGN_JENIS = new Set(["rambu_kelas_jalan", "rambu_mst", "rambu_pembatasan"]);

function buildJenisIcon(jenis, kelas) {
  const { ctx } = newIconCanvas();
  const S = ICON_UNITS;
  const k = ICON_SIZE / ICON_UNITS;
  ctx.scale(k, k);
  if (SIGN_JENIS.has(jenis)) signBase(ctx, S);
  else badgeBase(ctx, S);
  ctx.save();
  ctx.translate(S / 2, S / 2);
  drawGlyph(ctx, jenis, kelas);
  ctx.restore();
  if (jenis === "rambu_pembatasan") drawProhibitSlash(ctx, S);
  return toIconImage(ctx);
}

function buildIconById(id) {
  const spec = ICON_SPECS.find((s) => s.id === id);
  return spec ? buildJenisIcon(spec.jenis, spec.kelas) : null;
}

// isStyleLoaded() stays false while sources stream in (e.g. mid globe
// re-entry), yet addImage already works — so register every icon and let
// the styleimagemissing handler cover the rare case the style truly isn't
// ready, rather than skipping icons and leaving unused ones unregistered.
function ensureIcons() {
  if (!map) return;
  for (const spec of ICON_SPECS) {
    try {
      if (!map.hasImage(spec.id)) map.addImage(spec.id, buildJenisIcon(spec.jenis, spec.kelas));
    } catch (e) {}
  }
}

async function handleFiles(files) {
  const fileArr = Array.from(files);
  const pengawasanFile = fileArr.find((f) => f.name.includes("pengawasan"));
  const ruasFile = fileArr.find((f) => f.name.includes("ruas") || f.name.includes("jalan"));
  if (!pengawasanFile && !ruasFile) {
    if (fileStatus) { fileStatus.className = "status err"; fileStatus.textContent = "Butuh file pengawasan / ruas .parquet"; }
    return;
  }
  try {
    if (pengawasanFile) pengawasanGeoJSON = await loadParquetToGeoJSON(pengawasanFile);
    if (ruasFile) ruasGeoJSON = await loadParquetToGeoJSON(ruasFile);
    if (pengawasanGeoJSON && ruasGeoJSON) enrichPengawasan(pengawasanGeoJSON, ruasGeoJSON);
    finishLoad();
    fileDrop?.classList.add("loaded");
    if (fileStatus) { fileStatus.className = "status ok"; fileStatus.textContent = "Data dimuat"; }
    fitBounds();
  } catch (err) {
    console.error("handleFiles error:", err);
    if (fileStatus) { fileStatus.className = "status err"; fileStatus.textContent = `Error: ${err.message}`; }
  }
}

function section(id, title, open, body, extra = "") {
  return `<section class="panel-section${open ? " open" : ""}" data-section="${id}">
    <div class="section-header" data-collapse="${id}" role="button" tabindex="0" aria-expanded="${open}">
      <span class="section-chevron" aria-hidden="true">${CHEVRON}</span>
      <h2 class="section-title">${escHtml(title)}</h2>
      ${extra}
    </div>
    <div class="section-content">${body}</div>
  </section>`;
}

function createDOM() {
  panel = document.createElement("div");
  panel.id = "panel";
  panel.className = "pw-panel";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Panel informasi Pengawasan Angkutan Barang");
  panel.innerHTML = `
    <div id="sheet-handle" aria-hidden="true"></div>
    <div id="panel-header">
      <span class="panel-icon" aria-hidden="true">${config.icon}</span>
      <h1 class="panel-title">Pengawasan Angkutan Barang</h1>
      <span class="badge" id="pw-badge" aria-label="Jumlah titik terfilter">0</span>
      <button id="panel-toggle" class="panel-toggle-btn" title="Minimalkan panel" aria-label="Minimalkan panel" aria-expanded="true" aria-controls="panel-body">${TOGGLE_CHEVRON}</button>
    </div>
    <div id="panel-body" role="region" aria-label="Informasi data pengawasan angkutan barang">
      ${section("stats", "Statistik", true, `
        <div class="stats-hero">
          <div class="stats-hero-label" id="pw-hero-label">Total Titik Pengawasan</div>
          <div class="stats-hero-value" id="pw-total">0</div>
          <div class="pw-hero-sub">dari <strong id="pw-denom">0</strong> <span id="pw-hero-unit">titik</span></div>
        </div>
        <div class="stats-kpi pw-kpi-3">
          <div class="kpi-chip"><span class="kpi-label">Ruas</span><span class="kpi-value" id="pw-kpi-ruas">0</span></div>
          <div class="kpi-chip"><span class="kpi-label">UPTD</span><span class="kpi-value" id="pw-kpi-uptd">0</span></div>
          <div class="kpi-chip"><span class="kpi-label">Kab/Kota</span><span class="kpi-value" id="pw-kpi-kab">0</span></div>
        </div>
        <div class="stats-bars">
          <div class="pw-bars-title">Per Jenis Pengawasan</div>
          <div class="pw-bars" id="pw-bars-jenis"></div>
        </div>
        <div class="stats-bars">
          <div class="pw-bars-title">Per UPTD</div>
          <div class="pw-bars" id="pw-bars-uptd"></div>
        </div>
        <button type="button" id="pw-export" class="pw-export">⬇ Unduh XLSX (<span id="pw-export-count">0</span>)</button>
      `)}
      ${section("wilayah", "Sebaran Wilayah", false, `
        <div class="pw-bars-head"><span>Per Kota / Kabupaten</span><span class="pw-muted" id="pw-kab-count"></span></div>
        <div class="pw-bars" id="pw-bars-kab"></div>
      `)}
      ${section("filter", "Filter", false, `
        <div class="filter-grid">
          ${config.filterChips.map((f) => `<div class="filter-field"><span class="filter-label">${escHtml(f.label)}</span><div class="chips" id="pw-chip-${escHtml(f.key)}"></div></div>`).join("")}
        </div>
        <button type="button" id="pw-reset" class="pw-reset">Atur ulang semua filter</button>
      `)}
      ${section("layers", "Tampilkan Lapisan", true, `
        <div class="pw-layers" id="pw-layers"></div>
      `)}
      ${section("file", "Data File", false, `
        <div id="file-drop">
          <p>Drag &amp; drop <strong>pengawasan.parquet</strong> + <strong>ruas_jalan.parquet</strong></p>
          <p class="pw-drop-hint">atau klik untuk pilih file</p>
          <input type="file" id="file-input" multiple accept=".parquet" style="display:none;" />
          <div class="status" id="file-status"></div>
        </div>
      `)}
    </div>
  `;
  document.body.appendChild(panel);

  panelHeader = panel.querySelector("#panel-header");
  panelBody = panel.querySelector("#panel-body");
  panelToggle = panel.querySelector("#panel-toggle");
  sheetHandle = panel.querySelector("#sheet-handle");
  badgeEl = panel.querySelector("#pw-badge");
  heroTotal = panel.querySelector("#pw-total");
  heroDenom = panel.querySelector("#pw-denom");
  heroLabel = panel.querySelector("#pw-hero-label");
  heroUnit = panel.querySelector("#pw-hero-unit");
  kpiRuas = panel.querySelector("#pw-kpi-ruas");
  kpiUptd = panel.querySelector("#pw-kpi-uptd");
  kpiKab = panel.querySelector("#pw-kpi-kab");
  barsJenis = panel.querySelector("#pw-bars-jenis");
  barsUptd = panel.querySelector("#pw-bars-uptd");
  barsKab = panel.querySelector("#pw-bars-kab");
  kabCountEl = panel.querySelector("#pw-kab-count");
  layerRows = panel.querySelector("#pw-layers");
  chipEls = {};
  for (const f of config.filterChips) chipEls[f.key] = panel.querySelector(`#pw-chip-${f.key}`);
  fileDrop = panel.querySelector("#file-drop");
  fileInput = panel.querySelector("#file-input");
  fileStatus = panel.querySelector("#file-status");
  exportCountEl = panel.querySelector("#pw-export-count");
}

function removeDOM() {
  if (panel?.parentNode) panel.parentNode.removeChild(panel);
  panel = panelHeader = panelBody = panelToggle = sheetHandle = null;
  badgeEl = heroTotal = heroDenom = heroLabel = heroUnit = kpiRuas = kpiUptd = kpiKab = null;
  barsJenis = barsUptd = barsKab = kabCountEl = null;
  chipEls = {};
  layerRows = null;
  fileDrop = fileInput = fileStatus = null;
  exportCountEl = null;
}

function wireSections() {
  panel.querySelectorAll(".panel-section").forEach((sec) => {
    const header = sec.querySelector(".section-header[data-collapse]");
    const target = sec.querySelector(".section-content");
    if (!header || !target) return;
    const setOpen = (open) => {
      sec.classList.toggle("open", open);
      header.setAttribute("aria-expanded", String(open));
      target.style.display = open ? "" : "none";
    };
    setOpen(sec.classList.contains("open"));
    const toggle = () => setOpen(!sec.classList.contains("open"));
    track(header, "click", toggle);
    track(header, "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}

async function runExport() {
  if (!pengawasanGeoJSON) return;
  const ok = await ensureXLSX();
  if (!ok) return;
  const filtered = pengawasanGeoJSON.features.filter((f) => matches(f, null));
  exportFeaturesToXLSX(filtered, { prefix: "pengawasan", sheetName: "Pengawasan Terfilter" });
}

function setupPanelEvents() {
  track(panelBody, "click", (e) => {
    const bar = e.target.closest(".pw-bar");
    if (bar) {
      const g = bar.dataset.group;
      if (g === "jenis") toggleInSet(activeJenis, bar.dataset.value);
      else if (g === "uptd") toggleInSet(activeUPTD, bar.dataset.value);
      else if (g === "kabkota") toggleInSet(activeKabkota, bar.dataset.value);
      applyFilters();
      return;
    }
    const chip = e.target.closest(".chip-btn");
    if (chip) {
      toggleInSet(chip.dataset.chip === "jenis" ? activeJenis : activeKelas, chip.dataset.value);
      applyFilters();
      return;
    }
    const layerRow = e.target.closest(".pw-layer-row[data-layer-group]");
    if (layerRow) {
      toggleLayer(layerRow.dataset.layerGroup, layerRow.dataset.layerValue);
      return;
    }
    if (e.target.closest("#pw-reset")) { resetFilters(); return; }
    if (e.target.closest("#pw-export")) { runExport(); return; }
  });
}

function setupDragDrop() {
  track(fileDrop, "click", (e) => { e.stopPropagation(); fileInput.click(); });
  track(fileInput, "change", async (e) => { if (e.target.files.length) await handleFiles(e.target.files); });
  track(document.body, "dragenter", (e) => { e.preventDefault(); dragCounter++; });
  track(document.body, "dragover", (e) => { e.preventDefault(); });
  track(document.body, "dragleave", () => { dragCounter = Math.max(0, dragCounter - 1); });
  track(document.body, "drop", async (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files);
  });
}

export const module = {
  async init(ctx) {
    map = ctx.map;
    createDOM();
    wireSections();
    setupPanelEvents();
    setupDragDrop();
    sheetTeardown = initBottomSheet({ panel, handle: sheetHandle, toggle: panelToggle, header: panelHeader });
    renderLayerRows();

    trackMap("style.load", () => reAddLayers());
    trackMap("basemap-changed", () => reAddLayers());
    // A style swap drops every registered image; this is the safety net for
    // an icon the symbol layer asks for before the re-add runs.
    trackMap("styleimagemissing", (e) => {
      const id = e?.id;
      if (!id || !map || map.hasImage(id)) return;
      const image = buildIconById(id);
      if (image) map.addImage(id, image);
    });

    return loadParquetData(ctx);
  },

  teardown() {
    if (!map) return;

    for (const [type, layerOrFn, fn] of persistentHandlers) {
      if (fn) map.off(type, layerOrFn, fn);
      else map.off(type, layerOrFn);
    }
    persistentHandlers.length = 0;
    for (const [type, layerOrFn, fn] of featureHandlers) map.off(type, layerOrFn, fn);
    featureHandlers.length = 0;

    const ids = ["pengawasan-points", "pengawasan-hitbox", "ruas-hit", "ruas-line", "ruas-casing"];
    for (const id of ids) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of ["pengawasan", "ruas"]) if (map.getSource(id)) map.removeSource(id);
    for (const j of JENIS) {
      try { if (map.hasImage(j.icon)) map.removeImage(j.icon); } catch (e) {}
    }

    closePopup();
    if (coordMarker) { coordMarker.remove(); coordMarker = null; }

    if (sheetTeardown) { sheetTeardown(); sheetTeardown = null; }
    clearListeners();
    removeDOM();

    pengawasanGeoJSON = ruasGeoJSON = null;
    activeJenis = new Set(JENIS_ORDER);
    activeKelas = new Set(KELAS_ORDER);
    activeUPTD = new Set(UPTD_ORDER);
    activeKabkota = new Set();
    allKabkota = [];
    layerVis = { pengawasan: true };
    ruasShown = true;
    ruasUPTD = new Set(UPTD_ORDER);
    dragCounter = 0;
    map = null;
  },
};
