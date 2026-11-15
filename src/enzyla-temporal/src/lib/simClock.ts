import { useSyncExternalStore } from 'react';

// One shared simulation clock for the globe lighting and every time-aware panel.
export interface ClockState { ms: number; playing: boolean; speed: number; mask: number }

let state: ClockState = { ms: Date.now(), playing: false, speed: 3600, mask: 0 }; // speed = sim seconds per real second (default 1 h/s: the terminator drifts ~0.5 deg/s)
const subs = new Set<() => void>();
let raf: number | null = null;
let last = 0;

function emit(next: Partial<ClockState>) {
  state = { ...state, ...next };
  subs.forEach(fn => fn());
}

function tick(now: number) {
  if (!state.playing) { raf = null; return; } // a frame queued before Pause must not advance time
  const dt = Math.min(0.1, (now - last) / 1000); // clamp so a background tab doesn't jump
  last = now;
  emit({ ms: state.ms + dt * state.speed * 1000 });
  raf = state.playing ? requestAnimationFrame(tick) : null;
}

export const simClock = {
  get: () => state,
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
  set(ms: number) { if (Number.isFinite(ms)) emit({ ms }); },
  shift(deltaMs: number) { emit({ ms: state.ms + deltaMs }); },
  setSpeed(speed: number) { emit({ speed }); },
  setMask(mask: number) { emit({ mask }); },
  setPlaying(playing: boolean) {
    if (playing === state.playing) return;
    emit({ playing });
    if (playing && raf === null) { last = performance.now(); raf = requestAnimationFrame(tick); }
  },
  now() { emit({ ms: Date.now() }); },
};

export function useSimClock(): ClockState {
  return useSyncExternalStore(simClock.subscribe, simClock.get);
}
