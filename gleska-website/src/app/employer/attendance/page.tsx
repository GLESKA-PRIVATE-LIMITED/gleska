import Link from "next/link";
import { ArrowLeft, Clock3 } from "lucide-react";

export default function EmployerAttendancePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef1fb] px-6 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Clock3 size={36} className="mx-auto mb-5 text-emerald-600 dark:text-emerald-400" />
        <h1 className="font-(--font-anton) text-3xl uppercase">Attendance tracking</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          GPS attendance tracking is not available yet because no attendance service or API exists in the backend.
        </p>
        <Link href="/employer/dashboard" className="mt-6 inline-flex items-center gap-2 font-bold text-emerald-600 dark:text-emerald-400">
          <ArrowLeft size={16} /> Back to dashboard
        </Link>
      </section>
    </main>
  );
}