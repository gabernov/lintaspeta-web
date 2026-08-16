import { initParquet, loadParquetToGeoJSON } from "../../shared-core/js/parquet-loader.js";
import { flyToBounds, flyToCoords, showPopup, closePopup, geometryBounds } from "../../shared-core/js/map-core.js";
import { escHtml, toast, Loading, initBottomSheet } from "../../shared-core/js/ui-core.js";
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
let schoolsGeoJSON = null;
let activeFilters = new Set();
let hoveredSchoolId = null;
let dragCounter = 0;

const dataFilters = {
  jenjang: new Set(),
  status: new Set(),
  validasi: new Set(),
  kabupaten: "",
  uptd: "",
};
const JENJANG_TOTAL = 5;
const STATUS_TOTAL = 2;
const VALIDASI_TOTAL = 2;

let xlsxLoading = false;
let xlsxLoaded = false;

// ═══════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════
let panel, panelHeader, panelBody, panelToggle, sheetHandle, sheetTeardown;
let fileDrop, fileInput, fileStatus;
let uptdList, legendEl, legendRoads;
let dropOverlay;
let filterToggle, filterToggleLabel, sliderRow, distSlider, distVal;
let visibleCount, totalCount, schoolBadge, exportBtn;
let statsTotal, statsBarFill;
let statsJenjang, statsStatus, statsValidasi, statsKab, statsUptd;
let statsKabToggle, statsUptdToggle, statsKabChevron, statsUptdChevron;
let kabupatenFilter, uptdFilter;
let dataFilterSection, filterSection, uptdSection, distLegendSection;
let filterJenjang, filterStatus, filterValidasi;

// ═══════════════════════════════════════════════════════════
// HANDLER REFS (for teardown)
// ═══════════════════════════════════════════════════════════
let styleLoadHandler = null;
let basemapChangedHandler = null;
let schoolMouseEnterHandler = null;
let schoolMouseMoveHandler = null;
let schoolMouseLeaveHandler = null;
let schoolClickHandler = null;
let filterToggleChangeHandler = null;
let distSliderInputHandler = null;
let kabupatenChangeHandler = null;
let uptdChangeHandler = null;
let exportClickHandler = null;
let fileDropClickHandler = null;
let fileInputChangeHandler = null;
let dragEnterHandler = null;
let dragLeaveHandler = null;
let dragOverHandler = null;
let dropHandler = null;
let statsKabToggleHandler = null;
let statsUptdToggleHandler = null;
let filterBtnClickHandler = null;
let sectionClickHandler = null;

// ═══════════════════════════════════════════════════════════
// LAYERS
// ═══════════════════════════════════════════════════════════
function addRoadsLayer(forceReadd = false) {
  if (!forceReadd && map.getSource("roads")) {
    map.getSource("roads").setData(roadsGeoJSON);
    return;
  }

  if (map.getSource("roads")) {
    if (map.getLayer("roads-line")) map.removeLayer("roads-line");
    map.removeSource("roads");
  }

  map.addSource("roads", { type: "geojson", data: roadsGeoJSON });
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
}

function addSchoolsLayer(forceReadd = false) {
  if (!forceReadd && map.getSource("schools")) {
    map.getSource("schools").setData(schoolsGeoJSON);
    updateFilters();
    return;
  }

  if (forceReadd) {
    if (schoolMouseEnterHandler) map.off("mouseenter", "schools-circle", schoolMouseEnterHandler);
    if (schoolMouseMoveHandler) map.off("mousemove", "schools-circle", schoolMouseMoveHandler);
    if (schoolMouseLeaveHandler) map.off("mouseleave", "schools-circle", schoolMouseLeaveHandler);
    if (schoolClickHandler) map.off("click", "schools-circle", schoolClickHandler);
  }

  if (map.getSource("schools")) {
    if (map.getLayer("schools-circle")) map.removeLayer("schools-circle");
    map.removeSource("schools");
  }

  map.addSource("schools", { type: "geojson", data: schoolsGeoJSON, promoteId: "NPSN" });
  map.addLayer({
    id: "schools-circle", type: "circle", source: "schools",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 12, 6, 16, 8, 20, 10],
      "circle-color": [
        "case",
        ["==", ["get", "distance_m"], null], "#6b7280",
        ["interpolate", ["linear"], ["get", "distance_m"],
          0, "#2166ac", 50, "#67a9cf", 60, "#d1e5f0",
          100, "#fddbc7", 150, "#ef8a62", 200, "#b2182b", 600, "#b2182b"
        ]
      ],
      "circle-stroke-color": "white",
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0.5],
      "circle-opacity": 0.9
    }
  });

  schoolMouseEnterHandler = () => { map.getCanvas().style.cursor = "pointer"; };
  schoolMouseMoveHandler = (e) => {
    if (!e.features.length) return;
    if (hoveredSchoolId !== null) map.setFeatureState({ source: "schools", id: hoveredSchoolId }, { hover: false });
    hoveredSchoolId = e.features[0].id;
    map.setFeatureState({ source: "schools", id: hoveredSchoolId }, { hover: true });
  };
  schoolMouseLeaveHandler = () => {
    map.getCanvas().style.cursor = "";
    if (hoveredSchoolId !== null) {
      map.setFeatureState({ source: "schools", id: hoveredSchoolId }, { hover: false });
      hoveredSchoolId = null;
    }
  };
  schoolClickHandler = (e) => {
    if (!e.features.length) return;
    const p = e.features[0].properties;
    const html = config.popup(e.features[0]);
    showPopup(map, e.lngLat, html, { maxWidth: "320px" });
  };

  map.on("mouseenter", "schools-circle", schoolMouseEnterHandler);
  map.on("mousemove", "schools-circle", schoolMouseMoveHandler);
  map.on("mouseleave", "schools-circle", schoolMouseLeaveHandler);
  map.on("click", "schools-circle", schoolClickHandler);
}

function reAddLayers() {
  if (roadsGeoJSON) addRoadsLayer(true);
  if (schoolsGeoJSON) addSchoolsLayer(true);
  if (roadsGeoJSON || schoolsGeoJSON) {
    updateRoadVisibility();
    updateFilters();
  }
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function updateRoadVisibility() {
  if (!map.getLayer("roads-line")) return;
  if (activeFilters.size >= 4) map.setFilter("roads-line", null);
  else map.setFilter("roads-line", ["in", ["get", "unit_kerja_kode"], ["literal", Array.from(activeFilters)]]);
}

function updateFilters() {
  if (!map.getLayer("schools-circle")) return;

  const filterOn = filterToggle.checked;
  const maxDist = Number(distSlider.value);
  distVal.textContent = maxDist + "m";

  const conditions = [];

  if (filterOn) {
    conditions.push(["<=", ["coalesce", ["get", "distance_m"], 99999], maxDist]);
  }

  if (activeFilters.size > 0 && activeFilters.size < 4) {
    conditions.push(["in", ["get", "nearest_road_unit_kerja"], ["literal", Array.from(activeFilters)]]);
  }

  if (dataFilters.jenjang.size > 0 && dataFilters.jenjang.size < JENJANG_TOTAL) {
    conditions.push(["in", ["get", "Jenjang"], ["literal", Array.from(dataFilters.jenjang)]]);
  }

  if (dataFilters.status.size > 0 && dataFilters.status.size < STATUS_TOTAL) {
    const statusValues = Array.from(dataFilters.status).map(v => v.toUpperCase());
    conditions.push(["in", ["upcase", ["get", "STATUS"]], ["literal", statusValues]]);
  }

  if (dataFilters.validasi.size > 0 && dataFilters.validasi.size < VALIDASI_TOTAL) {
    conditions.push(["in", ["get", "Validasi"], ["literal", Array.from(dataFilters.validasi)]]);
  }

  if (dataFilters.kabupaten) {
    conditions.push(["==", ["get", "KABUPATEN"], dataFilters.kabupaten]);
  }

  if (dataFilters.uptd) {
    conditions.push(["==", ["get", "nearest_road_unit_kerja"], dataFilters.uptd]);
  }

  if (conditions.length === 0) {
    map.setFilter("schools-circle", null);
  } else if (conditions.length === 1) {
    map.setFilter("schools-circle", conditions[0]);
  } else {
    map.setFilter("schools-circle", ["all", ...conditions]);
  }

  const total = schoolsGeoJSON ? schoolsGeoJSON.features.length : 0;
  const visibleFeatures = schoolsGeoJSON ? schoolsGeoJSON.features.filter(f => {
    const p = f.properties;
    if (filterOn) {
      const d = p.distance_m;
      if (d == null || d > maxDist) return false;
    }
    if (activeFilters.size > 0 && activeFilters.size < 4 && !activeFilters.has(p.nearest_road_unit_kerja)) return false;
    if (dataFilters.jenjang.size > 0 && dataFilters.jenjang.size < JENJANG_TOTAL && !dataFilters.jenjang.has(p.Jenjang)) return false;
    if (dataFilters.status.size > 0 && dataFilters.status.size < STATUS_TOTAL && !dataFilters.status.has((p.STATUS || '').toUpperCase())) return false;
    if (dataFilters.validasi.size > 0 && dataFilters.validasi.size < VALIDASI_TOTAL && !dataFilters.validasi.has(p.Validasi)) return false;
    if (dataFilters.kabupaten && p.KABUPATEN !== dataFilters.kabupaten) return false;
    if (dataFilters.uptd && p.nearest_road_unit_kerja !== dataFilters.uptd) return false;
    return true;
  }) : [];
  const visible = visibleFeatures.length;

  visibleCount.textContent = visible.toLocaleString();
  totalCount.textContent = total.toLocaleString();
  schoolBadge.textContent = visible.toLocaleString();
  exportBtn.textContent = `⬇ Export ${visible.toLocaleString()} to XLSX`;

  statsTotal.textContent = visible.toLocaleString();
  statsTotal.nextElementSibling.textContent = `of ${total.toLocaleString()} schools`;
  statsBarFill.style.width = total > 0 ? ((visible / total) * 100) + "%" : "0%";

  const jCounts = {}, sCounts = {}, vCounts = {}, kCounts = {}, uCounts = {};
  visibleFeatures.forEach(f => {
    const p = f.properties;
    const j = p.Jenjang || "?";
    jCounts[j] = (jCounts[j] || 0) + 1;
    const s = (p.STATUS || "?").toUpperCase();
    sCounts[s] = (sCounts[s] || 0) + 1;
    const v = p.Validasi || "Belum Diverifikasi";
    vCounts[v] = (vCounts[v] || 0) + 1;
    const k = p.KABUPATEN || "?";
    kCounts[k] = (kCounts[k] || 0) + 1;
    const u = p.nearest_road_unit_kerja || "Tidak Diketahui";
    uCounts[u] = (uCounts[u] || 0) + 1;
  });

  const jOrder = ["SD", "SMP", "SMA", "SMK", "SLB"];
  statsJenjang.innerHTML = jOrder.filter(k => jCounts[k]).map(k =>
    `<div class="stats-chip jenjang-${k.toLowerCase()}"><span class="chip-label">${k}</span><span class="chip-count">${jCounts[k].toLocaleString()}</span></div>`
  ).join("");

  const sOrder = ["NEGERI", "SWASTA"];
  statsStatus.innerHTML = sOrder.filter(k => sCounts[k] != null).map(k =>
    `<div class="stats-chip status-${k.toLowerCase()}"><span class="chip-label">${k.charAt(0) + k.slice(1).toLowerCase()}</span><span class="chip-count">${sCounts[k].toLocaleString()}</span></div>`
  ).join("");

  const vOrder = [["Valid", "valid"], ["Tidak Valid", "tidak-valid"], ["Belum Diverifikasi", "belum"]];
  statsValidasi.innerHTML = vOrder.filter(([k]) => vCounts[k]).map(([k, cls]) =>
    `<div class="stats-chip ${cls}"><span class="chip-label">${k}</span><span class="chip-count">${vCounts[k].toLocaleString()}</span></div>`
  ).join("");

  const kSorted = Object.entries(kCounts).sort((a, b) => b[1] - a[1]);
  statsKab.innerHTML = kSorted.map(([k, c]) =>
    `<div class="stats-chip kab"><span class="chip-label">${k}</span><span class="chip-count">${c.toLocaleString()}</span></div>`
  ).join("");
  statsKabToggle.querySelector("span:first-child").textContent =
    `Per Kota/Kabupaten (${kSorted.length})`;

  const uSorted = Object.entries(uCounts).sort((a, b) => b[1] - a[1]);
  statsUptd.innerHTML = uSorted.map(([k, c]) =>
    `<div class="stats-chip kab"><span class="chip-label">${k}</span><span class="chip-count">${c.toLocaleString()}</span></div>`
  ).join("");
  statsUptdToggle.querySelector("span:first-child").textContent =
    `Per UPTD (${uSorted.length})`;
}

// ═══════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════
function showUI() {
  dataFilterSection.style.display = "block";
  filterSection.style.display = "block";
  uptdSection.style.display = "block";
  distLegendSection.style.display = "block";

  if (schoolsGeoJSON) {
    const kabupatenSet = new Set();
    const uptdSet = new Set();
    schoolsGeoJSON.features.forEach(f => {
      if (f.properties.KABUPATEN) kabupatenSet.add(f.properties.KABUPATEN);
      if (f.properties.nearest_road_unit_kerja) uptdSet.add(f.properties.nearest_road_unit_kerja);
    });
    kabupatenFilter.innerHTML = '<option value="">Semua</option>';
    Array.from(kabupatenSet).sort((a, b) => a.localeCompare(b, "id")).forEach(kab => {
      const opt = document.createElement("option");
      opt.value = kab;
      opt.textContent = kab;
      kabupatenFilter.appendChild(opt);
    });
    uptdFilter.innerHTML = '<option value="">Semua</option>';
    Array.from(uptdSet).sort().forEach(u => {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      uptdFilter.appendChild(opt);
    });
  }

  if (roadsGeoJSON) {
    exportBtn.style.display = "block";
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
      item.innerHTML = `<input type="checkbox" checked data-code="${code}" /><span class="color-dot"></span><span class="name">${code}</span><span class="count">${count} roads</span>`;
      item.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) activeFilters.add(code); else activeFilters.delete(code);
        updateRoadVisibility(); updateFilters();
      });
      uptdList.appendChild(item);
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `<span class="legend-color" style="background:${color}"></span><span>${code}</span>`;
      legendRoads.appendChild(row);
    });
  }
  updateFilters();
}

function updateStats() {
  updateFilters();
}

function fitBounds() {
  const valid = (c) => c && isFinite(c[0]) && isFinite(c[1]) && c[0] >= 104 && c[0] <= 110 && c[1] >= -9.5 && c[1] <= -4.5;
  const coords = [];
  if (roadsGeoJSON) roadsGeoJSON.features.forEach(f => {
    const flat = f.geometry.coordinates.flat(2);
    for (let i = 0; i + 1 < flat.length; i += 2) {
      if (valid([flat[i], flat[i + 1]])) coords.push([flat[i], flat[i + 1]]);
    }
  });
  if (schoolsGeoJSON) schoolsGeoJSON.features.forEach(f => {
    if (valid(f.geometry.coordinates)) coords.push(f.geometry.coordinates);
  });
  if (coords.length) {
    const bounds = new maplibregl.LngLatBounds();
    coords.forEach(c => bounds.extend(c));
    flyToBounds(map, bounds, { padding: 40, minZoom: 9 });
  }
}

// ═══════════════════════════════════════════════════════════
// XLSX EXPORT (lazy load)
// ═══════════════════════════════════════════════════════════
async function ensureXLSX() {
  if (xlsxLoaded) return true;
  if (xlsxLoading) {
    while (xlsxLoading) await new Promise(r => setTimeout(r, 50));
    return xlsxLoaded;
  }
  xlsxLoading = true;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    xlsxLoaded = true;
    return true;
  } catch (e) {
    console.error("Failed to load XLSX:", e);
    toast("Gagal memuat library XLSX");
    return false;
  } finally {
    xlsxLoading = false;
  }
}

function exportFilteredSchools() {
  if (!schoolsGeoJSON || typeof XLSX === "undefined") return;

  const filterOn = filterToggle.checked;
  const maxDist = Number(distSlider.value);

  const filtered = schoolsGeoJSON.features.filter(f => {
    const p = f.properties;
    if (filterOn) {
      const d = p.distance_m;
      if (d == null || d > maxDist) return false;
    }
    if (activeFilters.size > 0 && activeFilters.size < 4 && !activeFilters.has(p.nearest_road_unit_kerja)) return false;
    if (dataFilters.jenjang.size > 0 && dataFilters.jenjang.size < JENJANG_TOTAL && !dataFilters.jenjang.has(p.Jenjang)) return false;
    if (dataFilters.status.size > 0 && dataFilters.status.size < STATUS_TOTAL && !dataFilters.status.has((p.STATUS || '').toUpperCase())) return false;
    if (dataFilters.validasi.size > 0 && dataFilters.validasi.size < VALIDASI_TOTAL && !dataFilters.validasi.has(p.Validasi)) return false;
    if (dataFilters.kabupaten && p.KABUPATEN !== dataFilters.kabupaten) return false;
    if (dataFilters.uptd && p.nearest_road_unit_kerja !== dataFilters.uptd) return false;
    return true;
  });

  const skipKeys = new Set(["geometry", "geometry_bbox", "wkb_geometry", "geom"]);
  const allKeys = [];
  filtered.forEach(f => {
    for (const k of Object.keys(f.properties)) {
      if (!skipKeys.has(k) && !allKeys.includes(k)) allKeys.push(k);
    }
  });

  const sanitizeKey = k => k.replace(/[/\\]/g, "_").replace(/[<>&"']/g, "");

  const rows = filtered.map(f => {
    const row = {};
    allKeys.forEach(k => {
      let val = f.properties[k];
      if (typeof val === "boolean") val = val ? "Ya" : "Tidak";
      if (typeof val === "number" && (!isFinite(val) || isNaN(val))) val = null;
      row[sanitizeKey(k)] = val ?? "";
    });
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Filtered Schools");

  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `sekolah_terfilter_${filtered.length}_baris_${dateStr}_${timeStr}.xlsx`;

  XLSX.writeFile(wb, filename);
}

// ═══════════════════════════════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════════════════════════════
async function handleFiles(files) {
  const fileArr = Array.from(files);
  const roadsFile = fileArr.find(f => f.name.includes("jalan") || f.name.includes("ruas"));
  const schoolsFile = fileArr.find(f => f.name.includes("sekolah") || f.name.includes("school"));

  if (!roadsFile && !schoolsFile) {
    fileStatus.className = "status err";
    fileStatus.textContent = "Need ruas_jalan.parquet + sekolah_merged.parquet";
    return;
  }

  try {
    if (roadsFile) {
      fileStatus.className = "status loading";
      fileStatus.textContent = `Loading ${roadsFile.name} (streaming)...`;
      roadsGeoJSON = await loadParquetToGeoJSON(roadsFile, (batch, total) => {
        fileStatus.textContent = `Roads: batch ${batch}, ${total} features...`;
      });
      addRoadsLayer();
    }

    if (schoolsFile) {
      fileStatus.className = "status loading";
      fileStatus.textContent = `Loading ${schoolsFile.name} (streaming)...`;
      schoolsGeoJSON = await loadParquetToGeoJSON(schoolsFile, (batch, total) => {
        fileStatus.textContent = `Schools: batch ${batch}, ${total} features...`;
      });
      addSchoolsLayer();
    }

    if (roadsGeoJSON && schoolsGeoJSON) {
      fileDrop.classList.add("loaded");
      fileStatus.className = "status ok";
      fileStatus.textContent = `Loaded ${roadsGeoJSON.features.length} roads, ${schoolsGeoJSON.features.length} schools`;
      showUI(); updateStats(); fitBounds();
    } else if (roadsGeoJSON) {
      fileStatus.className = "status ok";
      fileStatus.textContent = `Loaded ${roadsGeoJSON.features.length} roads. Drop schools next.`;
    } else if (schoolsGeoJSON) {
      fileStatus.className = "status ok";
      fileStatus.textContent = `Loaded ${schoolsGeoJSON.features.length} schools. Drop roads next.`;
    }
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
      <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"/></svg></span>
      <h1>Peta Sekolah Jabar</h1>
      <span class="badge" id="school-badge">0</span>
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
    <div id="panel-body">
      <div id="stats-panel">
        <div id="stats-header">
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
            <span style="font-size:16px;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"/></svg></span>
            <span id="stats-total">0</span>
            <span>of 0 schools</span>
          </div>
          <div id="stats-bar-track">
            <div id="stats-bar-fill"></div>
          </div>
        </div>
        <div class="stats-group" id="stats-jenjang-group">
          <div class="stats-group-label">Per Jenjang</div>
          <div class="stats-chips" id="stats-jenjang"></div>
        </div>
        <div class="stats-group" id="stats-status-group">
          <div class="stats-group-label">Per Status</div>
          <div class="stats-chips" id="stats-status"></div>
        </div>
        <div class="stats-group" id="stats-validasi-group">
          <div class="stats-group-label">Per Validasi</div>
          <div class="stats-chips" id="stats-validasi"></div>
        </div>
        <div class="stats-group" id="stats-kab-group">
          <div class="stats-group-label" style="cursor:pointer; user-select:none;" id="stats-kab-toggle">
            <span>Per Kota/Kabupaten</span>
            <span class="chevron" id="stats-kab-chevron">▸</span>
          </div>
          <div class="stats-chips" id="stats-kab" style="display:none; max-height:180px; overflow-y:auto;"></div>
        </div>
        <div class="stats-group" id="stats-uptd-group">
          <div class="stats-group-label" style="cursor:pointer; user-select:none;" id="stats-uptd-toggle">
            <span>Per UPTD</span>
            <span class="chevron" id="stats-uptd-chevron">▸</span>
          </div>
          <div class="stats-chips" id="stats-uptd" style="display:none; max-height:180px; overflow-y:auto;"></div>
        </div>
      </div>

      <div class="section" data-section="files">
        <div class="section-title"><span class="chevron">▸</span> Data Files</div>
        <div class="section-content">
          <div id="file-drop">
            <p>Drag & drop <strong>ruas_jalan.parquet</strong> + <strong>sekolah_merged.parquet</strong></p>
            <p style="margin-top:4px;font-size:11px;color:#64748b;">or click to select files</p>
            <input type="file" id="file-input" multiple accept=".parquet" style="display:none;" />
            <div class="status" id="file-status"></div>
          </div>
        </div>
      </div>

      <div class="section collapsed" id="data-filter-section" data-section="filters" style="display:none;">
        <div class="section-title"><span class="chevron">▸</span> Data Filters</div>
        <div class="section-content">
          <div class="filter-group">
            <div class="filter-label">Jenjang</div>
            <div class="filter-toggles" id="filter-jenjang">
              <button class="filter-btn" data-category="jenjang" data-value="SD">SD</button>
              <button class="filter-btn" data-category="jenjang" data-value="SMP">SMP</button>
              <button class="filter-btn" data-category="jenjang" data-value="SMA">SMA</button>
              <button class="filter-btn" data-category="jenjang" data-value="SMK">SMK</button>
              <button class="filter-btn" data-category="jenjang" data-value="SLB">SLB</button>
            </div>
          </div>
          <div class="filter-group">
            <div class="filter-label">Status</div>
            <div class="filter-toggles" id="filter-status">
              <button class="filter-btn" data-category="status" data-value="NEGERI">Negeri</button>
              <button class="filter-btn" data-category="status" data-value="SWASTA">Swasta</button>
            </div>
          </div>
          <div class="filter-group">
            <div class="filter-label">Validasi Manual</div>
            <div class="filter-toggles" id="filter-validasi">
              <button class="filter-btn" data-category="validasi" data-value="Valid">Valid</button>
              <button class="filter-btn" data-category="validasi" data-value="Tidak Valid">Tidak Valid</button>
            </div>
          </div>
          <div class="filter-group">
            <div class="filter-label">Kota/Kabupaten</div>
            <select id="kabupaten-filter" class="filter-select">
              <option value="">Semua</option>
            </select>
          </div>
          <div class="filter-group">
            <div class="filter-label">UPTD</div>
            <select id="uptd-filter" class="filter-select">
              <option value="">Semua</option>
            </select>
          </div>
        </div>
      </div>

      <div class="section" id="filter-section" data-section="distance" style="display:none;">
        <div class="section-title"><span class="chevron">▸</span> Distance Filter</div>
        <div class="section-content">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <label class="toggle">
              <input type="checkbox" id="filter-toggle" />
              <span class="toggle-slider"></span>
            </label>
            <span style="font-size:12px; color:#94a3b8;" id="filter-toggle-label">Filter OFF</span>
          </div>
          <div class="slider-row" id="slider-row">
            <label>Max distance</label>
            <input type="range" id="dist-slider" min="0" max="600" value="60" step="10" />
            <span class="val" id="dist-val">60m</span>
          </div>
          <div id="filter-count">
            Showing <strong id="visible-count">0</strong> of <strong id="total-count">0</strong> schools
          </div>
          <button id="export-btn" style="display:none;">
            ⬇ Export 0 to XLSX
          </button>
        </div>
      </div>

      <div class="section collapsed" id="uptd-section" data-section="uptd" style="display:none;">
        <div class="section-title"><span class="chevron">▸</span> Road Management (UPTD)</div>
        <div class="section-content">
          <div class="uptd-list" id="uptd-list"></div>
        </div>
      </div>

      <div class="section" id="dist-legend-section" data-section="legend" style="display:none;">
        <div class="section-title"><span class="chevron">▸</span> Distance Legend</div>
        <div class="section-content">
          <div class="legend-gradient" style="background: linear-gradient(to right, #2166ac, #67a9cf, #d1e5f0, #fddbc7, #ef8a62, #b2182b);"></div>
          <div class="legend-labels">
            <span>0m</span><span>50m</span><span>60m</span><span>100m</span><span>150m</span><span>200m</span><span>600m+</span>
          </div>
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
  uptdList = document.getElementById("uptd-list");
  filterToggle = document.getElementById("filter-toggle");
  filterToggleLabel = document.getElementById("filter-toggle-label");
  sliderRow = document.getElementById("slider-row");
  distSlider = document.getElementById("dist-slider");
  distVal = document.getElementById("dist-val");
  visibleCount = document.getElementById("visible-count");
  totalCount = document.getElementById("total-count");
  schoolBadge = document.getElementById("school-badge");
  exportBtn = document.getElementById("export-btn");
  statsTotal = document.getElementById("stats-total");
  statsBarFill = document.getElementById("stats-bar-fill");
  statsJenjang = document.getElementById("stats-jenjang");
  statsStatus = document.getElementById("stats-status");
  statsValidasi = document.getElementById("stats-validasi");
  statsKab = document.getElementById("stats-kab");
  statsUptd = document.getElementById("stats-uptd");
  statsKabToggle = document.getElementById("stats-kab-toggle");
  statsUptdToggle = document.getElementById("stats-uptd-toggle");
  statsKabChevron = document.getElementById("stats-kab-chevron");
  statsUptdChevron = document.getElementById("stats-uptd-chevron");
  kabupatenFilter = document.getElementById("kabupaten-filter");
  uptdFilter = document.getElementById("uptd-filter");
  dataFilterSection = document.getElementById("data-filter-section");
  filterSection = document.getElementById("filter-section");
  uptdSection = document.getElementById("uptd-section");
  distLegendSection = document.getElementById("dist-legend-section");
  filterJenjang = document.getElementById("filter-jenjang");
  filterStatus = document.getElementById("filter-status");
  filterValidasi = document.getElementById("filter-validasi");

  // Legend
  legendEl = document.createElement("div");
  legendEl.id = "legend";
  legendEl.innerHTML = `
    <h4>Road by UPTD</h4>
    <div id="legend-roads"></div>
    <div style="margin-top:10px;">
      <h4>School by Distance</h4>
      <div class="legend-gradient" style="background: linear-gradient(to right, #2166ac, #67a9cf, #d1e5f0, #fddbc7, #ef8a62, #b2182b); height:8px;"></div>
      <div class="legend-labels"><span>0m</span><span>50m</span><span>60m</span><span>100m</span><span>200m</span><span>600m+</span></div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
        <span style="width:10px;height:10px;border-radius:50%;background:#6b7280;"></span>
        <span style="font-size:10px;color:#64748b;">N/A (unmatched)</span>
      </div>
    </div>
  `;
  mapContainer.appendChild(legendEl);
  legendRoads = document.getElementById("legend-roads");

  // Drop overlay
  dropOverlay = document.createElement("div");
  dropOverlay.id = "drop-overlay";
  dropOverlay.innerHTML = `
    <div class="box">
      <h2>Drop .parquet files here</h2>
      <p>ruas_jalan.parquet + sekolah_merged.parquet</p>
    </div>
  `;
  document.body.appendChild(dropOverlay);
}

function removeDOM() {
  if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  if (legendEl && legendEl.parentNode) legendEl.parentNode.removeChild(legendEl);
  if (dropOverlay && dropOverlay.parentNode) dropOverlay.parentNode.removeChild(dropOverlay);
  panel = panelHeader = panelBody = null;
  fileDrop = fileInput = fileStatus = uptdList = legendEl = legendRoads = null;
  dropOverlay = null;
  filterToggle = filterToggleLabel = sliderRow = distSlider = distVal = null;
  visibleCount = totalCount = schoolBadge = exportBtn = null;
  statsTotal = statsBarFill = statsJenjang = statsStatus = statsValidasi = statsKab = statsUptd = null;
  statsKabToggle = statsUptdToggle = statsKabChevron = statsUptdChevron = null;
  kabupatenFilter = uptdFilter = null;
  dataFilterSection = filterSection = uptdSection = distLegendSection = null;
  filterJenjang = filterStatus = filterValidasi = null;
}

// ═══════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════
function setupFilters() {
  filterBtnClickHandler = (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    const category = btn.dataset.category;
    const value = btn.dataset.value;
    const filterSet = dataFilters[category];
    if (!filterSet) return;

    if (filterSet.has(value)) {
      filterSet.delete(value);
      btn.classList.remove("active");
    } else {
      filterSet.add(value);
      btn.classList.add("active");
    }
    updateFilters();
  };
  filterJenjang.addEventListener("click", filterBtnClickHandler);
  filterStatus.addEventListener("click", filterBtnClickHandler);
  filterValidasi.addEventListener("click", filterBtnClickHandler);

  kabupatenChangeHandler = (e) => {
    dataFilters.kabupaten = e.target.value;
    updateFilters();
  };
  kabupatenFilter.addEventListener("change", kabupatenChangeHandler);

  uptdChangeHandler = (e) => {
    dataFilters.uptd = e.target.value;
    updateFilters();
  };
  uptdFilter.addEventListener("change", uptdChangeHandler);

  filterToggleChangeHandler = () => {
    const on = filterToggle.checked;
    filterToggleLabel.textContent = on ? "Filter ON" : "Filter OFF";
    sliderRow.classList.toggle("disabled", !on);
    updateFilters();
  };
  filterToggle.addEventListener("change", filterToggleChangeHandler);

  distSliderInputHandler = () => {
    distVal.textContent = distSlider.value + "m";
    updateFilters();
  };
  distSlider.addEventListener("input", distSliderInputHandler);

  statsKabToggleHandler = () => {
    const el = statsKab;
    const open = el.style.display !== "none";
    el.style.display = open ? "none" : "flex";
    statsKabChevron.classList.toggle("open", !open);
  };
  statsKabToggle.addEventListener("click", statsKabToggleHandler);

  statsUptdToggleHandler = () => {
    const el = statsUptd;
    const open = el.style.display !== "none";
    el.style.display = open ? "none" : "flex";
    statsUptdChevron.classList.toggle("open", !open);
  };
  statsUptdToggle.addEventListener("click", statsUptdToggleHandler);

  exportClickHandler = async () => {
    const ok = await ensureXLSX();
    if (ok) exportFilteredSchools();
  };
  exportBtn.addEventListener("click", exportClickHandler);
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

function setupCollapsible() {
  sectionClickHandler = (e) => {
    const title = e.target.closest(".section-title");
    if (!title) return;
    const section = title.closest(".section");
    if (!section) return;
    section.classList.toggle("collapsed");
    const key = section.dataset.section || section.id || "";
    if (key) {
      try { sessionStorage.setItem("section-" + key, section.classList.contains("collapsed") ? "1" : "0"); } catch(e) {}
    }
  };
  panelBody.addEventListener("click", sectionClickHandler);

  // Restore collapsed state
  panelBody.querySelectorAll(".section[data-section]").forEach(s => {
    const key = s.dataset.section;
    if (!key) return;
    try {
      if (sessionStorage.getItem("section-" + key) === "1") {
        s.classList.add("collapsed");
      }
    } catch(e) {}
  });
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
    const roadsUrl = new URL('data/ruas_jalan.parquet', import.meta.url);
    const schoolsUrl = new URL('data/sekolah_merged.parquet', import.meta.url);

    const [roadsResult, schoolsResult] = await Promise.allSettled([
      loadParquetToGeoJSON(roadsUrl, () => Loading.heartbeat?.()),
      loadParquetToGeoJSON(schoolsUrl, () => Loading.heartbeat?.())
    ]);

    if (roadsResult.status === "fulfilled") {
      roadsGeoJSON = roadsResult.value;
    } else {
      console.error("Failed to load roads:", roadsResult.reason);
    }

    if (schoolsResult.status === "fulfilled") {
      schoolsGeoJSON = schoolsResult.value;
    } else {
      console.error("Failed to load schools:", schoolsResult.reason);
    }

    Loading.hide();

    createDOM();
    if (roadsGeoJSON) addRoadsLayer();
    if (schoolsGeoJSON) addSchoolsLayer();
    showUI();
    updateStats();
    setupFilters();
    setupDragDrop();
    setupCollapsible();
    // Shared bottom sheet: toggle + swipe-to-open/collapse on mobile.
    sheetTeardown = initBottomSheet({ panel, handle: sheetHandle, toggle: panelToggle, header: panelHeader });

    // Shared searchbar: search schools by name / NPSN
    if (ctx?.search?.registerSearch && schoolsGeoJSON) {
      ctx.search.registerSearch({
        placeholder: "Cari sekolah / NPSN...",
        onQuery: async (q) => {
          const term = q.toLowerCase();
          const matches = schoolsGeoJSON.features.filter(f => {
            const nama = String(f.properties["NAMA SEKOLAH"] || "").toLowerCase();
            const npsn = String(f.properties.NPSN || "");
            return nama.includes(term) || npsn.includes(q);
          }).slice(0, 8);
          return matches.map(f => {
            const p = f.properties;
            const c = f.geometry?.coordinates;
            return {
              title: p["NAMA SEKOLAH"] || "Sekolah",
              subtitle: `${p.Jenjang || ""} · ${p.KABUPATEN || ""} · NPSN ${p.NPSN || "-"}`,
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

    if (roadsGeoJSON && schoolsGeoJSON) {
      fileDrop.classList.add("loaded");
      fileStatus.className = "status ok";
      fileStatus.textContent = `Auto-loaded ${roadsGeoJSON.features.length} roads, ${schoolsGeoJSON.features.length} schools`;

      // Fly from globe view to data bounds
      setTimeout(() => {
        try {
          const bounds = new maplibregl.LngLatBounds();
          const valid = (c) => c && isFinite(c[0]) && isFinite(c[1]) && c[0] >= 104 && c[0] <= 110 && c[1] >= -9.5 && c[1] <= -4.5;
          schoolsGeoJSON.features.forEach(f => {
            const c = f.geometry?.coordinates;
            if (c && valid(c)) bounds.extend(c);
          });
          if (roadsGeoJSON) roadsGeoJSON.features.forEach(f => {
            const flat = f.geometry?.coordinates?.flat(2);
            if (flat) for (let i = 0; i + 1 < flat.length; i += 2) {
              if (valid([flat[i], flat[i + 1]])) bounds.extend([flat[i], flat[i + 1]]);
            }
          });
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 60, minZoom: 9, maxZoom: 12, duration: 2000 });
          }
        } catch (e) {
          console.error("Fly-to error:", e);
        }
      }, 500);
    }

    styleLoadHandler = () => {
      if (!map.getSource("roads") || !map.getSource("schools")) {
        reAddLayers();
      }
    };
    map.on("style.load", styleLoadHandler);
    basemapChangedHandler = () => {
      if (!map.getSource("roads") || !map.getSource("schools")) reAddLayers();
    };
    map.on("basemap-changed", basemapChangedHandler);
  },

  teardown() {
    if (!map) return;

    if (styleLoadHandler) {
      map.off("style.load", styleLoadHandler);
      styleLoadHandler = null;
    }
    if (basemapChangedHandler) {
      map.off("basemap-changed", basemapChangedHandler);
      basemapChangedHandler = null;
    }

    if (schoolMouseEnterHandler) {
      map.off("mouseenter", "schools-circle", schoolMouseEnterHandler);
      schoolMouseEnterHandler = null;
    }
    if (schoolMouseMoveHandler) {
      map.off("mousemove", "schools-circle", schoolMouseMoveHandler);
      schoolMouseMoveHandler = null;
    }
    if (schoolMouseLeaveHandler) {
      map.off("mouseleave", "schools-circle", schoolMouseLeaveHandler);
      schoolMouseLeaveHandler = null;
    }
    if (schoolClickHandler) {
      map.off("click", "schools-circle", schoolClickHandler);
      schoolClickHandler = null;
    }

    if (map.getLayer("schools-circle")) map.removeLayer("schools-circle");
    if (map.getSource("schools")) map.removeSource("schools");

    if (map.getLayer("roads-line")) map.removeLayer("roads-line");
    if (map.getSource("roads")) map.removeSource("roads");

    closePopup();

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

    // Shared bottom sheet teardown (header/handle/toggle listeners)
    if (sheetTeardown) {
      sheetTeardown();
      sheetTeardown = null;
    }

    removeDOM();

    roadsGeoJSON = null;
    schoolsGeoJSON = null;
    activeFilters.clear();
    dataFilters.jenjang.clear();
    dataFilters.status.clear();
    dataFilters.validasi.clear();
    dataFilters.kabupaten = "";
    dataFilters.uptd = "";
    hoveredSchoolId = null;
    dragCounter = 0;
    xlsxLoaded = false;
    xlsxLoading = false;
    map = null;
  }
};
