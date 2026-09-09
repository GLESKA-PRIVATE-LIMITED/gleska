"use client";

import React from "react";
import Link from "next/link";
import { AlertCircle, Loader2, MapPin, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import AccountManagementShell from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";

type WorkerJob = {
  job_id: string;
  title: string;
  salary: number;
  headcount: number;
  min_experience: number | null;
  employer_name: string;
  distance_km: number | null;
};

export default function WorkerJobsPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [jobs, setJobs] = React.useState<WorkerJob[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<{ jobs: WorkerJob[] }>("/api/v1/workers/me/available-jobs");
      setJobs(response.data.jobs || []);
    } catch (requestError) {
      const detail = (requestError as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setError(detail === "CURRENT_LOCATION_REQUIRED" ? "Add a current location to see jobs near you." : "Unable to load nearby jobs right now.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  React.useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) router.replace("/worker/auth");
    void load();
  }, [isLoading, load, router, user]);

  return <AccountManagementShell kind="worker" name={user?.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void logout()}><main className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Work</p><h1 className="mt-2 text-3xl font-bold">Jobs near you</h1><p className="mt-2 text-sm text-slate-500">Eligible searching jobs matched to your worker profile and location.</p></div><button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold"><RefreshCw size={16} /> Refresh</button></div>{loading ? <div className="mt-8 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" /> Loading nearby jobs...</div> : error ? <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800"><p>{error}</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => void load()} className="font-bold underline">Try again</button>{error.includes("location") && <Link href="/worker/profile" className="font-bold underline">Open profile</Link>}</div></div> : jobs.length ? <div className="mt-8 grid gap-4 md:grid-cols-2">{jobs.map((job) => <article key={job.job_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold">{job.title}</h2><p className="mt-1 text-sm text-slate-500">{job.employer_name}</p></div><MapPin size={20} className="shrink-0 text-blue-700" /></div><div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4"><p><span className="block text-xs text-slate-400">Pay</span><strong>₹{job.salary}/day</strong></p><p><span className="block text-xs text-slate-400">Distance</span><strong>{job.distance_km == null ? "-" : `${job.distance_km} km`}</strong></p><p><span className="block text-xs text-slate-400">Experience</span><strong>{job.min_experience == null ? "Any" : `${job.min_experience} yrs`}</strong></p><p><span className="block text-xs text-slate-400">Workers</span><strong>{job.headcount}</strong></p></div><p className="mt-5 text-xs text-slate-500">Applications and job acceptance are managed by the existing matching workflow.</p></article>)}</div> : <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500"><AlertCircle size={30} className="mx-auto mb-3 text-slate-400" />No eligible nearby jobs are available.</div>}</main></AccountManagementShell>;
}