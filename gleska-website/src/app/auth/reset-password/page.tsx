"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import LanguageSelector from "@/components/landing/LanguageSelector";
import { useLanguage } from "@/context/LanguageContext";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setReady(Boolean(data.session));
    }).catch(() => {
      if (active) setReady(false);
    }).finally(() => {
      if (active) setCheckingSession(false);
    });
    return () => { active = false; };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password !== confirm) return toast.error(t('shared.passwordRequirements'));
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('auth.passwordUpdated'));
    router.push("/");
  };

  return <div className="min-h-screen bg-[#eef1fb] font-sans text-slate-900">
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
      <section className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-2xl shadow-slate-900/5 sm:p-8">
        {checkingSession ? <div className="flex min-h-40 items-center justify-center text-blue-600" role="status"><Loader2 className="animate-spin" /></div> : ready ? <form onSubmit={submit} className="space-y-4">
          <h1 className="font-(--font-anton) text-3xl uppercase leading-tight text-slate-900 sm:text-4xl">{t('shared.newPasswordLabel')}</h1>
          <input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('shared.newPasswordLabel')} className="min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
          <input required type="password" minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder={t('shared.confirmPassword')} className="min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
          <button disabled={saving} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 font-bold text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50">{saving && <Loader2 size={16} className="animate-spin" />}{t('shared.updatePassword')}</button>
        </form> : <div className="space-y-4">
          <h1 className="font-(--font-anton) text-3xl uppercase leading-tight text-slate-900 sm:text-4xl">{t('shared.resetPassword')}</h1>
          <Link href="/auth/forgot-password" className="flex min-h-14 w-full items-center justify-center rounded-full bg-linear-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 text-center font-bold text-white shadow-lg shadow-indigo-500/20">{t('nav.forgotPassword')}</Link>
        </div>}
      </section>
    </main>
  </div>;
}