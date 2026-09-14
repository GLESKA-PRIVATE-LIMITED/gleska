"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Compass,
  ExternalLink,
  Eye,
  Filter,
  Globe2,
  Loader2,
  MapPin,
  RotateCw,
  Search,
  User,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AdminShell from "@/components/admin/AdminShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocationKPI {
  total_workers: number;
  total_employers: number;
  workers_with_location: number;
  employers_with_location: number;
  workers_without_location: number;
  employers_without_location: number;
  states_covered: number;
  cities_covered: number;
}

interface StateAggregationItem {
  state: string;
  worker_count: number;
  employer_count: number;
  total_count: number;
}

interface CityAggregationItem {
  city: string;
  state: string;
  worker_count: number;
  employer_count: number;
  total_count: number;
}

interface RegionalSummaryResponse {
  kpis: LocationKPI;
  states: StateAggregationItem[];
  cities: CityAggregationItem[];
}

interface UserLocationItem {
  user_id: string;
  profile_id: string;
  user_name: string;
  user_mobile: string | null;
  user_email: string | null;
  user_type: "WORKER" | "EMPLOYER";
  employer_type: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  address: string | null;
  registered_address: string | null;
  work_location: string | null;
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  location_updated_at: string | null;
  is_active: boolean;
  location_available: boolean;
  onboarding_status: string | null;
  profile_completed: boolean | null;
  verification_status: string | null;
  created_at: string;
}

interface UserLocationListResponse {
  items: UserLocationItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ---------------------------------------------------------------------------
// Badges & Helpers
// ---------------------------------------------------------------------------

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
      <User size={11} className="shrink-0" />
      {isWorker ? "Worker" : "Employer"}
    </span>
  );
}

function LocationStatusBadge({ available }: { available: boolean }) {
  if (available) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Available
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Incomplete
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        active
          ? "border-slate-200 bg-slate-50 text-slate-700"
          : "border-rose-200 bg-rose-50 text-rose-600"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="text-sm text-slate-800 break-words">{value || "—"}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Admin Locations Page Component
// ---------------------------------------------------------------------------

export default function AdminLocationsPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();

  // Summary & Distributions State
  const [summary, setSummary] = useState<RegionalSummaryResponse | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState("");

  // Directory Search & Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState("ALL");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [cityFilter, setCityFilter] = useState("ALL");
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Directory Listing State
  const [usersList, setUsersList] = useState<UserLocationItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");

  // Detail Drawer State
  const [selectedUser, setSelectedUser] = useState<UserLocationItem | null>(null);

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

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [userTypeFilter, stateFilter, cityFilter, activeFilter]);

  // Fetch Regional Summary (KPIs, States, Cities)
  const fetchSummary = useCallback(async () => {
    if (!user || user.role !== "ADMIN") return;
    setLoadingSummary(true);
    setSummaryError("");
    try {
      const res = await apiClient.get<RegionalSummaryResponse>(
        "/api/v1/admin/locations/summary"
      );
      setSummary(res.data);
    } catch {
      setSummaryError("Failed to load regional aggregation metrics.");
    } finally {
      setLoadingSummary(false);
    }
  }, [user]);

  // Fetch Paginated User Location Directory
  const fetchUsers = useCallback(async () => {
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
      if (stateFilter !== "ALL") params.state = stateFilter;
      if (cityFilter !== "ALL") params.city = cityFilter;
      if (activeFilter !== "ALL") params.is_active = activeFilter;

      const res = await apiClient.get<UserLocationListResponse>(
        "/api/v1/admin/locations/users",
        { params }
      );
      setUsersList(res.data.items || []);
      setTotalCount(res.data.total || 0);
      setTotalPages(res.data.total_pages || 1);
    } catch {
      setListError("Failed to fetch user locations directory.");
    } finally {
      setLoadingList(false);
    }
  }, [
    user,
    currentPage,
    pageSize,
    debouncedSearch,
    userTypeFilter,
    stateFilter,
    cityFilter,
    activeFilter,
  ]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleRefreshAll = () => {
    void fetchSummary();
    void fetchUsers();
  };

  if (isLoading || !user || user.role !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb]">
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  const kpis = summary?.kpis;

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
                Geographic Intelligence
              </span>
              <span className="text-xs text-slate-400 font-medium">
                Regional Distribution · Jurisdictions
              </span>
            </div>
            <h1 className="mt-1 font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wide text-slate-900">
              Regional & Locations Directory
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              Platform geographical coverage, state/city user distribution, and localized member registries.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={loadingSummary || loadingList}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition disabled:opacity-60 cursor-pointer self-start sm:self-auto"
          >
            <RotateCw
              size={15}
              className={loadingSummary || loadingList ? "animate-spin" : ""}
            />
            Refresh
          </button>
        </div>

        {/* =================================================================== */}
        {/* 1. KPI Cards */}
        {/* =================================================================== */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {/* Card 1: Workers with Location */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
            <div className="flex items-center gap-2 text-blue-600">
              <Users size={17} />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Workers Located
              </span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-bold text-slate-900">
              {loadingSummary ? "—" : kpis?.workers_with_location ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Of {kpis?.total_workers ?? 0} registered workers
            </p>
          </div>

          {/* Card 2: Employers with Location */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
            <div className="flex items-center gap-2 text-violet-600">
              <Building2 size={17} />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Employers Located
              </span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-bold text-slate-900">
              {loadingSummary ? "—" : kpis?.employers_with_location ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Of {kpis?.total_employers ?? 0} registered employers
            </p>
          </div>

          {/* Card 3: States Covered */}
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 sm:p-5 shadow-xs">
            <div className="flex items-center gap-2 text-emerald-700">
              <Globe2 size={17} />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                States Covered
              </span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-bold text-slate-900">
              {loadingSummary ? "—" : kpis?.states_covered ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-400">Active regional states</p>
          </div>

          {/* Card 4: Cities Covered */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 sm:p-5 shadow-xs">
            <div className="flex items-center gap-2 text-blue-700">
              <Compass size={17} />
              <span className="text-xs font-bold uppercase tracking-wider text-blue-800">
                Cities Covered
              </span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-bold text-slate-900">
              {loadingSummary ? "—" : kpis?.cities_covered ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-400">Operating municipal hubs</p>
          </div>
        </div>

        {summaryError && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle size={16} className="shrink-0" />
            {summaryError}
          </div>
        )}

        {/* =================================================================== */}
        {/* 2. Geographic Distributions (State & City) */}
        {/* =================================================================== */}
        <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* State Distribution Table */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900">
                  State Distribution
                </h3>
                <p className="text-xs text-slate-400">
                  Regional headcount grouped by verified state jurisdiction
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                {summary?.states.length ?? 0} States
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left">State</th>
                    <th className="px-3 py-2.5 text-center">Workers</th>
                    <th className="px-3 py-2.5 text-center">Employers</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingSummary ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-xs text-slate-400">
                        <Loader2 size={20} className="mx-auto animate-spin text-blue-500 mb-1" />
                        Loading states…
                      </td>
                    </tr>
                  ) : summary?.states.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-xs text-slate-400">
                        No state locations recorded yet.
                      </td>
                    </tr>
                  ) : (
                    summary?.states.map((st) => (
                      <tr key={st.state} className="hover:bg-slate-50/70 transition">
                        <td className="px-3 py-2.5 font-semibold text-slate-900">
                          {st.state}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs text-blue-700">
                          {st.worker_count}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs text-violet-700">
                          {st.employer_count}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                          {st.total_count}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* City Distribution Table */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900">
                  City Distribution
                </h3>
                <p className="text-xs text-slate-400">
                  Municipal centers with active workers or employers
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                {summary?.cities.length ?? 0} Cities
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left">City</th>
                    <th className="px-3 py-2.5 text-left">State</th>
                    <th className="px-3 py-2.5 text-center">Workers</th>
                    <th className="px-3 py-2.5 text-center">Employers</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingSummary ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-xs text-slate-400">
                        <Loader2 size={20} className="mx-auto animate-spin text-blue-500 mb-1" />
                        Loading cities…
                      </td>
                    </tr>
                  ) : summary?.cities.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                        No city locations recorded yet.
                      </td>
                    </tr>
                  ) : (
                    summary?.cities.map((ct) => (
                      <tr key={`${ct.city}-${ct.state}`} className="hover:bg-slate-50/70 transition">
                        <td className="px-3 py-2.5 font-semibold text-slate-900">
                          {ct.city}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-500">
                          {ct.state}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs text-blue-700">
                          {ct.worker_count}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs text-violet-700">
                          {ct.employer_count}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                          {ct.total_count}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* 3. User Location Directory Section */}
        {/* =================================================================== */}
        <div className="mb-4">
          <h2 className="font-[var(--font-anton)] text-xl sm:text-2xl uppercase tracking-wide text-slate-900">
            User Location Directory
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Browse and filter platform members by geographic jurisdiction, account type, and completeness.
          </p>
        </div>

        {/* Search & Filters Bar */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search name, city, state, pincode…"
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

          {/* User Type Filter */}
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400 shrink-0" />
            <select
              value={userTypeFilter}
              onChange={(e) => setUserTypeFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition cursor-pointer"
            >
              <option value="ALL">All Member Types</option>
              <option value="WORKER">Workers Only</option>
              <option value="EMPLOYER">Employers Only</option>
            </select>
          </div>

          {/* State Filter */}
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition cursor-pointer"
          >
            <option value="ALL">All States</option>
            {summary?.states.map((st) => (
              <option key={st.state} value={st.state}>
                {st.state} ({st.total_count})
              </option>
            ))}
          </select>

          {/* City Filter */}
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition cursor-pointer"
          >
            <option value="ALL">All Cities</option>
            {summary?.cities.map((ct) => (
              <option key={`${ct.city}-${ct.state}`} value={ct.city}>
                {ct.city}
              </option>
            ))}
          </select>

          {/* Active Status Filter */}
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Users</option>
            <option value="INACTIVE">Inactive Users</option>
          </select>
        </div>

        {/* Directory Results Summary & Counts */}
        <div className="mb-3 flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>
            {loadingList
              ? "Loading directory…"
              : `Showing page ${currentPage} of ${totalPages} (${totalCount} members)`}
          </span>
          {usersList.length > 0 && !loadingList && (
            <span className="text-slate-400">
              {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, totalCount)} of {totalCount}
            </span>
          )}
        </div>

        {listError && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle size={16} className="shrink-0" />
            {listError}
          </div>
        )}

        {/* Desktop Directory Table */}
        <div className="hidden sm:block rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">City</th>
                  <th className="px-4 py-3 text-left">State</th>
                  <th className="px-4 py-3 text-left">Pincode</th>
                  <th className="px-4 py-3 text-left">Completeness</th>
                  <th className="px-4 py-3 text-left">Account</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingList ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      <Loader2 size={28} className="mx-auto animate-spin text-blue-500" />
                      <p className="mt-2 text-sm text-slate-500">Loading directory…</p>
                    </td>
                  </tr>
                ) : usersList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      <MapPin size={36} className="mx-auto text-slate-300" />
                      <p className="mt-2 text-sm font-semibold text-slate-600">
                        No members matched your search or filters.
                      </p>
                      <p className="text-xs text-slate-400">
                        Try broadening your city, state, or user type filters.
                      </p>
                    </td>
                  </tr>
                ) : (
                  usersList.map((u) => (
                    <tr
                      key={u.user_id}
                      onClick={() => setSelectedUser(u)}
                      className={`hover:bg-slate-50/80 transition cursor-pointer ${
                        selectedUser?.user_id === u.user_id ? "bg-blue-50/50" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 truncate max-w-[170px]">
                          {u.user_name}
                        </p>
                        <p className="text-xs text-slate-400 font-mono">
                          {u.user_mobile || "No mobile"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <UserTypeBadge type={u.user_type} />
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {u.city || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {u.state || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {u.pincode || <span className="text-slate-400 font-sans">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <LocationStatusBadge available={u.location_available} />
                      </td>
                      <td className="px-4 py-3">
                        <ActiveBadge active={u.is_active} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedUser(u);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition cursor-pointer"
                        >
                          <Eye size={12} />
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile Directory Card List */}
        <div className="sm:hidden space-y-3">
          {loadingList ? (
            <div className="py-12 text-center">
              <Loader2 size={26} className="mx-auto animate-spin text-blue-500" />
              <p className="mt-2 text-xs text-slate-400">Loading directory…</p>
            </div>
          ) : usersList.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
              <MapPin size={32} className="mx-auto text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No members found</p>
              <p className="text-xs text-slate-400">Try adjusting your filters.</p>
            </div>
          ) : (
            usersList.map((u) => (
              <div
                key={u.user_id}
                onClick={() => setSelectedUser(u)}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs hover:border-blue-200 transition cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{u.user_name}</p>
                    <p className="text-xs text-slate-400">{u.user_mobile || "No mobile"}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <UserTypeBadge type={u.user_type} />
                    <LocationStatusBadge available={u.location_available} />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-600 border-t border-slate-100 pt-2">
                  <span className="font-medium">
                    {u.city ? `${u.city}, ${u.state}` : "Location not provided"}
                  </span>
                  <span className="font-mono text-slate-400">{u.pincode || ""}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination Controls */}
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
            <span className="text-sm font-semibold text-slate-600 px-3">
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

      {/* ===================================================================== */}
      {/* 4. Slide-over Detail Drawer */}
      {/* ===================================================================== */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setSelectedUser(null)}
          />

          {/* Drawer Panel */}
          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900">
                  Member Location Details
                </h2>
                <p className="text-xs text-slate-400 font-mono truncate max-w-[280px]">
                  {selectedUser.user_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Badges row */}
              <div className="flex flex-wrap gap-2 py-3 border-b border-slate-100">
                <UserTypeBadge type={selectedUser.user_type} />
                <LocationStatusBadge available={selectedUser.location_available} />
                <ActiveBadge active={selectedUser.is_active} />
              </div>

              {/* Navigation link to respective Admin Module */}
              <div className="py-3 border-b border-slate-100">
                {selectedUser.user_type === "WORKER" ? (
                  <Link
                    href="/admin/workers"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition"
                  >
                    <ExternalLink size={12} />
                    View in Admin Workers Directory
                  </Link>
                ) : (
                  <Link
                    href="/admin/employers"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition"
                  >
                    <ExternalLink size={12} />
                    View in Admin Employers Directory
                  </Link>
                )}
              </div>

              {/* Basic Member Info */}
              <div className="pt-3 pb-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                  Member Identity
                </p>
              </div>
              <DetailRow label="Name / Entity" value={selectedUser.user_name} />
              <DetailRow label="Mobile" value={selectedUser.user_mobile} />
              <DetailRow label="Email" value={selectedUser.user_email} />
              {selectedUser.employer_type && (
                <DetailRow label="Employer Type" value={selectedUser.employer_type} />
              )}
              {selectedUser.onboarding_status && (
                <DetailRow
                  label="Onboarding Status"
                  value={selectedUser.onboarding_status}
                />
              )}
              {selectedUser.verification_status && (
                <DetailRow
                  label="Verification Status"
                  value={selectedUser.verification_status}
                />
              )}

              {/* Regional Jurisdiction */}
              <div className="pt-4 pb-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                  Regional Jurisdiction
                </p>
              </div>
              <DetailRow label="City" value={selectedUser.city} />
              <DetailRow label="State" value={selectedUser.state} />
              <DetailRow label="Pincode" value={selectedUser.pincode} />

              {/* Specific Street Address / Work Location (Exposed only in Drawer) */}
              <div className="pt-4 pb-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                  Premises & Coordinates
                </p>
              </div>
              {selectedUser.address && (
                <DetailRow label="Premises Address" value={selectedUser.address} />
              )}
              {selectedUser.registered_address && (
                <DetailRow
                  label="Registered Statutory Address"
                  value={selectedUser.registered_address}
                />
              )}
              {selectedUser.work_location && (
                <DetailRow
                  label="Operating Work Location"
                  value={selectedUser.work_location}
                />
              )}
              <DetailRow
                label="Latitude / Longitude"
                value={
                  selectedUser.latitude != null && selectedUser.longitude != null ? (
                    <span className="font-mono text-xs">
                      {selectedUser.latitude.toFixed(5)}, {selectedUser.longitude.toFixed(5)}
                    </span>
                  ) : (
                    "Coordinates not recorded"
                  )
                }
              />
              {selectedUser.location_source && (
                <DetailRow label="Capture Source" value={selectedUser.location_source} />
              )}
              {selectedUser.location_updated_at && (
                <DetailRow
                  label="Location Timestamp"
                  value={new Date(selectedUser.location_updated_at).toLocaleString("en-IN")}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
