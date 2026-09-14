"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Briefcase,
  Building2,
  Clock,
  Loader2,
  Users,
  Zap,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AdminShell from "@/components/admin/AdminShell";

type OverviewResponse = {
  summary: {
    total_workers: number;
    total_employers: number;
    total_jobs: number;
    active_jobs: number;
    pending_employers: number;
  };
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/admin/login");
      return;
    }

    if (!isLoading && user && user.role !== "ADMIN") {
      router.replace("/");
    }
  }, [isLoading, router, user]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<OverviewResponse>("/api/v1/admin/overview");
      setData(response.data);
    } catch {
      setError("Unable to load the admin overview right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || user.role !== "ADMIN") return;
    void loadData();
  }, [user, loadData]);

  const statCards = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: "Total Workers",
        value: data.summary.total_workers,
        helper: "Registered workers",
        icon: Users,
        iconBg: "bg-blue-50 text-blue-600",
      },
      {
        label: "Total Employers",
        value: data.summary.total_employers,
        helper: "Registered employers",
        icon: Building2,
        iconBg: "bg-indigo-50 text-indigo-600",
      },
      {
        label: "Total Jobs",
        value: data.summary.total_jobs,
        helper: "All posted jobs",
        icon: Briefcase,
        iconBg: "bg-emerald-50 text-emerald-600",
      },
      {
        label: "Active Jobs",
        value: data.summary.active_jobs,
        helper: "Currently searching",
        icon: Zap,
        iconBg: "bg-amber-50 text-amber-600",
      },
      {
        label: "Pending Verification",
        value: data.summary.pending_employers,
        helper: "Employers awaiting verification",
        icon: Clock,
        iconBg: "bg-rose-50 text-rose-600",
      },
    ];
  }, [data]);

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
        {/* Header Title Area */}
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700">
              <span>Admin Operations</span>
            </div>
            <h1 className="mt-2 font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wide text-slate-900">
              Platform Overview
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Live operational metrics across the GLESKA ecosystem.
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <div className="flex items-center gap-2.5">
              <AlertCircle size={18} className="shrink-0 text-rose-600" />
              <span className="font-medium">{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 transition cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}

        {/* Loading Spinner */}
        {loading && !data && (
          <div className="flex min-h-[300px] items-center justify-center">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-medium text-slate-600 shadow-xs">
              <Loader2 size={20} className="animate-spin text-blue-600" />
              <span>Loading overview data...</span>
            </div>
          </div>
        )}

        {/* Key Statistics Cards */}
        {data && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {statCards.map(({ label, value, helper, icon: Icon, iconBg }) => (
              <div
                key={label}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {label}
                  </span>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconBg}`}>
                    <Icon size={18} />
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-3xl font-bold text-slate-900">{value}</p>
                  <p className="mt-1 text-xs text-slate-500">{helper}</p>
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
    </AdminShell>
  );
}

