"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Zap } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getRouteForNextStep } from "@/lib/auth-routing";
import LanguageSelector from "@/components/landing/LanguageSelector";
import AuthMethodPanel from "@/components/auth/AuthMethodPanel";

export default function WorkerAuthPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, nextStep } = useAuth();

  useEffect(() => {
    if (!authLoading && user) router.push(getRouteForNextStep(user.role, nextStep));
  }, [authLoading, user, nextStep, router]);

  return (
    <div className="relative min-h-screen bg-[#040d1e] font-sans text-slate-50">
      <div className="pointer-events-none fixed -right-40 -top-40 h-[500px] w-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
      <div className="pointer-events-none fixed -bottom-32 -left-32 h-[400px] w-[400px] rounded-full bg-blue-500/10 blur-[100px]" />
      <div className="sticky top-4 z-50 px-4 sm:px-8">
        <nav className="mx-auto flex max-w-[1360px] items-center justify-between rounded-full border border-slate-700/80 bg-slate-950/95 px-8 py-4 shadow-xl shadow-black/40 backdrop-blur-md">
          <Link href="/" className="flex items-center gap-3.5">
            <img src="/favicon.ico" alt="GO LESKA AI" className="h-9 w-9 rounded-lg object-contain" />
            <span className="font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none">
              GO LESKA AI
            </span>
          </Link>
          <div className="flex items-center gap-4"><LanguageSelector /></div>
        </nav>
      </div>
      <div className="relative z-10 flex min-h-[calc(100vh-80px)] items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-slate-700 bg-slate-900/95 p-8 shadow-[0_24px_80px_rgba(2,6,23,0.9)]">
            <div className="mb-8 space-y-3">
              <div className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-100">Worker registration</div>
              <h1 className="font-[var(--font-anton)] text-3xl uppercase leading-tight text-white">I want work</h1>
              <p className="text-sm font-medium text-slate-300">Get verified once, get matched forever.</p>
            </div>
            <AuthMethodPanel role="WORKER" />
          </div>
          <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" /><span className="text-sm font-medium text-slate-600 dark:text-slate-400">Your data is secure and encrypted</span></div>
            <div className="flex items-start gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" /><span className="text-sm font-medium text-slate-600 dark:text-slate-400">We use your mobile only for job notifications</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
