import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// Daryl, the lunar mission assistant. A small box docked at the bottom-right: click its header to open or close it.
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
type Block = { kind: 'text'; text: string } | { kind: 'table'; rows: string[][] };

const IS_DEV = Boolean((import.meta as any).env?.DEV);
const DEFAULT_API = IS_DEV ? 'http://localhost:8787' : '';
const OFFLINE =
  "Can't reach Daryl right now." +
  (IS_DEV ? ' Is the Daryl server running? Start it with: npm start (in the Daryl folder)' : '');
const GREETING = "Hi, I'm Daryl. Ask me to compare landing sites or find the best landing date.";
const FONT_SMALL = { fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase' as const };

// "| a | b |" lines become a table, the rest stays plain text.
// Everything is rendered as text by React, so nothing in an answer can inject HTML.
function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
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

  for (const line of text.split('\n')) {
    if (/^\s*\|.*\|\s*$/.test(line)) { flushText(); tableLines.push(line); }
    else { flushTable(); textLines.push(line); }
  }
  flushText();
  flushTable();
  return blocks;
}

function Answer({ text }: { text: string }) {
  return (
    <>
      {parseAnswer(text).map((block, i) =>
        block.kind === 'text' ? (
          <p key={i} style={{ whiteSpace: 'pre-wrap', margin: '0 0 6px' }}>{block.text}</p>
        ) : (
          <div key={i} style={{ overflowX: 'auto', margin: '6px 0' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
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
        )
      )}
    </>
  );
}

function cellStyle(head: boolean) {
  return {
    border: '1px solid rgba(255,255,255,0.12)',
    padding: '4px 8px',
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
    <div
      onPointerDown={keepInside}
      onDoubleClick={keepInside}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false); }}
      style={{
        position: 'fixed', right: 20, bottom: 72, zIndex: 30, pointerEvents: 'auto',
        width: 'min(280px, calc(100vw - 24px))',
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
          <span style={{ display: 'block', fontSize: 12, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 2 }}>
            Daryl
          </span>
        </span>
        {open ? <ChevronDown size={14} color="rgba(255,255,255,0.6)" /> : <ChevronUp size={14} color="rgba(255,255,255,0.6)" />}
      </button>

      {open && (
        <div id="daryl-body" role="region" aria-label="Chat with Daryl" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            style={{
              height: 'min(210px, calc(100vh - 320px))', minHeight: 110, overflowY: 'auto',
              padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            {messages.map(m => (
              <div
                key={m.id}
                style={{
                  maxWidth: '95%', padding: '6px 8px', fontSize: 11, lineHeight: 1.45, overflowWrap: 'anywhere',
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
                padding: '6px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase',
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
  );
}
