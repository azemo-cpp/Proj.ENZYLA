import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronUp, Globe, Pause, Play, SkipBack, SkipForward, Sun } from 'lucide-react';
import { DAY, HOUR, nextChange, series, skyAt, type SiteCoords } from '../lib/ephemeris';
import { crossings, niceScale, splitAzTrack } from '../lib/horizon';
import { simClock, useSimClock } from '../lib/simClock';

// Rates are simulated seconds per real second. The default is one simulated hour per second.
const SPEEDS = [
  { l: 'Real time', v: 1 }, { l: '10 min/s', v: 600 }, { l: '1 h/s', v: 3600 }, { l: '6 h/s', v: 21600 }, { l: '1 d/s', v: 86400 },
];
const MASKS = [0, 0.5, 1, 2, 3, 5];

const STYLE = `
.tp-label{font-size:8px;letter-spacing:.25em;text-transform:uppercase;color:rgba(255,255,255,.4);display:flex;align-items:center;gap:6px;line-height:1.4}
.tp-big{font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;font-variant-numeric:tabular-nums;margin-top:3px;white-space:nowrap}
.tp-mono{font-family:'Courier New',monospace}
.tp-pill{background:transparent;border:1px solid rgba(255,255,255,.4);border-radius:32px;color:#fff;cursor:pointer;font:700 9px/1 Inter,'Arial Narrow',Arial,sans-serif;letter-spacing:1.17px;text-transform:uppercase;padding:0 12px;min-height:26px;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background .2s,border-color .2s;touch-action:manipulation;color-scheme:dark}
.tp-pill:hover{background:rgba(255,255,255,.1);border-color:#fff}
.tp-pill.icon{padding:0;width:26px}
select.tp-pill{appearance:none;-webkit-appearance:none;background:#000}
input.tp-pill{font-family:'Courier New',monospace;letter-spacing:.05em;min-width:0;background:#000}
.tp-head:focus-visible,.tp-pill:focus-visible,.tp-track:focus-visible{outline:2px solid #fff;outline-offset:2px}
.tp-body{scrollbar-width:none}.tp-body::-webkit-scrollbar{width:0}
.tp-chev{width:22px;height:22px;border-radius:50%;border:1px solid rgba(255,255,255,.4);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .35s ease,border-color .15s,background .15s}
.tp-head:hover .tp-chev{border-color:#fff;background:rgba(255,255,255,.1)}
`;

const dim = 'rgba(255,255,255,.4)';
const mono = "'Courier New', monospace";
const isoMin = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const sgn = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;

function dur(ms: number) {
  const m = Math.max(0, Math.round(ms / 6e4));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d >= 2 ? `${d}d ${h}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
type Ev = { up: boolean; atMs: number | null };
const evText = (ev: Ev, now: number) => (ev.atMs === null ? (ev.up ? 'Up 60 d+' : 'Down 60 d+') : `${ev.up ? 'Sets' : 'Rises'} in ${dur(ev.atMs - now)}`);

function Status({ Icon, label, el, ev, now }: { Icon: typeof Sun; label: string; el: number; ev: Ev; now: number }) {
  return (
    <div>
      <div className="tp-label"><Icon size={10} /> {label} · <span className="tp-mono">{sgn(el)}</span></div>
      <div className="tp-big">{evText(ev, now)}</div>
    </div>
  );
}

// Draw the Sun and Earth across the local horizon.
const HW = 336, HH = 92, HL = 10, HR = 10, H_HOR = 64, H_TOP = 8, H_FLOOR = 88;

function HorizonView({ sky, trail, mask }: { sky: ReturnType<typeof skyAt>; trail: ReturnType<typeof skyAt>[]; mask: number }) {
  const maxEl = niceScale(Math.max(sky.sunEl, sky.earthEl, ...trail.map(p => Math.max(p.sunEl, p.earthEl))));
  const ppd = (H_HOR - H_TOP) / maxEl;
  const x = (az: number) => HL + (az / 360) * (HW - HL - HR);
  const y = (el: number) => Math.min(H_FLOOR, H_HOR - el * ppd);
  const line = (pick: (p: ReturnType<typeof skyAt>) => { az: number; el: number }, dash: string, op: number) =>
    splitAzTrack(trail.map(pick)).map((seg, i) => (
      <polyline key={i} fill="none" stroke="#fff" strokeOpacity={op} strokeDasharray={dash} points={seg.map(p => `${x(p.az).toFixed(1)},${y(p.el).toFixed(1)}`).join(' ')} />
    ));
  const sx = x(sky.sunAz), sy = y(sky.sunEl), ex = x(sky.earthAz), ey = y(sky.earthEl);
  const sUp = sky.sunEl > 0, eUp = sky.earthEl > 0;
  const lbl = (px: number, py: number, t: string, op: number) => (
    <text x={px > HW - 60 ? px - 9 : px + 9} y={py + 3} fontSize={7} letterSpacing={1.2} fill="#fff" fillOpacity={op} textAnchor={px > HW - 60 ? 'end' : 'start'} fontFamily={mono}>{t}</text>
  );
  return (
    <svg viewBox={`0 0 ${HW} ${HH}`} width="100%" style={{ display: 'block' }} role="img"
      aria-label={`Horizon view. Sun ${sgn(sky.sunEl)} at azimuth ${sky.sunAz.toFixed(0)}°, Earth ${sgn(sky.earthEl)} at azimuth ${sky.earthAz.toFixed(0)}°.`}>
      <defs>
        <pattern id="tp-hatch-h" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#fff" strokeOpacity=".08" /></pattern>
        <radialGradient id="tp-glow"><stop offset="0" stopColor="#fff" stopOpacity=".45" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      <rect x={HL} y={H_HOR} width={HW - HL - HR} height={HH - H_HOR} fill="url(#tp-hatch-h)" />
      {[maxEl / 2, maxEl].map(v => (
        <g key={v}><line x1={HL} x2={HW - HR} y1={y(v)} y2={y(v)} stroke="#fff" strokeOpacity=".08" strokeDasharray="2 3" />
          <text x={HW - HR} y={y(v) - 2} fontSize={6.5} fill="#fff" fillOpacity=".3" textAnchor="end" fontFamily={mono}>{v}°</text></g>
      ))}
      {mask > 0 && <g><line x1={HL} x2={HW - HR} y1={y(mask)} y2={y(mask)} stroke="#fff" strokeOpacity=".4" strokeDasharray="4 3" />
        <text x={HL + 2} y={y(mask) - 2} fontSize={6.5} fill="#fff" fillOpacity=".4" fontFamily={mono} letterSpacing={1}>MASK {mask}°</text></g>}
      <line x1={HL} x2={HW - HR} y1={H_HOR} y2={H_HOR} stroke="#fff" strokeOpacity=".7" />
      {[['N', 0], ['E', 90], ['S', 180], ['W', 270], ['N', 360]].map(([t, a], i) => (
        <g key={i}><line x1={x(Number(a))} x2={x(Number(a))} y1={H_HOR} y2={H_HOR + 3} stroke="#fff" strokeOpacity=".5" />
          <text x={x(Number(a))} y={H_HOR + 12} fontSize={7} fill="#fff" fillOpacity=".4" fontFamily={mono} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{t}</text></g>
      ))}
      {line(p => ({ az: p.earthAz, el: p.earthEl }), '1 3', 0.35)}
      {line(p => ({ az: p.sunAz, el: p.sunEl }), '1 3', 0.6)}
      {/* The Sun is a glowing disc. The Earth uses a ring. Both dim below the horizon. */}
      <g opacity={eUp ? 1 : 0.4}>
        <circle cx={ex} cy={ey} r={5} fill="#000" stroke="#fff" strokeWidth={1.2} strokeDasharray={eUp ? undefined : '2 2'} />
        <path d={`M${ex - 8},${ey}H${ex + 8}M${ex},${ey - 8}V${ey + 8}`} stroke="#fff" strokeWidth={0.8} />
      </g>
      <g opacity={sUp ? 1 : 0.45}>
        {sUp && <circle cx={sx} cy={sy} r={13} fill="url(#tp-glow)" />}
        <circle cx={sx} cy={sy} r={4.5} fill={sUp ? '#fff' : '#000'} stroke="#fff" strokeWidth={1.2} strokeDasharray={sUp ? undefined : '2 2'} />
      </g>
      {lbl(sx, Math.max(9, sy - 9), 'SUN', sUp ? 0.9 : 0.4)}
      {lbl(ex, Math.min(HH - 5, ey + 12), 'EARTH', eUp ? 0.9 : 0.4)}
    </svg>
  );
}

// Build the time track around a fixed playhead.
const TW = 336, TH = 88, TL = 24, TR = 8, TT = 8, TB = 16;
const TIW = TW - TL - TR, TIH = TH - TT - TB;
const HALF = 5 * DAY, SPAN = 2 * HALF, STEP = 2 * HOUR;

export default function TemporalPanel({ site, hidden = false }: { site: SiteCoords | null; hidden?: boolean }) {
  const { ms, playing, speed, mask } = useSimClock();
  const [open, setOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerHeight >= 900));
  const drag = useRef<{ x: number; ms: number; was: boolean } | null>(null);

  const blockStart = Math.floor((ms - 6 * DAY) / DAY) * DAY; // Keep a 13-day data window around the visible 10-day track.
  const sky = useMemo(() => (site ? skyAt(site, ms) : null), [site, ms]);
  const minute = Math.floor(ms / 6e4);
  const sunEv = useMemo(() => (site ? nextChange(site, ms, 'sun', mask) : null), [site, minute, mask]); // eslint-disable-line react-hooks/exhaustive-deps
  const earthEv = useMemo(() => (site ? nextChange(site, ms, 'earth', mask) : null), [site, minute, mask]); // eslint-disable-line react-hooks/exhaustive-deps
  const block = useMemo(() => (site ? series(site, blockStart, 13 * 24, 2) : []), [site, blockStart]);
  const trail = useMemo(() => (site ? Array.from({ length: 25 }, (_, i) => skyAt(site, ms + i * 2 * HOUR)) : []), [site, ms]);

  if (!site || !sky || !sunEv || !earthEv || block.length === 0) return null;

  // Map time and elevation values to the SVG.
  const t0v = ms - HALF;
  const tx = (t: number) => TL + ((t - t0v) / SPAN) * TIW;
  const yMax = niceScale(Math.max(0, ...block.map(p => Math.max(p.sunEl, p.earthEl))));
  const yMin = -niceScale(Math.max(0, -Math.min(0, ...block.map(p => Math.min(p.sunEl, p.earthEl)))));
  const ty = (e: number) => TT + ((yMax - Math.max(yMin, Math.min(yMax, e))) / (yMax - yMin)) * TIH;
  const y0 = ty(0), cx = tx(ms);
  const pts = (pick: (p: (typeof block)[number]) => number) => block.map((p, i) => `${tx(blockStart + i * STEP).toFixed(1)},${ty(pick(p)).toFixed(1)}`);
  const sunLine = pts(p => p.sunEl), earthLine = pts(p => p.earthEl);
  const sunArea = `M${tx(blockStart)},${y0} ` + pts(p => Math.max(0, p.sunEl)).map(q => `L${q}`).join(' ') + ` L${tx(blockStart + (block.length - 1) * STEP)},${y0} Z`;
  const sunX = crossings(block, blockStart, STEP, p => p.sunEl, mask), earthX = crossings(block, blockStart, STEP, p => p.earthEl, mask);
  const days: number[] = [];
  for (let d = Math.ceil(t0v / DAY) * DAY; d <= ms + HALF; d += DAY) days.push(d);

  function onDown(e: ReactPointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, ms, was: playing };
    simClock.setPlaying(false);
  }
  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * (TW / e.currentTarget.getBoundingClientRect().width);
    simClock.set(d.ms - (dx / TIW) * SPAN); // Drag the track to shift simulated time.
  }
  function onUp() { if (drag.current?.was) simClock.setPlaying(true); drag.current = null; }
  function onKey(e: ReactKeyboardEvent<SVGSVGElement>) {
    const k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!k) return;
    e.preventDefault();
    simClock.shift(k * (e.shiftKey ? DAY : HOUR));
  }

  const box: CSSProperties = { position: 'fixed', bottom: 64, right: 20, zIndex: 50, pointerEvents: hidden ? 'none' : 'auto', background: 'rgba(0,0,0,0.96)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', width: open ? 360 : 300 };
  const sep: CSSProperties = { borderTop: '1px solid rgba(255,255,255,0.08)' };

  return (
    <div className={`temporal-panel${hidden ? ' is-hidden' : ''}`} style={box} aria-hidden={hidden}>
      <style>{STYLE}</style>

      {/* Keep the header visible and show the next Sun event while collapsed. */}
      <button type="button" className="tp-head" aria-expanded={open} aria-controls="tp-body" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ minWidth: 0 }}>
          <div className="tp-label">Time · Horizon</div>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{site.name}</div>
        </div>
        <div className="tp-label" style={{ flex: 1, justifyContent: 'flex-end', opacity: open ? 0 : 1, transition: 'opacity .25s', whiteSpace: 'nowrap' }}>
          <Sun size={10} /> {evText(sunEv, ms)}
        </div>
        <span className="tp-chev" style={{ transform: open ? 'rotate(180deg)' : 'none' }} aria-hidden><ChevronUp size={12} /></span>
      </button>

      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: `grid-template-rows .35s ease, visibility 0s linear ${open ? '0s' : '.35s'}`, visibility: open ? 'visible' : 'hidden' }}>
        <div id="tp-body" className="tp-body" style={{ minHeight: 0, overflowY: 'auto', overflowX: 'hidden', maxHeight: 'max(200px, calc(100vh - 460px))' }}>
          <div style={{ ...sep, padding: '10px 14px 0' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input className="tp-pill" aria-label="Date and time (UTC)" type="datetime-local" value={isoMin(ms)} style={{ flex: 1 }}
                onChange={e => { const t = Date.parse(e.target.value + ':00Z'); if (Number.isFinite(t)) simClock.set(t); }} />
              <button type="button" className="tp-pill" onClick={() => simClock.now()}>Now</button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
              <button type="button" className="tp-pill icon" aria-label="Back one day" onClick={() => simClock.shift(-DAY)}><SkipBack size={11} /></button>
              <button type="button" className="tp-pill" aria-label={playing ? 'Pause' : 'Play'} onClick={() => simClock.setPlaying(!playing)} style={{ minWidth: 76 }}>
                {playing ? <Pause size={11} /> : <Play size={11} />}{playing ? 'Pause' : 'Play'}
              </button>
              <button type="button" className="tp-pill icon" aria-label="Forward one day" onClick={() => simClock.shift(DAY)}><SkipForward size={11} /></button>
              <select className="tp-pill" aria-label="Playback speed" value={speed} onChange={e => simClock.setSpeed(Number(e.target.value))} style={{ flex: 1 }}>
                {SPEEDS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </div>

            <div className="tp-label" style={{ marginBottom: 4 }}>Horizon view · azimuth × elevation · dotted = next 48 h</div>
            <HorizonView sky={sky} trail={trail} mask={mask} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '8px 0 10px' }}>
              <Status Icon={Sun} label="Sun" el={sky.sunEl} ev={sunEv} now={ms} />
              <Status Icon={Globe} label="Earth" el={sky.earthEl} ev={earthEv} now={ms} />
            </div>
          </div>

          <div style={{ ...sep, padding: '10px 14px 0' }}>
            <div className="tp-label" style={{ marginBottom: 4, justifyContent: 'space-between' }}>
              <span>Horizon track · ±5 days</span><span className="tp-mono" style={{ letterSpacing: '0.05em' }}>{new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC</span>
            </div>
            <svg className="tp-track" viewBox={`0 0 ${TW} ${TH}`} width="100%" tabIndex={0} role="slider" aria-label="Time track. Drag, scroll or use arrow keys to change the time."
              aria-valuetext={new Date(ms).toISOString()} aria-valuemin={0} aria-valuemax={0} aria-valuenow={0}
              style={{ display: 'block', touchAction: 'none', cursor: 'grab' }}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              onWheel={e => simClock.shift(e.deltaY * 108000)} onKeyDown={onKey}>
              <defs>
                <pattern id="tp-hatch-t" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#fff" strokeOpacity=".08" /></pattern>
                <clipPath id="tp-clip"><rect x={TL} y={0} width={TIW} height={TH} /></clipPath>
              </defs>
              <rect x={TL} y={y0} width={TIW} height={TT + TIH - y0} fill="url(#tp-hatch-t)" />
              {[yMax, 0, yMin].map(v => (
                <text key={v} x={TL - 4} y={ty(v) + 2.5} fontSize={6.5} fill="#fff" fillOpacity=".35" textAnchor="end" fontFamily={mono}>{v}°</text>
              ))}
              <g clipPath="url(#tp-clip)">
                <path d={sunArea} fill="#fff" fillOpacity=".12" />
                <line x1={TL} x2={TL + TIW} y1={y0} y2={y0} stroke="#fff" strokeOpacity=".7" />
                {mask > 0 && <line x1={TL} x2={TL + TIW} y1={ty(mask)} y2={ty(mask)} stroke="#fff" strokeOpacity=".4" strokeDasharray="4 3" />}
                <polyline points={earthLine.join(' ')} fill="none" stroke="#fff" strokeOpacity=".6" strokeDasharray="3 3" />
                <polyline points={sunLine.join(' ')} fill="none" stroke="#fff" strokeWidth={1.4} />
                {earthX.map((c, i) => <circle key={`e${i}`} cx={tx(c.t)} cy={ty(mask)} r={2.5} fill="#000" stroke="#fff" />)}
                {sunX.map((c, i) => <circle key={`s${i}`} cx={tx(c.t)} cy={ty(mask)} r={2.5} fill="#fff" />)}
                {days.map(d => (
                  <g key={d}><line x1={tx(d)} x2={tx(d)} y1={TT + TIH} y2={TT + TIH + 3} stroke="#fff" strokeOpacity=".4" />
                    {Math.floor(d / DAY) % 2 === 0 && <text x={tx(d)} y={TH - 3} fontSize={6.5} fill="#fff" fillOpacity=".4" textAnchor="middle" fontFamily={mono}>{new Date(d).toISOString().slice(5, 10)}</text>}</g>
                ))}
              </g>
              <line x1={cx} x2={cx} y1={TT - 3} y2={TT + TIH} stroke="#fff" strokeWidth={1} />
              <path d={`M${cx - 3},${TT - 5} L${cx + 3},${TT - 5} L${cx},${TT - 1} Z`} fill="#fff" />
              <circle cx={cx} cy={ty(sky.sunEl)} r={3} fill="#fff" />
              <circle cx={cx} cy={ty(sky.earthEl)} r={3} fill="#000" stroke="#fff" />
            </svg>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0 10px' }}>
              <div className="tp-label" style={{ letterSpacing: '0.15em' }}>● Sun &nbsp;○ Earth &nbsp;crossing the horizon</div>
              <label className="tp-label" style={{ gap: 6 }}>
                Mask
                <select className="tp-pill" aria-label="Terrain horizon mask" value={mask} onChange={e => simClock.setMask(Number(e.target.value))} style={{ minHeight: 22, padding: '0 10px' }}>
                  {MASKS.map(m => <option key={m} value={m}>{m}°</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
