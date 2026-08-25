"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { initializeMSG91Widget, normalizeIndianMobile, sendOTP, verifyOTP, retryOTP } from "@/lib/msg91";

type Step = "phone" | "otp" | "password" | "success";

export default function ForgotPasswordPage() {
  const { requestPasswordReset, verifyPasswordResetOTP, completePasswordReset } = useAuth();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetAuthorization, setResetAuthorization] = useState("");
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
      toast.error("Enter a valid 10-digit mobile number");
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset(normalizedPhone);
      await initializeMSG91Widget();
      await sendOTP(normalizedPhone);
      setPhone(normalizedPhone);
      setStep("otp");
      setCountdown(30);
      toast.success("If an account exists for this phone number, we have sent a verification code.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to send OTP");
    } finally {
      setSubmitting(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      toast.error("Enter the 6-digit verification code");
      return;
    }
    setSubmitting(true);
    try {
      const providerResult = await verifyOTP(otp);
      setResetAuthorization(await verifyPasswordResetOTP(phone, providerResult.accessToken));
      setStep("password");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Invalid or expired OTP");
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (countdown) return;
    setSubmitting(true);
    try {
      await initializeMSG91Widget();
      await retryOTP();
      setOtp("");
      setCountdown(30);
      toast.success("If an account exists for this phone number, we have sent a new verification code.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to resend OTP");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
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
      toast.error(error instanceof Error ? error.message : "Unable to reset password");
      setResetAuthorization("");
      setStep("phone");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#040d1e] px-6 text-white">
      <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-blue-300"><ArrowLeft size={16} /> Back</Link>
        {step === "success" ? <><h1 className="font-(--font-anton) text-4xl uppercase">Password updated</h1><p className="mt-4 text-sm text-slate-400">Password reset successfully. Please log in with your new password.</p><Link href="/" className="mt-8 block w-full rounded-xl bg-blue-600 py-3 text-center font-bold">Continue to login</Link></> : <>
          <h1 className="font-(--font-anton) text-4xl uppercase">Reset password</h1>
          <p className="mt-3 text-sm text-slate-400">{step === "phone" ? "Enter your registered phone number." : step === "otp" ? "Enter the 6-digit code sent to your phone." : "Create a new password for your account."}</p>
          {step === "phone" && <form onSubmit={requestOTP} className="mt-8 space-y-4"><div className="flex items-center rounded-xl border border-slate-600 bg-slate-800 px-4"><span className="mr-2 text-sm font-semibold text-slate-300">+91</span><input required inputMode="numeric" value={phone.replace(/^91/, "")} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Phone number" className="min-w-0 flex-1 bg-transparent py-3 text-white outline-none" /></div><button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}Send OTP</button></form>}
          {step === "otp" && <form onSubmit={verify} className="mt-8 space-y-4"><input autoFocus required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-4 text-center text-2xl font-bold tracking-[0.4em] text-white outline-none" /><button disabled={submitting || otp.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}Verify OTP</button><div className="flex justify-between text-xs"><button type="button" onClick={() => { setStep("phone"); setOtp(""); }} className="text-slate-400">Change phone</button><button type="button" disabled={Boolean(countdown) || submitting} onClick={resend} className="text-blue-300 disabled:opacity-50">{countdown ? `Resend in ${countdown}s` : "Resend OTP"}</button></div></form>}
          {step === "password" && <form onSubmit={reset} className="mt-8 space-y-4"><input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" className="w-full rounded-xl bg-slate-800 px-4 py-3 outline-none" /><input required type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm password" className="w-full rounded-xl bg-slate-800 px-4 py-3 outline-none" /><button disabled={submitting || password.length < 8 || password !== confirmPassword} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}Reset password</button></form>}
        </>}
      </div>
    </main>
  );
}
