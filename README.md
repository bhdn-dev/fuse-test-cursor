# Smooth Progress Bar with Live `MM:SS.ms` Timer

Standalone Next.js 16 + TypeScript + Tailwind reference implementation of a `RunProgress` component fed by a mock SSE endpoint. See [`prd.md`](./prd.md) for the full brief and [`tasks.md`](./tasks.md) for the implementation plan.

---

## Setup & scripts

```bash
npm install

npm run dev              # demo page → http://localhost:3000
npm run storybook        # component stories → http://localhost:6006
npm run build            # production build
npm run lint             # eslint
npm run format:check     # prettier (CI-friendly)
npm test                 # unit tests (vitest, jsdom)
npm run test:storybook   # Storybook interaction/a11y tests (Playwright)
```

**Quick smoke test:** open the demo page, click **Happy Path**, watch the bar glide and the timer tick for ~20 s. Then try **Error** and **Stall** without refreshing — each run gets a fresh `runId` and the prior stream is aborted cleanly.

**Debug the SSE endpoint directly:**

```bash
curl -N 'http://localhost:3000/api/run?mode=happy'
```

Each line is a standard SSE `data:` frame containing one JSON object (see [SSE event shape](#sse-event-shape) below).

---

## File map

```
src/app/page.tsx                         # demo page shell (server component)
src/components/RunProgress/
  RunProgress.tsx                        # presentational card (bar, steps, icon, timer)
  RunProgressDemo.tsx                    # wires hooks → component for the demo page
  RunProgress.stories.tsx                # Storybook stories (one per state + Live)
  Timer.tsx                              # MM:SS.cc readout
src/lib/run-progress/
  events.ts                              # SSE event discriminated union + runtime guard
  state.ts                               # RunStatus / StepState / reduce()
  constants.ts                           # STALL_TIMEOUT_MS, labels, gradient colours
  useRunProgress.ts                      # fetch + SSE reader, stall detection, controls
  useSmoothProgress.ts                   # rAF exponential easing toward target
  useElapsed.ts                          # rAF wall-clock timer
  format.ts                              # formatMMSSms()
  index.ts                               # barrel for server-safe pure exports
src/app/api/run/
  route.ts                               # GET /api/run — text/event-stream transport
  scenarios.ts                           # happy / error / stall mock scripts
public/fuse-icon.png                     # left-icon asset
```

**Integration entry points:** copy `src/components/RunProgress/` and `src/lib/run-progress/` into your app, then wire them the same way `RunProgressDemo.tsx` does — or swap `useRunProgress`'s fetch URL for your real backend.

---

## SSE event shape

Transport: **`GET /api/run?mode=happy|error|stall`** returns `Content-Type: text/event-stream`. Each event is one SSE frame:

```
data: {"type":"step_start","runId":"…","stepIndex":0,"stepCount":7,"label":"Analyzing campaigns…","ts":1716566400123}

```

The `data:` payload is a JSON object matching the discriminated union in `src/lib/run-progress/events.ts`. All events share `runId` (stable for the stream) and `ts` (server emit time, ms since epoch). Step-scoped events also carry `stepIndex`, `stepCount`, and `label`.

### Event types

| `type` | When emitted | Extra fields |
|---|---|---|
| `step_start` | A step begins | — |
| `step_progress` | Mid-step checkpoint (optional) | `progress` in `[0, 1]` |
| `step_complete` | A step finishes | — |
| `step_error` | A step fails (terminal) | `error: { message, code? }` |
| `run_complete` | Entire run succeeds (terminal) | `stepCount` |

### Concrete examples

**Step start** — first frame of a run:

```json
{
  "type": "step_start",
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "stepIndex": 0,
  "stepCount": 7,
  "label": "Analyzing campaigns…",
  "ts": 1716566400123
}
```

**Mid-step progress** — emitted during long steps so the bar can glide inside a single step slot:

```json
{
  "type": "step_progress",
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "stepIndex": 1,
  "stepCount": 7,
  "label": "Reading metrics…",
  "progress": 0.5,
  "ts": 1716566404123
}
```

**Step complete:**

```json
{
  "type": "step_complete",
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "stepIndex": 1,
  "stepCount": 7,
  "label": "Reading metrics…",
  "ts": 1716566412123
}
```

**Step error** (Error mode) — stream ends here; no `run_complete`:

```json
{
  "type": "step_error",
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "stepIndex": 2,
  "stepCount": 7,
  "label": "Contacting API…",
  "error": {
    "message": "Upstream API returned 503",
    "code": "UPSTREAM_UNAVAILABLE"
  },
  "ts": 1716566415123
}
```

**Run complete** (Happy mode) — final frame:

```json
{
  "type": "run_complete",
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "stepCount": 7,
  "ts": 1716566420123
}
```

### Client handling notes

- **`useRunProgress`** uses `fetch` + a `ReadableStream` reader (not `EventSource`) so it can abort cleanly, skip auto-reconnect, and send custom headers.
- **`isRunEvent()`** validates every parsed frame before it reaches the reducer.
- **Stale frames** from a prior run are dropped when `event.runId !== state.runId`.
- **Terminal events:** `step_error` and `run_complete` both pin `endedAt` and stop further reduction.

---

## Progress smoothing

The parent derives a **target** in `[0, 1]` from the reduced run state:

```
target = sum(step.progress for each step) / stepCount
```

`useSmoothProgress` eases the **displayed** progress toward that target on every animation frame using exponential decay:

```
next = current + (target - current) * (1 - exp(-k * dt))
```

Why this shape:

- **Naturally adaptive.** A large gap (e.g. a step finishes early and `target` jumps from `0.30` to `0.42`) produces a proportionally larger per-frame step, so the bar visibly _catches up_ without a setInterval or scheduled "boost".
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

---

## Stall detection

**Threshold:** `STALL_TIMEOUT_MS = 10_000` (10 seconds of silence) — defined in `src/lib/run-progress/constants.ts` and shared by the hook and the Stall demo scenario.

**Mechanism:** while `status === 'running'`, `useRunProgress` runs a `requestAnimationFrame` loop (no `setInterval`) that compares `Date.now() - lastEventAt` against the threshold. When exceeded, the reducer transitions to `stalled`. The loop stops in `stalled`; the next inbound event recovers to `running` and restarts the loop.

**Why 10 s:** matches the PRD requirement and is long enough that normal uneven step timings (500 ms – 8 s) never false-positive, but short enough that a hung backend is surfaced before the user assumes the run is still healthy.

**Why rAF, not `setInterval`:** consistent with the PRD's animation constraint; the stall check piggybacks on the same scheduling model as the bar and timer, and naturally pauses when the tab is backgrounded.

**UX pairing:** the timer **freezes** on stall (see [Live timer](#live-mmssms-timer) below) so it doesn't imply the _run_ is still advancing. The "Waiting for server…" badge and desaturated pulsing bar carry the wait signal instead.

---

## Live `MM:SS.ms` timer

The timer is a thin three-piece split:

- **`useElapsed({ startedAt, endedAt, status })`** — rAF-driven hook that returns the live `Date.now() - startedAt` and snaps to the final value on terminal status.
- **`formatMMSSms(ms)`** — pure formatter, always `MM:SS.cc` (see note below on the `.ms` label).
- **`<Timer elapsedMs />`** — pure presentational component using `font-mono tabular-nums` so the digits don't reflow as values change. Positioned by the parent via `className` (bottom-right of the card per PRD §2).

Key decisions:

- **The fractional field is hundredths of a second, not milliseconds.** The PRD calls this "MM:SS.ms" and shows examples like `01:23.45` — two digits, so it's centiseconds. We truncate (not round) the cs field so the displayed value never reads ahead of `elapsedMs`.
- **Stalled freezes the timer.** Recovery to `running` snaps to real wall-clock elapsed on the next frame.
- **Terminal snaps to `endedAt - startedAt`.** Both `complete` and `error` pin the displayed value to the server-side end timestamp recorded by the reducer.
- **No work when the tab is hidden.** The hook listens to `visibilitychange` and cancels the rAF loop on hidden / restarts on visible.
- **`startedAt` is set lazily client-side** by the reducer on the first event (§3.4), so the initial SSR render is always `0` and there's no hydration mismatch.

---

## Stalled visual treatment

Three cues stack to make `stalled` unambiguous:

1. **Bar fill desaturates and gently pulses** — flat zinc-500 instead of the indigo→violet→pink gradient; `motion-safe:animate-pulse` says "still alive, just waiting".
2. **Inline `Waiting for server…` pill** next to the active step row.
3. **Neutral ring around the icon** (vs. red on `error`).

---

## Accessibility

Three layers, each responsible for one signal:

1. **`role="progressbar"`** on the bar exposes `aria-valuemin=0`, `aria-valuemax=100`, and `aria-valuenow` rounded from the smoothed value. **`aria-valuetext`** (e.g. _"Step 2 of 7: Reading metrics…"_) is derived from `(status, currentStepIndex, label, stepCount)` and only changes at step boundaries — never on a rAF tick.
2. **`aria-live="polite"` region** — a visually hidden `sr-only` `<span>` with `aria-atomic="true"` announces step transitions and status changes. Content never includes `progress` or `elapsedMs`. Stays empty in `error` because the inline `ErrorPanel` already has `role="alert"`.
3. **Timer vs live region split.** The timer is normal text _outside_ any `aria-live` region. Screen readers can navigate to it on demand, but per-frame digit changes never trigger polite announcements. This is the core a11y trade-off: live elapsed time for sighted users, quiet step announcements for AT users.
4. **`prefers-reduced-motion`** — CSS `motion-safe:` gates on icon pulse, step-list transitions, and stall badge dot; `useSmoothProgress` snaps to target in JS when reduced motion is on.

---

## How to drop this into the real codebase

### 1. Copy the modules

| Copy | Purpose |
|---|---|
| `src/components/RunProgress/` | UI card + timer + Storybook stories |
| `src/lib/run-progress/` | types, reducer, hooks, formatter |
| `public/fuse-icon.png` | left icon (swap for your brand asset) |

You do **not** need `src/app/api/run/` in production — replace it with your real streaming endpoint.

### 2. Wire the consumer

Follow `RunProgressDemo.tsx`:

```tsx
const { status, steps, currentStepIndex, error, startedAt, endedAt, start, reset } =
  useRunProgress();

const target = useMemo(() => {
  if (steps.length === 0) return 0;
  return steps.reduce((sum, s) => sum + s.progress, 0) / steps.length;
}, [steps]);

const progress = useSmoothProgress({ target, status });
const elapsedMs = useElapsed({ startedAt, endedAt, status });

return (
  <RunProgress
    status={status}
    steps={steps}
    currentStepIndex={currentStepIndex}
    progress={progress}
    elapsedMs={elapsedMs}
    error={error}
    onRetry={() => start(lastMode)}
  />
);
```

### 3. Point `useRunProgress` at your backend

In `useRunProgress.ts`, change the fetch URL from `/api/run?mode=…` to your production SSE route. Keep the same frame format (`data: {json}\n\n`) and event types — or adapt `events.ts` / `isRunEvent()` to match your wire contract.

**Assumptions to revisit:**

| Assumption | Where to change |
|---|---|
| Event types and fields | `src/lib/run-progress/events.ts` |
| Stall timeout (10 s) | `STALL_TIMEOUT_MS` in `constants.ts` |
| Step labels when missing | `DEFAULT_STEP_LABELS` in `constants.ts` |
| Gradient / error / stall colours | `PROGRESS_*` constants in `constants.ts` |
| Auth headers / cookies on the stream | fetch options in `useRunProgress.start()` |
| Reconnect / resume after disconnect | currently **no** auto-reconnect by design — add if your backend supports resuming a run |
| Platform-specific icons | today a single `fuse-icon.png`; your real component likely needs per-platform icon slots |
| Server timestamps vs client | `ts` on events is diagnostic only; `startedAt` / `endedAt` in state are client wall-clock |

### 4. Dependencies

**Runtime:** `react`, `react-dom`, `next` (App Router). No UI kit.

**Dev / optional:** Storybook + Vitest stack (see `package.json` devDependencies) if you want the stories and tests to come along.

**Tailwind v4:** the component uses utility classes directly. If your app uses a different styling approach, the layout structure in `RunProgress.tsx` is still the reference — swap class names, keep the ARIA attributes.

### 5. Server-side producer checklist

Your backend stream should:

- Emit `step_start` before work begins on each step.
- Optionally emit `step_progress` with fractional progress during long steps (drives intra-step bar gliding).
- Emit `step_complete` when a step finishes, or `step_error` to terminate with an error payload.
- Emit `run_complete` once on success.
- Stamp a stable `runId` on every frame.
- Keep the connection open until terminal or client abort; respect client disconnect to stop work.

---

## Next.js 16 conventions (deltas from older training data)

These are the non-obvious points that matter for this project — captured up front so we don't write code against an older mental model. Sourced from `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` and `node_modules/next/dist/docs/01-app/02-guides/streaming.md` in the locally installed Next.js.

### Route handlers (`app/api/<path>/route.ts`)

- **Signature is `(request: Request | NextRequest, context?)`.** No `NextApiRequest`/`NextApiResponse` (that's Pages Router).
- **Dynamic params are a `Promise`** as of v15: `{ params }: { params: Promise<{ slug: string }> }`. Our `/api/run` has no dynamic segment, so this doesn't bite us — but worth knowing.
- **`GET` handlers default to dynamic** (changed in v15 from static). For our SSE endpoint we still set `export const dynamic = 'force-dynamic'` defensively, since any caching at all would defeat streaming.
- **`runtime`** can be `'nodejs'` (default) or `'edge'`. We'll stick with `'nodejs'` — no runtime constraints needed.

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
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
```

- **Listen to `request.signal`** to detect client aborts; clear timers and call `controller.close()` from the `abort` handler (or use `cancel()` on the stream).
- **`X-Accel-Buffering: no`** is needed if anything downstream (nginx, some CDNs) might buffer.
