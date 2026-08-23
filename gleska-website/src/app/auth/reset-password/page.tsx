"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session))); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password !== confirm) return toast.error("Use 8+ characters and matching passwords");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    router.push("/");
  };

  if (!ready) return <main className="flex min-h-screen items-center justify-center bg-[#040d1e] text-white"><Loader2 className="animate-spin" /></main>;
  return <main className="flex min-h-screen items-center justify-center bg-[#040d1e] px-6 text-white"><form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl border border-slate-700 bg-slate-900 p-8"><h1 className="font-[var(--font-anton)] text-4xl uppercase">New password</h1><input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" className="w-full rounded-xl bg-slate-800 px-4 py-3 outline-none" /><input required type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Confirm password" className="w-full rounded-xl bg-slate-800 px-4 py-3 outline-none" /><button disabled={saving} className="w-full rounded-xl bg-blue-600 py-3 font-bold disabled:opacity-50">Update password</button></form></main>;
}