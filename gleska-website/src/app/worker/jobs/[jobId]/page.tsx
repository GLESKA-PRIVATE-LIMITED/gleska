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
  required_skills?: string[];
  work_duration_days?: number | null;
  work_timing?: string | null;
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
    if (!isLoading && (!user || user.role !== "WORKER")) {
      router.replace("/worker/auth");
      return;
    }
    void Promise.resolve().then(() => load());
  }, [isLoading, load, router, user]);

  const handleLogout = async () => {
    await logout();
  };

  const address = [job?.address, job?.city, job?.state].filter(Boolean).join(", ");

  return (
    <AccountManagementShell kind="worker" name={user?.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void handleLogout()}>
      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <Link href="/worker/dashboard" className="text-sm font-bold text-blue-700 hover:text-blue-800">Back to dashboard</Link>
        {loading ? <div className="flex items-center gap-2 py-12 text-sm text-slate-500"><Loader2 size={20} className="animate-spin" /> Loading job details...</div> : error ? <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 font-bold underline"><RefreshCw size={16} /> Try again</button></section> : job ? <>
          <header className="rounded-3xl bg-linear-to-br from-amber-50 to-yellow-50 p-6 dark:from-amber-950/20 dark:to-yellow-950/20"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Job details</p><div className="mt-3 flex items-start justify-between gap-4"><div><h1 className="text-3xl font-bold text-slate-900 dark:text-white">{job.title}</h1><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{job.employer_name || "Employer unavailable"}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">{job.status}</span></div></header>
          <div className="grid gap-6 md:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-bold">Work site</h2><p className="mt-4 font-semibold">{job.site_name || "Site unavailable"}</p>{address && <p className="mt-2 wrap-break-word text-sm text-slate-500">{address}</p>}<div className="mt-4 flex items-center gap-2 text-sm text-slate-500"><MapPin size={16} />{job.target_lat != null && job.target_lng != null ? "Location available" : "Location unavailable"}</div></section>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-bold">Requirements</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-500">Workers needed</dt><dd className="font-semibold">{job.headcount}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Minimum experience</dt><dd className="font-semibold">{job.min_experience != null ? `${job.min_experience} years` : "Not specified"}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Daily wage</dt><dd className="font-semibold">₹{job.salary}/day</dd></div></dl>{job.required_skills?.length ? <div className="mt-5"><p className="text-sm font-semibold">Required skills</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">{job.required_skills.map((skill) => <li key={skill}>{skill}</li>)}</ul></div> : null}</section>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:col-span-2"><h2 className="text-lg font-bold">Work details</h2><div className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><p className="text-slate-500">Work duration</p><p className="mt-1 font-semibold">{job.work_duration_days != null ? `${job.work_duration_days} days` : "Not specified"}</p></div><div><p className="text-slate-500">Daily timing</p><p className="mt-1 font-semibold">{job.work_timing || "Not specified"}</p></div></div></section>
          </div>
        </> : null}
      </main>
    </AccountManagementShell>
  );
}