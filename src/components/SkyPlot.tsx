import type { SeriesSite } from './darylApi';

// Polar azimuth–elevation chart ("sky plot"): N up, E right, rim = horizon (0°), centre = zenith (90°).
// Sun = solid track, Earth = dashed track. Only positions above the horizon are drawn.

const LABEL = { fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.4)' };

export default function SkyPlot({ site, mask, color }: { site: SeriesSite; mask: number; color: string }) {
  const S = 260, cx = S / 2, cy = S / 2, R = 104;
  const rOf = (elev: number) => (R * (90 - Math.max(0, Math.min(90, elev)))) / 90;
  const xy = (az: number, elev: number) => {
    const rad = (az * Math.PI) / 180;
    const r = rOf(elev);
    return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)] as const;
  };

  const N = site.sunEl.length;
  const step = Math.max(1, Math.ceil(N / 480));

  const track = (el: number[], az: number[]) => {
    let d = '', pen = false;
    const add = (i: number) => {
      const [x, y] = xy(az[i], el[i]);
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
      pen = true;
    };
    for (let i = 0; i < N; i += step) {
      if (el[i] <= 0) { pen = false; continue; }
      add(i);
    }
    if ((N - 1) % step !== 0 && el[N - 1] > 0) add(N - 1);
    return d.trim();
  };

  const firstAbove = (el: number[]) => el.findIndex(v => v > 0);
  const lastAbove = (el: number[]) => {
    for (let i = el.length - 1; i >= 0; i--) if (el[i] > 0) return i;
    return -1;
  };

  const sunPath = track(site.sunEl, site.sunAz);
  const earthPath = track(site.earthEl, site.earthAz);
  const sunStart = firstAbove(site.sunEl), sunEnd = lastAbove(site.sunEl);
  const earthStart = firstAbove(site.earthEl);

  const tick = (az: number) => {
    const rad = (az * Math.PI) / 180;
    return {
      x1: cx + (R - 4) * Math.sin(rad), y1: cy - (R - 4) * Math.cos(rad),
      x2: cx + R * Math.sin(rad), y2: cy - R * Math.cos(rad),
    };
  };
  const card = { N: [cx, cy - R - 7], E: [cx + R + 9, cy + 3], S: [cx, cy + R + 15], W: [cx - R - 9, cy + 3] } as const;

  return (
    <section aria-label={`Sky plot for ${site.name}`} style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span aria-hidden style={{ width: 8, height: 8, background: color }} />
        <span style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
        <span style={{ ...LABEL, fontSize: 8, marginLeft: 'auto', whiteSpace: 'nowrap' }}>sky plot</span>
      </div>

      <svg viewBox={`0 0 ${S} ${S}`} role="img"
        aria-label={`Sky plot for ${site.name}: Sun and Earth positions in azimuth and elevation over the window`}
        style={{ width: '100%', height: 'auto', display: 'block' }}>
        <title>{`${site.name}: Sun solid, Earth dashed. Rim is the horizon, centre is the zenith.`}</title>

        <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
        <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="rgba(255,255,255,0.08)" />
        <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="rgba(255,255,255,0.08)" />

        {[30, 60].map(deg => (
          <circle key={deg} cx={cx} cy={cy} r={rOf(deg)} fill="none" stroke="rgba(255,255,255,0.1)" strokeDasharray="2 3" />
        ))}
        <text x={cx + 3} y={cy - rOf(60) + 8} fill="rgba(255,255,255,0.35)" fontSize={7}>60°</text>
        <text x={cx + 3} y={cy - rOf(30) + 8} fill="rgba(255,255,255,0.35)" fontSize={7}>30°</text>

        {/* anything inside this ring is hidden by the horizon plus terrain mask */}
        {mask > 0 && (
          <circle cx={cx} cy={cy} r={rOf(mask)} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="5 3" />
        )}

        {[0, 45, 90, 135, 180, 225, 270, 315].map(az => {
          const t = tick(az);
          return <line key={az} {...t} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />;
        })}

        {(['N', 'E', 'S', 'W'] as const).map(dir => (
          <text key={dir} x={card[dir][0]} y={card[dir][1]} fill="rgba(255,255,255,0.6)" fontSize={9} textAnchor="middle">{dir}</text>
        ))}

        {earthPath && <path d={earthPath} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray="3 2" opacity={0.7} />}
        {sunPath && <path d={sunPath} fill="none" stroke={color} strokeWidth={1.5} />}

        {earthStart >= 0 && (() => { const [x, y] = xy(site.earthAz[earthStart], site.earthEl[earthStart]); return <circle cx={x} cy={y} r={2} fill={color} opacity={0.7} />; })()}
        {sunStart >= 0 && (() => { const [x, y] = xy(site.sunAz[sunStart], site.sunEl[sunStart]); return <circle cx={x} cy={y} r={2.5} fill={color} />; })()}
        {sunEnd >= 0 && sunEnd !== sunStart && (() => { const [x, y] = xy(site.sunAz[sunEnd], site.sunEl[sunEnd]); return <rect x={x - 2} y={y - 2} width={4} height={4} fill="none" stroke={color} strokeWidth={1.2} />; })()}
      </svg>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4, fontSize: 9, color: 'rgba(255,255,255,0.45)' }}>
        <span>Sun solid · Earth dashed</span>
        <span>{mask > 0 ? `mask ${mask}°` : 'flat horizon'}</span>
      </div>
      {!sunPath && <p style={{ fontSize: 9, color: '#ff9b9b', margin: '2px 0 0' }}>Sun stays below the horizon for this window.</p>}
      {!earthPath && <p style={{ fontSize: 9, color: '#ff9b9b', margin: '2px 0 0' }}>Earth stays below the horizon for this window.</p>}
    </section>
  );
}
