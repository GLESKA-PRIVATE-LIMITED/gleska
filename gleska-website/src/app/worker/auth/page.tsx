"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { getRouteForNextStep } from "@/lib/auth-routing";
import AuthMethodPanel from "@/components/auth/AuthMethodPanel";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import BackLink from "@/components/auth/BackLink";

function WorkerAuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const registrationMode = searchParams.get("mode") === "signup";
  const { t } = useLanguage();

  useEffect(() => {
    if (!authLoading && user) router.replace(getRouteForNextStep(user.role, nextStep));
  }, [authLoading, user, nextStep, router]);


  return (
    <AuthPageFrame>
        <div className="w-full max-w-lg">
          <div className="mb-5">
            <BackLink
              href="/auth/signin"
              label="Back to Sign In"
            />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
            <div className="mb-8 space-y-2">
              <h1 className="font-[var(--font-anton)] text-xl sm:text-2xl md:text-[1.7rem] uppercase leading-tight text-slate-900 dark:text-white sm:whitespace-nowrap">
                {!registrationMode && authMode === "login" ? t("nav.login") : t("auth.employeeTitle")}
              </h1>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {!registrationMode && authMode === "login" ? t("auth.securityText") : t("auth.employeeTitle")}
              </p>
            </div>
            <AuthMethodPanel role="WORKER" initialMode={registrationMode ? "signup" : "login"} hideModeSelector={registrationMode} onModeChange={setAuthMode} />
          </div>

          <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Your data is secure and encrypted</span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">We use your mobile only for job notifications</span>
            </div>
          </div>
        </div>
    </AuthPageFrame>
  );
}

export default function WorkerAuthPage() {
  return (
    <Suspense fallback={null}>
      <WorkerAuthContent />
    </Suspense>
  );
}
