"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { CheckCircle2, Zap } from "lucide-react";
import LanguageSelector from "@/components/landing/LanguageSelector";
import ThemeToggle from "@/components/landing/ThemeToggle";
import AuthMethodPanel from "@/components/auth/AuthMethodPanel";

export default function EmployerAuthPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && user) {
      router.push("/employer/onboarding");
    }
  }, [authLoading, user, router]);

  return (
    <div className="relative min-h-screen bg-[#040d1e] font-sans text-slate-50">
      <div className="pointer-events-none fixed -right-40 -top-40 h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[120px]" />
      <div className="pointer-events-none fixed -bottom-32 -left-32 h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-[100px]" />

      <nav className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-700 bg-slate-950/80 px-6 py-4 backdrop-blur">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600">
            <Zap size={18} className="text-white" fill="currentColor" />
          </div>
          <span className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-white">GO LESKA</span>
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSelector />
          <ThemeToggle />
        </div>
      </nav>

      <div className="relative z-10 flex min-h-[calc(100vh-80px)] items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-slate-700 bg-slate-900/95 p-8 shadow-[0_24px_80px_rgba(2,6,23,0.9)]">
            <div className="mb-8 space-y-3">
              <div className="inline-flex items-center rounded-full border border-blue-400/40 bg-blue-500/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-blue-100">Employer Registration</div>
              <h1 className="font-[var(--font-anton)] text-3xl uppercase leading-tight text-white">I need workers</h1>
              <p className="text-sm font-medium text-slate-300">Hire verified workers in 60 seconds</p>
            </div>

            <AuthMethodPanel role="EMPLOYER" />
          </div>

          <div className="mt-6 space-y-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
            <div className="flex items-start gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" /><span className="text-sm font-medium text-slate-300">Business information will be verified</span></div>
            <div className="flex items-start gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" /><span className="text-sm font-medium text-slate-300">Direct access to verified talent pool</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
