"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { getRouteForNextStep } from "@/lib/auth-routing";
import { normalizeIndianMobile } from "@/lib/msg91";

type Role = "WORKER" | "EMPLOYER";
type OTPTransaction = { name: string; email: string; password: string; mobile: string };

export default function AuthMethodPanel({ role }: { role: Role }) {
  const router = useRouter();
  const { signInWithEmail, signInWithGoogle, resolveGoogleSession, signupPreflight, requestOTP, resendOTP, completeEmailSignup, loginWithMobile, refreshUser, isLoading: authLoading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginMethod, setLoginMethod] = useState<"email" | "mobile">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [otpTransaction, setOtpTransaction] = useState<OTPTransaction | null>(null);
  const [otp, setOtp] = useState("");
  const [otpOpen, setOtpOpen] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [otpPurpose, setOtpPurpose] = useState<"signup" | "login">("signup");
  const oauthHandled = useRef(false);

  const clearOtpTransaction = () => {
    setOtpTransaction(null);
    setOtp("");
    setOtpOpen(false);
    setCountdown(0);
  };

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    const oauthRole = sessionStorage.getItem("goleska_oauth_role");
    if (authLoading || oauthRole !== role || oauthHandled.current) return;
    oauthHandled.current = true;
    resolveGoogleSession(role)
      .then(({ role: authenticatedRole, nextStep }) => {
        sessionStorage.removeItem("goleska_oauth_role");
        router.replace(getRouteForNextStep(authenticatedRole, nextStep));
      })
      .catch((error: Error) => toast.error(error.message || "Google authentication failed"))
      .finally(() => setSubmitting(false));
  }, [authLoading, role, resolveGoogleSession, router]);

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "login" && loginMethod === "mobile") {
      const canonicalMobile = normalizeIndianMobile(mobile);
      if (canonicalMobile.length !== 12 || !canonicalMobile.startsWith("91")) {
        toast.error("Enter a valid 10-digit mobile number");
        return;
      }
      setSubmitting(true);
      try {
        await requestOTP(canonicalMobile);
        setOtpTransaction({ name: "", email: "", password: "", mobile: canonicalMobile });
        setOtpPurpose("login");
        setOtp("");
        setCountdown(30);
        setOtpOpen(true);
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : "Unable to send OTP");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (!email || password.length < 8 || (mode === "signup" && (!name.trim() || mobile.length !== 10 || confirmPassword !== password))) {
      toast.error(mode === "signup" ? "Enter all fields and make sure both passwords match" : "Enter a valid email and password");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const canonicalMobile = normalizeIndianMobile(mobile);
        await signupPreflight(name, email, canonicalMobile, password, confirmPassword, role);
        await requestOTP(canonicalMobile);
        setOtpTransaction({ name, email, password, mobile: canonicalMobile });
        setOtpPurpose("signup");
        setOtp("");
        setCountdown(30);
        setOtpOpen(true);
        toast.success("OTP sent. Verify your phone to create the account.");
      } else {
        await signInWithEmail(email, password, role);
        const nextStep = await refreshUser();
        toast.success("Welcome back");
        router.push(getRouteForNextStep(role, nextStep));
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const verifySignupOTP = async (event: FormEvent) => {
    event.preventDefault();
    if (!otpTransaction || otp.length !== 6) {
      toast.error("Enter the 6-digit verification code");
      return;
    }
    setSubmitting(true);
    try {
      if (otpPurpose === "signup") {
        await completeEmailSignup(otpTransaction.email, otpTransaction.password, otpTransaction.name, otpTransaction.mobile, otp, role);
      } else {
        await loginWithMobile(otpTransaction.mobile, otp, role);
      }
      const nextStep = await refreshUser();
      clearOtpTransaction();
      toast.success(otpPurpose === "signup" ? "Account created successfully" : "Welcome back");
      router.push(getRouteForNextStep(role, nextStep));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Invalid or expired OTP");
    } finally {
      setSubmitting(false);
    }
  };

  const resendSignupOTP = async () => {
    setSubmitting(true);
    try {
      await resendOTP();
      setCountdown(30);
      toast.success("A new verification code was sent");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to resend OTP");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-6 space-y-4 border-b border-slate-700 pb-6">
      <div className="flex gap-2 text-xs font-bold uppercase tracking-wider">
        <button type="button" onClick={() => { clearOtpTransaction(); setMode("login"); }} className={`rounded-lg px-3 py-2 ${mode === "login" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400"}`}>Login</button>
        <button type="button" onClick={() => { clearOtpTransaction(); setMode("signup"); }} className={`rounded-lg px-3 py-2 ${mode === "signup" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400"}`}>Sign up</button>
      </div>
      {mode === "login" && <div className="flex rounded-xl bg-slate-800 p-1 text-xs font-semibold"><button type="button" onClick={() => { clearOtpTransaction(); setLoginMethod("email"); }} className={`flex-1 rounded-lg py-2 ${loginMethod === "email" ? "bg-slate-600 text-white" : "text-slate-400"}`}>Email & password</button><button type="button" onClick={() => { clearOtpTransaction(); setLoginMethod("mobile"); }} className={`flex-1 rounded-lg py-2 ${loginMethod === "mobile" ? "bg-slate-600 text-white" : "text-slate-400"}`}>Mobile OTP</button></div>}
      <form onSubmit={submitEmail} className="space-y-3">
        {mode === "signup" && <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none" />}
        {mode === "login" && loginMethod === "mobile" && <div className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4"><span className="text-sm font-semibold text-slate-300">+91</span><input value={mobile} onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Phone number" className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none" /></div>}
        {!(mode === "login" && loginMethod === "mobile") && <div className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4">
          <Mail size={16} className="text-slate-400" />
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none" />
        </div>}
        {!(mode === "login" && loginMethod === "mobile") && <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password (8+ characters)" className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none" />}
        {mode === "signup" && <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm password" className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none" />}
        {mode === "signup" && <div className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4"><span className="text-sm font-semibold text-slate-300">+91</span><input value={mobile} onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Phone number" className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none" /></div>}
        <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-500 bg-blue-500/10 py-3 text-sm font-bold text-blue-200 transition hover:bg-blue-500/20 disabled:opacity-50">
          {submitting && <Loader2 size={16} className="animate-spin" />}{mode === "signup" ? "Verify phone & create account" : loginMethod === "mobile" ? "Send mobile OTP" : "Login with email"}
        </button>
      </form>
      {mode === "login" && <a href="/auth/forgot-password" className="block text-center text-xs font-semibold text-blue-300 hover:text-blue-200">Forgot password?</a>}
      <button type="button" disabled={submitting} onClick={() => { clearOtpTransaction(); setSubmitting(true); signInWithGoogle(role).catch((error: Error) => { toast.error(error.message); setSubmitting(false); }); }} className="w-full rounded-xl border border-slate-600 bg-white py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-100 disabled:opacity-50">Continue with Google</button>
      <p className="text-center text-xs text-slate-400">{mode === "signup" ? "Phone verification is required before onboarding" : "Secure sign-in with your email or Google"}</p>

      {otpOpen && otpTransaction && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-slate-950/80 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="otp-title">
          <div className="relative w-full max-w-sm rounded-2xl border border-slate-600 bg-slate-900 p-6 shadow-2xl">
            <button type="button" onClick={clearOtpTransaction} className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white" aria-label="Close verification dialog"><X size={18} /></button>
            <div className="mb-6 pr-8">
              <p className="text-xs font-bold uppercase tracking-widest text-blue-300">{otpPurpose === "signup" ? "Secure signup" : "Secure login"}</p>
              <h2 id="otp-title" className="mt-2 text-2xl font-bold text-white">{otpPurpose === "signup" ? "Verify your phone" : "Sign in with mobile"}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">Enter the 6-digit code sent to <span className="font-semibold text-slate-200">+91 {otpTransaction.mobile.replace(/^91/, "")}</span>.</p>
            </div>
            <form onSubmit={verifySignupOTP} className="space-y-5">
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" aria-label="6-digit verification code" className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-4 text-center text-2xl font-bold tracking-[0.45em] text-white outline-none transition focus:border-blue-400" />
              <button type="submit" disabled={submitting || otp.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">{submitting && <Loader2 size={17} className="animate-spin" />} {submitting ? "Verifying..." : otpPurpose === "signup" ? "Verify & create account" : "Verify & sign in"}</button>
              <div className="flex items-center justify-between text-xs"><button type="button" onClick={clearOtpTransaction} className="font-semibold text-slate-400 hover:text-white">Cancel</button><button type="button" disabled={countdown > 0 || submitting} onClick={resendSignupOTP} className="font-semibold text-blue-300 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-50">{countdown > 0 ? `Resend in ${countdown}s` : "Resend OTP"}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}