/**
 * Wire contract for events streamed from `GET /api/run` to the browser as
 * `text/event-stream` frames. Every frame's `data:` payload is exactly one
 * JSON-serialised {@link RunEvent}.
 *
 * This module is the single source of truth shared between the route handler
 * (server) and the `useRunProgress` hook (client) so both sides stay in sync.
 */

export type RunEventType =
  | 'step_start'
  | 'step_progress'
  | 'step_complete'
  | 'step_error'
  | 'run_complete';

interface RunEventBase {
  /** Unique per stream — lets the client detect re-runs and ignore stale frames. */
  runId: string;
  /** Server-side emit timestamp (ms since epoch). Diagnostic / ordering aid. */
  ts: number;
}

interface StepEventBase extends RunEventBase {
  /** 0-based step index. */
  stepIndex: number;
  /** Total number of steps in the run. Stable across the stream. */
  stepCount: number;
  /** Human-readable label, e.g. `"Analyzing campaigns…"`. */
  label: string;
}

export interface StepStartEvent extends StepEventBase {
  type: 'step_start';
}

export interface StepProgressEvent extends StepEventBase {
  type: 'step_progress';
  /** Within-step progress in `[0, 1]`. */
  progress: number;
}

export interface StepCompleteEvent extends StepEventBase {
  type: 'step_complete';
}

export interface RunErrorPayload {
  message: string;
  code?: string;
}

export interface StepErrorEvent extends StepEventBase {
  type: 'step_error';
  error: RunErrorPayload;
}

export interface RunCompleteEvent extends RunEventBase {
  type: 'run_complete';
  stepCount: number;
}

export type RunEvent =
  | StepStartEvent
  | StepProgressEvent
  | StepCompleteEvent
  | StepErrorEvent
  | RunCompleteEvent;

/**
 * Runtime narrowing for an unknown value parsed off the wire. The SSE transport
 * is just text + `JSON.parse`, so the shape must be validated before reducing.
 */
export function isRunEvent(value: unknown): value is RunEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.runId !== 'string' || typeof v.ts !== 'number') return false;

  switch (v.type) {
    case 'step_start':
    case 'step_complete':
      return (
        typeof v.stepIndex === 'number' &&
        typeof v.stepCount === 'number' &&
        typeof v.label === 'string'
      );
    case 'step_progress':
      return (
        typeof v.stepIndex === 'number' &&
        typeof v.stepCount === 'number' &&
        typeof v.label === 'string' &&
        typeof v.progress === 'number'
      );
    case 'step_error':
      return (
        typeof v.stepIndex === 'number' &&
        typeof v.stepCount === 'number' &&
        typeof v.label === 'string' &&
        isErrorPayload(v.error)
      );
    case 'run_complete':
      return typeof v.stepCount === 'number';
    default:
      return false;
  }
}

function isErrorPayload(value: unknown): value is RunErrorPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.message !== 'string') return false;
  if ('code' in v && typeof v.code !== 'string') return false;
  return true;
}
