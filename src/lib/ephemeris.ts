// Simplified Sun/Earth ephemeris for a lunar surface site (same model as daryl/providers/lunar/planner.js).
// Sub-solar point from the synodic month + Sun's ecliptic tilt (~1.54 deg); sub-Earth point from optical libration.
// Smooth sphere, no parallax, no LOLA horizon: a screening model, not mission grade.
const R = Math.PI / 180;
const T0 = 2451550.26;      // JD of a reference new Moon
const SYN = 29.530589;      // synodic month, days
export const HOUR = 36e5;
export const DAY = 864e5;

export interface SiteCoords { name: string; lat: number; lon: number }
export interface SkyPoint { sunEl: number; sunAz: number; earthEl: number; earthAz: number }
export type Body = 'sun' | 'earth';

export const jd = (ms: number) => ms / DAY + 2440587.5;

function geo(ms: number) {
  const t = jd(ms) - T0;
  return {
    sun: [1.54 * Math.sin((2 * Math.PI * t) / 346.62 - 0.334), ((180 - (360 * t) / SYN + 540) % 360) - 180] as const,
    earth: [6.68 * Math.sin((2 * Math.PI * t) / 27.2122 + 5.984), 6.29 * Math.sin((2 * Math.PI * t) / 27.5546 + 3.555)] as const,
  };
}

/** Sub-solar / sub-Earth point (selenographic lat, lon in degrees). */
export function subSolarPoint(ms: number) { const [lat, lon] = geo(ms).sun; return { lat, lon }; }
export function subEarthPoint(ms: number) { const [lat, lon] = geo(ms).earth; return { lat, lon }; }

function look(phi: number, lam: number, b: number, l: number): [number, number] {
  const dl = (l - lam) * R, p = phi * R, q = b * R;
  const el = Math.asin(Math.sin(p) * Math.sin(q) + Math.cos(p) * Math.cos(q) * Math.cos(dl)) / R;
  const az = (Math.atan2(Math.cos(q) * Math.sin(dl), Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(dl)) / R + 360) % 360;
  return [el, az];
}

export function skyAt(site: { lat: number; lon: number }, ms: number): SkyPoint {
  const g = geo(ms);
  const [sunEl, sunAz] = look(site.lat, site.lon, g.sun[0], g.sun[1]);
  const [earthEl, earthAz] = look(site.lat, site.lon, g.earth[0], g.earth[1]);
  return { sunEl, sunAz, earthEl, earthAz };
}

/** Samples every `stepH` hours from startMs. */
export function series(site: { lat: number; lon: number }, startMs: number, hours: number, stepH = 1): SkyPoint[] {
  const out: SkyPoint[] = [];
  for (let h = 0; h <= hours; h += stepH) out.push(skyAt(site, startMs + h * HOUR));
  return out;
}

const elOf = (p: SkyPoint, b: Body) => (b === 'sun' ? p.sunEl : p.earthEl);

/** Next time the body crosses the (masked) horizon. atMs is null if no change within maxDays. */
export function nextChange(site: { lat: number; lon: number }, ms: number, body: Body, mask = 0, maxDays = 60) {
  const f = (t: number) => elOf(skyAt(site, t), body) - mask;
  const up = f(ms) > 0;
  const step = HOUR / 2;
  let a = ms;
  for (let t = ms + step; t <= ms + maxDays * DAY; t += step) {
    if (f(t) > 0 !== up) {
      let lo = a, hi = t;
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0 === up) lo = mid; else hi = mid; }
      return { up, atMs: (lo + hi) / 2 as number | null };
    }
    a = t;
  }
  return { up, atMs: null as number | null };
}

export interface WindowStats {
  sunFrac: number; earthFrac: number; bothFrac: number;
  maxDarkH: number; maxOutageH: number; meanSunEl: number;
}

/** Hourly stats over a window (default one lunar day, 29.5 d). */
export function windowStats(site: { lat: number; lon: number }, startMs: number, mask = 0, hours = 709): WindowStats {
  let sun = 0, ea = 0, both = 0, dark = 0, maxD = 0, out = 0, maxO = 0, eSum = 0;
  const n = hours;
  for (let h = 0; h < n; h++) {
    const p = skyAt(site, startMs + h * HOUR);
    const S = p.sunEl > mask, E = p.earthEl > mask;
    if (S) { sun++; eSum += p.sunEl; dark = 0; } else { dark++; maxD = Math.max(maxD, dark); }
    if (E) { ea++; out = 0; } else { out++; maxO = Math.max(maxO, out); }
    if (S && E) both++;
  }
  return { sunFrac: sun / n, earthFrac: ea / n, bothFrac: both / n, maxDarkH: maxD, maxOutageH: maxO, meanSunEl: sun ? eSum / sun : 0 };
}
