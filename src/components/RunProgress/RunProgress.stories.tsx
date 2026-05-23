import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useMemo, useState } from 'react';

import { RunProgress, type RunProgressProps } from './RunProgress';
import type { RunError, StepState } from '@/lib/run-progress/state';
import { useElapsed } from '@/lib/run-progress/useElapsed';
import { useRunProgress, type RunMode } from '@/lib/run-progress/useRunProgress';
import { useSmoothProgress } from '@/lib/run-progress/useSmoothProgress';

/**
 * Stories cover the five states the component must render (§9.2) plus a
 * `Live` story that drives the real `useRunProgress` hook against the mock
 * SSE endpoint (§9.3). The static stories pass shaped `StepState[]` fixtures
 * so reviewers can scrub `progress` / `elapsedMs` via Storybook controls
 * without spinning up the full data pipeline.
 *
 * Fixtures use the default labels from `constants.DEFAULT_STEP_LABELS` so the
 * stories visually match the demo page.
 */

function completedStep(
  index: number,
  label: string,
  startedAt: number,
  endedAt: number
): StepState {
  return { index, label, status: 'complete', progress: 1, startedAt, endedAt };
}

function runningStep(index: number, label: string, progress: number, startedAt: number): StepState {
  return { index, label, status: 'running', progress, startedAt, endedAt: null };
}

function pendingStep(index: number, label: string): StepState {
  return { index, label, status: 'pending', progress: 0, startedAt: null, endedAt: null };
}

function erroredStep(index: number, label: string, startedAt: number, endedAt: number): StepState {
  return { index, label, status: 'error', progress: 0.5, startedAt, endedAt };
}

const runningFixture: readonly StepState[] = [
  completedStep(0, 'Analyzing campaigns…', 0, 2_400),
  completedStep(1, 'Reading metrics…', 2_400, 5_900),
  runningStep(2, 'Contacting API…', 0.55, 5_900),
  pendingStep(3, 'Scoring audiences…'),
  pendingStep(4, 'Generating creative variants…'),
  pendingStep(5, 'Processing results…'),
  pendingStep(6, 'Finalising report…'),
];

const completeFixture: readonly StepState[] = [
  completedStep(0, 'Analyzing campaigns…', 0, 2_400),
  completedStep(1, 'Reading metrics…', 2_400, 5_900),
  completedStep(2, 'Contacting API…', 5_900, 11_200),
  completedStep(3, 'Scoring audiences…', 11_200, 15_400),
  completedStep(4, 'Generating creative variants…', 15_400, 22_100),
  completedStep(5, 'Processing results…', 22_100, 27_300),
  completedStep(6, 'Finalising report…', 27_300, 30_050),
];

const errorFixture: readonly StepState[] = [
  completedStep(0, 'Analyzing campaigns…', 0, 2_400),
  completedStep(1, 'Reading metrics…', 2_400, 5_900),
  erroredStep(2, 'Contacting API…', 5_900, 8_400),
  pendingStep(3, 'Scoring audiences…'),
  pendingStep(4, 'Generating creative variants…'),
  pendingStep(5, 'Processing results…'),
  pendingStep(6, 'Finalising report…'),
];

const stalledFixture: readonly StepState[] = runningFixture;

const errorPayload: RunError = {
  message: 'Upstream timeout while calling campaigns API',
  code: 'E_UPSTREAM_TIMEOUT',
  stepIndex: 2,
};

const meta: Meta<typeof RunProgress> = {
  title: 'RunProgress/RunProgress',
  component: RunProgress,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-2xl bg-transparent p-6">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    status: {
      control: { type: 'select' },
      options: ['idle', 'running', 'complete', 'error', 'stalled'],
    },
    progress: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
      description: 'Smoothed bar progress in [0, 1] — normally fed by `useSmoothProgress`.',
    },
    elapsedMs: {
      control: { type: 'number', min: 0, step: 100 },
      description: 'Elapsed ms since the first event — normally fed by `useElapsed`.',
    },
    currentStepIndex: {
      control: { type: 'number', min: -1, step: 1 },
    },
    steps: { control: false },
    error: { control: false },
    onRetry: { control: false },
    className: { control: false },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: {
    status: 'idle',
    steps: [],
    currentStepIndex: -1,
    progress: 0,
    elapsedMs: 0,
  },
};

export const Running: Story = {
  args: {
    status: 'running',
    steps: runningFixture,
    currentStepIndex: 2,
    // Two of seven steps complete + ~half of the third → ~0.36.
    progress: 0.36,
    elapsedMs: 8_420,
  },
};

export const Complete: Story = {
  args: {
    status: 'complete',
    steps: completeFixture,
    currentStepIndex: completeFixture.length - 1,
    progress: 1,
    elapsedMs: 30_050,
  },
};

export const Errored: Story = {
  name: 'Error',
  args: {
    status: 'error',
    steps: errorFixture,
    currentStepIndex: 2,
    // Two of seven steps complete → ~0.29 before the third errored mid-flight.
    progress: 0.29,
    elapsedMs: 8_400,
    error: errorPayload,
  },
  render: (args) => <RunProgressWithRetry {...args} />,
};

export const Stalled: Story = {
  args: {
    status: 'stalled',
    steps: stalledFixture,
    currentStepIndex: 2,
    progress: 0.36,
    elapsedMs: 8_420,
  },
};

/**
 * Renders the `Errored` story with a no-op `Retry` button so the consumer
 * surface (button + the wired handler) is visible without baking a function
 * into the static `args` (Storybook controls don't round-trip functions
 * cleanly).
 */
function RunProgressWithRetry(props: RunProgressProps) {
  const [retryCount, setRetryCount] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      <RunProgress {...props} onRetry={() => setRetryCount((n) => n + 1)} />
      {retryCount > 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Retry pressed {retryCount} {retryCount === 1 ? 'time' : 'times'}.
        </p>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Live story (§9.3)
 *
 * Drives the *real* `useRunProgress` hook against the mock SSE endpoint, with
 * a Storybook control to pick the scenario. Requires `npm run dev` running
 * alongside `npm run storybook` — `/api/*` is proxied to `localhost:3000` via
 * `.storybook/main.ts`'s `viteFinal`.
 * ────────────────────────────────────────────────────────────────────────── */

interface LiveArgs {
  mode: RunMode;
}

const liveMeta: Meta<LiveArgs> = {
  title: 'RunProgress/Live',
  argTypes: {
    mode: {
      control: { type: 'select' },
      options: ['happy', 'error', 'stall'] satisfies RunMode[],
      description: 'Scenario served by the mock SSE endpoint (`/api/run?mode=…`).',
    },
  },
};

export const Live: StoryObj<LiveArgs> = {
  ...liveMeta,
  args: { mode: 'happy' },
  parameters: {
    docs: {
      description: {
        story: [
          'Connects to the live SSE endpoint at `/api/run` using `useRunProgress`,',
          '`useSmoothProgress`, and `useElapsed` — exactly the wiring the demo page',
          'uses. Pick a `mode` and press **Start** to drive the card.',
          '',
          '**Note:** requires `npm run dev` to be running so `/api/run` exists.',
          'Storybook proxies `/api` → `http://localhost:3000` via `viteFinal`.',
        ].join(' '),
      },
    },
  },
  render: (args) => <LiveStory mode={args.mode} />,
};

/**
 * Wrapper that owns the hook lifecycle for the Live story. Renders the same
 * card the demo page does (`RunProgress` + a trigger row), but exposes the
 * scenario via a Storybook control rather than three buttons.
 *
 * - `mode` arg is the source of truth; clicking **Start** runs whichever
 *   scenario is currently selected, so reviewers can flip the control and
 *   immediately re-trigger.
 * - `Stop / Reset` mirrors the demo: aborts the in-flight stream and clears
 *   the reducer back to `idle`.
 */
function LiveStory({ mode }: { mode: RunMode }) {
  const { status, steps, currentStepIndex, error, startedAt, endedAt, start, reset } =
    useRunProgress();

  const target = useMemo(() => {
    if (steps.length === 0) return 0;
    let sum = 0;
    for (const step of steps) sum += step.progress;
    return sum / steps.length;
  }, [steps]);

  const progress = useSmoothProgress({ target, status });
  const elapsedMs = useElapsed({ startedAt, endedAt, status });

  const isActive = status === 'running' || status === 'stalled';

  return (
    <div className="flex flex-col gap-4">
      <RunProgress
        status={status}
        steps={steps}
        currentStepIndex={currentStepIndex}
        progress={progress}
        elapsedMs={elapsedMs}
        error={error}
        onRetry={() => start(mode)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => start(mode)}
          className="inline-flex items-center gap-2 rounded-md border border-indigo-500 bg-indigo-500 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-indigo-400"
        >
          {isActive ? 'Restart' : 'Start'} — mode: {mode}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={status === 'idle'}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {isActive ? 'Stop' : 'Reset'}
        </button>
      </div>
    </div>
  );
}
