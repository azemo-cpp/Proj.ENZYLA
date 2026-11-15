import { useMemo } from 'react';
import { Sun, Globe, Radio, Moon, Compass, MapPin } from 'lucide-react';
import { APOLLO_SITES } from '../data/apolloSites';
import { skyAt, windowStats, HOUR, type SiteCoords } from '../lib/ephemeris';
import { useSimClock } from '../lib/simClock';

interface Props { activeSite: string; site: SiteCoords | null; onSelect: (name: string, lat: number, lon: number) => void; }

const iconSize = 13;
const iconColor = 'rgba(255,255,255,0.5)';
const pct = (x: number) => `${Math.round(x * 100)}%`;
const hrs = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h} h`);

export default function SiteTimeline({ activeSite, site, onSelect }: Props) {
  const { ms, mask } = useSimClock();
  const hourKey = Math.floor(ms / HOUR);
  // Everything below is computed from the Sun/Earth model for the 29.5 days starting at the simulated time.
  const now = useMemo(() => (site ? skyAt(site, ms) : null), [site, ms]);
  const st = useMemo(() => (site ? windowStats(site, hourKey * HOUR, mask) : null), [site, hourKey, mask]);

  const metrics = now && st ? [
    { Icon: Sun,     label: 'Sun elevation now',         value: `${now.sunEl.toFixed(1)}°` },
    { Icon: Globe,   label: 'Earth elevation now',       value: `${now.earthEl.toFixed(1)}°` },
    { Icon: Sun,     label: 'Sunlit, next lunar day',    value: pct(st.sunFrac) },
    { Icon: Radio,   label: 'Earth in view (DTE)',       value: pct(st.earthFrac) },
    { Icon: Compass, label: 'Sun & Earth together',      value: pct(st.bothFrac) },
    { Icon: Moon,    label: 'Longest darkness',          value: hrs(st.maxDarkH) },
    { Icon: Radio,   label: 'Longest comm outage',       value: hrs(st.maxOutageH) },
    { Icon: Sun,     label: 'Mean Sun elev. when lit',   value: `${st.meanSunEl.toFixed(1)}°` },
  ] : [];

  return (
    <>
      {site && st && (
        <div style={{ position: 'fixed', top: 64, right: 20, width: 270, zIndex: 20, pointerEvents: 'auto', background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={12} color="rgba(255,255,255,0.5)" />
            <div>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', lineHeight: 1 }}>Site Conditions</div>
              <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fff', marginTop: 2 }}>{site.name}</div>
            </div>
          </div>
          <div style={{ padding: '10px 16px 12px' }}>
            {metrics.map(({ Icon, label, value }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Icon size={iconSize} color={iconColor} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', flex: 1, letterSpacing: '0.04em' }}>{label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '6px 16px 8px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>
            Computed · simplified Sun/Earth model · smooth sphere · mask {mask}°
          </div>
        </div>
      )}

      <div className="timeline-strip" style={{ pointerEvents: 'auto' }}>
        {APOLLO_SITES.map((s, i) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <span className="timeline-sep" aria-hidden>|</span>}
            <button type="button" className={`timeline-item${s.name === activeSite ? ' active' : ''}`} onClick={() => onSelect(s.name, s.lat, s.lon)} aria-label={`Go to ${s.name}`}>{s.name}</button>
          </div>
        ))}
      </div>
    </>
  );
}
