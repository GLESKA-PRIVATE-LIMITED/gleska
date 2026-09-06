"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Clock3, FileClock, Loader2, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AccountManagementShell, { formatEmployerType } from "@/components/AccountManagementShell";

type Status = "PRESENT" | "LATE" | "ABSENT";
type RecordItem = { id: string; worker_name: string; job_title: string; site_name: string; attendance_date: string; status: Status; check_in_at?: string | null; check_out_at?: string | null; employer_manual_override: boolean; correction_reason?: string | null };
type ResponseData = { items: RecordItem[]; page: number; limit: number; total: number; has_more: boolean; present_count: number; late_count: number; absent_count: number };
type AuditItem = { id: string; action: string; reason?: string | null; created_at: string };
type Option = { id: string; title?: string; name?: string };
type MatchOption = { job_match_id: string; worker_name: string; job_title: string; site_name: string };
type Filters = { date: string; worker: string; job_id: string; job_site_id: string; status: string };

const today = () => new Date().toISOString().slice(0, 10);
const initialFilters: Filters = { date: today(), worker: "", job_id: "", job_site_id: "", status: "" };

function time(value?: string | null) { return value ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "-"; }
function day(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)); }
function hours(item: RecordItem) { if (!item.check_in_at || !item.check_out_at) return "-"; const minutes = Math.max(0, Math.round((new Date(item.check_out_at).getTime() - new Date(item.check_in_at).getTime()) / 60000)); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function label(value: Status) { return value.charAt(0) + value.slice(1).toLowerCase(); }
function badge(value: Status) { return value === "PRESENT" ? "bg-emerald-50 text-emerald-700" : value === "LATE" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"; }

export default function EmployerAttendancePage() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [filters, setFilters] = React.useState(initialFilters);
  const [submitted, setSubmitted] = React.useState(initialFilters);
  const [data, setData] = React.useState<ResponseData | null>(null);
  const [jobs, setJobs] = React.useState<Option[]>([]);
  const [sites, setSites] = React.useState<Option[]>([]);
  const [matchOptions, setMatchOptions] = React.useState<MatchOption[]>([]);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const [selected, setSelected] = React.useState<RecordItem | null>(null);
  const [audit, setAudit] = React.useState<AuditItem[]>([]);
  const [edit, setEdit] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ status: "PRESENT" as Status, check_in_at: "", check_out_at: "", reason: "" });
  const [marking, setMarking] = React.useState(false);
  const [markOpen, setMarkOpen] = React.useState(false);
  const [markForm, setMarkForm] = React.useState({ job_match_id: "", attendance_date: today(), status: "PRESENT" as Status, reason: "" });

  React.useEffect(() => {
    if (isLoading) return;
    if (!user) router.push("/employer/auth");
    else if (user.role !== "EMPLOYER") router.push("/");
    else if (nextStep !== "DASHBOARD") router.push("/employer/onboarding");
  }, [isLoading, nextStep, router, user]);

  React.useEffect(() => {
    if (isLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    void Promise.all([
      apiClient.get<Option[]>("/api/v1/jobs", { withCredentials: true }),
      apiClient.get<Option[]>("/api/v1/job-sites/me", { withCredentials: true }),
      apiClient.get<MatchOption[]>("/api/v1/employers/me/attendance/match-options", { withCredentials: true }),
    ]).then(([jobResponse, siteResponse, matchResponse]) => {
      setJobs(jobResponse.data);
      setSites(siteResponse.data);
      setMatchOptions(matchResponse.data);
    }).catch(() => undefined);
  }, [isLoading, nextStep, user]);

  React.useEffect(() => {
    if (isLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    let active = true;
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    Object.entries(submitted).forEach(([key, value]) => { if (value) params.set(key, value); });
    apiClient.get<ResponseData>(`/api/v1/employers/me/attendance?${params.toString()}`, { withCredentials: true }).then((response) => { if (active) setData(response.data); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isLoading, nextStep, page, reload, submitted, user]);

  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const apply = (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(false); setPage(1); setSubmitted({ ...filters }); };
  const clear = () => { const next = { ...initialFilters, date: "" }; setLoading(true); setError(false); setFilters(next); setSubmitted(next); setPage(1); };
  const changePage = (nextPage: number) => { setLoading(true); setError(false); setPage(nextPage); };
  const open = async (item: RecordItem) => {
    setSelected(item);
    setEdit(false);
    try {
      const [detail, history] = await Promise.all([apiClient.get<RecordItem>(`/api/v1/employers/me/attendance/${item.id}`), apiClient.get<AuditItem[]>(`/api/v1/employers/me/attendance/${item.id}/audit`)]);
      setSelected(detail.data);
      setAudit(history.data);
    } catch { setAudit([]); }
  };
  const startEdit = () => { if (!selected) return; setForm({ status: selected.status, check_in_at: selected.check_in_at?.slice(0, 16) || "", check_out_at: selected.check_out_at?.slice(0, 16) || "", reason: "" }); setEdit(true); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !form.reason.trim()) return;
    setSaving(true);
    try {
      const response = await apiClient.patch<RecordItem>(`/api/v1/employers/me/attendance/${selected.id}`, { status: form.status, check_in_at: form.check_in_at ? new Date(form.check_in_at).toISOString() : null, check_out_at: form.check_out_at ? new Date(form.check_out_at).toISOString() : null, reason: form.reason });
      setSelected(response.data);
      setEdit(false);
      setReload((value) => value + 1);
      const history = await apiClient.get<AuditItem[]>(`/api/v1/employers/me/attendance/${selected.id}/audit`);
      setAudit(history.data);
    } finally { setSaving(false); }
  };

  const markAttendance = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!markForm.job_match_id || !markForm.reason.trim()) return;
    setMarking(true);
    try {
      await apiClient.post("/api/v1/employers/me/attendance/mark", markForm);
      setMarkForm({ job_match_id: "", attendance_date: today(), status: "PRESENT", reason: "" });
      setReload((value) => value + 1);
    } finally {
      setMarking(false);
    }
  };

  if (isLoading || !user || user.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950"><Loader2 size={34} className="animate-spin text-blue-600" /></div>;

  return <AccountManagementShell kind="employer" name={user.name} accountLabel={formatEmployerType(user.employer_type)} profileHref="/employer/company-profile" onLogout={() => void logout()}>
    <main className="min-h-screen px-4 py-8 text-slate-900 dark:text-slate-100 sm:px-6 sm:py-12"><div className="mx-auto max-w-7xl">
      <header className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Employer workspace</p><h1 className="mt-2 text-3xl font-bold sm:text-4xl">Attendance</h1><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Track attendance for workers hired through GO LESKA.</p></div><div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => setMarkOpen(true)} className="min-h-10 rounded-xl border border-blue-200 px-4 text-sm font-bold text-blue-700 dark:border-blue-900 dark:text-blue-300">Mark attendance</button><Link href="/employer/dashboard" className="inline-flex min-h-10 items-center gap-2 self-start text-sm font-bold text-blue-700 dark:text-blue-300 sm:self-auto"><ArrowLeft size={16} /> Back to dashboard</Link></div></header>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">{[["Present", data?.present_count || 0, "text-emerald-600"], ["Late", data?.late_count || 0, "text-amber-600"], ["Absent", data?.absent_count || 0, "text-rose-600"]].map(([name, value, color]) => <div key={name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{name}</p><p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p></div>)}</div>
      <form onSubmit={apply} className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1fr)_12rem_12rem_9rem_auto] lg:items-end"><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Date<input type="date" value={filters.date} onChange={(event) => setFilter("date", event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950" /></label><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Search worker<span className="relative mt-2 block"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input value={filters.worker} onChange={(event) => setFilter("worker", event.target.value)} placeholder="Worker name" className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950" /></span></label><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Job<select value={filters.job_id} onChange={(event) => setFilter("job_id", event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"><option value="">All jobs</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Work site<select value={filters.job_site_id} onChange={(event) => setFilter("job_site_id", event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"><option value="">All sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Status<select value={filters.status} onChange={(event) => setFilter("status", event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"><option value="">All statuses</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option></select></label><button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white"><Search size={16} /> Filter</button></div>{Object.values(submitted).some(Boolean) && <button type="button" onClick={clear} className="mt-4 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-slate-500"><X size={15} /> Clear filters</button>}</form>
      {loading && <div className="flex min-h-56 items-center justify-center rounded-2xl border bg-white text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900"><Loader2 size={18} className="mr-2 animate-spin" /> Loading attendance...</div>}
      {!loading && error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center"><p className="font-semibold text-rose-700">Unable to load attendance.</p><button type="button" onClick={() => { setLoading(true); setError(false); setReload((value) => value + 1); }} className="mt-5 min-h-11 rounded-xl bg-rose-600 px-5 text-sm font-bold text-white">Try again</button></div>}
      {!loading && !error && data?.items.length === 0 && <div className="rounded-2xl border bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900"><Clock3 size={34} className="mx-auto text-slate-400" /><h2 className="mt-4 text-lg font-bold">No attendance records</h2><p className="mt-2 text-sm text-slate-500">No attendance has been recorded for this date.</p></div>}
      {!loading && !error && data && data.items.length > 0 && <div><div className="mb-4 flex justify-between text-sm text-slate-500"><span className="font-semibold">{data.total} record{data.total === 1 ? "" : "s"}</span><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span></div><div className="grid gap-3">{data.items.map((item) => <article key={item.id} className="rounded-2xl border bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{item.worker_name}</h2><p className="mt-1 text-sm text-slate-500">{item.job_title} · {item.site_name}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badge(item.status)}`}>{label(item.status)}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><p className="text-xs uppercase text-slate-400">Date</p><p className="mt-1 font-semibold">{day(item.attendance_date)}</p></div><div><p className="text-xs uppercase text-slate-400">Check in</p><p className="mt-1 font-semibold">{time(item.check_in_at)}</p></div><div><p className="text-xs uppercase text-slate-400">Check out</p><p className="mt-1 font-semibold">{time(item.check_out_at)}</p></div><div><p className="text-xs uppercase text-slate-400">Hours</p><p className="mt-1 font-semibold">{hours(item)}</p></div></div><button type="button" onClick={() => void open(item)} className="mt-4 min-h-11 rounded-xl border border-blue-200 px-4 text-sm font-bold text-blue-700 dark:border-blue-900 dark:text-blue-300">View details</button></article>)}</div><div className="mt-6 flex justify-center gap-3"><button type="button" disabled={page === 1} onClick={() => changePage(page - 1)} className="min-h-10 rounded-xl border px-4 text-sm font-bold disabled:opacity-40">Previous</button><button type="button" disabled={!data.has_more} onClick={() => changePage(page + 1)} className="min-h-10 rounded-xl border px-4 text-sm font-bold disabled:opacity-40">Next</button></div></div>}
    </div></main>
    {markOpen && <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button type="button" aria-label="Close mark attendance" onClick={() => setMarkOpen(false)} className="absolute inset-0 bg-slate-900/60" /><form onSubmit={async (event) => { await markAttendance(event); setMarkOpen(false); }} className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"><button type="button" aria-label="Close mark attendance" onClick={() => setMarkOpen(false)} className="absolute right-4 top-4 p-2"><X size={18} /></button><h2 className="text-xl font-bold">Mark attendance</h2><p className="mt-2 text-sm text-slate-500">Changes are recorded in attendance history.</p><label className="mt-5 block text-xs font-bold uppercase text-slate-500">Accepted job match<select required value={markForm.job_match_id} onChange={(event) => setMarkForm((current) => ({ ...current, job_match_id: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"><option value="">Select worker and job</option>{matchOptions.map((match) => <option key={match.job_match_id} value={match.job_match_id}>{match.worker_name} · {match.job_title} · {match.site_name}</option>)}</select></label><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold uppercase text-slate-500">Date<input type="date" required value={markForm.attendance_date} onChange={(event) => setMarkForm((current) => ({ ...current, attendance_date: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950" /></label><label className="text-xs font-bold uppercase text-slate-500">Status<select value={markForm.status} onChange={(event) => setMarkForm((current) => ({ ...current, status: event.target.value as Status }))} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option></select></label></div><textarea required value={markForm.reason} onChange={(event) => setMarkForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason for manual marking" className="mt-4 min-h-24 w-full rounded-xl border p-3 text-sm dark:border-slate-700 dark:bg-slate-950" /><div className="mt-4 flex justify-end gap-3"><button type="button" onClick={() => setMarkOpen(false)} className="min-h-11 rounded-xl border px-4">Cancel</button><button type="submit" disabled={marking} className="min-h-11 rounded-xl bg-blue-600 px-5 font-bold text-white">{marking ? "Saving..." : "Save attendance"}</button></div></form></div>}
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"><button type="button" aria-label="Close attendance details" onClick={() => setSelected(null)} className="absolute inset-0 bg-slate-900/60" /><section role="dialog" aria-modal="true" className="relative my-auto max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"><button type="button" aria-label="Close attendance details" onClick={() => setSelected(null)} className="absolute right-4 top-4 p-2"><X size={18} /></button><h2 className="text-xl font-bold">{selected.worker_name}</h2><p className="mt-1 text-sm text-slate-500">{selected.job_title} · {selected.site_name}</p><div className="mt-6 grid grid-cols-2 gap-4 text-sm"><p>Date<br /><strong>{day(selected.attendance_date)}</strong></p><p>Status<br /><strong>{label(selected.status)}</strong></p><p>Check in<br /><strong>{time(selected.check_in_at)} · Location verified</strong></p><p>Check out<br /><strong>{time(selected.check_out_at)}</strong></p><p>Hours worked<br /><strong>{hours(selected)}</strong></p></div>{selected.employer_manual_override && <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><strong>Manually corrected.</strong> {selected.correction_reason}</p>}<button type="button" onClick={startEdit} className="mt-6 min-h-11 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white">Correct attendance</button>{audit.length > 0 && <div className="mt-6 border-t pt-5"><h3 className="flex items-center gap-2 text-sm font-bold"><FileClock size={16} /> Attendance history</h3>{audit.map((entry) => <p key={entry.id} className="mt-3 rounded-xl bg-slate-50 p-3 text-xs"><strong>{entry.action.replaceAll("_", " ")}</strong><br />{entry.reason}<br />{new Date(entry.created_at).toLocaleString("en-IN")}</p>)}</div>}{edit && <form onSubmit={save} className="mt-6 border-t pt-5"><p className="text-sm font-bold">Changes are recorded in attendance history.</p><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as Status }))} className="mt-4 h-11 w-full rounded-xl border px-3 dark:border-slate-700 dark:bg-slate-950"><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option></select><textarea required value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason for correction" className="mt-3 min-h-24 w-full rounded-xl border p-3 dark:border-slate-700 dark:bg-slate-950" /><div className="mt-4 flex justify-end gap-3"><button type="button" onClick={() => setEdit(false)} className="min-h-11 rounded-xl border px-4">Cancel</button><button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-blue-600 px-5 font-bold text-white">{saving ? "Saving..." : "Save correction"}</button></div></form>}</section></div>}
  </AccountManagementShell>;
}
