"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Save, Zap } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

type Profile = {
  trade_id?: string | null;
  experience_years?: number | null;
  expected_daily_wage?: number | null;
  city?: string | null;
  state?: string | null;
  availability_status: "AVAILABLE" | "ON_JOB" | "OFFLINE";
};

export default function WorkerProfilePage() {
  const router = useRouter();
  const { user, isLoading, refreshUser } = useAuth();
  const [profile, setProfile] = useState<Profile>({ availability_status: "OFFLINE" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) router.push("/worker/auth");
    if (isLoading || !user || user.role !== "WORKER") return;
    apiClient.get("/api/v1/workers/me").then((response) => setProfile(response.data)).catch(() => toast.error("Unable to load your profile")).finally(() => setLoading(false));
  }, [isLoading, user, router]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await apiClient.put("/api/v1/workers/me", profile);
      setProfile(response.data);
      toast.success("Profile saved");
      const nextStep = await refreshUser();
      if (nextStep === "DASHBOARD") router.push("/worker/dashboard");
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Unable to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || loading || !user) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <main className="min-h-screen bg-[#eef1fb] px-6 py-10 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto max-w-2xl">
        <Link href="/worker/dashboard" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-indigo-600"><ArrowLeft size={16} /> Back to dashboard</Link>
        <div className="mb-8 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600"><Zap size={18} className="text-white" /></div><h1 className="font-(--font-anton) text-4xl uppercase">Your profile</h1></div>
        <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <label className="block text-sm font-semibold">Trade or skill<input value={profile.trade_id || ""} onChange={(e) => setProfile({ ...profile, trade_id: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-800" placeholder="e.g. electrician" /></label>
          <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-semibold">Experience years<input type="number" min="0" value={profile.experience_years ?? ""} onChange={(e) => setProfile({ ...profile, experience_years: e.target.value ? Number(e.target.value) : null })} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-800" /></label><label className="block text-sm font-semibold">Expected daily wage<input type="number" min="0" value={profile.expected_daily_wage ?? ""} onChange={(e) => setProfile({ ...profile, expected_daily_wage: e.target.value ? Number(e.target.value) : null })} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-800" /></label></div>
          <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-semibold">City<input value={profile.city || ""} onChange={(e) => setProfile({ ...profile, city: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-800" /></label><label className="block text-sm font-semibold">State<input value={profile.state || ""} onChange={(e) => setProfile({ ...profile, state: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-800" /></label></div>
          <label className="block text-sm font-semibold">Availability<select value={profile.availability_status} onChange={(e) => setProfile({ ...profile, availability_status: e.target.value as Profile["availability_status"] })} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-800"><option value="OFFLINE">Offline</option><option value="AVAILABLE">Available</option><option value="ON_JOB">On a job</option></select></label>
          <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save profile</button>
        </form>
      </div>
    </main>
  );
}