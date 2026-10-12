import { initParquet, loadParquetToGeoJSON } from "../../shared-core/js/parquet-loader.js";
import { flyToBounds, showPopup, closePopup } from "../../shared-core/js/map-core.js";
import { escHtml, toast, initBottomSheet } from "../../shared-core/js/ui-core.js";
import config, {
  KELAS_COLORS, KELAS_ORDER,
  UPTD_COLORS, UPTD_ORDER, UPTD_DEFAULT, UPTD_LABEL,
  enrichRambu, kabkotaLabel,
} from "./config.js";

export { config };

const CHEVRON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>`;
const TOGGLE_CHEVRON = `<svg viewBox="0 0 512 512" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 81.4 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg>`;

let map = null;
let jaringanGeoJSON = null;
let rambuGeoJSON = null;
let ruasGeoJSON = null;

let activeKelas = new Set(KELAS_ORDER);
let activeUPTD = new Set(UPTD_ORDER);
let activeKabkota = new Set();
let allKabkota = [];
let activeRuas = new Set();
let chipSel = { fungsi: new Set(), bers_arteri: new Set(), bers_kolektor: new Set() };
let jarakEnabled = false, jarakMax = 0;
let panjangEnabled = false, panjangMin = 0;
let jarakBounds = { min: 0, max: 0 };
let panjangBounds = { min: 0, max: 0 };

// Layer visibility is a SEPARATE concern from data filtering: hiding a layer
// must never change the panel's statistics, only what is drawn.
let layerVis = { arteri: true, kolektor: true, rambu: true };
let ruasShown = true;
let ruasUPTD = new Set(UPTD_ORDER);
let ruasQuery = "";
let ruasNameByKode = new Map();
let dragCounter = 0;

let panel, panelHeader, panelBody, panelToggle, sheetHandle;
let fileDrop, fileInput, fileStatus;
let heroTotal, heroDenom, kpiRuas, kpiUptd, kpiKab, badgeEl;
let barsKelas, barsUptd, barsKab, kabCountEl;
let ruasList, ruasSearch, ruasCount, ruasRowsEl;
let chipEls = {};
let jarakSlider, jarakVal, jarakToggle, panjangSlider, panjangVal, panjangToggle;
let layerRows;
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

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

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
  if (skip !== "kelas" && !setMatch(activeKelas, KELAS_ORDER, p.kelas_jalan)) return false;
  if (skip !== "uptd" && !setMatch(activeUPTD, UPTD_ORDER, p.uptd)) return false;
  if (skip !== "kabkota" && activeKabkota.size > 0 && activeKabkota.size < allKabkota.length && !activeKabkota.has(p.kabkota)) return false;
  if (skip !== "ruas" && activeRuas.size > 0 && !activeRuas.has(String(p.kode_ruas))) return false;

  const fn = chipSel.fungsi;
  if (fn.size > 0 && !fn.has(p.fungsi)) return false;
  if (chipSel.bers_arteri.size > 0 && chipSel.bers_arteri.size < 2 && !chipSel.bers_arteri.has(String(p.bers_arteri))) return false;
  if (chipSel.bers_kolektor.size > 0 && chipSel.bers_kolektor.size < 2 && !chipSel.bers_kolektor.has(String(p.bers_kolektor))) return false;

  if (jarakEnabled && (num(p.jarak_jaringan_m) === null || p.jarak_jaringan_m > jarakMax)) return false;
  if (panjangEnabled && (num(p.panjang_km) === null || p.panjang_km < panjangMin)) return false;
  return true;
}

function buildFilter() {
  const conds = [];
  if (activeKelas.size === 0) conds.push(["==", ["get", "kelas_jalan"], "__none__"]);
  else if (activeKelas.size < KELAS_ORDER.length) conds.push(["in", ["get", "kelas_jalan"], ["literal", Array.from(activeKelas)]]);

  if (activeUPTD.size === 0) conds.push(["==", ["get", "uptd"], "__none__"]);
  else if (activeUPTD.size < UPTD_ORDER.length) conds.push(["in", ["get", "uptd"], ["literal", Array.from(activeUPTD)]]);

  if (activeKabkota.size > 0 && activeKabkota.size < allKabkota.length) conds.push(["in", ["get", "kabkota"], ["literal", Array.from(activeKabkota)]]);
  if (activeRuas.size > 0) conds.push(["in", ["get", "kode_ruas"], ["literal", Array.from(activeRuas)]]);

  const fn = Array.from(chipSel.fungsi);
  if (fn.length > 0) conds.push(["in", ["get", "fungsi"], ["literal", fn]]);

  const ba = Array.from(chipSel.bers_arteri);
  if (ba.length > 0 && ba.length < 2) conds.push(["==", ["get", "bers_arteri"], ba[0] === "true"]);
  const bk = Array.from(chipSel.bers_kolektor);
  if (bk.length > 0 && bk.length < 2) conds.push(["==", ["get", "bers_kolektor"], bk[0] === "true"]);

  if (jarakEnabled) conds.push(["<=", ["coalesce", ["get", "jarak_jaringan_m"], 1e9], jarakMax]);
  if (panjangEnabled) conds.push([">=", ["coalesce", ["get", "panjang_km"], -1], panjangMin]);

  return conds.length ? ["all", ...conds] : null;
}

function applyFilters() {
  if (!map) return;
  const f = buildFilter();
  for (const id of ["rambu-points", "rambu-hitbox"]) {
    if (map.getLayer(id)) map.setFilter(id, f);
  }
  updateStats();
  renderBars();
  renderRuasList();
  renderChips();
}

function applyLayerVisibility() {
  if (!map) return;
  const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
  vis("arteri-line", layerVis.arteri);
  vis("kolektor-line", layerVis.kolektor);
  vis("rambu-points", layerVis.rambu);
  vis("rambu-hitbox", layerVis.rambu);

  const ruasOn = ruasShown && ruasUPTD.size > 0;
  vis("ruas-line", ruasOn);
  if (ruasOn && map.getLayer("ruas-line")) {
    map.setFilter("ruas-line", ruasUPTD.size < UPTD_ORDER.length
      ? ["in", ["get", "unit_kerja_kode"], ["literal", Array.from(ruasUPTD)]]
      : null);
  }
}

function updateStats() {
  if (!rambuGeoJSON) return;
  const all = rambuGeoJSON.features;
  const shown = all.filter((f) => matches(f, null));
  if (heroTotal) heroTotal.textContent = shown.length.toLocaleString();
  if (heroDenom) heroDenom.textContent = all.length.toLocaleString();
  if (badgeEl) badgeEl.textContent = shown.length.toLocaleString();
  if (kpiRuas) kpiRuas.textContent = countByMap(shown, (p) => p.kode_ruas).size.toLocaleString();
  if (kpiUptd) kpiUptd.textContent = countByMap(shown, (p) => p.uptd).size.toLocaleString();
  if (kpiKab) kpiKab.textContent = countByMap(shown, (p) => p.kabkota).size.toLocaleString();
}

function barHTML({ value, label, color, n, total, on, group }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `<button type="button" class="rmb-bar${on ? " on" : ""}" data-group="${escHtml(group)}" data-value="${escHtml(value)}" aria-pressed="${on}">
    <div class="bar-head">
      <span class="bar-label"><span class="bar-dot" style="background:${color}"></span>${escHtml(label)}</span>
      <span class="bar-count">${n.toLocaleString()}<em>${pct}%</em></span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
  </button>`;
}

// Fixed dimensions count against the set filtered by everything EXCEPT that
// dimension, so a partly-filtered bar group stays readable and re-selectable.
function renderFixedBars(el, order, getKey, activeSet, group, colorFn, labelFn) {
  if (!el || !rambuGeoJSON) return;
  const feats = rambuGeoJSON.features.filter((f) => matches(f, group));
  const counts = countByMap(feats, getKey);
  const total = sumCounts(counts);
  el.innerHTML = order.map((k) => barHTML({
    value: k, label: labelFn(k), color: colorFn(k), n: counts.get(k) || 0, total,
    on: activeSet.has(k), group,
  })).join("");
}

function renderBars() {
  if (!rambuGeoJSON) return;
  renderFixedBars(barsKelas, KELAS_ORDER, (p) => p.kelas_jalan, activeKelas, "kelas",
    (k) => KELAS_COLORS[k], (k) => `Kelas ${k}`);
  renderFixedBars(barsUptd, UPTD_ORDER, (p) => p.uptd, activeUPTD, "uptd",
    (k) => UPTD_COLORS[k] || UPTD_DEFAULT, (k) => UPTD_LABEL[k] || k);

  if (barsKab) {
    const feats = rambuGeoJSON.features.filter((f) => matches(f, "kabkota"));
    const counts = countByMap(feats, (p) => p.kabkota);
    const total = sumCounts(counts);
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    barsKab.innerHTML = entries.map(([k, n]) => barHTML({
      value: k, label: kabkotaLabel(k), color: "#60A5FA", n, total,
      on: activeKabkota.has(k), group: "kabkota",
    })).join("") || `<div class="rmb-empty">Tidak ada data</div>`;
    if (kabCountEl) kabCountEl.textContent = `${entries.length} kab/kota`;
  }
}

function renderRuasList() {
  if (!ruasList || !rambuGeoJSON) return;
  const feats = rambuGeoJSON.features.filter((f) => matches(f, "ruas"));
  const counts = countByMap(feats, (p) => p.kode_ruas);
  const total = sumCounts(counts);
  const q = ruasQuery.trim().toLowerCase();
  let entries = [...counts.entries()].map(([kode, n]) => ({
    kode, n, nama: ruasNameByKode.get(kode) || kode,
  }));
  if (q) entries = entries.filter((e) => e.kode.toLowerCase().includes(q) || e.nama.toLowerCase().includes(q));
  entries.sort((a, b) => b.n - a.n || a.nama.localeCompare(b.nama));
  const limited = entries.slice(0, q ? 40 : 12);
  ruasList.innerHTML = limited.map((e) => {
    const on = activeRuas.has(e.kode);
    const pct = total ? Math.round((e.n / total) * 100) : 0;
    return `<button type="button" class="rmb-ruas-row${on ? " on" : ""}" data-ruas="${escHtml(e.kode)}" aria-pressed="${on}">
      <span class="rmb-ruas-main">
        <span class="rmb-ruas-name">${escHtml(e.nama)}</span>
        <span class="rmb-ruas-kode">${escHtml(e.kode)}</span>
      </span>
      <span class="rmb-ruas-count">${e.n.toLocaleString()}<em>${pct}%</em></span>
    </button>`;
  }).join("") || `<div class="rmb-empty">Tidak ada ruas cocok</div>`;
  if (ruasCount) ruasCount.textContent = `${entries.length} ruas`;
}

function distinctValues(key) {
  const set = new Set();
  if (!rambuGeoJSON) return [];
  for (const f of rambuGeoJSON.features) {
    const v = f.properties?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") set.add(String(v));
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function renderChips() {
  for (const def of config.filterChips) {
    const el = chipEls[def.key];
    if (!el) continue;
    const options = def.bool ? [["true", "Ya"], ["false", "Tidak"]] : distinctValues(def.key).map((v) => [v, v]);
    const sel = chipSel[def.key];
    el.innerHTML = options.map(([val, label]) => {
      const on = sel.has(val);
      return `<button type="button" class="chip-btn${on ? " active" : ""}" data-chip="${escHtml(def.key)}" data-value="${escHtml(val)}" aria-pressed="${on}">${escHtml(label)}</button>`;
    }).join("");
  }
}

function renderLayerRows() {
  if (!layerRows) return;
  const row = (group, value, label, color, on) => `<button type="button" class="rmb-layer-row${on ? " on" : ""}" data-layer-group="${group}" data-layer-value="${escHtml(value)}" aria-pressed="${on}">
    <span class="rmb-layer-swatch" style="background:${color}"></span>
    <span class="rmb-layer-label">${escHtml(label)}</span>
    <span class="rmb-layer-state">${on ? "On" : "Off"}</span>
  </button>`;
  const dot = (label, color) => `<div class="rmb-layer-row is-key">
    <span class="rmb-layer-swatch is-dot" style="background:${color}"></span>
    <span class="rmb-layer-label">${escHtml(label)}</span>
  </div>`;

  layerRows.innerHTML = `
    <div class="rmb-layer-group">Jaringan Jalan</div>
    ${row("jaringan", "arteri", "Jaringan Arteri", "#EF4444", layerVis.arteri)}
    ${row("jaringan", "kolektor", "Jaringan Kolektor", "#F97316", layerVis.kolektor)}
    <div class="rmb-layer-group">Ruas Jalan Provinsi</div>
    ${row("ruas", "__master__", "Semua Ruas", UPTD_DEFAULT, ruasShown)}
    ${UPTD_ORDER.map((u) => row("ruas", u, UPTD_LABEL[u] || u, UPTD_COLORS[u] || UPTD_DEFAULT, ruasUPTD.has(u))).join("")}
    <div class="rmb-layer-group">Rambu</div>
    ${row("rambu", "rambu", "Titik Rambu", "#94A3B8", layerVis.rambu)}
    ${KELAS_ORDER.map((k) => dot(`Kelas ${k}`, KELAS_COLORS[k])).join("")}
  `;
}

function toggleLayer(group, value) {
  if (group === "jaringan") layerVis[value] = !layerVis[value];
  else if (group === "rambu") layerVis.rambu = !layerVis.rambu;
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

function computeBounds() {
  const ja = (rambuGeoJSON?.features || []).map((f) => f.properties?.jarak_jaringan_m).filter((v) => num(v) !== null);
  const pk = (rambuGeoJSON?.features || []).map((f) => f.properties?.panjang_km).filter((v) => num(v) !== null);
  jarakBounds = { min: 0, max: ja.length ? Math.ceil(Math.max(...ja)) : 1000 };
  panjangBounds = { min: pk.length ? Math.floor(Math.min(...pk)) : 0, max: pk.length ? Math.ceil(Math.max(...pk)) : 100 };
  jarakMax = jarakBounds.max;
  panjangMin = panjangBounds.min;
  if (jarakSlider) {
    jarakSlider.min = "0";
    jarakSlider.max = String(jarakBounds.max);
    jarakSlider.step = String(Math.max(1, Math.round(jarakBounds.max / 200)));
    jarakSlider.value = String(jarakMax);
  }
  if (panjangSlider) {
    panjangSlider.min = String(panjangBounds.min);
    panjangSlider.max = String(panjangBounds.max);
    panjangSlider.step = String(Math.max(0.1, Math.round(((panjangBounds.max - panjangBounds.min) / 200) * 10) / 10));
    panjangSlider.value = String(panjangMin);
  }
}

function renderSliderValues() {
  if (jarakVal) jarakVal.textContent = jarakEnabled ? `≤ ${Math.round(jarakMax).toLocaleString()} m` : "Semua jarak";
  if (panjangVal) panjangVal.textContent = panjangEnabled ? `≥ ${panjangMin} km` : "Semua panjang";
  if (jarakToggle) jarakToggle.checked = jarakEnabled;
  if (panjangToggle) panjangToggle.checked = panjangEnabled;
  if (jarakSlider) jarakSlider.disabled = !jarakEnabled;
  if (panjangSlider) panjangSlider.disabled = !panjangEnabled;
}

function resetFilters() {
  activeKelas = new Set(KELAS_ORDER);
  activeUPTD = new Set(UPTD_ORDER);
  activeKabkota = new Set(allKabkota);
  activeRuas = new Set();
  chipSel = { fungsi: new Set(), bers_arteri: new Set(), bers_kolektor: new Set() };
  jarakEnabled = false;
  panjangEnabled = false;
  jarakMax = jarakBounds.max;
  panjangMin = panjangBounds.min;
  ruasQuery = "";
  if (ruasSearch) ruasSearch.value = "";
  if (jarakSlider) jarakSlider.value = String(jarakMax);
  if (panjangSlider) panjangSlider.value = String(panjangMin);
  renderSliderValues();
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
  if (jaringanGeoJSON) {
    const arteri = { type: "FeatureCollection", features: [] };
    const kolektor = { type: "FeatureCollection", features: [] };
    for (const f of jaringanGeoJSON.features) {
      const jenis = String(f.properties?.jenis || f.properties?.nama_jenis || "").toLowerCase();
      (jenis.includes("kolektor") ? kolektor : arteri).features.push(f);
    }
    setSource("arteri", arteri, forceReadd, ["arteri-line"]);
    setSource("kolektor", kolektor, forceReadd, ["kolektor-line"]);
  }
  if (ruasGeoJSON) setSource("ruas", ruasGeoJSON, forceReadd, ["ruas-line"]);
  if (rambuGeoJSON) setSource("rambu", rambuGeoJSON, forceReadd, ["rambu-points", "rambu-hitbox"]);
  wireFeatureHandlers();
  applyFilters();
  applyLayerVisibility();
}

function wireFeatureHandlers() {
  for (const [type, layerOrFn, fn] of featureHandlers) map.off(type, layerOrFn, fn);
  featureHandlers.length = 0;

  trackFeature("click", "arteri-line", (e) => {
    if (!e.features?.length) return;
    const p = e.features[0].properties;
    showPopup(map, e.lngLat, `<div><b style="font-size:14px;color:#EF4444;">Jaringan Arteri</b><br/><b>Nama:</b> ${escHtml(p.nama || "N/A")}</div>`);
  });
  trackFeature("click", "kolektor-line", (e) => {
    if (!e.features?.length) return;
    const p = e.features[0].properties;
    showPopup(map, e.lngLat, `<div><b style="font-size:14px;color:#F97316;">Jaringan Kolektor</b><br/><b>Nama:</b> ${escHtml(p.nama || "N/A")}</div>`);
  });
  trackFeature("click", "ruas-line", (e) => {
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
  trackFeature("click", "rambu-hitbox", (e) => {
    if (!e.features?.length) return;
    showPopup(map, e.lngLat, config.popup(e.features[0]), { maxWidth: "340px" });
  });
  trackFeature("mouseenter", "rambu-hitbox", () => { map.getCanvas().style.cursor = "pointer"; });
  trackFeature("mouseleave", "rambu-hitbox", () => { map.getCanvas().style.cursor = ""; });
}

function reAddLayers() {
  addDataLayers(true);
}

function finishLoad() {
  computeBounds();
  allKabkota = [...countByMap(rambuGeoJSON?.features || [], (p) => p.kabkota).keys()];
  activeKabkota = new Set(allKabkota);
  ruasNameByKode = new Map();
  for (const f of ruasGeoJSON?.features || []) {
    const p = f.properties || {};
    if (p.kode_number) ruasNameByKode.set(String(p.kode_number), p.nama || String(p.kode_number));
  }
  addDataLayers();
  renderSliderValues();
  renderLayerRows();
  renderChips();
  updateStats();
}

async function loadParquetData(ctx) {
  ctx?.ui?.Loading?.mini?.("Memuat data rambu…");
  await initParquet();

  const [jaringan, rambu, ruas] = await Promise.allSettled([
    loadParquetToGeoJSON(new URL("data/jaringan_jalan.parquet", import.meta.url)),
    loadParquetToGeoJSON(new URL("data/rambu_kelas_jalan.parquet", import.meta.url)),
    loadParquetToGeoJSON(new URL("data/ruas_jalan.parquet", import.meta.url)),
  ]);
  if (jaringan.status === "fulfilled") jaringanGeoJSON = jaringan.value;
  else console.error("Failed to load jaringan:", jaringan.reason);
  if (rambu.status === "fulfilled") rambuGeoJSON = rambu.value;
  else console.error("Failed to load rambu:", rambu.reason);
  if (ruas.status === "fulfilled") ruasGeoJSON = ruas.value;
  else console.error("Failed to load ruas:", ruas.reason);

  if (rambuGeoJSON && ruasGeoJSON) enrichRambu(rambuGeoJSON, ruasGeoJSON);

  finishLoad();
  ctx?.ui?.Loading?.hideMini?.();

  if (rambuGeoJSON && ruasGeoJSON) {
    fileDrop?.classList.add("loaded");
    if (fileStatus) {
      fileStatus.className = "status ok";
      fileStatus.textContent = `Auto-loaded ${jaringanGeoJSON?.features.length || 0} jaringan, ${rambuGeoJSON.features.length} rambu, ${ruasGeoJSON.features.length} ruas`;
    }
  }

  fitBounds();
  registerRambuSearch(ctx);
}

function registerRambuSearch(ctx) {
  if (!ctx?.search?.registerSearch) return;
  ctx.search.registerSearch({
    placeholder: "Cari rambu / ruas / UPTD…",
    onQuery: async (q) => {
      if (!rambuGeoJSON) return [];
      const term = q.toLowerCase();
      const matchesFeat = rambuGeoJSON.features.filter((f) => {
        const p = f.properties || {};
        return String(p.nama_ruas || "").toLowerCase().includes(term)
          || String(p.kode_ruas || "").toLowerCase().includes(term)
          || String(p.rambu_id || "").toLowerCase().includes(term)
          || String(p.kabkota_label || "").toLowerCase().includes(term);
      }).slice(0, 10);
      return matchesFeat.map((f) => {
        const p = f.properties;
        const c = f.geometry?.coordinates;
        return {
          title: p.nama_ruas || "Rambu",
          subtitle: `${p.kode_ruas || "-"} · Kelas ${p.kelas_jalan || "-"} · ${UPTD_LABEL[p.uptd] || p.uptd || "-"}`,
          action: () => {
            if (!c || !map) return;
            map.flyTo({ center: c, zoom: 15, duration: 800, essential: true });
            showPopup(map, c, config.popup(f), { maxWidth: "320px" });
          },
        };
      });
    },
  });
}

function fitBounds() {
  const valid = (c) => c && isFinite(c[0]) && isFinite(c[1]) && c[0] >= 104 && c[0] <= 110 && c[1] >= -9.5 && c[1] <= -4.5;
  const coords = [];
  [jaringanGeoJSON, rambuGeoJSON, ruasGeoJSON].forEach((gj) => {
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

async function handleFiles(files) {
  const fileArr = Array.from(files);
  const jaringanFile = fileArr.find((f) => f.name.includes("jaringan"));
  const rambuFile = fileArr.find((f) => f.name.includes("rambu"));
  const ruasFile = fileArr.find((f) => f.name.includes("ruas") || f.name.includes("jalan"));
  if (!jaringanFile && !rambuFile && !ruasFile) {
    if (fileStatus) { fileStatus.className = "status err"; fileStatus.textContent = "Butuh file jaringan / rambu / ruas .parquet"; }
    return;
  }
  try {
    if (jaringanFile) jaringanGeoJSON = await loadParquetToGeoJSON(jaringanFile);
    if (rambuFile) rambuGeoJSON = await loadParquetToGeoJSON(rambuFile);
    if (ruasFile) ruasGeoJSON = await loadParquetToGeoJSON(ruasFile);
    if (rambuGeoJSON && ruasGeoJSON) enrichRambu(rambuGeoJSON, ruasGeoJSON);
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
  panel.className = "rmb-panel";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Panel informasi Peta Rambu");
  panel.innerHTML = `
    <div id="sheet-handle" aria-hidden="true"></div>
    <div id="panel-header">
      <span class="panel-icon" aria-hidden="true">${config.icon}</span>
      <h1 class="panel-title">Peta Rambu Kelas Jalan</h1>
      <span class="badge" id="rmb-badge" aria-label="Jumlah rambu terfilter">0</span>
      <button id="panel-toggle" class="panel-toggle-btn" title="Minimalkan panel" aria-label="Minimalkan panel" aria-expanded="true" aria-controls="panel-body">${TOGGLE_CHEVRON}</button>
    </div>
    <div id="panel-body" role="region" aria-label="Informasi data rambu">
      ${section("stats", "Statistik", true, `
        <div class="stats-hero">
          <div class="stats-hero-label">Total Rambu</div>
          <div class="stats-hero-value" id="rmb-total">0</div>
          <div class="rmb-hero-sub">dari <strong id="rmb-denom">0</strong> rambu</div>
        </div>
        <div class="stats-kpi rmb-kpi-3">
          <div class="kpi-chip"><span class="kpi-label">Ruas</span><span class="kpi-value" id="rmb-kpi-ruas">0</span></div>
          <div class="kpi-chip"><span class="kpi-label">UPTD</span><span class="kpi-value" id="rmb-kpi-uptd">0</span></div>
          <div class="kpi-chip"><span class="kpi-label">Kab/Kota</span><span class="kpi-value" id="rmb-kpi-kab">0</span></div>
        </div>
        <div class="stats-bars">
          <div class="rmb-bars-title">Per Kelas Jalan</div>
          <div class="rmb-bars" id="rmb-bars-kelas"></div>
        </div>
        <div class="stats-bars">
          <div class="rmb-bars-title">Per UPTD</div>
          <div class="rmb-bars" id="rmb-bars-uptd"></div>
        </div>
      `)}
      ${section("wilayah", "Sebaran Wilayah", false, `
        <div class="rmb-bars-head"><span>Per Kota / Kabupaten</span><span class="rmb-muted" id="rmb-kab-count"></span></div>
        <div class="rmb-bars" id="rmb-bars-kab"></div>
      `)}
      ${section("ruas", "Sebaran Ruas", false, `
        <input type="search" id="rmb-ruas-search" class="rmb-input" placeholder="Cari nama / kode ruas…" autocomplete="off" />
        <div class="rmb-bars-head"><span>Per Ruas Jalan</span><span class="rmb-muted" id="rmb-ruas-count"></span></div>
        <div class="rmb-ruas-list" id="rmb-ruas-list"></div>
      `)}
      ${section("filter", "Filter Lanjutan", false, `
        <div class="filter-grid">
          ${config.filterChips.map((f) => `<div class="filter-field"><span class="filter-label">${escHtml(f.label)}</span><div class="chips" id="rmb-chip-${escHtml(f.key)}"></div></div>`).join("")}
          <div class="filter-field">
            <label class="rmb-slider-head" for="rmb-jarak"><span class="filter-label">Jarak ke Jaringan</span><span class="rmb-slider-val" id="rmb-jarak-val">Semua jarak</span></label>
            <div class="rmb-slider-row"><input type="checkbox" id="rmb-jarak-on" class="rmb-switch" /><input type="range" id="rmb-jarak" class="rmb-range" /></div>
          </div>
          <div class="filter-field">
            <label class="rmb-slider-head" for="rmb-panjang"><span class="filter-label">Panjang Ruas</span><span class="rmb-slider-val" id="rmb-panjang-val">Semua panjang</span></label>
            <div class="rmb-slider-row"><input type="checkbox" id="rmb-panjang-on" class="rmb-switch" /><input type="range" id="rmb-panjang" class="rmb-range" /></div>
          </div>
        </div>
        <button type="button" id="rmb-reset" class="rmb-reset">Atur ulang semua filter</button>
      `)}
      ${section("layers", "Tampilkan Lapisan", true, `
        <div class="rmb-layers" id="rmb-layers"></div>
      `)}
      ${section("file", "Data File", false, `
        <div id="file-drop">
          <p>Drag &amp; drop <strong>jaringan_jalan.parquet</strong> + <strong>rambu_kelas_jalan.parquet</strong> + <strong>ruas_jalan.parquet</strong></p>
          <p class="rmb-drop-hint">atau klik untuk pilih file</p>
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
  badgeEl = panel.querySelector("#rmb-badge");
  heroTotal = panel.querySelector("#rmb-total");
  heroDenom = panel.querySelector("#rmb-denom");
  kpiRuas = panel.querySelector("#rmb-kpi-ruas");
  kpiUptd = panel.querySelector("#rmb-kpi-uptd");
  kpiKab = panel.querySelector("#rmb-kpi-kab");
  barsKelas = panel.querySelector("#rmb-bars-kelas");
  barsUptd = panel.querySelector("#rmb-bars-uptd");
  barsKab = panel.querySelector("#rmb-bars-kab");
  kabCountEl = panel.querySelector("#rmb-kab-count");
  ruasList = panel.querySelector("#rmb-ruas-list");
  ruasSearch = panel.querySelector("#rmb-ruas-search");
  ruasCount = panel.querySelector("#rmb-ruas-count");
  layerRows = panel.querySelector("#rmb-layers");
  chipEls = {};
  for (const f of config.filterChips) chipEls[f.key] = panel.querySelector(`#rmb-chip-${f.key}`);
  jarakSlider = panel.querySelector("#rmb-jarak");
  jarakVal = panel.querySelector("#rmb-jarak-val");
  jarakToggle = panel.querySelector("#rmb-jarak-on");
  panjangSlider = panel.querySelector("#rmb-panjang");
  panjangVal = panel.querySelector("#rmb-panjang-val");
  panjangToggle = panel.querySelector("#rmb-panjang-on");
  fileDrop = panel.querySelector("#file-drop");
  fileInput = panel.querySelector("#file-input");
  fileStatus = panel.querySelector("#file-status");
}

function removeDOM() {
  if (panel?.parentNode) panel.parentNode.removeChild(panel);
  panel = panelHeader = panelBody = panelToggle = sheetHandle = null;
  badgeEl = heroTotal = heroDenom = kpiRuas = kpiUptd = kpiKab = null;
  barsKelas = barsUptd = barsKab = kabCountEl = null;
  ruasList = ruasSearch = ruasCount = ruasRowsEl = null;
  chipEls = {};
  jarakSlider = jarakVal = jarakToggle = panjangSlider = panjangVal = panjangToggle = null;
  layerRows = null;
  fileDrop = fileInput = fileStatus = null;
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

function setupPanelEvents() {
  track(panelBody, "click", (e) => {
    const bar = e.target.closest(".rmb-bar");
    if (bar) {
      const g = bar.dataset.group;
      if (g === "kelas") toggleInSet(activeKelas, bar.dataset.value);
      else if (g === "uptd") toggleInSet(activeUPTD, bar.dataset.value);
      else if (g === "kabkota") toggleInSet(activeKabkota, bar.dataset.value);
      applyFilters();
      return;
    }
    const chip = e.target.closest(".chip-btn");
    if (chip) {
      const key = chip.dataset.chip;
      if (chipSel[key]) toggleInSet(chipSel[key], chip.dataset.value);
      applyFilters();
      return;
    }
    const ruasRow = e.target.closest(".rmb-ruas-row");
    if (ruasRow) {
      toggleInSet(activeRuas, ruasRow.dataset.ruas);
      applyFilters();
      return;
    }
    const layerRow = e.target.closest(".rmb-layer-row[data-layer-group]");
    if (layerRow) {
      toggleLayer(layerRow.dataset.layerGroup, layerRow.dataset.layerValue);
      return;
    }
    if (e.target.closest("#rmb-reset")) resetFilters();
  });

  track(ruasSearch, "input", () => {
    ruasQuery = ruasSearch.value;
    renderRuasList();
  });

  track(jarakToggle, "change", () => { jarakEnabled = jarakToggle.checked; applyFilters(); renderSliderValues(); });
  track(panjangToggle, "change", () => { panjangEnabled = panjangToggle.checked; applyFilters(); renderSliderValues(); });
  track(jarakSlider, "input", () => { jarakMax = Number(jarakSlider.value); if (jarakEnabled) applyFilters(); renderSliderValues(); });
  track(panjangSlider, "input", () => { panjangMin = Number(panjangSlider.value); if (panjangEnabled) applyFilters(); renderSliderValues(); });
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

    const ids = ["rambu-hitbox", "rambu-points", "ruas-line", "kolektor-line", "arteri-line"];
    for (const id of ids) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of ["rambu", "ruas", "kolektor", "arteri"]) if (map.getSource(id)) map.removeSource(id);

    closePopup();

    if (sheetTeardown) { sheetTeardown(); sheetTeardown = null; }
    clearListeners();
    removeDOM();

    jaringanGeoJSON = rambuGeoJSON = ruasGeoJSON = null;
    activeKelas = new Set(KELAS_ORDER);
    activeUPTD = new Set(UPTD_ORDER);
    activeKabkota = new Set();
    allKabkota = [];
    activeRuas = new Set();
    chipSel = { fungsi: new Set(), bers_arteri: new Set(), bers_kolektor: new Set() };
    jarakEnabled = false;
    panjangEnabled = false;
    jarakMax = 0;
    panjangMin = 0;
    jarakBounds = { min: 0, max: 0 };
    panjangBounds = { min: 0, max: 0 };
    layerVis = { arteri: true, kolektor: true, rambu: true };
    ruasShown = true;
    ruasUPTD = new Set(UPTD_ORDER);
    ruasQuery = "";
    ruasNameByKode = new Map();
    dragCounter = 0;
    map = null;
  },
};
