/**
 * `GET /api/run` — mock Server-Sent Events endpoint.
 *
 * Streams a sequence of {@link RunEvent}s (one JSON object per `data:` frame)
 * for the requested scenario. Used by the demo page to drive the
 * `RunProgress` component without requiring a real backend.
 *
 * Query params:
 * - `mode` — `'happy' | 'error' | 'stall'`. Defaults to `'happy'`.
 *
 * Responses:
 * - `200 text/event-stream` on success.
 * - `400 text/plain` if `mode` is present but not one of the known values.
 *
 * Lifecycle: each request gets a fresh `runId` (so clients can detect re-runs
 * and drop stale frames). The scenario respects `request.signal`, so a client
 * disconnect (or `EventSource.close()`) tears the stream down promptly.
 */

import type { NextRequest } from 'next/server';

import type { RunEvent } from '@/lib/run-progress/events';

import { RUN_MODES, isRunMode, runScenario } from './scenarios';

// SSE is inherently dynamic: the response body is produced over time and we
// read per-request query params. Pin the runtime so we don't accidentally get
// cached at the framework level.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const encoder = new TextEncoder();

/** Encode one {@link RunEvent} as a single SSE `data:` frame. */
function encodeFrame(event: RunEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function GET(request: NextRequest): Promise<Response> {
  const rawMode = request.nextUrl.searchParams.get('mode') ?? 'happy';
  if (!isRunMode(rawMode)) {
    return new Response(`Invalid mode "${rawMode}". Expected one of: ${RUN_MODES.join(', ')}.\n`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const runId = crypto.randomUUID();
  const { signal } = request;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the consumer — fine.
        }
      };

      const onAbort = (): void => close();
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        await runScenario(rawMode, {
          runId,
          signal,
          emit(event) {
            if (closed || signal.aborted) return;
            try {
              controller.enqueue(encodeFrame(event));
            } catch {
              // Consumer cancelled mid-enqueue.
              closed = true;
            }
          },
          sleep: (ms) => abortableSleep(ms, signal),
          now: () => Date.now(),
        });
      } catch (err) {
        // `AbortError` from `abortableSleep` is the normal client-disconnect
        // path. Anything else is a real bug worth surfacing in dev.
        if (!isAbortError(err)) {
          console.error('[api/run] scenario failed', err);
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
        close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // SSE must not be cached or transformed by intermediaries.
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx) so frames flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Promise-based `setTimeout` that rejects with `AbortError` on signal. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
