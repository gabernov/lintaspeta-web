import { toast } from "./ui-core.js";

let xlsxLoading = false;
let xlsxLoaded = false;

const CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

export async function ensureXLSX() {
  if (xlsxLoaded) return true;
  if (xlsxLoading) {
    while (xlsxLoading) await new Promise((r) => setTimeout(r, 50));
    return xlsxLoaded;
  }
  xlsxLoading = true;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CDN;
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

const SKIP_KEYS = new Set(["geometry", "geometry_bbox", "wkb_geometry", "geom"]);

function sanitizeKey(k) {
  return k.replace(/[/\\]/g, "_").replace(/[<>&"']/g, "");
}

export function exportFeaturesToXLSX(features, { prefix = "data", sheetName = "Data", columns = null } = {}) {
  if (typeof XLSX === "undefined" || !features?.length) return 0;

  const keys = [];
  if (columns) {
    keys.push(...columns);
  } else {
    for (const f of features) {
      for (const k of Object.keys(f.properties || {})) {
        if (!SKIP_KEYS.has(k) && !keys.includes(k)) keys.push(k);
      }
    }
  }

  const rows = features.map((f) => {
    const row = {};
    for (const k of keys) {
      let v = f.properties ? f.properties[k] : undefined;
      if (typeof v === "boolean") v = v ? "Ya" : "Tidak";
      if (typeof v === "number" && !isFinite(v)) v = null;
      row[sanitizeKey(k)] = v ?? "";
    }
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const header = keys.map(sanitizeKey);
  ws["!cols"] = header.map((h) => {
    let w = h.length;
    for (const r of rows) {
      const len = r[h] == null ? 0 : String(r[h]).length;
      if (len > w) w = len;
    }
    return { wch: Math.min(40, Math.max(8, w + 2)) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  XLSX.writeFile(wb, `${prefix}_terfilter_${features.length}_baris_${stamp}.xlsx`, { compression: features.length >= 5000 });
  return features.length;
}
