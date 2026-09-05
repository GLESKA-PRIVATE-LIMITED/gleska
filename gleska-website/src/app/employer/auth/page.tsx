"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { CheckCircle2, Zap } from "lucide-react";
import LanguageSelector from "@/components/landing/LanguageSelector";
import AuthMethodPanel from "@/components/auth/AuthMethodPanel";
import { getRouteForNextStep } from "@/lib/auth-routing";

export default function EmployerAuthPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const [accountType, setAccountType] = useState<"BUSINESS" | "INDIVIDUAL">("BUSINESS");

  useEffect(() => {
    const requestedAccountType = new URLSearchParams(window.location.search).get("account");
    if (requestedAccountType === "individual") setAccountType("INDIVIDUAL");
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(getRouteForNextStep(user.role, nextStep));
    }
  }, [authLoading, user, nextStep, router]);

  return (
    <div className="relative min-h-screen bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none fixed -right-40 -top-40 h-[500px] w-[500px] rounded-full bg-blue-500/10 blur-[120px] dark:bg-blue-600/10" />
      <div className="pointer-events-none fixed -bottom-32 -left-32 h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-[100px] dark:bg-indigo-500/10" />

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

      <div className="relative z-10 flex min-h-[calc(100vh-100px)] items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-10 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
            <div className="mb-8 space-y-2">
              <h1 className="font-[var(--font-anton)] text-xl sm:text-2xl md:text-[1.7rem] uppercase leading-tight text-slate-900 dark:text-white sm:whitespace-nowrap">
                CREATE BUSINESS ACCOUNT
              </h1>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                Make company's brain.
              </p>
            </div>

            <AuthMethodPanel role="EMPLOYER" accountType={accountType} />
          </div>

          <div className="mt-6 space-y-3 rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/80">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-blue-600 dark:text-emerald-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Business information will be verified</span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-blue-600 dark:text-emerald-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Direct access to verified talent pool</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
