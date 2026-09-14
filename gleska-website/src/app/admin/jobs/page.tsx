"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Eye,
  Filter,
  Loader2,
  MapPin,
  RotateCw,
  Search,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AdminShell from "@/components/admin/AdminShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JobItem {
  id: string;
  title: string;
  status: string;
  headcount_required: number | null;
  max_daily_salary: number | null;
  min_experience: number | null;
  trade_id: string | null;
  required_skills: string[] | null;
  created_at: string;
  updated_at: string | null;
  employer_id: string | null;
  employer_name: string | null;
  business_name: string | null;
  employer_mobile: string | null;
  job_site_id: string | null;
  site_name: string | null;
  site_city: string | null;
  site_state: string | null;
  total_matches: number;
  accepted_matches: number;
  pending_matches: number;
}

interface JobListResponse {
  items: JobItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface JobSiteDetail {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

interface JobMatchItem {
  id: string;
  worker_profile_id: string | null;
  worker_name: string | null;
  worker_mobile: string | null;
  worker_trade_id: string | null;
  composite_score: number | null;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
}

interface JobDetailResponse {
  id: string;
  title: string;
  status: string;
  headcount_required: number | null;
  max_daily_salary: number | null;
  min_experience: number | null;
  trade_id: string | null;
  required_skills: string[] | null;
  created_at: string;
  updated_at: string | null;
  employer_id: string | null;
  employer_user_id: string | null;
  employer_name: string | null;
  business_name: string | null;
  employer_mobile: string | null;
  employer_email: string | null;
  job_site_id: string | null;
  site: JobSiteDetail | null;
  matches: JobMatchItem[];
  total_matches: number;
  accepted_matches: number;
  pending_matches: number;
  attendance_count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtCurrency(val: number | null | undefined) {
  if (val == null) return "—";
  return `₹${val.toLocaleString("en-IN")}`;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  SEARCHING: {
    label: "Searching",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  FILLED: {
    label: "Filled",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  CANCELLED: {
    label: "Cancelled",
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
  },
};

const MATCH_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  PENDING: { label: "Candidate", bg: "bg-amber-50 text-amber-700 border-amber-200", text: "text-amber-700" },
  ACCEPTED: { label: "Selected", bg: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "text-emerald-700" },
  COMPLETED: { label: "Completed", bg: "bg-slate-100 text-slate-700 border-slate-200", text: "text-slate-700" },
  CANCELLED: { label: "Cancelled", bg: "bg-rose-50 text-rose-700 border-rose-200", text: "text-rose-700" },
};

function StatusBadge({ status }: { status: string }) {
  const norm = (status || "").toUpperCase();
  const cfg = STATUS_CONFIG[norm] || {
    label: status || "Unknown",
    bg: "bg-slate-100",
    text: "text-slate-600",
    border: "border-slate-200",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Admin Jobs Page Component
// ---------------------------------------------------------------------------

export default function AdminJobsPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();

  // Search and Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Listing Data
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");

  // Slide-over Details Drawer
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");

  // Cancel Confirmation Modal
  const [cancelModal, setCancelModal] = useState<{
    open: boolean;
    jobId: string;
    jobTitle: string;
    loading: boolean;
  }>({
    open: false,
    jobId: "",
    jobTitle: "",
    loading: false,
  });

  // Authentication guard
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/admin/login");
      return;
    }
    if (!isLoading && user && user.role !== "ADMIN") {
      router.replace("/");
    }
  }, [isLoading, router, user]);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Fetch Jobs List
  const fetchJobs = useCallback(async () => {
    if (!user || user.role !== "ADMIN") return;
    setLoadingList(true);
    setListError("");
    try {
      const params: Record<string, string | number> = {
        page: currentPage,
        page_size: pageSize,
      };

      if (debouncedSearch.trim()) {
        params.search = debouncedSearch.trim();
      }
      if (statusFilter !== "ALL") {
        params.status = statusFilter;
      }

      const res = await apiClient.get<JobListResponse>("/api/v1/admin/jobs", { params });
      setJobs(res.data.items || []);
      setTotalCount(res.data.total || 0);
      setTotalPages(res.data.total_pages || 1);
    } catch {
      setListError("Failed to fetch jobs list. Please check your connection and try again.");
    } finally {
      setLoadingList(false);
    }
  }, [user, currentPage, pageSize, debouncedSearch, statusFilter]);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // Fetch Job Details
  const openJobDetail = useCallback(async (jobId: string) => {
    setSelectedJobId(jobId);
    setLoadingDetail(true);
    setDetailError("");
    setJobDetail(null);
    try {
      const res = await apiClient.get<JobDetailResponse>(`/api/v1/admin/jobs/${jobId}`);
      setJobDetail(res.data);
    } catch {
      setDetailError("Unable to load full job details. The job may not exist.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const closeJobDetail = () => {
    setSelectedJobId(null);
    setJobDetail(null);
    setDetailError("");
  };

  // Open Cancel Modal
  const promptCancelJob = (jobId: string, jobTitle: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCancelModal({
      open: true,
      jobId,
      jobTitle,
      loading: false,
    });
  };

  // Execute Cancel Job
  const handleConfirmCancel = async () => {
    if (!cancelModal.jobId) return;
    setCancelModal((prev) => ({ ...prev, loading: true }));
    try {
      await apiClient.patch(`/api/v1/admin/jobs/${cancelModal.jobId}/status`, {
        new_status: "CANCELLED",
      });
      toast.success("Job cancelled successfully");

      // Update local listing state
      setJobs((prev) =>
        prev.map((j) => (j.id === cancelModal.jobId ? { ...j, status: "CANCELLED" } : j))
      );

      // Update detail view if open
      if (jobDetail && jobDetail.id === cancelModal.jobId) {
        setJobDetail((prev) => (prev ? { ...prev, status: "CANCELLED" } : null));
      }

      setCancelModal({ open: false, jobId: "", jobTitle: "", loading: false });
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Failed to cancel the job";
      toast.error(errorMsg);
      setCancelModal((prev) => ({ ...prev, loading: false }));
    }
  };

  // Status Metrics
  const metrics = useMemo(() => {
    let searching = 0;
    let filled = 0;
    let cancelled = 0;
    jobs.forEach((j) => {
      const st = (j.status || "").toUpperCase();
      if (st === "SEARCHING") searching++;
      else if (st === "FILLED") filled++;
      else if (st === "CANCELLED") cancelled++;
    });
    return { searching, filled, cancelled };
  }, [jobs]);

  if (isLoading || !user || user.role !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb]">
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <AdminShell name={user.name} email={user.email} onLogout={() => void logout()}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        {/* =================================================================== */}
        {/* Page Header */}
        {/* =================================================================== */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-blue-700 border border-blue-100">
                Operations Management
              </span>
              <span className="text-xs text-slate-400 font-medium">Job Postings & Demand</span>
            </div>
            <h1 className="mt-1 font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wide text-slate-900">
              Jobs Directory
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              Platform job postings, active hiring requests, matched worker candidates, and site deployment.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void fetchJobs()}
            disabled={loadingList}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer self-start sm:self-auto disabled:opacity-50"
            title="Refresh job records"
          >
            <RotateCw size={14} className={loadingList ? "animate-spin text-blue-600" : "text-slate-500"} />
            <span>Refresh</span>
          </button>
        </div>

        {/* =================================================================== */}
        {/* Quick Metrics Bar */}
        {/* =================================================================== */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Jobs</span>
              <Briefcase size={16} className="text-slate-400" />
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{totalCount}</p>
            <p className="mt-0.5 text-xs text-slate-400">All registered job requests</p>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Searching</span>
              <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
            </div>
            <p className="mt-2 text-2xl font-bold text-blue-800">{metrics.searching}</p>
            <p className="mt-0.5 text-xs text-blue-600">Active hiring on this page</p>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Filled</span>
              <CheckCircle2 size={16} className="text-emerald-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-800">{metrics.filled}</p>
            <p className="mt-0.5 text-xs text-emerald-600">Headcount fulfilled</p>
          </div>

          <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-700 uppercase tracking-wide">Cancelled</span>
              <CircleX size={16} className="text-rose-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-rose-800">{metrics.cancelled}</p>
            <p className="mt-0.5 text-xs text-rose-600">Terminated jobs</p>
          </div>
        </div>

        {/* =================================================================== */}
        {/* Search and Filters Bar */}
        {/* =================================================================== */}
        <div className="mb-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Search Input */}
            <div className="relative sm:col-span-2 lg:col-span-3">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by job title, trade requirement..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-8 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none transition"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Status Filter */}
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
                <Filter size={12} />
                <span>Job Status</span>
              </div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="SEARCHING">Searching (Active)</option>
                <option value="FILLED">Filled</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* Table / Listing Section */}
        {/* =================================================================== */}
        {listError && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 flex items-center gap-3">
            <AlertCircle size={18} className="shrink-0 text-red-600" />
            <span>{listError}</span>
          </div>
        )}

        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          {loadingList && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/75 backdrop-blur-2xs">
              <div className="flex flex-col items-center gap-2">
                <Loader2 size={28} className="animate-spin text-blue-600" />
                <span className="text-xs font-semibold text-slate-600">Loading jobs...</span>
              </div>
            </div>
          )}

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3.5">Job Title & Trade</th>
                  <th scope="col" className="px-4 py-3.5">Employer / Company</th>
                  <th scope="col" className="px-4 py-3.5">Site Location</th>
                  <th scope="col" className="px-3 py-3.5 text-center">Headcount</th>
                  <th scope="col" className="px-3 py-3.5 text-center">Matches</th>
                  <th scope="col" className="px-4 py-3.5">Status</th>
                  <th scope="col" className="px-4 py-3.5">Posted</th>
                  <th scope="col" className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {jobs.length === 0 && !loadingList ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                      <Briefcase size={36} className="mx-auto mb-2 text-slate-300 stroke-[1.5]" />
                      <p className="text-sm font-semibold text-slate-600">No jobs found</p>
                      <p className="mt-1 text-xs text-slate-400">Try adjusting your search criteria or status filter.</p>
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => void openJobDetail(job.id)}
                      className="hover:bg-blue-50/30 transition cursor-pointer group"
                    >
                      {/* Job Title & Trade */}
                      <td className="px-5 py-4">
                        <p className="font-bold text-slate-900 group-hover:text-blue-600 transition">
                          {job.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          {job.trade_id && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 uppercase">
                              {job.trade_id}
                            </span>
                          )}
                          {job.max_daily_salary && (
                            <span className="text-[11px] text-emerald-700 font-semibold">
                              {fmtCurrency(job.max_daily_salary)}/day
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Employer / Business */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                          <Building2 size={13} className="shrink-0 text-slate-400" />
                          <span className="truncate max-w-[160px]">
                            {job.business_name || job.employer_name || (job.employer_id ? "Employer Profile" : "Orphaned Job")}
                          </span>
                        </div>
                        {job.employer_mobile && (
                          <p className="mt-0.5 text-[11px] text-slate-400">{job.employer_mobile}</p>
                        )}
                      </td>

                      {/* Site Location */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1 text-slate-700">
                          <MapPin size={13} className="shrink-0 text-slate-400" />
                          <span>
                            {job.site_city || job.site_state ? (
                              `${job.site_city || ""}${job.site_city && job.site_state ? ", " : ""}${job.site_state || ""}`
                            ) : (
                              job.site_name || "—"
                            )}
                          </span>
                        </div>
                        {job.site_name && (job.site_city || job.site_state) && (
                          <p className="mt-0.5 text-[11px] text-slate-400 truncate max-w-[140px]">{job.site_name}</p>
                        )}
                      </td>

                      {/* Headcount */}
                      <td className="px-3 py-4 text-center">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-700 text-xs">
                          {job.headcount_required ?? "—"}
                        </span>
                      </td>

                      {/* Matches */}
                      <td className="px-3 py-4 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span className="font-bold text-slate-800">{job.total_matches}</span>
                          {job.accepted_matches > 0 && (
                            <span className="text-[10px] font-semibold text-emerald-600">
                              {job.accepted_matches} selected
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        <StatusBadge status={job.status} />
                      </td>

                      {/* Posted */}
                      <td className="px-4 py-4 text-slate-500 whitespace-nowrap">
                        {fmtDate(job.created_at)}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void openJobDetail(job.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
                            title="View job details"
                          >
                            <Eye size={12} />
                            <span>View</span>
                          </button>

                          {job.status === "SEARCHING" && (
                            <button
                              type="button"
                              onClick={(e) => promptCancelJob(job.id, job.title, e)}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 shadow-2xs hover:bg-rose-100 transition"
                              title="Cancel job"
                            >
                              <CircleX size={12} />
                              <span>Cancel</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="divide-y divide-slate-100 md:hidden">
            {jobs.length === 0 && !loadingList ? (
              <div className="p-8 text-center text-slate-400">
                <Briefcase size={32} className="mx-auto mb-2 text-slate-300 stroke-[1.5]" />
                <p className="text-sm font-semibold text-slate-600">No jobs found</p>
                <p className="mt-1 text-xs text-slate-400">Try adjusting your filters.</p>
              </div>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => void openJobDetail(job.id)}
                  className="p-4 hover:bg-slate-50 transition cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{job.title}</p>
                      <p className="text-xs text-slate-500">
                        {job.business_name || job.employer_name || "Employer Profile"}
                      </p>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div className="flex items-center gap-1">
                      <MapPin size={12} className="text-slate-400 shrink-0" />
                      <span className="truncate">{job.site_city || job.site_name || "—"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Users size={12} className="text-slate-400 shrink-0" />
                      <span>{job.headcount_required != null ? `${job.headcount_required} workers` : "—"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar size={12} className="text-slate-400 shrink-0" />
                      <span>{fmtDate(job.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-blue-700">{job.total_matches} matched</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => void openJobDetail(job.id)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      View Details
                    </button>
                    {job.status === "SEARCHING" && (
                      <button
                        type="button"
                        onClick={(e) => promptCancelJob(job.id, job.title, e)}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ================================================================= */}
          {/* Pagination Controls */}
          {/* ================================================================= */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200 bg-slate-50/50 px-5 py-3.5 text-xs text-slate-600">
            <div className="flex items-center gap-1.5">
              <span>Showing page</span>
              <span className="font-bold text-slate-900">{currentPage}</span>
              <span>of</span>
              <span className="font-bold text-slate-900">{totalPages}</span>
              <span className="text-slate-400">({totalCount} total jobs)</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || loadingList}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} />
                <span>Previous</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || loadingList}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* Slide-over Job Details Drawer */}
        {/* =================================================================== */}
        {selectedJobId && (
          <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-2xs transition-opacity animate-in fade-in">
            <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
              <div className="w-screen max-w-xl bg-white shadow-2xl flex flex-col">
                {/* Drawer Header */}
                <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/75">
                  <div className="flex items-center gap-2">
                    <Briefcase size={18} className="text-blue-600" />
                    <h2 className="font-bold text-slate-900 text-sm">Job Posting Specification</h2>
                  </div>
                  <button
                    type="button"
                    onClick={closeJobDetail}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Drawer Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {loadingDetail ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                      <Loader2 size={32} className="animate-spin text-blue-600" />
                      <p className="text-xs font-semibold text-slate-500">Retrieving job records & relations...</p>
                    </div>
                  ) : detailError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 flex items-center gap-2">
                      <AlertCircle size={16} />
                      <span>{detailError}</span>
                    </div>
                  ) : jobDetail ? (
                    <>
                      {/* Title & Status */}
                      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">{jobDetail.title}</h3>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">ID: {jobDetail.id}</p>
                        </div>
                        <StatusBadge status={jobDetail.status} />
                      </div>

                      {/* Job Parameters */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                          Job Requirements
                        </h4>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                            <span className="text-slate-400">Headcount Required</span>
                            <p className="mt-1 font-bold text-slate-800 text-sm">
                              {jobDetail.headcount_required ?? "—"}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                            <span className="text-slate-400">Daily Salary Cap</span>
                            <p className="mt-1 font-bold text-emerald-700 text-sm">
                              {fmtCurrency(jobDetail.max_daily_salary)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                            <span className="text-slate-400">Min. Experience</span>
                            <p className="mt-1 font-bold text-slate-800 text-sm">
                              {jobDetail.min_experience != null ? `${jobDetail.min_experience} Years` : "—"}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                            <span className="text-slate-400">Trade Code</span>
                            <p className="mt-1 font-bold text-slate-800 text-sm uppercase">
                              {jobDetail.trade_id || "—"}
                            </p>
                          </div>
                        </div>

                        {jobDetail.required_skills && jobDetail.required_skills.length > 0 && (
                          <div className="mt-3">
                            <span className="text-xs text-slate-400">Required Skills</span>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {jobDetail.required_skills.map((skill, idx) => (
                                <span
                                  key={idx}
                                  className="rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700"
                                >
                                  {skill}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Associated Employer */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                          <Building2 size={13} />
                          <span>Hiring Employer</span>
                        </h4>
                        {jobDetail.employer_id ? (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900 text-sm">
                                {jobDetail.business_name || jobDetail.employer_name || "Employer Profile"}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                Profile: {jobDetail.employer_id.slice(0, 8)}...
                              </span>
                            </div>
                            {jobDetail.employer_name && jobDetail.business_name && (
                              <p className="text-slate-600">Contact: {jobDetail.employer_name}</p>
                            )}
                            <div className="grid grid-cols-2 gap-2 pt-1 text-slate-500">
                              <div>Mobile: {jobDetail.employer_mobile || "—"}</div>
                              <div>Email: {jobDetail.employer_email || "—"}</div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                            <strong>Note:</strong> Associated employer record does not exist or was removed (orphaned job).
                          </div>
                        )}
                      </div>

                      {/* Job Site */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                          <MapPin size={13} />
                          <span>Job Site Location</span>
                        </h4>
                        {jobDetail.site ? (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs space-y-1">
                            <p className="font-bold text-slate-900">{jobDetail.site.name || "Site"}</p>
                            {jobDetail.site.address && <p className="text-slate-600">{jobDetail.site.address}</p>}
                            <p className="text-slate-500">
                              {[jobDetail.site.city, jobDetail.site.state, jobDetail.site.pincode]
                                .filter(Boolean)
                                .join(", ") || "—"}
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No specific site assigned to this job.</p>
                        )}
                      </div>

                      {/* Workers & Matching Oversight */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <Users size={13} />
                            <span>Matched Workers ({jobDetail.matches.length})</span>
                          </h4>
                          <span className="text-[11px] text-slate-500">
                            Attendance check-ins: <strong>{jobDetail.attendance_count}</strong>
                          </span>
                        </div>

                        {jobDetail.matches.length === 0 ? (
                          <div className="rounded-xl border border-slate-100 bg-slate-50 p-6 text-center text-xs text-slate-400">
                            No worker candidates or matches have been recorded yet.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {jobDetail.matches.map((match) => {
                              const mCfg =
                                MATCH_STATUS_CONFIG[(match.status || "").toUpperCase()] || {
                                  label: match.status,
                                  bg: "bg-slate-100 text-slate-700 border-slate-200",
                                  text: "text-slate-700",
                                };
                              return (
                                <div
                                  key={match.id}
                                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-xs hover:bg-slate-50 transition"
                                >
                                  <div>
                                    <p className="font-bold text-slate-900">
                                      {match.worker_name || "Worker Candidate"}
                                    </p>
                                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                                      {match.worker_mobile && <span>{match.worker_mobile}</span>}
                                      {match.worker_trade_id && (
                                        <span className="uppercase text-slate-400">
                                          · {match.worker_trade_id}
                                        </span>
                                      )}
                                      {match.composite_score != null && (
                                        <span className="text-blue-600 font-semibold">
                                          · Score: {match.composite_score}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span
                                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${mCfg.bg}`}
                                  >
                                    {mCfg.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Timestamps */}
                      <div className="border-t border-slate-100 pt-4 text-[11px] text-slate-400 space-y-1">
                        <p>Posted at: {fmtDate(jobDetail.created_at)}</p>
                        {jobDetail.updated_at && <p>Last updated: {fmtDate(jobDetail.updated_at)}</p>}
                      </div>
                    </>
                  ) : null}
                </div>

                {/* Drawer Footer / Actions */}
                {jobDetail && jobDetail.status === "SEARCHING" && (
                  <div className="border-t border-slate-200 bg-slate-50/75 p-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => promptCancelJob(jobDetail.id, jobDetail.title)}
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                    >
                      <CircleX size={14} />
                      <span>Cancel Job</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* Cancel Confirmation Modal */}
        {/* =================================================================== */}
        {cancelModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-2xs p-4 animate-in fade-in">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
              <div className="flex items-center gap-3 text-rose-600 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 border border-rose-100">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Cancel Job Posting</h3>
                  <p className="text-xs text-slate-500">Administrative Termination</p>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Are you sure you want to cancel the job{" "}
                <strong className="text-slate-900">&quot;{cancelModal.jobTitle}&quot;</strong>?
              </p>
              <p className="mt-2 rounded-xl bg-amber-50 p-3 text-[11px] text-amber-800 leading-normal border border-amber-200">
                This action will mark the job status as <strong>CANCELLED</strong> in the system and log an audit record. Active candidate evaluations will be discontinued.
              </p>

              <div className="mt-5 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={cancelModal.loading}
                  onClick={() => setCancelModal({ open: false, jobId: "", jobTitle: "", loading: false })}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={cancelModal.loading}
                  onClick={() => void handleConfirmCancel()}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 transition cursor-pointer disabled:opacity-50"
                >
                  {cancelModal.loading && <Loader2 size={14} className="animate-spin" />}
                  <span>Confirm Cancel</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </AdminShell>
  );
}
