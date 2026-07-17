"use client";

export default function ApplicationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-4 py-8">
      <section className="rounded-[2rem] border border-red-200 bg-white p-8 shadow-soft dark:border-red-500/30 dark:bg-slate-950">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-red-700 dark:text-red-300">Application error</p>
        <h1 className="mt-4 text-3xl font-black text-slate-950 dark:text-slate-50">This page could not be loaded.</h1>
        <p className="mt-4 text-slate-700 dark:text-slate-300">A temporary service or configuration problem prevented this request. No private implementation details have been displayed.</p>
        <button type="button" onClick={reset} className="mt-6 rounded-xl bg-slate-950 px-4 py-2 font-bold text-white dark:bg-orange-500 dark:text-slate-950">Try again</button>
      </section>
    </main>
  );
}
