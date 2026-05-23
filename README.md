# Smooth Progress Bar with Live `MM:SS.ms` Timer

Standalone Next.js 16 + TypeScript + Tailwind reference implementation of a `RunProgress` component fed by a mock SSE endpoint. See `prd.md` for the full brief and `tasks.md` for the implementation plan.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
npm run storybook    # http://localhost:6006
npm test             # unit tests (vitest)
npm run test:storybook
```

## Next.js 16 conventions (deltas from older training data)

These are the non-obvious points that matter for this project — captured up front so we don't write code against an older mental model. Sourced from `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` and `node_modules/next/dist/docs/01-app/02-guides/streaming.md` in the locally installed Next.js.

### Route handlers (`app/api/<path>/route.ts`)

- **Signature is `(request: Request | NextRequest, context?)`.** No `NextApiRequest`/`NextApiResponse` (that's Pages Router).
- **Dynamic params are a `Promise`** as of v15: `{ params }: { params: Promise<{ slug: string }> }`. Our `/api/run` has no dynamic segment, so this doesn't bite us — but worth knowing.
- **`GET` handlers default to dynamic** (changed in v15 from static). For our SSE endpoint we still set `export const dynamic = 'force-dynamic'` defensively, since any caching at all would defeat streaming.
- **`runtime`** can be `'nodejs'` (default) or `'edge'`. We'll stick with `'nodejs'` — no runtime constraints needed.
- **`RouteContext<'/path'>`** is a globally available helper (no import) for typing params from a route literal. Not needed here.

### Streaming via Web Streams API

The streaming guide explicitly calls out **Server-Sent Events** as the canonical use case for raw streaming in route handlers. The recommended shape:

```ts
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      // ...
      controller.close();
    },
    cancel() {
      // client aborted
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering for proxies
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
```

- **Listen to `request.signal`** to detect client aborts; clear timers and call `controller.close()` from the `abort` handler (or use `cancel()` on the stream).
- **`X-Accel-Buffering: no`** is needed if anything downstream (nginx, some CDNs) might buffer; the streaming guide flags this explicitly.
- **`Accept-Encoding: identity`** on the client side disables compression buffering when verifying with a script; not something we need to send from the browser, but useful for `curl -N` style debugging.

### Suspense / streaming UI (not used here, but worth being aware of)

- `<Suspense>` boundaries each form an independent streaming + hydration unit.
- `loading.tsx` works the same as before, but for granular streaming prefer explicit `<Suspense>`.
- Once streaming begins, the response **status code is locked**. `notFound()` mid-stream injects a meta noindex; `redirect()` becomes a client-side redirect. Doesn't affect our route handler (we control headers up front), but relevant when wiring this into a real app.

## File map (target — sections grow as we land tasks)

```
src/app/page.tsx                    # demo page (trigger buttons + RunProgress)
src/app/api/run/route.ts            # mock SSE endpoint
src/lib/run-progress/events.ts      # SSE event discriminated union
src/lib/run-progress/state.ts       # RunStatus / StepState / reduce()
src/lib/run-progress/constants.ts   # STALL_TIMEOUT_MS, default labels, etc.
src/lib/run-progress/useRunProgress.ts
src/lib/run-progress/useSmoothProgress.ts
src/lib/run-progress/useElapsed.ts
src/lib/run-progress/format.ts      # formatMMSSms
src/components/RunProgress/RunProgress.tsx
src/components/RunProgress/RunProgress.stories.tsx
public/fuse-icon.png                # left-icon asset
```

## Decisions log

This section will accumulate as we land tasks (stall UX in §6.5, timer + a11y trade-offs in §5/§7). For now: see `prd.md` and `tasks.md`.

### Progress smoothing model (§4.1)

The parent derives a **target** in `[0, 1]` from the reduced run state:

```
target = (completedStepCount + currentStepInnerProgress) / stepCount
```

`useSmoothProgress` eases the **displayed** progress toward that target on every animation frame using simple exponential decay:

```
next = current + (target - current) * (1 - exp(-k * dt))
```

Why this shape:

- **Naturally adaptive.** A large gap (e.g. a step finishes early and `target` jumps from `0.30` to `0.42`) produces a proportionally larger per-frame step, so the bar visibly *catches up* without a setInterval or scheduled "boost".
- **No overshoot.** Each frame moves a fraction of the remaining distance, so `progress` asymptotes to `target` from below — we additionally clamp to `[current, target]` to be defensive against rounding.
- **Monotonic.** We clamp `next >= current` even if `target` were to regress (it shouldn't, because the reducer never lowers per-step progress, but the smoothing layer enforces it independently so it composes safely with any future producer).
- **Frame-rate independent.** `dt` is taken from the rAF callback's timestamp and capped at 100 ms so a backgrounded tab doesn't trigger a giant jump on resume.

Terminal states:

- `running` — animate as above.
- `complete` — cancel the loop and snap to `target` (which the reducer pins at `1`), so the bar reliably reads 100% rather than 99.x%.
- `error` / `stalled` — cancel the loop and **freeze** at whatever the bar is currently showing.
- `idle` — sit at `0`.

Reduced motion:

- When `(prefers-reduced-motion: reduce)` matches, the hook snaps to `target` on every render and never starts an rAF loop. The media query is observed, so toggling the OS setting takes effect live without a remount.

Default decay rate is `k = 6` per second (≈115 ms half-life), tuned to feel responsive without looking nervous. Consumers can override via the `decayRate` option — useful in tests, where a much higher rate makes assertions easy.
