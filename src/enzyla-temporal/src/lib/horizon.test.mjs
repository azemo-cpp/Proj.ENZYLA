import test from 'node:test';
import assert from 'node:assert/strict';
import { crossings, splitAzTrack, niceScale } from './horizon.ts';
import { series, skyAt, nextChange, HOUR, DAY } from './ephemeris.ts';

test('crossings agree with nextChange (bisection) to within a sample', () => {
  const site = { lat: 0.6741, lon: 23.4723 }, t0 = Date.UTC(2026, 10, 10), step = 2 * HOUR;
  const data = series(site, t0, 13 * 24, 2);
  const c = crossings(data, t0, step, p => p.sunEl, 0);
  assert.ok(c.length >= 1);
  for (const x of c) {
    const ev = nextChange(site, x.t - 3 * HOUR, 'sun', 0);
    assert.ok(Math.abs(ev.atMs - x.t) < 20 * 6e4, 'interpolated crossing within 20 min of exact');
    assert.equal(ev.up, !x.rising); // state before the event is the opposite of the direction of travel
  }
});

test('crossings respect the terrain mask', () => {
  const site = { lat: -89.9, lon: 0 }, t0 = Date.UTC(2026, 10, 10);
  const data = series(site, t0, 13 * 24, 2);
  assert.ok(crossings(data, t0, 2 * HOUR, p => p.sunEl, 0).length >= crossings(data, t0, 2 * HOUR, p => p.sunEl, 1.2).length);
});

test('splitAzTrack breaks on wrap only', () => {
  const s = splitAzTrack([{ az: 350 }, { az: 355 }, { az: 2 }, { az: 8 }, { az: 12 }]);
  assert.deepEqual(s.map(x => x.length), [2, 3]);
  assert.equal(splitAzTrack([{ az: 10 }, { az: 20 }]).length, 1);
});

test('niceScale picks the smallest scale that fits', () => {
  assert.deepEqual([0, 4.9, 6.8, 14, 15.1, 70, 120].map(niceScale), [5, 5, 10, 15, 30, 90, 90]);
});
