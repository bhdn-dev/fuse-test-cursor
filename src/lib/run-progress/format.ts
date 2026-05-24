/**
 * `formatMMSSms` — formats a duration as `MM:SS.cc`.
 *
 * Despite the PRD's `MM:SS.ms` label, the fractional component is rendered as
 * **hundredths of a second** (two digits), not milliseconds (three digits).
 * That matches the example `01:23.45` from `tasks.md §5.2` and avoids the
 * jittery final digit a 3-digit ms field would produce at 60fps.
 *
 * Behaviour:
 *
 * - Minutes are zero-padded to at least 2 digits (grows past 99: `100:00.00`).
 * - Seconds and hundredths are always exactly 2 digits.
 * - Negative, `NaN`, and non-finite inputs collapse to `00:00.00`.
 * - The fractional field is **truncated**, never rounded, so the displayed
 *   value never reads ahead of `elapsedMs` (matches the rAF timer's monotonic
 *   guarantee in `useElapsed`).
 */
/** Formats `ms` as `MM:SS.cc` (centiseconds, truncated). */
export function formatMMSSms(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;

  const totalCs = Math.floor(ms / 10);
  const cs = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);

  return `${pad2(minutes)}:${pad2(seconds)}.${pad2(cs)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
