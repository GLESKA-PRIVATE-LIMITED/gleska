"use client";

import React from "react";
import Link from "next/link";
import { Loader2, MapPin, RefreshCw } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import AccountManagementShell from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";

type JobDetails = {
  job_id: string;
  match_id: string;
  title: string;
  employer_name?: string | null;
  site_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  salary: number;
  headcount: number;
  min_experience?: number | null;
  status: string;
  expires_at?: string | null;
  created_at?: string | null;
  target_lat?: number | null;
  target_lng?: number | null;
};

export default function WorkerJobDetailsPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const { user, isLoading, logout } = useAuth();
  const [job, setJob] = React.useState<JobDetails | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    if (!user || user.role !== "WORKER" || !params.jobId) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<JobDetails>(`/api/v1/workers/me/jobs/${encodeURIComponent(params.jobId)}`);
      setJob(response.data);
    } catch (requestError) {
      const detail = (requestError as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setError(detail === "JOB_NOT_AVAILABLE_TO_WORKER" ? "This job is not available to your worker account." : "Unable to load this job right now.");
    } finally {
      setLoading(false);
    }
  }, [params.jobId, user]);

  React.useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) router.replace("/worker/auth");
    void load();
  }, [isLoading, load, router, user]);

  return <AccountManagementShell kind="worker" name={user?.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void logout()}><main className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Job details</p><h1 className="mt-2 text-3xl font-bold">{job?.title || "Job"}</h1></div><button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold"><RefreshCw size={16} /> Refresh</button></div>{loading ? <div className="mt-8 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" /> Loading job details...</div> : error ? <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-3 font-bold underline">Try again</button></div> : job && <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-lg font-bold">{job.employer_name || "Employer"}</p><p className="mt-1 text-sm text-slate-500">{job.status}</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">₹{job.salary}/day</span></div><div className="mt-7 grid gap-5 text-sm sm:grid-cols-2"><p><span className="block text-xs uppercase tracking-wide text-slate-400">Work site</span><strong className="mt-1 block">{job.site_name || "Work site"}</strong><span className="mt-1 block text-slate-500">{[job.address, job.city, job.state].filter(Boolean).join(", ") || "Address unavailable"}</span></p><p><span className="block text-xs uppercase tracking-wide text-slate-400">Requirements</span><strong className="mt-1 block">{job.min_experience == null ? "Experience not specified" : `${job.min_experience} years experience`}</strong><span className="mt-1 block text-slate-500">Headcount: {job.headcount}</span></p></div>{job.target_lat != null && job.target_lng != null && <a href={`https://www.google.com/maps/search/?api=1&query=${job.target_lat},${job.target_lng}`} target="_blank" rel="noreferrer" className="mt-7 inline-flex items-center gap-2 rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-bold text-blue-700"><MapPin size={17} /> Open site map</a>}<p className="mt-7 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Job acceptance and status changes are managed by the existing matching workflow.</p></section>}<Link href="/worker/jobs" className="mt-8 inline-block text-sm font-bold text-blue-700">Back to jobs</Link></main></AccountManagementShell>;
}
