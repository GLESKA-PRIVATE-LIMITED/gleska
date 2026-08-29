"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Loader2, X, Shield, FileText, CheckCircle2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { getRouteForNextStep } from "@/lib/auth-routing";
import { normalizeIndianMobile } from "@/lib/msg91";

type Role = "WORKER" | "EMPLOYER";
type OTPTransaction = { name: string; email: string; password: string; mobile: string; termsAccepted: boolean };

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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
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
        setOtpTransaction({ name: "", email: "", password: "", mobile: canonicalMobile, termsAccepted: false });
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

    if (mode === "signup") {
      if (!name.trim()) {
        toast.error("Please enter your full name");
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email.trim() || !emailRegex.test(email.trim())) {
        toast.error("Please enter a valid email address");
        return;
      }
      if (!password) {
        toast.error("Please enter a password");
        return;
      }
      if (password.length < 8) {
        toast.error("Password must be at least 8 characters");
        return;
      }
      if (!confirmPassword) {
        toast.error("Please confirm your password");
        return;
      }
      if (password !== confirmPassword) {
        toast.error("Passwords do not match");
        return;
      }
      const rawMobileDigits = mobile.replace(/\D/g, "");
      if (!rawMobileDigits || rawMobileDigits.length !== 10) {
        toast.error("Please enter a valid 10-digit mobile number");
        return;
      }
      if (!termsAccepted) {
        toast.error("Please accept the Terms & Conditions to continue.");
        return;
      }
    } else {
      if (!email.trim() || password.length < 8) {
        toast.error("Enter a valid email and password");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === "signup") {
        const canonicalMobile = normalizeIndianMobile(mobile);
        await signupPreflight(name, email, canonicalMobile, password, confirmPassword, role, termsAccepted);
        await requestOTP(canonicalMobile);
        setOtpTransaction({ name, email, password, mobile: canonicalMobile, termsAccepted });
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

  const handleGoogleAuth = () => {
    if (mode === "signup" && !termsAccepted) {
      toast.error("Please accept the Terms & Conditions before continuing.");
      return;
    }
    clearOtpTransaction();
    setSubmitting(true);
    signInWithGoogle(role).catch((error: Error) => {
      toast.error(error.message);
      setSubmitting(false);
    });
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
        await completeEmailSignup(
          otpTransaction.email,
          otpTransaction.password,
          otpTransaction.name,
          otpTransaction.mobile,
          otp,
          role,
          otpTransaction.termsAccepted,
        );
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

  const termsSummaryPoints = [
    "Users must provide accurate, current, and complete information when registering and maintaining their account.",
    "Users must be at least 18 years old unless an individual service explicitly permits otherwise.",
    "Persons registering a Business warrant they hold the authority required to bind and represent that business.",
    "Users must not impersonate any person or entity, or provide false or misleading information.",
    "Users must not submit fraudulent, forged, or altered documents.",
    "Workers are responsible for accurately representing their identity, qualifications, experience, availability, and documents.",
    "GO LESKA connects Businesses and Workers as independent parties but does not become the employer of the Worker.",
    "GO LESKA does not guarantee employment, engagement, wages, or any specific hiring outcome.",
    "Businesses and Workers remain solely responsible for their own employment/service relationship, contracts, and statutory compliance.",
    "Payments between Businesses and Workers are handled directly between them unless GO LESKA explicitly states otherwise.",
    "GO LESKA may perform identity, business, and compliance verification checks to preserve platform safety and integrity.",
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
        
        {mode === "signup" && (
          <div className="flex items-start gap-3 pt-1">
            <input
              type="checkbox"
              id="terms-acceptance"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-800 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 focus:outline-none cursor-pointer"
            />
            <label htmlFor="terms-acceptance" className="text-xs leading-relaxed text-slate-300 select-none cursor-pointer">
              I have read and agree to the{" "}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTermsModalOpen(true);
                }}
                className="font-semibold text-blue-300 underline transition hover:text-blue-200 focus:outline-none"
              >
                Terms &amp; Conditions
              </button>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || (mode === "signup" && !isManualSignupComplete)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-500 bg-blue-500/10 py-3 text-sm font-bold text-blue-200 transition hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}{mode === "signup" ? "Verify phone & create account" : loginMethod === "mobile" ? "Send mobile OTP" : "Login with email"}
        </button>
      </form>
      {mode === "login" && <a href="/auth/forgot-password" className="block text-center text-xs font-semibold text-blue-300 hover:text-blue-200">Forgot password?</a>}
      <button
        type="button"
        disabled={submitting || (mode === "signup" && !termsAccepted)}
        onClick={handleGoogleAuth}
        className="w-full rounded-xl border border-slate-600 bg-white py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue with Google
      </button>
      <p className="text-center text-xs text-slate-400">{mode === "signup" ? "Phone verification is required before onboarding" : "Secure sign-in with your email or Google"}</p>

      {/* TERMS & CONDITIONS SUMMARY MODAL */}
      {termsModalOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 p-4 sm:p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-modal-title"
          onClick={() => setTermsModalOpen(false)}
        >
          <div
            className="relative flex w-full max-w-xl max-h-[85vh] flex-col rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/80 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-700/80 px-6 py-5 bg-slate-900/90">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Shield size={20} />
                </div>
                <div>
                  <h2 id="terms-modal-title" className="text-lg font-bold text-white">
                    Terms &amp; Conditions Summary
                  </h2>
                  <p className="text-xs text-slate-400">
                    Important rules and relationship summary
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTermsModalOpen(false)}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-sm leading-relaxed text-slate-300">
              <div className="space-y-3">
                {termsSummaryPoints.map((point, index) => (
                  <div key={index} className="flex items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-800/40 p-3.5">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-blue-400" />
                    <p className="text-xs sm:text-sm font-medium text-slate-200">{point}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-xs font-medium text-blue-200">
                By creating an account, you confirm that you have read and agree to the Terms &amp; Conditions.
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-700/80 bg-slate-900/90 px-6 py-4">
              <Link
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-400 hover:text-blue-300 underline transition"
              >
                <FileText size={14} />
                View Full Terms
                <ExternalLink size={12} />
              </Link>
              <button
                type="button"
                onClick={() => setTermsModalOpen(false)}
                className="rounded-xl bg-slate-800 border border-slate-700 px-5 py-2 text-sm font-bold text-slate-200 transition hover:bg-slate-700 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OTP VERIFICATION DIALOG */}
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