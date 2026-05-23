import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { Timer } from './Timer';

describe('Timer', () => {
  test('renders the elapsed value formatted as MM:SS.cc', () => {
    render(<Timer elapsedMs={61_234} />);
    expect(screen.getByTestId('run-progress-timer')).toHaveTextContent('01:01.23');
  });

  test('renders 00:00.00 for a fresh run', () => {
    render(<Timer elapsedMs={0} />);
    expect(screen.getByTestId('run-progress-timer')).toHaveTextContent('00:00.00');
  });

  test('uses tabular-nums so digits do not reflow as the value changes', () => {
    render(<Timer elapsedMs={1_000} />);
    expect(screen.getByTestId('run-progress-timer').className).toMatch(/\btabular-nums\b/);
  });

  test('appends caller-provided className', () => {
    render(<Timer elapsedMs={0} className="absolute right-4 bottom-3" />);
    const el = screen.getByTestId('run-progress-timer');
    expect(el.className).toMatch(/\babsolute\b/);
    expect(el.className).toMatch(/\bright-4\b/);
    expect(el.className).toMatch(/\bbottom-3\b/);
  });

  test('is not placed in an aria-live region (timer ticks do not auto-announce)', () => {
    render(<Timer elapsedMs={0} />);
    const el = screen.getByTestId('run-progress-timer');
    expect(el.closest('[aria-live]')).toBeNull();
    expect(el.getAttribute('aria-live')).toBeNull();
  });
});
