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
    <div className="relative min-h-screen bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">
      {/* Ambient glow matching updated auth pages */}
      <div className="pointer-events-none fixed -right-40 -top-40 h-[500px] w-[500px] rounded-full bg-blue-500/10 blur-[120px] dark:bg-blue-600/10" />
      <div className="pointer-events-none fixed -bottom-32 -left-32 h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-[100px] dark:bg-indigo-500/10" />

      {/* Header Nav matching design system */}
      <div className="sticky top-4 z-50 px-4 sm:px-8">
        <nav className="mx-auto flex max-w-[1360px] items-center justify-between rounded-full border border-slate-200/80 bg-white/95 px-4 py-3 sm:px-8 sm:py-4 shadow-xl shadow-slate-900/5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/95 dark:shadow-black/20">
          <Link href="/" className="flex items-center gap-2 sm:gap-3.5">
            <img src="/favicon.ico" alt="GO LESKA AI" className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg object-contain" />
            <span className="font-[var(--font-anton)] text-xl sm:text-3xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
              GO LESKA AI
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <LanguageSelector />
          </div>
        </nav>
      </div>

      {/* Selection cards */}
      <div className="relative z-10 flex min-h-[calc(100vh-100px)] items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-2xl space-y-8 sm:space-y-10 text-center">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
              Sign In
            </div>
            <h1 className="font-[var(--font-anton)] text-4xl sm:text-5xl uppercase leading-tight tracking-wide text-slate-900 dark:text-white">
              Select Your Role
            </h1>
            <p className="mx-auto max-w-md text-base font-medium text-slate-600 dark:text-slate-300">
              Choose an option below to access your account or start registration.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 text-left sm:grid-cols-2">
            {/*
             * I NEED WORKERS — same destination as GetHiredSection: /employer/auth
             */}
            <Link
              href="/employer/auth"
              className="group relative flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-2xl shadow-slate-900/5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-blue-500/60 hover:shadow-xl dark:border-slate-800/80 dark:bg-slate-900/90"
            >
              <div className="space-y-4">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 text-blue-600 transition-transform group-hover:scale-105 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400">
                  <Briefcase size={28} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wider text-slate-900 transition-colors group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                    {t("signin.businessAccountTitle")}
                  </h2>
                  <p className="text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    {t("signin.businessAccountDesc")}
                  </p>
                </div>
              </div>
              <div className="mt-8 flex items-center gap-2 text-sm font-bold text-blue-600 transition-colors group-hover:text-blue-700 dark:text-blue-400 dark:group-hover:text-blue-300">
                <span>Continue</span>
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </div>
            </Link>

            {/*
             * INDIVIDUAL ACCOUNT — employer authentication with Individual intent
             */}
            <Link
              href="/employer/auth?account=individual"
              className="group relative flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-2xl shadow-slate-900/5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-amber-500/60 hover:shadow-xl dark:border-slate-800/80 dark:bg-slate-900/90"
            >
              <div className="space-y-4">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-600 transition-transform group-hover:scale-105 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                  <UserCheck size={28} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wider text-slate-900 transition-colors group-hover:text-amber-600 dark:text-white dark:group-hover:text-amber-400">
                    {t("signin.individualAccountTitle")}
                  </h2>
                  <p className="text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    {t("signin.individualAccountDesc")}
                  </p>
                </div>
              </div>
              <div className="mt-8 flex items-center gap-2 text-sm font-bold text-amber-600 transition-colors group-hover:text-amber-700 dark:text-amber-400 dark:group-hover:text-amber-300">
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
