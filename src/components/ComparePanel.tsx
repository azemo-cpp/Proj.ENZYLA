import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Answer } from './DarylAnswer';
import CompareHeatmap from './CompareHeatmap';
import { CompareCharts, CompareTable, PALETTE } from './CompareViews';
import { OFFLINE_MESSAGE, darylBase, fetchSeries, postJson } from './darylApi';
import type { CompareResult, DarylSite, SeriesResult } from './darylApi';
import { loadChat, nextChatId, saveChat } from './chatMemory';

// Compare landing sites and discuss the results with Daryl.
// Site data and comparison results come from the Daryl API.

interface Props {
  /** The active site, selected automatically when the panel first opens. */
  activeSite?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional API base URL. */
  api?: string;
}

interface Message { id: number; role: 'user' | 'daryl'; text: string; error?: boolean; }

const GREETING = 'Pick two or more sites and ask me anything about them. Results follow your controls. Try "Why is the leader ahead?" for the full breakdown.';
const SUGGESTIONS = ['Why is the leader ahead?', 'Compare them in a table', 'What are the power risks?'];
const CHAT_KEY = 'enzyla.compare.chat.v1';
const DAY_CHOICES = [7, 14, 30, 60];
const LABEL = { fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.4)' };

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const newDateFromToday = (days: number) => { const n = new Date(); return isoDate(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) + days * 864e5)); };
const defaultDate = () => newDateFromToday(3); // Match the planner's default date.

// The slider covers 30 days before today through 180 days after. Use the date field for exact dates.
const DATE_MIN = -30;
const DATE_MAX = 180;
const dayOffset = (iso: string) => {
  const n = new Date();
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - today) / 864e5);
};
const dateFromOffset = (n: number) => newDateFromToday(n);
const offsetLabel = (n: number) => (n === 0 ? 'today' : n > 0 ? `in ${n} day${n === 1 ? '' : 's'}` : `${-n} day${n === -1 ? '' : 's'} ago`);

// Keep the panel's icons local instead of adding an icon package.
const Icon = ({ size, d }: { size: number; d: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
    <path d={d} />
  </svg>
);
const GitCompare = ({ size }: { size: number }) => <Icon size={size} d="M2 5h9M8 2l3 3-3 3M14 11H5M8 8l-3 3 3 3" />;
const X = ({ size }: { size: number }) => <Icon size={size} d="M3 3l10 10M13 3L3 13" />;

// Stop pointer events from reaching the 3D scene.
const keepInside = (e: SyntheticEvent) => e.stopPropagation();

export default function ComparePanel({ activeSite, api, open, onOpenChange }: Props) {
  const [sites, setSites] = useState<DarylSite[]>([]);
  const [limits, setLimits] = useState({ min: 2, max: 8 });
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');

  const [selected, setSelected] = useState<number[]>([]);       // Keep site IDs in selection order.
  const [slots, setSlots] = useState<Record<number, number>>({}); // Keep each site's color stable.
  const [days, setDays] = useState(14);
  const [date, setDate] = useState(defaultDate);
  const [mask, setMask] = useState(1);                            // Horizon and terrain clearance, in degrees.

  const [result, setResult] = useState<CompareResult | null>(null);
  const [resultKey, setResultKey] = useState('');
  const [series, setSeries] = useState<SeriesResult | null>(null);
  const [seriesError, setSeriesError] = useState('');
  const [view, setView] = useState<'table' | 'charts' | 'heatmap'>('table');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [messages, setMessages] = useState<Message[]>(() => loadChat(CHAT_KEY, GREETING) as Message[]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const nextId = useRef(nextChatId(messages));
  const autoPicked = useRef(false);
  const seriesSeq = useRef(0);
  const cancelRef = useRef<AbortController | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const key = `${selected.join(',')}|${days}|${date}|${mask}`;
  const enough = selected.length >= limits.min && selected.length <= limits.max;

  // Load the site list the first time the panel opens.
  useEffect(() => {
    if (!open || sites.length) return;
    let live = true;
    (async () => {
      try {
        const base = await darylBase(api);
        const res = await fetch(`${base}/api/sites`, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (!live) return;
        if (!res.ok || !Array.isArray(data?.sites)) throw new Error('bad list');
        setSites(data.sites as DarylSite[]);
        if (data.limits) setLimits({ min: data.limits.minCompare ?? 2, max: data.limits.maxCompare ?? 8 });
        setLoadError('');
      } catch {
        if (live) setLoadError(OFFLINE_MESSAGE);
      }
    })();
    return () => { live = false; };
  }, [open, sites.length, api]);

  // Preselect the active site when it is available.
  useEffect(() => {
    if (!open || autoPicked.current || !sites.length) return;
    autoPicked.current = true;
    const s = sites.find(x => x.name === activeSite);
    if (s) { setSelected([s.index]); setSlots({ [s.index]: 0 }); }
  }, [open, sites, activeSite]);

  // Move focus into the panel, then return it to the launcher.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) { wasOpen.current = true; closeRef.current?.focus(); }
    else if (wasOpen.current) launcherRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => { saveChat(CHAT_KEY, messages); }, [messages]);

  function clearChat() {
    setMessages([{ id: 0, role: 'daryl', text: GREETING }]);
    nextId.current = 1;
  }

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, DarylSite[]>();
    for (const s of sites) {
      if (q && !s.name.toLowerCase().includes(q) && !(s.category ?? '').toLowerCase().includes(q)) continue;
      const g = s.category ?? 'Sites';
      groups.set(g, [...(groups.get(g) ?? []), s]);
    }
    return [...groups.entries()];
  }, [sites, query]);

  const byIndex = useMemo(() => new Map(sites.map(s => [s.index, s])), [sites]);
  const colors = useMemo(() => {
    const out: Record<number, string> = {};
    for (const [i, slot] of Object.entries(slots)) out[Number(i)] = PALETTE[slot % PALETTE.length];
    return out;
  }, [slots]);

  function toggle(index: number) {
    if (selected.includes(index)) {
      setSelected(selected.filter(i => i !== index));
      setSlots(({ [index]: _gone, ...rest }) => rest);
      return;
    }
    if (selected.length >= limits.max) return;
    const used = new Set(Object.values(slots));
    let slot = 0;
    while (used.has(slot)) slot++;
    setSelected([...selected, index]);
    setSlots({ ...slots, [index]: slot });
  }

  function clearAll() {
    setSelected([]);
    setSlots({});
  }

  async function compare() {
    if (!enough) return;
    // Cancel the previous request when a control changes.
    cancelRef.current?.abort();
    const cancel = new AbortController();
    cancelRef.current = cancel;
    const seq = ++seriesSeq.current;
    setLoading(true);
    setError('');
    try {
      const base = await darylBase(api);
      const data = await postJson(base, '/api/compare', { sites: selected, days, date, mask }, 15000, cancel.signal) as CompareResult;
      if (seriesSeq.current !== seq) return;
      setResult(data);
      setResultKey(key);
      setSeriesError('');

      // The table remains available if hourly data for charts and the heatmap fails.
      const window = data.window;
      fetchSeries(base, { sites: selected, days: window.days, date: window.start, mask: window.mask ?? mask }, 20000, cancel.signal)
        .then(s => { if (seriesSeq.current === seq) setSeries(s); })
        .catch(() => { if (seriesSeq.current === seq) setSeriesError('Hourly elevations are unavailable right now. They reload when you change a control.'); });
    } catch (e) {
      if (seriesSeq.current !== seq) return;
      const m = e as Error;
      if (m?.name === 'AbortError') return;
      setError(m?.name === 'TimeoutError' || m instanceof TypeError ? OFFLINE_MESSAGE : m.message);
    } finally {
      if (seriesSeq.current === seq) setLoading(false);
    }
  }

  // Refresh results on every control change and cancel any request already in flight.
  useEffect(() => {
    if (!open) return;
    if (!enough) {
      cancelRef.current?.abort();
      setResult(null);
      setResultKey('');
      setSeries(null);
      setSeriesError('');
      setError('');
      setLoading(false);
      return;
    }
    if (key === resultKey) return;
    compare();
    // Only the comparison key should trigger a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, enough, resultKey]);

  async function ask(text?: string) {
    const question = (text ?? draft).trim();
    if (!question || busy) return;

    const history = messages
      .filter(m => m.id !== 0 && !m.error)
      .slice(-8)
      .map(m => ({ role: m.role, text: m.text.slice(0, 600) }));

    const replyId = nextId.current + 1;
    setMessages(m => [...m, { id: nextId.current, role: 'user', text: question }, { id: replyId, role: 'daryl', text: 'Thinking…' }]);
    nextId.current += 2;
    setDraft('');
    setBusy(true);

    const setReply = (t: string, err = false) =>
      setMessages(m => m.map(x => (x.id === replyId ? { ...x, text: t, error: err } : x)));

    try {
      const base = await darylBase(api);
      // Keep Daryl's answer focused on the selected sites and date range.
      const settings: Record<string, unknown> = { days, date, mask };
      if (selected.length >= 2) {
        settings.sites = selected.slice(0, limits.max);
        settings.siteA = selected[0];
        settings.siteB = selected[1];
      }
      const data = await postJson(base, '/api/ask', { question, settings, ...(history.length && { history }) }, 90000);
      setReply(String(data.answer));
    } catch (e) {
      const m = e as Error;
      setReply(m?.name === 'TimeoutError' ? 'That took too long. Please try again.' : m instanceof TypeError ? OFFLINE_MESSAGE : m.message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => onOpenChange(true)}
        aria-haspopup="dialog"
        style={{
          position: 'fixed', top: 68, left: 24, zIndex: 20, pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
          background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 32,
          fontSize: 11, fontWeight: 700, letterSpacing: '1.17px', textTransform: 'uppercase', cursor: 'pointer',
        }}
      >
        <GitCompare size={13} /> Compare sites
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Compare landing sites"
          className="cmp-overlay"
          onPointerDown={keepInside}
          onPointerUp={keepInside}
          onClick={keepInside}
          onDoubleClick={keepInside}
          onKeyDown={e => { if (e.key === 'Escape') onOpenChange(false); }}
        >
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div>
              <div style={LABEL}>Landing site comparison</div>
              <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>Compare sites</div>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close comparison"
              style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 32, padding: '7px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '1.17px', textTransform: 'uppercase' }}
            >
              <X size={13} /> Close
            </button>
          </header>

          <div className="cmp-grid">
            {/* Site picker */}
            <section className="cmp-col" aria-label="Choose sites" style={{ borderRight: '1px solid rgba(255,255,255,0.08)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={LABEL}>Pick sites ({selected.length}/{limits.max})</span>
                {selected.length > 0 && (
                  <button type="button" onClick={clearAll} style={{ background: 'none', border: 0, color: 'rgba(255,255,255,0.6)', fontSize: 10, textDecoration: 'underline', cursor: 'pointer' }}>Clear</button>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} aria-live="polite">
                {selected.length === 0 && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Nothing picked yet. Choose at least {limits.min}.</span>}
                {selected.map(i => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggle(i)}
                    aria-label={`Remove ${byIndex.get(i)?.name ?? i}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', fontSize: 11, color: '#fff', background: 'rgba(255,255,255,0.06)', border: `1px solid ${colors[i]}`, cursor: 'pointer' }}
                  >
                    <span aria-hidden style={{ width: 8, height: 8, background: colors[i] }} />
                    {byIndex.get(i)?.name}
                    <X size={10} />
                  </button>
                ))}
              </div>

              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Search sites"
                placeholder="Search sites"
                style={{ padding: '7px 9px', fontSize: 16, color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)' }}
              />

              <div style={{ flex: '1 1 auto', minHeight: 120, overflowY: 'auto' }}>
                {loadError && <p style={{ fontSize: 11, color: '#ff9b9b' }}>{loadError}</p>}
                {!loadError && sites.length === 0 && <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Loading sites…</p>}
                {grouped.map(([group, list]) => (
                  <div key={group} role="group" aria-label={group} style={{ marginBottom: 10 }}>
                    <div style={{ ...LABEL, fontSize: 8, padding: '4px 0' }}>{group}</div>
                    {list.map(s => {
                      const on = selected.includes(s.index);
                      const full = !on && selected.length >= limits.max;
                      return (
                        <button
                          key={s.index}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-disabled={full}
                          onClick={() => toggle(s.index)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', textAlign: 'left',
                            background: on ? 'rgba(255,255,255,0.07)' : 'transparent', border: 0, color: '#fff',
                            opacity: full ? 0.35 : 1, cursor: full ? 'not-allowed' : 'pointer', fontSize: 12,
                          }}
                        >
                          <span aria-hidden style={{ width: 11, height: 11, flexShrink: 0, border: '1px solid rgba(255,255,255,0.5)', background: on ? colors[s.index] : 'transparent' }} />
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontVariantNumeric: 'tabular-nums' }}>
                            {Math.abs(s.latitude).toFixed(1)}°{s.latitude >= 0 ? 'N' : 'S'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {sites.length > 0 && grouped.length === 0 && <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>No site matches “{query}”.</p>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
                <label style={{ display: 'grid', gap: 4, ...LABEL, fontSize: 8 }}>
                  Mission length
                  <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ padding: '6px', fontSize: 12, color: '#fff', background: '#111', border: '1px solid rgba(255,255,255,0.2)', textTransform: 'none', letterSpacing: 0 }}>
                    {DAY_CHOICES.map(d => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4, ...LABEL, fontSize: 8 }}>
                  Landing date
                  <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ padding: '5px', fontSize: 12, color: '#fff', background: '#111', border: '1px solid rgba(255,255,255,0.2)', colorScheme: 'dark' }} />
                </label>
              </div>

              <div style={{ display: 'grid', gap: 3 }}>
                <input
                  type="range"
                  className="cmp-slider"
                  min={DATE_MIN}
                  max={DATE_MAX}
                  step={1}
                  value={Math.max(DATE_MIN, Math.min(DATE_MAX, dayOffset(date)))}
                  onChange={e => setDate(dateFromOffset(Number(e.target.value)))}
                  aria-label="Landing date, days from today"
                  aria-valuetext={`${date}, ${offsetLabel(dayOffset(date))}`}
                />
                <div aria-hidden style={{ display: 'flex', justifyContent: 'space-between', letterSpacing: 0, textTransform: 'none', fontSize: 8, color: 'rgba(255,255,255,0.32)' }}>
                  <span>{DATE_MIN} d</span>
                  <span style={{ color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' }}>{offsetLabel(dayOffset(date))}</span>
                  <span>+{DATE_MAX} d</span>
                </div>
              </div>

              <label style={{ display: 'grid', gap: 4, ...LABEL, fontSize: 8, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  Horizon + terrain mask
                  <span style={{ letterSpacing: 0, textTransform: 'none', fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.7)' }}>{mask}°</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={mask}
                  onChange={e => setMask(Number(e.target.value))}
                  aria-label="Minimum elevation above the horizon, in degrees"
                  style={{ width: '100%', accentColor: '#fff', cursor: 'pointer' }}
                />
                <span style={{ letterSpacing: 0, textTransform: 'none', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
                  Sun or Earth must clear this many degrees. 0° = flat horizon.
                </span>
              </label>

              <p role="status" style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 0 }}>
                {enough ? 'Results update as you change these controls.' : `Pick at least ${limits.min} sites. Results update automatically.`}
              </p>
            </section>

            {/* Comparison results */}
            <section className="cmp-col" aria-label="Comparison results" style={{ padding: 20, minWidth: 0 }}>
              {error && <p role="alert" style={{ fontSize: 12, color: '#ff9b9b', marginBottom: 12 }}>{error}</p>}

              {!result && !error && (
                <div style={{ height: '100%', minHeight: 160, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12, padding: 24 }}>
                  <p>{loading ? 'Comparing…' : `Pick ${limits.min} or more sites on the left.`}<br />{!loading && 'The table, charts and day-by-day heatmap appear here and refresh on every change.'}</p>
                </div>
              )}

              {result && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
                    <div style={{ flex: '1 1 320px', minWidth: 0, borderLeft: '2px solid rgba(255,255,255,0.18)', paddingLeft: 12 }}>
                      <div style={LABEL}>{result.window.days}-day mission from {result.window.start}</div>
                      <p style={{ fontSize: 13, lineHeight: 1.55, marginTop: 6, maxWidth: 720, color: 'rgba(255,255,255,0.85)' }}>{result.summary}</p>
                    </div>
                    <div role="tablist" aria-label="Result view" className="cmp-tabs">
                      {([['table', 'Table'], ['charts', 'Charts'], ['heatmap', 'Heatmap']] as const).map(([v, name]) => (
                        <button
                          key={v}
                          type="button"
                          role="tab"
                          aria-selected={view === v}
                          className="cmp-tab"
                          onClick={() => setView(v)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <section aria-label="ENZYLA score" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 8, marginBottom: 12 }}>
                    {[...result.sites].sort((a, b) => a.rank - b.rank || b.enzyScore - a.enzyScore).map(s => {
                      const lead = s.rank === 1;
                      return (
                        <div
                          key={s.index}
                          style={{
                            borderStyle: 'solid',
                            borderWidth: 1,
                            borderTopWidth: 3,
                            borderRightColor: lead ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
                            borderBottomColor: lead ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
                            borderLeftColor: lead ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
                            borderTopColor: colors[s.index],
                            borderRadius: 4, padding: '9px 11px',
                            background: lead ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                            <span key={s.enzyScore} className="cmp-pop" style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.enzyScore}</span>
                            <span style={{ ...LABEL, fontSize: 8 }}>/ 100</span>
                            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>#{s.rank}</span>
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>
                            <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, background: colors[s.index], marginRight: 6 }} />
                            {s.name}
                          </div>
                          <div style={{ ...LABEL, fontSize: 7, marginTop: 4 }}>{lead ? 'ENZYLA score · leader' : 'ENZYLA score'}</div>
                        </div>
                      );
                    })}
                  </section>

                  <div>
                    {view === 'table'
                      ? <CompareTable result={result} colors={colors} />
                      : view === 'charts'
                        ? <CompareCharts result={result} colors={colors} />
                        : <CompareHeatmap
                            result={result}
                            series={series}
                            seriesError={seriesError}
                            colors={colors}
                            onPickDate={d => setDate(d)}
                          />}
                  </div>

                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 16, lineHeight: 1.5, maxWidth: 720 }}>
                    The ENZYLA score averages five measures on a 0 to 100 scale: sunlight, Earth visibility, both together,
                    longest darkness, and longest communication outage. The result is scaled to 1 to 100. Sun and Earth
                    visibility come from Daryl's planner model; temperatures are Diviner extremes for the nearest 0.5° cell, so
                    shadowed craters are not resolved.
                  </p>
                </>
              )}
            </section>

            {/* Daryl chat */}
            <aside className="cmp-col" aria-label="Ask Daryl" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ padding: '14px 16px 8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={LABEL}>Mission assistant</div>
                  {messages.length > 1 && (
                    <button
                      type="button"
                      onClick={clearChat}
                      style={{ background: 'none', border: 0, padding: 0, color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}
                    >
                      Clear chat
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 2 }}>Daryl</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                  {selected.length >= 2
                    ? `Focused on ${selected.map(i => byIndex.get(i)?.name).filter(Boolean).join(', ')}`
                    : 'Pick 2 or more sites so I can focus on them.'}
                </div>
              </div>

              <div ref={logRef} role="log" aria-live="polite" style={{ flex: '1 1 auto', minHeight: 140, overflowY: 'auto', padding: '4px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {messages.map(m => (
                  <div
                    key={m.id}
                    style={{
                      maxWidth: '100%', padding: '7px 9px', fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere',
                      alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
                      background: m.role === 'user' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${m.role === 'user' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
                      color: m.error ? '#ff9b9b' : '#fff',
                    }}
                  >
                    {m.role === 'user' ? m.text : <Answer text={m.text} nowrap />}
                  </div>
                ))}
              </div>

              <div style={{ padding: '8px 16px 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => ask(s)}
                    style={{ padding: '4px 9px', fontSize: 10, color: '#fff', background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 32, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.4 : 1 }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6, padding: 12 }}>
                <input
                  type="text"
                  value={draft}
                  maxLength={2000}
                  autoComplete="off"
                  aria-label="Your question for Daryl"
                  placeholder="Ask about these sites"
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') ask(); }}
                  style={{ flex: 1, minWidth: 0, padding: '7px 9px', fontSize: 16, color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)' }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => ask()}
                  style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', color: '#fff', background: 'transparent', border: '1px solid #fff', borderRadius: 32, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.4 : 1 }}
                >
                  Send
                </button>
              </div>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
