import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { STALL_TIMEOUT_MS } from './constants';
import type { RunEvent } from './events';
import { useRunProgress } from './useRunProgress';

/**
 * A `Response` whose body is a manually-driven `ReadableStream`. Lets the
 * test push individual SSE frames into the hook's reader on demand.
 */
function controllableSseResponse(): {
  response: Response;
  push: (event: RunEvent) => void;
  close: () => void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
    push: (event) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    close: () => controller.close(),
  };
}

/** Drain pending microtasks (fetch.then, reader.read.then, dispatch, setState). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('useRunProgress — stall detection', () => {
  let now = 0;
  const rafQueue: FrameRequestCallback[] = [];

  beforeEach(() => {
    now = 0;
    rafQueue.length = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Fire every currently-queued rAF callback once. */
  const drainRaf = (): void => {
    const pending = rafQueue.splice(0);
    for (const cb of pending) cb(now);
  };

  test('flips to `stalled` after STALL_TIMEOUT_MS of silence and recovers on the next event', async () => {
    const stream = controllableSseResponse();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(stream.response);

    const { result } = renderHook(() => useRunProgress());

    expect(result.current.status).toBe('idle');

    await act(async () => {
      result.current.start('happy');
      await flushMicrotasks();
    });

    await act(async () => {
      stream.push({
        type: 'step_start',
        runId: 'run-1',
        ts: now,
        stepIndex: 0,
        stepCount: 3,
        label: 'Analyzing…',
      });
      await flushMicrotasks();
    });

    expect(result.current.status).toBe('running');
    expect(result.current.lastEventAt).toBe(0);
    expect(result.current.startedAt).toBe(0);

    // Pre-stall: a tick well before the threshold must NOT flip status.
    await act(async () => {
      now = STALL_TIMEOUT_MS - 1;
      drainRaf();
      await flushMicrotasks();
    });
    expect(result.current.status).toBe('running');

    // Crossing the threshold flips us to `stalled`.
    await act(async () => {
      now = STALL_TIMEOUT_MS + 250;
      drainRaf();
      await flushMicrotasks();
    });
    expect(result.current.status).toBe('stalled');

    // Any subsequent event recovers status back to `running` (reducer drops
    // `stalled` automatically on the next inbound event).
    await act(async () => {
      stream.push({
        type: 'step_progress',
        runId: 'run-1',
        ts: now,
        stepIndex: 0,
        stepCount: 3,
        label: 'Analyzing…',
        progress: 0.5,
      });
      await flushMicrotasks();
    });
    expect(result.current.status).toBe('running');
    expect(result.current.lastEventAt).toBe(STALL_TIMEOUT_MS + 250);

    stream.close();
  });
});
