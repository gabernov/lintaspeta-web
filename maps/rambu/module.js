import { initParquet, loadParquetToGeoJSON } from "../../shared-core/js/parquet-loader.js";
import { flyToBounds, showPopup, closePopup } from "../../shared-core/js/map-core.js";
import { escHtml, toast, Loading } from "../../shared-core/js/ui-core.js";
import config from "./config.js";

export { config };

const KELAS_COLORS = config.KELAS_COLORS || { "I": "#EF4444", "II": "#F97316", "III": "#8B5CF6" };
const ARTERI_COLOR = config.ARTERI_COLOR || "#EF4444";
const KOLEKTOR_COLOR = config.KOLEKTOR_COLOR || "#F97316";
const RUAS_COLOR = config.RUAS_COLOR || "#8B5CF6";

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let map = null;
let jaringanGeoJSON = null;
let rambuGeoJSON = null;
let ruasGeoJSON = null;
let activeKelas = new Set(["I", "II", "III"]);
let dragCounter = 0;

// ═══════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════
let panel, panelHeader, panelBody, panelToggle, sheetHandle;
let fileDrop, fileInput, fileStatus;
let legendEl, legendRoads;
let dropOverlay;
let kelasFilter, filterCount, filteredCount, totalRambuCount;
let statRambu, statRuas, statJaringan, statArteri, statKolektor;
let totalBadge;

// ═══════════════════════════════════════════════════════════
// HANDLER REFS (for teardown)
// ═══════════════════════════════════════════════════════════
let styleLoadHandler = null;
let basemapChangedHandler = null;
let arteriClickHandler = null;
let kolektorClickHandler = null;
let ruasClickHandler = null;
let rambuHitboxClickHandler = null;
let rambuHitboxEnterHandler = null;
let rambuHitboxLeaveHandler = null;
let rambuPointsEnterHandler = null;
let rambuPointsLeaveHandler = null;
let kelasFilterClickHandler = null;
let panelToggleClickHandler = null;
let sheetHeaderClickHandler = null;
let resizeHandler = null;
let fileDropClickHandler = null;
let fileInputChangeHandler = null;
let dragEnterHandler = null;
let dragLeaveHandler = null;
let dragOverHandler = null;
let dropHandler = null;

// ═══════════════════════════════════════════════════════════
// LAYERS
// ═══════════════════════════════════════════════════════════
function addJaringanLayer(forceReadd = false) {
  if (!jaringanGeoJSON) return;

  // Split into arteri and kolektor
  const arteriFeatures = [];
  const kolektorFeatures = [];
  jaringanGeoJSON.features.forEach(f => {
    const jenis = (f.properties.jenis || f.properties.nama_jenis || "").toLowerCase();
    if (jenis.includes("arteri")) {
      arteriFeatures.push({ ...f, properties: { ...f.properties, _jenis: "Arteri" } });
    } else if (jenis.includes("kolektor")) {
      kolektorFeatures.push({ ...f, properties: { ...f.properties, _jenis: "Kolektor" } });
    } else {
      arteriFeatures.push({ ...f, properties: { ...f.properties, _jenis: "Arteri" } });
    }
  });

  const arteriGeoJSON = { type: "FeatureCollection", features: arteriFeatures };
  const kolektorGeoJSON = { type: "FeatureCollection", features: kolektorFeatures };

  // Arteri
  if (!forceReadd && map.getSource("arteri")) {
    map.getSource("arteri").setData(arteriGeoJSON);
  } else {
    if (map.getSource("arteri")) {
      if (map.getLayer("arteri-line")) map.removeLayer("arteri-line");
      map.removeSource("arteri");
    }
    map.addSource("arteri", { type: "geojson", data: arteriGeoJSON });
    map.addLayer({
      id: "arteri-line", type: "line", source: "arteri",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ARTERI_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2, 16, 3.5, 20, 5],
        "line-opacity": 0.85
      }
    });

    arteriClickHandler = (e) => {
      if (!e.features.length) return;
      const p = e.features[0].properties;
      showPopup(map, e.lngLat, `<div>
        <b style="font-size:14px;color:${ARTERI_COLOR};">Jaringan Arteri</b><br/>
        <b>Nama:</b> ${escHtml(p.nama || "N/A")}<br/>
        <b>Jenis:</b> ${escHtml(p._jenis || "Arteri")}<br/>
      </div>`);
    };
    map.on("click", "arteri-line", arteriClickHandler);
  }

  // Kolektor
  if (!forceReadd && map.getSource("kolektor")) {
    map.getSource("kolektor").setData(kolektorGeoJSON);
  } else {
    if (map.getSource("kolektor")) {
      if (map.getLayer("kolektor-line")) map.removeLayer("kolektor-line");
      map.removeSource("kolektor");
    }
    map.addSource("kolektor", { type: "geojson", data: kolektorGeoJSON });
    map.addLayer({
      id: "kolektor-line", type: "line", source: "kolektor",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": KOLEKTOR_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2, 16, 3.5, 20, 5],
        "line-opacity": 0.85
      }
    });

    kolektorClickHandler = (e) => {
      if (!e.features.length) return;
      const p = e.features[0].properties;
      showPopup(map, e.lngLat, `<div>
        <b style="font-size:14px;color:${KOLEKTOR_COLOR};">Jaringan Kolektor</b><br/>
        <b>Nama:</b> ${escHtml(p.nama || "N/A")}<br/>
        <b>Jenis:</b> ${escHtml(p._jenis || "Kolektor")}<br/>
      </div>`);
    };
    map.on("click", "kolektor-line", kolektorClickHandler);
  }
}

function addRuasLayer(forceReadd = false) {
  if (!ruasGeoJSON) return;

  if (!forceReadd && map.getSource("ruas")) {
    map.getSource("ruas").setData(ruasGeoJSON);
    return;
  }

  if (map.getSource("ruas")) {
    if (map.getLayer("ruas-line")) map.removeLayer("ruas-line");
    map.removeSource("ruas");
  }

  map.addSource("ruas", { type: "geojson", data: ruasGeoJSON });
  map.addLayer({
    id: "ruas-line", type: "line", source: "ruas",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": RUAS_COLOR,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 3, 16, 5, 20, 7],
      "line-opacity": 0.9
    }
  });

  ruasClickHandler = (e) => {
    if (!e.features.length) return;
    const p = e.features[0].properties;
    const kelas = p.kelas_jalan || "N/A";
    const kelasBadge = kelas === "I" ? "badge-kelas-1" : kelas === "II" ? "badge-kelas-2" : "badge-kelas-3";
    showPopup(map, e.lngLat, `<div>
      <b style="font-size:14px;color:${RUAS_COLOR};">Ruas Jalan Provinsi</b><br/><br/>
      <b>Nama:</b> ${escHtml(p.nama || "N/A")}<br/>
      <b>Kode:</b> ${escHtml(p.kode_number || "N/A")}<br/>
      <b>Kelas:</b> <span class="${kelasBadge}">${escHtml(kelas)}</span><br/>
      <b>Panjang:</b> ${escHtml(p.panjang_km || "N/A")} km<br/>
      <b>Status:</b> ${escHtml(p.status || "N/A")}<br/>
      <b>Unit Kerja:</b> ${escHtml(p.unit_kerja_kode || "N/A")}<br/>
      <b>Lokasi:</b> ${escHtml(p.lokasi_kode || "N/A")}
    </div>`);
  };
  map.on("click", "ruas-line", ruasClickHandler);
}

function addRambuLayer(forceReadd = false) {
  if (!rambuGeoJSON) return;

  if (!forceReadd && map.getSource("rambu")) {
    map.getSource("rambu").setData(rambuGeoJSON);
    updateRambuVisibility();
    return;
  }

  if (forceReadd) {
    if (rambuHitboxClickHandler) map.off("click", "rambu-hitbox", rambuHitboxClickHandler);
    if (rambuHitboxEnterHandler) map.off("mouseenter", "rambu-hitbox", rambuHitboxEnterHandler);
    if (rambuHitboxLeaveHandler) map.off("mouseleave", "rambu-hitbox", rambuHitboxLeaveHandler);
    if (rambuPointsEnterHandler) map.off("mouseenter", "rambu-points", rambuPointsEnterHandler);
    if (rambuPointsLeaveHandler) map.off("mouseleave", "rambu-points", rambuPointsLeaveHandler);
  }

  if (map.getSource("rambu")) {
    if (map.getLayer("rambu-points")) map.removeLayer("rambu-points");
    if (map.getLayer("rambu-hitbox")) map.removeLayer("rambu-hitbox");
    map.removeSource("rambu");
  }

  map.addSource("rambu", { type: "geojson", data: rambuGeoJSON });
  map.addLayer({
    id: "rambu-points", type: "circle", source: "rambu",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 6, 16, 9, 20, 12],
      "circle-color": [
        "match", ["get", "kelas_jalan"],
        "I", KELAS_COLORS["I"],
        "II", KELAS_COLORS["II"],
        "III", KELAS_COLORS["III"],
        "#94a3b8"
      ],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#0f172a",
      "circle-opacity": 0.95
    }
  });
  map.addLayer({
    id: "rambu-hitbox", type: "circle", source: "rambu",
    paint: { "circle-radius": 14, "circle-color": "transparent", "circle-stroke-width": 0 }
  });

  rambuHitboxClickHandler = (e) => {
    if (!e.features.length) return;
    const html = config.popup(e.features[0]);
    showPopup(map, e.lngLat, html, { maxWidth: "340px" });
  };
  rambuHitboxEnterHandler = () => { map.getCanvas().style.cursor = "pointer"; };
  rambuHitboxLeaveHandler = () => { map.getCanvas().style.cursor = ""; };
  rambuPointsEnterHandler = () => { map.getCanvas().style.cursor = "pointer"; };
  rambuPointsLeaveHandler = () => { map.getCanvas().style.cursor = ""; };

  map.on("click", "rambu-hitbox", rambuHitboxClickHandler);
  map.on("mouseenter", "rambu-hitbox", rambuHitboxEnterHandler);
  map.on("mouseleave", "rambu-hitbox", rambuHitboxLeaveHandler);
  map.on("mouseenter", "rambu-points", rambuPointsEnterHandler);
  map.on("mouseleave", "rambu-points", rambuPointsLeaveHandler);

  updateRambuVisibility();
}

function reAddLayers() {
  if (jaringanGeoJSON) addJaringanLayer(true);
  if (ruasGeoJSON) addRuasLayer(true);
  if (rambuGeoJSON) addRambuLayer(true);
  if (jaringanGeoJSON || ruasGeoJSON || rambuGeoJSON) {
    updateRambuVisibility();
  }
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function updateRambuVisibility() {
  if (!map.getLayer("rambu-points")) return;

  const filterExpr = ["all",
    ["in", ["get", "kelas_jalan"], ["literal", Array.from(activeKelas)]]
  ];

  map.setFilter("rambu-points", filterExpr);
  map.setFilter("rambu-hitbox", filterExpr);

  // Update filtered count
  const filteredFeatures = rambuGeoJSON ? rambuGeoJSON.features.filter(f => {
    const kelas = f.properties.kelas_jalan || "";
    return activeKelas.has(kelas);
  }) : [];

  if (filteredCount) filteredCount.textContent = filteredFeatures.length.toLocaleString();
}

// ═══════════════════════════════════════════════════════════
// STATS & LEGEND
// ═══════════════════════════════════════════════════════════
function updateStats() {
  if (statJaringan) statJaringan.textContent = jaringanGeoJSON ? jaringanGeoJSON.features.length.toLocaleString() : "0";
  if (statRambu) statRambu.textContent = rambuGeoJSON ? rambuGeoJSON.features.length.toLocaleString() : "0";
  if (statRuas) statRuas.textContent = ruasGeoJSON ? ruasGeoJSON.features.length.toLocaleString() : "0";

  let arteriCount = 0, kolektorCount = 0;
  if (jaringanGeoJSON) {
    jaringanGeoJSON.features.forEach(f => {
      const jenis = (f.properties.jenis || f.properties.nama_jenis || "").toLowerCase();
      if (jenis.includes("arteri")) arteriCount++;
      else if (jenis.includes("kolektor")) kolektorCount++;
      else arteriCount++;
    });
  }
  if (statArteri) statArteri.textContent = arteriCount.toLocaleString();
  if (statKolektor) statKolektor.textContent = kolektorCount.toLocaleString();

  // Total badge
  const total = (rambuGeoJSON ? rambuGeoJSON.features.length : 0) +
                (jaringanGeoJSON ? jaringanGeoJSON.features.length : 0) +
                (ruasGeoJSON ? ruasGeoJSON.features.length : 0);
  if (totalBadge) totalBadge.textContent = total.toLocaleString();

  // Filter count
  if (totalRambuCount) totalRambuCount.textContent = rambuGeoJSON ? rambuGeoJSON.features.length.toLocaleString() : "0";
  if (filteredCount) filteredCount.textContent = rambuGeoJSON ? rambuGeoJSON.features.length.toLocaleString() : "0";

  // Legend
  if (legendRoads) {
    legendRoads.innerHTML = `
      <div class="legend-row"><span class="legend-color" style="background:${RUAS_COLOR}"></span><span>Ruas Jalan Provinsi</span></div>
      <div class="legend-row"><span class="legend-color" style="background:${ARTERI_COLOR}"></span><span>Jaringan Arteri</span></div>
      <div class="legend-row"><span class="legend-color" style="background:${KOLEKTOR_COLOR}"></span><span>Jaringan Kolektor</span></div>
      <div class="legend-row" style="margin-top:4px;"><span class="legend-dot" style="background:${KELAS_COLORS["I"]}"></span><span>Rambu Kelas I</span></div>
      <div class="legend-row"><span class="legend-dot" style="background:${KELAS_COLORS["II"]}"></span><span>Rambu Kelas II</span></div>
      <div class="legend-row"><span class="legend-dot" style="background:${KELAS_COLORS["III"]}"></span><span>Rambu Kelas III</span></div>
    `;
  }
}

function fitBounds() {
  const valid = (c) => c && isFinite(c[0]) && isFinite(c[1]) && c[0] >= 104 && c[0] <= 110 && c[1] >= -9.5 && c[1] <= -4.5;
  const coords = [];
  [jaringanGeoJSON, rambuGeoJSON, ruasGeoJSON].forEach(gj => {
    if (!gj) return;
    gj.features.forEach(f => {
      if (f.geometry.type === "Point") {
        if (valid(f.geometry.coordinates)) coords.push(f.geometry.coordinates);
      } else {
        const flat = f.geometry.coordinates.flat(2);
        for (let i = 0; i + 1 < flat.length; i += 2) {
          const c = [flat[i], flat[i + 1]];
          if (valid(c)) coords.push(c);
        }
      }
    });
  });
  if (coords.length) {
    const bounds = new maplibregl.LngLatBounds();
    coords.forEach(c => bounds.extend(c));
    flyToBounds(map, bounds, { padding: 50, minZoom: 9, maxZoom: 14, duration: 1500 });
  }
}

// ═══════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════
function showUI() {
  if (panel) panel.style.display = "block";

  if (rambuGeoJSON && kelasFilter) {
    kelasFilter.innerHTML = "";
    ["I", "II", "III"].forEach(k => {
      const btn = document.createElement("button");
      btn.className = "filter-btn active";
      btn.dataset.value = k;
      btn.textContent = k;
      kelasFilter.appendChild(btn);
    });
  }
}

// ═══════════════════════════════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════════════════════════════
async function handleFiles(files) {
  const fileArr = Array.from(files);
  const jaringanFile = fileArr.find(f => f.name.includes("jaringan"));
  const rambuFile = fileArr.find(f => f.name.includes("rambu"));
  const ruasFile = fileArr.find(f => f.name.includes("ruas") || f.name.includes("jalan"));

  if (!jaringanFile && !rambuFile && !ruasFile) {
    fileStatus.className = "status err";
    fileStatus.textContent = "Need jaringan_jalan.parquet / rambu_kelas_jalan.parquet / ruas_jalan.parquet";
    return;
  }

  try {
    if (jaringanFile) {
      fileStatus.className = "status loading";
      fileStatus.textContent = `Loading ${jaringanFile.name} (streaming)...`;
      jaringanGeoJSON = await loadParquetToGeoJSON(jaringanFile, (batch, total) => {
        fileStatus.textContent = `Jaringan: batch ${batch}, ${total} features...`;
      });
      addJaringanLayer();
    }

    if (rambuFile) {
      fileStatus.className = "status loading";
      fileStatus.textContent = `Loading ${rambuFile.name} (streaming)...`;
      rambuGeoJSON = await loadParquetToGeoJSON(rambuFile, (batch, total) => {
        fileStatus.textContent = `Rambu: batch ${batch}, ${total} features...`;
      });
      addRambuLayer();
    }

    if (ruasFile) {
      fileStatus.className = "status loading";
      fileStatus.textContent = `Loading ${ruasFile.name} (streaming)...`;
      ruasGeoJSON = await loadParquetToGeoJSON(ruasFile, (batch, total) => {
        fileStatus.textContent = `Ruas: batch ${batch}, ${total} features...`;
      });
      addRuasLayer();
    }

    fileDrop.classList.add("loaded");
    fileStatus.className = "status ok";
    const parts = [];
    if (jaringanGeoJSON) parts.push(`${jaringanGeoJSON.features.length} jaringan`);
    if (rambuGeoJSON) parts.push(`${rambuGeoJSON.features.length} rambu`);
    if (ruasGeoJSON) parts.push(`${ruasGeoJSON.features.length} ruas`);
    fileStatus.textContent = `Loaded ${parts.join(", ")}`;

    showUI();
    updateStats();
    fitBounds();
  } catch (err) {
    console.error("handleFiles error:", err);
    fileStatus.className = "status err";
    fileStatus.textContent = `Error: ${err.message}`;
  }
}

// ═══════════════════════════════════════════════════════════
// DOM CREATION
// ═══════════════════════════════════════════════════════════
function createDOM() {
  const mapContainer = document.getElementById("map");

  // Panel
  panel = document.createElement("div");
  panel.id = "panel";
  panel.innerHTML = `
    <div id="sheet-handle" aria-hidden="true"></div>
    <div id="panel-header">
      <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg></span>
      <h1>Peta Rambu Kelas</h1>
      <span class="badge" id="total-badge">0</span>
      <button id="panel-toggle" title="Minimalkan panel" aria-label="Minimalkan panel" aria-expanded="true"><svg viewBox="0 0 512 512" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 81.4 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg></button>
    </div>
    <div id="panel-body">
      <div class="stats-row">
        <div class="stat-card"><div class="label">Rambu</div><div class="value red" id="stat-rambu">0</div></div>
        <div class="stat-card"><div class="label">Ruas Jalan</div><div class="value purple" id="stat-ruas">0</div></div>
      </div>
      <div class="stats-row triple">
        <div class="stat-card"><div class="label">Jaringan</div><div class="value blue" id="stat-jaringan">0</div></div>
        <div class="stat-card"><div class="label">Arteri</div><div class="value red" id="stat-arteri">0</div></div>
        <div class="stat-card"><div class="label">Kolektor</div><div class="value orange" id="stat-kolektor">0</div></div>
      </div>

      <div class="section">
        <div class="section-title">Filter</div>
        <div class="filter-group">
          <div class="filter-label">Kelas Jalan</div>
          <div class="filter-options" id="kelas-filter">
            <button class="filter-btn active" data-value="I">I</button>
            <button class="filter-btn active" data-value="II">II</button>
            <button class="filter-btn active" data-value="III">III</button>
          </div>
        </div>
        <div id="filter-count">Menampilkan <strong id="filtered-count">0</strong> dari <strong id="total-rambu-count">0</strong> rambu</div>
      </div>

      <div class="section">
        <div class="section-title">Data File</div>
        <div id="file-drop">
          <p>Drag & drop <strong>jaringan_jalan.parquet</strong> + <strong>rambu_kelas_jalan.parquet</strong> + <strong>ruas_jalan.parquet</strong></p>
          <p style="margin-top:3px;font-size:10px;color:#64748b;">or click to select</p>
          <input type="file" id="file-input" multiple accept=".parquet" style="display:none;" />
          <div class="status" id="file-status"></div>
        </div>
      </div>
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
  kelasFilter = document.getElementById("kelas-filter");
  filterCount = document.getElementById("filter-count");
  filteredCount = document.getElementById("filtered-count");
  totalRambuCount = document.getElementById("total-rambu-count");
  statRambu = document.getElementById("stat-rambu");
  statRuas = document.getElementById("stat-ruas");
  statJaringan = document.getElementById("stat-jaringan");
  statArteri = document.getElementById("stat-arteri");
  statKolektor = document.getElementById("stat-kolektor");
  totalBadge = document.getElementById("total-badge");

  // Legend
  legendEl = document.createElement("div");
  legendEl.id = "legend";
  legendEl.innerHTML = `<h4>Legenda</h4><div id="legend-roads"></div>`;
  mapContainer.appendChild(legendEl);
  legendRoads = document.getElementById("legend-roads");

  // Drop overlay
  dropOverlay = document.createElement("div");
  dropOverlay.id = "drop-overlay";
  dropOverlay.innerHTML = `
    <div class="box">
      <h2>Drop .parquet files here</h2>
      <p>jaringan_jalan.parquet + rambu_kelas_jalan.parquet + ruas_jalan.parquet</p>
    </div>
  `;
  document.body.appendChild(dropOverlay);
}

function removeDOM() {
  if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  if (legendEl && legendEl.parentNode) legendEl.parentNode.removeChild(legendEl);
  if (dropOverlay && dropOverlay.parentNode) dropOverlay.parentNode.removeChild(dropOverlay);
  panel = panelHeader = panelBody = panelToggle = sheetHandle = null;
  fileDrop = fileInput = fileStatus = null;
  kelasFilter = filterCount = filteredCount = totalRambuCount = null;
  statRambu = statRuas = statJaringan = statArteri = statKolektor = null;
  totalBadge = null;
  legendEl = legendRoads = null;
  dropOverlay = null;
}

// ═══════════════════════════════════════════════════════════
// PANEL COLLAPSE (simplified — no drag gesture)
// ═══════════════════════════════════════════════════════════
function syncPanelToggle() {
  const isMobile = window.matchMedia("(max-width: 600px)").matches;
  if (!panelHeader.dataset.userToggled) {
    panel.classList.toggle("collapsed", isMobile);
    if (panelToggle) {
      panelToggle.setAttribute("aria-expanded", String(!isMobile));
      panelToggle.title = isMobile ? "Buka panel" : "Minimalkan panel";
    }
    applySheetTransform(false);
  }
}

function applySheetTransform(animate = true) {
  const mq = window.matchMedia("(max-width: 600px)").matches;
  if (!mq) { panel.style.transform = ""; return; }
  panel.style.transition = animate ? "" : "none";
  const collapsedH = (sheetHandle?.offsetHeight || 0) + (panelHeader?.offsetHeight || 0);
  panel.style.transform = panel.classList.contains("collapsed")
    ? `translateY(calc(100% - ${collapsedH}px))`
    : "translateY(0px)";
  if (!animate) requestAnimationFrame(() => { panel.style.transition = ""; });
}

function sheetSetOpen(open, animate = true) {
  panelHeader.dataset.userToggled = "1";
  panel.classList.toggle("collapsed", !open);
  applySheetTransform(animate);
  if (panelToggle) {
    panelToggle.title = open ? "Minimalkan panel" : "Buka panel";
    panelToggle.setAttribute("aria-expanded", String(open));
  }
}

// ═══════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════
function setupFilters() {
  kelasFilterClickHandler = (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    const val = btn.dataset.value;
    btn.classList.toggle("active");
    if (activeKelas.has(val)) activeKelas.delete(val); else activeKelas.add(val);
    updateRambuVisibility();
  };
  kelasFilter.addEventListener("click", kelasFilterClickHandler);
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

function setupPanel() {
  panelToggleClickHandler = (e) => {
    e.stopPropagation();
    sheetSetOpen(panel.classList.contains("collapsed"), true);
  };
  panelToggle.addEventListener("click", panelToggleClickHandler);

  sheetHeaderClickHandler = (e) => {
    if (e.target.closest("button")) return;
    sheetSetOpen(panel.classList.contains("collapsed"), true);
  };
  panelHeader.addEventListener("click", sheetHeaderClickHandler);

  resizeHandler = () => { syncPanelToggle(); };
  window.addEventListener("resize", resizeHandler);
  syncPanelToggle();
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

    const jaringanUrl = new URL('data/jaringan_jalan.parquet', import.meta.url);
    const rambuUrl = new URL('data/rambu_kelas_jalan.parquet', import.meta.url);
    const ruasUrl = new URL('data/ruas_jalan.parquet', import.meta.url);

    const [jaringanResult, rambuResult, ruasResult] = await Promise.allSettled([
      loadParquetToGeoJSON(jaringanUrl, () => Loading.heartbeat?.()),
      loadParquetToGeoJSON(rambuUrl, () => Loading.heartbeat?.()),
      loadParquetToGeoJSON(ruasUrl, () => Loading.heartbeat?.())
    ]);

    if (jaringanResult.status === "fulfilled") {
      jaringanGeoJSON = jaringanResult.value;
    } else {
      console.error("Failed to load jaringan:", jaringanResult.reason);
    }

    if (rambuResult.status === "fulfilled") {
      rambuGeoJSON = rambuResult.value;
    } else {
      console.error("Failed to load rambu:", rambuResult.reason);
    }

    if (ruasResult.status === "fulfilled") {
      ruasGeoJSON = ruasResult.value;
    } else {
      console.error("Failed to load ruas:", ruasResult.reason);
    }

    Loading.hide();

    createDOM();
    addJaringanLayer();
    addRuasLayer();
    addRambuLayer();
    showUI();
    updateStats();
    setupFilters();
    setupDragDrop();
    setupPanel();

    // Shared searchbar: search rambu by kode_ruas / nama_ruas
    if (ctx?.search?.registerSearch && rambuGeoJSON) {
      ctx.search.registerSearch({
        placeholder: "Cari rambu / kode ruas...",
        onQuery: async (q) => {
          const term = q.toLowerCase();
          const matches = rambuGeoJSON.features.filter(f => {
            const nama = String(f.properties.nama_ruas || "").toLowerCase();
            const kode = String(f.properties.kode_ruas || "").toLowerCase();
            return nama.includes(term) || kode.includes(term);
          }).slice(0, 8);
          return matches.map(f => {
            const p = f.properties;
            const c = f.geometry?.coordinates;
            return {
              title: p.nama_ruas || "Rambu",
              subtitle: `Kode ${p.kode_ruas || "-"} · Kelas ${p.kelas_jalan || "-"}`,
              action: () => {
                if (!c) return;
                map.flyTo({ center: c, zoom: 15, duration: 800, essential: true });
                showPopup(map, c, config.popup(f), { maxWidth: "320px" });
              },
            };
          });
        },
      });
    }

    if (jaringanGeoJSON && rambuGeoJSON && ruasGeoJSON) {
      fileDrop.classList.add("loaded");
      fileStatus.className = "status ok";
      const parts = [
        `${jaringanGeoJSON.features.length} jaringan`,
        `${rambuGeoJSON.features.length} rambu`,
        `${ruasGeoJSON.features.length} ruas`
      ];
      fileStatus.textContent = `Auto-loaded ${parts.join(", ")}`;

      // Fly to data bounds
      setTimeout(() => {
        fitBounds();
      }, 500);
    }

    styleLoadHandler = () => {
      if (!map.getSource("arteri") || !map.getSource("kolektor") || !map.getSource("ruas") || !map.getSource("rambu")) {
        reAddLayers();
      }
    };
    map.on("style.load", styleLoadHandler);
    basemapChangedHandler = () => {
      if (!map.getSource("arteri") || !map.getSource("kolektor") || !map.getSource("ruas") || !map.getSource("rambu")) {
        reAddLayers();
      }
    };
    map.on("basemap-changed", basemapChangedHandler);
  },

  teardown() {
    if (!map) return;

    // Remove style.load listener
    if (styleLoadHandler) {
      map.off("style.load", styleLoadHandler);
      styleLoadHandler = null;
    }
    if (basemapChangedHandler) {
      map.off("basemap-changed", basemapChangedHandler);
      basemapChangedHandler = null;
    }

    // Remove map event handlers
    if (arteriClickHandler) {
      map.off("click", "arteri-line", arteriClickHandler);
      arteriClickHandler = null;
    }
    if (kolektorClickHandler) {
      map.off("click", "kolektor-line", kolektorClickHandler);
      kolektorClickHandler = null;
    }
    if (ruasClickHandler) {
      map.off("click", "ruas-line", ruasClickHandler);
      ruasClickHandler = null;
    }
    if (rambuHitboxClickHandler) {
      map.off("click", "rambu-hitbox", rambuHitboxClickHandler);
      rambuHitboxClickHandler = null;
    }
    if (rambuHitboxEnterHandler) {
      map.off("mouseenter", "rambu-hitbox", rambuHitboxEnterHandler);
      rambuHitboxEnterHandler = null;
    }
    if (rambuHitboxLeaveHandler) {
      map.off("mouseleave", "rambu-hitbox", rambuHitboxLeaveHandler);
      rambuHitboxLeaveHandler = null;
    }
    if (rambuPointsEnterHandler) {
      map.off("mouseenter", "rambu-points", rambuPointsEnterHandler);
      rambuPointsEnterHandler = null;
    }
    if (rambuPointsLeaveHandler) {
      map.off("mouseleave", "rambu-points", rambuPointsLeaveHandler);
      rambuPointsLeaveHandler = null;
    }

    // Remove layers (reverse order)
    const layerIds = ["rambu-hitbox", "rambu-points", "ruas-line", "kolektor-line", "arteri-line"];
    for (const id of layerIds) {
      if (map.getLayer(id)) map.removeLayer(id);
    }

    // Remove sources
    if (map.getSource("rambu")) map.removeSource("rambu");
    if (map.getSource("ruas")) map.removeSource("ruas");
    if (map.getSource("kolektor")) map.removeSource("kolektor");
    if (map.getSource("arteri")) map.removeSource("arteri");

    // Clear popup
    closePopup();

    // Remove document/window listeners
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
    if (dragEnterHandler) {
      document.body.removeEventListener("dragenter", dragEnterHandler);
      dragEnterHandler = null;
    }
    if (dragLeaveHandler) {
      document.body.removeEventListener("dragleave", dragLeaveHandler);
      dragLeaveHandler = null;
    }
    if (dragOverHandler) {
      document.body.removeEventListener("dragover", dragOverHandler);
      dragOverHandler = null;
    }
    if (dropHandler) {
      document.body.removeEventListener("drop", dropHandler);
      dropHandler = null;
    }

    // Remove DOM
    removeDOM();

    // Reset state
    jaringanGeoJSON = null;
    rambuGeoJSON = null;
    ruasGeoJSON = null;
    activeKelas = new Set(["I", "II", "III"]);
    dragCounter = 0;
    map = null;
  }
};
