import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { RunProgress } from './RunProgress';
import type { RunError, RunStatus, StepState } from '@/lib/run-progress/state';

function makeSteps(): StepState[] {
  return [
    {
      index: 0,
      label: 'Analyzing campaigns…',
      status: 'complete',
      progress: 1,
      startedAt: 0,
      endedAt: 1000,
    },
    {
      index: 1,
      label: 'Reading metrics…',
      status: 'running',
      progress: 0.4,
      startedAt: 1000,
      endedAt: null,
    },
    {
      index: 2,
      label: 'Contacting API…',
      status: 'pending',
      progress: 0,
      startedAt: null,
      endedAt: null,
    },
  ];
}

function baseProps(status: RunStatus) {
  const steps = makeSteps();
  return {
    status,
    steps,
    currentStepIndex: status === 'idle' ? -1 : 1,
    progress: 0.45,
    elapsedMs: 12_340,
  } as const;
}

describe('RunProgress — renders in all five states', () => {
  test('idle', () => {
    render(<RunProgress {...baseProps('idle')} currentStepIndex={-1} />);
    const card = screen.getByTestId('run-progress');
    expect(card).toHaveAttribute('data-status', 'idle');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemin', '0');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '100');
  });

  test('running', () => {
    render(<RunProgress {...baseProps('running')} />);
    expect(screen.getByTestId('run-progress')).toHaveAttribute('data-status', 'running');
    expect(screen.getByText('Reading metrics…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
  });

  test('complete', () => {
    render(<RunProgress {...baseProps('complete')} progress={1} />);
    expect(screen.getByTestId('run-progress')).toHaveAttribute('data-status', 'complete');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  test('error renders error message and Retry when handler provided', () => {
    const error: RunError = { message: 'API exploded', stepIndex: 1 };
    render(<RunProgress {...baseProps('error')} error={error} onRetry={() => {}} />);
    expect(screen.getByTestId('run-progress-error')).toHaveTextContent('API exploded');
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  test('stalled shows waiting badge', () => {
    render(<RunProgress {...baseProps('stalled')} />);
    expect(screen.getByTestId('run-progress-stalled-badge')).toHaveTextContent(
      /waiting for server/i
    );
  });
});

describe('RunProgress — stalled visual treatment (§6.5)', () => {
  test('badge sits inline with the step list (near the active step), not in the error region', () => {
    render(<RunProgress {...baseProps('stalled')} />);
    const badge = screen.getByTestId('run-progress-stalled-badge');
    const stepList = screen.getByTestId('run-progress-step-list');
    // Common ancestor must contain the step list — the badge lives next to the
    // current step row, not as a separate footer.
    expect(badge.parentElement?.contains(stepList)).toBe(true);
  });

  test('bar fill is desaturated AND pulses to differentiate from running and error', () => {
    render(<RunProgress {...baseProps('stalled')} />);
    const fill = screen.getByTestId('run-progress-bar-fill');
    // PROGRESS_STALLED_COLOR = #71717A → rgb(113, 113, 122)
    expect(fill.style.background).toMatch(/rgb\(\s*113,\s*113,\s*122\s*\)/i);
    expect(fill.className).toMatch(/motion-safe:animate-pulse/);
  });

  test('running bar does not pulse (only stalled does)', () => {
    render(<RunProgress {...baseProps('running')} />);
    const fill = screen.getByTestId('run-progress-bar-fill');
    expect(fill.className).not.toMatch(/animate-pulse/);
  });

  test('error bar does not pulse (frozen, not waiting)', () => {
    render(<RunProgress {...baseProps('error')} error={{ message: 'boom', stepIndex: 1 }} />);
    const fill = screen.getByTestId('run-progress-bar-fill');
    expect(fill.className).not.toMatch(/animate-pulse/);
  });

  test('no stall badge in any non-stalled state', () => {
    const states: RunStatus[] = ['idle', 'running', 'complete', 'error'];
    for (const status of states) {
      const { unmount } = render(
        <RunProgress
          {...baseProps(status)}
          error={status === 'error' ? { message: 'boom', stepIndex: 1 } : null}
        />
      );
      expect(screen.queryByTestId('run-progress-stalled-badge')).toBeNull();
      unmount();
    }
  });
});

describe('RunProgress — error visual treatment (§6.6)', () => {
  test('bar freezes red at the error point (bar shows current progress, in red)', () => {
    render(
      <RunProgress
        {...baseProps('error')}
        progress={0.42}
        error={{ message: 'API exploded', stepIndex: 1 }}
      />
    );
    const fill = screen.getByTestId('run-progress-bar-fill');
    // Red fill (#EF4444 → rgb(239, 68, 68)) at the position progress reached.
    expect(fill.style.background).toMatch(/rgb\(\s*239,\s*68,\s*68\s*\)/i);
    expect(fill.style.transform).toBe('scaleX(0.42)');
  });

  test('error region is announced via role="alert" (a11y)', () => {
    render(
      <RunProgress {...baseProps('error')} error={{ message: 'API exploded', stepIndex: 1 }} />
    );
    const panel = screen.getByTestId('run-progress-error');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('alert')).toHaveTextContent('API exploded');
  });

  test('renders error code subtly when present', () => {
    render(
      <RunProgress
        {...baseProps('error')}
        error={{ message: 'API exploded', stepIndex: 1, code: 'E_TIMEOUT' }}
      />
    );
    const code = screen.getByTestId('run-progress-error-code');
    expect(code).toHaveTextContent('[E_TIMEOUT]');
    expect(code.className).toMatch(/font-mono/);
  });

  test('omits the error code element when no code is provided', () => {
    render(
      <RunProgress {...baseProps('error')} error={{ message: 'API exploded', stepIndex: 1 }} />
    );
    expect(screen.queryByTestId('run-progress-error-code')).toBeNull();
  });

  test('Retry button only renders when onRetry is provided and forwards clicks', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    const { rerender } = render(
      <RunProgress {...baseProps('error')} error={{ message: 'API exploded', stepIndex: 1 }} />
    );
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();

    rerender(
      <RunProgress
        {...baseProps('error')}
        error={{ message: 'API exploded', stepIndex: 1 }}
        onRetry={onRetry}
      />
    );
    const button = screen.getByRole('button', { name: /retry/i });
    await user.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('error panel does not render in non-error states even if `error` is passed', () => {
    render(
      <RunProgress {...baseProps('running')} error={{ message: 'stale error', stepIndex: 0 }} />
    );
    expect(screen.queryByTestId('run-progress-error')).toBeNull();
  });
});

describe('RunProgress — ProgressBar (§6.2)', () => {
  test('fill uses transform: scaleX(progress) with origin: left', () => {
    render(<RunProgress {...baseProps('running')} progress={0.37} />);
    const fill = screen.getByTestId('run-progress-bar-fill');
    expect(fill.style.transform).toBe('scaleX(0.37)');
    expect(fill.className).toMatch(/\borigin-left\b/);
  });

  test('aria-valuenow is rounded and aria-valuetext includes step label', () => {
    render(<RunProgress {...baseProps('running')} progress={0.456} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '46');
    expect(bar.getAttribute('aria-valuetext')).toMatch(/Reading metrics/);
  });

  test('clamps progress out of [0, 1]', () => {
    render(<RunProgress {...baseProps('running')} progress={1.5} />);
    const fill = screen.getByTestId('run-progress-bar-fill');
    expect(fill.style.transform).toBe('scaleX(1)');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  test('uses red fill on error (#EF4444 → rgb(239, 68, 68))', () => {
    render(
      <RunProgress
        {...baseProps('error')}
        error={{ message: 'boom', stepIndex: 1 }}
        progress={0.3}
      />
    );
    const fill = screen.getByTestId('run-progress-bar-fill');
    expect(fill.style.background).toMatch(/rgb\(\s*239,\s*68,\s*68\s*\)/i);
  });

  test('uses gradient fill while running', () => {
    render(<RunProgress {...baseProps('running')} />);
    const fill = screen.getByTestId('run-progress-bar-fill');
    expect(fill.style.background).toMatch(/linear-gradient/i);
  });
});

describe('RunProgress — FuseIcon (§6.3)', () => {
  test('animates while running (motion-safe)', () => {
    render(<RunProgress {...baseProps('running')} />);
    const icon = screen.getByTestId('run-progress-icon');
    const img = icon.querySelector('img');
    expect(img?.className).toMatch(/motion-safe:animate-pulse/);
  });

  test('is static on complete (no animation class)', () => {
    render(<RunProgress {...baseProps('complete')} progress={1} />);
    const img = screen.getByTestId('run-progress-icon').querySelector('img');
    expect(img?.className).not.toMatch(/animate-pulse/);
  });

  test('is static on error and shows red ring + grayscale', () => {
    render(<RunProgress {...baseProps('error')} error={{ message: 'boom', stepIndex: 1 }} />);
    const icon = screen.getByTestId('run-progress-icon');
    expect(icon.className).toMatch(/ring-red/);
    const img = icon.querySelector('img');
    expect(img?.className).not.toMatch(/animate-pulse/);
    expect(img?.className).toMatch(/grayscale/);
  });

  test('is static on stalled and shows neutral ring', () => {
    render(<RunProgress {...baseProps('stalled')} />);
    const icon = screen.getByTestId('run-progress-icon');
    expect(icon.className).toMatch(/ring-zinc/);
    const img = icon.querySelector('img');
    expect(img?.className).not.toMatch(/animate-pulse/);
  });

  test('points at /fuse-icon.png and is decorative (aria-hidden, alt="")', () => {
    render(<RunProgress {...baseProps('running')} />);
    const icon = screen.getByTestId('run-progress-icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    const img = icon.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/fuse-icon.png');
    expect(img.getAttribute('alt')).toBe('');
  });
});

describe('RunProgress — StepList (§6.4)', () => {
  test('idle shows a "Ready" placeholder at the fixed container height', () => {
    render(<RunProgress {...baseProps('idle')} currentStepIndex={-1} />);
    const list = screen.getByTestId('run-progress-step-list');
    expect(list).toHaveTextContent(/ready/i);
    // Same height as the stack version → no layout shift on first event.
    expect(list.style.height).toBe('60px');
  });

  test('marks only the current step with data-current and prominent styling', () => {
    render(<RunProgress {...baseProps('running')} />);
    const list = screen.getByTestId('run-progress-step-list');

    const current = list.querySelector('[data-current="true"]')!;
    expect(current).not.toBeNull();
    expect(current.textContent).toBe('Reading metrics…');
    expect(current.className).toMatch(/font-medium/);

    const older = list.querySelector('[data-step-index="0"]')!;
    expect(older).not.toBeNull();
    expect(older.hasAttribute('data-current')).toBe(false);
    expect(older.className).toMatch(/text-zinc-500/);
  });

  test('stacks older steps above the current with monotonically increasing -translateY', () => {
    render(<RunProgress {...baseProps('running')} />);
    const list = screen.getByTestId('run-progress-step-list');

    const current = list.querySelector('[data-step-index="1"]')! as HTMLElement;
    const previous = list.querySelector('[data-step-index="0"]')! as HTMLElement;

    expect(current.style.transform).toBe('translateY(0px)');
    expect(previous.style.transform).toBe('translateY(-20px)');
    expect(Number(current.style.opacity)).toBe(1);
    expect(Number(previous.style.opacity)).toBeGreaterThan(0);
    expect(Number(previous.style.opacity)).toBeLessThan(1);
  });

  test('every row is truncated and uses motion-safe transitions only', () => {
    render(<RunProgress {...baseProps('running')} />);
    const rows = screen.getByTestId('run-progress-step-list').querySelectorAll('[data-step-index]');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.className).toMatch(/\btruncate\b/);
      expect(row.className).toMatch(/motion-safe:transition/);
    });
  });

  test('future (pending) steps render off-stage with opacity 0', () => {
    render(<RunProgress {...baseProps('running')} />);
    const list = screen.getByTestId('run-progress-step-list');
    const future = list.querySelector('[data-step-index="2"]')! as HTMLElement;
    expect(future.style.opacity).toBe('0');
    // Parked one slot below the current line — i.e. translateY(+20px).
    expect(future.style.transform).toBe('translateY(20px)');
  });
});
