"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Loader2, ShieldCheck, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/landing/Navbar";

export default function AdminLoginPage() {
  const router = useRouter();
  const { user, isLoading, signInWithEmail, refreshUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoading && user) {
      if (user.role === "ADMIN") {
        router.replace("/admin");
      } else {
        router.replace("/");
      }
    }
  }, [isLoading, router, user]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Enter the admin email and password.");
      return;
    }

    setSubmitting(true);
    try {
      await signInWithEmail(email.trim().toLowerCase(), password, "ADMIN");
      await refreshUser();
      router.replace("/admin");
    } catch (err: any) {
      setError(err?.message || "Admin login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] text-slate-700 dark:bg-slate-950 dark:text-slate-200">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-medium shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          <span>Checking session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col justify-between overflow-hidden bg-[#f8fafc] font-sans text-slate-900 selection:bg-blue-600 selection:text-white dark:bg-slate-950 dark:text-slate-100">
      {/* Ambient background glow accents matching GLESKA style */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-600/10" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl dark:bg-indigo-600/10" />

      {/* Top Navigation reusing shared auth Navbar */}
      <Navbar
        rightAction={
          <Link
            href="/"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400 dark:focus-visible:ring-offset-slate-900"
          >
            <ArrowLeft size={13} />
            <span>Back to home</span>
          </Link>
        }
      />

      {/* Center Sign In Card */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md">
          {/* Main Card */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
            <div className="mb-6 space-y-2.5">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-300">
                <ShieldCheck size={14} className="text-blue-600 dark:text-blue-400" />
                <span>Admin Portal</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                Admin Sign In
              </h1>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Secure internal administration and management portal
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <Mail size={13} className="text-blue-600 dark:text-blue-400" />
                  <span>Email Address</span>
                </label>
                <div className="relative">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 outline-hidden transition focus:border-blue-500 focus:bg-white focus:ring-3 focus:ring-blue-100 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:ring-blue-950/50"
                    placeholder="admin@example.com"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <Lock size={13} className="text-blue-600 dark:text-blue-400" />
                  <span>Password</span>
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-4 pr-11 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 outline-hidden transition focus:border-blue-500 focus:bg-white focus:ring-3 focus:ring-blue-100 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:ring-blue-950/50"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    tabIndex={-1}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300">
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                <span>{submitting ? "Signing in..." : "Sign In to Admin Portal"}</span>
              </button>
            </form>
          </div>

          {/* Security Compliance Note */}
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-xs font-medium text-slate-600 shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
              <ShieldCheck size={16} />
            </div>
            <p className="leading-relaxed">
              Restricted access: Authorized administrative personnel only. All access attempts and sessions are strictly audited.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">
        &copy; {new Date().getFullYear()} GO LESKA AI. All rights reserved.
      </footer>
    </div>
  );
}
