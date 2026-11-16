import type { CSSProperties } from 'react';

type Block = { kind: 'text'; text: string } | { kind: 'table'; rows: string[][] } | { kind: 'chart'; text: string };

// "| a | b |" lines become a table, the rest stays plain text.
// Everything is rendered as text by React, so nothing in an answer can inject HTML.
function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  let textLines: string[] = [];
  let tableLines: string[] = [];
  let chartLines: string[] = [];

  const flushChart = () => {
    if (!chartLines.length) return;
    blocks.push({ kind: 'chart', text: chartLines.join('\n') });
    chartLines = [];
  };
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
    if (/^\s*\|.*\|\s*$/.test(line)) { flushText(); flushChart(); tableLines.push(line); }
    else if (/[█░]/.test(line)) { flushText(); flushTable(); chartLines.push(line); } // bar-chart line
    else { flushTable(); flushChart(); textLines.push(line); }
  }
  flushText();
  flushTable();
  flushChart();
  return blocks;
}

/** nowrap: keep table cells on one line and scroll sideways, for wide tables in a narrow sidebar. */
export function Answer({ text, nowrap = false }: { text: string; nowrap?: boolean }) {
  return (
    <>
      {parseAnswer(text).map((block, i) =>
        block.kind === 'text' ? (
          <p key={i} style={{ whiteSpace: 'pre-wrap', margin: '0 0 6px' }}>{block.text}</p>
        ) : block.kind === 'chart' ? (
          // Monospace so the bars line up. Rendered as text, so nothing can inject HTML.
          <pre key={i} style={{ fontFamily: "'Courier New', monospace", fontSize: 10, lineHeight: 1.35, whiteSpace: 'pre', overflowX: 'auto', margin: '6px 0', padding: '4px 6px', background: 'rgba(255,255,255,0.04)' }}>{block.text}</pre>
        ) : (
          <div key={i} style={{ overflowX: 'auto', margin: '6px 0' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
              <thead>
                <tr>
                  {block.rows[0]?.map((cell, c) => (
                    <th key={c} style={cellStyle(true, nowrap)}>{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.slice(1).map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => <td key={c} style={cellStyle(false, nowrap)}>{cell}</td>)}
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

function cellStyle(head: boolean, nowrap = false): CSSProperties {
  return {
    border: '1px solid rgba(255,255,255,0.12)',
    padding: '4px 8px',
    textAlign: 'left' as const,
    verticalAlign: 'top' as const,
    ...(nowrap ? { whiteSpace: 'nowrap' as const } : {}),
    ...(head ? { fontWeight: 700, color: 'rgba(255,255,255,0.7)' } : {}),
  };
}

