"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Loader2, X, Shield, FileText, CheckCircle2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { getRouteForNextStep } from "@/lib/auth-routing";
import { normalizeIndianMobile } from "@/lib/msg91";

type Role = "WORKER" | "EMPLOYER";
type OTPTransaction = { name: string; email: string; password: string; mobile: string; termsAccepted: boolean; requestId: string | null; channel: "SMS" | "EMAIL" };

export default function AuthMethodPanel({ role, accountType = "BUSINESS" }: { role: Role; accountType?: "BUSINESS" | "INDIVIDUAL" }) {
  const router = useRouter();
  const { t } = useLanguage();
  const { signInWithEmail, signInWithGoogle, signupPreflight, requestOTP, resendOTP, completeEmailSignup, loginWithMobile, refreshUser, isLoading: authLoading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginMethod, setLoginMethod] = useState<"email" | "mobile">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [otpTransaction, setOtpTransaction] = useState<OTPTransaction | null>(null);
  const [otp, setOtp] = useState("");
  const [otpOpen, setOtpOpen] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [otpPurpose, setOtpPurpose] = useState<"signup" | "login">("signup");

  const clearOtpTransaction = () => {
    setOtpTransaction(null);
    setOtp("");
    setOtpOpen(false);
    setCountdown(0);
  };

  // Lock background scrolling when Terms modal or OTP dialog is open
  useEffect(() => {
    if (termsModalOpen || otpOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [termsModalOpen, otpOpen]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (termsModalOpen) setTermsModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [termsModalOpen]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "login" && loginMethod === "mobile") {
      const canonicalMobile = normalizeIndianMobile(mobile);
      if (canonicalMobile.length !== 12 || !canonicalMobile.startsWith("91")) {
        toast.error(t('auth.validMobile'));
        return;
      }
      setSubmitting(true);
      try {
        const otpResult = await requestOTP(canonicalMobile);
        setOtpTransaction({ name: "", email: "", password: "", mobile: canonicalMobile, termsAccepted: false, requestId: otpResult?.requestId ?? null, channel: "SMS" });
        setOtpPurpose("login");
        setOtp("");
        setCountdown(30);
        setOtpOpen(true);
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : t('auth.resetOtpFailure'));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (mode === "signup") {
      if (!name.trim()) {
        toast.error(t('auth.fillName'));
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email.trim() || !emailRegex.test(email.trim())) {
        toast.error(t('auth.validEmail'));
        return;
      }
      if (!password) {
        toast.error(t('auth.enterPassword'));
        return;
      }
      if (password.length < 8) {
        toast.error(t('auth.passwordMin'));
        return;
      }
      if (!confirmPassword) {
        toast.error(t('auth.confirmPasswordRequired'));
        return;
      }
      if (password !== confirmPassword) {
        toast.error(t('auth.passwordMismatch'));
        return;
      }
      const rawMobileDigits = mobile.replace(/\D/g, "");
      if (!rawMobileDigits || rawMobileDigits.length !== 10) {
        toast.error(t('auth.validMobile'));
        return;
      }
      if (!termsAccepted) {
        toast.error(t('auth.acceptTerms'));
        return;
      }
    } else {
      if (!email.trim() || password.length < 8) {
        toast.error(t('auth.loginValid'));
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === "signup") {
        const canonicalMobile = normalizeIndianMobile(mobile);
        await signupPreflight(name, email, canonicalMobile, password, confirmPassword, role, termsAccepted);
        const otpResult = await requestOTP(canonicalMobile);
        setOtpTransaction({ name, email, password, mobile: canonicalMobile, termsAccepted, requestId: otpResult?.requestId ?? null, channel: "SMS" });
        setOtpPurpose("signup");
        setOtp("");
        setCountdown(30);
        setOtpOpen(true);
        toast.success(t('auth.otpSent'));
      } else {
        await signInWithEmail(email, password, role);
        const nextStep = await refreshUser();
        toast.success(t('auth.welcomeBack'));
        router.push(getRouteForNextStep(role, nextStep));
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('auth.googleError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleAuth = () => {
    clearOtpTransaction();
    setSubmitting(true);
    signInWithGoogle(role, accountType).catch((error: Error) => {
      toast.error(error.message);
      setSubmitting(false);
    });
  };

  const verifySignupOTP = async (event: FormEvent) => {
    event.preventDefault();
    if (!otpTransaction || otp.length !== 6) {
      toast.error(t('auth.otpRequired'));
      return;
    }
    setSubmitting(true);
    try {
      if (otpPurpose === "signup") {
        await completeEmailSignup(
          otpTransaction.email,
          otpTransaction.password,
          otpTransaction.name,
          otpTransaction.mobile,
          otp,
          role,
          otpTransaction.termsAccepted,
          accountType,
        );
      } else {
        await loginWithMobile(otpTransaction.mobile, otp, role);
      }
      const nextStep = await refreshUser();
      clearOtpTransaction();
      toast.success(otpPurpose === "signup" ? t('auth.accountCreated') : t('auth.welcomeBack'));
      router.push(getRouteForNextStep(role, nextStep));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('auth.invalidOtp'));
    } finally {
      setSubmitting(false);
    }
  };

  const resendSignupOTP = async () => {
    if (!otpTransaction) {
      toast.error(t('auth.otpLost'));
      return;
    }
    setSubmitting(true);
    try {
      await resendOTP(otpTransaction.mobile, otpTransaction.requestId, otpTransaction.channel);
      setCountdown(30);
      toast.success(t('auth.resetSentAgain'));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('auth.resendFailure'));
    } finally {
      setSubmitting(false);
    }
  };

  const termsSummaryPoints = [
    t('auth.termsPoint1'),
    t('auth.termsPoint2'),
    t('auth.termsPoint3'),
    t('auth.termsPoint4'),
    t('auth.termsPoint5'),
    t('auth.termsPoint6'),
    t('auth.termsPoint7'),
  ];

  const isManualSignupComplete = Boolean(
    name.trim() &&
    email.trim() &&
    password.length >= 8 &&
    confirmPassword &&
    confirmPassword === password &&
    mobile.replace(/\D/g, "").length === 10 &&
    termsAccepted
  );

  return (
    <div className="mb-6 space-y-4 border-b border-slate-200/80 pb-6 dark:border-slate-800">
      <div className="flex gap-2 text-xs font-bold uppercase tracking-wider">
        <button
          type="button"
          onClick={() => { clearOtpTransaction(); setMode("login"); }}
          className={`rounded-xl px-4 py-2.5 transition-all ${
            mode === "login"
              ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-500/20"
              : "bg-slate-100/90 text-slate-600 hover:bg-slate-200 dark:bg-slate-800/80 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          {t('nav.login')}
        </button>
        <button
          type="button"
          onClick={() => { clearOtpTransaction(); setMode("signup"); }}
          className={`rounded-xl px-4 py-2.5 transition-all ${
            mode === "signup"
              ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-500/20"
              : "bg-slate-100/90 text-slate-600 hover:bg-slate-200 dark:bg-slate-800/80 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          {t('nav.signup')}
        </button>
      </div>
      {mode === "login" && (
        <div className="flex rounded-xl bg-slate-100/90 p-1 text-xs font-semibold dark:bg-slate-800/80">
          <button
            type="button"
            onClick={() => { clearOtpTransaction(); setLoginMethod("email"); }}
            className={`flex-1 rounded-lg py-2 transition-all ${
              loginMethod === "email"
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {t('auth.emailPassword')}
          </button>
          <button
            type="button"
            onClick={() => { clearOtpTransaction(); setLoginMethod("mobile"); }}
            className={`flex-1 rounded-lg py-2 transition-all ${
              loginMethod === "mobile"
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {t('auth.mobileOtp')}
          </button>
        </div>
      )}
      <form onSubmit={submitEmail} className="space-y-3">
        {mode === "signup" && (
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('auth.fullNameLabel')}
            className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/40"
          />
        )}
        {mode === "login" && loginMethod === "mobile" && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-4 transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 dark:border-slate-700/80 dark:bg-slate-800/90 dark:focus-within:border-indigo-500 dark:focus-within:ring-indigo-900/40">
            <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">+91</span>
            <input
              value={mobile}
              onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder={t('auth.mobileLabel')}
              className="min-w-0 flex-1 bg-transparent py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none dark:text-white dark:placeholder:text-slate-500"
            />
          </div>
        )}
        {!(mode === "login" && loginMethod === "mobile") && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-4 transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 dark:border-slate-700/80 dark:bg-slate-800/90 dark:focus-within:border-indigo-500 dark:focus-within:ring-indigo-900/40">
            <Mail size={16} className="text-slate-400 dark:text-slate-500" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('auth.emailLabel')}
              className="min-w-0 flex-1 bg-transparent py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none dark:text-white dark:placeholder:text-slate-500"
            />
          </div>
        )}
        {!(mode === "login" && loginMethod === "mobile") && (
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t('auth.passwordLabel')}
            className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/40"
          />
        )}
        {mode === "signup" && (
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder={t('auth.confirmPasswordLabel')}
            className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/40"
          />
        )}
        {mode === "signup" && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-4 transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 dark:border-slate-700/80 dark:bg-slate-800/90 dark:focus-within:border-indigo-500 dark:focus-within:ring-indigo-900/40">
            <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">+91</span>
            <input
              value={mobile}
              onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder={t('auth.mobileLabel')}
              className="min-w-0 flex-1 bg-transparent py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none dark:text-white dark:placeholder:text-slate-500"
            />
          </div>
        )}
        
        {mode === "signup" && (
          <div className="flex items-start gap-3 pt-1">
            <input
              type="checkbox"
              id="terms-acceptance"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 bg-white text-indigo-600 accent-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 focus:outline-none cursor-pointer dark:border-slate-600 dark:bg-slate-800"
            />
            <label htmlFor="terms-acceptance" className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 select-none cursor-pointer">
              {t('shared.termsAccepted')} {" "}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTermsModalOpen(true);
                }}
                className="font-semibold text-indigo-600 underline transition hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 focus:outline-none"
              >
                {t('shared.termsLink')}
              </button>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || (mode === "signup" && !isManualSignupComplete)}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {mode === "signup" ? t('auth.signupButton') : loginMethod === "mobile" ? t('auth.sendMobileOtpButton') : t('auth.loginButton')}
        </button>
      </form>

      {mode === "signup" && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">{t('shared.verifiedPhone')}</p>
      )}

      {mode === "login" && (
        <>
          <a href="/auth/forgot-password" className="block text-center text-xs font-semibold text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300">
            {t('auth.forgotPassword')}
          </a>
          <div className="relative flex items-center justify-center pt-2">
            <div className="border-t border-slate-200 w-full dark:border-slate-800" />
            <span className="bg-white/80 px-3 text-xs uppercase text-slate-400 font-semibold dark:bg-slate-900">{t('nav.or')}</span>
            <div className="border-t border-slate-200 w-full dark:border-slate-800" />
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={handleGoogleAuth}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200/90 bg-white/95 py-3.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            {t('auth.googleButton')}
          </button>
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">{t('auth.securityText')}</p>
        </>
      )}

      {/* TERMS & CONDITIONS SUMMARY MODAL */}
      {termsModalOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4 sm:p-6 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-modal-title"
          onClick={() => setTermsModalOpen(false)}
        >
          <div
            className="relative flex w-full max-w-xl max-h-[85vh] flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 bg-white/90 dark:border-slate-800 dark:bg-slate-900/90">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-900/50">
                  <Shield size={20} />
                </div>
                <div>
                  <h2 id="terms-modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
                    {t('auth.termsModalTitle')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('auth.termsModalSubtitle')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTermsModalOpen(false)}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              <div className="space-y-3">
                {termsSummaryPoints.map((point, index) => (
                  <div key={index} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800/80 dark:bg-slate-800/40">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <p className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200">{point}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs font-medium text-indigo-900 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200">
                {t('shared.termsConfirm')}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-100 bg-white/90 px-6 py-4 dark:border-slate-800 dark:bg-slate-900/90">
              <Link
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-500 underline transition dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                <FileText size={14} />
                {t('shared.fullTerms')}
                <ExternalLink size={12} />
              </Link>
              <button
                type="button"
                onClick={() => setTermsModalOpen(false)}
                className="rounded-xl bg-slate-100 border border-slate-200 px-5 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                {t('nav.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OTP VERIFICATION DIALOG */}
      {otpOpen && otpTransaction && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-slate-950/60 p-5 backdrop-blur-xs" role="dialog" aria-modal="true" aria-labelledby="otp-title">
          <div className="relative w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <button type="button" onClick={clearOtpTransaction} className="absolute right-4 top-4 rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white" aria-label="Close verification dialog"><X size={18} /></button>
            <div className="mb-6 pr-8">
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">{otpPurpose === "signup" ? t('shared.secureSignup') : t('shared.secureLogin')}</p>
              <h2 id="otp-title" className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{otpPurpose === "signup" ? t('shared.verifyPhone') : t('shared.signInMobile')}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t('shared.enterCode', { phone: `+91 ${otpTransaction.mobile.replace(/^91/, "")}` })}</p>
            </div>
            <form onSubmit={verifySignupOTP} className="space-y-5">
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" aria-label="6-digit verification code" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-center text-2xl font-bold tracking-[0.45em] text-slate-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-indigo-500" />
              <button type="submit" disabled={submitting || otp.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50">{submitting && <Loader2 size={17} className="animate-spin" />} {submitting ? t('shared.verifying') : otpPurpose === "signup" ? t('shared.verifyCreate') : t('shared.verifySignIn')}</button>
              <div className="flex items-center justify-between text-xs"><button type="button" onClick={clearOtpTransaction} className="font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">{t('nav.cancel')}</button><button type="button" disabled={countdown > 0 || submitting} onClick={resendSignupOTP} className="font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50">{countdown > 0 ? t('shared.resendIn', { seconds: countdown }) : t('shared.resendOtp')}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}