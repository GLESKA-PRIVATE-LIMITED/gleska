"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import AuthPasswordField from "@/components/auth/AuthPasswordField";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import apiClient from "@/lib/api";
import { initializeMSG91Widget, normalizeIndianMobile, otpUserMessage, runWithOtpOperationLock, sendOTP, verifyOTP, retryOTP } from "@/lib/msg91";

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
    try {
      await runWithOtpOperationLock("send", async (operationLock) => {
        setSubmitting(true);
        try {
          setRequestId(null);
          setOtp("");
          const retryAfter = await requestPasswordReset(normalizedPhone);
          if (retryAfter) {
            setCountdown(retryAfter);
            throw new Error(`OTP_RESEND_COOLDOWN ${retryAfter} seconds`);
          }
          await initializeMSG91Widget();
          setRequestId(null);
          const transaction = await sendOTP(normalizedPhone, operationLock);
          setRequestId(transaction.requestId);
          setPhone(normalizedPhone);
          setStep("otp");
          setCountdown(30);
          toast.success(t('auth.resetSent'));
        } catch (error: unknown) {
          const waitMatch = otpUserMessage(error, "send").match(/Please wait (\d+) seconds/);
          if (waitMatch) setCountdown(Number(waitMatch[1]));
          toast.error(otpUserMessage(error, "send"));
        } finally {
          setSubmitting(false);
        }
      });
    } catch (error: unknown) {
      toast.error(otpUserMessage(error, "send"));
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
      setRequestId(null);
      setOtp("");
      setStep("password");
    } catch (error: unknown) {
      toast.error(otpUserMessage(error, "verify"));
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
      setRequestId(transaction.requestId ?? requestId);
      setOtp("");
      setCountdown(30);
      toast.success(t('auth.resetSentAgain'));
    } catch (error: unknown) {
      toast.error(otpUserMessage(error, "resend"));
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
      setRequestId(null);
      setOtp("");
      setPassword("");
      setConfirmPassword("");
      setCountdown(0);
      setStep("success");
    } catch (error: unknown) {
      toast.error(otpUserMessage(error, "verify"));
      setResetAuthorization("");
      setStep("phone");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageFrame>
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <Link href="/auth/signin" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-600 transition hover:text-indigo-600 dark:text-blue-400 dark:hover:text-indigo-300"><ArrowLeft size={16} /> {t('shared.back')}</Link>
        {step === "success" ? (
          <>
            <h1 className="font-[var(--font-anton)] text-3xl uppercase leading-tight text-slate-900 dark:text-white sm:text-4xl">{t('auth.passwordUpdated')}</h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('auth.passwordResetSuccess')}</p>
            <Link href="/auth/signin" className="mt-6 flex min-h-14 w-full items-center justify-center rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 text-center font-bold text-white shadow-lg shadow-indigo-500/20">{t('shared.continueLogin')}</Link>
          </>
        ) : (
          <>
            <h1 className="font-[var(--font-anton)] text-3xl uppercase leading-tight text-slate-900 dark:text-white sm:text-4xl">{t('shared.resetPassword')}</h1>
            <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">{step === "phone" ? t('shared.enterPhone') : step === "otp" ? t('shared.enterCode', { phone: phone || t('shared.phone') }) : t('auth.newPasswordHelper')}</p>
            {step === "phone" && (
              <form onSubmit={requestOTP} className="mt-6 grid gap-3">
                <div className="flex min-h-14 items-center rounded-xl border border-slate-200 bg-white px-4 transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 dark:border-slate-700/80 dark:bg-slate-800/90 dark:focus-within:border-indigo-500 dark:focus-within:ring-indigo-900/40">
                  <span className="mr-2 text-sm font-semibold text-slate-500 dark:text-slate-400">+91</span>
                  <input required inputMode="numeric" value={phone.replace(/^91/, "")} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder={t('auth.mobileLabel')} className="min-w-0 flex-1 bg-transparent py-3 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500" />
                </div>
                <button disabled={submitting || Boolean(countdown)} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}{countdown ? t('shared.resendIn', { seconds: countdown }) : t('shared.sendOtp')}</button>
              </form>
            )}
            {step === "otp" && (
              <form onSubmit={verify} className="mt-6 grid gap-3">
                <input autoFocus required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/40" />
                <button disabled={submitting || otp.length !== 6} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}{t('shared.verifyOtp')}</button>
                <div className="flex min-h-11 items-center justify-between gap-3 text-xs">
                  <button type="button" onClick={() => { setStep("phone"); setOtp(""); }} className="font-semibold text-slate-500 transition hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300">{t('auth.changePhone')}</button>
                  <button type="button" disabled={Boolean(countdown) || submitting} onClick={resend} className="font-semibold text-blue-600 transition hover:text-indigo-600 disabled:opacity-50 dark:text-blue-400 dark:hover:text-indigo-300">{countdown ? t('shared.resendIn', { seconds: countdown }) : t('shared.resendOtp')}</button>
                </div>
              </form>
            )}
            {step === "password" && (
              <form onSubmit={reset} className="mt-6 grid gap-4">
                <AuthPasswordField id="reset-new-password" label={t('shared.newPasswordLabel')} value={password} onChange={setPassword} autoComplete="new-password" minLength={8} maxLength={128} strengthLabel="Password strength" requirementsText={t('shared.passwordRequirements')} />
                <AuthPasswordField id="reset-confirm-password" label={t('shared.confirmPassword')} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={8} maxLength={128} />
                <button disabled={submitting || password.length < 8 || password !== confirmPassword} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}{t('shared.resetPassword')}</button>
              </form>
            )}
          </>
        )}
      </section>
    </AuthPageFrame>
  );
}
