"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, UserCheck, ArrowRight } from "lucide-react";
import LanguageSelector from "@/components/landing/LanguageSelector";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { getRouteForNextStep } from "@/lib/auth-routing";

export default function SignInSelectionPage() {
  const { t } = useLanguage();
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(getRouteForNextStep(user.role, nextStep));
    }
  }, [authLoading, user, nextStep, router]);

  return (
    <div className="relative min-h-screen bg-[#040d1e] font-sans text-slate-50">
      {/* Ambient glow — matches employer/worker auth pages */}
      <div className="pointer-events-none fixed -right-40 -top-40 h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[120px]" />
      <div className="pointer-events-none fixed -bottom-32 -left-32 h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-[100px]" />

      {/* Minimal header matching employer/worker auth pages */}
      <div className="sticky top-4 z-50 px-4 sm:px-8">
        <nav className="mx-auto flex max-w-[1360px] items-center justify-between rounded-full border border-slate-700/80 bg-slate-950/95 px-8 py-4 shadow-xl shadow-black/40 backdrop-blur-md">
          <Link href="/" className="flex items-center gap-3.5">
            <img src="/favicon.ico" alt="GO LESKA AI" className="h-9 w-9 rounded-lg object-contain" />
            <span className="font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none">
              GO LESKA AI
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <LanguageSelector />
          </div>
        </nav>
      </div>

      {/* Selection cards */}
      <div className="relative z-10 flex min-h-[calc(100vh-100px)] items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl space-y-10 text-center">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-indigo-400/40 bg-indigo-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-200">
              Sign In
            </div>
            <h1 className="font-[var(--font-anton)] text-4xl sm:text-5xl uppercase leading-tight tracking-wide text-white">
              Select Your Role
            </h1>
            <p className="mx-auto max-w-md text-base font-medium text-slate-300">
              Choose an option below to access your account or start registration.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 text-left sm:grid-cols-2">
            {/*
             * I NEED WORKERS — same destination as GetHiredSection: /employer/auth
             */}
            <Link
              href="/employer/auth"
              className="group relative flex flex-col justify-between rounded-3xl border border-slate-700/80 bg-slate-900/95 p-8 shadow-[0_16px_40px_rgba(2,6,23,0.8)] transition-all duration-300 hover:-translate-y-1.5 hover:border-blue-500/60 hover:shadow-[0_24px_60px_rgba(37,99,235,0.15)]"
            >
              <div className="space-y-4">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-500/30 bg-blue-500/10 text-blue-400 transition-transform group-hover:scale-105">
                  <Briefcase size={28} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wider text-white transition-colors group-hover:text-blue-400">
                    {t("hero.ctaEmployer")}
                  </h2>
                  <p className="text-sm font-medium leading-relaxed text-slate-300">
                    Hire verified workers, manage staffing requirements, and view candidates.
                  </p>
                </div>
              </div>
              <div className="mt-8 flex items-center gap-2 text-sm font-bold text-blue-400 group-hover:text-blue-300">
                <span>Continue</span>
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </div>
            </Link>

            {/*
             * I WANT WORK — same destination as GetHiredSection: /worker/auth
             */}
            <Link
              href="/worker/auth"
              className="group relative flex flex-col justify-between rounded-3xl border border-slate-700/80 bg-slate-900/95 p-8 shadow-[0_16px_40px_rgba(2,6,23,0.8)] transition-all duration-300 hover:-translate-y-1.5 hover:border-amber-500/60 hover:shadow-[0_24px_60px_rgba(245,158,11,0.15)]"
            >
              <div className="space-y-4">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-400 transition-transform group-hover:scale-105">
                  <UserCheck size={28} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wider text-white transition-colors group-hover:text-amber-400">
                    {t("hero.ctaWorker")}
                  </h2>
                  <p className="text-sm font-medium leading-relaxed text-slate-300">
                    Get verified once, find real industrial jobs, and manage your work profile.
                  </p>
                </div>
              </div>
              <div className="mt-8 flex items-center gap-2 text-sm font-bold text-amber-400 group-hover:text-amber-300">
                <span>Continue</span>
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
