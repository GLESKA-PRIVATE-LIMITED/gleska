"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { CheckCircle2 } from "lucide-react";
import AuthMethodPanel from "@/components/auth/AuthMethodPanel";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import BackLink from "@/components/auth/BackLink";
import { getRouteForNextStep } from "@/lib/auth-routing";

function EmployerAuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const registrationMode = searchParams.get("mode") === "signup";
  const accountType = searchParams.get("account") === "individual" ? "INDIVIDUAL" : "BUSINESS";
  const { t } = useLanguage();

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(getRouteForNextStep(user.role, nextStep));
    }
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
                {!registrationMode && authMode === "login" ? t("nav.login") : accountType === "INDIVIDUAL" ? t("auth.loginHeading") : t("auth.businessHeading")}
              </h1>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {!registrationMode && authMode === "login" ? t("auth.securityText") : accountType === "INDIVIDUAL" ? t("auth.individualSubtitle") : t("auth.businessSubtitle")}
              </p>
            </div>

            <AuthMethodPanel role="EMPLOYER" accountType={accountType} initialMode={registrationMode ? "signup" : "login"} hideModeSelector={registrationMode} onModeChange={setAuthMode} />
          </div>

          <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-blue-600 dark:text-emerald-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {accountType === "INDIVIDUAL" ? "Your employer information will be verified" : "Business information will be verified"}
              </span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-blue-600 dark:text-emerald-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Direct access to verified talent pool</span>
            </div>
          </div>
        </div>
    </AuthPageFrame>
  );
}

export default function EmployerAuthPage() {
  return (
    <Suspense fallback={null}>
      <EmployerAuthContent />
    </Suspense>
  );
}
