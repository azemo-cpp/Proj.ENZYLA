import test from 'node:test';
import assert from 'node:assert/strict';
import { skyAt, nextChange, windowStats, series, subSolarPoint, HOUR, DAY } from './ephemeris.ts';
import { makeContext, SITES } from '../../daryl/providers/lunar/planner.js';

const A11 = { lat: 0.6741, lon: 23.4723 };

test('matches the Daryl planner (same model) hour by hour', () => {
  const ctx = makeContext({});
  const s = SITES.find(x => x[0] === 'Apollo 17');
  const t0 = Date.UTC(2026, 10, 15);
  const ref = ctx.series(s, t0, 48);
  const mine = series({ lat: s[1], lon: s[2] }, t0, 47, 1);
  ref.forEach((r, i) => { assert.ok(Math.abs(r.sE - mine[i].sunEl) < 1e-9); assert.ok(Math.abs(r.eE - mine[i].earthEl) < 1e-9); });
});

test('nextChange lands on the horizon and flips state', () => {
  const t0 = Date.UTC(2026, 10, 15);
  for (const body of ['sun', 'earth']) {
    for (const mask of [0, 2]) {
      const ev = nextChange(A11, t0, body, mask);
      if (ev.atMs === null) continue;
      const el = (t) => { const p = skyAt(A11, t); return (body === 'sun' ? p.sunEl : p.earthEl) - mask; };
      assert.ok(Math.abs(el(ev.atMs)) < 0.01, `${body} el at event ~ mask`);
      assert.equal(el(ev.atMs + 10 * 6e4) > 0, !ev.up);
    }
  }
});

test('equatorial near-side site: ~half of a lunar day lit, Earth always up, day ~ 29.5 d', () => {
  const st = windowStats(A11, Date.UTC(2026, 10, 15));
  assert.ok(st.sunFrac > 0.45 && st.sunFrac < 0.55, String(st.sunFrac));
  assert.ok(st.earthFrac > 0.99);
  assert.ok(st.maxDarkH > 330 && st.maxDarkH < 370, String(st.maxDarkH));
});

test('polar site: Sun stays within ~1.6 deg, Earth within ~7 deg', () => {
  const s = series({ lat: -89.9, lon: 0 }, Date.UTC(2026, 10, 15), 24 * 365, 3);
  assert.ok(Math.max(...s.map(p => Math.abs(p.sunEl))) < 1.8);
  assert.ok(Math.max(...s.map(p => Math.abs(p.earthEl))) < 7.2);
});

test('sub-solar longitude sweeps ~ -12.2 deg/day westward', () => {
  const a = subSolarPoint(Date.UTC(2026, 10, 15)).lon, b = subSolarPoint(Date.UTC(2026, 10, 16)).lon;
  assert.ok(Math.abs(((b - a + 540) % 360) - 180 - (-12.19)) < 0.1);
});
