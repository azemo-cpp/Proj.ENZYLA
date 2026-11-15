/* Gumagawa ng database/site-thermal.json mula sa Diviner level 4 temperature maps.
   Gamit: node database/build-thermal.js <folder na may diviner_tbol_max.xyz at diviner_tbol_min.xyz>
   Kinukuha ang pinakamalapit na 0.5 degree na cell para sa bawat site sa site list. */
import fs from "node:fs";
import path from "node:path";
import { SITES } from "./sites.js";

const dir = process.argv[2];
if (!dir) { console.error("Usage: node database/build-thermal.js <folder with the .xyz files>"); process.exit(1); }

function grid(file) {
  const g = new Float32Array(720 * 360).fill(NaN);
  for (const l of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
    const p = l.trim().split(/\s+/).map(Number);
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) continue;
    g[Math.round((p[0] + 179.75) / 0.5) * 360 + Math.round((p[1] + 89.75) / 0.5)] = p[2];
  }
  return g;
}
const at = (g, lat, lon) => {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  const i = Math.min(719, Math.max(0, Math.round((l + 179.75) / 0.5)));
  const j = Math.min(359, Math.max(0, Math.round((lat + 89.75) / 0.5)));
  return g[i * 360 + j];
};
const hi = grid("diviner_tbol_max.xyz"), lo = grid("diviner_tbol_min.xyz");
const out = {
  source: "Diviner level 4 global bolometric temperatures (Williams et al. 2017, Icarus 283), 0.5 degree bins, nadir data 2009-2015",
  note: "Kelvin. Nearest 0.5 degree cell; ~15 km at the poles, so shadowed craters and ridges are not resolved.",
  sites: {},
};
for (const s of SITES) {
  const max = at(hi, s[1], s[2]), min = at(lo, s[1], s[2]);
  if (Number.isFinite(max) && Number.isFinite(min)) out.sites[s[0]] = { lat: s[1], lon: s[2], maxK: +max.toFixed(1), minK: +min.toFixed(1) };
}
fs.writeFileSync(new URL("./site-thermal.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(Object.keys(out.sites).length + " of " + SITES.length + " sites written");
