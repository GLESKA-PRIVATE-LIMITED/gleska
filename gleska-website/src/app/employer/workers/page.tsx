"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, BadgeCheck, ChevronLeft, ChevronRight, Loader2, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AccountManagementShell, { formatEmployerType } from "@/components/AccountManagementShell";

interface Worker {
  worker_profile_id: string;
  name: string;
  profile_photo_url?: string | null;
  trade_id?: string | null;
  skills: string[];
  experience_years?: number | null;
  expected_daily_wage?: number | string | null;
  availability_status: string;
  city?: string | null;
  state?: string | null;
  profile_completed: boolean;
  is_verified: boolean;
}

interface WorkerListResponse {
  items: Worker[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
}

interface Filters {
  search: string;
  trade: string;
  skill: string;
  min_experience: string;
  max_experience: string;
  min_wage: string;
  max_wage: string;
  availability: string;
  city: string;
  sort: string;
}

const initialFilters: Filters = {
  search: "",
  trade: "",
  skill: "",
  min_experience: "",
  max_experience: "",
  min_wage: "",
  max_wage: "",
  availability: "",
  city: "",
  sort: "name_asc",
};

function requestError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    if (typeof detail === "string" && detail === "WORKER_DIRECTORY_FAILED") return "We couldn't load workers right now.";
  }
  return "We couldn't load workers right now.";
}

function availabilityLabel(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function titleCase(value?: string | null): string {
  if (!value) return "Not specified";
  return value.trim().toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatExperience(value?: number | null): string {
  if (value == null) return "Not specified";
  return `${value} ${value === 1 ? "year" : "years"}`;
}

function formatWage(value?: number | string | null): string {
  if (value == null || !Number.isFinite(Number(value))) return "Not specified";
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}/day`;
}

export default function EmployerWorkersPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading, nextStep, logout } = useAuth();
  const [filters, setFilters] = React.useState<Filters>(initialFilters);
  const [submittedFilters, setSubmittedFilters] = React.useState<Filters>(initialFilters);
  const [workers, setWorkers] = React.useState<WorkerListResponse | null>(null);
  const [selectedWorker, setSelectedWorker] = React.useState<Worker | null>(null);
  const [page, setPage] = React.useState(1);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [reloadToken, setReloadToken] = React.useState(0);
  const [showMoreFilters, setShowMoreFilters] = React.useState(false);

  React.useEffect(() => {
    if (isAuthLoading) return;
    if (!user) {
      router.push("/employer/auth");
      return;
    }
    if (user.role !== "EMPLOYER") {
      router.push("/");
      return;
    }
    if (nextStep !== "DASHBOARD") {
      router.push("/employer/onboarding");
    }
  }, [isAuthLoading, nextStep, router, user]);

  React.useEffect(() => {
    if (isAuthLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    let active = true;
    const loadWorkers = async () => {
      setIsLoading(true);
      setError("");
      const params = new URLSearchParams({ page: String(page), limit: "12" });
      Object.entries(submittedFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      try {
        const response = await apiClient.get<WorkerListResponse>(`/api/v1/employers/me/workers?${params.toString()}`, { withCredentials: true });
        if (active) setWorkers(response.data);
      } catch (requestErrorValue: unknown) {
        if (active) setError(requestError(requestErrorValue));
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadWorkers();
    return () => {
      active = false;
    };
  }, [isAuthLoading, nextStep, page, reloadToken, submittedFilters, user]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const submitFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSubmittedFilters({ ...filters });
  };

  const clearFilters = () => {
    setFilters(initialFilters);
    setSubmittedFilters(initialFilters);
    setPage(1);
  };

  if (isAuthLoading || !user || user.role !== "EMPLOYER" || nextStep !== "DASHBOARD") {
    return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950"><Loader2 size={34} className="animate-spin text-blue-600" /></div>;
  }

  return (
    <AccountManagementShell
      kind="employer"
      name={user.name}
      accountLabel={formatEmployerType(user.employer_type)}
      profileHref="/employer/company-profile"
      onLogout={() => void logout()}
    >
      <main className="min-h-screen px-4 py-8 text-slate-900 dark:text-slate-100 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-7xl">
          <header className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Employer workspace</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">Worker directory</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Browse completed worker profiles and find the right skills for your next job.</p>
            </div>
            <Link href="/employer/dashboard" className="inline-flex items-center gap-2 self-start text-sm font-bold text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200 sm:self-auto"><ArrowLeft size={16} /> Back to dashboard</Link>
          </header>

          <form onSubmit={submitFilters} className="mb-7 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_11rem_9rem_9rem_auto] lg:items-end">
              <label className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Search workers
                <span className="relative mt-2 block"><Search size={17} className="absolute left-3 top-3 text-slate-400" /><input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Name, trade, or skill" className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-normal text-slate-900 outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></span>
              </label>
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Trade<input value={filters.trade} onChange={(event) => updateFilter("trade", event.target.value)} placeholder="e.g. Electrician" className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white lg:w-44" /></label>
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">City<input value={filters.city} onChange={(event) => updateFilter("city", event.target.value)} placeholder="City" className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white lg:w-36" /></label>
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Availability<select value={filters.availability} onChange={(event) => updateFilter("availability", event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white lg:w-36"><option value="">Any status</option><option value="AVAILABLE">Available</option><option value="ON_JOB">On job</option><option value="OFFLINE">Offline</option></select></label>
              <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"><SlidersHorizontal size={16} /> Apply filters</button>
            </div>
            <button type="button" onClick={() => setShowMoreFilters((open) => !open)} aria-expanded={showMoreFilters} className="mt-4 text-sm font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-300 dark:decoration-slate-600 dark:hover:text-white">{showMoreFilters ? "Hide filters" : "More filters"}</button>
            {showMoreFilters && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <input value={filters.skill} onChange={(event) => updateFilter("skill", event.target.value)} placeholder="Exact skill" aria-label="Skill" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950" />
                <input type="number" min="0" value={filters.min_experience} onChange={(event) => updateFilter("min_experience", event.target.value)} placeholder="Min experience" aria-label="Minimum experience" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950" />
                <input type="number" min="0" value={filters.max_experience} onChange={(event) => updateFilter("max_experience", event.target.value)} placeholder="Max experience" aria-label="Maximum experience" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950" />
                <input type="number" min="0" value={filters.max_wage} onChange={(event) => updateFilter("max_wage", event.target.value)} placeholder="Max daily wage" aria-label="Maximum daily wage" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950" />
                <select value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)} aria-label="Sort workers" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"><option value="name_asc">Name A-Z</option><option value="name_desc">Name Z-A</option><option value="experience_desc">Most experience</option><option value="wage_asc">Lowest wage</option><option value="wage_desc">Highest wage</option></select>
              </div>}
            {(Object.entries(submittedFilters).some(([key, value]) => key !== "sort" && Boolean(value))) && <button type="button" onClick={clearFilters} className="mt-4 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:text-white"><X size={15} /> Clear filters</button>}
          </form>

          {isLoading && <div className="flex min-h-56 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" /> Finding workers near you...</div>}
          {!isLoading && error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900/60 dark:bg-rose-950/30"><p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Unable to load workers</p><p className="mt-2 text-sm text-rose-700/80 dark:text-rose-300/80">Something went wrong while loading the worker directory.</p><button type="button" onClick={() => setReloadToken((token) => token + 1)} className="mt-5 min-h-11 rounded-xl bg-rose-600 px-5 py-2 text-sm font-bold text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2">Try again</button></div>}
          {!isLoading && !error && workers?.items.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900"><Users size={34} className="mx-auto text-slate-400" /><h2 className="mt-4 text-lg font-bold">No workers found</h2><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Try changing your search or filters.</p>{Object.entries(submittedFilters).some(([key, value]) => key !== "sort" && Boolean(value)) && <button type="button" onClick={clearFilters} className="mt-5 min-h-11 rounded-xl border border-blue-200 px-5 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/40">Clear filters</button>}</div>}
          {!isLoading && !error && workers && workers.items.length > 0 && <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400"><span className="font-semibold text-slate-700 dark:text-slate-200">{workers.total} worker{workers.total === 1 ? "" : "s"} found</span><span>Page {workers.page} of {Math.max(1, Math.ceil(workers.total / workers.limit))}</span></div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{workers.items.map((worker) => <article key={worker.worker_profile_id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-100 text-lg font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">{worker.profile_photo_url ? <Image src={worker.profile_photo_url} alt="" width={48} height={48} unoptimized className="h-full w-full object-cover" /> : worker.name.charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><h2 className="truncate font-bold text-slate-900 dark:text-white">{worker.name}</h2>{worker.is_verified && <BadgeCheck size={16} className="shrink-0 text-emerald-600" aria-label="Verified worker" />}</div><p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{worker.trade_id || "Trade not specified"}</p></div></div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs uppercase text-slate-400">Experience</p><p className="mt-1 font-semibold">{formatExperience(worker.experience_years)}</p></div><div><p className="text-xs uppercase text-slate-400">Daily wage</p><p className="mt-1 font-semibold">{formatWage(worker.expected_daily_wage)}</p></div><div><p className="text-xs uppercase text-slate-400">Status</p><p className="mt-1 font-semibold text-emerald-600 dark:text-emerald-400">{availabilityLabel(worker.availability_status)}</p></div><div><p className="text-xs uppercase text-slate-400">Location</p><p className="mt-1 truncate font-semibold">{titleCase(worker.city)}</p></div></div>
              {worker.skills.length > 0 && <p className="mt-4 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{worker.skills.map(titleCase).join(" · ")}</p>}
              <button type="button" onClick={() => setSelectedWorker(worker)} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/40">View worker</button>
            </article>)}</div>
            <div className="mt-7 flex items-center justify-center gap-3"><button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)} className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"><ChevronLeft size={16} /> Previous</button><button type="button" disabled={!workers.has_more} onClick={() => setPage((current) => current + 1)} className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700">Next <ChevronRight size={16} /></button></div>
          </>}
        </div>
      </main>
      {selectedWorker && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"><button type="button" className="absolute inset-0 bg-slate-900/60" onClick={() => setSelectedWorker(null)} aria-label="Close worker details" /><section role="dialog" aria-modal="true" aria-labelledby="worker-details-title" className="relative my-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"><button type="button" onClick={() => setSelectedWorker(null)} className="absolute right-4 top-4 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-slate-800" aria-label="Close worker details"><X size={19} /></button><div className="flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-blue-100 text-2xl font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">{selectedWorker.profile_photo_url ? <Image src={selectedWorker.profile_photo_url} alt="" width={64} height={64} unoptimized className="h-full w-full object-cover" /> : selectedWorker.name.charAt(0).toUpperCase()}</div><div><h2 id="worker-details-title" className="text-xl font-bold">{selectedWorker.name}</h2><p className="mt-1 text-sm text-slate-500">{titleCase(selectedWorker.trade_id)}</p></div></div><div className="mt-7 grid gap-5 text-sm sm:grid-cols-2"><div><p className="text-xs uppercase text-slate-400">Experience</p><p className="mt-1 font-semibold">{formatExperience(selectedWorker.experience_years)}</p></div><div><p className="text-xs uppercase text-slate-400">Expected daily wage</p><p className="mt-1 font-semibold">{formatWage(selectedWorker.expected_daily_wage)}</p></div><div><p className="text-xs uppercase text-slate-400">Availability</p><p className="mt-1 font-semibold">{availabilityLabel(selectedWorker.availability_status)}</p></div><div><p className="text-xs uppercase text-slate-400">Location</p><p className="mt-1 font-semibold">{[selectedWorker.city, selectedWorker.state].filter(Boolean).map(titleCase).join(", ") || "Not specified"}</p></div></div>{selectedWorker.skills.length > 0 && <div className="mt-6"><p className="text-xs uppercase text-slate-400">Skills</p><p className="mt-2 text-sm font-semibold">{selectedWorker.skills.map(titleCase).join(" · ")}</p></div>}<p className="mt-7 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">Hiring actions remain available through job-specific worker matching.</p></section></div>}
    </AccountManagementShell>
  );
}