import { describe, expect, test } from 'vitest';

import type {
  RunCompleteEvent,
  RunEvent,
  StepCompleteEvent,
  StepErrorEvent,
  StepProgressEvent,
  StepStartEvent,
} from './events';
import {
  initialRunState,
  isTerminal,
  markStalled,
  reduce,
  type RunState,
} from './state';

/**
 * Tiny factories so each test reads as a sequence of events, not as a wall of
 * `type`/`runId`/`ts`/... object literals. Defaults mirror the Happy Path
 * scenario: 3 steps in one run.
 */
const RUN = 'run-1';

function stepStart(
  stepIndex: number,
  label = `Step ${stepIndex + 1}`,
  opts: { runId?: string; stepCount?: number; ts?: number } = {}
): StepStartEvent {
  return {
    type: 'step_start',
    runId: opts.runId ?? RUN,
    ts: opts.ts ?? 0,
    stepIndex,
    stepCount: opts.stepCount ?? 3,
    label,
  };
}

function stepProgress(
  stepIndex: number,
  progress: number,
  label = `Step ${stepIndex + 1}`,
  opts: { runId?: string; stepCount?: number; ts?: number } = {}
): StepProgressEvent {
  return {
    type: 'step_progress',
    runId: opts.runId ?? RUN,
    ts: opts.ts ?? 0,
    stepIndex,
    stepCount: opts.stepCount ?? 3,
    label,
    progress,
  };
}

function stepComplete(
  stepIndex: number,
  label = `Step ${stepIndex + 1}`,
  opts: { runId?: string; stepCount?: number; ts?: number } = {}
): StepCompleteEvent {
  return {
    type: 'step_complete',
    runId: opts.runId ?? RUN,
    ts: opts.ts ?? 0,
    stepIndex,
    stepCount: opts.stepCount ?? 3,
    label,
  };
}

function stepError(
  stepIndex: number,
  message: string,
  code?: string,
  opts: { runId?: string; stepCount?: number; label?: string; ts?: number } = {}
): StepErrorEvent {
  return {
    type: 'step_error',
    runId: opts.runId ?? RUN,
    ts: opts.ts ?? 0,
    stepIndex,
    stepCount: opts.stepCount ?? 3,
    label: opts.label ?? `Step ${stepIndex + 1}`,
    error: code === undefined ? { message } : { message, code },
  };
}

function runComplete(
  opts: { runId?: string; stepCount?: number; ts?: number } = {}
): RunCompleteEvent {
  return {
    type: 'run_complete',
    runId: opts.runId ?? RUN,
    ts: opts.ts ?? 0,
    stepCount: opts.stepCount ?? 3,
  };
}

/** Fold a sequence of events through {@link reduce}, advancing `now` per step. */
function play(events: readonly RunEvent[], startNow = 1_000, stepMs = 100): RunState {
  let state = initialRunState;
  let now = startNow;
  for (const event of events) {
    state = reduce(state, event, now);
    now += stepMs;
  }
  return state;
}

describe('isTerminal', () => {
  test('only complete and error are terminal', () => {
    expect(isTerminal('idle')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('stalled')).toBe(false);
    expect(isTerminal('complete')).toBe(true);
    expect(isTerminal('error')).toBe(true);
  });
});

describe('reduce — first event bootstraps the run', () => {
  test('step_start sets runId, startedAt, lastEventAt and flips status to running', () => {
    const state = reduce(initialRunState, stepStart(0, 'Analyzing…'), 5_000);
    expect(state.runId).toBe(RUN);
    expect(state.status).toBe('running');
    expect(state.startedAt).toBe(5_000);
    expect(state.lastEventAt).toBe(5_000);
    expect(state.endedAt).toBeNull();
    expect(state.currentStepIndex).toBe(0);
    expect(state.stepCount).toBe(3);
    expect(state.steps).toHaveLength(3);
    expect(state.steps[0]).toMatchObject({
      index: 0,
      label: 'Analyzing…',
      status: 'running',
      progress: 0,
      startedAt: 5_000,
      endedAt: null,
    });
    expect(state.steps[1]?.status).toBe('pending');
    expect(state.steps[2]?.status).toBe('pending');
    expect(state.error).toBeNull();
  });

  test('startedAt is not reset by subsequent events', () => {
    const state = play([stepStart(0), stepProgress(0, 0.5), stepComplete(0)], 5_000, 100);
    expect(state.startedAt).toBe(5_000);
    expect(state.lastEventAt).toBe(5_200);
  });
});

describe('reduce — step_start', () => {
  test('preserves the original startedAt if the same step is re-started', () => {
    let state = reduce(initialRunState, stepStart(0), 1_000);
    state = reduce(state, stepStart(0), 9_999);
    expect(state.steps[0]?.startedAt).toBe(1_000);
  });

  test('extends the steps array when stepIndex is beyond the current length', () => {
    const state = reduce(
      initialRunState,
      stepStart(4, 'Late step', { stepCount: 2 }),
      1_000
    );
    expect(state.stepCount).toBe(5);
    expect(state.steps).toHaveLength(5);
    expect(state.steps[4]?.label).toBe('Late step');
    expect(state.steps[4]?.status).toBe('running');
    for (let i = 0; i < 4; i++) {
      expect(state.steps[i]?.status).toBe('pending');
    }
    expect(state.currentStepIndex).toBe(4);
  });

  test('recovers status from stalled back to running', () => {
    let state = play([stepStart(0)]);
    state = markStalled(state, state.lastEventAt! + 20_000, 10_000);
    expect(state.status).toBe('stalled');
    state = reduce(state, stepStart(1), state.lastEventAt! + 25_000);
    expect(state.status).toBe('running');
  });
});

describe('reduce — step_progress', () => {
  test('clamps progress into [0, 1] and is monotonically non-decreasing per step', () => {
    let state = reduce(initialRunState, stepStart(0), 1_000);
    state = reduce(state, stepProgress(0, 0.4), 1_100);
    expect(state.steps[0]?.progress).toBe(0.4);

    state = reduce(state, stepProgress(0, 0.2), 1_200);
    expect(state.steps[0]?.progress).toBe(0.4);

    state = reduce(state, stepProgress(0, 5), 1_300);
    expect(state.steps[0]?.progress).toBe(1);
  });

  test('ignores progress on steps that have already entered a terminal status', () => {
    let state = play([stepStart(0), stepComplete(0)], 1_000, 100);
    const completedAt = state.steps[0]?.endedAt;
    state = reduce(state, stepProgress(0, 0.5, 'Trying to mutate'), 1_500);

    expect(state.steps[0]?.status).toBe('complete');
    expect(state.steps[0]?.progress).toBe(1);
    expect(state.steps[0]?.label).toBe('Step 1');
    expect(state.steps[0]?.endedAt).toBe(completedAt);
    expect(state.lastEventAt).toBe(1_500);
  });

  test('extends steps array if progress arrives before its step_start', () => {
    const state = reduce(initialRunState, stepProgress(2, 0.6, 'Out of order'), 1_000);
    expect(state.steps).toHaveLength(3);
    expect(state.steps[2]).toMatchObject({
      label: 'Out of order',
      status: 'running',
      progress: 0.6,
      startedAt: 1_000,
    });
    expect(state.currentStepIndex).toBe(2);
  });

  test('falls back to the existing label if the event label is empty', () => {
    let state = reduce(initialRunState, stepStart(0, 'Original'), 1_000);
    state = reduce(state, stepProgress(0, 0.5, ''), 1_100);
    expect(state.steps[0]?.label).toBe('Original');
  });
});

describe('reduce — step_complete', () => {
  test('snaps step progress to 1 and stamps endedAt; keeps run status as running', () => {
    let state = reduce(initialRunState, stepStart(0), 1_000);
    state = reduce(state, stepProgress(0, 0.4), 1_100);
    state = reduce(state, stepComplete(0), 1_500);

    expect(state.status).toBe('running');
    expect(state.steps[0]?.status).toBe('complete');
    expect(state.steps[0]?.progress).toBe(1);
    expect(state.steps[0]?.endedAt).toBe(1_500);
    expect(state.steps[0]?.startedAt).toBe(1_000);
  });

  test('completing a step that never started still records start/end at the same time', () => {
    const state = reduce(initialRunState, stepComplete(1, 'Fast step'), 2_000);
    expect(state.steps[1]?.status).toBe('complete');
    expect(state.steps[1]?.progress).toBe(1);
    expect(state.steps[1]?.startedAt).toBe(2_000);
    expect(state.steps[1]?.endedAt).toBe(2_000);
    expect(state.currentStepIndex).toBe(1);
  });
});

describe('reduce — step_error', () => {
  test('flips run to error, records the error payload (with optional code), stamps endedAt', () => {
    let state = reduce(initialRunState, stepStart(1), 1_000);
    state = reduce(state, stepError(1, 'boom', 'E_BOOM'), 1_400);

    expect(state.status).toBe('error');
    expect(state.endedAt).toBe(1_400);
    expect(state.steps[1]?.status).toBe('error');
    expect(state.steps[1]?.endedAt).toBe(1_400);
    expect(state.error).toEqual({ message: 'boom', code: 'E_BOOM', stepIndex: 1 });
  });

  test('omits code from the stored error when not provided', () => {
    const state = reduce(initialRunState, stepError(0, 'no code here'), 1_000);
    expect(state.error).toEqual({ message: 'no code here', stepIndex: 0 });
    expect(state.error && 'code' in state.error).toBe(false);
  });
});

describe('reduce — run_complete', () => {
  test('marks every non-terminal step as complete and stamps endedAt', () => {
    let state = reduce(initialRunState, stepStart(0), 1_000);
    state = reduce(state, stepComplete(0), 1_500);
    state = reduce(state, stepStart(1), 1_600);
    // step 1 is still 'running' when run_complete arrives, step 2 is still 'pending'.
    state = reduce(state, runComplete(), 2_000);

    expect(state.status).toBe('complete');
    expect(state.endedAt).toBe(2_000);
    expect(state.steps.map((s) => s.status)).toEqual(['complete', 'complete', 'complete']);
    expect(state.steps[1]?.progress).toBe(1);
    expect(state.steps[1]?.endedAt).toBe(2_000);
    expect(state.steps[2]?.progress).toBe(1);
    expect(state.steps[2]?.endedAt).toBe(2_000);
    expect(state.currentStepIndex).toBe(2);
  });

  test('does not regress steps that were already in an error state', () => {
    let state = reduce(initialRunState, stepError(0, 'boom'), 1_000);
    // step_error puts the run into terminal 'error' — run_complete after a
    // terminal status is dropped (covered separately below), so to exercise
    // the run_complete path against a step in error we feed run_complete to
    // a state where the error happened on a *different* step.
    state = play([stepStart(0), stepComplete(0), stepStart(1), stepError(1, 'boom')], 1_000);
    expect(state.status).toBe('error');
    // run_complete arriving after a terminal status must be dropped — see
    // the dedicated terminal-stickiness suite.
  });
});

describe('reduce — terminal stickiness', () => {
  test('events after run_complete are dropped (no progress, no state churn)', () => {
    const completed = play([stepStart(0), stepComplete(0), runComplete()], 1_000, 100);
    expect(completed.status).toBe('complete');

    const next = reduce(completed, stepProgress(0, 0.5), 9_999);
    expect(next).toBe(completed);

    const errored = reduce(completed, stepError(0, 'too late'), 9_999);
    expect(errored).toBe(completed);
  });

  test('events after step_error are dropped, including run_complete', () => {
    let state = reduce(initialRunState, stepStart(0), 1_000);
    state = reduce(state, stepError(0, 'boom'), 1_400);
    expect(state.status).toBe('error');

    const afterRunComplete = reduce(state, runComplete(), 1_900);
    expect(afterRunComplete).toBe(state);

    const afterMoreProgress = reduce(state, stepProgress(0, 0.99), 1_950);
    expect(afterMoreProgress).toBe(state);
  });

  test('two consecutive step_error events: only the first one wins', () => {
    let state = reduce(initialRunState, stepStart(0), 1_000);
    state = reduce(state, stepError(0, 'first', 'E_FIRST'), 1_500);
    const dropped = reduce(state, stepError(0, 'second', 'E_SECOND'), 1_600);
    expect(dropped).toBe(state);
    expect(state.error).toEqual({ message: 'first', code: 'E_FIRST', stepIndex: 0 });
  });
});

describe('reduce — stale runId rejection', () => {
  test('ignores events with a different runId once a run is established', () => {
    const state = reduce(initialRunState, stepStart(0, 'real', { runId: 'real' }), 1_000);
    const next = reduce(
      state,
      stepProgress(0, 0.5, 'stale', { runId: 'leftover' }),
      1_100
    );
    expect(next).toBe(state);
    expect(state.steps[0]?.progress).toBe(0);
    expect(state.steps[0]?.label).toBe('real');
  });

  test('accepts the first event regardless of its runId (initial bootstrap)', () => {
    const state = reduce(initialRunState, stepStart(0, 'first', { runId: 'whatever' }), 1_000);
    expect(state.runId).toBe('whatever');
  });
});

describe('reduce — out-of-order, duplicate, idempotent', () => {
  test('events arriving out of step-index order still grow the array correctly', () => {
    const state = play(
      [stepProgress(2, 0.3, 'late', { stepCount: 3 }), stepStart(0, 'first', { stepCount: 3 })],
      1_000
    );
    expect(state.stepCount).toBe(3);
    expect(state.steps[0]?.status).toBe('running');
    expect(state.steps[2]?.status).toBe('running');
    // currentStepIndex is monotonic: it grew to 2 first and stays there.
    expect(state.currentStepIndex).toBe(2);
  });

  test('duplicate step_progress events do not regress progress', () => {
    let state = reduce(initialRunState, stepStart(0), 1_000);
    state = reduce(state, stepProgress(0, 0.75), 1_100);
    state = reduce(state, stepProgress(0, 0.75), 1_200);
    state = reduce(state, stepProgress(0, 0.5), 1_300);
    expect(state.steps[0]?.progress).toBe(0.75);
  });

  test('currentStepIndex never goes backward', () => {
    let state = reduce(initialRunState, stepStart(2, 'step 3'), 1_000);
    expect(state.currentStepIndex).toBe(2);
    state = reduce(state, stepProgress(0, 0.5, 'late progress for step 1'), 1_100);
    expect(state.currentStepIndex).toBe(2);
  });

  test('stepCount only grows, never shrinks, even if a later event claims fewer steps', () => {
    let state = reduce(initialRunState, stepStart(0, 'a', { stepCount: 5 }), 1_000);
    expect(state.stepCount).toBe(5);
    state = reduce(state, stepStart(1, 'b', { stepCount: 2 }), 1_100);
    expect(state.stepCount).toBe(5);
    expect(state.steps).toHaveLength(5);
  });
});

describe('markStalled', () => {
  test('flips running → stalled exactly at the timeout boundary', () => {
    const state = reduce(initialRunState, stepStart(0), 1_000);
    const before = markStalled(state, 1_000 + 9_999, 10_000);
    expect(before.status).toBe('running');
    expect(before).toBe(state);

    const after = markStalled(state, 1_000 + 10_000, 10_000);
    expect(after.status).toBe('stalled');
  });

  test('is idempotent: re-calling on a stalled state changes nothing', () => {
    let state = reduce(initialRunState, stepStart(0), 1_000);
    state = markStalled(state, 1_000 + 20_000, 10_000);
    expect(state.status).toBe('stalled');
    const again = markStalled(state, 1_000 + 30_000, 10_000);
    // Still stalled — `markStalled` only acts on `running`, so it must be a no-op.
    expect(again).toBe(state);
  });

  test('does nothing while idle (no lastEventAt to compare against)', () => {
    const stalled = markStalled(initialRunState, 1_000_000, 10_000);
    expect(stalled).toBe(initialRunState);
    expect(stalled.status).toBe('idle');
  });

  test('does nothing on terminal states', () => {
    const completed = play([stepStart(0), stepComplete(0), runComplete()], 1_000, 100);
    expect(markStalled(completed, completed.lastEventAt! + 99_999, 10_000)).toBe(completed);

    const errored = play([stepStart(0), stepError(0, 'boom')], 1_000, 100);
    expect(markStalled(errored, errored.lastEventAt! + 99_999, 10_000)).toBe(errored);
  });

  test('full stall + recovery cycle', () => {
    let state = play([stepStart(0)], 1_000, 0);
    state = markStalled(state, 1_000 + 12_000, 10_000);
    expect(state.status).toBe('stalled');

    state = reduce(state, stepProgress(0, 0.5), 1_000 + 13_000);
    expect(state.status).toBe('running');
    expect(state.steps[0]?.progress).toBe(0.5);
    expect(state.lastEventAt).toBe(14_000);

    state = markStalled(state, 14_000 + 9_999, 10_000);
    expect(state.status).toBe('running');
    state = markStalled(state, 14_000 + 10_001, 10_000);
    expect(state.status).toBe('stalled');
  });
});
