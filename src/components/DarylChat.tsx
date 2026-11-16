import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// Daryl, the lunar mission assistant. A small box docked at the bottom-left: click its header to open or close it.
// Hiwalay na server ang Daryl (sarili niyang repo). Kailangan itong tumatakbo: npm start sa Daryl folder.
// Dev: http://localhost:8787 ang default. Production: i-set ang VITE_DARYL_API (o ipasa ang api prop).

interface Props {
  /** The site selected in the app, e.g. "Apollo 11". Daryl uses it as the default site. */
  activeSite?: string;
  /** Base URL of the Daryl server, e.g. "https://daryl.example.com". Overrides VITE_DARYL_API and the dev default. */
  api?: string;
}

interface Message { id: number; role: 'user' | 'daryl'; text: string; error?: boolean; }
interface DarylSite { index: number; name: string; }
type Block =
  | { kind: 'text'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'chart'; spec: any };

const DEFAULT_API = '';
const OFFLINE = "Can't reach Daryl right now. Please try again in a moment.";
const GREETING = "Hi, I'm Daryl. Ask me to compare landing sites or find the best landing date.";
const FONT_SMALL = { fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' as const };

// Answers can contain three things: plain text, markdown pipe tables
// (| a | b |), and fenced ```chart blocks carrying a small bar-chart spec.
// Everything is rendered from data by React, so nothing in an answer can inject HTML.
function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let textLines: string[] = [];
  let tableLines: string[] = [];

  const flushText = () => {
    const joined = textLines.join('\n').replace(/^\n+|\n+$/g, '');
    if (joined) blocks.push({ kind: 'text', text: joined });
    textLines = [];
  };
  const flushTable = () => {
    if (!tableLines.length) return;
    const rows = tableLines
      .map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
      .filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)));
    blocks.push({ kind: 'table', rows });
    tableLines = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```chart')) {
      flushText();
      flushTable();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
      i++; // closing fence (or end of text)
      try {
        const spec = JSON.parse(buf.join('\n'));
        if (spec && spec.type === 'bar') blocks.push({ kind: 'chart', spec });
      } catch { /* ignore a malformed chart block */ }
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) { flushText(); tableLines.push(line); }
    else { flushTable(); textLines.push(line); }
    i++;
  }
  flushText();
  flushTable();
  return blocks;
}

const CHART_COLORS = ['#ffd166', '#4cc9f0', '#b5e48c', '#f4a261', '#ef6f6c'];
function Chart({ spec }: { spec: any }) {
  const labels: string[] = Array.isArray(spec?.labels) ? spec.labels : [];
  const series: { name: string; values: number[]; unit?: string }[] = Array.isArray(spec?.series) ? spec.series : [];
  if (!labels.length || !series.length) return null;
  const flat = series.flatMap((s: any) => (Array.isArray(s?.values) ? s.values : []));
  const max = typeof spec?.max === 'number' && spec.max > 0 ? spec.max : Math.max(100, ...flat, 1);
  const W = 280, H = 132, padL = 6, padR = 6, padT = 14, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const groupW = plotW / Math.max(labels.length, 1);
  const seriesCount = series.length;
  const barGap = 1;
  const barW = Math.max(3, Math.min(20, (groupW * 0.82) / seriesCount - barGap));
  return (
    <div style={{ margin: '8px 0' }}>
      {spec?.title ? (
        <div style={{ fontSize: 10, opacity: 0.65, marginBottom: 3, letterSpacing: '0.04em' }}>{String(spec.title)}</div>
      ) : null}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {[0, 0.5, 1].map(f => {
          const y = padT + plotH * (1 - f);
          return <line key={f} x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />;
        })}
        {labels.map((lab, gi) => {
          const center = padL + groupW * gi + groupW / 2;
          const start = center - (barW * seriesCount + barGap * (seriesCount - 1)) / 2;
          return (
            <g key={gi}>
              {series.map((s, si) => {
                const v = Math.max(0, Number(s.values?.[gi]) || 0);
                const h = (v / max) * plotH;
                const x = start + si * (barW + barGap);
                const y = padT + plotH - h;
                return (
                  <rect key={si} x={x} y={y} width={barW} height={h} fill={CHART_COLORS[si % CHART_COLORS.length]} rx={1}>
                    <title>{`${lab} · ${s.name}: ${v}${s.unit ?? ''}`}</title>
                  </rect>
                );
              })}
              <text x={center} y={H - 8} fontSize={9} fill="rgba(255,255,255,0.7)" textAnchor="middle">
                {lab.length > 11 ? lab.slice(0, 10) + '…' : lab}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px', fontSize: 10, marginTop: 2 }}>
        {series.map((s, si) => (
          <span key={si} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, opacity: 0.8 }}>
            <span style={{ width: 7, height: 7, background: CHART_COLORS[si % CHART_COLORS.length], display: 'inline-block', borderRadius: 1 }} />
            {String(s.name)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Answer({ text }: { text: string }) {
  return (
    <>
      {parseAnswer(text).map((block, i) => {
        if (block.kind === 'text')
          return <p key={i} style={{ whiteSpace: 'pre-wrap', margin: '0 0 6px' }}>{block.text}</p>;
        if (block.kind === 'table')
          return (
            <div key={i} style={{ overflowX: 'auto', margin: '6px 0' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  {block.rows[0]?.map((cell, c) => (
                    <th key={c} style={cellStyle(true)}>{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.slice(1).map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => <td key={c} style={cellStyle(false)}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          );
        return <Chart key={i} spec={block.spec} />;
      })}
    </>
  );
}

function cellStyle(head: boolean) {
  return {
    border: '1px solid rgba(255,255,255,0.12)',
    padding: '5px 8px',
    textAlign: 'left' as const,
    verticalAlign: 'top' as const,
    ...(head ? { fontWeight: 700, color: 'rgba(255,255,255,0.7)' } : {}),
  };
}

// The 3D scene listens for clicks on the whole window, so clicks inside the chat must not reach it.
const keepInside = (e: SyntheticEvent) => e.stopPropagation();

export default function DarylChat({ activeSite, api }: Props) {
  const base: string = api ?? (import.meta as any).env?.VITE_DARYL_API ?? DEFAULT_API;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'daryl', text: GREETING }]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const sites = useRef<DarylSite[] | null>(null);
  const nextId = useRef(1);
  const hasOpened = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      hasOpened.current = true;
      inputRef.current?.focus();
    } else if (hasOpened.current) {
      headerRef.current?.focus(); // balik ang focus sa header pag isinara
    }
  }, [open]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // Site list ng Daryl, kinukuha isang beses lang kapag successful
  async function loadSites(): Promise<DarylSite[]> {
    if (sites.current) return sites.current;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(`${base}/api/sites`, { signal: ctl.signal });
      const data = await res.json();
      if (res.ok && Array.isArray(data?.sites)) {
        sites.current = data.sites as DarylSite[];
        return sites.current;
      }
    } catch { /* hindi pa ready ang server, okay lang */ }
    finally { clearTimeout(timer); }
    return [];
  }

  // Default ni Daryl ang site na napili sa app, katabi ang isa pang site para may maikumpara
  async function settingsForActiveSite() {
    if (!activeSite) return undefined;
    const list = await loadSites();
    const current = list.find(s => s.name === activeSite);
    if (!current) return undefined;
    const other = list.length > 1 ? list[(list.indexOf(current) + 1) % list.length] : undefined;
    return other ? { siteA: current.index, siteB: other.index } : { siteA: current.index };
  }

  async function send() {
    const question = draft.trim();
    if (!question || busy) return;

    // Ang huling 6 na mensahe (hindi kasama ang greeting at mga error), para maintindihan ni Daryl ang follow-up
    const history = messages
      .filter(m => m.id !== 0 && !m.error)
      .slice(-6)
      .map(m => ({ role: m.role, text: m.text.slice(0, 600) }));

    const replyId = nextId.current + 1;
    setMessages(m => [
      ...m,
      { id: nextId.current, role: 'user', text: question },
      { id: replyId, role: 'daryl', text: 'Thinking…' },
    ]);
    nextId.current += 2;
    setDraft('');
    setBusy(true);

    const setReply = (text: string, error = false) =>
      setMessages(m => m.map(x => (x.id === replyId ? { ...x, text, error } : x)));

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000); // mas mahaba, kasi baka mabagal ang language model
    try {
      const settings = await settingsForActiveSite();
      const res = await fetch(`${base}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, ...(settings && { settings }), ...(history.length && { history }) }),
        signal: ctl.signal,
      });
      let data: any = null;
      try { data = await res.json(); } catch { /* hindi JSON ang sagot */ }

      if (res.ok && data?.ok) setReply(String(data.answer));
      else setReply(data?.message ?? 'Sorry, something went wrong. Please try again.', true);
    } catch (e) {
      setReply(
        (e as Error)?.name === 'AbortError'
          ? 'That took too long. Please try again.'
          : OFFLINE,
        true
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className="daryl-chat-window"
        onPointerDown={keepInside}
        onDoubleClick={keepInside}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false); }}
        style={{
          position: 'fixed', left: 20, bottom: 72, zIndex: 30, pointerEvents: 'auto',
          width: 'min(300px, calc(100vw - 24px))',
          background: 'rgba(0,0,0,0.88)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff',
        }}
      >
      <button
        ref={headerRef}
        type="button"
        aria-expanded={open}
        aria-controls="daryl-body"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: 'none', border: 0, color: '#fff', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span>
          <span style={{ ...FONT_SMALL, display: 'block', color: 'rgba(255,255,255,0.3)', lineHeight: 1 }}>Mission Assistant</span>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 2 }}>
            Daryl
          </span>
        </span>
        {open ? <ChevronDown size={14} color="rgba(255,255,255,0.6)" /> : <ChevronUp size={14} color="rgba(255,255,255,0.6)" />}
      </button>

      {open && (
        <div id="daryl-body" className="daryl-chat-body" role="region" aria-label="Chat with Daryl" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            style={{
              height: 'min(320px, calc(100vh - 280px))', minHeight: 150, overflowY: 'auto',
              padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            {messages.map(m => (
              <div
                key={m.id}
                style={{
                  maxWidth: '95%', padding: '7px 9px', fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere',
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  background: m.role === 'user' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${m.role === 'user' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
                  color: m.error ? '#ff9b9b' : '#fff',
                }}
              >
                {m.role === 'user' ? m.text : <Answer text={m.text} />}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={2000}
              autoComplete="off"
              aria-label="Your question"
              placeholder="Ask about a site"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              style={{
                flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 16, color: '#fff',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)',
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={send}
              style={{
                padding: '7px 12px', fontSize: 12, fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase',
                color: '#fff', background: 'transparent', border: '1px solid #fff', borderRadius: 32,
                cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.4 : 1,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
      </div>
      <style>{`
        @media (max-width: 700px) {
          .daryl-chat-window {
            left: 12px !important;
            right: auto !important;
            bottom: 64px !important;
            width: min(300px, calc(50vw - 18px)) !important;
          }
        }
      `}</style>
    </>
  );
}
