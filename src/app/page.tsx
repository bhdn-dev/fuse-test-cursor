import { RunProgressDemo } from '@/components/RunProgress/RunProgressDemo';

/**
 * Demo page — §8 in `tasks.md`.
 *
 * Stays a server component for free metadata + minimum JS shipped; the
 * interactive client boundary lives inside `<RunProgressDemo />`.
 *
 * Layout is intentionally restrained: the `RunProgress` card owns its own
 * chrome (shadow, border, padding) so this page just provides the framing
 * (background, max-width, heading copy) and lets the component breathe.
 */
export default function Home() {
  return (
    <div className="flex min-h-svh flex-col bg-gradient-to-b from-zinc-50 to-zinc-100 px-4 py-12 sm:py-16 dark:from-zinc-950 dark:to-zinc-900">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wider text-indigo-600 uppercase dark:text-indigo-400">
            RunProgress demo
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
            Smooth progress bar with live timer
          </h1>
          <p className="max-w-prose text-sm text-zinc-600 dark:text-zinc-400">
            Live progress for an AI run streamed from a mock SSE endpoint. Pick a scenario to watch
            the bar smooth itself between events, the step list cycle, and the{' '}
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              MM:SS.ms
            </code>{' '}
            timer tick in lockstep with the run.
          </p>
        </header>

        <RunProgressDemo />

        <footer className="mt-auto pt-8 text-xs text-zinc-500 dark:text-zinc-500">
          <p>
            See <code className="font-mono">README.md</code> for the smoothing model, stall
            handling, and accessibility decisions.
          </p>
        </footer>
      </main>
    </div>
  );
}
