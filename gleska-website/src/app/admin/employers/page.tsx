"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Briefcase,
  Building,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Globe,
  Layers,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AdminShell from "@/components/admin/AdminShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmployerItem {
  id: string; // canonical employer_profiles.id
  user_id: string;
  name: string | null;
  mobile: string | null;
  email: string | null;
  contact_person_name: string | null;
  business_name: string | null;
  employer_type: string | null;
  onboarding_status: string;
  verification_status: string;
  is_active: boolean;
  city: string | null;
  state: string | null;
  created_at: string;
}

interface EmployerListResponse {
  items: EmployerItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface EmployerVerificationItem {
  id: string;
  verification_type: string;
  status: string;
  provider_reference_id: string | null;
  failure_reason: string | null;
  verified_at: string | null;
  created_at: string;
}

interface EmployerDetailResponse {
  id: string;
  user_id: string;
  name: string | null;
  mobile: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  is_mobile_verified: boolean;
  created_at: string;
  updated_at: string | null;

  // Profile fields
  contact_person_name: string | null;
  employer_type: string | null;
  onboarding_status: string;
  verification_status: string;
  subscription_valid_until: string | null;
  has_availed_free_dispatch: boolean;

  // Onboarding / Business Details
  business_name: string | null;
  business_type: string | null;
  business_category: string | null;
  industry_category: string | null;
  industry_type: string | null;
  registered_address: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  pan_number: string | null;
  cin_number: string | null;
  udyam_number: string | null;
  registration_number: string | null;
  work_location: string | null;
  website_url: string | null;
  description: string | null;
  nature_of_business: string | null;
  annual_revenue: string | null;
  number_of_proprietors: number | null;
  company_email: string | null;
  company_phone: string | null;
  proprietor_name: string | null;
  director_name: string | null;
  director_phone: string | null;
  director_email: string | null;
  director_address: string | null;
  business_document_url: string | null;
  hiring_mode: string | null;
  bank_account_holder_name: string | null;
  bank_ifsc: string | null;
  bank_account_number: string | null;

  // Verifications
  verifications: EmployerVerificationItem[];

  // Live aggregated counts
  total_jobs: number;
  active_jobs: number;
  total_job_sites: number;
}

interface EditEmployerFormState {
  name: string;
  mobile: string;
  contact_person_name: string;
  employer_type: string;
  business_name: string;
  business_type: string;
  business_category: string;
  industry_category: string;
  industry_type: string;
  registered_address: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
  pan_number: string;
  cin_number: string;
  udyam_number: string;
  registration_number: string;
  work_location: string;
  website_url: string;
  description: string;
  nature_of_business: string;
  company_email: string;
  company_phone: string;
  proprietor_name: string;
  director_name: string;
  director_phone: string;
  director_email: string;
  director_address: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatEmployerType(type: string | null | undefined): string {
  if (!type) return "Unspecified";
  switch (type) {
    case "REGISTERED_INDUSTRY":
      return "Registered Industry";
    case "REGISTERED_BUSINESS":
      return "Registered Business";
    case "UNREGISTERED_BUSINESS":
      return "Unregistered Business";
    case "INDIVIDUAL":
      return "Individual";
    default:
      return type.replace(/_/g, " ");
  }
}

function formatOnboardingStatus(status: string): { label: string; bg: string; text: string; border: string } {
  switch (status) {
    case "COMPLETED":
      return { label: "Completed", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" };
    case "IN_PROGRESS":
      return { label: "In Progress", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" };
    case "NOT_STARTED":
    default:
      return { label: "Not Started", bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-200" };
  }
}

function formatVerificationStatus(status: string): { label: string; bg: string; text: string; border: string } {
  switch (status) {
    case "VERIFIED":
      return { label: "Verified", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    case "REJECTED":
    case "FAILED":
      return { label: "Rejected", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" };
    case "PENDING":
    default:
      return { label: "Pending", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" };
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AdminEmployersPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();

  // List State
  const [employers, setEmployers] = useState<EmployerItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  // Filter & Search State
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL"); // ALL, ACTIVE, INACTIVE
  const [onboardingFilter, setOnboardingFilter] = useState<string>("ALL"); // ALL, NOT_STARTED, IN_PROGRESS, COMPLETED
  const [employerTypeFilter, setEmployerTypeFilter] = useState<string>("ALL");
  const [verificationFilter, setVerificationFilter] = useState<string>("ALL"); // ALL, PENDING, VERIFIED, REJECTED

  // Loading & Error States
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [listError, setListError] = useState<string>("");

  // Drawer / Detail View State
  const [selectedEmployerId, setSelectedEmployerId] = useState<string | null>(null);
  const [employerDetail, setEmployerDetail] = useState<EmployerDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string>("");

  // Confirmation Modal State (Activate / Deactivate)
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    isActivating: boolean;
    employerId: string;
    employerName: string;
    loading: boolean;
  } | null>(null);

  // Edit Modal State
  const [editModal, setEditModal] = useState<{
    open: boolean;
    loading: boolean;
    employerId: string;
    formData: EditEmployerFormState;
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

  // Fetch Employers List
  const fetchEmployers = useCallback(async () => {
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
      if (onboardingFilter !== "ALL") {
        params.onboarding_status = onboardingFilter;
      }
      if (employerTypeFilter !== "ALL") {
        params.employer_type = employerTypeFilter;
      }
      if (verificationFilter !== "ALL") {
        params.verification_status = verificationFilter;
      }
      if (statusFilter === "ACTIVE") {
        params.is_active = true;
      } else if (statusFilter === "INACTIVE") {
        params.is_active = false;
      }

      const res = await apiClient.get<EmployerListResponse>("/api/v1/admin/employers", { params });
      setEmployers(res.data.items || []);
      setTotalCount(res.data.total || 0);
      setTotalPages(res.data.total_pages || 1);
    } catch {
      setListError("Failed to fetch employers list. Please check your connection and try again.");
    } finally {
      setLoadingList(false);
    }
  }, [user, currentPage, pageSize, debouncedSearch, onboardingFilter, employerTypeFilter, verificationFilter, statusFilter]);

  useEffect(() => {
    void fetchEmployers();
  }, [fetchEmployers]);

  // Fetch Employer Details
  const openEmployerDetail = useCallback(async (employerId: string) => {
    setSelectedEmployerId(employerId);
    setLoadingDetail(true);
    setDetailError("");
    setEmployerDetail(null);
    try {
      const res = await apiClient.get<EmployerDetailResponse>(`/api/v1/admin/employers/${employerId}`);
      setEmployerDetail(res.data);
    } catch {
      setDetailError("Could not retrieve detailed employer profile. Please try again.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const closeEmployerDetail = () => {
    setSelectedEmployerId(null);
    setEmployerDetail(null);
  };

  // Reset Filters
  const handleResetFilters = () => {
    setSearchTerm("");
    setDebouncedSearch("");
    setStatusFilter("ALL");
    setOnboardingFilter("ALL");
    setEmployerTypeFilter("ALL");
    setVerificationFilter("ALL");
    setCurrentPage(1);
  };

  const hasActiveFilters = useMemo(() => {
    return (
      searchTerm.trim() !== "" ||
      statusFilter !== "ALL" ||
      onboardingFilter !== "ALL" ||
      employerTypeFilter !== "ALL" ||
      verificationFilter !== "ALL"
    );
  }, [searchTerm, statusFilter, onboardingFilter, employerTypeFilter, verificationFilter]);

  // Handle Account Activation / Deactivation Confirmation
  const handleConfirmStatusChange = async () => {
    if (!confirmModal) return;
    const { employerId, isActivating } = confirmModal;
    setConfirmModal((prev) => (prev ? { ...prev, loading: true } : null));

    try {
      await apiClient.patch(`/api/v1/admin/employers/${employerId}/status`, {
        is_active: isActivating,
      });

      toast.success(
        isActivating
          ? "Employer account successfully activated."
          : "Employer account deactivated."
      );

      // Refresh list & drawer
      void fetchEmployers();
      if (selectedEmployerId === employerId) {
        void openEmployerDetail(employerId);
      }
      setConfirmModal(null);
    } catch {
      toast.error("Failed to update employer account status.");
      setConfirmModal((prev) => (prev ? { ...prev, loading: false } : null));
    }
  };

  // Open Edit Modal
  const openEditModal = (emp: EmployerDetailResponse) => {
    setEditModal({
      open: true,
      loading: false,
      employerId: emp.id,
      formData: {
        name: emp.name || "",
        mobile: emp.mobile || "",
        contact_person_name: emp.contact_person_name || "",
        employer_type: emp.employer_type || "REGISTERED_BUSINESS",
        business_name: emp.business_name || "",
        business_type: emp.business_type || "",
        business_category: emp.business_category || "",
        industry_category: emp.industry_category || "",
        industry_type: emp.industry_type || "",
        registered_address: emp.registered_address || "",
        address: emp.address || "",
        city: emp.city || "",
        state: emp.state || "",
        pincode: emp.pincode || "",
        gstin: emp.gstin || "",
        pan_number: emp.pan_number || "",
        cin_number: emp.cin_number || "",
        udyam_number: emp.udyam_number || "",
        registration_number: emp.registration_number || "",
        work_location: emp.work_location || "",
        website_url: emp.website_url || "",
        description: emp.description || "",
        nature_of_business: emp.nature_of_business || "",
        company_email: emp.company_email || "",
        company_phone: emp.company_phone || "",
        proprietor_name: emp.proprietor_name || "",
        director_name: emp.director_name || "",
        director_phone: emp.director_phone || "",
        director_email: emp.director_email || "",
        director_address: emp.director_address || "",
      },
    });
  };

  // Submit Safe Profile Edits
  const handleSaveProfileEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    setEditModal((prev) => (prev ? { ...prev, loading: true } : null));

    try {
      const payload: Record<string, string> = {};
      const { formData, employerId } = editModal;

      // Only send non-empty or modified fields
      Object.entries(formData).forEach(([key, val]) => {
        if (typeof val === "string" && val.trim()) {
          payload[key] = val.trim();
        }
      });

      const res = await apiClient.patch<EmployerDetailResponse>(
        `/api/v1/admin/employers/${employerId}`,
        payload
      );

      toast.success("Employer details updated successfully.");
      setEmployerDetail(res.data);
      setEditModal(null);
      void fetchEmployers();
    } catch {
      toast.error("Failed to save employer profile updates.");
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
              Employers Directory
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              Manage registered businesses, company profiles, onboarding oversight, and account states.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void fetchEmployers()}
            disabled={loadingList}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer self-start sm:self-auto disabled:opacity-50"
            title="Refresh employer records"
          >
            <RotateCw size={14} className={loadingList ? "animate-spin text-blue-600" : "text-slate-500"} />
            <span>Refresh</span>
          </button>
        </div>

        {/* =================================================================== */}
        {/* Search and Filters Bar */}
        {/* =================================================================== */}
        <div className="mb-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {/* Search Input */}
            <div className="relative sm:col-span-2 lg:col-span-2">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by company, employer name, mobile, email..."
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

            {/* Account Status Filter */}
            <div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition"
              >
                <option value="ALL">All Account Statuses</option>
                <option value="ACTIVE">Active Accounts</option>
                <option value="INACTIVE">Deactivated Accounts</option>
              </select>
            </div>

            {/* Onboarding Filter */}
            <div>
              <select
                value={onboardingFilter}
                onChange={(e) => {
                  setOnboardingFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition"
              >
                <option value="ALL">All Onboarding Stages</option>
                <option value="COMPLETED">Completed</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="NOT_STARTED">Not Started</option>
              </select>
            </div>

            {/* Employer Type Filter */}
            <div>
              <select
                value={employerTypeFilter}
                onChange={(e) => {
                  setEmployerTypeFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition"
              >
                <option value="ALL">All Employer Types</option>
                <option value="REGISTERED_BUSINESS">Registered Business</option>
                <option value="REGISTERED_INDUSTRY">Registered Industry</option>
                <option value="UNREGISTERED_BUSINESS">Unregistered Business</option>
                <option value="INDIVIDUAL">Individual</option>
              </select>
            </div>
          </div>

          {/* Active Filter Indicators & Reset Button */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
              <div className="flex items-center gap-2 text-slate-500">
                <Filter size={13} className="text-blue-600" />
                <span>Filters active:</span>
                {debouncedSearch && (
                  <span className="rounded-md bg-blue-50 border border-blue-100 px-2 py-0.5 font-medium text-blue-700">
                    &ldquo;{debouncedSearch}&rdquo;
                  </span>
                )}
                {statusFilter !== "ALL" && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    Status: {statusFilter}
                  </span>
                )}
                {onboardingFilter !== "ALL" && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    Onboarding: {onboardingFilter}
                  </span>
                )}
                {employerTypeFilter !== "ALL" && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    Type: {formatEmployerType(employerTypeFilter)}
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
        {/* Error State */}
        {/* =================================================================== */}
        {listError && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
              <span>{listError}</span>
            </div>
            <button
              type="button"
              onClick={() => void fetchEmployers()}
              className="font-bold underline hover:no-underline ml-4 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* =================================================================== */}
        {/* Employer Table (Desktop) */}
        {/* =================================================================== */}
        <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 font-bold uppercase tracking-wider">
                <th className="px-5 py-3.5">Employer</th>
                <th className="px-4 py-3.5">Company / Business</th>
                <th className="px-4 py-3.5">Employer Type</th>
                <th className="px-4 py-3.5">Onboarding</th>
                <th className="px-4 py-3.5">Account</th>
                <th className="px-4 py-3.5">Joined</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loadingList ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 size={24} className="mx-auto animate-spin text-blue-600 mb-2" />
                    <span>Loading employer records from database...</span>
                  </td>
                </tr>
              ) : employers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    <Building2 size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No employers found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {hasActiveFilters
                        ? "Try clearing or relaxing your search and filter criteria."
                        : "No registered employer accounts currently exist."}
                    </p>
                  </td>
                </tr>
              ) : (
                employers.map((emp) => {
                  const onbBadge = formatOnboardingStatus(emp.onboarding_status);
                  return (
                    <tr
                      key={emp.id}
                      onClick={() => void openEmployerDetail(emp.id)}
                      className="hover:bg-slate-50/60 transition cursor-pointer group"
                    >
                      {/* Employer Contact Info */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 font-bold text-blue-700 border border-blue-100 text-xs">
                            {emp.name ? emp.name.charAt(0).toUpperCase() : <Building size={16} />}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 group-hover:text-blue-700 transition truncate">
                              {emp.name || "Unnamed Employer"}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                              <Phone size={11} className="text-slate-400 shrink-0" />
                              <span>{emp.mobile || "No mobile"}</span>
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Company / Business */}
                      <td className="px-4 py-3.5">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate">
                            {emp.business_name || emp.contact_person_name || "—"}
                          </p>
                          {(emp.city || emp.state) && (
                            <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                              <MapPin size={11} className="text-slate-400 shrink-0" />
                              <span>
                                {[emp.city, emp.state].filter(Boolean).join(", ")}
                              </span>
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Employer Type */}
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                          {formatEmployerType(emp.employer_type)}
                        </span>
                      </td>

                      {/* Onboarding Status */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${onbBadge.bg} ${onbBadge.text} ${onbBadge.border}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              emp.onboarding_status === "COMPLETED"
                                ? "bg-emerald-500"
                                : emp.onboarding_status === "IN_PROGRESS"
                                ? "bg-amber-500"
                                : "bg-slate-400"
                            }`}
                          />
                          {onbBadge.label}
                        </span>
                      </td>

                      {/* Account Status */}
                      <td className="px-4 py-3.5">
                        {emp.is_active ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            Deactivated
                          </span>
                        )}
                      </td>

                      {/* Joined Date */}
                      <td className="px-4 py-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                        {formatDate(emp.created_at)}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openEmployerDetail(emp.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 hover:text-blue-700 transition cursor-pointer"
                          title="Open employer details"
                        >
                          <Eye size={12} />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* =================================================================== */}
        {/* Mobile Cards (Phones & Small Tablets) */}
        {/* =================================================================== */}
        <div className="md:hidden space-y-3">
          {loadingList ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
              <Loader2 size={24} className="mx-auto animate-spin text-blue-600 mb-2" />
              <span>Loading employer records...</span>
            </div>
          ) : employers.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
              <Building2 size={28} className="mx-auto text-slate-300 mb-2" />
              <p className="font-semibold text-slate-600">No employers found</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {hasActiveFilters ? "Try resetting your active filters." : "No records currently exist."}
              </p>
            </div>
          ) : (
            employers.map((emp) => {
              const onbBadge = formatOnboardingStatus(emp.onboarding_status);
              return (
                <div
                  key={emp.id}
                  onClick={() => void openEmployerDetail(emp.id)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs hover:border-blue-300 transition cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-slate-900 text-sm truncate">
                        {emp.name || "Unnamed Employer"}
                      </h4>
                      <p className="text-xs font-medium text-slate-600 truncate mt-0.5">
                        {emp.business_name || emp.contact_person_name || "No company registered"}
                      </p>
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                        <Phone size={11} />
                        <span>{emp.mobile || "No phone"}</span>
                      </p>
                    </div>

                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 shrink-0">
                      {formatEmployerType(emp.employer_type)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
                    {/* Onboarding Badge */}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${onbBadge.bg} ${onbBadge.text} ${onbBadge.border}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          emp.onboarding_status === "COMPLETED"
                            ? "bg-emerald-500"
                            : emp.onboarding_status === "IN_PROGRESS"
                            ? "bg-amber-500"
                            : "bg-slate-400"
                        }`}
                      />
                      {onbBadge.label}
                    </span>

                    {/* Account Status Badge */}
                    {emp.is_active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                        Deactivated
                      </span>
                    )}

                    <span className="text-[11px] text-slate-400 ml-auto">
                      Joined {formatDate(emp.created_at)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* =================================================================== */}
        {/* Pagination Controls */}
        {/* =================================================================== */}
        {!loadingList && totalCount > 0 && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-800">{employers.length}</span> of{" "}
              <span className="font-semibold text-slate-800">{totalCount}</span> registered employers
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
        {/* Employer Detail Slide-Over Drawer */}
        {/* =================================================================== */}
        {selectedEmployerId && (
          <div className="fixed inset-0 z-50 overflow-hidden">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
              onClick={closeEmployerDetail}
            />

            <div className="fixed inset-y-0 right-0 flex max-w-full pl-6 sm:pl-16">
              <div className="w-screen max-w-2xl bg-[#f8faff] shadow-2xl flex flex-col border-l border-slate-200">
                {/* Drawer Top Header */}
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-blue-700 border border-blue-100">
                      Employer Record
                    </span>
                    <span className="text-xs font-mono text-slate-400 truncate max-w-[160px]">
                      {selectedEmployerId}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={closeEmployerDetail}
                    className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                    title="Close drawer"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Drawer Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {loadingDetail ? (
                    <div className="py-20 text-center text-slate-400">
                      <Loader2 size={32} className="mx-auto animate-spin text-blue-600 mb-3" />
                      <p className="text-sm font-medium">Loading employer profile...</p>
                    </div>
                  ) : detailError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-700 text-xs">
                      <AlertCircle size={24} className="mx-auto mb-2 text-rose-600" />
                      <p className="font-bold">{detailError}</p>
                      <button
                        type="button"
                        onClick={() => void openEmployerDetail(selectedEmployerId)}
                        className="mt-3 inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-700 transition cursor-pointer"
                      >
                        <RotateCw size={12} />
                        <span>Retry</span>
                      </button>
                    </div>
                  ) : !employerDetail ? null : (
                    <>
                      {/* Account Overview Header Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-start gap-4">
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-50 font-bold text-blue-700 border border-blue-100 text-2xl">
                            {employerDetail.name ? (
                              employerDetail.name.charAt(0).toUpperCase()
                            ) : (
                              <Building2 size={28} />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-xl font-bold text-slate-900 truncate">
                                {employerDetail.name || "Unnamed Employer"}
                              </h2>
                              {/* Account status badge */}
                              {employerDetail.is_active ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  <CheckCircle2 size={10} />
                                  Active
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                  <UserX size={10} />
                                  Deactivated
                                </span>
                              )}
                              {/* Verification status badge */}
                              {(() => {
                                const vb = formatVerificationStatus(employerDetail.verification_status);
                                return (
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${vb.bg} ${vb.text} ${vb.border}`}
                                  >
                                    {employerDetail.verification_status === "VERIFIED" ? (
                                      <ShieldCheck size={10} />
                                    ) : (
                                      <Clock size={10} />
                                    )}
                                    {vb.label}
                                  </span>
                                );
                              })()}
                            </div>

                            <p className="text-sm font-semibold text-slate-700 mt-0.5">
                              {employerDetail.business_name || "No Business Name Registered"}
                            </p>

                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <Phone size={12} className="text-slate-400" />
                                <span className="font-medium text-slate-700">
                                  {employerDetail.mobile || "No phone"}
                                </span>
                              </span>
                              {employerDetail.email && (
                                <span className="flex items-center gap-1">
                                  <Mail size={12} className="text-slate-400" />
                                  <span>{employerDetail.email}</span>
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Calendar size={12} className="text-slate-400" />
                                <span>Joined {formatDate(employerDetail.created_at)}</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Live Metrics Strip */}
                        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center">
                          <div className="rounded-xl bg-slate-50 p-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Jobs</span>
                            <p className="text-base font-bold text-slate-900 mt-0.5">{employerDetail.total_jobs}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Jobs</span>
                            <p className="text-base font-bold text-slate-900 mt-0.5">{employerDetail.active_jobs}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Job Sites</span>
                            <p className="text-base font-bold text-slate-900 mt-0.5">{employerDetail.total_job_sites}</p>
                          </div>
                        </div>
                      </div>

                      {/* Business & Company Profile */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <Building2 size={16} className="text-blue-600" />
                            <h3 className="font-bold text-slate-900 text-sm">Company Profile</h3>
                          </div>
                          <button
                            type="button"
                            onClick={() => openEditModal(employerDetail)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                          >
                            <Edit3 size={12} />
                            <span>Edit Safe Fields</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-slate-400 font-medium">Business / Company Name</span>
                            <p className="font-semibold text-slate-800 text-sm mt-0.5">
                              {employerDetail.business_name || "—"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Employer Type</span>
                            <p className="font-semibold text-slate-800 text-sm mt-0.5">
                              {formatEmployerType(employerDetail.employer_type)}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Contact Person</span>
                            <p className="font-semibold text-slate-800 mt-0.5">
                              {employerDetail.contact_person_name || "—"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Onboarding Status</span>
                            <p className="font-semibold text-slate-800 mt-0.5">
                              {employerDetail.onboarding_status}
                            </p>
                          </div>

                          {/* Only render registrations if they exist */}
                          {employerDetail.gstin && (
                            <div>
                              <span className="text-slate-400 font-medium">GSTIN</span>
                              <p className="font-mono font-semibold text-slate-800 mt-0.5">
                                {employerDetail.gstin}
                              </p>
                            </div>
                          )}
                          {employerDetail.pan_number && (
                            <div>
                              <span className="text-slate-400 font-medium">PAN</span>
                              <p className="font-mono font-semibold text-slate-800 mt-0.5">
                                {employerDetail.pan_number}
                              </p>
                            </div>
                          )}
                          {employerDetail.cin_number && (
                            <div>
                              <span className="text-slate-400 font-medium">CIN</span>
                              <p className="font-mono font-semibold text-slate-800 mt-0.5">
                                {employerDetail.cin_number}
                              </p>
                            </div>
                          )}
                          {employerDetail.udyam_number && (
                            <div>
                              <span className="text-slate-400 font-medium">Udyam Registration</span>
                              <p className="font-mono font-semibold text-slate-800 mt-0.5">
                                {employerDetail.udyam_number}
                              </p>
                            </div>
                          )}
                          {employerDetail.registration_number && (
                            <div>
                              <span className="text-slate-400 font-medium">Registration No.</span>
                              <p className="font-mono font-semibold text-slate-800 mt-0.5">
                                {employerDetail.registration_number}
                              </p>
                            </div>
                          )}

                          {/* Only render industry info if present */}
                          {employerDetail.business_type && (
                            <div>
                              <span className="text-slate-400 font-medium">Business Type</span>
                              <p className="font-semibold text-slate-800 mt-0.5">{employerDetail.business_type}</p>
                            </div>
                          )}
                          {employerDetail.industry_category && (
                            <div>
                              <span className="text-slate-400 font-medium">Industry Category</span>
                              <p className="font-semibold text-slate-800 mt-0.5">{employerDetail.industry_category}</p>
                            </div>
                          )}
                          {employerDetail.nature_of_business && (
                            <div>
                              <span className="text-slate-400 font-medium">Nature of Business</span>
                              <p className="font-semibold text-slate-800 mt-0.5">{employerDetail.nature_of_business}</p>
                            </div>
                          )}
                          {employerDetail.annual_revenue && (
                            <div>
                              <span className="text-slate-400 font-medium">Annual Revenue</span>
                              <p className="font-semibold text-slate-800 mt-0.5">{employerDetail.annual_revenue}</p>
                            </div>
                          )}
                          {employerDetail.website_url && (
                            <div className="col-span-2">
                              <span className="text-slate-400 font-medium">Website</span>
                              <p className="mt-0.5">
                                <a
                                  href={
                                    employerDetail.website_url.startsWith("http")
                                      ? employerDetail.website_url
                                      : `https://${employerDetail.website_url}`
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium text-blue-600 hover:underline flex items-center gap-1"
                                >
                                  <Globe size={12} />
                                  <span>{employerDetail.website_url}</span>
                                  <ExternalLink size={10} />
                                </a>
                              </p>
                            </div>
                          )}
                          {employerDetail.description && (
                            <div className="col-span-2">
                              <span className="text-slate-400 font-medium">Description</span>
                              <p className="text-slate-700 mt-0.5 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                {employerDetail.description}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Location & Address Section (only rendered if location data exists) */}
                      {(employerDetail.address ||
                        employerDetail.registered_address ||
                        employerDetail.city ||
                        employerDetail.state ||
                        employerDetail.work_location) && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs text-xs space-y-3">
                          <div className="flex items-center gap-2">
                            <MapPin size={16} className="text-blue-600" />
                            <h3 className="font-bold text-slate-900 text-sm">Location & Address</h3>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-slate-700">
                            {employerDetail.registered_address && (
                              <div className="col-span-2">
                                <span className="text-slate-400">Registered Address:</span>
                                <p className="font-medium text-slate-800 mt-0.5">
                                  {employerDetail.registered_address}
                                </p>
                              </div>
                            )}
                            {employerDetail.address && (
                              <div className="col-span-2">
                                <span className="text-slate-400">Operating Address:</span>
                                <p className="font-medium text-slate-800 mt-0.5">{employerDetail.address}</p>
                              </div>
                            )}
                            {employerDetail.city && (
                              <div>
                                <span className="text-slate-400">City:</span>{" "}
                                <span className="font-medium text-slate-800">{employerDetail.city}</span>
                              </div>
                            )}
                            {employerDetail.state && (
                              <div>
                                <span className="text-slate-400">State:</span>{" "}
                                <span className="font-medium text-slate-800">{employerDetail.state}</span>
                              </div>
                            )}
                            {employerDetail.pincode && (
                              <div>
                                <span className="text-slate-400">Pincode:</span>{" "}
                                <span className="font-medium text-slate-800">{employerDetail.pincode}</span>
                              </div>
                            )}
                            {employerDetail.work_location && (
                              <div>
                                <span className="text-slate-400">Primary Work Location:</span>{" "}
                                <span className="font-medium text-slate-800">{employerDetail.work_location}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Contacts & Representatives (only rendered if representatives exist) */}
                      {(employerDetail.proprietor_name ||
                        employerDetail.director_name ||
                        employerDetail.company_email ||
                        employerDetail.company_phone) && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs text-xs space-y-3">
                          <div className="flex items-center gap-2">
                            <Users size={16} className="text-blue-600" />
                            <h3 className="font-bold text-slate-900 text-sm">Representatives & Contacts</h3>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-slate-700">
                            {employerDetail.proprietor_name && (
                              <div>
                                <span className="text-slate-400">Proprietor Name:</span>
                                <p className="font-semibold text-slate-800 mt-0.5">
                                  {employerDetail.proprietor_name}
                                </p>
                              </div>
                            )}
                            {employerDetail.director_name && (
                              <div>
                                <span className="text-slate-400">Director Name:</span>
                                <p className="font-semibold text-slate-800 mt-0.5">
                                  {employerDetail.director_name}
                                </p>
                              </div>
                            )}
                            {employerDetail.director_phone && (
                              <div>
                                <span className="text-slate-400">Director Phone:</span>
                                <p className="font-medium text-slate-800 mt-0.5">
                                  {employerDetail.director_phone}
                                </p>
                              </div>
                            )}
                            {employerDetail.director_email && (
                              <div>
                                <span className="text-slate-400">Director Email:</span>
                                <p className="font-medium text-slate-800 mt-0.5">
                                  {employerDetail.director_email}
                                </p>
                              </div>
                            )}
                            {employerDetail.company_email && (
                              <div>
                                <span className="text-slate-400">Official Company Email:</span>
                                <p className="font-medium text-slate-800 mt-0.5">
                                  {employerDetail.company_email}
                                </p>
                              </div>
                            )}
                            {employerDetail.company_phone && (
                              <div>
                                <span className="text-slate-400">Official Company Phone:</span>
                                <p className="font-medium text-slate-800 mt-0.5">
                                  {employerDetail.company_phone}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Verification Records Section (only rendered if verifications exist) */}
                      {employerDetail.verifications && employerDetail.verifications.length > 0 && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs text-xs space-y-3">
                          <div className="flex items-center gap-2">
                            <ShieldCheck size={16} className="text-blue-600" />
                            <h3 className="font-bold text-slate-900 text-sm">
                              Verification Records ({employerDetail.verifications.length})
                            </h3>
                          </div>

                          <div className="space-y-2">
                            {employerDetail.verifications.map((v) => {
                              const vb = formatVerificationStatus(v.status);
                              return (
                                <div
                                  key={v.id}
                                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3"
                                >
                                  <div>
                                    <p className="font-bold text-slate-800">
                                      {v.verification_type.replace(/_/g, " ")}
                                    </p>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                      Recorded on {formatDate(v.created_at)}
                                      {v.failure_reason && (
                                        <span className="text-rose-600 block mt-0.5">
                                          Reason: {v.failure_reason}
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${vb.bg} ${vb.text} ${vb.border}`}
                                  >
                                    {vb.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Bank Details (only rendered if bank details exist) */}
                      {(employerDetail.bank_account_holder_name ||
                        employerDetail.bank_ifsc ||
                        employerDetail.bank_account_number) && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs text-xs space-y-3">
                          <div className="flex items-center gap-2">
                            <CreditCard size={16} className="text-blue-600" />
                            <h3 className="font-bold text-slate-900 text-sm">Bank Details</h3>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-slate-700">
                            {employerDetail.bank_account_holder_name && (
                              <div>
                                <span className="text-slate-400">Account Holder:</span>
                                <p className="font-medium text-slate-800 mt-0.5">
                                  {employerDetail.bank_account_holder_name}
                                </p>
                              </div>
                            )}
                            {employerDetail.bank_ifsc && (
                              <div>
                                <span className="text-slate-400">IFSC Code:</span>
                                <p className="font-mono font-medium text-slate-800 mt-0.5">
                                  {employerDetail.bank_ifsc}
                                </p>
                              </div>
                            )}
                            {employerDetail.bank_account_number && (
                              <div className="col-span-2">
                                <span className="text-slate-400">Account Number:</span>
                                <p className="font-mono font-medium text-slate-800 mt-0.5">
                                  {employerDetail.bank_account_number}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Account Metadata */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs text-xs space-y-3">
                        <h3 className="font-bold text-slate-900 text-sm">Account Metadata</h3>
                        <div className="grid grid-cols-2 gap-3 text-slate-600">
                          <div>
                            <span className="text-slate-400">Mobile Verified:</span>{" "}
                            <span className="font-semibold text-slate-800">
                              {employerDetail.is_mobile_verified ? "Yes" : "No"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Free Dispatch Availed:</span>{" "}
                            <span className="font-semibold text-slate-800">
                              {employerDetail.has_availed_free_dispatch ? "Yes" : "No"}
                            </span>
                          </div>
                          {employerDetail.subscription_valid_until && (
                            <div className="col-span-2">
                              <span className="text-slate-400">Subscription Valid Until:</span>{" "}
                              <span className="font-semibold text-slate-800">
                                {formatDate(employerDetail.subscription_valid_until)}
                              </span>
                            </div>
                          )}
                          <div className="col-span-2 font-mono text-[11px] text-slate-400 break-all">
                            User ID: {employerDetail.user_id}
                          </div>
                          <div className="col-span-2 font-mono text-[11px] text-slate-400 break-all">
                            Profile ID: {employerDetail.id}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Drawer Sticky Action Footer */}
                {employerDetail && !loadingDetail && (
                  <div className="border-t border-slate-200 bg-white p-4">
                    <div className="flex flex-col sm:flex-row items-center gap-3">
                      {/* Activate / Deactivate Action */}
                      {employerDetail.is_active ? (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              open: true,
                              isActivating: false,
                              employerId: employerDetail.id,
                              employerName: employerDetail.name || employerDetail.business_name || "this employer",
                              loading: false,
                            })
                          }
                          className="w-full sm:flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                        >
                          <UserX size={14} />
                          <span>Deactivate Account</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              open: true,
                              isActivating: true,
                              employerId: employerDetail.id,
                              employerName: employerDetail.name || employerDetail.business_name || "this employer",
                              loading: false,
                            })
                          }
                          className="w-full sm:flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition cursor-pointer"
                        >
                          <UserCheck size={14} />
                          <span>Activate Account</span>
                        </button>
                      )}

                      {/* Edit Safe Fields Action */}
                      <button
                        type="button"
                        onClick={() => openEditModal(employerDetail)}
                        className="w-full sm:flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer shadow-2xs"
                      >
                        <Edit3 size={14} />
                        <span>Edit Profile</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* Confirmation Modal (Activate / Deactivate) */}
        {/* =================================================================== */}
        {confirmModal && confirmModal.open && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
              onClick={() => !confirmModal.loading && setConfirmModal(null)}
            />
            <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    confirmModal.isActivating ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                  }`}
                >
                  {confirmModal.isActivating ? <UserCheck size={20} /> : <ShieldAlert size={20} />}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {confirmModal.isActivating ? "Activate Employer Account?" : "Deactivate Employer Account?"}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Target: {confirmModal.employerName}</p>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                {confirmModal.isActivating
                  ? "Activating this employer will restore their access to create jobs, manage job sites, and access the GLESKA employer portal."
                  : "Deactivating this employer will immediately prevent them from logging in, managing job sites, or posting jobs on the platform until reactivated by an admin."}
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={confirmModal.loading}
                  onClick={() => setConfirmModal(null)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={confirmModal.loading}
                  onClick={handleConfirmStatusChange}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition cursor-pointer disabled:opacity-50 ${
                    confirmModal.isActivating
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-rose-600 hover:bg-rose-700"
                  }`}
                >
                  {confirmModal.loading && <Loader2 size={13} className="animate-spin" />}
                  <span>{confirmModal.isActivating ? "Confirm Activation" : "Confirm Deactivation"}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* Safe Profile Edit Modal */}
        {/* =================================================================== */}
        {editModal && editModal.open && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
              onClick={() => !editModal.loading && setEditModal(null)}
            />
            <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Edit Employer Information</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Modifying safe profile and company fields. System identifiers and security attributes remain locked.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={editModal.loading}
                  onClick={() => setEditModal(null)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveProfileEdit} className="space-y-4 text-xs">
                {/* Section 1: Account Contact */}
                <div>
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-2">
                    Primary Account Contact
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Contact / User Name</label>
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
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Mobile Number</label>
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
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Company & Business Profile */}
                <div className="border-t border-slate-100 pt-4">
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-2">
                    Company & Business Information
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Business / Company Name</label>
                      <input
                        type="text"
                        value={editModal.formData.business_name}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, business_name: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Employer Type</label>
                      <select
                        value={editModal.formData.employer_type}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, employer_type: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      >
                        <option value="REGISTERED_BUSINESS">Registered Business</option>
                        <option value="REGISTERED_INDUSTRY">Registered Industry</option>
                        <option value="UNREGISTERED_BUSINESS">Unregistered Business</option>
                        <option value="INDIVIDUAL">Individual</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Contact Person Name</label>
                      <input
                        type="text"
                        value={editModal.formData.contact_person_name}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, contact_person_name: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">GSTIN</label>
                      <input
                        type="text"
                        value={editModal.formData.gstin}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, gstin: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">PAN Number</label>
                      <input
                        type="text"
                        value={editModal.formData.pan_number}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, pan_number: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">CIN Number</label>
                      <input
                        type="text"
                        value={editModal.formData.cin_number}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, cin_number: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Udyam Number</label>
                      <input
                        type="text"
                        value={editModal.formData.udyam_number}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, udyam_number: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Website URL</label>
                      <input
                        type="text"
                        value={editModal.formData.website_url}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, website_url: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-slate-600 font-medium mb-1">Business Description</label>
                      <textarea
                        rows={2}
                        value={editModal.formData.description}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, description: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 3: Location */}
                <div className="border-t border-slate-100 pt-4">
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-2">
                    Address & Location
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-slate-600 font-medium mb-1">Registered Address</label>
                      <input
                        type="text"
                        value={editModal.formData.registered_address}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, registered_address: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">City</label>
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
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">State</label>
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
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Pincode</label>
                      <input
                        type="text"
                        value={editModal.formData.pincode}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, pincode: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Work Location</label>
                      <input
                        type="text"
                        value={editModal.formData.work_location}
                        onChange={(e) =>
                          setEditModal((prev) =>
                            prev
                              ? { ...prev, formData: { ...prev.formData, work_location: e.target.value } }
                              : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    disabled={editModal.loading}
                    onClick={() => setEditModal(null)}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editModal.loading}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition cursor-pointer disabled:opacity-50 shadow-2xs"
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
