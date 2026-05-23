export default function Home() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <main className="flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Smooth Progress Bar Demo
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Live progress for an AI run streamed from a mock SSE endpoint.
          </p>
        </header>

        {/* RunProgress component slot — wired up in §8. */}
        <section
          aria-label="Run progress"
          className="min-h-[160px] rounded-2xl border border-dashed border-zinc-300 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
        />

        {/* Trigger buttons (Happy / Error / Stall / Reset) — wired up in §8.1. */}
        <section aria-label="Run controls" className="flex min-h-[48px] flex-wrap gap-3" />
      </main>
    </div>
  );
}
