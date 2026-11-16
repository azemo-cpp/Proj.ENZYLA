/**
 * generateClrShadeTiles.mjs
 *
 * Slices the LRO ClrShade TIFs into 512x512 PNG tiles. With --wac, it instead
 * slices the grayscale global WAC mosaic at its native 303 pixels per degree.
 *
 * Priority (highest wins when coverages overlap):
 *   1. LRO_LOLA_ClrShade_*Pole875* — ~5 m/px, polar caps ≥86.5°
 *   2. LRO_LOLA_ClrShade_*Pole75*  — ~30 m/px, polar caps ≥68.9°
 *   3. LRO_WAC-GLD100_ClrShade*    — ~118 m/px, ±79° latitude
 *
 * Output: public/clrshade-tiles/{name}.png
 *   or public/lro-wac-tiles/{name}.png with --wac
 *   Naming: {H}{lat2}{V}{lon3}  H=N/S, V=E/W, lat/lon are the SW corner.
 *
 * Usage:
 *   node scripts/generateClrShadeTiles.mjs              # all tiles
 *   node scripts/generateClrShadeTiles.mjs --sites      # Apollo sites only
 *   node scripts/generateClrShadeTiles.mjs --bbox W,S,E,N  # specific region
 *   node scripts/generateClrShadeTiles.mjs --wac --sites # grayscale WAC detail
 *
 * The TIF files must be in the project root.
 */

import { fromFile } from 'geotiff';
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot  = path.join(projectRoot, 'data');
const WAC_MODE    = process.argv.includes('--wac');
const outputRoot  = path.join(projectRoot, 'public', WAC_MODE ? 'lro-wac-tiles' : 'clrshade-tiles');

// Preserve the WAC mosaic's native 303 pixels per degree across each 2° tile.
const TILE_PX = WAC_MODE ? 606 : 512;
// Tile coverage in degrees (each tile covers TILE_DEG × TILE_DEG).
const TILE_DEG = 2;

// Apollo landing sites — used for --sites mode.
const APOLLO_SITES = [
  { name: 'Apollo 11', lat:  0.6741, lon:  23.4723 },
  { name: 'Apollo 12', lat: -3.0128, lon: -23.4219 },
  { name: 'Apollo 14', lat: -3.6453, lon: -17.4714 },
  { name: 'Apollo 15', lat: 26.1322, lon:   3.6339 },
  { name: 'Apollo 16', lat: -8.9730, lon:  15.4986 },
  { name: 'Apollo 17', lat: 20.1908, lon:  30.7717 },
];
// Pad around each site in degrees so a full DEM span is covered.
const SITE_PAD_DEG = 16;

// Source files in ascending priority order (later entries win).
const CLRSHADE_SOURCES = [
  {
    file: 'LRO_WAC-GLD100_ClrShade_79S79N_256ppd.tif',
    south: -79, north: 79,
  },
  {
    file: 'LRO_LOLA_ClrShade_SPole75_30mp_v04_EQ.tif',
    south: -90, north: -68.9066,
  },
  {
    file: 'LRO_LOLA_ClrShade_NPole75_30mp_v04_EQ.tif',
    south:  68.9066, north: 90,
  },
  {
    file: 'LRO_LOLA_ClrShade_SPole875_5mp_v04_EQ.tif',
    south: -90, north: -86.4641,
  },
  {
    file: 'LRO_LOLA_ClrShade_NPole875_5mp_v04_EQ.tif',
    south:  86.4647, north: 90,
  },
];
const SOURCES = WAC_MODE
  ? [{ file: 'LRO_WAC_Mosaic_Global_303ppd.tif', south: -90, north: 90 }]
  : CLRSHADE_SOURCES;

// ── PNG encoder (no deps) ────────────────────────────────────────────────────
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.concat([t, data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const csum = Buffer.alloc(4); csum.writeUInt32BE(crc32(c));
  return Buffer.concat([len, c, csum]);
}
function encodePng(rgb, w, h) {
  const rowLen = w * 3;
  const scan   = Buffer.alloc((rowLen + 1) * h);
  for (let r = 0; r < h; r++) {
    scan[r * (rowLen + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + r * rowLen, rowLen)
      .copy(scan, r * (rowLen + 1) + 1);
  }
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(w, 0); hdr.writeUInt32BE(h, 4);
  hdr[8] = 8; hdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', hdr),
    pngChunk('IDAT', deflateSync(scan, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Tile name ────────────────────────────────────────────────────────────────
// SW corner of the tile. e.g. lat=0,lon=22 → "N00E022"
function tileName(latSW, lonSW) {
  const latAbs = Math.abs(latSW);
  const lonAbs = Math.abs(lonSW);
  const latH   = latSW >= 0 ? 'N' : 'S';
  const lonH   = lonSW >= 0 ? 'E' : 'W';
  return `${latH}${String(latAbs).padStart(2,'0')}${lonH}${String(lonAbs).padStart(3,'0')}`;
}

// ── Open and cache TIF handles ───────────────────────────────────────────────
const tiffCache = new Map();
async function getTiff(file) {
  if (!tiffCache.has(file)) {
    const tiff  = await fromFile(path.join(sourceRoot, file));
    const image = await tiff.getImage();
    tiffCache.set(file, {
      image,
      bounds: image.getBoundingBox(),         // [W, S, E, N]
      res:    Math.abs(image.getResolution()[0]), // deg/px
      w:      image.getWidth(),
      h:      image.getHeight(),
      samples:image.getSamplesPerPixel(),
    });
    console.log(`  Opened ${file} (${tiffCache.get(file).w}x${tiffCache.get(file).h})`);
  }
  return tiffCache.get(file);
}

// ── Render one tile ──────────────────────────────────────────────────────────
// Returns a Uint8Array (RGB, TILE_PX×TILE_PX) or null if fully nodata.
async function renderTile(latSW, lonSW) {
  const latNE = latSW + TILE_DEG;
  const lonNE = lonSW + TILE_DEG;

  const out = new Uint8Array(TILE_PX * TILE_PX * 3); // start black = nodata

  // Composite sources in priority order (later = higher priority).
  for (const src of SOURCES) {
    // Does this source cover the tile at all?
    if (latNE <= src.south || latSW >= src.north) continue;

    const t = await getTiff(src.file);
    const [tW, tS, tE, tN] = t.bounds;

    // Clamp tile to source coverage
    const south = Math.max(latSW, tS, src.south);
    const north = Math.min(latNE, tN, src.north);
    const west  = Math.max(lonSW, tW);
    const east  = Math.min(lonNE, tE);
    if (east <= west || north <= south) continue;

    // For each output pixel, bilinearly sample the source TIF.
    for (let py = 0; py < TILE_PX; py++) {
      // Latitude of this output pixel centre (top-down).
      const lat = latNE - (py + 0.5) / TILE_PX * TILE_DEG;
      if (lat < south || lat > north) continue;

      // Source row (fractional).
      const srcRowF = (tN - lat) / (tN - tS) * (t.h - 1);
      const srcRow  = Math.max(0, Math.min(t.h - 1, Math.round(srcRowF)));

      for (let px = 0; px < TILE_PX; px++) {
        const lon = lonSW + (px + 0.5) / TILE_PX * TILE_DEG;
        if (lon < west || lon > east) continue;

        const srcColF = (lon - tW) / (tE - tW) * (t.w - 1);
        const srcCol  = Math.max(0, Math.min(t.w - 1, Math.round(srcColF)));

        // Read one pixel: window = [colStart, rowStart, colEnd, rowEnd]
        const px1 = await t.image.readRasters({
          window: [srcCol, srcRow, srcCol + 1, srcRow + 1],
          interleave: true,
        });

        const r = px1[0];
        const g = t.samples === 1 ? r : px1[1];
        const b = t.samples === 1 ? r : px1[2];
        if (r === 0 && g === 0 && b === 0) continue; // nodata

        const i = (py * TILE_PX + px) * 3;
        out[i] = r; out[i+1] = g; out[i+2] = b;
      }
    }
  }

  // If the whole tile is black (nodata), skip it.
  let hasData = false;
  for (let i = 0; i < out.length; i += 3) {
    if (out[i] || out[i+1] || out[i+2]) { hasData = true; break; }
  }
  return hasData ? out : null;
}

// ── Batch render: read a whole row from the TIF at once (much faster) ────────
async function renderTileRow(latSW, lonSW, sources = SOURCES) {
  const latNE = latSW + TILE_DEG;
  const lonNE = lonSW + TILE_DEG;
  const out   = new Uint8Array(TILE_PX * TILE_PX * 3);

  for (const src of sources) {
    if (latNE <= src.south || latSW >= src.north) continue;
    const t = await getTiff(src.file);
    const [tW, tS, tE, tN] = t.bounds;

    const south = Math.max(latSW, tS, src.south);
    const north = Math.min(latNE, tN, src.north);
    const west  = Math.max(lonSW, tW);
    const east  = Math.min(lonNE, tE);
    if (east <= west || north <= south) continue;

    // Map tile output extent to source pixel window.
    const colStart = Math.max(0, Math.floor((west - tW) / (tE - tW) * t.w));
    const colEnd   = Math.min(t.w, Math.ceil( (east - tW) / (tE - tW) * t.w));
    const rowStart = Math.max(0, Math.floor((tN - north) / (tN - tS) * t.h));
    const rowEnd   = Math.min(t.h, Math.ceil( (tN - south) / (tN - tS) * t.h));
    if (colEnd <= colStart || rowEnd <= rowStart) continue;

    // Fetch the whole sub-region at once, resampled to TILE_PX×TILE_PX.
    const srcW = colEnd - colStart;
    const srcH = rowEnd - rowStart;

    // Output pixel range that this source covers.
    const outCol0 = Math.round((west  - lonSW) / TILE_DEG * TILE_PX);
    const outCol1 = Math.round((east  - lonSW) / TILE_DEG * TILE_PX);
    const outRow0 = Math.round((latNE - north)  / TILE_DEG * TILE_PX);
    const outRow1 = Math.round((latNE - south)  / TILE_DEG * TILE_PX);
    const outW = Math.max(1, outCol1 - outCol0);
    const outH = Math.max(1, outRow1 - outRow0);

    const pixels = await t.image.readRasters({
      window: [colStart, rowStart, colEnd, rowEnd],
      width:  outW,
      height: outH,
      interleave: true,
      resampleMethod: 'bilinear',
    });

    // Composite into output buffer.
    for (let py = 0; py < outH; py++) {
      const destRow = outRow0 + py;
      if (destRow < 0 || destRow >= TILE_PX) continue;
      for (let px2 = 0; px2 < outW; px2++) {
        const destCol = outCol0 + px2;
        if (destCol < 0 || destCol >= TILE_PX) continue;
        const si = (py * outW + px2) * t.samples;
        const r = pixels[si];
        const g = t.samples === 1 ? r : pixels[si+1];
        const b = t.samples === 1 ? r : pixels[si+2];
        if (r === 0 && g === 0 && b === 0) continue;
        const di = (destRow * TILE_PX + destCol) * 3;
        out[di] = r; out[di+1] = g; out[di+2] = b;
      }
    }
  }

  let hasData = false;
  for (let i = 0; i < out.length; i += 3) {
    if (out[i] || out[i+1] || out[i+2]) { hasData = true; break; }
  }
  return hasData ? out : null;
}

// ── Build tile list ──────────────────────────────────────────────────────────
function buildTileList(westBound, southBound, eastBound, northBound, sources = SOURCES) {
  const tiles = [];
  for (let lat = southBound; lat < northBound; lat += TILE_DEG) {
    for (let lon = westBound; lon < eastBound; lon += TILE_DEG) {
      // Check at least one source covers this tile.
      const latNE = lat + TILE_DEG;
      const covered = sources.some(s => latNE > s.south && lat < s.north);
      if (covered) tiles.push({ lat, lon });
    }
  }
  return tiles;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const sitesMode = args.includes('--sites');
  const bboxIdx   = args.indexOf('--bbox');
  const skipExisting = args.includes('--skip-existing');

  let tiles;

  if (sitesMode) {
    // Build tiles covering each Apollo site with padding.
    const sitePadDeg = WAC_MODE ? 8 : SITE_PAD_DEG;
    const tileSet = new Set();
    for (const site of APOLLO_SITES) {
      const s = Math.floor((site.lat - sitePadDeg) / TILE_DEG) * TILE_DEG;
      const n = Math.ceil( (site.lat + sitePadDeg) / TILE_DEG) * TILE_DEG;
      const w = Math.floor((site.lon - sitePadDeg) / TILE_DEG) * TILE_DEG;
      const e = Math.ceil( (site.lon + sitePadDeg) / TILE_DEG) * TILE_DEG;
      for (let lat = Math.max(-90, s); lat < Math.min(90, n); lat += TILE_DEG) {
        for (let lon = Math.max(-180, w); lon < Math.min(180, e); lon += TILE_DEG) {
          tileSet.add(`${lat},${lon}`);
        }
      }
    }
    tiles = [...tileSet].map(k => { const [lat,lon]=k.split(',').map(Number); return {lat,lon}; });
    console.log(`Sites mode: ${tiles.length} tiles covering Apollo 11–17 (±${sitePadDeg}° pad).`);
  } else if (bboxIdx !== -1) {
    const [w,s,e,n] = args[bboxIdx+1].split(',').map(Number);
    tiles = buildTileList(w, s, e, n, SOURCES);
    console.log(`Bbox mode: ${tiles.length} tiles for ${w},${s},${e},${n}.`);
  } else {
    tiles = buildTileList(-180, -90, 180, 90, SOURCES);
    console.log(`Full mode: ${tiles.length} tiles total.`);
  }

  await mkdir(outputRoot, { recursive: true });

  let written = 0, skipped = 0, nodata = 0;
  for (let i = 0; i < tiles.length; i++) {
    const { lat, lon } = tiles[i];
    const name    = tileName(lat, lon);
    const outPath = path.join(outputRoot, `${name}.png`);

    if (skipExisting) {
      try { await access(outPath); skipped++; continue; } catch { /* not found, generate */ }
    }

    const pixels = await renderTileRow(lat, lon, SOURCES);
    if (!pixels) { nodata++; continue; }

    await writeFile(outPath, encodePng(pixels, TILE_PX, TILE_PX));
    written++;
    if (written % 10 === 0 || i === tiles.length - 1) {
      process.stdout.write(`\r  ${i+1}/${tiles.length} tiles — ${written} written, ${skipped} skipped, ${nodata} nodata   `);
    }
  }
  console.log(`\nDone. ${written} tiles written to public/${WAC_MODE ? 'lro-wac-tiles' : 'clrshade-tiles'}/`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
