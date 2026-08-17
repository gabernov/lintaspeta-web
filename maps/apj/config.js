import { escHtml } from "../../shared-core/js/ui-core.js";

export const UPTD_COLORS = {
  "UPTD 1": "#E11D48",
  "UPTD 2": "#2563EB",
  "UPTD 3": "#059669",
  "UPTD 4": "#7C3AED",
};
export const UPTD_DEFAULT = "#6B7280";

export const KONDISI_COLORS = {
  "Baik": "#22C55E",
  "Rusak Ringan": "#F59E0B",
  "Rusak Berat": "#EF4444",
  "Rusak": "#EF4444",
  "Mati": "#0F172A",
};

export default {
  id: "apj",
  title: "Peta APJ",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25M5.25 12H3m15 0h2.25M6.34 6.34l-1.591-1.591m14.903 0l-1.591 1.591M12 18.75V21M8.25 12a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 15.75h4.5v2.25a1.5 1.5 0 01-1.5 1.5h-1.5a1.5 1.5 0 01-1.5-1.5v-2.25z"/></svg>',
  // Filterable attribute columns (in order shown in the panel).
  // type: "multi" = toggle list; "single" = dropdown; "chips" = selectable chips.
  filterFields: [
    { key: "UPTD", label: "UPTD", type: "multi" },
    { key: "Kabupaten/Kota", label: "Kab/Kota", type: "single" },
    { key: "Kondisi", label: "Kondisi", type: "chips" },
    { key: "Jenis_PJU", label: "Jenis APJ", type: "chips" },
    { key: "Jenis_Tian", label: "Jenis Tiang", type: "chips" },
    { key: "Bahan_Tian", label: "Bahan", type: "chips" },
    { key: "Jenis_Lamp", label: "Jenis Lamp", type: "chips" },
    { key: "Tahun_Angg", label: "Tahun", type: "chips" },
    { key: "Posisi_Tia", label: "Posisi", type: "chips" },
  ],
  dataFiles: [
    "data/pju_detail.parquet",
    "data/ruas_apj.parquet",
  ],
  defaultView: { center: [107.6, -6.9], zoom: 8 },
  defaultBasemap: "liberty",
  sources: [
    { id: "pju-points", type: "geojson", dataRef: 0 },
    { id: "apj-roads", type: "geojson", dataRef: 1 },
  ],
  layers: [
    // Roads (under points)
    {
      id: "apj-roads-line",
      type: "line",
      source: "apj-roads",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": [
          "match", ["get", "unit_kerja_kode"],
          "UPTD-I", UPTD_COLORS["UPTD 1"],
          "UPTD-II", UPTD_COLORS["UPTD 2"],
          "UPTD-III", UPTD_COLORS["UPTD 3"],
          "UPTD-IV", UPTD_COLORS["UPTD 4"],
          "#94A3B8"
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 2, 16, 3, 20, 4],
        "line-opacity": 0.6
      }
    },
    // PJU points — sized by zoom, colored by condition
    {
      id: "pju-circle",
      type: "circle",
      source: "pju-points",
      paint: {
        "circle-color": [
          "match", ["get", "Kondisi"],
          "Baik", KONDISI_COLORS["Baik"],
          "Rusak Ringan", KONDISI_COLORS["Rusak Ringan"],
          "Rusak Berat", KONDISI_COLORS["Rusak Berat"],
          "Rusak", KONDISI_COLORS["Rusak"],
          "Mati", KONDISI_COLORS["Mati"],
          "#22C55E"
        ],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 5, 16, 7, 20, 9],
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(255,255,255,0.7)",
        "circle-opacity": 0.85
      }
    },
    // PJU hitbox (easier click target)
    {
      id: "pju-hitbox",
      type: "circle",
      source: "pju-points",
      paint: {
        "circle-color": "transparent",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 10, 16, 12, 20, 14]
      }
    },
  ],
  legend: [
    { label: "Baik", color: KONDISI_COLORS["Baik"], type: "dot" },
    { label: "Rusak Ringan", color: KONDISI_COLORS["Rusak Ringan"], type: "dot" },
    { label: "Rusak Berat", color: KONDISI_COLORS["Rusak Berat"], type: "dot" },
    { label: "Mati", color: KONDISI_COLORS["Mati"], type: "dot" },
  ],
  popup: (feature) => {
    const p = feature.properties;
    const kond = KONDISI_COLORS[p.Kondisi] ? `<span style="color:${KONDISI_COLORS[p.Kondisi]};font-weight:700;">${escHtml(p.Kondisi || "-")}</span>` : escHtml(p.Kondisi || "-");
    const uptd = UPTD_COLORS[p.UPTD] ? `<span style="color:${UPTD_COLORS[p.UPTD]};font-weight:700;">${escHtml(p.UPTD || "-")}</span>` : escHtml(p.UPTD || "-");
    return `<div>
      <b style="font-size:14px;">${escHtml(p["Nama Ruas (Resmi)"] || "APJ")}</b><br/>
      <span style="color:#94a3b8;">${escHtml(p["Id_Tiang"] || "")}</span><br/><br/>
      <b>UPTD:</b> ${uptd}<br/>
      <b>Kab/Kota:</b> ${escHtml(p["Kabupaten/Kota"] || "-")}<br/>
      <b>Kondisi:</b> ${kond}<br/>
      <b>Jenis APJ:</b> ${escHtml(p["Jenis_PJU"] || "-")}<br/>
      <b>Jenis Tiang:</b> ${escHtml(p["Jenis_Tian"] || "-")}<br/>
      <b>Bahan:</b> ${escHtml(p["Bahan_Tian"] || "-")}<br/>
      <b>Jenis Lamp:</b> ${escHtml(p["Jenis_Lamp"] || "-")}<br/>
      <b>Tahun:</b> ${escHtml(p["Tahun_Angg"] || "-")}<br/>
      <b>Posisi:</b> ${escHtml(p["Posisi_Tia"] || "-")}
    </div>`;
  },
  stats: [
    { label: "Total Titik", compute: (fc) => fc[0].features.length.toLocaleString() },
    { label: "Total Ruas", compute: (fc) => fc[1].features.length.toLocaleString() },
    { label: "UPTD", compute: (fc) => new Set(fc[0].features.map(f => f.properties?.UPTD).filter(Boolean)).size },
    { label: "Kab/Kota", compute: (fc) => new Set(fc[0].features.map(f => f.properties?.["Kabupaten/Kota"]).filter(Boolean)).size },
  ],
};
