import { escHtml } from "../../shared-core/js/ui-core.js";

export const UPTD_COLORS = {
  "UPTD-I": "#E11D48",
  "UPTD-II": "#2563EB",
  "UPTD-III": "#059669",
  "UPTD-IV": "#7C3AED",
};
export const UPTD_DEFAULT = "#6B7280";

export default {
  id: 'ruas-jalan',
  title: 'Peta Jalan Provinsi',
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0z"/></svg>',
  dataFiles: ['data/ruas_jalan.parquet'],
  defaultView: { center: [107.5, -6.9], zoom: 8 },
  defaultBasemap: 'liberty',
  sources: [{ id: 'roads', type: 'geojson', dataRef: 0 }],
  layers: [
    {
      id: "roads-hitbox",
      type: "line",
      source: "roads",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "transparent", "line-width": 14 }
    },
    {
      id: "roads-line",
      type: "line",
      source: "roads",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": [
          "match", ["get", "unit_kerja_kode"],
          "UPTD-I", UPTD_COLORS["UPTD-I"],
          "UPTD-II", UPTD_COLORS["UPTD-II"],
          "UPTD-III", UPTD_COLORS["UPTD-III"],
          "UPTD-IV", UPTD_COLORS["UPTD-IV"],
          UPTD_DEFAULT
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 12, 2.5, 16, 4, 20, 6],
        "line-opacity": 0.85
      }
    },
    {
      id: "roads-selected",
      type: "line",
      source: "roads",
      layout: { "line-join": "round", "line-cap": "round" },
      filter: ["==", ["id"], -999],
      paint: {
        "line-color": "#2563EB",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 12, 7, 16, 10, 20, 14],
        "line-opacity": 1
      }
    }
  ],
  legend: [
    { label: "UPTD-I", color: UPTD_COLORS["UPTD-I"], type: "line" },
    { label: "UPTD-II", color: UPTD_COLORS["UPTD-II"], type: "line" },
    { label: "UPTD-III", color: UPTD_COLORS["UPTD-III"], type: "line" },
    { label: "UPTD-IV", color: UPTD_COLORS["UPTD-IV"], type: "line" },
  ],
  popup: (feature) => {
    const p = feature.properties;
    const color = UPTD_COLORS[p.unit_kerja_kode] || UPTD_DEFAULT;
    return `<div>
      <b style="font-size:14px;">${escHtml(p.nama || "Jalan")}</b><br/>
      <span style="color:#94a3b8;">${escHtml(p.kode_number || "")}</span><br/><br/>
      <b>Kode:</b> ${escHtml(p.kode || "N/A")}<br/>
      <b>Panjang:</b> ${escHtml(p.panjang_km || "N/A")} km<br/>
      <b>Status:</b> ${escHtml(p.status || "N/A")}<br/>
      <b>UPTD:</b> <span style="color:${color};font-weight:700;">${escHtml(p.unit_kerja_kode || "N/A")}</span><br/>
      <b>Lokasi:</b> ${escHtml(p.lokasi_kode || "N/A")}
    </div>`;
  },
  stats: [
    { label: "Total Ruas", compute: (fc) => fc.features.length.toLocaleString() },
    { label: "Total KM", compute: (fc) => fc.features.reduce((sum, f) => sum + (parseFloat(f.properties?.panjang_km) || 0), 0).toFixed(1) },
    { label: "UPTD Active", compute: (fc) => new Set(fc.features.map(f => f.properties?.unit_kerja_kode).filter(Boolean)).size },
    { label: "Kab/Kota", compute: (fc) => new Set(fc.features.map(f => f.properties?.kode).filter(Boolean)).size },
  ],
};
