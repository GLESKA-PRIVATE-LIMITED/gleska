"use client";

import Link from "next/link";

/** Keeps a rendering error on the AI Credits pages from blanking the whole site. */
export default function BillingError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">We couldn&apos;t show your AI credits</h1>
      <p className="mt-2 text-sm text-slate-500">Your balance is safe. Please try again; if this keeps happening, contact GO LESKA support.</p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Try again</button>
        <Link href="/employer/dashboard" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">Go to dashboard</Link>
      </div>
    </main>
  );
}
