"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import LanguageSelector from "@/components/landing/LanguageSelector";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import apiClient from "@/lib/api";
import { initializeMSG91Widget, normalizeIndianMobile, sendOTP, verifyOTP, retryOTP } from "@/lib/msg91";

type Step = "phone" | "otp" | "password" | "success";

export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const { requestPasswordReset, verifyPasswordResetOTP, completePasswordReset } = useAuth();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetAuthorization, setResetAuthorization] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("phone");
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!countdown) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const requestOTP = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedPhone = normalizeIndianMobile(phone);
    if (!/^91\d{10}$/.test(normalizedPhone)) {
      toast.error(t('auth.validMobile'));
      return;
    }
    setSubmitting(true);
    try {
      setRequestId(null);
      setOtp("");
      await requestPasswordReset(normalizedPhone);
      await initializeMSG91Widget();
      setRequestId(null);
      const transaction = await sendOTP(normalizedPhone);
      setRequestId(transaction.requestId);
      setPhone(normalizedPhone);
      setStep("otp");
      setCountdown(30);
      toast.success(t('auth.resetSent'));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('auth.resetOtpFailure'));
    } finally {
      setSubmitting(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      toast.error(t('auth.otpRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const providerResult = await verifyOTP(otp);
      setResetAuthorization(await verifyPasswordResetOTP(phone, providerResult.accessToken));
      setStep("password");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('auth.invalidOtp'));
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (countdown) return;
    setSubmitting(true);
    try {
      const normalizedPhone = normalizeIndianMobile(phone);
      await apiClient.post(
        "/api/v1/auth/resend-otp",
        { mobile: normalizedPhone, channel: "SMS" },
        { skipSupabaseAuth: true }
      );
      await initializeMSG91Widget();
      const transaction = await retryOTP("SMS", requestId);
      setRequestId(transaction.requestId ?? null);
      setOtp("");
      setCountdown(30);
      toast.success(t('auth.resetSentAgain'));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('auth.resendFailure'));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error(t('auth.passwordMin'));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t('auth.passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await completePasswordReset(resetAuthorization, password, confirmPassword);
      setResetAuthorization("");
      setPassword("");
      setConfirmPassword("");
      setStep("success");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('auth.resetOtpFailure'));
      setResetAuthorization("");
      setStep("phone");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#eef1fb] font-sans text-slate-900">
      <div className="sticky top-4 z-50 px-4 sm:px-8">
        <nav className="mx-auto flex max-w-340 items-center justify-between rounded-full border border-slate-200/80 bg-white/95 px-4 py-3 shadow-xl shadow-slate-900/5 backdrop-blur-md sm:px-8 sm:py-4">
          <Link href="/" className="flex items-center gap-2 sm:gap-3.5">
            <img src="/favicon.ico" alt="GO LESKA AI" className="h-8 w-8 rounded-lg object-contain sm:h-9 sm:w-9" />
            <span className="select-none whitespace-nowrap bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text font-(--font-anton) text-xl uppercase tracking-wider text-transparent sm:text-3xl">GO LESKA AI</span>
          </Link>
          <LanguageSelector />
        </nav>
      </div>
      <main className="relative z-10 flex min-h-[calc(100vh-100px)] items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-2xl shadow-slate-900/5 sm:p-8">
        <Link href="/" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-600"><ArrowLeft size={16} /> {t('shared.back')}</Link>
        {step === "success" ? <><h1 className="font-(--font-anton) text-3xl uppercase leading-tight text-slate-900 sm:text-4xl">{t('auth.passwordUpdated')}</h1><p className="mt-4 text-sm leading-relaxed text-slate-600">{t('auth.passwordResetSuccess')}</p><Link href="/login" className="mt-6 flex min-h-14 w-full items-center justify-center rounded-full bg-linear-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 text-center font-bold text-white shadow-lg shadow-indigo-500/20">{t('shared.continueLogin')}</Link></> : <>
          <h1 className="font-(--font-anton) text-3xl uppercase leading-tight text-slate-900 sm:text-4xl">{t('shared.resetPassword')}</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{step === "phone" ? t('shared.enterPhone') : step === "otp" ? t('shared.enterCode', { phone: phone || t('shared.phone') }) : t('auth.newPasswordHelper')}</p>
          {step === "phone" && <form onSubmit={requestOTP} className="mt-6 grid gap-3"><div className="flex min-h-14 items-center rounded-2xl border border-slate-200 bg-white px-4 transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100"><span className="mr-2 text-sm font-semibold text-slate-500">+91</span><input required inputMode="numeric" value={phone.replace(/^91/, "")} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder={t('auth.mobileLabel')} className="min-w-0 flex-1 bg-transparent py-3 text-slate-900 outline-none placeholder:text-slate-400" /></div><button disabled={submitting} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 font-bold text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}{t('shared.sendOtp')}</button></form>}
          {step === "otp" && <form onSubmit={verify} className="mt-6 grid gap-3"><input autoFocus required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /><button disabled={submitting || otp.length !== 6} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 font-bold text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}{t('shared.verifyOtp')}</button><div className="flex min-h-11 items-center justify-between gap-3 text-xs"><button type="button" onClick={() => { setStep("phone"); setOtp(""); }} className="font-semibold text-slate-500">{t('auth.changePhone')}</button><button type="button" disabled={Boolean(countdown) || submitting} onClick={resend} className="font-semibold text-blue-600 disabled:opacity-50">{countdown ? t('shared.resendIn', { seconds: countdown }) : t('shared.resendOtp')}</button></div></form>}
          {step === "password" && <form onSubmit={reset} className="mt-6 grid gap-3"><input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('shared.newPasswordLabel')} className="min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /><input required type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={t('shared.confirmPassword')} className="min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /><button disabled={submitting || password.length < 8 || password !== confirmPassword} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 font-bold text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}{t('shared.resetPassword')}</button></form>}
        </>}
      </div>
      </main>
    </div>
  );
}
