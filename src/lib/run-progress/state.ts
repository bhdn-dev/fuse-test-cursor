import type { RunErrorPayload, RunEvent } from './events';

/**
 * Coarse run-level status surfaced to the UI. `stalled` is a recoverable
 * sub-state of `running` triggered by the absence of events for too long.
 */
export type RunStatus = 'idle' | 'running' | 'complete' | 'error' | 'stalled';

export type StepStatus = 'pending' | 'running' | 'complete' | 'error';

export interface StepState {
  index: number;
  label: string;
  status: StepStatus;
  /** Within-step progress in `[0, 1]`. Forced to `1` once `status === 'complete'`. */
  progress: number;
  /** Client wall-clock time the step entered `running`. */
  startedAt: number | null;
  /** Client wall-clock time the step entered a terminal status. */
  endedAt: number | null;
}

export interface RunError extends RunErrorPayload {
  /** Step the error originated from, for badge placement in the UI. */
  stepIndex: number;
}

export interface RunState {
  runId: string | null;
  status: RunStatus;
  stepCount: number;
  steps: StepState[];
  /** Index of the step currently `running` (or last touched). `-1` while idle. */
  currentStepIndex: number;
  /** Client wall-clock time of the first event received — drives the timer. */
  startedAt: number | null;
  /** Client wall-clock time the run reached a terminal state. */
  endedAt: number | null;
  /** Client wall-clock time of the most recent event — drives stall detection. */
  lastEventAt: number | null;
  error: RunError | null;
}

export const initialRunState: RunState = {
  runId: null,
  status: 'idle',
  stepCount: 0,
  steps: [],
  currentStepIndex: -1,
  startedAt: null,
  endedAt: null,
  lastEventAt: null,
  error: null,
};

const TERMINAL: ReadonlySet<RunStatus> = new Set(['complete', 'error']);

/** `true` if `status` is `complete` / `error` — the run will not progress further. */
export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

function makePending(index: number): StepState {
  return {
    index,
    label: '',
    status: 'pending',
    progress: 0,
    startedAt: null,
    endedAt: null,
  };
}

/** Lazily grow the `steps` array so any event index up to `stepCount - 1` is addressable. */
function ensureSteps(steps: StepState[], stepCount: number): StepState[] {
  if (steps.length >= stepCount) return steps;
  const next = steps.slice();
  for (let i = steps.length; i < stepCount; i++) {
    next.push(makePending(i));
  }
  return next;
}

function patchStep(steps: StepState[], index: number, patch: Partial<StepState>): StepState[] {
  const target = steps[index];
  if (!target) return steps;
  const next = steps.slice();
  next[index] = { ...target, ...patch };
  return next;
}

/**
 * Pure reducer: applies one {@link RunEvent} to a {@link RunState} and returns
 * the next state. `now` is the client wall-clock time the event was received,
 * passed in so tests can use a fake clock and so SSR never reads `Date.now()`.
 *
 * Tolerates messy streams:
 * - events arriving after `complete` / `error` are dropped (terminal sticks),
 * - any event in `stalled` recovers status back to `running`,
 * - step indices beyond `steps.length` extend the array with `pending` slots,
 * - events from a different `runId` are ignored (stale stream).
 */
export function reduce(state: RunState, event: RunEvent, now: number): RunState {
  if (isTerminal(state.status)) return state;
  if (state.runId !== null && state.runId !== event.runId) return state;

  const runId = state.runId ?? event.runId;
  const startedAt = state.startedAt ?? now;
  const lastEventAt = now;

  switch (event.type) {
    case 'step_start': {
      const stepCount = Math.max(state.stepCount, event.stepCount, event.stepIndex + 1);
      const ensured = ensureSteps(state.steps, stepCount);
      const target = ensured[event.stepIndex];
      const steps = patchStep(ensured, event.stepIndex, {
        label: event.label,
        status: 'running',
        progress: 0,
        startedAt: target?.startedAt ?? now,
        endedAt: null,
      });
      return {
        ...state,
        runId,
        status: 'running',
        stepCount,
        steps,
        currentStepIndex: Math.max(state.currentStepIndex, event.stepIndex),
        startedAt,
        lastEventAt,
      };
    }

    case 'step_progress': {
      const stepCount = Math.max(state.stepCount, event.stepCount, event.stepIndex + 1);
      const ensured = ensureSteps(state.steps, stepCount);
      const target = ensured[event.stepIndex];
      if (!target || target.status === 'complete' || target.status === 'error') {
        return { ...state, runId, status: 'running', stepCount, startedAt, lastEventAt };
      }
      const nextProgress = Math.min(1, Math.max(target.progress, event.progress));
      const steps = patchStep(ensured, event.stepIndex, {
        label: event.label || target.label,
        status: 'running',
        progress: nextProgress,
        startedAt: target.startedAt ?? now,
      });
      return {
        ...state,
        runId,
        status: 'running',
        stepCount,
        steps,
        currentStepIndex: Math.max(state.currentStepIndex, event.stepIndex),
        startedAt,
        lastEventAt,
      };
    }

    case 'step_complete': {
      const stepCount = Math.max(state.stepCount, event.stepCount, event.stepIndex + 1);
      const ensured = ensureSteps(state.steps, stepCount);
      const target = ensured[event.stepIndex];
      const steps = patchStep(ensured, event.stepIndex, {
        label: event.label || target?.label || '',
        status: 'complete',
        progress: 1,
        startedAt: target?.startedAt ?? now,
        endedAt: now,
      });
      return {
        ...state,
        runId,
        status: 'running',
        stepCount,
        steps,
        currentStepIndex: Math.max(state.currentStepIndex, event.stepIndex),
        startedAt,
        lastEventAt,
      };
    }

    case 'step_error': {
      const stepCount = Math.max(state.stepCount, event.stepCount, event.stepIndex + 1);
      const ensured = ensureSteps(state.steps, stepCount);
      const target = ensured[event.stepIndex];
      const steps = patchStep(ensured, event.stepIndex, {
        label: event.label || target?.label || '',
        status: 'error',
        startedAt: target?.startedAt ?? now,
        endedAt: now,
      });
      const error: RunError = { message: event.error.message, stepIndex: event.stepIndex };
      if (event.error.code !== undefined) error.code = event.error.code;
      return {
        ...state,
        runId,
        status: 'error',
        stepCount,
        steps,
        currentStepIndex: Math.max(state.currentStepIndex, event.stepIndex),
        startedAt,
        endedAt: now,
        lastEventAt,
        error,
      };
    }

    case 'run_complete': {
      const stepCount = Math.max(state.stepCount, event.stepCount);
      const ensured = ensureSteps(state.steps, stepCount);
      const steps = ensured.map((s) =>
        s.status === 'pending' || s.status === 'running'
          ? { ...s, status: 'complete' as const, progress: 1, endedAt: now }
          : s
      );
      return {
        ...state,
        runId,
        status: 'complete',
        stepCount,
        steps,
        currentStepIndex: Math.max(state.currentStepIndex, stepCount - 1),
        startedAt,
        endedAt: now,
        lastEventAt,
      };
    }

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Transition `running` → `stalled` when `now - lastEventAt >= timeoutMs`.
 * Pure: the caller (the rAF stall loop in §3.3) decides when to invoke it.
 * Recovery back to `running` happens automatically inside {@link reduce} on
 * the next event.
 */
export function markStalled(state: RunState, now: number, timeoutMs: number): RunState {
  if (state.status !== 'running') return state;
  if (state.lastEventAt === null) return state;
  if (now - state.lastEventAt < timeoutMs) return state;
  return { ...state, status: 'stalled' };
}
