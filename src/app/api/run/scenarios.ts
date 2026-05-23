/**
 * Mock-server scenarios for `GET /api/run`. Each scenario is an async driver
 * that emits a deterministic sequence of {@link RunEvent}s to the supplied
 * {@link ScenarioContext}.
 *
 * Kept in its own module so the route handler stays a thin transport wrapper
 * and the timings / scripts are easy to unit-test or tweak.
 */

import { DEFAULT_STEP_LABELS } from '@/lib/run-progress/constants';
import type {
  RunCompleteEvent,
  RunEvent,
  StepCompleteEvent,
  StepErrorEvent,
  StepProgressEvent,
  StepStartEvent,
} from '@/lib/run-progress/events';

export const RUN_MODES = ['happy', 'error', 'stall'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export function isRunMode(value: string): value is RunMode {
  return (RUN_MODES as readonly string[]).includes(value);
}

export interface ScenarioContext {
  /** Stable for the lifetime of this stream. Stamped on every emitted event. */
  readonly runId: string;
  /** Aborted when the client disconnects. Scenarios should respect it. */
  readonly signal: AbortSignal;
  /** Push one event to the SSE transport. Silently noop after close/abort. */
  emit(event: RunEvent): void;
  /** Sleep `ms`, rejecting with `AbortError` if the request is aborted. */
  sleep(ms: number): Promise<void>;
  /** Server wall-clock — abstracted so tests can inject a fake. */
  now(): number;
}

interface StepSpec {
  /** Total duration of the step, in ms. */
  durationMs: number;
  /** Override the default label (defaults to {@link DEFAULT_STEP_LABELS}). */
  label?: string;
  /**
   * Fractional checkpoints in `(0, 1)` at which to emit `step_progress`.
   * Example: `[0.25, 0.5, 0.75]` produces three intra-step progress frames.
   */
  progressAt?: readonly number[];
}

/**
 * Drive the requested scenario to completion (or abort). Resolves when the
 * scenario finishes naturally, throws `AbortError` if the client disconnects.
 */
export async function runScenario(mode: RunMode, ctx: ScenarioContext): Promise<void> {
  switch (mode) {
    case 'happy':
      return runHappy(ctx);
    case 'error':
      return runError(ctx);
    case 'stall':
      return runStall(ctx);
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/**
 * 7 steps, ~20s total. Mixes 500ms snaps with multi-second waits and threads
 * `step_progress` events through the two longest steps so the client can
 * exercise mid-step smoothing.
 */
async function runHappy(ctx: ScenarioContext): Promise<void> {
  const steps: StepSpec[] = [
    { durationMs: 500 },
    { durationMs: 8000, progressAt: [0.25, 0.5, 0.75] },
    { durationMs: 1500 },
    { durationMs: 3000, progressAt: [0.5] },
    { durationMs: 5500, progressAt: [0.33, 0.66] },
    { durationMs: 600 },
    { durationMs: 1200 },
  ];
  await runSteps(ctx, steps);
  ctx.emit(buildRunComplete(ctx, steps.length));
}

/**
 * Run two steps cleanly, start a third, emit one mid-step progress frame,
 * then fail with `step_error`. No `run_complete` — terminal error is final.
 */
async function runError(ctx: ScenarioContext): Promise<void> {
  const stepCount = 7;
  await runStep(ctx, { index: 0, stepCount, durationMs: 400 });
  await runStep(ctx, { index: 1, stepCount, durationMs: 1800, progressAt: [0.5] });

  const failingIndex = 2;
  const failingLabel = labelAt(failingIndex);
  ctx.emit(buildStepStart(ctx, failingIndex, stepCount, failingLabel));
  await ctx.sleep(900);
  ctx.emit(buildStepProgress(ctx, failingIndex, stepCount, failingLabel, 0.4));
  await ctx.sleep(700);
  ctx.emit(
    buildStepError(ctx, failingIndex, stepCount, failingLabel, {
      message: `Upstream provider returned 502 while ${failingLabel.replace(/…$/, '').toLowerCase()}.`,
      code: 'UPSTREAM_BAD_GATEWAY',
    })
  );
}

/**
 * Emit a couple of steps normally, then go silent for ~15s while keeping the
 * stream open. That window exceeds `STALL_TIMEOUT_MS` (10s) so the client
 * transitions to `stalled`; the silence eventually ends with a clean close.
 */
async function runStall(ctx: ScenarioContext): Promise<void> {
  const stepCount = 7;
  await runStep(ctx, { index: 0, stepCount, durationMs: 500 });
  await runStep(ctx, { index: 1, stepCount, durationMs: 1200 });

  const hangingIndex = 2;
  const hangingLabel = labelAt(hangingIndex);
  ctx.emit(buildStepStart(ctx, hangingIndex, stepCount, hangingLabel));
  await ctx.sleep(800);
  ctx.emit(buildStepProgress(ctx, hangingIndex, stepCount, hangingLabel, 0.2));

  // Silence window: > STALL_TIMEOUT_MS (10s) so the client trips into
  // `stalled`. We then close cleanly instead of hanging the connection
  // forever, so the test loop / dev server can recycle the socket.
  await ctx.sleep(15_000);
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

async function runSteps(ctx: ScenarioContext, steps: readonly StepSpec[]): Promise<void> {
  for (let index = 0; index < steps.length; index++) {
    const spec = steps[index]!;
    await runStep(ctx, { index, stepCount: steps.length, ...spec });
  }
}

interface RunStepInput extends StepSpec {
  index: number;
  stepCount: number;
}

async function runStep(ctx: ScenarioContext, input: RunStepInput): Promise<void> {
  const { index, stepCount, durationMs, progressAt } = input;
  const label = input.label ?? labelAt(index);

  ctx.emit(buildStepStart(ctx, index, stepCount, label));

  if (progressAt && progressAt.length > 0) {
    const checkpoints = [...progressAt].sort((a, b) => a - b);
    let elapsed = 0;
    for (const p of checkpoints) {
      const clamped = Math.min(0.999, Math.max(0, p));
      const target = Math.round(durationMs * clamped);
      const wait = Math.max(0, target - elapsed);
      if (wait > 0) await ctx.sleep(wait);
      elapsed = target;
      ctx.emit(buildStepProgress(ctx, index, stepCount, label, clamped));
    }
    const remaining = Math.max(0, durationMs - elapsed);
    if (remaining > 0) await ctx.sleep(remaining);
  } else {
    await ctx.sleep(durationMs);
  }

  ctx.emit(buildStepComplete(ctx, index, stepCount, label));
}

function labelAt(index: number): string {
  return DEFAULT_STEP_LABELS[index] ?? `Step ${index + 1}`;
}

// ---------------------------------------------------------------------------
// Event builders — centralised so every event gets `runId` + `ts` consistently
// ---------------------------------------------------------------------------

function buildStepStart(
  ctx: ScenarioContext,
  stepIndex: number,
  stepCount: number,
  label: string
): StepStartEvent {
  return { type: 'step_start', runId: ctx.runId, ts: ctx.now(), stepIndex, stepCount, label };
}

function buildStepProgress(
  ctx: ScenarioContext,
  stepIndex: number,
  stepCount: number,
  label: string,
  progress: number
): StepProgressEvent {
  return {
    type: 'step_progress',
    runId: ctx.runId,
    ts: ctx.now(),
    stepIndex,
    stepCount,
    label,
    progress,
  };
}

function buildStepComplete(
  ctx: ScenarioContext,
  stepIndex: number,
  stepCount: number,
  label: string
): StepCompleteEvent {
  return {
    type: 'step_complete',
    runId: ctx.runId,
    ts: ctx.now(),
    stepIndex,
    stepCount,
    label,
  };
}

function buildStepError(
  ctx: ScenarioContext,
  stepIndex: number,
  stepCount: number,
  label: string,
  error: { message: string; code?: string }
): StepErrorEvent {
  const payload: StepErrorEvent['error'] =
    error.code !== undefined
      ? { message: error.message, code: error.code }
      : { message: error.message };
  return {
    type: 'step_error',
    runId: ctx.runId,
    ts: ctx.now(),
    stepIndex,
    stepCount,
    label,
    error: payload,
  };
}

function buildRunComplete(ctx: ScenarioContext, stepCount: number): RunCompleteEvent {
  return { type: 'run_complete', runId: ctx.runId, ts: ctx.now(), stepCount };
}
