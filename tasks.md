# Tasks — Smooth Progress Bar with Live `MM:SS.ms` Timer

Derived from `prd.md`. Tasks are intentionally small and ordered so they can be picked up sequentially. Each task lists its scope (S), acceptance criteria (AC), and a complexity hint.

Legend: `XS` ≈ <30 min · `S` ≈ <1h · `M` ≈ 1–2h · `L` ≈ half day

---

## 0. Project hygiene & scaffolding

- [x] **0.1 Confirm Next.js 16 conventions** — `XS`
  - S: Skim `node_modules/next/dist/docs/` for App Router + route handler changes (this is not the Next.js training data assumes — see `AGENTS.md`).
  - AC: Notes captured in PR description / README on any non-obvious deltas (e.g. route handler signature, streaming response API, dynamic vs static).

- [x] **0.2 Verify `tsconfig` is `strict`** — `XS`
  - S: Ensure `"strict": true` and `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` if reasonable.
  - AC: `npm run lint` and `tsc --noEmit` clean on fresh checkout.

- [x] **0.3 Replace template `src/app/page.tsx`** with an empty shell that hosts the demo — `XS`
  - AC: Page renders an empty `<main>` with a heading + space reserved for the component and trigger buttons.

- [x] **0.4 Add `fuse-icon.png` to `public/`** (or import path the component can use) — `XS`
  - AC: Image accessible from the component at a stable path.

---

## 1. Domain model & shared types

- [x] **1.1 Define SSE event shape in `src/lib/run-progress/events.ts`** — `S`
  - S: TypeScript discriminated union for `step_start`, `step_progress`, `step_complete`, `step_error`, `run_complete`. Include `runId`, `stepIndex`, `stepCount`, `label`, `progress?`, `ts`, plus an `error` payload variant.
  - AC: Types exported and re-used by both server (route handler) and client (component/hook).

- [x] **1.2 Define run/step state machine** — `S`
  - S: Types for `RunStatus = 'idle' | 'running' | 'complete' | 'error' | 'stalled'` and `StepState`.
  - AC: Pure helpers like `reduce(state, event)` with unit-test-friendly signatures.

- [x] **1.3 Centralise tuning constants** — `XS`
  - S: `STALL_TIMEOUT_MS = 10_000`, default step labels, gradient colours.
  - AC: One source of truth, no magic numbers in the component.

---

## 2. Mock SSE endpoint (App Router route handler)

- [x] **2.1 Create route at `src/app/api/run/route.ts`** that returns a `text/event-stream` `Response` — `M`
  - S: Use `ReadableStream`; write `data: {json}\n\n` frames; handle client `abort` via `request.signal`.
  - AC: `curl -N http://localhost:3000/api/run?mode=happy` streams JSON events and terminates with `run_complete`.

- [x] **2.2 Implement Happy Path scenario** — `S`
  - S: 6–10 steps with realistic uneven timings (mix of 500ms and ~8s), at least one step emitting `step_progress` mid-flight.
  - AC: Total run lasts long enough (~20–30s) to exercise smoothing and the timer.

- [x] **2.3 Implement Error scenario** — `S`
  - S: Reach step N, emit `step_error`, terminate stream (no `run_complete`).
  - AC: Client sees an explicit error event; component lands in `error` state.

- [x] **2.4 Implement Stall scenario** — `S`
  - S: Emit a few events normally, then go silent (no events, keep stream open) for >10s.
  - AC: Client triggers `stalled` state after `STALL_TIMEOUT_MS`; resuming/aborting is clean.

- [x] **2.5 Mode selection via query param** — `XS`
  - S: `?mode=happy|error|stall`; default `happy`; validate input.
  - AC: Invalid mode returns 400 with a clear message.

- [x] **2.6 Verify re-runnable without reload** — `XS`
  - S: Ensure each request gets a fresh `runId` and prior streams are properly closed when client aborts.
  - AC: Manual: trigger Happy → Error → Stall back-to-back without refreshing.

---

## 3. Client data layer — `useRunProgress` hook

- [x] **3.1 Create `src/lib/run-progress/useRunProgress.ts`** — `M`
  - S: Manages an `EventSource` (or `fetch` + `ReadableStream` reader) lifecycle: `start(mode)`, `stop()`, exposes `state`, `lastEventAt`, `events`.
  - AC: Unmount/abort closes the stream; React strict-mode double-effect safe.

- [x] **3.2 Apply reducer from §1.2** to derive `RunStatus` and per-step state — `S`
  - AC: Hook returns `{ status, steps, currentStepIndex, error, startedAt, endedAt }`.

- [x] **3.3 Stall detection** — `S`
  - S: `requestAnimationFrame` loop (no `setInterval`) compares `now - lastEventAt` against `STALL_TIMEOUT_MS`. Transitions to `stalled`; recovers to `running` on next event.
  - AC: Unit test for stall transition with mocked time.

- [x] **3.4 Persist `startedAt` across re-renders** — `XS`
  - S: `useRef` + lazy init on first event; only set on the client (`typeof window !== 'undefined'`).
  - AC: No SSR/CSR hydration mismatch warning in console.

---

## 4. Progress smoothing engine

- [x] **4.1 Decide & document smoothing model** — `S`
  - S: Document chosen approach in `README.md` (e.g. each step has a per-step expected duration; bar interpolates from `stepIndex / stepCount` toward `(stepIndex + 1) / stepCount` using `rAF`, easing toward target without overshoot; speed up to catch up when `step_complete` arrives early; never go backward).
  - AC: One-paragraph rationale in README.

- [x] **4.2 Implement `useSmoothProgress` (rAF-based)** — `M`
  - S: Pure hook taking `{ target: number; status: RunStatus }`, returns `progress: number` (0–1). Uses `requestAnimationFrame`. Respects `prefers-reduced-motion` (snap to target).
  - AC: Bar visibly glides between step completions; freezes on `complete`/`error`/`stalled`.

- [x] **4.3 Unit-test smoothing math** — `S`
  - S: Deterministic test by injecting a fake clock & rAF.
  - AC: Asserts monotonic non-decreasing progress, stays within `[0, target + epsilon]`.

---

## 5. Live `MM:SS.ms` timer

- [x] **5.1 Implement `useElapsed` hook (rAF-based)** — `S`
  - S: Returns `elapsedMs` since `startedAt`; stops when `status` is `complete | error`; keeps last value on `stalled` per design choice (document in README).
  - AC: No `setInterval`; no work when document is hidden (use `visibilitychange`).

- [x] **5.2 `formatMMSSms(ms)` util + tests** — `XS`
  - S: Always 2-digit minutes, 2-digit seconds, 2-digit hundredths (e.g. `01:23.45`).
  - AC: Boundary cases tested (0, 59.999s, 60s, >60min).

- [x] **5.3 Render timer bottom-right of card** — `XS`
  - S: Positioned below the logo stack as per PRD; bar width reduced to make room.
  - AC: Matches PRD layout description in screenshot/Storybook.

---

## 6. `RunProgress` component (presentation)

- [x] **6.1 Component skeleton at `src/components/RunProgress/RunProgress.tsx`** — `S`
  - S: Props: `{ status, steps, currentStepIndex, progress, elapsedMs, error?, onRetry?, className? }`. Pure/presentational; no data fetching inside.
  - AC: Renders in all 5 states given mock props.

- [x] **6.2 Horizontal progress bar with gradient fill** — `S`
  - S: Tailwind utilities + a thin transform-based fill (`transform: scaleX(progress)`), `transform-origin: left`. No layout thrash.
  - AC: `role="progressbar"`, `aria-valuenow` (rounded), `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuetext` includes step label.

- [x] **6.3 Left icon with active/static animation** — `S`
  - S: Uses `fuse-icon.png`. Shimmer/fade while `running`; static on `complete`; tinted/red on `error`; subtle indicator on `stalled`. Respect `prefers-reduced-motion`.
  - AC: Animation pauses correctly on terminal states.

- [x] **6.4 Cycling step list above the bar** — `M`
  - S: Show a small stack of the last N step labels; cross-fade or slide as `currentStepIndex` advances. Latest active label is most prominent.
  - AC: Smooth transitions; no layout shift; truncation on overflow.

- [x] **6.5 Stalled visual treatment** — `S`
  - S: e.g. desaturated bar + small "Waiting for server…" badge near the active step. Document the choice in README.
  - AC: Clearly distinguishable from `running` and `error`.

- [x] **6.6 Error visual treatment** — `S`
  - S: Bar turns red at error point, error message rendered, optional `Retry` button (wired by consumer).
  - AC: Screen-reader announces the error (see §7).

---

## 7. Accessibility

- [x] **7.1 `role="progressbar"` with correct ARIA** — `XS`
  - S: `aria-valuenow/min/max`, `aria-valuetext` updated only on step boundaries (not every ms).
  - AC: axe / Storybook a11y addon passes.

- [x] **7.2 `aria-live="polite"` region for step transitions** — `S`
  - S: Separate offscreen `<span>` updated only when `currentStepIndex` or `status` changes — NOT on every rAF tick.
  - AC: VoiceOver test: announces step transitions, not timer ticks.

- [x] **7.3 `prefers-reduced-motion` honoured everywhere** — `XS`
  - S: Icon animation, bar interpolation, list transitions all check the media query (CSS or `matchMedia`).
  - AC: Toggling OS setting visibly disables animations.

---

## 8. Demo page — wiring it together

- [x] **8.1 Build trigger UI on `src/app/page.tsx`** — `S`
  - S: Three buttons (Happy Path / Error / Stall), one Reset/Stop button. Buttons disabled while running where appropriate.
  - AC: Re-running mid-flight cleanly cancels prior stream.

- [x] **8.2 Connect `useRunProgress` → `RunProgress`** — `S`
  - AC: End-to-end manual test of all three modes works in the browser.

- [x] **8.3 Visual polish pass** — `S`
  - S: Card chrome (shadow, rounded corners, padding), responsive width, dark-mode friendly.
  - AC: Looks "polished" per PRD tone; reviewed against PRD bullets.

---

## 9. Storybook stories

- [x] **9.1 Set up story file `RunProgress.stories.tsx`** — `XS`
  - AC: Story renders without errors in `npm run storybook`.

- [x] **9.2 Story per state** — `S`
  - S: `Idle`, `Running` (mid-progress with a few completed steps), `Complete`, `Error`, `Stalled`. Use controls for `progress` and `elapsedMs`.
  - AC: Five distinct stories visible in sidebar; each visually correct.

- [x] **9.3 `Live` story driven by the mock SSE endpoint** — `S` (optional but valuable)
  - AC: Story imports the hook and the component, with mode-selection controls.

---

## 10. Tests

- [ ] **10.1 Unit: `formatMMSSms`** — `XS` (see §5.2)
- [ ] **10.2 Unit: event reducer (`reduce(state, event)`)** — `S`
  - AC: Covers all event types + ordering edge cases (out-of-order, duplicate, error after complete).
- [ ] **10.3 Unit: `useSmoothProgress` math** — `S` (see §4.3)
- [ ] **10.4 Unit: stall detection in `useRunProgress`** — `S`
  - S: Fake timers / rAF; assert transition to `stalled` after 10s of silence and recovery on next event.
- [ ] **10.5 Component: `RunProgress` renders each state correctly** — `S`
  - S: React Testing Library snapshots / role queries; assert ARIA attributes.
- [ ] **10.6 Component: `aria-live` does not update on every tick** — `S`
  - S: Spy on the live-region content across many rAF frames; assert it only changes on step boundary.
- [ ] **10.7 Storybook test runner (`test:storybook`) green** — `XS`

---

## 11. README & handoff docs

- [ ] **11.1 Replace template `README.md`** — `M`
  - Sections required:
    - Setup / scripts (`dev`, `storybook`, `test`, `test:storybook`)
    - SSE event shape (with concrete JSON examples)
    - Progress-smoothing approach + rationale (links to §4.1)
    - Stall detection rationale + threshold
    - Accessibility decisions (timer vs live region split)
    - File map (`src/components/RunProgress/*`, `src/lib/run-progress/*`, `src/app/api/run/route.ts`)
    - "How to drop this into the real codebase" — list of dependencies & assumptions to revisit.
  - AC: A new engineer could integrate this into the main app from the README alone.

- [ ] **11.2 Add inline JSDoc on public APIs only** — `XS`
  - S: Hook signatures + component props. Avoid narration comments.

---

## 12. Pre-PR checklist

- [ ] **12.1** `npm run lint`, `npm run format:check`, `tsc --noEmit` all clean
- [ ] **12.2** `npm test` and `npm run test:storybook` green
- [ ] **12.3** Manual run of all three modes in the browser
- [ ] **12.4** Manual a11y pass: VoiceOver + `prefers-reduced-motion`
- [ ] **12.5** README screenshots/GIF of the three modes (optional but nice)
