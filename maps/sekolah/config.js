import { escHtml } from "../../shared-core/js/ui-core.js";

export const UPTD_COLORS = {
  "UPTD-I": "#E11D48",
  "UPTD-II": "#2563EB",
  "UPTD-III": "#059669",
  "UPTD-IV": "#7C3AED",
};
export const UPTD_DEFAULT = "#6B7280";

export default {
  id: 'sekolah',
  title: 'Peta Sekolah',
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"/></svg>',
  dataFiles: ['data/ruas_jalan.parquet', 'data/sekolah_merged.parquet'],
  defaultView: { center: [107.5, -6.9], zoom: 8 },
  defaultBasemap: 'bright',
  sources: [
    { id: 'roads', type: 'geojson', dataRef: 0 },
    { id: 'schools', type: 'geojson', dataRef: 1 }
  ],
  layers: [
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
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2.5, 16, 4, 20, 6],
        "line-opacity": 0.85
      }
    },
    {
      id: "schools-circle",
      type: "circle",
      source: "schools",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2, 12, 4, 16, 7, 20, 10],
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
    const dist = p.distance_m != null ? Number(p.distance_m).toFixed(1) + "m" : "N/A";

    const schoolFields = [
      ["NAMA SEKOLAH", "School Name"],
      ["NPSN", "NPSN"],
      ["BENTUK", "Type"],
      ["Jenjang", "Level"],
      ["NAMA DUSUN", "Hamlet"],
      ["DESA/KELURAHAN", "Village"],
      ["KECAMATAN", "District"],
      ["KABUPATEN", "Regency"],
      ["PROVINSI", "Province"],
      ["KODE POS", "Postal Code"],
      ["LINTANG", "Latitude"],
      ["BUJUR", "Longitude"],
      ["STATUS", "Status"],
      ["AKREDITASI", "Accreditation"],
      ["SUMBER LISTRIK", "Power Source"],
      ["AKSES INTERNET", "Internet Access"],
      ["SUMBER AIR", "Water Source"],
      ["KECUKUPAN AIR", "Water Sufficiency"],
    ];

    const validatedFields = [
      ["Validasi", "Validation"],
      ["Tipe_Jalan", "Road Type"],
      ["Lebar_Lajur", "Lane Width"],
      ["Tipe_ZoSS", "ZoSS Type"],
      ["Sudah_ZOSS", "Has ZoSS"],
      ["Lokasi_Gerbang", "Gate Location"],
      ["Keterangan", "Notes"],
    ];

    const roadFields = [
      ["nearest_road_name", "Road Name"],
      ["nearest_road_kode", "Road Code"],
      ["nearest_road_id", "Road ID"],
      ["nearest_road_panjang_km", "Road Length (km)"],
      ["nearest_road_unit_kerja", "UPTD"],
    ];

    let html = `<div style="font-size:12px; line-height:1.5; max-height:400px; overflow-y:auto;">`;
    html += `<div style="font-size:14px; font-weight:700; color:#2563EB; margin-bottom:8px;">${escHtml(p["NAMA SEKOLAH"] || "School")}</div>`;

    html += `<div style="margin-bottom:8px;">`;
    schoolFields.forEach(([key, label]) => {
      if (p[key] != null && p[key] !== "") {
        html += `<div><span style="color:#64748b;">${escHtml(label)}:</span> <b>${escHtml(p[key])}</b></div>`;
      }
    });
    html += `</div>`;

    html += `<div style="background:#0f172a; padding:6px 8px; border-radius:4px; margin-bottom:8px;">`;
      html += `<div><span style="color:#64748b;">Distance to Road:</span> <b style="color:#2563EB;">${escHtml(dist)}</b></div>`;
    html += `</div>`;

    html += `<div style="border-top:1px solid #334155; padding-top:6px;">`;
    html += `<div style="font-weight:600; color:#94a3b8; margin-bottom:4px;">Nearest Road</div>`;
    roadFields.forEach(([key, label]) => {
      if (p[key] != null && p[key] !== "") {
        html += `<div><span style="color:#64748b;">${escHtml(label)}:</span> <b>${escHtml(p[key])}</b></div>`;
      }
    });
    html += `</div>`;

    const hasValidation = validatedFields.some(([key]) => p[key] != null && p[key] !== "");
    if (hasValidation) {
      html += `<div style="border-top:1px solid #334155; padding-top:6px; margin-top:6px;">`;
      html += `<div style="font-weight:600; color:#fbbf24; margin-bottom:4px;">Validation Data</div>`;
      validatedFields.forEach(([key, label]) => {
        if (p[key] != null && p[key] !== "") {
          let val = p[key];
          let color = "#e2e8f0";
          if (key === "Validasi") {
            color = val === "Valid" ? "#22c55e" : "#ef4444";
          }
          html += `<div><span style="color:#64748b;">${escHtml(label)}:</span> <b style="color:${color};">${escHtml(val)}</b></div>`;
        }
      });
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  },
  stats: [
    { label: "Total Schools", compute: (fc) => fc.features.length.toLocaleString() },
    { label: "With Road Match", compute: (fc) => fc.features.filter(f => f.properties?.distance_m != null).length.toLocaleString() },
    { label: "Jenjang Types", compute: (fc) => new Set(fc.features.map(f => f.properties?.Jenjang).filter(Boolean)).size },
    { label: "Kab/Kota", compute: (fc) => new Set(fc.features.map(f => f.properties?.KABUPATEN).filter(Boolean)).size },
  ],
};
