import type { CSSProperties } from 'react';
import type { CompareMetric, CompareResult, CompareSite } from './darylApi';

// Colour-blind-safe palette (Okabe–Ito, tuned for a black background). Names are always written next to the colour.
export const PALETTE = ['#56B4E9', '#E69F00', '#009E73', '#F0E442', '#CC79A7', '#E8704A', '#A99BFF', '#D9D9D9'];

const LABEL: CSSProperties = { fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' };

export function fmtValue(key: string, v: number | null | undefined): string {
  if (v == null) return 'n/a';
  switch (key) {
    case 'enzyScore': return `${v} / 100`;
    case 'score': return String(v);
    case 'sunPct': case 'earthPct': case 'bothPct': return `${v}%`;
    case 'longestDarkH': case 'longestOutageH': return v >= 48 ? `${Math.round((v / 24) * 10) / 10} days` : `${v} h`;
    case 'meanSunElev': return `${v}°`;
    case 'maxC': case 'minC': return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} °C`;
    default: return String(v);
  }
}

const value = (s: CompareSite, key: string): number | null => (s as unknown as Record<string, number | null>)[key];

function Swatch({ color }: { color: string }) {
  return <span aria-hidden style={{ display: 'inline-block', width: 9, height: 9, background: color, flexShrink: 0 }} />;
}

interface ViewProps { result: CompareResult; colors: Record<number, string>; }

/* ── Table: one column per site, one row per measure. The best site in each row is marked. ── */
export function CompareTable({ result, colors }: ViewProps) {
  const cell: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', textAlign: 'left', verticalAlign: 'middle', fontSize: 12 };
  return (
    <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 150 + result.sites.length * 96 }}>
        <caption style={{ ...LABEL, textAlign: 'left', padding: '0 0 8px', captionSide: 'top' }}>
          Marked ▲ = best in that row
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ ...cell, ...LABEL, position: 'sticky', left: 0, background: '#000' }}>Measure</th>
            {result.sites.map(s => (
              <th key={s.index} scope="col" style={{ ...cell, fontWeight: 700, verticalAlign: 'top' }}>
                <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ paddingTop: 3, display: 'inline-flex' }}><Swatch color={colors[s.index]} /></span>{s.name}
                </span>
                {s.type && <div style={{ ...LABEL, fontSize: 8, marginTop: 3 }}>{s.type}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" style={{ ...cell, fontWeight: 400, color: 'rgba(255,255,255,0.6)', position: 'sticky', left: 0, background: '#000' }}>Rank</th>
            {result.sites.map(s => (
              <td key={s.index} style={{ ...cell, fontWeight: s.rank === 1 ? 800 : 400 }}>#{s.rank}</td>
            ))}
          </tr>
          {result.metrics.map((m: CompareMetric) => {
            const best = result.best[m.key];
            return (
              <tr key={m.key}>
                <th scope="row" style={{ ...cell, fontWeight: 400, color: 'rgba(255,255,255,0.6)', position: 'sticky', left: 0, background: '#000', whiteSpace: 'nowrap' }}>
                  {m.label}
                  {m.better && <span style={{ ...LABEL, fontSize: 8, marginLeft: 6 }}>{m.better === 'high' ? 'higher is better' : 'lower is better'}</span>}
                </th>
                {result.sites.map(s => {
                  const isBest = Boolean(best && !best.allTied && best.sites.includes(s.name));
                  return (
                    <td
                      key={s.index}
                      style={{
                        ...cell, fontVariantNumeric: 'tabular-nums',
                        fontWeight: isBest ? 800 : 400,
                        background: isBest ? 'rgba(255,255,255,0.09)' : undefined,
                      }}
                    >
                      {fmtValue(m.key, value(s, m.key))}{isBest && <span aria-label="best" style={{ marginLeft: 6, fontSize: 9 }}>▲</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Charts ── */
interface Bar { name: string; color: string; v: number; best: boolean; }

function BarChart({ title, hint, bars, max, fmt }: { title: string; hint: string; bars: Bar[]; max: number; fmt: (v: number) => string }) {
  return (
    <section aria-label={title} style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</h3>
        <span style={{ ...LABEL, fontSize: 8 }}>{hint}</span>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {bars.map(b => (
          <div key={b.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 120px) 1fr 62px', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Swatch color={b.color} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.name}>{b.name}</span>
            </span>
            <span style={{ height: 10, background: 'rgba(255,255,255,0.06)', position: 'relative' }}>
              <span style={{ position: 'absolute', inset: '0 auto 0 0', width: `${max > 0 ? Math.max(0, Math.min(100, (b.v / max) * 100)) : 0}%`, background: b.color, minWidth: b.v > 0 ? 2 : 0, transition: 'width 200ms ease' }} />
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', fontWeight: b.best ? 800 : 400 }}>
              {fmt(b.v)}{b.best ? ' ▲' : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RangeChart({ result, colors }: ViewProps) {
  const rows = result.sites.filter(s => s.minC != null && s.maxC != null);
  if (rows.length === 0) return null;
  const lo = Math.floor((Math.min(...rows.map(s => s.minC as number)) - 10) / 10) * 10;
  const hi = Math.ceil((Math.max(...rows.map(s => s.maxC as number)) + 10) / 10) * 10;
  const pos = (c: number) => `${((c - lo) / (hi - lo)) * 100}%`;
  return (
    <section aria-label="Surface temperature range" style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Surface temperature range</h3>
        <span style={{ ...LABEL, fontSize: 8 }}>Diviner, coldest to hottest</span>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(s => (
          <div key={s.index} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 120px) 1fr 110px', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Swatch color={colors[s.index]} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</span>
            </span>
            <span style={{ height: 10, background: 'rgba(255,255,255,0.06)', position: 'relative' }}>
              <span style={{ position: 'absolute', top: 0, bottom: 0, left: pos(s.minC as number), right: `calc(100% - ${pos(s.maxC as number)})`, background: colors[s.index], minWidth: 2, transition: 'left 200ms ease, right 200ms ease' }} />
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
              {fmtValue('minC', s.minC)} / {fmtValue('maxC', s.maxC)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingLeft: 'min(128px, 25%)', paddingRight: 118, ...LABEL, fontSize: 8 }}>
        <span>{fmtValue('minC', lo)}</span><span>{fmtValue('maxC', hi)}</span>
      </div>
    </section>
  );
}

export function CompareCharts({ result, colors }: ViewProps) {
  const make = (key: string, title: string, hint: string, better: 'high' | 'low', fixedMax?: number) => {
    const best = result.best[key];
    const bars: Bar[] = result.sites
      .map(s => ({ name: s.name, color: colors[s.index], v: value(s, key) as number, best: Boolean(best && !best.allTied && best.sites.includes(s.name)) }))
      .sort((a, b) => (better === 'high' ? b.v - a.v : a.v - b.v));
    const max = fixedMax ?? Math.max(1, ...bars.map(b => b.v));
    return <BarChart key={key} title={title} hint={hint} bars={bars} max={max} fmt={v => fmtValue(key, v)} />;
  };
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
      {make('enzyScore', 'ENZYLA score', 'average of all five measures · higher is better', 'high', 100)}
      {make('score', 'Planner score', 'out of 100 · higher is better', 'high', 100)}
      {make('sunPct', 'Sunlit (power)', 'share of window · higher is better', 'high', 100)}
      {make('earthPct', 'Earth visible (comms)', 'share of window · higher is better', 'high', 100)}
      {make('longestDarkH', 'Longest darkness', 'lower is better', 'low')}
      {make('longestOutageH', 'Longest comm outage', 'lower is better', 'low')}
      <RangeChart result={result} colors={colors} />
    </div>
  );
}
