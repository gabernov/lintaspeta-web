import { initParquet, loadParquetToGeoJSON } from "../../shared-core/js/parquet-loader.js";
import { showPopup, closePopup } from "../../shared-core/js/map-core.js";
import { escHtml, toast, Loading, initBottomSheet } from "../../shared-core/js/ui-core.js";
import config, { UPTD_COLORS, KONDISI_COLORS, UPTD_DEFAULT } from "./config.js";

export { config };

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let map = null;
let pjuGeoJSON = null;
let ruasGeoJSON = null;

let panel = null, panelHeader = null, panelBody = null, panelToggle = null, sheetHandle = null;
let sheetTeardown = null;
let legendEl = null, legendContent = null;
let badgeEl = null;
let statsEls = {};
let chipContainers = {};  // key -> .chips container
let uptdListEl = null;
let kondStatEl = null;

// Chip filter state: key -> Set of selected values (empty = all)
let chipSel = {};
// UPTD multi-toggle state
let activeUPTD = new Set(["UPTD 1", "UPTD 2", "UPTD 3", "UPTD 4"]);

// ═══════════════════════════════════════════════════════════
// HANDLER REFS (for teardown)
// ═══════════════════════════════════════════════════════════
let styleLoadHandler = null;
let basemapChangedHandler = null;
let pjuHitboxClickHandler = null;
let onUptdClick = null;
let chipHandlers = [];       // [{ el, h }]
let sectionHandlers = [];

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function fieldSelected(key) {
  const s = chipSel[key];
  return s && s.size > 0;
}

function matchesFeature(ft) {
  const p = ft.properties;
  if (!p) return false;
  if (!activeUPTD.has(p.UPTD)) return false;
  for (const f of config.filterFields) {
    if (f.type === "multi") continue;
    if (!fieldSelected(f.key)) continue;
    if (!chipSel[f.key].has(p[f.key])) return false;
  }
  return true;
}

function buildPointFilter() {
  const conds = [];
  const uptd = Array.from(activeUPTD);
  if (uptd.length === 4) {
    // all selected — no constraint
  } else if (uptd.length) {
    conds.push(["in", ["get", "UPTD"], ["literal", uptd]]);
  } else {
    conds.push(["==", ["get", "UPTD"], "__none__"]);
  }
  for (const f of config.filterFields) {
    if (f.type === "multi") continue;
    const vals = fieldSelected(f.key) ? Array.from(chipSel[f.key]) : null;
    if (vals) {
      conds.push(["in", ["get", f.key], ["literal", vals]]);
    }
  }
  return ["all", ...conds];
}

function applyFilters() {
  if (!map || !map.getLayer("pju-circle")) return;
  const f = buildPointFilter();
  map.setFilter("pju-circle", f);
  map.setFilter("pju-hitbox", f);
  updateStats();
  renderUPTDList();
  renderChips();
}

// ═══════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════
function updateStats() {
  if (!pjuGeoJSON) return;
  const feats = pjuGeoJSON.features.filter(matchesFeature);
  const total = feats.length;
  const baik = feats.filter((f) => f.properties?.Kondisi === "Baik").length;
  const rusak = feats.filter((f) => ["Rusak", "Rusak Berat", "Rusak Ringan"].includes(f.properties?.Kondisi)).length;
  if (statsEls.total) statsEls.total.textContent = total.toLocaleString();
  if (statsEls.ruas) statsEls.ruas.textContent = (ruasGeoJSON?.features.length || 0).toLocaleString();
  if (statsEls.baik) statsEls.baik.textContent = baik.toLocaleString();
  if (statsEls.rusak) statsEls.rusak.textContent = rusak.toLocaleString();
  if (badgeEl) badgeEl.textContent = total.toLocaleString();
  if (kondStatEl) {
    const rr = feats.filter((f) => f.properties?.Kondisi === "Rusak Ringan").length;
    const rb = feats.filter((f) => f.properties?.Kondisi === "Rusak Berat").length;
    const mati = feats.filter((f) => f.properties?.Kondisi === "Mati").length;
    kondStatEl.innerHTML = `
      <div class="kond-row"><span class="kond-dot" style="background:${KONDISI_COLORS["Baik"]}"></span><span>Baik</span><b>${baik.toLocaleString()}</b></div>
      <div class="kond-row"><span class="kond-dot" style="background:${KONDISI_COLORS["Rusak Ringan"]}"></span><span>Rusak Ringan</span><b>${rr.toLocaleString()}</b></div>
      <div class="kond-row"><span class="kond-dot" style="background:${KONDISI_COLORS["Rusak Berat"]}"></span><span>Rusak Berat</span><b>${rb.toLocaleString()}</b></div>
      <div class="kond-row"><span class="kond-dot" style="background:${KONDISI_COLORS["Mati"]}"></span><span>Mati</span><b>${mati.toLocaleString()}</b></div>
    `;
  }
}

function renderUPTDList() {
  if (!uptdListEl || !pjuGeoJSON) return;
  const feats = pjuGeoJSON.features.filter((ft) => {
    const p = ft.properties;
    for (const f of config.filterFields) {
      if (f.type === "multi") continue;
      if (!fieldSelected(f.key)) continue;
      if (!chipSel[f.key].has(p[f.key])) return false;
    }
    return true;
  });
  const counts = {};
  for (const f of feats) {
    const u = f.properties?.UPTD;
    counts[u] = (counts[u] || 0) + 1;
  }
  uptdListEl.innerHTML = ["UPTD 1", "UPTD 2", "UPTD 3", "UPTD 4"].map((u) => {
    const active = activeUPTD.has(u);
    const color = UPTD_COLORS[u] || UPTD_DEFAULT;
    return `<button class="uptd-item${active ? " active" : ""}" data-uptd="${u}" role="checkbox" aria-checked="${active}">
      <span class="uptd-dot" style="background:${color}"></span>
      <span class="uptd-name">${u}</span>
      <span class="uptd-count">${(counts[u] || 0).toLocaleString()}</span>
    </button>`;
  }).join("");
}

function renderChips() {
  for (const f of config.filterFields) {
    if (f.type === "multi") continue;
    const container = chipContainers[f.key];
    if (!container || !pjuGeoJSON) continue;
    const opts = buildFilterOptions(f.key);
    const sel = chipSel[f.key] || new Set();
    container.innerHTML = opts.map((o) => {
      const active = sel.has(o);
      return `<button class="chip-btn${active ? " active" : ""}" data-value="${escHtml(o)}" aria-pressed="${active}">${escHtml(o)}</button>`;
    }).join("");
  }
}

// ═══════════════════════════════════════════════════════════
// POPUP
// ═══════════════════════════════════════════════════════════
function showPjuPopup(feature) {
  const coords = feature.geometry?.coordinates;
  if (!coords) return;
  showPopup(map, coords, config.popup(feature), { maxWidth: "320px" });
}

// ═══════════════════════════════════════════════════════════
// DOM CREATION
// ═══════════════════════════════════════════════════════════
function buildFilterOptions(key) {
  if (!pjuGeoJSON) return [];
  const vals = new Set();
  for (const f of pjuGeoJSON.features) {
    const v = f.properties?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") vals.add(String(v));
  }
  return Array.from(vals).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function createDOM() {
  panel = document.createElement("div");
  panel.id = "panel";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Panel informasi Peta APJ");
  panel.innerHTML = `
    <div id="sheet-handle" aria-hidden="true"></div>
    <div id="panel-header">
      <span class="panel-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25M5.25 12H3m15 0h2.25M6.34 6.34l-1.591-1.591m14.903 0l-1.591 1.591M12 18.75V21M8.25 12a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 15.75h4.5v2.25a1.5 1.5 0 01-1.5 1.5h-1.5a1.5 1.5 0 01-1.5-1.5v-2.25z"/></svg>
      </span>
      <h1 class="panel-title">Peta APJ (PJU) Jabar</h1>
      <span class="badge" id="pju-badge" aria-label="Jumlah titik PJU">0</span>
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
    <div id="panel-body" role="region" aria-label="Informasi data APJ">
      <section class="panel-section" aria-label="Statistik PJU">
        <div class="stats-grid" role="list">
          <div class="stat-card" role="listitem">
            <div class="stat-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"/></svg>
            </div>
            <div class="stat-content">
              <div class="stat-label">Total Titik</div>
              <div class="stat-value" id="stat-total">0</div>
            </div>
          </div>
          <div class="stat-card stat-card--blue" role="listitem">
            <div class="stat-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0z"/></svg>
            </div>
            <div class="stat-content">
              <div class="stat-label">Total Ruas</div>
              <div class="stat-value stat-value--blue" id="stat-ruas">0</div>
            </div>
          </div>
          <div class="stat-card stat-card--green" role="listitem">
            <div class="stat-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div class="stat-content">
              <div class="stat-label">Kondisi Baik</div>
              <div class="stat-value stat-value--green" id="stat-baik">0</div>
            </div>
          </div>
          <div class="stat-card stat-card--purple" role="listitem">
            <div class="stat-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
            </div>
            <div class="stat-content">
              <div class="stat-label">Rusak</div>
              <div class="stat-value stat-value--purple" id="stat-rusak">0</div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel-section" aria-label="Rincian kondisi">
        <div class="section-header" data-collapse="kond">
          <span class="section-chevron" aria-hidden="true">▸</span>
          <h2 class="section-title">Rincian Kondisi</h2>
        </div>
        <div class="section-content" data-collapse-target="kond">
          <div id="kond-stats"></div>
        </div>
      </section>

      <section class="panel-section" aria-label="Filter data">
        <div class="section-header" data-collapse="filter">
          <span class="section-chevron" aria-hidden="true">▸</span>
          <h2 class="section-title">Filter Data</h2>
        </div>
        <div class="section-content" data-collapse-target="filter">
          <div class="filter-grid" id="filter-grid"></div>
        </div>
      </section>

      <section class="panel-section" id="uptd-section" aria-label="Filter UPTD">
        <div class="section-header" data-collapse="uptd">
          <span class="section-chevron" aria-hidden="true">▸</span>
          <h2 class="section-title">UPTD</h2>
        </div>
        <div class="section-content" data-collapse-target="uptd">
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
  badgeEl = document.getElementById("pju-badge");
  statsEls = {
    total: document.getElementById("stat-total"),
    ruas: document.getElementById("stat-ruas"),
    baik: document.getElementById("stat-baik"),
    rusak: document.getElementById("stat-rusak"),
  };
  kondStatEl = document.getElementById("kond-stats");
  uptdListEl = document.getElementById("uptd-list");

  // Collapsible sections
  panel.querySelectorAll(".section-header[data-collapse]").forEach((header) => {
    const target = panel.querySelector(`.section-content[data-collapse-target="${header.dataset.collapse}"]`);
    if (!target) return;
    const toggle = () => {
      const open = target.style.display !== "none";
      target.style.display = open ? "none" : "";
      header.classList.toggle("open", !open);
    };
    header.addEventListener("click", toggle);
    sectionHandlers.push({ header, toggle });
  });

  // Build chip filters
  const grid = document.getElementById("filter-grid");
  for (const f of config.filterFields) {
    if (f.type === "multi") continue;
    chipSel[f.key] = new Set();
    const wrap = document.createElement("div");
    wrap.className = "filter-field";
    wrap.innerHTML = `<span class="filter-label">${escHtml(f.label)}</span>
      <div class="chips" data-chips="${escHtml(f.key)}"></div>`;
    grid.appendChild(wrap);
    const container = wrap.querySelector(".chips");
    chipContainers[f.key] = container;
    const h = (e) => {
      const btn = e.target.closest(".chip-btn");
      if (!btn) return;
      const val = btn.dataset.value;
      const s = chipSel[f.key];
      if (s.has(val)) s.delete(val);
      else s.add(val);
      applyFilters();
    };
    container.addEventListener("click", h);
    chipHandlers.push({ el: container, h });
  }

  // Legend (floating, bottom-right)
  legendEl = document.createElement("div");
  legendEl.id = "legend";
  legendContent = document.createElement("div");
  legendContent.className = "legend-content";
  const legendTitle = document.createElement("div");
  legendTitle.className = "legend-title";
  legendTitle.textContent = "Kondisi PJU";
  legendEl.appendChild(legendTitle);
  legendEl.appendChild(legendContent);
  document.getElementById("map").appendChild(legendEl);
  renderLegend();
}

function renderLegend() {
  if (!legendContent) return;
  legendContent.innerHTML = config.legend.map((l) => `
    <div class="legend-row">
      <span class="legend-color-dot" style="background:${l.color}"></span>
      <span class="legend-label">${escHtml(l.label)}</span>
    </div>
  `).join("");
}

function removeDOM() {
  if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  if (legendEl && legendEl.parentNode) legendEl.parentNode.removeChild(legendEl);
  panel = panelHeader = panelBody = panelToggle = sheetHandle = null;
  legendEl = legendContent = badgeEl = null;
  uptdListEl = kondStatEl = null;
  statsEls = {};
  chipContainers = {};
}

// ═══════════════════════════════════════════════════════════
// LAYER ADD / RE-ADD
// ═══════════════════════════════════════════════════════════
function addLayers() {
  if (!map) return;
  if (ruasGeoJSON && !map.getSource("apj-roads")) {
    map.addSource("apj-roads", { type: "geojson", data: ruasGeoJSON });
    for (const l of config.layers.filter((x) => x.source === "apj-roads")) {
      if (!map.getLayer(l.id)) map.addLayer(l);
    }
  }
  if (pjuGeoJSON && !map.getSource("pju-points")) {
    map.addSource("pju-points", { type: "geojson", data: pjuGeoJSON });
    for (const l of config.layers.filter((x) => x.source === "pju-points")) {
      if (!map.getLayer(l.id)) map.addLayer(l);
    }
    if (map.getLayer("apj-roads-line")) {
      for (const id of config.layers.filter((x) => x.source === "pju-points").map((l) => l.id)) {
        if (map.getLayer(id)) map.moveLayer(id, "apj-roads-line");
      }
    }
  }
  applyFilters();
}

function reAddLayers() {
  if (!map) return;
  addLayers();
}

function fitBounds() {
  const bounds = new maplibregl.LngLatBounds();
  if (!pjuGeoJSON || !pjuGeoJSON.features.length) return;
  let added = false;
  for (const f of pjuGeoJSON.features) {
    const c = f.geometry?.coordinates;
    if (!c) continue;
    const flat = c.flat(Infinity);
    for (let i = 0; i + 1 < flat.length; i += 2) {
      if (isFinite(flat[i]) && isFinite(flat[i + 1])) {
        bounds.extend([flat[i], flat[i + 1]]);
        added = true;
      }
    }
  }
  if (added) map.fitBounds(bounds, { padding: 40, duration: 800, maxZoom: 12 });
}

// ═══════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════
export const module = {
  async init(ctx) {
    map = ctx.map;

    Loading.show("Loading data...");
    Loading.setStage?.(30000, 90000);
    await initParquet();

    const pjuUrl = new URL("data/pju_detail.parquet", import.meta.url);
    const ruasUrl = new URL("data/ruas_apj.parquet", import.meta.url);

    const [pjuResult, ruasResult] = await Promise.allSettled([
      loadParquetToGeoJSON(
        pjuUrl,
        () => Loading.heartbeat?.(),
        (received, total) => {
          Loading.heartbeat?.();
          const pct = total ? Math.round((received / total) * 100) : 0;
          const st = document.getElementById("load-status");
          if (st) st.textContent = `Mengunduh data PJU… ${pct}%`;
        }
      ),
      loadParquetToGeoJSON(
        ruasUrl,
        () => Loading.heartbeat?.(),
        (received, total) => {
          Loading.heartbeat?.();
          const pct = total ? Math.round((received / total) * 100) : 0;
          const st = document.getElementById("load-status");
          if (st) st.textContent = `Mengunduh data ruas… ${pct}%`;
        }
      ),
    ]);

    if (pjuResult.status === "fulfilled") pjuGeoJSON = pjuResult.value;
    else console.error("Failed to load PJU:", pjuResult.reason);
    if (ruasResult.status === "fulfilled") ruasGeoJSON = ruasResult.value;
    else console.error("Failed to load ruas:", ruasResult.reason);

    Loading.hide();

    if (!pjuGeoJSON) {
      toast("Gagal memuat data PJU");
      return;
    }

    createDOM();
    addLayers();
    updateStats();
    renderUPTDList();
    renderChips();

    // Shared bottom sheet: toggle + swipe-to-open/collapse on mobile.
    sheetTeardown = initBottomSheet({ panel, handle: sheetHandle, toggle: panelToggle, header: panelHeader });

    // Search: PJU by ruas / tiang id
    if (ctx?.search?.registerSearch && pjuGeoJSON) {
      ctx.search.registerSearch({
        placeholder: "Cari ruas / ID tiang PJU...",
        onQuery: async (q) => {
          const term = q.toLowerCase();
          const matches = pjuGeoJSON.features.filter((f) => {
            const p = f.properties;
            if (!p) return false;
            return String(p["Nama Ruas (Resmi)"] || "").toLowerCase().includes(term) ||
              String(p.Id_Tiang || "").toLowerCase().includes(term);
          }).slice(0, 12);
          return matches.map((f) => {
            const p = f.properties;
            const c = f.geometry?.coordinates;
            return {
              title: p["Nama Ruas (Resmi)"] || "PJU",
              subtitle: `${p.Id_Tiang || "-"} · ${p.UPTD || "-"}`,
              action: () => {
                if (!c) return;
                map.flyTo({ center: c, zoom: 16, duration: 800, essential: true });
                showPjuPopup(f);
              },
            };
          });
        },
      });
    }

    // Events
    pjuHitboxClickHandler = (e) => {
      const feature = e.features?.[0];
      if (feature) showPjuPopup(feature);
    };
    map.on("click", "pju-hitbox", pjuHitboxClickHandler);
    map.on("mouseenter", "pju-hitbox", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "pju-hitbox", () => { map.getCanvas().style.cursor = ""; });

    // UPTD multi toggle (event delegation survives re-render)
    onUptdClick = (e) => {
      const btn = e.target.closest(".uptd-item");
      if (!btn) return;
      const u = btn.dataset.uptd;
      if (activeUPTD.has(u)) activeUPTD.delete(u);
      else activeUPTD.add(u);
      applyFilters();
    };
    uptdListEl.addEventListener("click", onUptdClick);

    styleLoadHandler = () => { reAddLayers(); };
    map.on("style.load", styleLoadHandler);
    basemapChangedHandler = () => { reAddLayers(); };
    map.on("basemap-changed", basemapChangedHandler);

    setTimeout(fitBounds, 500);
  },

  teardown() {
    if (!map) return;
    if (styleLoadHandler) { map.off("style.load", styleLoadHandler); styleLoadHandler = null; }
    if (basemapChangedHandler) { map.off("basemap-changed", basemapChangedHandler); basemapChangedHandler = null; }
    if (pjuHitboxClickHandler) { map.off("click", "pju-hitbox", pjuHitboxClickHandler); pjuHitboxClickHandler = null; }
    if (onUptdClick && uptdListEl) { uptdListEl.removeEventListener("click", onUptdClick); onUptdClick = null; }
    for (const { el, h } of chipHandlers) {
      el.removeEventListener("click", h);
    }
    chipHandlers = [];
    for (const { header, toggle } of sectionHandlers) {
      header.removeEventListener("click", toggle);
    }
    sectionHandlers = [];

    const layerIds = ["pju-hitbox", "pju-circle", "apj-roads-line"];
    for (const id of layerIds) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource("pju-points")) map.removeSource("pju-points");
    if (map.getSource("apj-roads")) map.removeSource("apj-roads");

    closePopup();

    // Shared bottom sheet teardown (header/handle/toggle listeners)
    if (sheetTeardown) {
      sheetTeardown();
      sheetTeardown = null;
    }

    removeDOM();

    pjuGeoJSON = null;
    ruasGeoJSON = null;
    activeUPTD = new Set(["UPTD 1", "UPTD 2", "UPTD 3", "UPTD 4"]);
    chipSel = {};
    map = null;
  },
};
