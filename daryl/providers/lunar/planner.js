// The planner's physics, copied from the original Daryl page.
// Browser-only parts (document, DOM controls) are left out.
const R = Math.PI / 180;

// DATABASE PLACEHOLDER: ang site list ay nasa database/sites.js na.
import { SITES } from "../../database/sites.js";
export { SITES };

// Diviner temperature lookup (database/site-thermal.json). Optional: kung wala ang file, walang thermal na sagot.
import fs from "node:fs";
let THERMAL = {};
try {
  THERMAL = JSON.parse(fs.readFileSync(new URL("../../database/site-thermal.json", import.meta.url), "utf8")).sites || {};
} catch {
  THERMAL = {};
}
const thermal = s => THERMAL[s[0]] || null;

const T0 = 2451550.26;
const SYN = 29.530589;
const HORIZON = 140 * 24;

function geo(t) {
  const sl = ((180 - 360 * t / SYN + 540) % 360) - 180;
  const sb = 1.54 * Math.sin(2 * Math.PI * t / 346.62 - 0.334);
  const eb = 6.68 * Math.sin(2 * Math.PI * t / 27.2122 + 5.984);
  const el = 6.29 * Math.sin(2 * Math.PI * t / 27.5546 + 3.555);
  return { sun: [sb, sl], earth: [eb, el] };
}

function look(phi, lam, b, l) {
  const dl = (l - lam) * R, p = phi * R, q = b * R;
  const e = Math.asin(
    Math.sin(p) * Math.sin(q) + Math.cos(p) * Math.cos(q) * Math.cos(dl)
  ) / R;
  const az = (Math.atan2(
    Math.cos(q) * Math.sin(dl),
    Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(dl)
  ) / R + 360) % 360;
  return [e, az];
}

const jd = ms => ms / 864e5 + 2440587.5;

const site = i => SITES[i];

function series(s, start, H) {
  const out = [];
  for (let h = 0; h < (H || HORIZON); h++) {
    const t = jd(start + h * 36e5) - T0, g = geo(t);
    const a = look(s[1], s[2], ...g.sun), b = look(s[1], s[2], ...g.earth);
    out.push({ sE: a[0], sA: a[1], eE: b[0], eA: b[1] });
  }
  return out;
}

function stats(arr, mask, n) {
  let sun = 0, ea = 0, both = 0, dark = 0, maxD = 0, out = 0, maxO = 0, eSum = 0;
  for (let i = 0; i < n; i++) {
    const p = arr[i], S = p.sE > mask, E = p.eE > mask;
    if (S) { sun++; eSum += p.sE; dark = 0; } else { dark++; maxD = Math.max(maxD, dark); }
    if (E) { ea++; out = 0; } else { out++; maxO = Math.max(maxO, out); }
    if (S && E) both++;
  }
  return {
    sun: sun / n, earth: ea / n, both: both / n, maxD, maxO,
    avg: sun ? eSum / sun : 0,
    score: 0.55 * sun / n + 0.3 * ea / n + 0.15 * both / n
  };
}

// Same shape the page builds in its ctx() function.
export function makeContext({
  siteA = 0,
  siteB = Math.min(4, SITES.length - 1),
  sites: selection = null,
  startMs = Date.now() + 3 * 864e5,
  days = 14,
  mask = 1
} = {}) {
  const clean = Number.isFinite(startMs) ? startMs : Date.now();
  return {
    SITES, site, series, stats, thermal,
    d: clean,
    N: Math.min(60, Math.max(2, Number(days) || 14)) * 24,
    mask: Number(mask) || 0,
    horizon: HORIZON,
    current: [siteA, siteB],
    // mga site na pinili sa compare panel ng app (2 o higit pa), kung meron
    selection: Array.isArray(selection) ? selection : null
  };
}
