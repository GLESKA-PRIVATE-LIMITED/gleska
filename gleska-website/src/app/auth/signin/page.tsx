"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Briefcase, UserCheck, ArrowRight, UserRound } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { getRouteForNextStep } from "@/lib/auth-routing";
import AuthMethodPanel from "@/components/auth/AuthMethodPanel";
import AuthPageFrame from "@/components/auth/AuthPageFrame";

export default function SignInSelectionPage() {
  const { t } = useLanguage();
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const router = useRouter();
  const [showCreateAccount, setShowCreateAccount] = React.useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(getRouteForNextStep(user.role, nextStep));
    }
  }, [authLoading, user, nextStep, router]);

  return (
    <AuthPageFrame contentClassName="items-center">
      {/* Unified login and role-specific registration chooser */}
      <div className="w-full">
        <div className={`mx-auto w-full ${showCreateAccount ? "max-w-4xl space-y-8 text-center" : "max-w-lg"}`}>
          {showCreateAccount && (
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
                {t("nav.signup")}
              </div>
              <h1 className="font-[var(--font-anton)] text-4xl sm:text-5xl uppercase leading-tight tracking-wide text-slate-900 dark:text-white">
                {t("signin.selectRole")}
              </h1>
              <p className="mx-auto max-w-md text-base font-medium text-slate-600 dark:text-slate-300">
                {t("signin.roleDescription")}
              </p>
            </div>
          )}

          {!showCreateAccount ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
              <div className="mb-8 space-y-2 text-left">
                <h1 className="font-[var(--font-anton)] text-xl uppercase leading-tight text-slate-900 dark:text-white sm:text-2xl md:text-[1.7rem]">
                  {t("nav.signIn")}
                </h1>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t("auth.securityText")}
                </p>
              </div>
              <AuthMethodPanel onCreateAccount={() => setShowCreateAccount(true)} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 text-left md:grid-cols-3">
            <Link
              href="/employer/auth?mode=signup"
              className="group relative flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-2xl shadow-slate-900/5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-blue-500/60 hover:shadow-xl dark:border-slate-800/80 dark:bg-slate-900/90"
            >
              <div className="space-y-4">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 text-blue-600 transition-transform group-hover:scale-105 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400">
                  <Briefcase size={28} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wider text-slate-900 transition-colors group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                    {t("signin.businessEmployerTitle")}
                  </h2>
                  <p className="text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    {t("signin.businessEmployerDesc")}
                  </p>
                </div>
              </div>
              <div className="mt-8 flex items-center gap-2 text-sm font-bold text-blue-600 transition-colors group-hover:text-blue-700 dark:text-blue-400 dark:group-hover:text-blue-300">
                <span>Create account</span>
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </div>
            </Link>

            <Link
              href="/employer/auth?account=individual&mode=signup"
              className="group relative flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-2xl shadow-slate-900/5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-amber-500/60 hover:shadow-xl dark:border-slate-800/80 dark:bg-slate-900/90"
            >
              <div className="space-y-4">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-600 transition-transform group-hover:scale-105 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                  <UserCheck size={28} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wider text-slate-900 transition-colors group-hover:text-amber-600 dark:text-white dark:group-hover:text-amber-400">
                    {t("signin.individualEmployerTitle")}
                  </h2>
                  <p className="text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    {t("signin.individualEmployerDesc")}
                  </p>
                </div>
              </div>
              <div className="mt-8 flex items-center gap-2 text-sm font-bold text-amber-600 transition-colors group-hover:text-amber-700 dark:text-amber-400 dark:group-hover:text-amber-300">
                <span>Create account</span>
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </div>
            </Link>

            <Link
              href="/worker/auth?mode=signup"
              className="group relative flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white/80 p-6 shadow-2xl shadow-slate-900/5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-amber-500/60 hover:shadow-xl dark:border-slate-800/80 dark:bg-slate-900/90"
            >
              <div className="space-y-4">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"><UserRound size={28} /></div>
                <div className="space-y-2"><h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wider text-slate-900 dark:text-white">{t("signin.workerTitle")}</h2><p className="text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">{t("signin.workerDesc")}</p></div>
              </div>
              <div className="mt-8 flex items-center gap-2 text-sm font-bold text-amber-600"><span>Create account</span><ArrowRight size={18} /></div>
            </Link>
            </div>
          )}
          {showCreateAccount && <button type="button" onClick={() => setShowCreateAccount(false)} className="mx-auto inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"><ArrowLeft size={16} /> Back to Sign In</button>}
        </div>
      </div>
    </AuthPageFrame>
  );
}
