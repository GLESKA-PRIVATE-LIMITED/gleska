"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Clock,
  CreditCard,
  Eye,
  Filter,
  Loader2,
  RotateCw,
  Search,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AdminShell from "@/components/admin/AdminShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaymentItem {
  id: string;
  order_id: string;
  cf_order_id: string | null;
  user_type: string;
  payment_category: "WORKER_SUBSCRIPTION" | "BUSINESS_SUBSCRIPTION" | "INDIVIDUAL_COMMISSION" | "LEGACY_PAYMENT" | string;
  job_id: string | null;
  job_title: string | null;
  worker_name: string | null;
  user_id: string | null;
  user_name: string | null;
  user_mobile: string | null;
  employer_id: string | null;
  worker_profile_id: string | null;
  amount: number;
  currency: string;
  status: string;
  employee_count: number | null;
  created_at: string;
  updated_at: string | null;
  payment_success_at: string | null;
  subscription_valid_from: string | null;
  subscription_valid_until: string | null;
  validity_status: string;
}

interface PaymentListResponse {
  items: PaymentItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  total_success?: number;
  total_pending?: number;
  total_active_validity?: number;
  total_active_payment_validity?: number;
}

interface PaymentDetailResponse extends PaymentItem {
  user_email: string | null;
  user_role: string | null;
  user_is_active: boolean | null;
  employer_type: string | null;
  has_availed_free_dispatch: boolean | null;
  onboarding_status: string | null;
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

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtAmount(amount: number) {
  return "\u20B9" + amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function paymentPurpose(item: PaymentItem): string {
  if (item.payment_category === "INDIVIDUAL_COMMISSION") {
    return item.worker_name ? `Commission: ${item.worker_name}` : "Individual Commission";
  }
  if (item.payment_category === "BUSINESS_SUBSCRIPTION") {
    return "Business Subscription";
  }
  if (item.payment_category === "WORKER_SUBSCRIPTION") {
    return "Worker Subscription";
  }
  if (item.employee_count != null && item.employee_count > 0) {
    return `Legacy (${item.employee_count} emp × ₹30)`;
  }
  return "Legacy Payment";
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  SUCCESS: {
    label: "Success",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  PENDING: {
    label: "Pending",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  FAILED: {
    label: "Failed",
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
  },
  CANCELLED: {
    label: "Cancelled",
    bg: "bg-slate-100",
    text: "text-slate-600",
    border: "border-slate-200",
  },
  EXPIRED: {
    label: "Expired",
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
  },
};

function PaymentStatusBadge({ status }: { status: string }) {
  const norm = (status || "").toUpperCase();
  const cfg = PAYMENT_STATUS_CONFIG[norm] || {
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

const VALIDITY_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  ACTIVE: {
    label: "Active",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  EXPIRED: {
    label: "Expired",
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
  },
  NONE: {
    label: "N/A",
    bg: "bg-slate-100",
    text: "text-slate-500",
    border: "border-slate-200",
  },
  "N/A": {
    label: "N/A",
    bg: "bg-slate-100",
    text: "text-slate-500",
    border: "border-slate-200",
  },
  UNKNOWN: {
    label: "Unknown",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
};

function ValidityBadge({ status }: { status: string }) {
  const norm = (status || "UNKNOWN").toUpperCase();
  const cfg = VALIDITY_CONFIG[norm] || VALIDITY_CONFIG.UNKNOWN;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {cfg.label}
    </span>
  );
}

function UserTypeBadge({ type }: { type: string }) {
  const isWorker = type === "WORKER";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        isWorker
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-violet-50 text-violet-700 border-violet-200"
      }`}
    >
      <User size={10} className="shrink-0" />
      {isWorker ? "Worker" : "Employer"}
    </span>
  );
}

const CATEGORY_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  WORKER_SUBSCRIPTION: {
    label: "Worker Sub",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  BUSINESS_SUBSCRIPTION: {
    label: "Business Sub",
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
  },
  INDIVIDUAL_COMMISSION: {
    label: "Commission",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
  },
  LEGACY_PAYMENT: {
    label: "Legacy",
    bg: "bg-slate-100",
    text: "text-slate-600",
    border: "border-slate-200",
  },
  UNKNOWN: {
    label: "Unknown",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
};

function PaymentCategoryBadge({ category }: { category?: string }) {
  const norm = (category || "LEGACY_PAYMENT").toUpperCase();
  const cfg = CATEGORY_CONFIG[norm] || CATEGORY_CONFIG.LEGACY_PAYMENT;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail Row
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-slate-100 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="text-sm text-slate-800 break-all">{value || "—"}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AdminPaymentsPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [validityFilter, setValidityFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [kpiSuccess, setKpiSuccess] = useState(0);
  const [kpiPending, setKpiPending] = useState(0);
  const [kpiActiveValidity, setKpiActiveValidity] = useState(0);
  const [kpiActivePaymentValidity, setKpiActivePaymentValidity] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");

  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [paymentDetail, setPaymentDetail] = useState<PaymentDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/admin/login");
      return;
    }
    if (!isLoading && user && user.role !== "ADMIN") {
      router.replace("/");
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [userTypeFilter, statusFilter, validityFilter, categoryFilter]);

  const fetchPayments = useCallback(async () => {
    if (!user || user.role !== "ADMIN") return;
    setLoadingList(true);
    setListError("");
    try {
      const params: Record<string, string | number> = {
        page: currentPage,
        page_size: pageSize,
      };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (userTypeFilter !== "ALL") params.user_type = userTypeFilter;
      if (statusFilter !== "ALL") params.status = statusFilter;
      if (validityFilter !== "ALL") params.validity_status = validityFilter;
      if (categoryFilter !== "ALL") params.payment_category = categoryFilter;

      const res = await apiClient.get<PaymentListResponse>("/api/v1/admin/payments", { params });
      setPayments(res.data.items || []);
      setTotalCount(res.data.total || 0);
      setTotalPages(res.data.total_pages || 1);
      setKpiSuccess(res.data.total_success ?? 0);
      setKpiPending(res.data.total_pending ?? 0);
      setKpiActiveValidity(res.data.total_active_validity ?? 0);
      setKpiActivePaymentValidity(res.data.total_active_payment_validity ?? 0);
    } catch {
      setListError("Failed to fetch payments. Please check your connection and try again.");
    } finally {
      setLoadingList(false);
    }
  }, [user, currentPage, pageSize, debouncedSearch, userTypeFilter, statusFilter, validityFilter, categoryFilter]);

  useEffect(() => {
    void fetchPayments();
  }, [fetchPayments]);

  const openPaymentDetail = useCallback(async (paymentId: string) => {
    setSelectedPaymentId(paymentId);
    setLoadingDetail(true);
    setDetailError("");
    setPaymentDetail(null);
    try {
      const res = await apiClient.get<PaymentDetailResponse>(
        "/api/v1/admin/payments/" + paymentId
      );
      setPaymentDetail(res.data);
    } catch {
      setDetailError("Unable to load payment details.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const closePaymentDetail = () => {
    setSelectedPaymentId(null);
    setPaymentDetail(null);
    setDetailError("");
  };

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
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-violet-700 border border-violet-100">
                Financial Records
              </span>
              <span className="text-xs text-slate-400 font-medium">Cashfree PG · Payment records</span>
            </div>
            <h1 className="mt-1 font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wide text-slate-900">
              Payments Directory
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              All platform payment transactions — employer and worker subscriptions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchPayments()}
            disabled={loadingList}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition disabled:opacity-60 cursor-pointer"
          >
            <RotateCw size={15} className={loadingList ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* KPI Cards */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2 text-slate-500">
              <CreditCard size={16} />
              <span className="text-xs font-semibold uppercase tracking-wider">Total</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{totalCount}</p>
            <p className="mt-0.5 text-xs text-slate-400">All time transactions</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 size={16} />
              <span className="text-xs font-semibold uppercase tracking-wider">Successful</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{kpiSuccess}</p>
            <p className="mt-0.5 text-xs text-slate-400">Platform-wide</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-amber-600">
              <Clock size={16} />
              <span className="text-xs font-semibold uppercase tracking-wider">Pending</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{kpiPending}</p>
            <p className="mt-0.5 text-xs text-slate-400">Platform-wide</p>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-blue-600">
              <ShieldCheck size={16} />
              <span className="text-xs font-semibold uppercase tracking-wider">Current Active Profiles</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{kpiActiveValidity}</p>
            <p className="mt-0.5 text-xs text-slate-400">Current profile entitlements</p>
          </div>
          <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-cyan-700">
              <ShieldCheck size={16} />
              <span className="text-xs font-semibold uppercase tracking-wider">Active Payment Periods</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{kpiActivePaymentValidity}</p>
            <p className="mt-0.5 text-xs text-slate-400">Stored payment validity</p>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search name, mobile, order ID…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-800 shadow-xs outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400 shrink-0" />
            <select
              value={userTypeFilter}
              onChange={(e) => setUserTypeFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition cursor-pointer"
            >
              <option value="ALL">All Users</option>
              <option value="WORKER">Workers</option>
              <option value="EMPLOYER">Employers</option>
            </select>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="PENDING">Pending</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="EXPIRED">Expired</option>
          </select>
          <select
            value={validityFilter}
            onChange={(e) => setValidityFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition cursor-pointer"
          >
            <option value="ALL">All Validity</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="UNKNOWN">Unknown</option>
            <option value="N/A">N/A</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition cursor-pointer"
          >
            <option value="ALL">All Categories</option>
            <option value="WORKER_SUBSCRIPTION">Worker Subscription</option>
            <option value="BUSINESS_SUBSCRIPTION">Business Subscription</option>
            <option value="INDIVIDUAL_COMMISSION">Individual Commission</option>
            <option value="LEGACY_PAYMENT">Legacy Payment</option>
            <option value="UNKNOWN">Unknown</option>
          </select>
        </div>

        {/* Results summary */}
        <div className="mb-3 flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>
            {loadingList
              ? "Loading…"
              : "Showing page " + currentPage + " of " + totalPages + " (" + totalCount + " total payments)"}
          </span>
          {payments.length > 0 && !loadingList && (
            <span className="text-slate-400">
              {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
            </span>
          )}
        </div>

        {listError && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle size={16} className="shrink-0" />
            {listError}
          </div>
        )}

        {/* Desktop Table */}
        <div className="hidden sm:block rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {[
                    "User",
                    "Type",
                    "Category",
                    "Purpose",
                    "Amount",
                    "Status",
                    "Paid On",
                    "Valid From",
                    "Valid Until",
                    "Validity",
                    "View",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500 last:text-center"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingList ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-16 text-center">
                      <Loader2 size={28} className="mx-auto animate-spin text-blue-500" />
                      <p className="mt-2 text-sm text-slate-500">Loading payments…</p>
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-16 text-center">
                      <CreditCard size={36} className="mx-auto text-slate-300" />
                      <p className="mt-2 text-sm font-semibold text-slate-500">No payments found</p>
                      <p className="text-xs text-slate-400">Try adjusting your filters or search.</p>
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => void openPaymentDetail(p.id)}
                      className={`hover:bg-slate-50 transition cursor-pointer ${
                        selectedPaymentId === p.id ? "bg-blue-50/60" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 truncate max-w-[150px]">
                          {p.user_name || "—"}
                        </p>
                        <p className="text-xs text-slate-400 font-mono">{p.user_mobile || "—"}</p>
                        <p
                          className="text-[11px] text-slate-400 font-mono tracking-tight select-all truncate max-w-[150px]"
                          title={p.order_id}
                        >
                          {p.order_id}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <UserTypeBadge type={p.user_type} />
                      </td>
                      <td className="px-4 py-3">
                        <PaymentCategoryBadge category={p.payment_category} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p className="font-medium text-slate-800">{paymentPurpose(p)}</p>
                        {p.job_title && (
                          <p
                            className="text-[11px] text-slate-400 truncate max-w-[140px]"
                            title={p.job_title}
                          >
                            Job: {p.job_title}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {fmtAmount(p.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {fmtDateTime(p.payment_success_at || p.created_at)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {p.payment_category === "INDIVIDUAL_COMMISSION" || p.validity_status === "N/A"
                          ? "N/A"
                          : p.subscription_valid_from ? fmtDate(p.subscription_valid_from) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {p.payment_category === "INDIVIDUAL_COMMISSION" || p.validity_status === "N/A"
                          ? "N/A"
                          : p.subscription_valid_until ? fmtDate(p.subscription_valid_until) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <ValidityBadge status={p.validity_status} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openPaymentDetail(p.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition cursor-pointer"
                        >
                          <Eye size={12} />
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile Cards */}
        <div className="sm:hidden space-y-3">
          {loadingList ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Loader2 size={28} className="animate-spin text-blue-500" />
              <p className="mt-2 text-sm text-slate-500">Loading payments…</p>
            </div>
          ) : payments.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <CreditCard size={36} className="text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-500">No payments found</p>
              <p className="text-xs text-slate-400">Try adjusting your filters or search.</p>
            </div>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                onClick={() => void openPaymentDetail(p.id)}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs cursor-pointer hover:border-blue-200 transition"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{p.user_name || "—"}</p>
                    <p className="text-xs text-slate-400">{p.user_mobile || "No mobile"}</p>
                    <p className="text-[11px] text-slate-400 font-mono tracking-tight truncate select-all">
                      {p.order_id}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <PaymentStatusBadge status={p.status} />
                    <ValidityBadge status={p.validity_status} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <UserTypeBadge type={p.user_type} />
                  <PaymentCategoryBadge category={p.payment_category} />
                  <span className="text-sm font-bold text-slate-900">{fmtAmount(p.amount)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  <p className="font-medium">{paymentPurpose(p)}</p>
                  {p.job_title && (
                    <p className="text-[11px] text-slate-400">Job: {p.job_title}</p>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-400 border-t border-slate-100 pt-2">
                  <span>Paid {fmtDateTime(p.payment_success_at || p.created_at)}</span>
                  {p.validity_status === "N/A" ? <span>N/A</span> : p.subscription_valid_until && (
                    <span>Valid until {fmtDate(p.subscription_valid_until)}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1 || loadingList}
              className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition cursor-pointer"
            >
              <ChevronLeft size={16} />
              Prev
            </button>
            <span className="text-sm font-semibold text-slate-600 px-2">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || loadingList}
              className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition cursor-pointer"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </main>

      {/* Detail Slide-over Drawer */}
      {selectedPaymentId && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={closePaymentDetail}
          />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900">
                  Payment Detail
                </h2>
                <p className="text-xs text-slate-400 font-mono truncate max-w-[280px]">
                  {paymentDetail?.order_id || selectedPaymentId}
                </p>
              </div>
              <button
                type="button"
                onClick={closePaymentDetail}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loadingDetail ? (
                <div className="flex flex-col items-center py-16 text-center">
                  <Loader2 size={28} className="animate-spin text-blue-500" />
                  <p className="mt-2 text-sm text-slate-500">Loading payment details…</p>
                </div>
              ) : detailError ? (
                <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mt-4">
                  <CircleX size={16} className="shrink-0" />
                  {detailError}
                </div>
              ) : paymentDetail ? (
                <div>
                  <div className="flex flex-wrap gap-2 py-3 border-b border-slate-100">
                    <PaymentStatusBadge status={paymentDetail.status} />
                    <ValidityBadge status={paymentDetail.validity_status} />
                    <UserTypeBadge type={paymentDetail.user_type} />
                    <PaymentCategoryBadge category={paymentDetail.payment_category} />
                  </div>

                  <div className="pt-3 pb-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      User Information
                    </p>
                  </div>
                  <DetailRow label="Name" value={paymentDetail.user_name} />
                  <DetailRow label="Mobile" value={paymentDetail.user_mobile} />
                  <DetailRow label="Email" value={paymentDetail.user_email} />
                  <DetailRow label="User Role" value={paymentDetail.user_role} />
                  <DetailRow
                    label="Account Active"
                    value={
                      paymentDetail.user_is_active == null
                        ? "—"
                        : paymentDetail.user_is_active
                        ? "Yes"
                        : "No"
                    }
                  />
                  {paymentDetail.onboarding_status && (
                    <DetailRow
                      label="Onboarding Status"
                      value={paymentDetail.onboarding_status}
                    />
                  )}

                  {paymentDetail.user_type === "EMPLOYER" && (
                    <>
                      <div className="pt-3 pb-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                          Employer Details
                        </p>
                      </div>
                      <DetailRow label="Employer Type" value={paymentDetail.employer_type} />
                      <DetailRow
                        label="Free Dispatch Used"
                        value={
                          paymentDetail.has_availed_free_dispatch == null
                            ? "—"
                            : paymentDetail.has_availed_free_dispatch
                            ? "Yes"
                            : "No"
                        }
                      />
                      {paymentDetail.employee_count != null && (
                        <DetailRow
                          label="Employee Count"
                          value={String(paymentDetail.employee_count)}
                        />
                      )}
                    </>
                  )}

                  <div className="pt-3 pb-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Payment Information
                    </p>
                  </div>
                  <DetailRow label="Amount" value={fmtAmount(paymentDetail.amount)} />
                  <DetailRow label="Currency" value={paymentDetail.currency} />
                  <DetailRow
                    label="Category"
                    value={<PaymentCategoryBadge category={paymentDetail.payment_category} />}
                  />
                  <DetailRow label="Purpose" value={paymentPurpose(paymentDetail)} />
                  {paymentDetail.job_title && (
                    <DetailRow label="Job Title" value={paymentDetail.job_title} />
                  )}
                  {paymentDetail.worker_name && (
                    <DetailRow label="Worker Name" value={paymentDetail.worker_name} />
                  )}
                  <DetailRow
                    label="Order ID"
                    value={
                      <span className="font-mono text-xs">{paymentDetail.order_id}</span>
                    }
                  />
                  <DetailRow
                    label="Cashfree Order ID"
                    value={
                      paymentDetail.cf_order_id ? (
                        <span className="font-mono text-xs">{paymentDetail.cf_order_id}</span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <DetailRow label="Created On" value={fmtDateTime(paymentDetail.created_at)} />
                  <DetailRow label="Paid On" value={fmtDateTime(paymentDetail.payment_success_at)} />
                  <DetailRow
                    label="Last Updated"
                    value={fmtDateTime(paymentDetail.updated_at)}
                  />

                  <div className="pt-3 pb-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Subscription Validity
                    </p>
                  </div>
                  <DetailRow
                    label="Valid From"
                    value={
                      paymentDetail.validity_status === "N/A"
                        ? "N/A"
                        : paymentDetail.subscription_valid_from
                        ? fmtDateTime(paymentDetail.subscription_valid_from)
                        : "UNKNOWN"
                    }
                  />
                  <DetailRow
                    label="Valid Until"
                    value={
                      paymentDetail.validity_status === "N/A"
                        ? "N/A"
                        : paymentDetail.subscription_valid_until
                        ? fmtDateTime(paymentDetail.subscription_valid_until)
                        : "UNKNOWN"
                    }
                  />
                  <DetailRow
                    label="Validity Status"
                    value={<ValidityBadge status={paymentDetail.validity_status} />}
                  />

                  <div className="pt-3 pb-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Internal References
                    </p>
                  </div>
                  <DetailRow
                    label="Transaction ID"
                    value={
                      <span className="font-mono text-xs">{paymentDetail.id}</span>
                    }
                  />
                  {paymentDetail.worker_profile_id && (
                    <DetailRow
                      label="Worker Profile ID"
                      value={
                        <span className="font-mono text-xs">
                          {paymentDetail.worker_profile_id}
                        </span>
                      }
                    />
                  )}
                  {paymentDetail.employer_id && (
                    <DetailRow
                      label="Employer Profile ID"
                      value={
                        <span className="font-mono text-xs">{paymentDetail.employer_id}</span>
                      }
                    />
                  )}
                  {paymentDetail.user_id && (
                    <DetailRow
                      label="User ID"
                      value={
                        <span className="font-mono text-xs">{paymentDetail.user_id}</span>
                      }
                    />
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
