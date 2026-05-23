/**
 * Single source of truth for tunable knobs shared by the route handler, the
 * `useRunProgress` hook, and the `RunProgress` component. Anything resembling
 * a magic number in the component should land here first.
 */

/** Silence window from the server before the client transitions to `stalled`. */
export const STALL_TIMEOUT_MS = 10_000;

/**
 * Default script for the "Happy Path" SSE scenario. Also used as fallback
 * labels in the component when an event omits one.
 */
export const DEFAULT_STEP_LABELS: readonly string[] = [
  'Analyzing campaigns…',
  'Reading metrics…',
  'Contacting API…',
  'Scoring audiences…',
  'Generating creative variants…',
  'Processing results…',
  'Finalising report…',
];

/**
 * Horizontal gradient stops applied to the progress bar fill (left → right).
 * Hex literals so the component can drop them straight into an inline
 * `background-image: linear-gradient(...)` without leaking Tailwind class soup.
 */
export const PROGRESS_GRADIENT = {
  from: '#6366F1', // indigo-500
  via: '#8B5CF6', // violet-500
  to: '#EC4899', // pink-500
} as const;

/** Solid fill applied when the run enters the `error` state. */
export const PROGRESS_ERROR_COLOR = '#EF4444'; // red-500

/** Solid (desaturated) fill applied when the run enters the `stalled` state. */
export const PROGRESS_STALLED_COLOR = '#71717A'; // zinc-500
