import { initParquet, loadParquetToGeoJSON } from "../../shared-core/js/parquet-loader.js";
import { showPopup, closePopup } from "../../shared-core/js/map-core.js";
import { escHtml, toast, initBottomSheet } from "../../shared-core/js/ui-core.js";
import config, { UPTD_COLORS, KONDISI_COLORS, UPTD_DEFAULT } from "./config.js";

export { config };

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let map = null;
let pjuGeoJSON = null;
let ruasGeoJSON = null;

let panel = null, panelHeader = null, panelBody = null, panelToggle = null, sheetHandle = null;
let sheetTeardown = null;
let legendEl = null, legendContent = null;
let badgeEl = null;
let statsEls = {};         // hero stats: total, ruas, baik, rusak
let kondBarsEl = null;     // per-condition progress bars
let uptdBarsEl = null;     // per-UPTD progress bars (stats section)
let chipContainers = {};   // key -> .chips container
let singleEls = {};        // key -> select element

// Chip filter state: key -> Set of selected values (empty = all)
let chipSel = {};
// Single-select (dropdown) filter state
let singleSel = {};
// UPTD multi-toggle state (toggled via the stats bars)
let activeUPTD = new Set(["UPTD 1", "UPTD 2", "UPTD 3", "UPTD 4"]);
// Kondisi multi-toggle state (toggled via the stats bars)
let activeKondisi = new Set(["Baik", "Rusak Ringan", "Rusak Berat", "Mati"]);

// ═══════════════════════════════════════════════════════════
// HANDLER REFS (for teardown)
// ═══════════════════════════════════════════════════════════
let styleLoadHandler = null;
let basemapChangedHandler = null;
let pjuHitboxClickHandler = null;
let onUptdBarClick = null;
let onKondBarClick = null;
let chipHandlers = [];       // [{ el, h }]
let singleHandlers = [];     // [{ el, h }]
let sectionHandlers = [];

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function matchesFeature(ft) {
  const p = ft.properties;
  if (!p) return false;
  if (!activeUPTD.has(p.UPTD)) return false;
  if (!activeKondisi.has(p.Kondisi)) return false;
  for (const f of config.filterFields) {
    if (f.type === "multi") continue;
    if (f.type === "single") {
      const want = singleSel[f.key];
      if (want && want !== "all" && p[f.key] !== want) return false;
    } else {
      const s = chipSel[f.key];
      if (s && s.size > 0 && !s.has(p[f.key])) return false;
    }
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
  const kond = Array.from(activeKondisi);
  if (kond.length === 4) {
    // all selected — no constraint
  } else if (kond.length) {
    conds.push(["in", ["get", "Kondisi"], ["literal", kond]]);
  } else {
    conds.push(["==", ["get", "Kondisi"], "__none__"]);
  }
  for (const f of config.filterFields) {
    if (f.type === "multi") continue;
    if (f.type === "single") {
      const want = singleSel[f.key];
      if (want && want !== "all") {
        conds.push(["==", ["get", f.key], want]);
      }
    } else {
      const s = chipSel[f.key];
      if (s && s.size > 0) {
        conds.push(["in", ["get", f.key], ["literal", Array.from(s)]]);
      }
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
  renderChips();
}

// ═══════════════════════════════════════════════════════════
// STATS — hero + condition bars + UPTD bars (all in one section)
// ═══════════════════════════════════════════════════════════
function updateStats() {
  if (!pjuGeoJSON) return;
  const feats = pjuGeoJSON.features.filter(matchesFeature);
  const total = feats.length;
  const baik = feats.filter((f) => f.properties?.Kondisi === "Baik").length;
  const rr = feats.filter((f) => f.properties?.Kondisi === "Rusak Ringan").length;
  const rb = feats.filter((f) => f.properties?.Kondisi === "Rusak Berat").length;
  const mati = feats.filter((f) => f.properties?.Kondisi === "Mati").length;
  const rusak = rr + rb;

  if (statsEls.total) statsEls.total.textContent = total.toLocaleString();
  if (statsEls.ruas) statsEls.ruas.textContent = (ruasGeoJSON?.features.length || 0).toLocaleString();
  if (statsEls.baik) statsEls.baik.textContent = baik.toLocaleString();
  if (statsEls.rusak) statsEls.rusak.textContent = rusak.toLocaleString();
  if (badgeEl) badgeEl.textContent = total.toLocaleString();

  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  if (kondBarsEl) {
    const rows = [
      { label: "Baik", n: baik, color: KONDISI_COLORS["Baik"] },
      { label: "Rusak Ringan", n: rr, color: KONDISI_COLORS["Rusak Ringan"] },
      { label: "Rusak Berat", n: rb, color: KONDISI_COLORS["Rusak Berat"] },
      { label: "Mati", n: mati, color: KONDISI_COLORS["Mati"] },
    ];
    kondBarsEl.innerHTML = rows.map((r) => {
      const on = activeKondisi.has(r.label);
      return `<button type="button" class="kond-bar${on ? " on" : ""}" data-kond="${r.label}" aria-pressed="${on}">
        <div class="bar-head">
          <span class="bar-label"><span class="bar-dot" style="background:${r.color}"></span>${r.label}</span>
          <span class="bar-count">${r.n.toLocaleString()}<em>${pct(r.n)}%</em></span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(r.n)}%;background:${r.color}"></div></div>
      </button>`;
    }).join("");
  }
  // UPTD distribution bars double as toggle buttons (click to hide/show
  // that UPTD). APJ-only class names — never touches shared components.
  if (uptdBarsEl) {
    const counts = {};
    for (const f of feats) counts[f.properties?.UPTD] = (counts[f.properties?.UPTD] || 0) + 1;
    uptdBarsEl.innerHTML = ["UPTD 1", "UPTD 2", "UPTD 3", "UPTD 4"].map((u) => {
      const n = counts[u] || 0;
      const color = UPTD_COLORS[u] || UPTD_DEFAULT;
      const on = activeUPTD.has(u);
      return `<button type="button" class="uptd-bar${on ? " on" : ""}" data-uptd="${u}" aria-pressed="${on}">
        <div class="bar-head">
          <span class="bar-label"><span class="bar-dot" style="background:${color}"></span>${u}</span>
          <span class="bar-count">${n.toLocaleString()}<em>${pct(n)}%</em></span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(n)}%;background:${color}"></div></div>
      </button>`;
    }).join("");
  }
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

// ═══════════════════════════════════════════════════════════
// POPUP
// ═══════════════════════════════════════════════════════════
function showPjuPopup(feature) {
  const coords = feature.geometry?.coordinates;
  if (!coords) return;
  showPopup(map, coords, config.popup(feature), { maxWidth: "320px" });
}

// ═══════════════════════════════════════════════════════════
// DOM CREATION
// ═══════════════════════════════════════════════════════════
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
      <h1 class="panel-title">Peta APJ Jabar</h1>
      <span class="badge" id="pju-badge" aria-label="Jumlah titik APJ">0</span>
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
      <section class="panel-section stats-section" aria-label="Statistik APJ">
        <div class="stats-hero">
          <div class="stats-hero-label">Total Titik APJ</div>
          <div class="stats-hero-value" id="stat-total">0</div>
        </div>
        <div class="stats-kpi">
          <div class="kpi-chip">
            <span class="kpi-label">Total Ruas</span>
            <span class="kpi-value" id="stat-ruas">0</span>
          </div>
          <div class="kpi-chip kpi-ok">
            <span class="kpi-label">Kondisi Baik</span>
            <span class="kpi-value" id="stat-baik">0</span>
          </div>
          <div class="kpi-chip kpi-bad">
            <span class="kpi-label">Rusak</span>
            <span class="kpi-value" id="stat-rusak">0</span>
          </div>
        </div>
        <div class="stats-bars" id="kond-bars"></div>
        <div class="stats-bars" id="uptd-bars"></div>
      </section>

      <section class="panel-section" aria-label="Filter data">
        <div class="section-header" data-collapse="filter">
          <span class="section-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg></span>
          <h2 class="section-title">Filter Data</h2>
        </div>
        <div class="section-content" data-collapse-target="filter">
          <div class="filter-grid" id="filter-grid"></div>
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
  kondBarsEl = document.getElementById("kond-bars");
  uptdBarsEl = document.getElementById("uptd-bars");

  // Collapsible sections
  panel.querySelectorAll(".section-header[data-collapse]").forEach((header) => {
    const target = panel.querySelector(`.section-content[data-collapse-target="${header.dataset.collapse}"]`);
    const section = header.closest(".panel-section");
    if (!target) return;
    // Sections start open — reflect that in the class so the chevron
    // points correctly from the start.
    section.classList.add("open");
    const toggle = () => {
      const open = target.style.display !== "none";
      target.style.display = open ? "none" : "";
      header.classList.toggle("open", !open);
      if (section) section.classList.toggle("open", !open);
    };
    header.addEventListener("click", toggle);
    sectionHandlers.push({ header, toggle });
  });

  // Build filters: dropdowns (type single) + chips (type chips)
  const grid = document.getElementById("filter-grid");
  for (const f of config.filterFields) {
    if (f.type === "multi") continue;
    const opts = buildFilterOptions(f.key);
    const wrap = document.createElement("div");
    wrap.className = "filter-field";

    if (f.type === "single") {
      singleSel[f.key] = "all";
      wrap.innerHTML = `<span class="filter-label">${escHtml(f.label)}</span>
        <select data-filter="${escHtml(f.key)}">
          <option value="all">Semua</option>
          ${opts.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("")}
        </select>`;
      grid.appendChild(wrap);
      const sel = wrap.querySelector("select");
      singleEls[f.key] = sel;
      const h = () => { singleSel[f.key] = sel.value; applyFilters(); };
      sel.addEventListener("change", h);
      singleHandlers.push({ el: sel, h });
    } else {
      chipSel[f.key] = new Set();
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
  }

  // Legend (floating, bottom-right)
  legendEl = document.createElement("div");
  legendEl.id = "legend";
  legendContent = document.createElement("div");
  legendContent.className = "legend-content";
  const legendTitle = document.createElement("div");
  legendTitle.className = "legend-title";
  legendTitle.textContent = "Kondisi APJ";
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
  kondBarsEl = uptdBarsEl = null;
  statsEls = {};
  chipContainers = {};
  singleEls = {};
}

// ═══════════════════════════════════════════════════════════
// LAYER ADD / RE-ADD
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════
async function loadParquetData(ctx) {
  await initParquet();

  const pjuUrl = new URL("data/pju_detail.parquet", import.meta.url);
  const ruasUrl = new URL("data/ruas_apj.parquet", import.meta.url);

  const [pjuResult, ruasResult] = await Promise.allSettled([
    loadParquetToGeoJSON(pjuUrl),
    loadParquetToGeoJSON(ruasUrl),
  ]);

  if (pjuResult.status === "fulfilled") pjuGeoJSON = pjuResult.value;
  else console.error("Failed to load PJU:", pjuResult.reason);
  if (ruasResult.status === "fulfilled") ruasGeoJSON = ruasResult.value;
  else console.error("Failed to load ruas:", ruasResult.reason);

  if (!pjuGeoJSON) {
    toast("Gagal memuat data APJ");
    return;
  }

  addLayers();
  updateStats();
  renderChips();

  if (ctx?.search?.registerSearch && pjuGeoJSON) {
    ctx.search.registerSearch({
      placeholder: "Cari ruas / ID tiang APJ...",
      onQuery: async (q) => {
        const term = q.toLowerCase();
        const matches = pjuGeoJSON.features.filter((f) => {
          const p = f.properties;
          if (!p) return false;
          return String(p["Nama Ruas (Resmi)"] || "").toLowerCase().includes(term) ||
            String(p.Id_Tiang || "").toLowerCase().includes(term) ||
            String(p.Id_Tiang_By_Konsultan || "").toLowerCase().includes(term);
        }).slice(0, 12);
        return matches.map((f) => {
          const p = f.properties;
          const c = f.geometry?.coordinates;
          return {
            title: p["Nama Ruas (Resmi)"] || "APJ",
            subtitle: `${p.Id_Tiang || p.Id_Tiang_By_Konsultan || "-"} · ${p.UPTD || "-"}`,
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

  setTimeout(fitBounds, 500);
}

export const module = {
  async init(ctx) {
    map = ctx.map;

    createDOM();
    renderChips();
    sheetTeardown = initBottomSheet({ panel, handle: sheetHandle, toggle: panelToggle, header: panelHeader });

    pjuHitboxClickHandler = (e) => {
      const feature = e.features?.[0];
      if (feature) showPjuPopup(feature);
    };
    map.on("click", "pju-hitbox", pjuHitboxClickHandler);
    map.on("mouseenter", "pju-hitbox", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "pju-hitbox", () => { map.getCanvas().style.cursor = ""; });

    onUptdBarClick = (e) => {
      const bar = e.target.closest(".uptd-bar");
      if (!bar) return;
      const u = bar.dataset.uptd;
      if (activeUPTD.has(u)) activeUPTD.delete(u);
      else activeUPTD.add(u);
      applyFilters();
    };
    uptdBarsEl.addEventListener("click", onUptdBarClick);

    onKondBarClick = (e) => {
      const bar = e.target.closest(".kond-bar");
      if (!bar) return;
      const k = bar.dataset.kond;
      if (activeKondisi.has(k)) activeKondisi.delete(k);
      else activeKondisi.add(k);
      applyFilters();
    };
    kondBarsEl.addEventListener("click", onKondBarClick);

    styleLoadHandler = () => { reAddLayers(); };
    map.on("style.load", styleLoadHandler);
    basemapChangedHandler = () => { reAddLayers(); };
    map.on("basemap-changed", basemapChangedHandler);

    loadParquetData(ctx);
  },

  teardown() {
    if (!map) return;
    if (styleLoadHandler) { map.off("style.load", styleLoadHandler); styleLoadHandler = null; }
    if (basemapChangedHandler) { map.off("basemap-changed", basemapChangedHandler); basemapChangedHandler = null; }
    if (pjuHitboxClickHandler) { map.off("click", "pju-hitbox", pjuHitboxClickHandler); pjuHitboxClickHandler = null; }
    if (onUptdBarClick && uptdBarsEl) { uptdBarsEl.removeEventListener("click", onUptdBarClick); onUptdBarClick = null; }
    if (onKondBarClick && kondBarsEl) { kondBarsEl.removeEventListener("click", onKondBarClick); onKondBarClick = null; }
    for (const { el, h } of chipHandlers) {
      el.removeEventListener("click", h);
    }
    chipHandlers = [];
    for (const { el, h } of singleHandlers) {
      el.removeEventListener("change", h);
    }
    singleHandlers = [];
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
