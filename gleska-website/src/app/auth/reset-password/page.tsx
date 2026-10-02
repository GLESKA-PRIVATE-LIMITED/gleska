"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import AuthPasswordField from "@/components/auth/AuthPasswordField";
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

  return (
    <AuthPageFrame>
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <Link href="/auth/signin" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-600 transition hover:text-indigo-600 dark:text-blue-400 dark:hover:text-indigo-300">
          <ArrowLeft size={16} /> {t('shared.back')}
        </Link>
        {checkingSession ? (
          <div className="flex min-h-40 items-center justify-center text-blue-600 dark:text-blue-400" role="status">
            <Loader2 className="animate-spin" />
          </div>
        ) : ready ? (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <h1 className="font-[var(--font-anton)] text-3xl uppercase leading-tight text-slate-900 dark:text-white sm:text-4xl">{t('shared.newPasswordLabel')}</h1>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('auth.newPasswordHelper')}</p>
            </div>
            <AuthPasswordField id="new-password" label={t('shared.newPasswordLabel')} value={password} onChange={setPassword} autoComplete="new-password" minLength={8} strengthLabel="Password strength" requirementsText={t('shared.passwordRequirements')} />
            <AuthPasswordField id="confirm-password" label={t('shared.confirmPassword')} value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={8} />
            <button disabled={saving} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50">
              {saving && <Loader2 size={16} className="animate-spin" />}{t('shared.updatePassword')}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <h1 className="font-[var(--font-anton)] text-3xl uppercase leading-tight text-slate-900 dark:text-white sm:text-4xl">{t('shared.resetPassword')}</h1>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('auth.newPasswordHelper')}</p>
            </div>
            <Link href="/auth/forgot-password" className="flex min-h-14 w-full items-center justify-center rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 px-4 text-center font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:opacity-95">
              {t('nav.forgotPassword')}
            </Link>
          </div>
        )}
      </section>
    </AuthPageFrame>
  );
}