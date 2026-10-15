import { escHtml } from "../../shared-core/js/ui-core.js";

export const KELAS_COLORS = { "I": "#EF4444", "II": "#F97316", "III": "#8B5CF6" };
export const KELAS_ORDER = ["I", "II", "III"];

export const UPTD_COLORS = {
  "UPTD-I": "#E11D48",
  "UPTD-II": "#2563EB",
  "UPTD-III": "#059669",
  "UPTD-IV": "#7C3AED",
  "UPTD-V": "#EA580C",
  "UPTD-VI": "#0891B2",
};
export const UPTD_ORDER = ["UPTD-I", "UPTD-II", "UPTD-III", "UPTD-IV", "UPTD-V", "UPTD-VI"];
export const UPTD_DEFAULT = "#94A3B8";
export const UPTD_LABEL = {
  "UPTD-I": "UPTD I",
  "UPTD-II": "UPTD II",
  "UPTD-III": "UPTD III",
  "UPTD-IV": "UPTD IV",
  "UPTD-V": "UPTD V",
  "UPTD-VI": "UPTD VI",
};

export const ARTERI_COLOR = "#EF4444";
export const KOLEKTOR_COLOR = "#F97316";
export const RUAS_COLOR = "#8B5CF6";

const KABKOTA_OVERRIDES = { bandungbarat: "Bandung Barat" };

export function kabkotaLabel(code) {
  if (!code) return "Tidak diketahui";
  const m = String(code).match(/^(kab|kota)[_-](.+)$/i);
  if (!m) return String(code);
  const prefix = m[1].toLowerCase() === "kab" ? "Kab." : "Kota";
  const raw = m[2].toLowerCase();
  const name = KABKOTA_OVERRIDES[raw] || raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${prefix} ${name}`;
}

export function enrichRambu(rambuFC, ruasFC) {
  const byKode = new Map();
  if (ruasFC) {
    for (const f of ruasFC.features) {
      const k = f.properties?.kode_number;
      if (k !== undefined && k !== null) byKode.set(String(k), f.properties || {});
    }
  }
  for (const f of rambuFC.features) {
    const p = f.properties || (f.properties = {});
    const ruas = byKode.get(String(p.kode_ruas ?? ""));
    p.uptd = ruas?.unit_kerja_kode || null;
    p.kabkota = ruas?.kode || "tidak_diketahui";
    p.kabkota_label = kabkotaLabel(p.kabkota);
    p.ruas_nama = ruas?.nama || p.nama_ruas || "";
    p.ruas_kelas = ruas?.kelas_jalan || p.kelas_jalan || "";
    p.bers_arteri = String(p.bersinggungan_arteri ?? "").toLowerCase() === "true";
    p.bers_kolektor = String(p.bersinggungan_kolektor ?? "").toLowerCase() === "true";
  }
  return rambuFC;
}

export default {
  id: "rambu",
  title: "Peta Rambu",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>',
  dataFiles: ["data/jaringan_jalan.parquet", "data/rambu_kelas_jalan.parquet", "data/ruas_jalan.parquet"],
  defaultView: { center: [107.5, -6.9], zoom: 8 },
  defaultBasemap: "bright",

  filterChips: [
    { key: "fungsi", label: "Fungsi Jalan" },
    { key: "bers_arteri", label: "Bersinggungan Arteri", bool: true },
    { key: "bers_kolektor", label: "Bersinggungan Kolektor", bool: true },
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
        "line-opacity": 0.85,
      },
    },
    {
      id: "kolektor-line",
      type: "line",
      source: "kolektor",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": KOLEKTOR_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2, 16, 3.5, 20, 5],
        "line-opacity": 0.85,
      },
    },
    {
      id: "ruas-line",
      type: "line",
      source: "ruas",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": [
          "match", ["get", "unit_kerja_kode"],
          "UPTD-I", UPTD_COLORS["UPTD-I"],
          "UPTD-II", UPTD_COLORS["UPTD-II"],
          "UPTD-III", UPTD_COLORS["UPTD-III"],
          "UPTD-IV", UPTD_COLORS["UPTD-IV"],
          "UPTD-V", UPTD_COLORS["UPTD-V"],
          "UPTD-VI", UPTD_COLORS["UPTD-VI"],
          UPTD_DEFAULT,
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 3, 16, 5, 20, 7],
        "line-opacity": 0.75,
      },
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
          "#94a3b8",
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#0f172a",
        "circle-opacity": 0.95,
      },
    },
    {
      id: "rambu-hitbox",
      type: "circle",
      source: "rambu",
      paint: { "circle-radius": 14, "circle-color": "transparent", "circle-stroke-width": 0 },
    },
  ],

  popup: (feature) => {
    const p = feature.properties || {};
    const kelas = p.kelas_jalan || "N/A";
    const kelasBadge = kelas === "I" ? "badge-kelas-1" : kelas === "II" ? "badge-kelas-2" : "badge-kelas-3";
    const badge = (yes) => `<span class="${yes ? "badge-yes" : "badge-no"}">${yes ? "Ya" : "Tidak"}</span>`;
    const uptd = p.uptd ? `<span style="color:${UPTD_COLORS[p.uptd] || UPTD_DEFAULT};font-weight:700;">${escHtml(UPTD_LABEL[p.uptd] || p.uptd)}</span>` : "N/A";

    return `<div style="max-width:300px;">
      <b style="font-size:14px;">${escHtml(p.nama_ruas || "Rambu")}</b><br/>
      <span class="${kelasBadge}">Kelas ${escHtml(kelas)}</span>
      ${p.rambu_id ? `<span style="color:#64748b;font-size:11px;"> · ${escHtml(p.rambu_id)}</span>` : ""}
      <br/><br/>
      <b>Kode Ruas:</b> ${escHtml(p.kode_ruas || "N/A")}<br/>
      <b>UPTD:</b> ${uptd}<br/>
      <b>Kab/Kota:</b> ${escHtml(p.kabkota_label || "N/A")}<br/>
      <b>Ujung Ruas:</b> ${escHtml(p.ujung_ruas || "N/A")}<br/>
      <b>Panjang Ruas:</b> ${escHtml(p.panjang_km ?? "N/A")} km<br/>
      <hr style="border:none;border-top:1px solid #334155;margin:8px 0;">
      <b>Bersinggungan Arteri:</b> ${badge(!!p.bers_arteri)}<br/>
      <b>Bersinggungan Kolektor:</b> ${badge(!!p.bers_kolektor)}<br/>
      <hr style="border:none;border-top:1px solid #334155;margin:8px 0;">
      <b>Jarak ke Jaringan:</b> ${escHtml(p.jarak_jaringan_m != null ? p.jarak_jaringan_m + " m" : "N/A")}<br/>
      <b>Jarak ke Arteri:</b> ${escHtml(p.jarak_arteri_m != null ? p.jarak_arteri_m + " m" : "N/A")}<br/>
      <b>Jarak ke Kolektor:</b> ${escHtml(p.jarak_kolektor_m != null ? p.jarak_kolektor_m + " m" : "N/A")}<br/>
      <hr style="border:none;border-top:1px solid #334155;margin:8px 0;">
      <b>Fungsi:</b> ${escHtml(p.fungsi || "N/A")}<br/>
      <b>Koordinat:</b><br/>
      <span style="color:#94a3b8;font-size:11px;">${escHtml(p.latitude != null && p.longitude != null ? p.latitude + ", " + p.longitude : "N/A")}</span>
    </div>`;
  },
};
