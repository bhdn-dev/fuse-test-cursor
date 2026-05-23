'use client';

/**
 * `RunProgressDemo` — wires the data layer (`useRunProgress`), the smoothing
 * engine (`useSmoothProgress`), the elapsed-time hook (`useElapsed`), and the
 * presentational `RunProgress` card together for the demo page (§8).
 *
 * Kept as a separate client component so `src/app/page.tsx` can remain a
 * server component that owns metadata + layout — the React + RSC boundary
 * lives at this file, not at the route.
 *
 * Layout responsibilities:
 *
 * - Stack the card on top of the trigger row.
 * - Surface the currently-selected mode on its button (filled / pressed) so
 *   the user can tell which scenario is in flight.
 * - "Disabled where appropriate" per §8.1: trigger buttons stay enabled so
 *   the user can switch modes mid-run (which {@link useRunProgress.start}
 *   handles by cancelling the prior stream); the Stop/Reset button is
 *   disabled only when there's nothing to clear (`status === 'idle'`).
 *
 * Data-flow responsibilities:
 *
 * - Compute the smoothing **target** as `sum(step.progress) / steps.length`
 *   (matches the README §4.1 contract — per-step progress is already clamped
 *   to `1` on `step_complete` by the reducer).
 * - Re-running mid-flight: `start(mode)` internally `stop()`s any in-flight
 *   stream and dispatches a reset, so clicking another trigger while one is
 *   running cleanly switches scenarios.
 * - Stop / Reset: `reset()` aborts the stream **and** returns the reducer to
 *   `idle` so the bar / step list / timer all clear.
 * - Retry on error: re-runs the last-attempted mode via the same `start()`
 *   path, so the `Retry` button in the error panel does the obvious thing.
 */

import { useMemo, useState } from 'react';

import { RunProgress } from './RunProgress';
import { useElapsed } from '@/lib/run-progress/useElapsed';
import { useRunProgress, type RunMode } from '@/lib/run-progress/useRunProgress';
import { useSmoothProgress } from '@/lib/run-progress/useSmoothProgress';
import type { StepState } from '@/lib/run-progress/state';

interface TriggerSpec {
  mode: RunMode;
  label: string;
  description: string;
}

const TRIGGERS: readonly TriggerSpec[] = [
  { mode: 'happy', label: 'Happy Path', description: 'A full run that succeeds end-to-end.' },
  { mode: 'error', label: 'Error', description: 'Fails on a mid-run step.' },
  { mode: 'stall', label: 'Stall', description: 'Goes silent past the stall timeout.' },
];

export function RunProgressDemo() {
  const { status, steps, currentStepIndex, error, startedAt, endedAt, start, reset } =
    useRunProgress();
  const [lastMode, setLastMode] = useState<RunMode | null>(null);

  const target = useMemo(() => computeTarget(steps), [steps]);
  const progress = useSmoothProgress({ target, status });
  const elapsedMs = useElapsed({ startedAt, endedAt, status });

  const isActive = status === 'running' || status === 'stalled';

  const handleRun = (mode: RunMode): void => {
    setLastMode(mode);
    start(mode);
  };

  const handleReset = (): void => {
    reset();
  };

  return (
    <div className="flex flex-col gap-6">
      <RunProgress
        status={status}
        steps={steps}
        currentStepIndex={currentStepIndex}
        progress={progress}
        elapsedMs={elapsedMs}
        error={error}
        {...(lastMode ? { onRetry: () => start(lastMode) } : {})}
      />

      <div
        aria-label="Run controls"
        className="flex flex-wrap items-center gap-3"
        data-testid="run-controls"
      >
        {TRIGGERS.map((trigger) => (
          <TriggerButton
            key={trigger.mode}
            trigger={trigger}
            running={isActive && lastMode === trigger.mode}
            onClick={() => handleRun(trigger.mode)}
          />
        ))}
        <ResetButton
          disabled={status === 'idle'}
          variant={isActive ? 'stop' : 'reset'}
          onClick={handleReset}
        />
      </div>
    </div>
  );
}

/** Sum of per-step progress / total step slots — README §4.1. */
function computeTarget(steps: readonly StepState[]): number {
  if (steps.length === 0) return 0;
  let sum = 0;
  for (const step of steps) sum += step.progress;
  return sum / steps.length;
}

function TriggerButton({
  trigger,
  running,
  onClick,
}: {
  trigger: TriggerSpec;
  running: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`trigger-${trigger.mode}`}
      data-running={running || undefined}
      aria-pressed={running}
      title={trigger.description}
      className={[
        'inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-sm font-medium',
        'transition-colors focus-visible:ring-2 focus-visible:outline-none',
        'focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
        'dark:focus-visible:ring-offset-zinc-900',
        running
          ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm hover:bg-indigo-600 dark:border-indigo-400 dark:bg-indigo-500 dark:hover:bg-indigo-400'
          : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800',
      ].join(' ')}
    >
      {running ? (
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse"
        />
      ) : null}
      {trigger.label}
    </button>
  );
}

function ResetButton({
  disabled,
  variant,
  onClick,
}: {
  disabled: boolean;
  variant: 'stop' | 'reset';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="trigger-reset"
      data-variant={variant}
      className={[
        'ml-auto inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-sm font-medium',
        'transition-colors focus-visible:ring-2 focus-visible:outline-none',
        'focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
        'dark:focus-visible:ring-offset-zinc-900',
        'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50',
        'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white',
        'dark:disabled:hover:bg-zinc-900',
      ].join(' ')}
    >
      {variant === 'stop' ? 'Stop' : 'Reset'}
    </button>
  );
}
