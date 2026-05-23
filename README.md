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
src/components/RunProgress/Timer.tsx
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

### Live `MM:SS.ms` timer (§5)

The timer is a thin three-piece split:

- **`useElapsed({ startedAt, endedAt, status })`** — rAF-driven hook that returns the live `Date.now() - startedAt` and snaps to the final value on terminal status.
- **`formatMMSSms(ms)`** — pure formatter, always `MM:SS.cc` (see note below on the `.ms` label).
- **`<Timer elapsedMs />`** — pure presentational component using `font-mono tabular-nums` so the digits don't reflow as values change. Positioned by the parent via `className` (bottom-right of the card per PRD §2).

A few decisions worth calling out:

- **The fractional field is hundredths of a second, not milliseconds.** The PRD calls this "MM:SS.ms" and shows examples like `01:23.45` — two digits, so it's centiseconds. We truncate (not round) the cs field so the displayed value never reads ahead of `elapsedMs`, matching the rAF hook's monotonic guarantee.
- **Stalled freezes the timer.** When the run goes `stalled` we _stop incrementing_ the elapsed value rather than continue counting. Surfacing "we've been waiting on the server for 7s" via the timer would mislead the user into thinking the _run_ is taking that long; the stall badge (§6.5) carries that signal instead. Recovery to `running` snaps the timer to the real wall-clock elapsed on the next frame.
- **Terminal snaps to `endedAt - startedAt`.** Both `complete` and `error` pin the displayed value to the server-side end timestamp (recorded by the reducer on the terminating event) rather than whatever the last rAF frame happened to write. That keeps the final readout stable across viewers and reliably reads `00:30.00` instead of `00:30.07`.
- **No work when the tab is hidden.** rAF already throttles in background tabs, but the hook also listens to `visibilitychange` and explicitly cancels the loop on hidden / restarts on visible — and snaps to the wall clock on resume rather than accumulating frame-by-frame drift. (No `setInterval` anywhere, per PRD.)
- **Monotonic.** A wall-clock regression (NTP correction, manual time change) can never make the timer go backward.
- **`startedAt` is set lazily client-side** by the reducer on the first event (§3.4), so the initial SSR render is always `0` and there's no hydration mismatch.
- **A11y.** The timer is rendered as normal text _outside_ any `aria-live` region (see §7.2). Screen readers can navigate to it on demand, but the per-frame digit changes never trigger a polite announcement.

### Stalled visual treatment (§6.5)

Three cues stack to make `stalled` unambiguous against the neighbouring states (and they're each independently sufficient — so colourblind users, reduced-motion users, and screen-reader users all get the signal):

1. **Bar fill desaturates and gently pulses.** Switching from the indigo→violet→pink gradient to flat `#71717A` zinc-500 says "this is not a normal in-progress state"; layering `motion-safe:animate-pulse` on top says "still alive, just waiting" — which is what distinguishes it from `error` (frozen solid red) and `complete` (snapped to 100% gradient).
2. **Inline `Waiting for server…` pill next to the active step.** Anchored next to the current step row (not the card footer) so the affordance is read alongside the label of the step we're stuck on. The leading dot pulses under `motion-safe:` and the badge itself is statically recognisable when motion is off.
3. **Neutral ring around the icon** (vs. red on `error`) so the leftmost glance at the card already discriminates `stalled` from `error` without colour-only signalling.

The timer **freezes** on stall (see §5 above) — the stall pill carries the "we've been waiting" signal so the timer doesn't have to lie about run duration.

### Accessibility (§7)

Three layers, each responsible for one signal:

1. **`role="progressbar"`** on the bar exposes `aria-valuemin=0`, `aria-valuemax=100`, and a `aria-valuenow` rounded from the smoothed value. The displayed percentage is what changes every animation frame — and that's _fine_, because `aria-valuenow` is a number-valued attribute and AT typically polls it rather than re-announcing on every tick. We additionally set **`aria-valuetext`** with a human-readable label (e.g. _"Step 2 of 7: Reading metrics…"_); this string is a pure function of `(status, currentStepIndex, label, stepCount)`, so it only changes at step boundaries and never on a rAF tick. Verified by a unit test that rerenders with varying `progress` and asserts `aria-valuetext` stays identical.
2. **`aria-live="polite"` region** (a visually hidden `sr-only` `<span>` with `aria-atomic="true"`) carries the canonical step-transition announcement. Its content is derived from the same `(status, step, stepCount)` tuple — never from `progress`, never from `elapsedMs` — and React's DOM diffing only writes the node when the string changes, so a `MutationObserver` over 20 frames of `progress`/`elapsedMs` churn records **zero** mutations (also covered by a unit test). The region stays empty in the `error` state because the inline `ErrorPanel` already has `role="alert"`; we'd rather have one assertive announcement than fight a polite one against an assertive one.
3. **`prefers-reduced-motion`** is honoured in two complementary ways:
   - **CSS-level** — every animated class in the component (`animate-pulse` on the icon, the stalled bar fill, and the stalled badge dot; `transition-*` / `duration-*` / `ease-*` on the step-list rows) is gated behind Tailwind's **`motion-safe:`** variant, which compiles to `@media (prefers-reduced-motion: no-preference)`. Toggling the OS setting collapses the rules without a remount.
   - **JS-level** — `useSmoothProgress` subscribes to `window.matchMedia('(prefers-reduced-motion: reduce)')` and, while reduced motion is on, **snaps** the displayed value to the target on every render and never schedules an rAF frame. The `change` listener means flipping the OS toggle takes effect live.

The timer continues to update every frame even with reduced motion — that's a digit readout, not motion — but it lives outside any `aria-live` region (see §5), so a screen reader treats it as static text that the user can navigate to on demand instead of an announcement stream.

What this buys us:

- **Colour-independent state.** Each status has a non-colour cue (motion, badge, ring, alert), so colourblind users get full information.
- **Motion-independent state.** With reduced motion on, the bar still moves (it just snaps each step), the icon still gets a ring on error / stall, the stall badge still renders (just static), and the live region still announces.
- **Quiet by default.** The timer never announces; the bar's text only changes on step boundaries; the polite region only fires on step / status transitions; the error region fires once on error. No per-frame chatter.
