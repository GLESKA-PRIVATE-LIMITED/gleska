"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return toast.error("Enter your email address");
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to send reset email");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="flex min-h-screen items-center justify-center bg-[#040d1e] px-6 text-white"><div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-8 shadow-2xl"><Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-blue-300"><ArrowLeft size={16} /> Back</Link><h1 className="font-[var(--font-anton)] text-4xl uppercase">Reset password</h1><p className="mt-3 text-sm text-slate-400">We will send a secure Supabase recovery link to your email.</p>{sent ? <p className="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">Check your inbox for the password reset link.</p> : <form onSubmit={submit} className="mt-8 space-y-4"><div className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4"><Mail size={16} className="text-slate-400" /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" className="min-w-0 flex-1 bg-transparent py-3 text-white outline-none" /></div><button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}Send reset link</button></form>}</div></main>;
}