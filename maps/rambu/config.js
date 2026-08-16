import { escHtml } from "../../shared-core/js/ui-core.js";

export const KELAS_COLORS = { "I": "#EF4444", "II": "#F97316", "III": "#8B5CF6" };
export const ARTERI_COLOR = "#EF4444";
export const KOLEKTOR_COLOR = "#F97316";
export const RUAS_COLOR = "#8B5CF6";

export default {
  id: 'rambu',
  title: 'Peta Rambu',
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>',
  dataFiles: ['data/jaringan_jalan.parquet', 'data/rambu_kelas_jalan.parquet', 'data/ruas_jalan.parquet'],
  defaultView: { center: [107.5, -6.9], zoom: 8 },
  defaultBasemap: 'dark',
  sources: [
    { id: 'arteri', type: 'geojson', dataRef: 0 },
    { id: 'kolektor', type: 'geojson', dataRef: 0 },
    { id: 'rambu', type: 'geojson', dataRef: 1 },
    { id: 'ruas', type: 'geojson', dataRef: 2 }
  ],
  layers: [
    {
      id: "arteri-line",
      type: "line",
      source: "arteri",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ARTERI_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2, 16, 3.5, 20, 5],
        "line-opacity": 0.85
      }
    },
    {
      id: "kolektor-line",
      type: "line",
      source: "kolektor",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": KOLEKTOR_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2, 16, 3.5, 20, 5],
        "line-opacity": 0.85
      }
    },
    {
      id: "ruas-line",
      type: "line",
      source: "ruas",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": RUAS_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 3, 16, 5, 20, 7],
        "line-opacity": 0.9
      }
    },
    {
      id: "rambu-points",
      type: "circle",
      source: "rambu",
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
    },
    {
      id: "rambu-hitbox",
      type: "circle",
      source: "rambu",
      paint: { "circle-radius": 14, "circle-color": "transparent", "circle-stroke-width": 0 }
    }
  ],
  legend: [
    { label: "Ruas Jalan Provinsi", color: RUAS_COLOR, type: "line" },
    { label: "Jaringan Arteri", color: ARTERI_COLOR, type: "line" },
    { label: "Jaringan Kolektor", color: KOLEKTOR_COLOR, type: "line" },
    { label: "Rambu Kelas I", color: KELAS_COLORS["I"], type: "dot" },
    { label: "Rambu Kelas II", color: KELAS_COLORS["II"], type: "dot" },
    { label: "Rambu Kelas III", color: KELAS_COLORS["III"], type: "dot" },
  ],
  popup: (feature) => {
    const p = feature.properties;
    const kelas = p.kelas_jalan || "N/A";
    const kelasBadge = kelas === "I" ? "badge-kelas-1" : kelas === "II" ? "badge-kelas-2" : "badge-kelas-3";
    const bersArteri = (p.bersinggungan_arteri || "").toLowerCase();
    const bersKolektor = (p.bersinggungan_kolektor || "").toLowerCase();

    return `<div style="max-width:300px;">
      <b style="font-size:14px;">${escHtml(p.nama_ruas || "Rambu")}</b><br/>
      <span class="${kelasBadge}">Kelas ${escHtml(kelas)}</span>
      <br/><br/>
      <b>Kode Ruas:</b> ${escHtml(p.kode_ruas || "N/A")}<br/>
      <b>Nama:</b> ${escHtml(p.nama_ruas || "N/A")}<br/>
      <b>Kelas Jalan:</b> ${escHtml(kelas)}<br/>
      <b>Ujung Ruas:</b> ${escHtml(p.ujung_ruas || "N/A")}<br/>
      <b>Panjang:</b> ${escHtml(p.panjang_km || "N/A")} km<br/>
      <hr style="border:none;border-top:1px solid #334155;margin:8px 0;">
      <b>Bersinggungan Arteri:</b> <span class="${bersArteri === 'ya' ? 'badge-yes' : 'badge-no'}">${escHtml(p.bersinggungan_arteri || "Tidak")}</span><br/>
      <b>Bersinggungan Kolektor:</b> <span class="${bersKolektor === 'ya' ? 'badge-yes' : 'badge-no'}">${escHtml(p.bersinggungan_kolektor || "Tidak")}</span><br/>
      <hr style="border:none;border-top:1px solid #334155;margin:8px 0;">
      <b>Jarak ke Jaringan:</b> ${escHtml(p.jarak_jaringan_m != null ? p.jarak_jaringan_m + " m" : "N/A")}<br/>
      <b>Jarak ke Arteri:</b> ${escHtml(p.jarak_arteri_m != null ? p.jarak_arteri_m + " m" : "N/A")}<br/>
      <b>Jarak ke Kolektor:</b> ${escHtml(p.jarak_kolektor_m != null ? p.jarak_kolektor_m + " m" : "N/A")}<br/>
      <hr style="border:none;border-top:1px solid #334155;margin:8px 0;">
      <b>Status:</b> ${escHtml(p.status || "N/A")}<br/>
      <b>Fungsi:</b> ${escHtml(p.fungsi || "N/A")}<br/>
      <b>Koordinat:</b><br/>
      <span style="color:#94a3b8;font-size:11px;">${escHtml(p.latitude != null && p.longitude != null ? p.latitude + ", " + p.longitude : "N/A")}</span>
    </div>`;
  },
  stats: [
    { label: "Rambu", compute: (fc) => fc.features.length.toLocaleString() },
    { label: "Ruas Jalan", compute: (fc) => fc.features.length.toLocaleString() },
    { label: "Jaringan", compute: (fc) => fc.features.length.toLocaleString() },
    { label: "Arteri", compute: (fc) => fc.features.filter(f => (f.properties.jenis || "").toLowerCase().includes("arteri")).length.toLocaleString() },
    { label: "Kolektor", compute: (fc) => fc.features.filter(f => (f.properties.jenis || "").toLowerCase().includes("kolektor")).length.toLocaleString() },
  ],
};
