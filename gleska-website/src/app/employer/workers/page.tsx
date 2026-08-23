"use client";

import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";

export default function EmployerWorkersPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef1fb] px-6 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Users size={36} className="mx-auto mb-5 text-indigo-600 dark:text-indigo-400" />
        <h1 className="font-(--font-anton) text-3xl uppercase">Worker directory</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          Worker browsing is not available yet because the backend has no employer worker-listing endpoint.
        </p>
        <Link href="/employer/dashboard" className="mt-6 inline-flex items-center gap-2 font-bold text-indigo-600 dark:text-indigo-400">
          <ArrowLeft size={16} /> Back to dashboard
        </Link>
      </section>
    </main>
  );
}