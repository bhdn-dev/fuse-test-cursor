import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { RunStatus } from './state';
import { useSmoothProgress } from './useSmoothProgress';

/**
 * Manually-driven `requestAnimationFrame` queue. Tests advance the fake clock
 * (`now`, in ms) and then call {@link drainRaf} to flush all pending frames,
 * which is enough to reproduce the rAF easing loop deterministically without
 * touching real timers.
 *
 * `cancelAnimationFrame` is honoured by clearing the slot, so cleanup paths
 * in the hook are tested as they'd behave in a real browser.
 */
let now = 0;
let rafSeq = 0;
const rafQueue = new Map<number, FrameRequestCallback>();

function drainRaf(): void {
  const pending = Array.from(rafQueue.entries());
  rafQueue.clear();
  for (const [, cb] of pending) cb(now);
}

/** Run N frames at a fixed interval, returning each frame's reported progress. */
function runFrames(
  result: { current: number },
  frames: number,
  msPerFrame = 16
): readonly number[] {
  const samples: number[] = [];
  for (let i = 0; i < frames; i++) {
    act(() => {
      now += msPerFrame;
      drainRaf();
    });
    samples.push(result.current);
  }
  return samples;
}

beforeEach(() => {
  now = 0;
  rafSeq = 0;
  rafQueue.clear();
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = ++rafSeq;
    rafQueue.set(id, cb);
    return id;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    rafQueue.delete(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSmoothProgress — easing math', () => {
  test('starts at 0 and eases toward target while running', () => {
    const { result } = renderHook(() =>
      useSmoothProgress({ target: 0.5, status: 'running', decayRate: 6 })
    );

    expect(result.current).toBe(0);

    const samples = runFrames(result, 30);

    // Each sample must be ≥ the previous one and never exceed the target.
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1]!;
      const cur = samples[i]!;
      expect(cur).toBeGreaterThanOrEqual(prev);
      expect(cur).toBeLessThanOrEqual(0.5 + 1e-9);
    }

    // After ~0.5s with k=6 we should be very close to the target
    // (1 - exp(-3) ≈ 0.95), so > 0.45 is a safe lower bound.
    expect(result.current).toBeGreaterThan(0.45);
    expect(result.current).toBeLessThanOrEqual(0.5);
  });

  test('catches up faster when the gap to target widens mid-run', () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number }) =>
        useSmoothProgress({ target, status: 'running', decayRate: 6 }),
      { initialProps: { target: 0.2 } }
    );

    runFrames(result, 30);
    const settledLow = result.current;
    expect(settledLow).toBeGreaterThan(0.18);

    act(() => {
      rerender({ target: 0.9 });
    });

    // A single frame after the big jump should move noticeably toward 0.9 —
    // the "natural catch-up" property of exponential easing.
    act(() => {
      now += 16;
      drainRaf();
    });
    const oneFrameAfterJump = result.current;
    expect(oneFrameAfterJump).toBeGreaterThan(settledLow);
    expect(oneFrameAfterJump - settledLow).toBeGreaterThan(0.05);

    runFrames(result, 60);
    expect(result.current).toBeGreaterThan(0.85);
    expect(result.current).toBeLessThanOrEqual(0.9);
  });

  test('is monotonic: progress never decreases even if target regresses', () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number }) =>
        useSmoothProgress({ target, status: 'running', decayRate: 6 }),
      { initialProps: { target: 0.8 } }
    );

    runFrames(result, 60);
    const high = result.current;
    expect(high).toBeGreaterThan(0.7);

    act(() => {
      rerender({ target: 0.1 });
    });

    runFrames(result, 60);

    expect(result.current).toBeGreaterThanOrEqual(high);
  });

  test('stays within [0, target + epsilon] over many frames', () => {
    const target = 0.42;
    const { result } = renderHook(() =>
      useSmoothProgress({ target, status: 'running', decayRate: 12 })
    );

    const samples = runFrames(result, 200);
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(target + 1e-9);
    }
    expect(samples.at(-1)).toBeCloseTo(target, 4);
  });

  test('clamps out-of-range targets to [0, 1]', () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number }) =>
        useSmoothProgress({ target, status: 'running', decayRate: 50 }),
      { initialProps: { target: 5 } }
    );

    runFrames(result, 30);
    expect(result.current).toBeGreaterThan(0.99);
    expect(result.current).toBeLessThanOrEqual(1);

    act(() => {
      rerender({ target: -3 });
    });
    runFrames(result, 30);
    // Monotonic: even a negative target can't drag us back down.
    expect(result.current).toBeGreaterThan(0.99);
  });
});

describe('useSmoothProgress — lifecycle', () => {
  test('snaps to target on `complete`', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: RunStatus }) => useSmoothProgress({ target: 1, status, decayRate: 6 }),
      { initialProps: { status: 'running' as RunStatus } }
    );

    runFrames(result, 5);
    expect(result.current).toBeLessThan(1);

    act(() => {
      rerender({ status: 'complete' });
    });

    expect(result.current).toBe(1);
  });

  test('freezes in place on `error`', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: RunStatus }) =>
        useSmoothProgress({ target: 0.8, status, decayRate: 6 }),
      { initialProps: { status: 'running' as RunStatus } }
    );

    runFrames(result, 30);
    const frozen = result.current;
    expect(frozen).toBeGreaterThan(0.3);

    act(() => {
      rerender({ status: 'error' });
    });

    // No more scheduled frames once we've moved into a terminal state.
    expect(rafQueue.size).toBe(0);

    // Defensive: even a manual drain attempt must not advance the value.
    act(() => {
      now += 1000;
      drainRaf();
    });
    expect(result.current).toBe(frozen);
  });

  test('freezes on `stalled` and resumes on `running`', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: RunStatus }) =>
        useSmoothProgress({ target: 0.9, status, decayRate: 6 }),
      { initialProps: { status: 'running' as RunStatus } }
    );

    runFrames(result, 10);
    const beforeStall = result.current;
    expect(beforeStall).toBeGreaterThan(0);
    expect(beforeStall).toBeLessThan(0.9);

    act(() => {
      rerender({ status: 'stalled' });
    });

    act(() => {
      now += 5000;
      drainRaf();
    });
    expect(result.current).toBe(beforeStall);

    act(() => {
      rerender({ status: 'running' });
    });

    runFrames(result, 60);
    expect(result.current).toBeGreaterThan(beforeStall);
    expect(result.current).toBeLessThanOrEqual(0.9);
  });

  test('does not animate while `idle`', () => {
    const { result } = renderHook(() => useSmoothProgress({ target: 0.5, status: 'idle' }));
    expect(result.current).toBe(0);
    expect(rafQueue.size).toBe(0);
  });

  test('resets to 0 on `idle` after a run', () => {
    const { result, rerender } = renderHook(
      ({ status, target }: { status: RunStatus; target: number }) =>
        useSmoothProgress({ target, status, decayRate: 6 }),
      { initialProps: { status: 'running' as RunStatus, target: 0.8 } }
    );

    runFrames(result, 30);
    expect(result.current).toBeGreaterThan(0);

    act(() => {
      rerender({ status: 'idle', target: 0 });
    });

    expect(result.current).toBe(0);
    expect(rafQueue.size).toBe(0);
  });

  test('caps dt to avoid jumps when a tab resumes from background', () => {
    const { result } = renderHook(() =>
      useSmoothProgress({ target: 1, status: 'running', decayRate: 6 })
    );

    // One frame at t=16ms to seed `lastFrameRef`.
    act(() => {
      now += 16;
      drainRaf();
    });
    const afterSeed = result.current;

    // Simulate a 60s tab freeze: a single frame with a giant dt.
    act(() => {
      now += 60_000;
      drainRaf();
    });

    // The dt cap means the bar advances at most as much as a 100ms frame —
    // ~45% of the remaining gap with k=6 — not the full ~99.99%.
    const delta = result.current - afterSeed;
    expect(delta).toBeLessThan(0.5);
  });
});
