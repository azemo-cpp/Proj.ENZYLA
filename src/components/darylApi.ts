// Shared helpers for talking to Daryl's web API from the compare panel.

export interface DarylSite {
  index: number;
  name: string;
  latitude: number;
  longitude: number;
  category: string | null;
}

export interface CompareMetric {
  key: string;
  label: string;
  unit: string;
  better: 'high' | 'low' | null;
}

export interface CompareSite {
  index: number;
  name: string;
  latitude: number;
  longitude: number;
  type: string | null;
  rank: number;
  enzyScore: number;
  score: number;
  sunPct: number;
  earthPct: number;
  bothPct: number;
  longestDarkH: number;
  longestOutageH: number;
  meanSunElev: number;
  maxC: number | null;
  minC: number | null;
}

export interface CompareResult {
  window: { start: string; days: number; mask: number };
  metrics: CompareMetric[];
  sites: CompareSite[];
  best: Record<string, { value: number; sites: string[]; allTied: boolean }>;
  summary: string;
}

/** Hourly elevations (degrees) and azimuths (degrees clockwise from north). */
export interface SeriesSite {
  index: number;
  name: string;
  sunEl: number[];
  earthEl: number[];
  sunAz: number[];
  earthAz: number[];
}

export interface SeriesResult {
  start: string;
  days: number;
  mask: number;
  series: SeriesSite[];
}

const env = (import.meta as any).env ?? {};
const IS_DEV = Boolean(env.DEV);

let cached: string | null = null;

async function isDaryl(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return Boolean(data?.ok && data?.name === 'Daryl');
  } catch {
    return false;
  }
}

/**
 * Where Daryl lives. An explicit `api` wins. Otherwise try VITE_DARYL_API, then the same address as the app
 * (Daryl inside the Vite dev server), then localhost:8787 (Daryl started on its own). The first one that
 * answers is remembered.
 */
export async function darylBase(api?: string): Promise<string> {
  if (api !== undefined) return api;
  if (cached !== null) return cached;
  const candidates: string[] = [];
  if (typeof env.VITE_DARYL_API === 'string') candidates.push(env.VITE_DARYL_API);
  candidates.push('');
  if (IS_DEV) candidates.push('http://localhost:8787');
  for (const c of [...new Set(candidates)]) {
    if (await isDaryl(c)) { cached = c; return c; }
  }
  return candidates[0];
}

export const OFFLINE_MESSAGE =
  "Can't reach Daryl right now." +
  (IS_DEV ? ' Start it with npm run dev (if Daryl runs inside Vite) or npm start in the daryl folder, then try again.' : '');

export async function postJson(base: string, route: string, body: unknown, timeoutMs: number, cancel?: AbortSignal): Promise<any> {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: cancel ? AbortSignal.any([AbortSignal.timeout(timeoutMs), cancel]) : AbortSignal.timeout(timeoutMs),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Sorry, something went wrong. Please try again.');
  return data;
}

/** Hourly Sun/Earth elevation per site, used by the heatmap and the elevation charts. */
export async function fetchSeries(
  base: string,
  body: { sites: number[]; days: number; date: string; mask?: number },
  timeoutMs = 15000,
  cancel?: AbortSignal
): Promise<SeriesResult> {
  return (await postJson(base, '/api/series', body, timeoutMs, cancel)) as SeriesResult;
}
