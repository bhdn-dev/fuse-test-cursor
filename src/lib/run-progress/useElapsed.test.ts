import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { RunStatus } from './state';
import { useElapsed } from './useElapsed';

/**
 * Fake clock + rAF queue. Tests advance `now` (ms) and call `drainRaf` to
 * flush every queued frame, which is enough to exercise the hook's loop
 * deterministically without touching real timers.
 */
let now = 0;
let rafSeq = 0;
const rafQueue = new Map<number, FrameRequestCallback>();

function drainRaf(): void {
  const pending = Array.from(rafQueue.entries());
  rafQueue.clear();
  for (const [, cb] of pending) cb(now);
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  now = 0;
  rafSeq = 0;
  rafQueue.clear();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = ++rafSeq;
    rafQueue.set(id, cb);
    return id;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    rafQueue.delete(id);
  });
  setHidden(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useElapsed — lifecycle', () => {
  test('returns 0 while idle (no startedAt)', () => {
    const { result } = renderHook(() =>
      useElapsed({ startedAt: null, endedAt: null, status: 'idle' })
    );
    expect(result.current).toBe(0);
    // No scheduled work while idle.
    expect(rafQueue.size).toBe(0);
  });

  test('ticks forward on each animation frame while running', () => {
    now = 1_000;
    const { result } = renderHook(() =>
      useElapsed({ startedAt: 1_000, endedAt: null, status: 'running' })
    );

    // Immediate paint on mount: 0ms have passed.
    expect(result.current).toBe(0);
    expect(rafQueue.size).toBe(1);

    act(() => {
      now = 1_016;
      drainRaf();
    });
    expect(result.current).toBe(16);

    act(() => {
      now = 2_500;
      drainRaf();
    });
    expect(result.current).toBe(1_500);
  });

  test('snaps to `endedAt - startedAt` on complete', () => {
    now = 0;
    const { result, rerender } = renderHook(
      ({ status, endedAt }: { status: RunStatus; endedAt: number | null }) =>
        useElapsed({ startedAt: 0, endedAt, status }),
      { initialProps: { status: 'running' as RunStatus, endedAt: null as number | null } }
    );

    act(() => {
      now = 500;
      drainRaf();
    });
    expect(result.current).toBe(500);

    act(() => {
      now = 1_234;
      rerender({ status: 'complete', endedAt: 1_234 });
    });

    expect(result.current).toBe(1_234);
    // Loop is torn down on terminal status.
    expect(rafQueue.size).toBe(0);

    // Further "frames" must not move the value.
    act(() => {
      now = 99_999;
      drainRaf();
    });
    expect(result.current).toBe(1_234);
  });

  test('snaps to `endedAt - startedAt` on error', () => {
    const { result, rerender } = renderHook(
      ({ status, endedAt }: { status: RunStatus; endedAt: number | null }) =>
        useElapsed({ startedAt: 0, endedAt, status }),
      { initialProps: { status: 'running' as RunStatus, endedAt: null as number | null } }
    );

    act(() => {
      now = 800;
      drainRaf();
    });
    expect(result.current).toBe(800);

    act(() => {
      now = 950;
      rerender({ status: 'error', endedAt: 950 });
    });

    expect(result.current).toBe(950);
    expect(rafQueue.size).toBe(0);
  });

  test('freezes (keeps last value) on stalled, then resumes from wall clock on running', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: RunStatus }) => useElapsed({ startedAt: 0, endedAt: null, status }),
      { initialProps: { status: 'running' as RunStatus } }
    );

    act(() => {
      now = 2_000;
      drainRaf();
    });
    expect(result.current).toBe(2_000);

    act(() => {
      rerender({ status: 'stalled' });
    });

    expect(rafQueue.size).toBe(0);

    // Wall clock advances while stalled, but the displayed value is frozen.
    act(() => {
      now = 12_000;
      drainRaf();
    });
    expect(result.current).toBe(2_000);

    // On recovery to `running`, the next paint snaps to the *real* elapsed.
    act(() => {
      rerender({ status: 'running' });
    });
    expect(result.current).toBe(12_000);
    expect(rafQueue.size).toBe(1);
  });

  test('resets to 0 when startedAt returns to null (fresh run after a completed one)', () => {
    const { result, rerender } = renderHook(
      ({
        startedAt,
        status,
        endedAt,
      }: {
        startedAt: number | null;
        status: RunStatus;
        endedAt: number | null;
      }) => useElapsed({ startedAt, endedAt, status }),
      {
        initialProps: {
          startedAt: 0 as number | null,
          status: 'running' as RunStatus,
          endedAt: null as number | null,
        },
      }
    );

    act(() => {
      now = 5_000;
      rerender({ startedAt: 0, status: 'complete', endedAt: 5_000 });
    });
    expect(result.current).toBe(5_000);

    act(() => {
      rerender({ startedAt: null, status: 'idle', endedAt: null });
    });
    expect(result.current).toBe(0);
  });
});

describe('useElapsed — visibility', () => {
  test('cancels the rAF loop when the document becomes hidden, restarts on visible', () => {
    const { result } = renderHook(() =>
      useElapsed({ startedAt: 0, endedAt: null, status: 'running' })
    );

    expect(rafQueue.size).toBe(1);

    act(() => {
      now = 1_000;
      drainRaf();
    });
    expect(result.current).toBe(1_000);

    act(() => {
      setHidden(true);
    });
    expect(rafQueue.size).toBe(0);

    // Wall clock advances 30s in the background; no rAF, no updates.
    act(() => {
      now = 31_000;
    });
    expect(result.current).toBe(1_000);

    // Becoming visible snaps to wall-clock and schedules a new frame.
    act(() => {
      setHidden(false);
    });
    expect(result.current).toBe(31_000);
    expect(rafQueue.size).toBe(1);
  });

  test('does not start a loop if the document is already hidden when mounted', () => {
    setHidden(true);
    const { result } = renderHook(() =>
      useElapsed({ startedAt: 0, endedAt: null, status: 'running' })
    );
    expect(rafQueue.size).toBe(0);
    expect(result.current).toBe(0);

    act(() => {
      now = 4_000;
      setHidden(false);
    });
    expect(result.current).toBe(4_000);
    expect(rafQueue.size).toBe(1);
  });
});

describe('useElapsed — monotonicity', () => {
  test('never decreases even if wall clock regresses', () => {
    const { result } = renderHook(() =>
      useElapsed({ startedAt: 0, endedAt: null, status: 'running' })
    );

    act(() => {
      now = 1_500;
      drainRaf();
    });
    expect(result.current).toBe(1_500);

    // Clock jumps backward (NTP correction / manual time change).
    act(() => {
      now = 500;
      drainRaf();
    });
    expect(result.current).toBe(1_500);

    // And recovers once wall-clock moves past the old high-water mark.
    act(() => {
      now = 2_000;
      drainRaf();
    });
    expect(result.current).toBe(2_000);
  });
});
