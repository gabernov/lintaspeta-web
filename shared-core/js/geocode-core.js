export const GEO_ATTRIBUTION = "© OpenStreetMap contributors";

const PHOTON = "https://photon.komoot.io/api/";
const PHOTON_REVERSE = "https://photon.komoot.io/reverse";

export function parseCoordInput(raw) {
  const s = (raw || "").trim();
  const m = s.match(/^(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const a = parseFloat(m[1].replace(",", "."));
  const b = parseFloat(m[2].replace(",", "."));
  if (!isFinite(a) || !isFinite(b)) return null;
  let lat, lng;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) { lat = a; lng = b; }
  else if (Math.abs(a) <= 180 && Math.abs(b) <= 90) { lng = a; lat = b; }
  else return null;
  return { lat, lng };
}

function photonLabel(p) {
  return p.name || p.street || p.city || p.district || p.locality || p.county || p.state || p.country || "Lokasi";
}

function photonSubtitle(p) {
  const parts = [p.street, p.district, p.city, p.county, p.state, p.country].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    if (!seen.has(part)) { seen.add(part); out.push(part); }
  }
  return out.join(", ");
}

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MIN_INTERVAL_MS = 400;
let lastCallAt = 0;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.data;
}

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

// Photon returns extent as [minLon, maxLat, maxLon, minLat]; callers expect
// Nominatim's boundingbox order [minLat, maxLat, minLng, maxLng].
function extentToBbox(extent) {
  if (!Array.isArray(extent) || extent.length !== 4) return null;
  const [minLng, maxLat, maxLon, minLat] = extent;
  return [minLat, maxLat, minLng, maxLon];
}

export async function geocodePlaces(q, { signal, limit = 5, center = null } = {}) {
  const centerKey = center ? `${center[0].toFixed(2)},${center[1].toFixed(2)}` : "";
  const key = `${q.trim().toLowerCase()}|${limit}|${centerKey}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const params = new URLSearchParams({ q, limit: String(limit) });
  if (center && isFinite(center[0]) && isFinite(center[1])) {
    params.set("lat", String(center[1]));
    params.set("lon", String(center[0]));
  }
  try {
    await throttle();
    const resp = await fetch(`${PHOTON}?${params.toString()}`, { signal });
    if (!resp.ok) return [];
    const data = await resp.json();
    const out = (data.features || []).map((f) => {
      const p = f.properties || {};
      const c = f.geometry?.coordinates || [];
      return {
        group: "Lokasi",
        title: photonLabel(p),
        subtitle: photonSubtitle(p) || p.country || "",
        lat: c[1],
        lng: c[0],
        osmType: p.osm_type,
        osmId: p.osm_id,
        bbox: extentToBbox(p.extent),
      };
    }).filter((r) => isFinite(r.lat) && isFinite(r.lng));
    cache.set(key, { t: Date.now(), data: out });
    return out;
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    console.warn("geocode failed:", e?.message || e);
    return [];
  }
}

export async function reversePlace(lat, lng, { signal } = {}) {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lng) });
    const resp = await fetch(`${PHOTON_REVERSE}?${params.toString()}`, { signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    const p = data.features?.[0]?.properties;
    if (!p) return null;
    const label = photonLabel(p);
    const sub = photonSubtitle(p);
    return sub && sub !== label ? `${label}, ${sub}` : label;
  } catch {
    return null;
  }
}
