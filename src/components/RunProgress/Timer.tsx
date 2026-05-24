/**
 * `Timer` — pure presentational MM:SS.cc readout for the `RunProgress` card.
 *
 * Lives outside any `aria-live` region (per §7.2) so a screen reader doesn't
 * get spammed with announcements on every animation frame. The displayed
 * digits are still in the accessibility tree — assistive tech can navigate
 * to them on demand — they just don't auto-announce.
 *
 * Positioning lives in the parent: this component sets typography
 * (`tabular-nums` so digits don't reflow as values change) and color, the
 * card decides where the readout sits via `className`. The default styling
 * matches the bottom-right placement described in PRD §2.
 */

import { formatMMSSms } from '@/lib/run-progress/format';

/** Props for the MM:SS.cc elapsed-time readout. */
export interface TimerProps {
  elapsedMs: number;
  className?: string;
}

/** Renders `formatMMSSms(elapsedMs)` outside any `aria-live` region. */
export function Timer({ elapsedMs, className }: TimerProps) {
  const classes = ['font-mono', 'tabular-nums', 'text-sm', 'text-zinc-500', 'dark:text-zinc-400'];
  if (className) classes.push(className);

  return (
    <span className={classes.join(' ')} data-testid="run-progress-timer">
      {formatMMSSms(elapsedMs)}
    </span>
  );
}
