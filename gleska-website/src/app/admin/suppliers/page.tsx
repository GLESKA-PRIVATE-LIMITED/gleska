"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isAxiosError } from "axios";
import {
  AlertCircle,
  Building,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
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

type VerificationStatus =
  | "NOT_SUBMITTED"
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "SUSPENDED";

interface QueueItem {
  id: string;
  name: string;
  verification_status: VerificationStatus;
  verification_submitted_at: string | null;
  created_at: string;
}

interface QueueResponse {
  items: QueueItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface OwnerMembership {
  name: string | null;
  role: string;
  status: string;
  created_at: string;
}

interface VerificationDocument {
  id: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}

interface VerificationEvent {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  previous_status: VerificationStatus | null;
  new_status: VerificationStatus;
  reason: string | null;
  created_at: string;
}

interface SupplierDetail {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  operational_status: string;
  verification_status: VerificationStatus;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
  verification_reviewed_by: string | null;
  verification_reason: string | null;
  created_at: string;
  registered_name: string | null;
  registration_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  registered_address: string | null;
  owner_membership: OwnerMembership | null;
  documents: VerificationDocument[];
  events: VerificationEvent[];
}

const verificationStatuses: VerificationStatus[] = [
  "PENDING_REVIEW",
  "VERIFIED",
  "NOT_SUBMITTED",
  "REJECTED",
  "SUSPENDED",
];

const pageSize = 25;

// ---------------------------------------------------------------------------
// Formatters & UI Helpers
// ---------------------------------------------------------------------------

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function statusLabel(value: VerificationStatus): string {
  switch (value) {
    case "PENDING_REVIEW":
      return "Pending Review";
    case "NOT_SUBMITTED":
      return "Not Submitted";
    case "VERIFIED":
      return "Verified";
    case "REJECTED":
      return "Rejected";
    case "SUSPENDED":
      return "Suspended";
    default:
      return "Unknown";
  }
}

function formatVerificationStatus(status: VerificationStatus) {
  switch (status) {
    case "VERIFIED":
      return {
        label: "Verified",
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
        dot: "bg-emerald-500",
      };
    case "PENDING_REVIEW":
      return {
        label: "Pending Review",
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
        dot: "bg-amber-500",
      };
    case "REJECTED":
      return {
        label: "Rejected",
        bg: "bg-rose-50",
        text: "text-rose-700",
        border: "border-rose-200",
        dot: "bg-rose-500",
      };
    case "SUSPENDED":
      return {
        label: "Suspended",
        bg: "bg-rose-50",
        text: "text-rose-700",
        border: "border-rose-200",
        dot: "bg-rose-500",
      };
    case "NOT_SUBMITTED":
    default:
      return {
        label: "Not Submitted",
        bg: "bg-slate-100",
        text: "text-slate-600",
        border: "border-slate-200",
        dot: "bg-slate-400",
      };
  }
}

function formatOperationalStatus(status: string) {
  switch (status?.toUpperCase()) {
    case "ACTIVE":
      return {
        label: "Active",
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
        dot: "bg-emerald-500",
      };
    case "SUSPENDED":
      return {
        label: "Suspended",
        bg: "bg-rose-50",
        text: "text-rose-700",
        border: "border-rose-200",
        dot: "bg-rose-500",
      };
    case "ARCHIVED":
      return {
        label: "Archived",
        bg: "bg-slate-100",
        text: "text-slate-600",
        border: "border-slate-200",
        dot: "bg-slate-400",
      };
    default:
      return {
        label: status ? status.replaceAll("_", " ") : "Active",
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
        dot: "bg-emerald-500",
      };
  }
}

function reviewErrorMessage(error: unknown): string {
  if (!isAxiosError<{ detail?: unknown }>(error)) {
    return "The verification decision could not be saved. Check your connection and retry.";
  }

  const detail = error.response?.data?.detail;
  if (typeof detail === "string") {
    const messages: Record<string, string> = {
      SUPPLIER_VERIFICATION_ADMIN_REQUIRED:
        "Your admin authorization could not be confirmed. Sign in again with an authorized admin account.",
      SUPPLIER_COMPANY_NOT_FOUND:
        "This supplier record is no longer available. Refresh the directory.",
      SUPPLIER_VERIFICATION_STATUS_INVALID:
        "That verification decision is not supported. Refresh the supplier details.",
      SUPPLIER_VERIFICATION_REASON_REQUIRED:
        "Enter a reason before rejecting or suspending verification.",
      SUPPLIER_VERIFICATION_TRANSITION_NOT_ALLOWED:
        "The supplier status changed or no longer allows this decision. The details have been refreshed.",
      ADMIN_SUPPLIER_VERIFICATION_REVIEW_FAILED:
        "The server could not save this decision. Retry, and contact support if the problem continues.",
    };
    if (messages[detail]) return messages[detail];
  }

  if (!error.response) {
    return "The verification service could not be reached. Check your connection and retry.";
  }
  if (error.response.status === 401 || error.response.status === 403) {
    return "You are not authorized to review supplier verification. Sign in with an admin account.";
  }
  if (error.response.status === 409) {
    return "The supplier status changed and this decision may no longer be allowed. Refresh the supplier details.";
  }
  return "The verification decision could not be saved. Retry or refresh the supplier details.";
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function AdminSuppliersPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();

  const [filter, setFilter] = useState<VerificationStatus | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queuePage, setQueuePage] = useState<QueueResponse | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [queueError, setQueueError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState("");

  const [detailsCache, setDetailsCache] = useState<Record<string, SupplierDetail>>({});

  const queueRequest = useRef(0);
  const detailRequest = useRef(0);
  const reviewActionsRef = useRef<HTMLDivElement | null>(null);
  const focusReviewAfterLoad = useRef(false);

  // -------------------------------------------------------------------------
  // Fetch Functions
  // -------------------------------------------------------------------------

  const loadQueue = useCallback(async () => {
    const requestId = ++queueRequest.current;
    setLoading(true);
    setQueueError("");
    setQueuePage(null);
    try {
      const response = await apiClient.get<QueueResponse>("/api/v1/admin/suppliers/verification", {
        params: {
          ...(filter ? { verification_status: filter } : {}),
          ...(search ? { search } : {}),
          page,
          page_size: pageSize,
        },
      });
      if (requestId !== queueRequest.current) return null;
      setQueuePage(response.data);
      setQueue(response.data.items);
      return response.data;
    } catch {
      if (requestId === queueRequest.current) {
        setQueue([]);
        setQueueError("Unable to load suppliers. Check your connection and retry.");
      }
      return null;
    } finally {
      if (requestId === queueRequest.current) setLoading(false);
    }
  }, [filter, page, search]);

  const loadDetail = useCallback(async (companyId: string) => {
    const requestId = ++detailRequest.current;
    if (!companyId) {
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    setDetail(null);
    setDetailLoading(true);
    setDetailError("");
    try {
      const response = await apiClient.get<SupplierDetail>(
        `/api/v1/admin/suppliers/${companyId}/verification`,
      );
      if (requestId !== detailRequest.current) return;
      setDetail(response.data);
      setDetailsCache((prev) => ({ ...prev, [companyId]: response.data }));
      setReason("");
    } catch {
      if (requestId === detailRequest.current) {
        setDetailError("Unable to load supplier details. Retry to try again.");
      }
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  }, []);

  const openDetail = (companyId: string, focusReview = false) => {
    focusReviewAfterLoad.current = focusReview;
    setSelectedId(companyId);
    void loadDetail(companyId);
  };

  const closeDetail = () => {
    focusReviewAfterLoad.current = false;
    setSelectedId(null);
    setDetail(null);
    setDetailError("");
    setActionError("");
    setReason("");
  };

  // -------------------------------------------------------------------------
  // Lifecycle Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isLoading && !user) router.replace("/admin/login");
    else if (!isLoading && user && user.role !== "ADMIN") router.replace("/");
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user?.role === "ADMIN") void loadQueue();
  }, [loadQueue, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    if (!focusReviewAfterLoad.current || !detail || detail.id !== selectedId) return;
    focusReviewAfterLoad.current = false;
    window.requestAnimationFrame(() => {
      reviewActionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      reviewActionsRef.current?.focus({ preventScroll: true });
    });
  }, [detail, selectedId]);

  // -------------------------------------------------------------------------
  // Review Actions
  // -------------------------------------------------------------------------

  const review = async (action: "approve" | "reject" | "suspend" | "reinstate") => {
    if (!detail || saving) return;
    const requiredStatus: Record<typeof action, VerificationStatus> = {
      approve: "PENDING_REVIEW",
      reject: "PENDING_REVIEW",
      suspend: "VERIFIED",
      reinstate: "SUSPENDED",
    };
    if (detail.verification_status !== requiredStatus[action]) {
      setActionError("The supplier status no longer allows this decision. Refreshing the supplier details.");
      await Promise.all([loadQueue(), loadDetail(detail.id)]);
      return;
    }
    if (action !== "approve" && !reason.trim()) {
      setActionError("A reason is required for rejection, suspension, and reinstatement.");
      toast.error("A reason is required for this action.");
      return;
    }
    const actionLabel = {
      approve: "approve",
      reject: "reject",
      suspend: "suspend",
      reinstate: "reinstate",
    }[action];
    const completedActionLabel = {
      approve: "approved",
      reject: "rejected",
      suspend: "suspended",
      reinstate: "reinstated",
    }[action];

    if (!window.confirm(`Are you sure you want to ${actionLabel} verification for ${detail.name}?`)) {
      return;
    }

    setSaving(true);
    setActionError("");
    setFeedback("");
    try {
      await apiClient.post(
        `/api/v1/admin/suppliers/${detail.id}/verification/${action}`,
        { reason: reason.trim() || null },
      );
      const successMsg = `Supplier verification ${completedActionLabel} successfully.`;
      toast.success(successMsg);
      setFeedback(successMsg);
      await loadQueue();
      await loadDetail(detail.id);
    } catch (error) {
      const errorMsg = reviewErrorMessage(error);
      setActionError(errorMsg);
      toast.error(errorMsg);
      if (
        isAxiosError<{ detail?: unknown }>(error)
        && error.response?.data?.detail === "SUPPLIER_VERIFICATION_TRANSITION_NOT_ALLOWED"
      ) {
        await Promise.all([loadQueue(), loadDetail(detail.id)]);
      }
    } finally {
      setSaving(false);
    }
  };

  const openDocument = async (documentId: string) => {
    if (!detail) return;
    setActionError("");
    try {
      const response = await apiClient.get<{ url: string }>(
        `/api/v1/admin/suppliers/${detail.id}/documents/${documentId}/url`,
      );
      if (!response.data?.url) throw new Error("Missing signed document URL");
      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } catch {
      const errorMsg = "Unable to create a private document link. Retry or refresh the supplier details.";
      setActionError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const changeFilter = (value: VerificationStatus | "") => {
    setFilter(value);
    setPage(1);
    setFeedback("");
  };

  const handleResetFilters = () => {
    setSearchInput("");
    setSearch("");
    setFilter("");
    setPage(1);
    setFeedback("");
  };

  // -------------------------------------------------------------------------
  // Auth Loading
  // -------------------------------------------------------------------------

  if (isLoading || !user || user.role !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb]">
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  const hasActiveFilters = Boolean(search || filter);

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
              <span className="text-xs text-slate-400 font-medium">Authoritative Database</span>
            </div>
            <h1 className="mt-1 font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wide text-slate-900">
              Suppliers Directory
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              Manage registered supplier companies, verification reviews, business identities, and submitted documentation.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {queuePage && (
              <div className="hidden sm:flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs shadow-2xs">
                <span className="font-bold uppercase tracking-wider text-slate-400">Total</span>
                <span className="font-bold text-slate-900">{queuePage.total} Suppliers</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => void loadQueue()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer self-start sm:self-auto disabled:opacity-50"
              title="Refresh supplier records"
            >
              <RotateCw size={14} className={loading ? "animate-spin text-blue-600" : "text-slate-500"} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* =================================================================== */}
        {/* Alerts & Notifications */}
        {/* =================================================================== */}
        {feedback && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>{feedback}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback("")}
              className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
              title="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {actionError && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError("")}
              className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
              title="Dismiss error"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {queueError && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
              <span>{queueError}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="font-bold underline hover:no-underline ml-4 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* =================================================================== */}
        {/* Search and Filters Bar */}
        {/* =================================================================== */}
        <div className="mb-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Search Input */}
            <div className="relative sm:col-span-2 lg:col-span-2">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by public company name..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-8 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none transition"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Verification Status Filter */}
            <div className="sm:col-span-2 lg:col-span-2">
              <select
                value={filter}
                onChange={(e) => changeFilter(e.target.value as VerificationStatus | "")}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition cursor-pointer"
              >
                <option value="">All Verification Statuses</option>
                {verificationStatuses.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Filter Indicators & Reset Button */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
              <div className="flex items-center gap-2 text-slate-500">
                <Filter size={13} className="text-blue-600" />
                <span>Filters active:</span>
                {search && (
                  <span className="rounded-md bg-blue-50 border border-blue-100 px-2 py-0.5 font-medium text-blue-700">
                    &ldquo;{search}&rdquo;
                  </span>
                )}
                {filter && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    Status: {statusLabel(filter)}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          )}
        </div>

        {/* =================================================================== */}
        {/* Suppliers Table (Desktop) */}
        {/* =================================================================== */}
        <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 font-bold uppercase tracking-wider">
                <th className="px-5 py-3.5">Supplier / Company</th>
                <th className="px-4 py-3.5">Verification</th>
                <th className="px-4 py-3.5">Operational Status</th>
                <th className="px-4 py-3.5">Submitted</th>
                <th className="px-4 py-3.5">Registered</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 size={24} className="mx-auto animate-spin text-blue-600 mb-2" />
                    <span>Loading supplier records from database...</span>
                  </td>
                </tr>
              ) : queue.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <Building2 size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No suppliers found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {hasActiveFilters
                        ? "Try clearing or relaxing your search and filter criteria."
                        : "No registered supplier accounts currently exist."}
                    </p>
                    {filter === "PENDING_REVIEW" && !search && (
                      <button
                        type="button"
                        onClick={() => changeFilter("")}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer"
                      >
                        View all suppliers
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                queue.map((item) => {
                  const vBadge = formatVerificationStatus(item.verification_status);
                  const cached = detailsCache[item.id];
                  const opStatus = cached?.operational_status || (item.verification_status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE");
                  const opBadge = formatOperationalStatus(opStatus);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => openDetail(item.id)}
                      className="hover:bg-slate-50/60 transition cursor-pointer group"
                    >
                      {/* Supplier Company Identity */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 font-bold text-blue-700 border border-blue-100 text-xs">
                            {item.name ? item.name.charAt(0).toUpperCase() : <Building size={16} />}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 group-hover:text-blue-700 transition truncate">
                              {item.name}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
                              {cached?.registered_name ? (
                                <span>{cached.registered_name}</span>
                              ) : (
                                <span className="font-mono">{item.id.slice(0, 8)}...</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Verification Status */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${vBadge.bg} ${vBadge.text} ${vBadge.border}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${vBadge.dot}`} />
                          {vBadge.label}
                        </span>
                      </td>

                      {/* Operational Status */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${opBadge.bg} ${opBadge.text} ${opBadge.border}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${opBadge.dot}`} />
                          {opBadge.label}
                        </span>
                      </td>

                      {/* Submitted Date */}
                      <td className="px-4 py-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                        {item.verification_submitted_at ? (
                          formatDate(item.verification_submitted_at)
                        ) : (
                          <span className="text-slate-400">Not submitted</span>
                        )}
                      </td>

                      {/* Registered Date */}
                      <td className="px-4 py-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                        {formatDate(item.created_at)}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(item.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 hover:text-blue-700 transition cursor-pointer"
                          aria-label={`View details for ${item.name}`}
                        >
                          <Eye size={12} />
                          <span>View details</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(item.id, true);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 shadow-2xs hover:bg-blue-100 transition cursor-pointer"
                          aria-label={`Update status for ${item.name}; current status ${statusLabel(item.verification_status)}`}
                        >
                          <ShieldCheck size={12} />
                          <span>Update status</span>
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* =================================================================== */}
        {/* Mobile Cards View */}
        {/* =================================================================== */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
              <Loader2 size={24} className="mx-auto animate-spin text-blue-600 mb-2" />
              <span>Loading supplier records...</span>
            </div>
          ) : queue.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
              <Building2 size={28} className="mx-auto text-slate-300 mb-2" />
              <p className="font-semibold text-slate-600">No suppliers found</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {hasActiveFilters ? "Try resetting your active filters." : "No records currently exist."}
              </p>
              {filter === "PENDING_REVIEW" && !search && (
                <button
                  type="button"
                  onClick={() => changeFilter("")}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer"
                >
                  View all suppliers
                </button>
              )}
            </div>
          ) : (
            queue.map((item) => {
              const vBadge = formatVerificationStatus(item.verification_status);
              const cached = detailsCache[item.id];
              const opStatus = cached?.operational_status || (item.verification_status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE");
              const opBadge = formatOperationalStatus(opStatus);

              return (
                <div
                  key={item.id}
                  onClick={() => openDetail(item.id)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs hover:border-blue-300 transition cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-slate-900 text-sm truncate">{item.name}</h4>
                      <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">
                        {cached?.registered_name || item.id}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold shrink-0 ${vBadge.bg} ${vBadge.text} ${vBadge.border}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${vBadge.dot}`} />
                      {vBadge.label}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${opBadge.bg} ${opBadge.text} ${opBadge.border}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${opBadge.dot}`} />
                      {opBadge.label}
                    </span>

                    <span className="text-[11px] text-slate-400 ml-auto">
                      {item.verification_submitted_at
                        ? `Submitted ${formatDate(item.verification_submitted_at)}`
                        : `Joined ${formatDate(item.created_at)}`}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDetail(item.id);
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      aria-label={`View details for ${item.name}`}
                    >
                      <Eye size={13} /> View details
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDetail(item.id, true);
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      aria-label={`Update status for ${item.name}; current status ${statusLabel(item.verification_status)}`}
                    >
                      <ShieldCheck size={13} /> Update status
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* =================================================================== */}
        {/* Pagination Controls */}
        {/* =================================================================== */}
        {!loading && queuePage && queuePage.total > 0 && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-800">{queue.length}</span> of{" "}
              <span className="font-semibold text-slate-800">{queuePage.total}</span> registered suppliers
              (Page <span className="font-semibold text-slate-800">{queuePage.page}</span> of{" "}
              <span className="font-semibold text-slate-800">{queuePage.total_pages}</span>)
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                <ChevronLeft size={14} />
                <span>Previous</span>
              </button>

              <button
                type="button"
                disabled={page >= queuePage.total_pages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* Supplier Detail Slide-Over Drawer */}
        {/* =================================================================== */}
        {selectedId && (
          <div className="fixed inset-0 z-50 overflow-hidden">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
              onClick={closeDetail}
            />

            <div className="fixed inset-y-0 right-0 flex max-w-full pl-6 sm:pl-16">
              <div className="w-screen max-w-2xl bg-[#f8faff] shadow-2xl flex flex-col border-l border-slate-200">
                {/* Drawer Top Header */}
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-blue-700 border border-blue-100">
                      Supplier Verification
                    </span>
                    <span className="text-xs font-mono text-slate-400 truncate max-w-[160px]">
                      {selectedId}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={closeDetail}
                    className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                    title="Close drawer"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Drawer Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {detailLoading ? (
                    <div className="py-20 text-center text-slate-400">
                      <Loader2 size={32} className="mx-auto animate-spin text-blue-600 mb-3" />
                      <p className="text-sm font-medium">Loading supplier profile & evidence...</p>
                    </div>
                  ) : detailError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-700 text-xs">
                      <AlertCircle size={24} className="mx-auto mb-2 text-rose-600" />
                      <p className="font-bold">{detailError}</p>
                      <button
                        type="button"
                        onClick={() => void loadDetail(selectedId)}
                        className="mt-3 inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-700 transition cursor-pointer"
                      >
                        <RotateCw size={12} />
                        <span>Retry</span>
                      </button>
                    </div>
                  ) : !detail ? null : (
                    <>
                      {/* Identity Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-start gap-4">
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-50 font-bold text-blue-700 border border-blue-100 text-2xl">
                            {detail.name ? detail.name.charAt(0).toUpperCase() : <Building2 size={28} />}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-xl font-bold text-slate-900 truncate">
                                {detail.name}
                              </h2>

                              {/* Verification status badge */}
                              {(() => {
                                const vb = formatVerificationStatus(detail.verification_status);
                                return (
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${vb.bg} ${vb.text} ${vb.border}`}
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${vb.dot}`} />
                                    {vb.label}
                                  </span>
                                );
                              })()}

                              {/* Operational status badge */}
                              {(() => {
                                const ob = formatOperationalStatus(detail.operational_status);
                                return (
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${ob.bg} ${ob.text} ${ob.border}`}
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${ob.dot}`} />
                                    {ob.label}
                                  </span>
                                );
                              })()}
                            </div>

                            {detail.description && (
                              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                                {detail.description}
                              </p>
                            )}

                            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                              {detail.website && (
                                <a
                                  href={detail.website}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  <Globe size={13} />
                                  <span>Company website</span>
                                  <ExternalLink size={11} />
                                </a>
                              )}
                              <span className="flex items-center gap-1">
                                <Calendar size={13} className="text-slate-400" />
                                <span>Registered {formatDate(detail.created_at)}</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Quick Metrics Strip */}
                        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Verification
                            </span>
                            <p className="text-xs font-bold text-slate-800 mt-0.5">
                              {statusLabel(detail.verification_status)}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Operational Status
                            </span>
                            <p className="text-xs font-bold text-slate-800 mt-0.5">
                              {detail.operational_status.replaceAll("_", " ")}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Owner and Membership Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-center gap-2 mb-4">
                          <Users size={16} className="text-blue-600" />
                          <h3 className="font-bold text-slate-900 text-sm">Owner and Membership</h3>
                        </div>

                        {detail.owner_membership ? (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Owner
                              </span>
                              <p className="text-xs font-bold text-slate-800 mt-1">
                                {detail.owner_membership.name || "Name not available"}
                              </p>
                            </div>
                            <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Role & Membership
                              </span>
                              <p className="text-xs font-bold text-slate-800 mt-1">
                                {detail.owner_membership.role} · {detail.owner_membership.status}
                              </p>
                            </div>
                            <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Member Since
                              </span>
                              <p className="text-xs font-semibold text-slate-700 mt-1">
                                {formatDate(detail.owner_membership.created_at)}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No owner membership record was returned.</p>
                        )}
                      </div>

                      {/* Private Registration & Contact Details Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-center gap-2 mb-4">
                          <Building size={16} className="text-blue-600" />
                          <h3 className="font-bold text-slate-900 text-sm">
                            Private Registration & Contact Details
                          </h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Registered Name
                            </span>
                            <p className="font-semibold text-slate-800 mt-1 break-words">
                              {detail.registered_name || "—"}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Registration Number
                            </span>
                            <p className="font-semibold text-slate-800 mt-1 break-words font-mono">
                              {detail.registration_number || "—"}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                              <Mail size={11} className="text-slate-400" />
                              <span>Contact Email</span>
                            </span>
                            <p className="font-semibold text-slate-800 mt-1 break-words">
                              {detail.contact_email || "—"}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                              <Phone size={11} className="text-slate-400" />
                              <span>Contact Phone</span>
                            </span>
                            <p className="font-semibold text-slate-800 mt-1">
                              {detail.contact_phone || "—"}
                            </p>
                          </div>
                          <div className="sm:col-span-2 rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                              <MapPin size={11} className="text-slate-400" />
                              <span>Registered Address</span>
                            </span>
                            <p className="font-semibold text-slate-800 mt-1 break-words">
                              {detail.registered_address || "—"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Verification Timeline Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-center gap-2 mb-4">
                          <Clock size={16} className="text-blue-600" />
                          <h3 className="font-bold text-slate-900 text-sm">Verification Timeline</h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Company Created
                            </span>
                            <p className="font-semibold text-slate-800 mt-1">
                              {formatDateTime(detail.created_at)}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Submitted for Review
                            </span>
                            <p className="font-semibold text-slate-800 mt-1">
                              {formatDateTime(detail.verification_submitted_at)}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Last Reviewed
                            </span>
                            <p className="font-semibold text-slate-800 mt-1">
                              {formatDateTime(detail.verification_reviewed_at)}
                            </p>
                          </div>
                          {detail.verification_reviewed_by && (
                            <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Reviewed By
                              </span>
                              <p className="font-semibold text-slate-800 mt-1 font-mono text-[11px] truncate">
                                {detail.verification_reviewed_by}
                              </p>
                            </div>
                          )}
                          {detail.verification_reason && (
                            <div className="sm:col-span-2 rounded-xl bg-amber-50/60 border border-amber-200/80 p-3 text-amber-900">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
                                Latest Review Feedback
                              </span>
                              <p className="font-medium text-xs mt-1 leading-relaxed">
                                {detail.verification_reason}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Submitted Evidence Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-center gap-2 mb-4">
                          <FileText size={16} className="text-blue-600" />
                          <h3 className="font-bold text-slate-900 text-sm">Submitted Evidence</h3>
                        </div>

                        <div className="space-y-2.5">
                          {detail.documents.map((document) => (
                            <div
                              key={document.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 hover:bg-slate-50 transition"
                            >
                              <div className="min-w-0 flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100/60 text-blue-700">
                                  <FileText size={18} />
                                </div>
                                <div className="min-w-0">
                                  <p className="break-all text-xs font-bold text-slate-800">
                                    {document.original_filename}
                                  </p>
                                  <p className="text-[11px] text-slate-500 mt-0.5">
                                    {document.document_type.replaceAll("_", " ")} ·{" "}
                                    {Math.ceil(document.file_size_bytes / 1024)} KB ·{" "}
                                    {formatDate(document.uploaded_at)}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void openDocument(document.id)}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 hover:text-blue-700 transition cursor-pointer"
                              >
                                <ExternalLink size={13} />
                                <span>View Private File</span>
                              </button>
                            </div>
                          ))}
                          {detail.documents.length === 0 && (
                            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                              <FileText size={24} className="mx-auto mb-1 text-slate-300" />
                              <p>No verification evidence has been submitted.</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Review Decision & Actions Card */}
                      <div
                        ref={reviewActionsRef}
                        id="supplier-review-actions"
                        tabIndex={-1}
                        className="rounded-2xl border border-amber-200 bg-amber-50/40 p-6 shadow-xs scroll-mt-6 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <ShieldAlert size={16} className="text-amber-600" />
                          <h3 className="font-bold text-slate-900 text-sm">Review Decision & Actions</h3>
                        </div>

                        {detail.verification_status === "NOT_SUBMITTED" && (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-700">
                            <p className="font-bold text-slate-900">
                              This supplier has not submitted its verification request.
                            </p>
                            <p className="mt-1.5">
                              Uploading evidence alone does not submit a request. The supplier owner must use <strong>Submit for review</strong> in the supplier workspace after uploading the required legitimate evidence. Admin review actions are unavailable until the backend accepts that submission.
                            </p>
                          </div>
                        )}

                        {detail.verification_status === "PENDING_REVIEW" && (
                          <>
                            <p className="mb-3 rounded-xl border border-amber-200 bg-white p-3 text-xs leading-relaxed text-slate-700">
                              This supplier has submitted a verification request. Inspect the submitted evidence before making a decision.
                            </p>
                            {detail.documents.length > 0 ? (
                              <>
                                <label
                                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                                  htmlFor="review-reason"
                                >
                                  Review reason or feedback
                                </label>
                                <textarea
                                  id="review-reason"
                                  rows={3}
                                  maxLength={2000}
                                  value={reason}
                                  onChange={(event) => setReason(event.target.value)}
                                  className="w-full rounded-xl border border-amber-300/80 bg-white p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none transition"
                                  placeholder="Required when rejecting this request."
                                  disabled={saving}
                                />
                              </>
                            ) : (
                              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                                No evidence is attached to this pending request. Approval and rejection are unavailable until the submitted evidence can be reviewed.
                              </p>
                            )}
                          </>
                        )}

                        {detail.verification_status === "VERIFIED" && (
                          <>
                            <p className="mb-3 rounded-xl border border-emerald-200 bg-white p-3 text-xs leading-relaxed text-slate-700">
                              This supplier is verified. You may suspend verification if there is a valid reason.
                            </p>
                            <label
                              className="mb-1.5 block text-xs font-semibold text-slate-700"
                              htmlFor="review-reason"
                            >
                              Suspension reason
                            </label>
                            <textarea
                              id="review-reason"
                              rows={3}
                              maxLength={2000}
                              value={reason}
                              onChange={(event) => setReason(event.target.value)}
                              className="w-full rounded-xl border border-amber-300/80 bg-white p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none transition"
                              placeholder="Required to suspend verification."
                              disabled={saving}
                            />
                          </>
                        )}

                        {detail.verification_status === "SUSPENDED" && (
                          <>
                            <p className="mb-3 rounded-xl border border-rose-200 bg-white p-3 text-xs leading-relaxed text-slate-700">
                              This supplier&apos;s verification is suspended. You may reinstate it after review; provide a reason for the decision.
                            </p>
                            <label
                              className="mb-1.5 block text-xs font-semibold text-slate-700"
                              htmlFor="review-reason"
                            >
                              Reinstatement reason
                            </label>
                            <textarea
                              id="review-reason"
                              rows={3}
                              maxLength={2000}
                              value={reason}
                              onChange={(event) => setReason(event.target.value)}
                              className="w-full rounded-xl border border-amber-300/80 bg-white p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none transition"
                              placeholder="Required to reinstate verification."
                              disabled={saving}
                            />
                          </>
                        )}

                        {detail.verification_status === "REJECTED" && (
                          <div className="rounded-xl border border-rose-200 bg-white p-4 text-xs leading-relaxed text-slate-700">
                            <p className="font-bold text-rose-800">This verification request was rejected.</p>
                            <p className="mt-1.5">
                              {detail.verification_reason
                                ? `Rejection reason: ${detail.verification_reason}`
                                : "See the review history for the decision details."}
                            </p>
                            <p className="mt-1.5">
                              The supplier owner may address the feedback, upload the required evidence, and submit a new request from the supplier workspace. Admins cannot approve a rejected request directly.
                            </p>
                          </div>
                        )}

                        {detail.verification_status === "PENDING_REVIEW" && (
                          <div className="mt-3.5 flex flex-wrap gap-2.5">
                            <button
                              type="button"
                              disabled={saving || detail.documents.length === 0}
                              onClick={() => void review("approve")}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition cursor-pointer"
                            >
                              <ShieldCheck size={14} />
                              <span>Approve Verification</span>
                            </button>
                            <button
                              type="button"
                              disabled={saving || !reason.trim() || detail.documents.length === 0}
                              onClick={() => void review("reject")}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer"
                            >
                              <X size={14} />
                              <span>Reject Verification</span>
                            </button>
                          </div>
                        )}

                        {detail.verification_status === "VERIFIED" && (
                          <div className="mt-3.5">
                            <button
                              type="button"
                              disabled={saving || !reason.trim()}
                              onClick={() => void review("suspend")}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer"
                            >
                              <ShieldAlert size={14} />
                              <span>Suspend Verification</span>
                            </button>
                          </div>
                        )}

                        {detail.verification_status === "SUSPENDED" && (
                          <div className="mt-3.5">
                            <button
                              type="button"
                              disabled={saving || !reason.trim()}
                              onClick={() => void review("reinstate")}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition cursor-pointer"
                            >
                              <ShieldCheck size={14} />
                              <span>Reinstate Verification</span>
                            </button>
                          </div>
                        )}

                        {saving && (
                          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-600">
                            <Loader2 className="animate-spin text-blue-600" size={14} />
                            <span>Saving verification decision...</span>
                          </div>
                        )}
                      </div>

                      {/* Review History Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-center gap-2 mb-4">
                          <Clock size={16} className="text-blue-600" />
                          <h3 className="font-bold text-slate-900 text-sm">Review History</h3>
                        </div>

                        {detail.events.length ? (
                          <ol className="space-y-4">
                            {detail.events.map((event) => (
                              <li key={event.id} className="relative pl-5 border-l-2 border-slate-200">
                                <div className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-blue-600" />
                                <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                                  <span className="font-bold text-slate-800">
                                    {event.previous_status ? statusLabel(event.previous_status) : "NEW"} →{" "}
                                    {statusLabel(event.new_status)}
                                  </span>
                                  <span className="text-[11px] text-slate-400">
                                    {formatDateTime(event.created_at)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-0.5">
                                  {event.actor_name || "System"}
                                </p>
                                {event.reason && (
                                  <p className="mt-1 text-xs text-slate-600 rounded-lg bg-slate-50 p-2 border border-slate-100">
                                    {event.reason}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No review events recorded.</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </AdminShell>
  );
}
