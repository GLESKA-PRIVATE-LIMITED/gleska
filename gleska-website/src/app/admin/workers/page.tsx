"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
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

interface WorkerItem {
  id: string;
  user_id: string;
  name: string | null;
  mobile: string | null;
  email: string | null;
  trade_id: string | null;
  skills: string[] | null;
  experience_years: number | null;
  expected_daily_wage: number | null;
  availability_status: string;
  is_verified: boolean;
  is_active: boolean;
  profile_completed: boolean;
  onboarding_status: string;
  city: string | null;
  state: string | null;
  profile_photo_url: string | null;
  created_at: string;
}

interface WorkerListResponse {
  items: WorkerItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface WorkerDocumentItem {
  id: string;
  worker_profile_id: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
  view_url: string | null;
}

interface WorkerDetailResponse {
  id: string;
  user_id: string;
  name: string | null;
  mobile: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  is_mobile_verified: boolean;
  profile_photo_url: string | null;
  trade_id: string | null;
  skills: string[] | null;
  experience_years: number | null;
  expected_daily_wage: number | null;
  availability_status: string;
  is_verified: boolean;
  profile_completed: boolean;
  onboarding_status: string;
  overall_rating: number;
  total_jobs: number;
  marital_status: string | null;
  blood_group: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
  documents: WorkerDocumentItem[];
  total_matches: number;
}

interface EditFormState {
  name: string;
  mobile: string;
  trade_id: string;
  skills: string;
  experience_years: string;
  expected_daily_wage: string;
  availability_status: "AVAILABLE" | "ON_JOB" | "OFFLINE";
  city: string;
  state: string;
  address: string;
  pincode: string;
  marital_status: string;
  blood_group: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AdminWorkersPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();

  // List State
  const [workers, setWorkers] = useState<WorkerItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  // Filter & Search State
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [availabilityFilter, setAvailabilityFilter] = useState<string>("ALL");
  const [verificationFilter, setVerificationFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Loading & Error States
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [listError, setListError] = useState<string>("");

  // Drawer / Detail View State
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [workerDetail, setWorkerDetail] = useState<WorkerDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string>("");
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    type: "VERIFY" | "REVOKE" | "ACTIVATE" | "DEACTIVATE";
    workerId: string;
    workerName: string;
    loading: boolean;
  } | null>(null);

  // Edit Modal State
  const [editModal, setEditModal] = useState<{
    open: boolean;
    loading: boolean;
    workerId: string;
    formData: EditFormState;
  } | null>(null);

  // Auth Guard
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/admin/login");
      return;
    }
    if (!isLoading && user && user.role !== "ADMIN") {
      router.replace("/");
    }
  }, [isLoading, router, user]);

  // Debounce search term
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Fetch Workers List
  const fetchWorkers = useCallback(async () => {
    if (!user || user.role !== "ADMIN") return;
    setLoadingList(true);
    setListError("");
    try {
      const params: Record<string, string | number | boolean> = {
        page: currentPage,
        page_size: pageSize,
        sort_by: "created_at",
        sort_order: "desc",
      };

      if (debouncedSearch.trim()) {
        params.search = debouncedSearch.trim();
      }
      if (availabilityFilter !== "ALL") {
        params.availability = availabilityFilter;
      }
      if (verificationFilter === "VERIFIED") {
        params.is_verified = true;
      } else if (verificationFilter === "UNVERIFIED") {
        params.is_verified = false;
      }
      if (statusFilter === "ACTIVE") {
        params.is_active = true;
      } else if (statusFilter === "INACTIVE") {
        params.is_active = false;
      }

      const res = await apiClient.get<WorkerListResponse>("/api/v1/admin/workers", { params });
      setWorkers(res.data.items || []);
      setTotalCount(res.data.total || 0);
      setTotalPages(res.data.total_pages || 1);
    } catch {
      setListError("Failed to fetch workers list. Please check your connection and try again.");
    } finally {
      setLoadingList(false);
    }
  }, [user, currentPage, pageSize, debouncedSearch, availabilityFilter, verificationFilter, statusFilter]);

  useEffect(() => {
    void fetchWorkers();
  }, [fetchWorkers]);

  // Fetch Worker Details
  const openWorkerDetail = useCallback(async (workerId: string) => {
    setSelectedWorkerId(workerId);
    setLoadingDetail(true);
    setDetailError("");
    setWorkerDetail(null);
    try {
      const res = await apiClient.get<WorkerDetailResponse>(`/api/v1/admin/workers/${workerId}`);
      setWorkerDetail(res.data);
    } catch {
      setDetailError("Could not retrieve detailed worker profile. Please try again.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const closeWorkerDetail = () => {
    setSelectedWorkerId(null);
    setWorkerDetail(null);
  };

  // Handle On-Demand Document View
  const handleOpenDocument = async (documentId: string) => {
    if (!selectedWorkerId) return;
    setViewingDocId(documentId);
    try {
      const res = await apiClient.get<{ url: string }>(
        `/api/v1/admin/workers/${selectedWorkerId}/documents/${documentId}/url`
      );
      if (res.data?.url) {
        window.open(res.data.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Unable to generate document access link.");
      }
    } catch {
      toast.error("Document not found or inaccessible in storage.");
    } finally {
      setViewingDocId(null);
    }
  };

  // Reset Filters
  const handleResetFilters = () => {
    setSearchTerm("");
    setDebouncedSearch("");
    setAvailabilityFilter("ALL");
    setVerificationFilter("ALL");
    setStatusFilter("ALL");
    setCurrentPage(1);
  };

  const hasActiveFilters = useMemo(() => {
    return (
      searchTerm.trim() !== "" ||
      availabilityFilter !== "ALL" ||
      verificationFilter !== "ALL" ||
      statusFilter !== "ALL"
    );
  }, [searchTerm, availabilityFilter, verificationFilter, statusFilter]);

  // Handle Verification Mutation
  const handleExecuteVerification = async () => {
    if (!confirmModal) return;
    setConfirmModal((prev) => (prev ? { ...prev, loading: true } : null));
    const isVerifying = confirmModal.type === "VERIFY";

    try {
      await apiClient.patch(`/api/v1/admin/workers/${confirmModal.workerId}/verify`, {
        action: isVerifying ? "VERIFY" : "REVOKE",
      });
      toast.success(
        isVerifying
          ? `Worker ${confirmModal.workerName} has been verified.`
          : `Verification for ${confirmModal.workerName} has been revoked.`
      );
      setConfirmModal(null);
      void fetchWorkers();
      if (selectedWorkerId === confirmModal.workerId) {
        void openWorkerDetail(confirmModal.workerId);
      }
    } catch {
      toast.error("Failed to update worker verification status. Please try again.");
      setConfirmModal((prev) => (prev ? { ...prev, loading: false } : null));
    }
  };

  // Handle Status (Activation/Deactivation) Mutation
  const handleExecuteStatusChange = async () => {
    if (!confirmModal) return;
    setConfirmModal((prev) => (prev ? { ...prev, loading: true } : null));
    const isActivating = confirmModal.type === "ACTIVATE";

    try {
      await apiClient.patch(`/api/v1/admin/workers/${confirmModal.workerId}/status`, {
        is_active: isActivating,
      });
      toast.success(
        isActivating
          ? `Account for ${confirmModal.workerName} is now active.`
          : `Account for ${confirmModal.workerName} has been deactivated.`
      );
      setConfirmModal(null);
      void fetchWorkers();
      if (selectedWorkerId === confirmModal.workerId) {
        void openWorkerDetail(confirmModal.workerId);
      }
    } catch {
      toast.error("Failed to update account status. Please try again.");
      setConfirmModal((prev) => (prev ? { ...prev, loading: false } : null));
    }
  };

  // Open Safe Edit Modal
  const openEditModal = (detail: WorkerDetailResponse) => {
    setEditModal({
      open: true,
      loading: false,
      workerId: detail.id,
      formData: {
        name: detail.name || "",
        mobile: detail.mobile || "",
        trade_id: detail.trade_id || "",
        skills: (detail.skills || []).join(", "),
        experience_years: detail.experience_years !== null ? String(detail.experience_years) : "",
        expected_daily_wage: detail.expected_daily_wage !== null ? String(detail.expected_daily_wage) : "",
        availability_status: (detail.availability_status as "AVAILABLE" | "ON_JOB" | "OFFLINE") || "OFFLINE",
        city: detail.city || "",
        state: detail.state || "",
        address: detail.address || "",
        pincode: detail.pincode || "",
        marital_status: detail.marital_status || "",
        blood_group: detail.blood_group || "",
      },
    });
  };

  // Handle Safe Edit Submission
  const handleSaveProfileEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    setEditModal((prev) => (prev ? { ...prev, loading: true } : null));

    const { formData, workerId } = editModal;
    const payload: Record<string, unknown> = {};

    if (formData.name.trim()) payload.name = formData.name.trim();
    if (formData.mobile.trim()) payload.mobile = formData.mobile.trim();
    if (formData.trade_id.trim()) payload.trade_id = formData.trade_id.trim();
    if (formData.experience_years !== "") payload.experience_years = parseInt(formData.experience_years, 10);
    if (formData.expected_daily_wage !== "") payload.expected_daily_wage = parseFloat(formData.expected_daily_wage);
    payload.availability_status = formData.availability_status;
    if (formData.city.trim()) payload.city = formData.city.trim();
    if (formData.state.trim()) payload.state = formData.state.trim();
    if (formData.address.trim()) payload.address = formData.address.trim();
    if (formData.pincode.trim()) payload.pincode = formData.pincode.trim();
    if (formData.marital_status) payload.marital_status = formData.marital_status;
    if (formData.blood_group) payload.blood_group = formData.blood_group;

    const skillsArray = formData.skills
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (skillsArray.length > 0) {
      payload.skills = skillsArray;
    }

    try {
      await apiClient.patch(`/api/v1/admin/workers/${workerId}`, payload);
      toast.success("Worker profile updated successfully.");
      setEditModal(null);
      void fetchWorkers();
      if (selectedWorkerId === workerId) {
        void openWorkerDetail(workerId);
      }
    } catch {
      toast.error("Failed to update profile. Please verify your inputs.");
      setEditModal((prev) => (prev ? { ...prev, loading: false } : null));
    }
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
        {/* Top Header & Operational Overview */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700">
              <Users size={13} />
              <span>Admin Operations</span>
            </div>
            <h1 className="mt-2 font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wide text-slate-900">
              Workers Management
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Live worker directory, verification oversight, and status management.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-xs">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total</span>
              <span className="font-bold text-slate-900">{totalCount} Workers</span>
            </div>

            <button
              type="button"
              onClick={() => void fetchWorkers()}
              disabled={loadingList}
              className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 transition disabled:opacity-50 cursor-pointer"
              title="Refresh database count"
            >
              <RotateCw size={16} className={loadingList ? "animate-spin text-blue-600" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {/* Search Input */}
            <div className="relative lg:col-span-2">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by worker name, phone, trade..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>

            {/* Availability Filter */}
            <div>
              <select
                value={availabilityFilter}
                onChange={(e) => {
                  setAvailabilityFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition cursor-pointer"
              >
                <option value="ALL">All Availability</option>
                <option value="AVAILABLE">Available</option>
                <option value="ON_JOB">On Job</option>
                <option value="OFFLINE">Offline</option>
              </select>
            </div>

            {/* Verification Filter */}
            <div>
              <select
                value={verificationFilter}
                onChange={(e) => {
                  setVerificationFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition cursor-pointer"
              >
                <option value="ALL">All Verification</option>
                <option value="VERIFIED">Verified Only</option>
                <option value="UNVERIFIED">Unverified Only</option>
              </select>
            </div>

            {/* Account Status Filter */}
            <div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition cursor-pointer"
              >
                <option value="ALL">All Account Status</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Deactivated Only</option>
              </select>
            </div>
          </div>

          {/* Active Filter Clear Bar */}
          {hasActiveFilters && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5 font-medium">
                <Filter size={13} className="text-blue-600" />
                Active filters applied
              </span>
              <button
                type="button"
                onClick={handleResetFilters}
                className="font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
              >
                Reset all filters
              </button>
            </div>
          )}
        </div>

        {/* Error Alert */}
        {listError && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <div className="flex items-center gap-2.5">
              <AlertCircle size={18} className="shrink-0 text-rose-600" />
              <span>{listError}</span>
            </div>
            <button
              type="button"
              onClick={() => void fetchWorkers()}
              className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 transition cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading State Skeleton */}
        {loadingList && workers.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
            <Loader2 size={32} className="mx-auto animate-spin text-blue-600 mb-3" />
            <p className="text-sm font-medium text-slate-600">Loading worker directory...</p>
          </div>
        )}

        {/* Empty State */}
        {!loadingList && workers.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 mb-4">
              <Users size={24} />
            </div>
            <h3 className="text-base font-bold text-slate-900">No Workers Found</h3>
            <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">
              {hasActiveFilters
                ? "No registered workers matched your active filters or search keyword."
                : "There are currently no registered workers in the system."}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition cursor-pointer"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Desktop Data Table (Screens >= md) */}
        {!loadingList && workers.length > 0 && (
          <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="border-b border-slate-200 bg-slate-50/75 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3.5">Worker</th>
                    <th scope="col" className="px-4 py-3.5">Trade & Skills</th>
                    <th scope="col" className="px-4 py-3.5">Experience & Wage</th>
                    <th scope="col" className="px-4 py-3.5">Availability</th>
                    <th scope="col" className="px-4 py-3.5">Verification</th>
                    <th scope="col" className="px-4 py-3.5">Account Status</th>
                    <th scope="col" className="px-4 py-3.5">Joined</th>
                    <th scope="col" className="px-5 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workers.map((w) => {
                    const initials = (w.name || "W").charAt(0).toUpperCase();
                    return (
                      <tr key={w.id} className="hover:bg-slate-50/70 transition">
                        {/* Worker Identity */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            {w.profile_photo_url ? (
                              <img
                                src={w.profile_photo_url}
                                alt={w.name || "Worker"}
                                className="h-10 w-10 rounded-xl object-cover border border-slate-200 shadow-2xs shrink-0"
                              />
                            ) : (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 font-bold text-blue-700 text-sm border border-blue-200 shadow-2xs">
                                {initials}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 truncate">
                                {w.name || "Unnamed Worker"}
                              </p>
                              <p className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                                <Phone size={11} className="shrink-0 text-slate-400" />
                                <span>{w.mobile || "No phone"}</span>
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Trade & Skills */}
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">
                            {w.trade_id || "Unassigned"}
                          </span>
                          {w.skills && w.skills.length > 0 && (
                            <p className="text-[11px] text-slate-400 mt-1 truncate max-w-[150px]">
                              {w.skills.slice(0, 2).join(", ")}
                              {w.skills.length > 2 ? ` +${w.skills.length - 2}` : ""}
                            </p>
                          )}
                        </td>

                        {/* Experience & Wage */}
                        <td className="px-4 py-4 text-xs">
                          <div className="font-semibold text-slate-800">
                            {w.expected_daily_wage !== null ? `₹${w.expected_daily_wage} / day` : "Wage not set"}
                          </div>
                          <div className="text-slate-400 mt-0.5">
                            {w.experience_years !== null ? `${w.experience_years} yrs exp` : "Exp not set"}
                          </div>
                        </td>

                        {/* Availability Pill */}
                        <td className="px-4 py-4">
                          {w.availability_status === "AVAILABLE" && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Available
                            </span>
                          )}
                          {w.availability_status === "ON_JOB" && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              On Job
                            </span>
                          )}
                          {w.availability_status === "OFFLINE" && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              Offline
                            </span>
                          )}
                        </td>

                        {/* Verification Pill */}
                        <td className="px-4 py-4">
                          {w.is_verified ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700">
                              <ShieldCheck size={13} className="text-blue-600" />
                              Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                              <Clock size={12} className="text-slate-400" />
                              Unverified
                            </span>
                          )}
                        </td>

                        {/* Account Status Pill */}
                        <td className="px-4 py-4">
                          {w.is_active ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 size={12} />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                              <X size={12} />
                              Deactivated
                            </span>
                          )}
                        </td>

                        {/* Joined Date */}
                        <td className="px-4 py-4 text-xs text-slate-500 whitespace-nowrap">
                          {formatDate(w.created_at)}
                        </td>

                        {/* Row Actions */}
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => void openWorkerDetail(w.id)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-blue-600 hover:border-blue-200 transition cursor-pointer"
                          >
                            <Eye size={14} />
                            <span>Details</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Mobile Cards View (Screens < md) */}
        {!loadingList && workers.length > 0 && (
          <div className="md:hidden space-y-3">
            {workers.map((w) => {
              const initials = (w.name || "W").charAt(0).toUpperCase();
              return (
                <div
                  key={w.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {w.profile_photo_url ? (
                        <img
                          src={w.profile_photo_url}
                          alt={w.name || "Worker"}
                          className="h-11 w-11 rounded-xl object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 font-bold text-blue-700 text-sm border border-blue-200">
                          {initials}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h4 className="font-bold text-slate-900 text-sm truncate">
                          {w.name || "Unnamed Worker"}
                        </h4>
                        <p className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                          <Phone size={11} className="text-slate-400" />
                          <span>{w.mobile || "No phone"}</span>
                        </p>
                      </div>
                    </div>

                    <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 shrink-0">
                      {w.trade_id || "Unassigned"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    {/* Availability */}
                    {w.availability_status === "AVAILABLE" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Available
                      </span>
                    )}
                    {w.availability_status === "ON_JOB" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        On Job
                      </span>
                    )}
                    {w.availability_status === "OFFLINE" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        Offline
                      </span>
                    )}

                    {/* Verification */}
                    {w.is_verified ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                        <ShieldCheck size={11} />
                        Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        Unverified
                      </span>
                    )}

                    {/* Account Status */}
                    {w.is_active ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                        Deactivated
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <div>
                      <span className="font-semibold text-slate-800">
                        {w.expected_daily_wage !== null ? `₹${w.expected_daily_wage}/day` : "No wage"}
                      </span>
                      {w.city && <span className="ml-2 text-slate-400">• {w.city}</span>}
                    </div>

                    <button
                      type="button"
                      onClick={() => void openWorkerDetail(w.id)}
                      className="inline-flex items-center gap-1 rounded-xl bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition cursor-pointer"
                    >
                      <Eye size={13} />
                      <span>View Details</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {!loadingList && totalCount > 0 && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-800">{workers.length}</span> of{" "}
              <span className="font-semibold text-slate-800">{totalCount}</span> registered workers
              (Page <span className="font-semibold text-slate-800">{currentPage}</span> of{" "}
              <span className="font-semibold text-slate-800">{totalPages}</span>)
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                <ChevronLeft size={14} />
                <span>Previous</span>
              </button>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* Worker Detail Slide-Over Drawer */}
        {/* =================================================================== */}
        {selectedWorkerId && (
          <div className="fixed inset-0 z-50 overflow-hidden">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
              onClick={closeWorkerDetail}
            />

            <div className="fixed inset-y-0 right-0 flex max-w-full pl-6 sm:pl-16">
              <div className="w-screen max-w-2xl bg-[#f8faff] shadow-2xl flex flex-col border-l border-slate-200">
                {/* Drawer Top Header */}
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-blue-700 border border-blue-100">
                      Worker Record
                    </span>
                    <span className="text-xs font-mono text-slate-400 truncate max-w-[150px]">
                      {selectedWorkerId}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={closeWorkerDetail}
                    className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                    title="Close drawer"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Drawer Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {loadingDetail && (
                    <div className="flex min-h-[350px] items-center justify-center">
                      <div className="text-center">
                        <Loader2 size={32} className="mx-auto animate-spin text-blue-600 mb-2" />
                        <p className="text-sm font-medium text-slate-600">Retrieving full worker profile...</p>
                      </div>
                    </div>
                  )}

                  {detailError && !loadingDetail && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                      <p className="font-semibold">{detailError}</p>
                      <button
                        type="button"
                        onClick={() => void openWorkerDetail(selectedWorkerId)}
                        className="mt-3 rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 cursor-pointer"
                      >
                        Try Again
                      </button>
                    </div>
                  )}

                  {workerDetail && !loadingDetail && (
                    <>
                      {/* Identity Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                          {workerDetail.profile_photo_url ? (
                            <img
                              src={workerDetail.profile_photo_url}
                              alt={workerDetail.name || "Worker"}
                              className="h-16 w-16 rounded-2xl object-cover border border-slate-200 shadow-xs shrink-0"
                            />
                          ) : (
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-xl font-bold text-blue-700 border border-blue-200">
                              {(workerDetail.name || "W").charAt(0).toUpperCase()}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-xl font-bold text-slate-900">
                                {workerDetail.name || "Unnamed Worker"}
                              </h2>
                              {workerDetail.is_verified ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-bold text-blue-700">
                                  <ShieldCheck size={12} />
                                  Verified
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                                  Unverified
                                </span>
                              )}
                              {workerDetail.is_active ? (
                                <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                                  Active Account
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                                  Deactivated
                                </span>
                              )}
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <Phone size={12} className="text-slate-400" />
                                <span className="font-medium text-slate-700">{workerDetail.mobile || "No phone"}</span>
                              </span>
                              {workerDetail.email && (
                                <span className="flex items-center gap-1">
                                  <Mail size={12} className="text-slate-400" />
                                  <span>{workerDetail.email}</span>
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Calendar size={12} className="text-slate-400" />
                                <span>Joined {formatDate(workerDetail.created_at)}</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Quick Metrics Strip */}
                        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center">
                          <div className="rounded-xl bg-slate-50 p-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rating</span>
                            <p className="text-sm font-semibold text-slate-400 mt-0.5 italic">Not yet rated</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Jobs</span>
                            <p className="text-base font-bold text-slate-900 mt-0.5">
                              {workerDetail.total_jobs > 0 ? workerDetail.total_jobs : "—"}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Matched</span>
                            <p className="text-base font-bold text-slate-900 mt-0.5">{workerDetail.total_matches}</p>
                          </div>
                        </div>
                      </div>

                      {/* Professional & Trade Details */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <Briefcase size={16} className="text-blue-600" />
                            <h3 className="font-bold text-slate-900 text-sm">Professional Profile</h3>
                          </div>
                          <button
                            type="button"
                            onClick={() => openEditModal(workerDetail)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                          >
                            <Edit3 size={12} />
                            <span>Edit Safe Fields</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-slate-400 font-medium">Primary Trade</span>
                            <p className="font-semibold text-slate-800 text-sm mt-0.5">
                              {workerDetail.trade_id || "Not specified"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Expected Daily Wage</span>
                            <p className="font-semibold text-slate-800 text-sm mt-0.5">
                              {workerDetail.expected_daily_wage !== null
                                ? `₹${workerDetail.expected_daily_wage} / day`
                                : "Not specified"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Experience</span>
                            <p className="font-semibold text-slate-800 text-sm mt-0.5">
                              {workerDetail.experience_years !== null
                                ? `${workerDetail.experience_years} Years`
                                : "Not specified"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Availability Status</span>
                            <p className="font-semibold text-slate-800 text-sm mt-0.5">
                              {workerDetail.availability_status}
                            </p>
                          </div>
                        </div>

                        {/* Skills List */}
                        <div className="mt-4 border-t border-slate-100 pt-3">
                          <span className="text-xs text-slate-400 font-medium">Specialized Skills</span>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {workerDetail.skills && workerDetail.skills.length > 0 ? (
                              workerDetail.skills.map((skill, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center rounded-lg bg-blue-50 border border-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800"
                                >
                                  {skill}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-400">No skills listed</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Location Details */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-center gap-2 mb-3">
                          <MapPin size={16} className="text-blue-600" />
                          <h3 className="font-bold text-slate-900 text-sm">Location & Address</h3>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-slate-400 font-medium">City</span>
                            <p className="font-semibold text-slate-800 mt-0.5">{workerDetail.city || "—"}</p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">State</span>
                            <p className="font-semibold text-slate-800 mt-0.5">{workerDetail.state || "—"}</p>
                          </div>
                          <div className="col-span-2">
                            <span className="text-slate-400 font-medium">Full Address</span>
                            <p className="font-semibold text-slate-800 mt-0.5">{workerDetail.address || "—"}</p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Pincode</span>
                            <p className="font-semibold text-slate-800 mt-0.5">{workerDetail.pincode || "—"}</p>
                          </div>
                        </div>
                      </div>

                      {/* Private Worker Documents */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <FileText size={16} className="text-blue-600" />
                            <h3 className="font-bold text-slate-900 text-sm">Verification Documents</h3>
                          </div>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                            {workerDetail.documents.length} Files
                          </span>
                        </div>

                        {workerDetail.documents.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                            No verification documents uploaded yet.
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {workerDetail.documents.map((doc) => (
                              <div
                                key={doc.id}
                                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs"
                              >
                                <div className="min-w-0 flex-1 pr-3">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-800 truncate">
                                      {doc.original_filename}
                                    </span>
                                    <span className="rounded bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                      {doc.document_type.replace(/_/g, " ")}
                                    </span>
                                  </div>
                                  <p className="text-slate-400 mt-0.5">
                                    {formatFileSize(doc.file_size_bytes)} • Uploaded {formatDate(doc.uploaded_at)}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  disabled={viewingDocId === doc.id}
                                  onClick={() => handleOpenDocument(doc.id)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 font-semibold text-blue-600 hover:bg-blue-50 transition shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
                                  title="View secure document (opens fresh link)"
                                >
                                  {viewingDocId === doc.id ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <ExternalLink size={13} />
                                  )}
                                  <span>{viewingDocId === doc.id ? "Opening…" : "View"}</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Personal & Account Metadata */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs text-xs space-y-3">
                        <h3 className="font-bold text-slate-900 text-sm">Account Metadata</h3>
                        <div className="grid grid-cols-2 gap-3 text-slate-600">
                          <div>
                            <span className="text-slate-400">Blood Group:</span>{" "}
                            <span className="font-semibold text-slate-800">{workerDetail.blood_group || "—"}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Marital Status:</span>{" "}
                            <span className="font-semibold text-slate-800">{workerDetail.marital_status || "—"}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Profile Completed:</span>{" "}
                            <span className="font-semibold text-slate-800">
                              {workerDetail.profile_completed ? "Yes" : "No"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Onboarding Status:</span>{" "}
                            <span className="font-semibold text-slate-800">{workerDetail.onboarding_status}</span>
                          </div>
                          <div className="col-span-2 font-mono text-[11px] text-slate-400 break-all">
                            User ID: {workerDetail.user_id}
                          </div>
                          <div className="col-span-2 font-mono text-[11px] text-slate-400 break-all">
                            Profile ID: {workerDetail.id}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Drawer Sticky Action Footer */}
                {workerDetail && !loadingDetail && (
                  <div className="border-t border-slate-200 bg-white p-4">
                    <div className="flex flex-col sm:flex-row items-center gap-3">
                      {/* Verification Action */}
                      {workerDetail.is_verified ? (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              open: true,
                              type: "REVOKE",
                              workerId: workerDetail.id,
                              workerName: workerDetail.name || "this worker",
                              loading: false,
                            })
                          }
                          className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800 hover:bg-amber-100 transition cursor-pointer"
                        >
                          <ShieldAlert size={15} />
                          <span>Revoke Verification</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              open: true,
                              type: "VERIFY",
                              workerId: workerDetail.id,
                              workerName: workerDetail.name || "this worker",
                              loading: false,
                            })
                          }
                          className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700 transition cursor-pointer"
                        >
                          <ShieldCheck size={15} />
                          <span>Verify Worker</span>
                        </button>
                      )}

                      {/* Account Status Action */}
                      {workerDetail.is_active ? (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              open: true,
                              type: "DEACTIVATE",
                              workerId: workerDetail.id,
                              workerName: workerDetail.name || "this worker",
                              loading: false,
                            })
                          }
                          className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                        >
                          <UserX size={15} />
                          <span>Deactivate Account</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              open: true,
                              type: "ACTIVATE",
                              workerId: workerDetail.id,
                              workerName: workerDetail.name || "this worker",
                              loading: false,
                            })
                          }
                          className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition cursor-pointer"
                        >
                          <UserCheck size={15} />
                          <span>Activate Account</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* Explicit Confirmation Dialog Modal */}
        {/* =================================================================== */}
        {confirmModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
              onClick={() => !confirmModal.loading && setConfirmModal(null)}
            />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    confirmModal.type === "REVOKE" || confirmModal.type === "DEACTIVATE"
                      ? "bg-rose-100 text-rose-600"
                      : "bg-blue-100 text-blue-600"
                  }`}
                >
                  {confirmModal.type === "VERIFY" && <ShieldCheck size={20} />}
                  {confirmModal.type === "REVOKE" && <ShieldAlert size={20} />}
                  {confirmModal.type === "ACTIVATE" && <UserCheck size={20} />}
                  {confirmModal.type === "DEACTIVATE" && <UserX size={20} />}
                </div>

                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    {confirmModal.type === "VERIFY" && "Verify Worker"}
                    {confirmModal.type === "REVOKE" && "Revoke Verification"}
                    {confirmModal.type === "ACTIVATE" && "Activate Worker Account"}
                    {confirmModal.type === "DEACTIVATE" && "Deactivate Worker Account"}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Explicit administrative confirmation required</p>
                </div>
              </div>

              <div className="mt-4 text-xs text-slate-600 leading-relaxed">
                {confirmModal.type === "VERIFY" && (
                  <p>
                    Are you sure you want to approve and mark{" "}
                    <strong className="text-slate-900">{confirmModal.workerName}</strong> as verified? This
                    indicates all credentials and documentation have been reviewed.
                  </p>
                )}
                {confirmModal.type === "REVOKE" && (
                  <p>
                    Are you sure you want to revoke verification for{" "}
                    <strong className="text-slate-900">{confirmModal.workerName}</strong>? The worker profile
                    will revert to unverified status.
                  </p>
                )}
                {confirmModal.type === "ACTIVATE" && (
                  <p>
                    Are you sure you want to restore active status for{" "}
                    <strong className="text-slate-900">{confirmModal.workerName}</strong>? The worker will be
                    permitted to log in and accept jobs.
                  </p>
                )}
                {confirmModal.type === "DEACTIVATE" && (
                  <p>
                    Are you sure you want to deactivate{" "}
                    <strong className="text-slate-900">{confirmModal.workerName}</strong>? The worker will be
                    temporarily suspended from logging in or receiving dispatch matches without deleting historical
                    records.
                  </p>
                )}
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={confirmModal.loading}
                  onClick={() => setConfirmModal(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={confirmModal.loading}
                  onClick={() => {
                    if (confirmModal.type === "VERIFY" || confirmModal.type === "REVOKE") {
                      void handleExecuteVerification();
                    } else {
                      void handleExecuteStatusChange();
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition cursor-pointer ${
                    confirmModal.type === "REVOKE" || confirmModal.type === "DEACTIVATE"
                      ? "bg-rose-600 hover:bg-rose-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {confirmModal.loading && <Loader2 size={13} className="animate-spin" />}
                  <span>Confirm</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* Safe Profile Edit Modal */}
        {/* =================================================================== */}
        {editModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
              onClick={() => !editModal.loading && setEditModal(null)}
            />
            <div className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Edit Safe Profile Fields</h3>
                  <p className="text-xs text-slate-500">
                    Update worker personal, professional, and contact details safely.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !editModal.loading && setEditModal(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={(e) => void handleSaveProfileEdit(e)} className="mt-4 space-y-3.5 text-xs">
                {/* Full Name */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={editModal.formData.name}
                    onChange={(e) =>
                      setEditModal((prev) =>
                        prev
                          ? { ...prev, formData: { ...prev.formData, name: e.target.value } }
                          : null
                      )
                    }
                    required
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Mobile */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mobile Phone</label>
                  <input
                    type="text"
                    value={editModal.formData.mobile}
                    onChange={(e) =>
                      setEditModal((prev) =>
                        prev
                          ? { ...prev, formData: { ...prev.formData, mobile: e.target.value } }
                          : null
                      )
                    }
                    required
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Trade & Daily Wage */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Primary Trade</label>
                    <input
                      type="text"
                      value={editModal.formData.trade_id}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? { ...prev, formData: { ...prev.formData, trade_id: e.target.value } }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Expected Wage (₹/day)</label>
                    <input
                      type="number"
                      step="50"
                      min="0"
                      value={editModal.formData.expected_daily_wage}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? { ...prev, formData: { ...prev.formData, expected_daily_wage: e.target.value } }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Experience & Availability */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Experience (Years)</label>
                    <input
                      type="number"
                      min="0"
                      value={editModal.formData.experience_years}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? { ...prev, formData: { ...prev.formData, experience_years: e.target.value } }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Availability</label>
                    <select
                      value={editModal.formData.availability_status}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                formData: {
                                  ...prev.formData,
                                  availability_status: e.target.value as "AVAILABLE" | "ON_JOB" | "OFFLINE",
                                },
                              }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="AVAILABLE">AVAILABLE</option>
                      <option value="ON_JOB">ON_JOB</option>
                      <option value="OFFLINE">OFFLINE</option>
                    </select>
                  </div>
                </div>

                {/* Skills (Comma separated) */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Skills (comma separated)</label>
                  <input
                    type="text"
                    value={editModal.formData.skills}
                    onChange={(e) =>
                      setEditModal((prev) =>
                        prev
                          ? { ...prev, formData: { ...prev.formData, skills: e.target.value } }
                          : null
                      )
                    }
                    placeholder="e.g. Traditional cook, Catering, Banquet"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* City & State */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">City</label>
                    <input
                      type="text"
                      value={editModal.formData.city}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? { ...prev, formData: { ...prev.formData, city: e.target.value } }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">State</label>
                    <input
                      type="text"
                      value={editModal.formData.state}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? { ...prev, formData: { ...prev.formData, state: e.target.value } }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Address & Pincode */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Address</label>
                    <input
                      type="text"
                      value={editModal.formData.address}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? { ...prev, formData: { ...prev.formData, address: e.target.value } }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Pincode</label>
                    <input
                      type="text"
                      maxLength={6}
                      value={editModal.formData.pincode}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? { ...prev, formData: { ...prev.formData, pincode: e.target.value } }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Marital Status & Blood Group */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Marital Status</label>
                    <select
                      value={editModal.formData.marital_status}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? { ...prev, formData: { ...prev.formData, marital_status: e.target.value } }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select status</option>
                      <option value="Unmarried">Unmarried</option>
                      <option value="Married">Married</option>
                      <option value="Divorced">Divorced</option>
                      <option value="Widowed">Widowed</option>
                      <option value="Separated">Separated</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Blood Group</label>
                    <select
                      value={editModal.formData.blood_group}
                      onChange={(e) =>
                        setEditModal((prev) =>
                          prev
                            ? { ...prev, formData: { ...prev.formData, blood_group: e.target.value } }
                            : null
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select blood group</option>
                      <option value="A+">A+</option>
                      <option value="A-">A-</option>
                      <option value="B+">B+</option>
                      <option value="B-">B-</option>
                      <option value="AB+">AB+</option>
                      <option value="AB-">AB-</option>
                      <option value="O+">O+</option>
                      <option value="O-">O-</option>
                    </select>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    disabled={editModal.loading}
                    onClick={() => setEditModal(null)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editModal.loading}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition cursor-pointer"
                  >
                    {editModal.loading && <Loader2 size={13} className="animate-spin" />}
                    <span>Save Changes</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </AdminShell>
  );
}

