import { escHtml } from "../../shared-core/js/ui-core.js";

// Freight-supervision point types. `color` drives the legend and filter bars;
// the map icon itself is drawn per jenis in module.js (real sign artwork for
// the rambu jenis, an illustration badge for tambang/posko).
export const JENIS = [
  { key: "rambu_kelas_jalan", label: "Rambu Kelas Jalan", color: "#EF4444", icon: "pw-jenis-rambu_kelas_jalan" },
  { key: "rambu_mst", label: "Rambu MST", color: "#2563EB", icon: "pw-jenis-rambu_mst" },
  { key: "rambu_pembatasan", label: "Rambu Pembatasan Angkutan", color: "#F59E0B", icon: "pw-jenis-rambu_pembatasan" },
  { key: "tambang", label: "Lokasi Tambang", color: "#7C3AED", icon: "pw-jenis-tambang" },
  { key: "posko", label: "Titik Posko Pengawasan", color: "#0D9488", icon: "pw-jenis-posko" },
];
export const JENIS_ORDER = JENIS.map((j) => j.key);
export const JENIS_COLORS = Object.fromEntries(JENIS.map((j) => [j.key, j.color]));
export const JENIS_LABELS = Object.fromEntries(JENIS.map((j) => [j.key, j.label]));
export const JENIS_ICONS = Object.fromEntries(JENIS.map((j) => [j.key, j.icon]));
export const KELAS_ICONS = { I: "pw-kelas-I", II: "pw-kelas-II", III: "pw-kelas-III" };
// MST signs show the permitted axle load, which follows the road class.
export const MST_ICONS = { "10": "pw-mst-10", "8": "pw-mst-8" };

export const KELAS_ORDER = ["I", "II", "III"];

export const UPTD_COLORS = {
  "UPTD-I": "#E11D48",
  "UPTD-II": "#2563EB",
  "UPTD-III": "#059669",
  "UPTD-IV": "#7C3AED",
};
export const UPTD_ORDER = ["UPTD-I", "UPTD-II", "UPTD-III", "UPTD-IV"];
export const UPTD_DEFAULT = "#94A3B8";
export const UPTD_LABEL = {
  "UPTD-I": "UPTD I",
  "UPTD-II": "UPTD II",
  "UPTD-III": "UPTD III",
  "UPTD-IV": "UPTD IV",
};

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

// Join the point rows to the provincial road reference so each point inherits
// its UPTD / kab-kota / canonical road name from the road it sits on.
export function enrichPengawasan(pengawasanFC, ruasFC) {
  const byKode = new Map();
  if (ruasFC) {
    for (const f of ruasFC.features) {
      const k = f.properties?.kode_number;
      if (k !== undefined && k !== null) byKode.set(String(k), f.properties || {});
    }
  }
  for (const f of pengawasanFC.features) {
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
  return pengawasanFC;
}

export default {
  id: "pengawasan-angkutanbarang",
  title: "Pengawasan Angkutan Barang",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"/></svg>',
  dataFiles: ["data/pengawasan.parquet", "data/ruas_jalan.parquet"],
  defaultView: { center: [107.5, -6.9], zoom: 8 },
  defaultBasemap: "bright",

  filterChips: [
    { key: "jenis", label: "Jenis Pengawasan" },
    { key: "kelas_jalan", label: "Kelas Jalan" },
  ],

  layers: [
    {
      // Dark casing under the UPTD colour keeps the thin coloured line
      // readable against bright basemaps and separates crossing roads.
      id: "ruas-casing",
      type: "line",
      source: "ruas",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#0F172A",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 5.5, 16, 8.5, 20, 12],
        "line-opacity": 0.35,
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
          UPTD_DEFAULT,
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 3, 16, 5, 20, 7],
        "line-opacity": 0.85,
      },
    },
    {
      // Invisible wide stroke: gives the thin roads a comfortable click target.
      id: "ruas-hit",
      type: "line",
      source: "ruas",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "transparent", "line-width": 14 },
    },
    {
      id: "pengawasan-hitbox",
      type: "circle",
      source: "pengawasan",
      paint: { "circle-radius": 14, "circle-color": "transparent", "circle-stroke-width": 0 },
    },
    {
      id: "pengawasan-points",
      type: "symbol",
      source: "pengawasan",
      layout: {
        // Kelas-jalan and MST signs vary by the road class the point sits on
        // (MST shows the class's permitted axle load); the other jenis each
        // have a single icon.
        "icon-image": [
          "case",
          ["==", ["get", "jenis"], "rambu_kelas_jalan"],
          [
            "match", ["get", "kelas_jalan"],
            "I", KELAS_ICONS["I"],
            "II", KELAS_ICONS["II"],
            "III", KELAS_ICONS["III"],
            KELAS_ICONS["I"],
          ],
          [
            "case",
            ["==", ["get", "jenis"], "rambu_mst"],
            [
              "match", ["get", "kelas_jalan"],
              "I", MST_ICONS["10"],
              MST_ICONS["8"],
            ],
            [
              "match", ["get", "jenis"],
              "rambu_pembatasan", JENIS_ICONS["rambu_pembatasan"],
              "tambang", JENIS_ICONS["tambang"],
              "posko", JENIS_ICONS["posko"],
              JENIS_ICONS["rambu_kelas_jalan"],
            ],
          ],
        ],
        "icon-size": 0.55,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center",
      },
    },
  ],

  popup: (feature) => {
    const p = feature.properties || {};
    const jenis = p.jenis || "";
    const color = JENIS_COLORS[jenis] || UPTD_DEFAULT;
    const label = JENIS_LABELS[jenis] || jenis || "Pengawasan";
    const uptd = p.uptd ? `<span style="color:${UPTD_COLORS[p.uptd] || UPTD_DEFAULT};font-weight:700;">${escHtml(UPTD_LABEL[p.uptd] || p.uptd)}</span>` : "N/A";
    const badge = (yes) => `<span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;background:${yes ? "rgba(34,197,94,0.2)" : "rgba(148,163,184,0.2)"};color:${yes ? "#4ADE80" : "#94A3B8"};">${yes ? "Ya" : "Tidak"}</span>`;
    const jenisBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;background:${color};">${escHtml(label)}</span>`;

    return `<div style="max-width:300px;">
      <b style="font-size:14px;">${escHtml(p.ruas_nama || p.nama_ruas || "Titik Pengawasan")}</b><br/>
      ${jenisBadge}
      ${p.rambu_id ? `<span style="color:#64748b;font-size:11px;"> · ${escHtml(p.rambu_id)}</span>` : ""}
      <br/><br/>
      <b>Jenis:</b> ${escHtml(label)}<br/>
      <b>Ikon:</b> <span style="color:#94a3b8;font-size:11px;font-family:'Fira Code',monospace;">${escHtml(JENIS_ICONS[jenis] || "-")}</span><br/>
      <b>Kode Ruas:</b> ${escHtml(p.kode_ruas || "N/A")}<br/>
      <b>Kelas Jalan:</b> ${escHtml(p.kelas_jalan || "N/A")}<br/>
      <b>UPTD:</b> ${uptd}<br/>
      <b>Kab/Kota:</b> ${escHtml(p.kabkota_label || "N/A")}<br/>
      <b>Ujung Ruas:</b> ${escHtml(p.ujung_ruas || "N/A")}<br/>
      <b>Status:</b> ${escHtml(p.status || "N/A")}<br/>
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
