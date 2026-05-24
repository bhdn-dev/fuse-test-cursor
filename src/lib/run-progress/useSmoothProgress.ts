'use client';

/**
 * `useSmoothProgress` — eases a displayed progress value toward an externally
 * computed `target` on every animation frame.
 *
 * Design rationale (full write-up in `README.md` §4.1):
 *
 * - Exponential decay: `next = current + (target - current) * (1 - exp(-k * dt))`.
 *   Naturally accelerates when the gap is large (so the bar catches up when a
 *   `step_complete` arrives early) and asymptotes without overshoot.
 * - **Monotonic**: enforced via `Math.max(current, next)` so the bar never
 *   slides backward, regardless of what the producer does with `target`.
 * - **Frame-rate independent**: `dt` comes from the rAF timestamp; capped at
 *   100 ms so a backgrounded tab waking up doesn't trigger a giant jump.
 * - **Terminal**: snap to `target` on `complete`; freeze in place on
 *   `error` / `stalled` / `idle`.
 * - **`prefers-reduced-motion`**: snaps to `target` on every render, never
 *   starts an rAF loop. Reacts to the OS toggle without a remount.
 */

import { useEffect, useRef, useState } from 'react';

import type { RunStatus } from './state';

/** Per-second exponential decay rate (≈115 ms half-life). */
const DEFAULT_DECAY_RATE_PER_SEC = 6;

/** Treat the gap as closed once it's within this fraction of the bar. */
const EPSILON = 0.0005;

/** Cap the per-frame `dt` so a backgrounded tab doesn't snap on resume. */
const MAX_DT_SECONDS = 0.1;

/** Inputs for the rAF exponential easing loop. */
export interface UseSmoothProgressOptions {
  /** Desired progress in `[0, 1]`. Clamped if out of range. */
  target: number;
  /** Controls animate / snap / freeze behaviour. */
  status: RunStatus;
  /** Per-second decay rate; defaults to `6`. Override in tests. */
  decayRate?: number;
}

/**
 * Eases `progress` toward `target` on each animation frame while `status` is
 * `running`. Monotonic, frame-rate independent, honours `prefers-reduced-motion`.
 */
export function useSmoothProgress({
  target,
  status,
  decayRate = DEFAULT_DECAY_RATE_PER_SEC,
}: UseSmoothProgressOptions): number {
  const clampedTarget = clamp01(target);

  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const targetRef = useRef(clampedTarget);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  // Mirror the latest target into a ref so the rAF loop can read it without
  // being torn down and rebuilt on every parent re-render. Synced in a
  // commit-phase effect (the rAF callback only fires post-commit, so the
  // first frame after a target change always observes the new value).
  useEffect(() => {
    targetRef.current = clampedTarget;
  });

  // Observe `prefers-reduced-motion` reactively so OS toggles take effect
  // without a remount. Kept as state so the loop-driving effect re-runs.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const cancel = (): void => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameRef.current = null;
    };

    const writeMonotonic = (value: number): void => {
      const next = Math.max(progressRef.current, clamp01(value));
      if (next === progressRef.current) return;
      progressRef.current = next;
      setProgress(next);
    };

    // Terminal: snap so the bar visibly reaches 100% on success.
    if (status === 'complete') {
      cancel();
      writeMonotonic(targetRef.current);
      return;
    }

    // Frozen states: stop animating, leave displayed progress where it is.
    if (status === 'error' || status === 'stalled' || status === 'idle') {
      cancel();
      return;
    }

    // A user who's asked for reduced motion gets the target instantly and
    // every subsequent re-render keeps it in lockstep — no animation frames.
    if (reducedMotion) {
      cancel();
      writeMonotonic(targetRef.current);
      return;
    }

    // status === 'running': drive the easing loop.
    const tick = (now: number): void => {
      const last = lastFrameRef.current ?? now;
      const dt = Math.max(0, Math.min(MAX_DT_SECONDS, (now - last) / 1000));
      lastFrameRef.current = now;

      const t = targetRef.current;
      const cur = progressRef.current;
      const gap = t - cur;

      if (gap <= EPSILON) {
        writeMonotonic(t);
      } else {
        const eased = cur + gap * (1 - Math.exp(-decayRate * dt));
        // `Math.exp` is well-behaved, but clamping keeps us defensive against
        // any future change to the easing function and makes the invariant
        // explicit: progress never crosses `target` from below.
        writeMonotonic(Math.min(t, eased));
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return cancel;
  }, [status, decayRate, reducedMotion]);

  return progress;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
