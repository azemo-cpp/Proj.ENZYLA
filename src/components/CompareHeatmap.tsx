import type { CSSProperties } from 'react';
import { useRef } from 'react';
import type { CompareResult, CompareSite, SeriesResult, SeriesSite } from './darylApi';
import { fmtValue } from './CompareViews';
import SkyPlot from './SkyPlot';

// Daily heatmap, elevation/horizon charts and the longest communication outage, all from the same
// hourly Sun/Earth elevation series.

const LABEL: CSSProperties = { fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' };

interface DayStats { sun: number; earth: number; both: number; maxDarkH: number; maxOutH: number; enzy: number; }

// ENZYLA score for one day: average of sun%, Earth%, both%, darkness and outage scores, scaled 1-100.
// Same formula as the server's whole-window score, so a cell and the site card agree.
function dayStats(site: SeriesSite, day: number, mask: number): DayStats {
  const from = day * 24;
  const to = Math.min(from + 24, site.sunEl.length);
  let sun = 0, earth = 0, both = 0, n = 0;
  let darkRun = 0, maxDark = 0, outRun = 0, maxOut = 0;
  for (let h = from; h < to; h++) {
    const s = site.sunEl[h] > mask;
    const e = site.earthEl[h] > mask;
    if (s) { sun++; darkRun = 0; } else { darkRun++; if (darkRun > maxDark) maxDark = darkRun; }
    if (e) { earth++; outRun = 0; } else { outRun++; if (outRun > maxOut) maxOut = outRun; }
    if (s && e) both++;
    n++;
  }
  if (!n) return { sun: 0, earth: 0, both: 0, maxDarkH: 0, maxOutH: 0, enzy: 1 };
  const sunP = (sun / n) * 100;
  const earthP = (earth / n) * 100;
  const bothP = (both / n) * 100;
  const dark = 100 * (1 - maxDark / n);
  const outage = 100 * (1 - maxOut / n);
  const enzy = Math.round(Math.max(1, Math.min(100, (sunP + earthP + bothP + dark + outage) / 5)));
  return { sun: sun / n, earth: earth / n, both: both / n, maxDarkH: maxDark, maxOutH: maxOut, enzy };
}

// Red (bad) → amber → green (good). Kept dark enough for white text on top.
function heat(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  return `hsl(${Math.round(4 + s * 126)} 60% ${Math.round(17 + s * 25)}%)`;
}

const addDays = (iso: string, n: number) => {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return new Date(ms + n * 864e5).toISOString().slice(0, 10);
};
const md = (iso: string) => iso.slice(5).replace('-', '/');

interface Props {
  result: CompareResult;
  series: SeriesResult | null;
  seriesError: string;
  colors: Record<number, string>;
  /** Clicking a heatmap column picks that day as the mission start. */
  onPickDate: (date: string) => void;
}

export default function CompareHeatmap({ result, series, seriesError, colors, onPickDate }: Props) {
  // While a newer result is on screen, the hourly series may still describe the previous window.
  // Drawing the two together would put the old days under the new heading, so hold the last complete
  // pair instead of collapsing to a one-line placeholder: collapsing changes the column's height and
  // makes its scroll container snap back to the top while the user is dragging the date slider.
  const matches = series !== null && series.start === result.window.start && series.days === result.window.days && series.mask === result.window.mask;
  const lastGood = useRef<{ result: CompareResult; series: SeriesResult } | null>(null);
  if (matches) lastGood.current = { result, series };
  const good = matches ? { result, series } : lastGood.current;

  if (!good) {
    return (
      <p role="status" style={{ fontSize: 12, color: seriesError ? '#ff9b9b' : 'rgba(255,255,255,0.45)', padding: 16 }}>
        {seriesError || 'Loading daily elevations…'}
      </p>
    );
  }

  const { result: shown, series: shownSeries } = good;
  const days = Math.max(1, Math.round(shownSeries.days));
  const mask = shownSeries.mask;
  const order = new Map(shown.sites.map((s, i) => [s.index, i]));
  const rows = [...shownSeries.series].sort((a, b) => (order.get(a.index) ?? 0) - (order.get(b.index) ?? 0));

  return (
    <div aria-busy={!matches} style={{ display: 'grid', gap: 16, opacity: matches ? 1 : 0.55, transition: 'opacity 160ms ease' }}>
      {!matches && (
        <span role="status" style={{ ...LABEL, fontSize: 8, color: 'rgba(255,255,255,0.6)' }}>
          {seriesError || 'Updating this view…'}
        </span>
      )}
      <Heatmap result={shown} series={shownSeries} rows={rows} days={days} mask={mask} colors={colors} onPickDate={onPickDate} />
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8 }}>
          <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Sky plot · azimuth and elevation</h3>
          <span style={{ ...LABEL, fontSize: 8 }}>N up · rim = horizon · centre = zenith</span>
        </div>
        <div key={shownSeries.start + shownSeries.mask} className="cmp-fade" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
          {rows.map(r => (
            <SkyPlot key={r.index} site={r} mask={mask} color={colors[r.index] ?? '#fff'} />
          ))}
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Elevation and horizon</h3>
          <span style={{ ...LABEL, fontSize: 8 }}>Sun solid · Earth dashed · horizon {mask}°</span>
        </div>
        <div key={shownSeries.start + shownSeries.mask} className="cmp-fade" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {rows.map(r => (
            <ElevationChart
              key={r.index}
              site={r}
              start={shownSeries.start}
              days={days}
              mask={mask}
              color={colors[r.index] ?? '#fff'}
              outage={shown.sites.find(s => s.index === r.index)?.longestOutageH}
            />
          ))}
        </div>
      </div>
      <OutageStrip sites={shown.sites} seriesRows={rows} mask={mask} colors={colors} />
      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5, margin: 0 }}>
        Each cell is that day's ENZYLA score on a 1–100 scale: the average of sunlight, Earth visibility, both together,
        darkness and comm outage. A site counts as lit or in view only when it is above the horizon plus the terrain mask.
        Click a day to make it the mission start.
      </p>
    </div>
  );
}

function Heatmap({ result, series, rows, days, mask, colors, onPickDate }: {
  result: CompareResult;
  series: SeriesResult;
  rows: SeriesSite[];
  days: number;
  mask: number;
  colors: Record<number, string>;
  onPickDate: (date: string) => void;
}) {
  const dates = Array.from({ length: days }, (_, d) => addDays(series.start, d));
  const grid = `minmax(112px, 170px) repeat(${days}, minmax(20px, 1fr))`;
  const labelEvery = days <= 42 ? 7 : 14;

  return (
    <section aria-label="Daily ENZYLA score heatmap" style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Daily ENZYLA score</h3>
        <span style={{ ...LABEL, fontSize: 8 }}>{series.days}-day window from {series.start} · horizon {mask}°</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: grid, minWidth: 112 + days * 20, rowGap: 2, columnGap: 2 }}>
          <span />
          {dates.map((d, i) => (
            <span key={d} style={{ ...LABEL, fontSize: 7, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {i % labelEvery === 0 ? md(d) : ''}
            </span>
          ))}

          {rows.map(site => (
            <Row key={site.index} site={site} dates={dates} mask={mask} color={colors[site.index] ?? '#fff'}
              cmp={result.sites.find(x => x.index === site.index)} onPickDate={onPickDate} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span style={{ ...LABEL, fontSize: 8 }}>0</span>
        <span aria-hidden style={{ flex: '1 0 120px', maxWidth: 240, height: 6, background: 'linear-gradient(90deg, hsl(4 60% 17%), hsl(67 60% 30%), hsl(130 60% 42%))' }} />
        <span style={{ ...LABEL, fontSize: 8 }}>100</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginLeft: 'auto' }}>ENZYLA score per day</span>
      </div>
    </section>
  );
}

function Row({ site, dates, mask, color, cmp, onPickDate }: {
  site: SeriesSite;
  dates: string[];
  mask: number;
  color: string;
  cmp?: CompareSite;
  onPickDate: (date: string) => void;
}) {
  return (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, paddingRight: 4 }}>
        <span aria-hidden style={{ width: 8, height: 8, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={site.name}>{site.name}</span>
        {cmp && <span style={{ ...LABEL, fontSize: 7, marginLeft: 'auto' }}>#{cmp.rank}</span>}
      </span>
      {dates.map((d, day) => {
        const st = dayStats(site, day, mask);
        const pct = st.enzy;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onPickDate(d)}
            title={`${site.name} · ${d} · ENZYLA ${pct}/100 · sun ${Math.round(st.sun * 100)}% · Earth ${Math.round(st.earth * 100)}% · both ${Math.round(st.both * 100)}% · longest dark ${st.maxDarkH} h · outage ${st.maxOutH} h`}
            aria-label={`Start mission at ${site.name} on ${d}, ENZYLA score ${pct}`}
            style={{
              height: 24, padding: 0, border: 0, cursor: 'pointer', background: heat(pct / 100),
              color: 'rgba(255,255,255,0.9)', fontSize: 8, fontVariantNumeric: 'tabular-nums',
              borderTop: pct >= 99 ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
              transition: 'background-color 180ms ease',
            }}
          >
            {daysWide(dates.length) ? pct : ''}
          </button>
        );
      })}
    </>
  );
}

function daysWide(n: number) { return n <= 21; }

function ElevationChart({ site, start, days, mask, color, outage }: {
  site: SeriesSite;
  start: string;
  days: number;
  mask: number;
  color: string;
  outage?: number;
}) {
  const W = 340, H = 128;
  const PAD = { l: 26, r: 8, t: 8, b: 18 };
  const N = site.sunEl.length;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (h: number) => PAD.l + (h / Math.max(1, N - 1)) * innerW;
  const y = (v: number) => PAD.t + ((90 - Math.max(-90, Math.min(90, v))) / 180) * innerH;

  const step = Math.max(1, Math.ceil(N / 480));
  const path = (arr: number[]) => {
    let d = '';
    for (let h = 0; h < N; h += step) d += `${h ? 'L' : 'M'}${x(h).toFixed(1)} ${y(arr[h]).toFixed(1)}`;
    const last = N - 1;
    d += `L${x(last).toFixed(1)} ${y(arr[last]).toFixed(1)}`;
    return d;
  };

  const ticks = [90, 45, 0, -45, -90];
  const dayTicks = Array.from({ length: days }, (_, d) => d).filter(d => d % Math.max(1, Math.ceil(days / 6)) === 0);

  return (
    <section aria-label={`Elevation for ${site.name}`} style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span aria-hidden style={{ width: 8, height: 8, background: color }} />
        <span style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
        {outage != null && (
          <span style={{ ...LABEL, fontSize: 8, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            comm outage {fmtValue('longestOutageH', outage)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sun and Earth elevation over ${days} days at ${site.name}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
            <text x={2} y={y(t) + 3} fill="rgba(255,255,255,0.4)" fontSize={7}>{t}°</text>
          </g>
        ))}
        {dayTicks.map(d => (
          <g key={d}>
            <line x1={x(d * 24)} x2={x(d * 24)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={x(d * 24)} y={H - 5} fill="rgba(255,255,255,0.35)" fontSize={7} textAnchor="middle">{md(addDays(start, d)).slice(0, 5)}</text>
          </g>
        ))}

        {/* horizon + terrain mask: anything below this line is not usable */}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(mask)} y2={y(mask)} stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeDasharray="5 3" />
        <text x={W - PAD.r} y={y(mask) - 3} fill="rgba(255,255,255,0.55)" fontSize={7} textAnchor="end">horizon +{mask}°</text>

        <path d={path(site.earthEl)} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray="3 2" opacity={0.65} />
        <path d={path(site.sunEl)} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
    </section>
  );
}

function OutageStrip({ sites, seriesRows, mask, colors }: {
  sites: CompareSite[];
  seriesRows: SeriesSite[];
  mask: number;
  colors: Record<number, string>;
}) {
  const max = Math.max(24, ...sites.map(s => s.longestOutageH));
  const ordered = [...sites].sort((a, b) => b.longestOutageH - a.longestOutageH);

  // Why the number often refuses to move: Earth is nearly fixed in the lunar sky, so its elevation barely
  // changes. Say whether it ever leaves the mask at all instead of leaving a bare "0 h".
  const earthRange = (index: number) => {
    const row = seriesRows.find(r => r.index === index);
    if (!row || !row.earthEl.length) return '';
    const low = Math.min(...row.earthEl);
    const high = Math.max(...row.earthEl);
    if (low > mask) return `never sets · low ${Math.round(low)}°`;
    if (high <= mask) return `never clears ${mask}°`;
    return `dips to ${Math.round(low)}°`;
  };

  return (
    <section aria-label="Longest communication outage" style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Longest communication outage</h3>
        <span style={{ ...LABEL, fontSize: 8 }}>Earth below horizon + {mask}° · lower is better</span>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {ordered.map(s => {
          const range = earthRange(s.index);
          return (
            <div key={s.index} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 150px) 1fr 72px minmax(112px, 150px)', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span aria-hidden style={{ width: 8, height: 8, background: colors[s.index], flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</span>
              </span>
              <span style={{ height: 8, background: 'rgba(255,255,255,0.06)' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.max(1, (s.longestOutageH / max) * 100)}%`, background: colors[s.index], transition: 'width 200ms ease' }} />
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtValue('longestOutageH', s.longestOutageH)}</span>
              <span style={{ ...LABEL, fontSize: 7, textAlign: 'right' }}>{range}</span>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5, margin: '10px 0 0' }}>
        Earth barely moves in the lunar sky — libration shifts it only a few degrees — so from near-side sites it
        never sets and the outage stays at 0 h for every date and mask. The value only moves at near-limb and far-side
        sites (LADEE, GRAIL A/B, Blue Ghost 1, Chang'e 4) or when the mask rises above Earth's lowest elevation.
      </p>
    </section>
  );
}
