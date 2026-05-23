# Smooth Progress Bar with Live MM:SS.ms Timer

## Background

We're building an AI-powered marketing platform. When a user runs an AI agent, the backend streams progress events to the UI. Each event represents a sub-task (e.g. "Analyzing Campaigns…", "Reading metrics…"). Today, our progress component shows a smooth horizontal bar with per-platform status icons, but it doesn't show how long the run has been going.

We need a small, polished, **standalone** version of this component that we can use as a reference implementation and that demonstrates you can ship the real version into our codebase as your first post-hire task.

**What we’re currently missing:**

- A live `MM:SS.ms` counter rendered bottom-right of the card (below the logo stack)
- Persisted start timestamp across re-renders / batch transitions
- Stop on `complete` or `error` (freezes final value)
- Proper hydration handling (no SSR/CSR mismatch — `Date.now()` only on client)
- A11y: `aria-live="polite"` updates that don't spam screen readers every frame

## Deliverables

A **`RunProgress` React component** that displays the live progress of a multi-step "AI run", **consumed by a mock SSE endpoint** that you also implement (in the same Next.js app, as a route handler). A **`README.md`** documenting the component and your decisions.

**The component must show:**

1. A **single horizontal progress bar** similar to above (gradient fill, smooth animation) — 0% to 100%
2. A **live `MM:SS.ms` timer at the bottom right of the progress card,** running from the first event received until the run completes or errors. Note that the progress bar above would need to be slightly reduced in width.
3. A **The icon on the left that animates** (e.g. shimmer, fade, etc.) while the run is active and goes static when complete @fuse-icon.png
4. A **cycling list of steps above the bar**, each with a short message (e.g. “Analyzing campaigns…”, “Contacting API…”, “Processing results…”, etc.)
5. **Visual states: active, complete, error,** and **stalled** (=no event for 10 seconds — surface this in the UI somehow, your call)

**The mock SSE endpoint must:**

- **Stream a sequence of step events with realistic uneven timings** (some steps take 500ms, some take 8s)
- **Emit at least:** `step_start`, `step_progress` (optional, with a `progress` 0–1 within the step), `step_complete`, `step_error` (for at least one step in a "demo error" mode), and `run_complete`
- **Be triggerable from a button in the UI with three modes: Happy Path, Error, Stall**
- **Be re-runnable without a page reload**

**Progress smoothing requirement:**
The overall progress bar must not jump between step completions. If step 3 of 8 finishes, the bar should be somewhere around ~37% _and \*\*gliding rightward continuously_, not snapping\*\*. How you model this is up to you. Explain your reasoning in the follow-up discussion.

## Constraints

- **Stack:** Next.js (App Router) + TypeScript (strict) + Tailwind. No UI kit (no shadcn, no MUI). Please build the component yourself.
- **No `setInterval` for animations.** Use `requestAnimationFrame` for the timer and bar.
- **Storybook:** at least one story per state (idle / running / complete / error / stalled).
- **Accessibility:** `role="progressbar"` with valid `aria-valuenow/min/max`, an `aria-live` region for step transitions that doesn't fire on every ms tick, `prefers-reduced-motion` respected.
- **Tests:** Determine what tests are necessary for basic coverage.
- **README.md:** Cover setup, the SSE event shape you designed, your progress-smoothing approach, core decisions. The README.md should help to transfer the project into our actual codebase.
