let arrow;
let parquet;
let wasmInitialized = false;

export async function initParquet() {
  if (wasmInitialized) return;

  try {
    arrow = await import("https://esm.sh/apache-arrow");
  } catch (e) {
    console.error("Failed to load Apache Arrow: " + e.message);
    throw e;
  }

  try {
    parquet = await import("https://cdn.jsdelivr.net/npm/parquet-wasm@0.7.0/esm/parquet_wasm.js");
  } catch (e) {
    console.error("Failed to load parquet-wasm: " + e.message);
    throw e;
  }

  try {
    // Exactly like geoparquet-visualizer: await parquet.default()
    await parquet.default();
  } catch (e) {
    // Fallback: try initSync with explicit WASM compilation
    console.warn("parquet.default() failed, trying initSync fallback:", e.message);
    try {
      const wasmResp = await fetch("https://cdn.jsdelivr.net/npm/parquet-wasm@0.7.0/esm/parquet_wasm_bg.wasm");
      const wasmBytes = await wasmResp.arrayBuffer();
      const wasmModule = await WebAssembly.compile(wasmBytes);
      parquet.initSync(wasmModule);
    } catch (e2) {
      console.error("Failed to init WASM: " + e.message + " | " + e2.message);
      throw e2;
    }
  }

  wasmInitialized = true;
}

// ═══════════════════════════════════════════════════════════
// WKB PARSER (from geoparquet-visualizer)
// ═══════════════════════════════════════════════════════════
function parseWKB(wkbBuffer) {
  try {
    const view = new DataView(wkbBuffer);
    let offset = 0;
    const byteOrder = view.getUint8(offset++);
    const littleEndian = byteOrder === 1;
    const geomType = view.getUint32(offset, littleEndian);
    offset += 4;

    // EWKB type flags live in the high bits:
    //   0x20000000 = has SRID, 0x80000000 = Z, 0x40000000 = M.
    // PostGIS legacy encodes the same info as type 1000+n (Z) / 2000+n (ZM)
    // without flags (e.g. 1005 = MultiLineStringZ).
    const hasSRID = (geomType & 0x20000000) !== 0;
    let baseType = geomType & 0x0FFFFFFF; // strip all EWKB flags
    const hasZ = (geomType & 0x80000000) !== 0 || baseType >= 1000;
    const hasM = (geomType & 0x40000000) !== 0 || baseType >= 2000;
    if (baseType >= 1000) baseType %= 1000; // PostGIS legacy ZM encoding
    if (hasSRID) offset += 4;

    function readPoint() {
      const x = view.getFloat64(offset, littleEndian); offset += 8;
      const y = view.getFloat64(offset, littleEndian); offset += 8;
      if (hasZ) offset += 8; // skip Z
      if (hasM) offset += 8; // skip M
      return [x, y];
    }
    function readPoints() {
      const n = view.getUint32(offset, littleEndian); offset += 4;
      return Array.from({ length: n }, readPoint);
    }
    function readLinearRing() {
      const n = view.getUint32(offset, littleEndian); offset += 4;
      return Array.from({ length: n }, readPoint);
    }
    function readPolygonRings() {
      const n = view.getUint32(offset, littleEndian); offset += 4;
      return Array.from({ length: n }, readLinearRing);
    }

    switch (baseType) {
      case 1:  return { type: "Point", coordinates: readPoint() };
      case 2:  return { type: "LineString", coordinates: readPoints() };
      case 3:  return { type: "Polygon", coordinates: readPolygonRings() };
      case 4:  return { type: "MultiPoint", coordinates: readPoints() };
      case 5: {
        const n = view.getUint32(offset, littleEndian); offset += 4;
        const lines = [];
        for (let i = 0; i < n; i++) {
          offset++; offset += 4; // skip sub-entity WKB header
          lines.push(readPoints());
        }
        return { type: "MultiLineString", coordinates: lines };
      }
      case 6: {
        const n = view.getUint32(offset, littleEndian); offset += 4;
        const polygons = [];
        for (let i = 0; i < n; i++) {
          offset++; offset += 4; // skip sub-entity WKB header
          polygons.push(readPolygonRings());
        }
        return { type: "MultiPolygon", coordinates: polygons };
      }
      default:
        console.warn("Unknown geometry type:", baseType, "(raw:", geomType, ")");
        return null;
    }
  } catch (e) {
    console.error("WKB parse error:", e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// PARQUET → GEOJSON (streaming, like geoparquet-visualizer)
// ═══════════════════════════════════════════════════════════
export async function loadParquetToGeoJSON(source, onProgress, onDownloadProgress) {
  const sourceName = source instanceof File ? source.name : source;
  let file;

  if (source instanceof File) {
    file = source;
  } else {
    // Stream the download so the caller can report live progress —
    // on slow connections a multi-MB parquet would otherwise sit in a
    // silent fetch (the watchdog would see no heartbeat at all).
    const resp = await fetch(source);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${source}`);
    const total = Number(resp.headers.get("Content-Length")) || 0;
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (onDownloadProgress) onDownloadProgress(received, total);
    }
    const blob = new Blob(chunks, { type: resp.headers.get("Content-Type") || "application/octet-stream" });
    file = new File([blob], sourceName);
  }

  // Use the streaming API — exactly like geoparquet-visualizer
  const parquetFile = await parquet.ParquetFile.fromFile(file);
  const recordBatchStream = await parquetFile.stream();
  const reader = recordBatchStream.getReader();

  const features = [];
  let batchCount = 0;
  let totalProcessed = 0;

  // Detect geometry column from first row
  let geometryColumnName = null;

  while (true) {
    const { done, value: wasmRecordBatch } = await reader.read();
    if (done) break;

    const ipcStream = wasmRecordBatch.intoIPCStream();
    const table = arrow.tableFromIPC(ipcStream);
    const rowArray = table.toArray();

    // Detect geometry column on first batch
    if (!geometryColumnName && rowArray.length > 0) {
      const firstRow = rowArray[0].toJSON();
      const commonNames = ["geometry", "geom", "wkb_geometry", "shape", "wkb", "geo_shape"];
      for (const name of commonNames) {
        if (firstRow[name] instanceof Uint8Array) {
          geometryColumnName = name;
          break;
        }
      }
      if (!geometryColumnName) {
        // Fallback: look for any Uint8Array column
        for (const [key, val] of Object.entries(firstRow)) {
          if (val instanceof Uint8Array) {
            geometryColumnName = key;
            break;
          }
        }
      }
    }

    for (const rowObject of rowArray) {
      const jsonData = rowObject.toJSON();
      const row = {};

      // Convert to plain JS, handling Uint8Array and BigInt
      for (const [key, value] of Object.entries(jsonData)) {
        if (value instanceof Uint8Array) {
          row[key] = new Uint8Array(value);
        } else if (typeof value === "bigint") {
          row[key] = Number(value);
        } else if (value && typeof value.toJSON === "function") {
          // Arrow StructRow — recurse
          const plain = {};
          const inner = value.toJSON();
          for (const [k, v] of Object.entries(inner)) {
            plain[k] = typeof v === "bigint" ? Number(v) : v;
          }
          row[key] = plain;
        } else {
          row[key] = value;
        }
      }

      // Parse geometry
      let geometry = null;
      if (geometryColumnName && row[geometryColumnName] instanceof Uint8Array) {
        const wkb = row[geometryColumnName];
        const buffer = wkb.buffer.slice(wkb.byteOffset, wkb.byteOffset + wkb.byteLength);
        geometry = parseWKB(buffer);
      }

      // Fallback: lon/lat columns
      if (!geometry) {
        const lon = row.lon || row.longitude || row.lng;
        const lat = row.lat || row.latitude;
        if (typeof lon === "number" && typeof lat === "number" && !isNaN(lon) && !isNaN(lat)) {
          geometry = { type: "Point", coordinates: [lon, lat] };
        }
      }

      if (geometry) {
        const properties = { ...row };
        if (geometryColumnName) delete properties[geometryColumnName];
        delete properties.geometry;
        delete properties.geometry_bbox;

        features.push({
          type: "Feature",
          id: totalProcessed,
          geometry,
          properties
        });
      }
      totalProcessed++;
    }

    batchCount++;
    if (onProgress) onProgress(batchCount, totalProcessed);
  }

  return { type: "FeatureCollection", features };
}
