/* Multi-site comparison. Kinukuwenta ang parehong sukat para sa N na site, sa iisang window,
para pwedeng ilagay sa table o chart. Walang language model dito: puro kalkulasyon lang. */
import { makeContext, SITES } from "./planner.js";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 8;

const round = (x, d = 0) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};
const toC = k => round(k - 273.15);

/* Category ng site galing sa description, hal. "Surveyor Landing Sites". Walang description = null. */
export function categoryOf(s) {
  const cat = String(s[3] || "").split(". LROC views")[0].trim();
  return cat || null;
}

function typeOf(s) {
  const cat = String(s[3] || "").split(". LROC views")[0];
  if (/Impact/i.test(cat)) return "Impact site";
  if (/Lunokhod/i.test(cat)) return "Rover site";
  if (/Landing/i.test(cat)) return "Landing site";
  return null;
}

/* Metrics na mas mataas = mas maganda ("high"), o mas mababa = mas maganda ("low"). */
export const METRICS = [
  { key: "enzyScore", label: "ENZYLA score", unit: "/100", better: "high" },
  { key: "score", label: "Planner score", unit: "", better: "high" },
  { key: "sunPct", label: "Sunlit (power)", unit: "%", better: "high" },
  { key: "earthPct", label: "Earth visible (comms)", unit: "%", better: "high" },
  { key: "bothPct", label: "Sun and Earth together", unit: "%", better: "high" },
  { key: "longestDarkH", label: "Longest darkness", unit: "h", better: "low" },
  { key: "longestOutageH", label: "Longest comm outage", unit: "h", better: "low" },
  { key: "meanSunElev", label: "Mean Sun elevation when lit", unit: "°", better: "high" },
  { key: "maxC", label: "Hottest surface", unit: "°C", better: null },
  { key: "minC", label: "Coldest surface", unit: "°C", better: null }
];

/* ENZYLA score: ang simpleng average ng limang sukat, bawat isa 0-100, sa iskala na 1-100.
   Sun, Earth at both ay porsyento na. Ang dilim at comm outage ay baliktad: 100 kapag wala,
   1 kapag ang buong window ay madilim o walang link. Ito ang ginagamit sa ranking. */
export function enzyScore({ sun, earth, both, maxD, maxO }, windowH) {
  const clamp = x => Math.max(1, Math.min(100, x));
  const dark = 100 * (1 - Math.min(1, maxD / windowH));
  const outage = 100 * (1 - Math.min(1, maxO / windowH));
  return Math.round(clamp((sun + earth + both + dark + outage) / 5));
}

const fmt = (m, v) => {
  if (v == null) return "n/a";
  if (m.key === "longestDarkH" || m.key === "longestOutageH") return v >= 48 ? `${round(v / 24, 1)} days` : `${v} h`;
  return `${v}${m.unit}`;
};

/* indices: listahan ng site index (hindi pwedeng may doble). Ibinabalik ang { window, sites, best, summary }. */
export function compareSites(indices, settings = {}) {
  const list = [...new Set(indices)];
  if (list.length < MIN_COMPARE || list.length > MAX_COMPARE) {
    throw new RangeError(`Pick from ${MIN_COMPARE} to ${MAX_COMPARE} different sites.`);
  }
  for (const i of list) {
    if (!Number.isInteger(i) || i < 0 || i >= SITES.length) {
      throw new RangeError(`Site numbers must be between 0 and ${SITES.length - 1}.`);
    }
  }

  const ctx = makeContext(settings);
  const hours = ctx.N;

  const rows = list.map(i => {
    const s = SITES[i];
    const arr = ctx.series(s, ctx.d, hours);
    const st = ctx.stats(arr, ctx.mask, hours);
    const th = ctx.thermal(s);
    const sunPct = round(st.sun * 100);
    const earthPct = round(st.earth * 100);
    const bothPct = round(st.both * 100);
    return {
      index: i,
      name: s[0],
      latitude: s[1],
      longitude: s[2],
      type: typeOf(s),
      enzyScore: enzyScore({ sun: sunPct, earth: earthPct, both: bothPct, maxD: st.maxD, maxO: st.maxO }, hours),
      score: round(st.score * 100),
      sunPct,
      earthPct,
      bothPct,
      longestDarkH: st.maxD,
      longestOutageH: st.maxO,
      meanSunElev: round(st.avg, 1),
      maxC: th ? toC(th.maxK) : null,
      minC: th ? toC(th.minK) : null
    };
  });

  // Sino ang nangunguna sa bawat sukat. Kapag tabla, lahat ng tabla ay nakalista.
  const best = {};
  for (const m of METRICS) {
    if (!m.better) continue;
    const vals = rows.map(r => r[m.key]);
    const target = m.better === "high" ? Math.max(...vals) : Math.min(...vals);
    const winners = rows.filter(r => r[m.key] === target).map(r => r.name);
    best[m.key] = { value: target, sites: winners, allTied: winners.length === rows.length };
  }

  // Ranking ayon sa ENZYLA score (average ng limang sukat); tabla kung pareho
  const ranked = [...rows].sort((a, b) => b.enzyScore - a.enzyScore || b.score - a.score || a.index - b.index);
  let rank = 0, prev = null;
  ranked.forEach((r, k) => {
    if (r.enzyScore !== prev) { rank = k + 1; prev = r.enzyScore; }
    r.rank = rank;
  });

  const top = ranked.filter(r => r.rank === 1);
  const impacts = rows.filter(r => r.type === "Impact site").map(r => r.name);
  const lines = [];
  if (top.length === rows.length) {
    lines.push(`All ${rows.length} sites tie on the ENZYLA score (${top[0].enzyScore}/100) for this window.`);
  } else if (top.length > 1) {
    lines.push(`${top.map(r => r.name).join(" and ")} tie for the highest ENZYLA score (${top[0].enzyScore}/100).`);
  } else {
    const [a, b] = ranked;
    lines.push(`${a.name} has the highest ENZYLA score (${a.enzyScore}/100), ${a.enzyScore - b.enzyScore} ahead of ${b.name}.`);
  }
  for (const key of ["sunPct", "earthPct", "longestDarkH"]) {
    const m = METRICS.find(x => x.key === key);
    const b = best[key];
    if (!b.allTied) lines.push(`${m.label}: best at ${b.sites.join(" and ")} (${fmt(m, b.value)}).`);
  }
  if (impacts.length) {
    lines.push(`${impacts.join(", ")} ${impacts.length === 1 ? "is an impact site" : "are impact sites"}: the figures describe the location, not a place where a mission operated.`);
  }

  return {
    window: {
      start: new Date(ctx.d).toISOString().slice(0, 10),
      days: hours / 24,
      mask: ctx.mask
    },
    metrics: METRICS,
    sites: rows,
    ranking: ranked.map(r => ({ index: r.index, name: r.name, enzyScore: r.enzyScore, score: r.score, rank: r.rank })),
    best,
    summary: lines.join(" ")
  };
}
