'use client';

/**
 * `useElapsed` — returns the live `Date.now() - startedAt` for the current
 * run, repainted on every animation frame.
 *
 * Design rationale (full write-up in `README.md` §5):
 *
 * - **rAF, not `setInterval`.** Per the PRD, no `setInterval` for animations.
 *   `requestAnimationFrame` also auto-throttles when the tab is backgrounded.
 * - **Backed by wall-clock arithmetic.** Each frame computes
 *   `Date.now() - startedAt`, so a long backgrounded tab catches up to the
 *   correct value on resume instead of accumulating frame-by-frame drift.
 * - **`visibilitychange` pause.** rAF already pauses in hidden tabs in every
 *   modern browser, but we still cancel explicitly on `document.hidden` and
 *   restart on visible — that makes the "no work when hidden" intent
 *   observable and shields us from browsers / devtools that keep rAF firing
 *   in the background.
 * - **Stall behaviour: freeze.** When the run goes `stalled` we keep the last
 *   reported value rather than continue counting. Surfacing "we've been
 *   waiting on the server for 7s" via the timer would mislead the user into
 *   thinking the *run* is taking that long. The stall badge (§6.5) surfaces
 *   the wait separately.
 * - **Terminal: snap to `endedAt - startedAt`.** Pinning to the reducer's
 *   recorded end timestamp means two viewers see the same final number, and
 *   `complete` reads as "00:30.00" rather than "00:30.07".
 * - **Monotonic.** A wall-clock regression (NTP correction, manual time
 *   change) can never make the timer go backward — the ref-backed
 *   `writeMonotonic` helper clamps every write to `>= current`.
 */

import { useEffect, useRef, useState } from 'react';

import type { RunStatus } from './state';

export interface UseElapsedOptions {
  /** First-event wall-clock time (ms). `null` while the run is `idle`. */
  startedAt: number | null;
  /** Terminal-event wall-clock time (ms). `null` until `complete` / `error`. */
  endedAt: number | null;
  /** Run-level status. Drives whether we tick, freeze, or snap. */
  status: RunStatus;
}

export function useElapsed({ startedAt, endedAt, status }: UseElapsedOptions): number {
  const [elapsed, setElapsed] = useState(0);
  // Mirrors `elapsed` so the effect can read the latest value without
  // re-subscribing on every state change — same pattern as `useSmoothProgress`.
  const elapsedRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const cancel = (): void => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const writeMonotonic = (value: number): void => {
      const next = Math.max(elapsedRef.current, value);
      if (next === elapsedRef.current) return;
      elapsedRef.current = next;
      setElapsed(next);
    };

    const writeHard = (value: number): void => {
      if (value === elapsedRef.current) return;
      elapsedRef.current = value;
      setElapsed(value);
    };

    // Pre-run: clear the high-water mark so a fresh `start()` after a
    // previously-completed run begins at 0 rather than the last final value.
    if (startedAt === null) {
      cancel();
      writeHard(0);
      return;
    }

    // Terminal: snap to the server-recorded end timestamp. `endedAt` is
    // guaranteed non-null on terminal status by the reducer; the
    // `?? Date.now()` is purely defensive against producer bugs.
    if (status === 'complete' || status === 'error') {
      cancel();
      const final = (endedAt ?? Date.now()) - startedAt;
      writeMonotonic(Math.max(0, final));
      return;
    }

    // Frozen: `stalled` keeps the last value (per design choice — README §5).
    // `idle`-with-startedAt is a shouldn't-happen branch handled defensively.
    if (status === 'stalled' || status === 'idle') {
      cancel();
      return;
    }

    // status === 'running'. Wall-clock-driven rAF loop, paused when hidden.
    const tick = (): void => {
      writeMonotonic(Date.now() - startedAt);
      rafRef.current = requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (rafRef.current !== null) return;
      // Paint once immediately so mount / resume don't wait a frame.
      writeMonotonic(Date.now() - startedAt);
      rafRef.current = requestAnimationFrame(tick);
    };

    const onVisibilityChange = (): void => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        cancel();
      } else {
        writeMonotonic(Date.now() - startedAt);
        start();
      }
    };

    const hasDocument = typeof document !== 'undefined';
    if (!hasDocument || !document.hidden) {
      start();
    }
    if (hasDocument) {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      cancel();
      if (hasDocument) {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [startedAt, endedAt, status]);

  return elapsed;
}
