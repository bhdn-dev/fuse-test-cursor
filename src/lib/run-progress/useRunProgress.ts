'use client';

/**
 * `useRunProgress` — opens an SSE stream against `GET /api/run`, parses
 * `RunEvent`s as they arrive, and reduces them into a stable {@link RunState}.
 *
 * Design notes:
 *
 * - Uses `fetch` + `ReadableStream` (not `EventSource`) so we can:
 *   - cancel cleanly via `AbortController` on unmount / re-run / `stop()`,
 *   - skip the auto-reconnect that `EventSource` performs (each reconnect would
 *     spawn a fresh server-side scenario with a new `runId`, which is wrong),
 *   - avoid the "no custom Accept header" limitation of `EventSource`.
 * - Stall detection runs on `requestAnimationFrame` (per PRD: no `setInterval`).
 *   The loop only spins while `status === 'running'` — once we trip into
 *   `stalled` the effect tears the loop down, and the next inbound event
 *   recovers status to `running` via the reducer, which restarts the loop.
 * - `startedAt` lives inside the reducer's state and is lazily set from
 *   `Date.now()` on the *first* event (client-only, never during SSR), so
 *   the initial render is deterministic and no hydration warning fires.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { STALL_TIMEOUT_MS } from './constants';
import { type RunEvent, isRunEvent } from './events';
import {
  initialRunState,
  markStalled,
  reduce,
  type RunError,
  type RunState,
  type RunStatus,
  type StepState,
} from './state';

/** Mirrors the server-side `RunMode` union from `src/app/api/run/scenarios.ts`. */
export type RunMode = 'happy' | 'error' | 'stall';

export interface UseRunProgressResult {
  status: RunStatus;
  steps: readonly StepState[];
  currentStepIndex: number;
  error: RunError | null;
  startedAt: number | null;
  endedAt: number | null;
  lastEventAt: number | null;
  /** Raw event log — handy for debugging and for the Storybook "Live" story. */
  events: readonly RunEvent[];
  /** Begin a new run; cancels any in-flight stream first. */
  start: (mode: RunMode) => void;
  /** Abort the in-flight stream and stop the stall loop. State is preserved. */
  stop: () => void;
  /** Abort any in-flight stream and clear all derived state back to `idle`. */
  reset: () => void;
}

type Action =
  | { type: 'reset' }
  | { type: 'event'; event: RunEvent; now: number }
  | { type: 'tickStall'; now: number };

function hookReducer(state: RunState, action: Action): RunState {
  switch (action.type) {
    case 'reset':
      return initialRunState;
    case 'event':
      return reduce(state, action.event, action.now);
    case 'tickStall':
      return markStalled(state, action.now, STALL_TIMEOUT_MS);
  }
}

export function useRunProgress(): UseRunProgressResult {
  const [state, dispatch] = useReducer(hookReducer, initialRunState);
  const [events, setEvents] = useState<RunEvent[]>([]);

  // Refs hold imperative resources whose identity must survive re-renders but
  // shouldn't trigger them when they change.
  const abortRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);

  const cancelStallLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    cancelStallLoop();
  }, [cancelStallLoop]);

  const reset = useCallback(() => {
    stop();
    dispatch({ type: 'reset' });
    setEvents([]);
  }, [stop]);

  // rAF stall loop. `markStalled` is idempotent, and `useReducer` bails out
  // on referential equality, so once we're already `stalled` (or no longer
  // running) the dispatch is essentially free.
  useEffect(() => {
    if (state.status !== 'running') {
      cancelStallLoop();
      return;
    }
    const tick = (): void => {
      dispatch({ type: 'tickStall', now: Date.now() });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return cancelStallLoop;
  }, [state.status, cancelStallLoop]);

  // Tear everything down on unmount. `stop` has a stable identity (its only
  // dep `cancelStallLoop` is memoised with no deps), so React strict-mode's
  // double-mount only causes one extra no-op abort.
  useEffect(() => {
    return stop;
  }, [stop]);

  const start = useCallback(
    (mode: RunMode) => {
      stop();
      dispatch({ type: 'reset' });
      setEvents([]);

      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const response = await fetch(`/api/run?mode=${encodeURIComponent(mode)}`, {
            signal: controller.signal,
            headers: { Accept: 'text/event-stream' },
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new Error(`Run request failed with status ${response.status}`);
          }
          await readEventStream(response, controller.signal, (event) => {
            // Guard against stale-run leakage: a re-entrant `start()` swaps
            // `abortRef.current` before the previous fetch finishes draining.
            // The reducer also drops mismatched `runId`s, but this check
            // avoids the wasted dispatch + setState entirely.
            if (abortRef.current !== controller) return;
            dispatch({ type: 'event', event, now: Date.now() });
            setEvents((prev) => [...prev, event]);
          });
        } catch (err) {
          if (controller.signal.aborted) return;
          // Network-level failures (DNS, 5xx without a body, dropped socket).
          // The route-handler-side error path uses `step_error` events, so
          // anything reaching here is genuinely unexpected for the demo.
          console.error('[useRunProgress] stream failed', err);
        }
      })();
    },
    [stop]
  );

  return {
    status: state.status,
    steps: state.steps,
    currentStepIndex: state.currentStepIndex,
    error: state.error,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    lastEventAt: state.lastEventAt,
    events,
    start,
    stop,
    reset,
  };
}

/**
 * Minimal SSE reader: pulls bytes off the response body, splits on the
 * `\n\n` frame delimiter (normalising CRLF first), and forwards JSON `data:`
 * payloads as validated {@link RunEvent}s. Frames that fail validation or
 * aren't valid JSON are silently dropped — the route handler is the only
 * producer, so unknown shapes would be a bug rather than a runtime
 * recoverable condition.
 */
async function readEventStream(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: RunEvent) => void
): Promise<void> {
  if (!response.body) {
    throw new Error('Response has no body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSseFrame(frame);
        if (event) onEvent(event);
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader was already released (e.g. on abort) — fine.
    }
  }
}

function parseSseFrame(frame: string): RunEvent | null {
  let payload = '';
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue;
    // Per the SSE spec, a single leading SP after the colon is stripped.
    const chunk = line.slice(5).replace(/^ /, '');
    payload = payload === '' ? chunk : `${payload}\n${chunk}`;
  }
  if (payload === '') return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRunEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
