import type { SkyPoint } from './ephemeris';

// Elevation scales for horizon views. Polar sites live in the bottom few degrees; equatorial sites use the full sky.
export const SCALES = [5, 10, 15, 30, 60, 90];
export const niceScale = (v: number) => SCALES.find(s => s >= v) ?? 90;

/** Times (ms) at which pick(point) crosses the (masked) horizon, linearly interpolated between samples. */
export function crossings(data: SkyPoint[], startMs: number, stepMs: number, pick: (p: SkyPoint) => number, mask: number) {
  const out: { t: number; rising: boolean }[] = [];
  for (let i = 1; i < data.length; i++) {
    const a = pick(data[i - 1]) - mask, b = pick(data[i]) - mask;
    if (a > 0 !== b > 0) out.push({ t: startMs + (i - 1 + a / (a - b)) * stepMs, rising: b > 0 });
  }
  return out;
}

/** Splits an azimuth track wherever it wraps 360 -> 0, so a path is never drawn across the whole panorama. */
export function splitAzTrack<T extends { az: number }>(pts: T[]): T[][] {
  const segs: T[][] = [];
  let cur: T[] = [];
  pts.forEach((p, i) => {
    if (i && Math.abs(p.az - pts[i - 1].az) > 180) { segs.push(cur); cur = []; }
    cur.push(p);
  });
  if (cur.length) segs.push(cur);
  return segs;
}
