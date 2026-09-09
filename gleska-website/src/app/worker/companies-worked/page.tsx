"use client";

import React from "react";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import AccountManagementShell from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";

type WorkRecord = { match_id: string; job_id: string; title: string; employer_name?: string | null; status: string; completed_at?: string | null; salary?: number };

export default function WorkerCompaniesWorkedPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [records, setRecords] = React.useState<WorkRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setLoading(true);
    try {
      const response = await apiClient.get<{ recent_jobs?: WorkRecord[] }>("/api/v1/workers/me/jobs");
      setRecords(response.data.recent_jobs || []);
    } catch {
      setError("Unable to load your work history right now.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  React.useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) router.replace("/worker/auth");
    void load();
  }, [isLoading, load, router, user]);

  return <AccountManagementShell kind="worker" name={user?.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void logout()}><main className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Worker workspace</p><h1 className="mt-2 text-3xl font-bold">Companies worked</h1><p className="mt-2 text-sm text-slate-500">Completed jobs from your accepted work history.</p>{loading ? <div className="mt-8 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" /> Loading work history...</div> : error ? <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-3 font-bold underline">Try again</button></div> : records.length ? <div className="mt-8 grid gap-4 md:grid-cols-2">{records.map((record) => <article key={record.match_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-blue-50 p-2 text-blue-700"><Building2 size={20} /></div><div><h2 className="font-bold">{record.employer_name || "Employer"}</h2><p className="mt-1 text-sm text-slate-600">{record.title || "Completed job"}</p></div></div><CheckCircle2 size={19} className="text-emerald-600" /></div><p className="mt-5 text-xs font-bold uppercase tracking-wide text-slate-400">Completed</p><p className="mt-1 text-sm text-slate-600">{record.completed_at ? new Date(record.completed_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Date unavailable"}</p></article>)}</div> : <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500"><Building2 size={30} className="mx-auto mb-3 text-slate-400" />No completed work records yet.</div>}</main></AccountManagementShell>;
}