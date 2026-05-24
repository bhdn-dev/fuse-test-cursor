'use client';

/**
 * `RunProgress` — pure presentational view for a multi-step AI run.
 *
 * Owns the *card chrome* and the visual composition (icon · step list · bar ·
 * timer · error/stall badges). Data fetching lives in `useRunProgress`; the
 * smoothed bar value lives in `useSmoothProgress`; the live readout lives in
 * `useElapsed`. The consumer wires those together and passes the results in
 * as props — keeps this component trivially testable in isolation (RTL +
 * Storybook stories per §9).
 *
 * Built incrementally across §6.1 → §6.6 — sub-features are colocated as
 * small internal components so the public surface stays a single import.
 */

import { Timer } from './Timer';
import {
  PROGRESS_ERROR_COLOR,
  PROGRESS_GRADIENT,
  PROGRESS_STALLED_COLOR,
} from '@/lib/run-progress/constants';
import type { RunError, RunStatus, StepState } from '@/lib/run-progress/state';

/**
 * Presentational props for the run-progress card. Data fetching and rAF hooks
 * live in the consumer — pass their outputs in here.
 */
export interface RunProgressProps {
  status: RunStatus;
  steps: readonly StepState[];
  currentStepIndex: number;
  progress: number;
  elapsedMs: number;
  error?: RunError | null;
  onRetry?: () => void;
  className?: string;
}

/** Multi-step run card: icon, step list, smoothed bar, timer, error/stall badges. */
export function RunProgress({
  status,
  steps,
  currentStepIndex,
  progress,
  elapsedMs,
  error,
  onRetry,
  className,
}: RunProgressProps) {
  const cardClasses = [
    'relative',
    'flex',
    'flex-col',
    'gap-4',
    'rounded-2xl',
    'border',
    'border-zinc-200',
    'bg-white',
    'p-6',
    'shadow-sm',
    'dark:border-zinc-800',
    'dark:bg-zinc-900',
  ];
  if (className) cardClasses.push(className);

  const activeStep = currentStepIndex >= 0 ? (steps[currentStepIndex] ?? null) : null;

  return (
    <section
      className={cardClasses.join(' ')}
      aria-label="Run progress"
      data-testid="run-progress"
      data-status={status}
    >
      <div className="flex items-start gap-4">
        <FuseIcon status={status} />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <StepList steps={steps} currentStepIndex={currentStepIndex} status={status} />
            </div>
            {status === 'stalled' ? <StalledBadge /> : null}
          </div>

          <ProgressBar
            progress={progress}
            status={status}
            ariaValueText={ariaValueText(status, activeStep, steps.length)}
          />
        </div>
      </div>

      {status === 'error' && error ? (
        <ErrorPanel error={error} {...(onRetry ? { onRetry } : {})} />
      ) : null}

      <LiveRegion status={status} step={activeStep} stepCount={steps.length} />

      {/* Timer (bottom-right per PRD §2 / §5.3) */}
      <Timer elapsedMs={elapsedMs} className="self-end" />
    </section>
  );
}

/**
 * Polite screen-reader announcer for step transitions (§7.2).
 *
 * Two rules govern what lives in here:
 *
 * 1. **Only step-boundary signal.** The text is a pure function of
 *    `(status, step.index, step.label, stepCount)` — none of which change on
 *    every rAF tick. The bar's `aria-valuenow` updates every frame, but the
 *    `aria-valuetext` we expose on the bar (and the string in this region) do
 *    not, so screen readers don't get spammed with per-millisecond chatter.
 * 2. **No double-announcing errors.** {@link ErrorPanel} already carries
 *    `role="alert"` (assertive); duplicating the same string here as polite
 *    would either step on the alert or queue a second utterance. We leave
 *    this region blank in `error` so the alert wins cleanly.
 *
 * The element is visually hidden via `sr-only` so it never affects layout.
 * `aria-atomic="true"` makes assistive tech re-read the full sentence
 * whenever it changes, instead of trying to diff sub-words.
 */
function LiveRegion({
  status,
  step,
  stepCount,
}: {
  status: RunStatus;
  step: StepState | null;
  stepCount: number;
}) {
  return (
    <span
      data-testid="run-progress-live-region"
      className="sr-only"
      aria-live="polite"
      aria-atomic="true"
    >
      {liveRegionMessage(status, step, stepCount)}
    </span>
  );
}

function liveRegionMessage(status: RunStatus, step: StepState | null, stepCount: number): string {
  if (status === 'idle') return '';
  if (status === 'complete') return 'Run complete';
  // error: handled by the role="alert" ErrorPanel — see LiveRegion docstring.
  if (status === 'error') return '';
  if (status === 'stalled') {
    return step
      ? `Waiting for server on step ${step.index + 1} of ${stepCount}: ${step.label}`
      : 'Waiting for server';
  }
  return step ? `Step ${step.index + 1} of ${stepCount}: ${step.label}` : '';
}

/**
 * Error region rendered below the bar when the run lands in `error`.
 *
 * - **`role="alert"`** so screen readers announce the message immediately
 *   on appearance — equivalent to `aria-live="assertive" aria-atomic="true"`
 *   without us needing to wire those individually. Satisfies §6.6's
 *   "screen-reader announces the error" AC even before §7.2 lands the
 *   dedicated polite region for step transitions.
 * - **Retry is consumer-wired.** The button only renders when `onRetry` is
 *   provided so this component stays presentation-only; the demo page
 *   (§8.1) connects it to `useRunProgress.start(lastMode)`.
 * - **Code is rendered subtly in mono** when present, so it's visually
 *   distinct from the human-readable message but still selectable.
 */
function ErrorPanel({ error, onRetry }: { error: RunError; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      data-testid="run-progress-error"
      className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/15"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3 fill-red-600 dark:fill-red-400">
          <path d="M8 1.5a1 1 0 0 1 .88.526l6 11A1 1 0 0 1 14 14.5H2a1 1 0 0 1-.88-1.474l6-11A1 1 0 0 1 8 1.5Zm0 9a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm.75-5.25a.75.75 0 0 0-1.5 0V9a.75.75 0 0 0 1.5 0V6.25Z" />
        </svg>
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">{error.message}</span>
        {error.code ? (
          <span
            data-testid="run-progress-error-code"
            className="font-mono text-xs text-red-600/80 dark:text-red-400/80"
          >
            [{error.code}]
          </span>
        ) : null}
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 self-center rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/60"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/**
 * Small pill rendered next to the active step when the stream goes silent
 * for >`STALL_TIMEOUT_MS`. Pairs with the desaturated, gently pulsing bar
 * fill (see {@link ProgressBar}) — both cues are required to distinguish
 * `stalled` from `running` (which has a vibrant moving gradient) and `error`
 * (which freezes solid red and surfaces a full message).
 *
 * The leading dot uses `motion-safe:animate-pulse` so reduced-motion users
 * still see a static, recognisable badge.
 */
function StalledBadge() {
  return (
    <span
      data-testid="run-progress-stalled-badge"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400 motion-safe:animate-pulse dark:bg-zinc-500"
      />
      Waiting for server…
    </span>
  );
}

/**
 * Fixed-height vertical stack of the most-recent step labels. The "current"
 * line lives at the bottom of the stack (closest to the bar) — older labels
 * rise upward and fade as new ones arrive. Each label is absolutely
 * positioned and `translateY`d by its depth from `currentStepIndex`, so the
 * whole list animates by simply re-deriving depths whenever `currentStepIndex`
 * advances (CSS transitions take care of the motion).
 *
 * - **No layout shift.** Container height is fixed regardless of how many
 *   steps have started; idle state renders a placeholder line at the same
 *   height so the bar doesn't jump on first event.
 * - **Truncation.** Each row has `truncate`; overflow is clipped by the
 *   container, so long labels never wrap onto a second line and break the
 *   geometry.
 * - **`prefers-reduced-motion`.** Transitions live under `motion-safe:`, so
 *   reduced-motion users just see the labels snap.
 * - **A11y.** Labels are regular text (not in an `aria-live` region — see
 *   §7.2 for the dedicated polite announcer) so they're focusable/navigable
 *   but don't auto-announce on each step.
 */
function StepList({
  steps,
  currentStepIndex,
  status,
}: {
  steps: readonly StepState[];
  currentStepIndex: number;
  status: RunStatus;
}) {
  const LINE_HEIGHT_PX = 20;
  const VISIBLE_LINES = 3;
  const containerHeight = LINE_HEIGHT_PX * VISIBLE_LINES;

  if (status === 'idle' || currentStepIndex < 0) {
    return (
      <div
        data-testid="run-progress-step-list"
        className="relative w-full overflow-hidden"
        style={{ height: containerHeight }}
      >
        <span className="absolute right-0 bottom-0 left-0 block truncate text-sm leading-5 text-zinc-400 dark:text-zinc-500">
          Ready
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="run-progress-step-list"
      className="relative w-full overflow-hidden"
      style={{ height: containerHeight }}
    >
      {steps.map((step) => {
        const depth = currentStepIndex - step.index;
        const isCurrent = depth === 0;
        const isVisible = depth >= 0 && depth < VISIBLE_LINES;

        // Park future steps one slot *below* the current line (off-stage) so
        // they rise into view rather than fading in place when they become
        // current. Older steps past the visible cap park above the top of the
        // container, still on-axis, so the exit animation looks consistent.
        const slotIndex = depth < 0 ? -1 : depth;
        const translateY = -slotIndex * LINE_HEIGHT_PX;

        let opacity = 0;
        if (isCurrent) opacity = 1;
        else if (isVisible) opacity = Math.max(0, 0.55 - (depth - 1) * 0.2);

        const colorClass = isCurrent
          ? 'font-medium text-zinc-900 dark:text-zinc-50'
          : 'font-normal text-zinc-500 dark:text-zinc-400';

        return (
          <span
            key={step.index}
            data-step-index={step.index}
            data-current={isCurrent || undefined}
            className={`absolute right-0 bottom-0 left-0 block truncate text-sm leading-5 motion-safe:transition-[transform,opacity] motion-safe:duration-500 motion-safe:ease-out ${colorClass}`}
            style={{
              transform: `translateY(${translateY}px)`,
              opacity,
            }}
          >
            {step.label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Decorative card glyph. Animates a soft pulse while the run is active,
 * snaps static on every terminal state, and switches outline colour to
 * surface error / stall without relying on motion (so users with
 * `prefers-reduced-motion` still get an unambiguous state cue).
 *
 * `aria-hidden` because the run status it represents is already conveyed
 * by the `progressbar` role and the live region (§7.2); doubling up would
 * just spam screen readers.
 */
function FuseIcon({ status }: { status: RunStatus }) {
  const isAnimating = status === 'running';

  const imgClasses = ['h-full', 'w-full', 'object-contain'];
  if (isAnimating) imgClasses.push('motion-safe:animate-pulse');
  if (status === 'idle' || status === 'stalled') imgClasses.push('opacity-60');
  if (status === 'error') imgClasses.push('opacity-70', 'grayscale');

  const ringClass =
    status === 'error'
      ? 'ring-2 ring-red-400/70 dark:ring-red-500/70'
      : status === 'stalled'
        ? 'ring-2 ring-zinc-300/70 dark:ring-zinc-600/70'
        : '';

  return (
    <div
      data-testid="run-progress-icon"
      data-state={status}
      aria-hidden="true"
      className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-lg ${ringClass}`}
    >
      {/* Plain <img>: the asset is small and decorative; bypassing next/image
          keeps the component drop-in friendly for non-Next consumers (per the
          PRD's "standalone reference implementation" framing). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/fuse-icon.png" alt="" className={imgClasses.join(' ')} draggable={false} />
    </div>
  );
}

/**
 * Transform-based fill: the outer element holds the ARIA semantics and the
 * track background; the inner element is `scaleX`d from `0` → `progress` with
 * `transform-origin: left`, which composites on the GPU and avoids re-laying
 * out the rest of the card on every animation frame.
 */
function ProgressBar({
  progress,
  status,
  ariaValueText,
}: {
  progress: number;
  status: RunStatus;
  ariaValueText: string | undefined;
}) {
  const clamped = clamp01(progress);
  const fillBackground = fillBackgroundFor(status);

  return (
    <div
      data-testid="run-progress-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      {...(ariaValueText ? { 'aria-valuetext': ariaValueText } : {})}
      className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
    >
      <div
        data-testid="run-progress-bar-fill"
        className={[
          'h-full w-full origin-left rounded-full will-change-transform',
          // Stalled: subtly pulse the (already desaturated) fill so the
          // viewer reads "we're waiting" rather than "we're done".
          status === 'stalled' ? 'motion-safe:animate-pulse' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          background: fillBackground,
          transform: `scaleX(${clamped})`,
        }}
      />
    </div>
  );
}

function fillBackgroundFor(status: RunStatus): string {
  if (status === 'error') return PROGRESS_ERROR_COLOR;
  if (status === 'stalled') return PROGRESS_STALLED_COLOR;
  const { from, via, to } = PROGRESS_GRADIENT;
  return `linear-gradient(to right, ${from}, ${via}, ${to})`;
}

/**
 * Human-readable `aria-valuetext` for the bar (§7.1).
 *
 * Deliberately a pure function of `(status, step, stepCount)` — it does
 * **not** take `progress` as input. The displayed percentage is conveyed by
 * `aria-valuenow`, which updates every rAF tick; this string updates only
 * when the step index, step label, or run status changes, so screen readers
 * don't get a fresh announcement on every frame.
 */
function ariaValueText(
  status: RunStatus,
  step: StepState | null,
  stepCount: number
): string | undefined {
  if (status === 'idle') return 'Not started';
  if (status === 'complete') return 'Complete';
  if (status === 'error') return `Error${step ? ` on step ${step.index + 1}: ${step.label}` : ''}`;
  if (status === 'stalled')
    return `Waiting for server${step ? ` on step ${step.index + 1} of ${stepCount}: ${step.label}` : ''}`;
  if (step) return `Step ${step.index + 1} of ${stepCount}: ${step.label}`;
  return undefined;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
