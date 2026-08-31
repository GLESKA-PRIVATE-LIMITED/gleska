"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AuthContext, AuthUser } from "@/context/AuthContext";
import EmployerDashboard from "@/app/employer/dashboard/page";
import apiClient from "@/lib/api";

const mockUser: AuthUser = {
  id: "preview-employer-123",
  name: "Rahul Sharma (Preview Demo)",
  mobile: "+91 98765 43210",
  email: "demo.employer@goleska.ai",
  role: "EMPLOYER",
  onboarding_status: "COMPLETED",
  employer_type: "REGISTERED_BUSINESS",
  profile_completed: true,
  is_mobile_verified: true,
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockProfile = {
  employer_type: "REGISTERED_BUSINESS",
  onboarding_status: "COMPLETED",
  verification_status: "VERIFIED",
  contact_person_name: "Rahul Sharma",
  created_at: new Date().toISOString(),
  subscription_valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  has_availed_free_dispatch: true,
};

const initialJobSites = [
  {
    id: "site-1",
    name: "Site Alpha - Bandra West Commercial",
    address: "Bandra West Commercial Hub, Mumbai, MH 400050",
    latitude: 19.06,
    longitude: 72.83,
  },
  {
    id: "site-2",
    name: "Site Beta - Nanded Industrial Hub",
    address: "MIDC Phase 2, Nanded, MH 431603",
    latitude: 19.15,
    longitude: 77.31,
  },
];

interface JobItem {
  id: string;
  job_site_id: string;
  title: string;
  headcount_required: number;
  max_daily_salary: number | null;
  min_experience: number | null;
  status: string;
}

const initialJobs: JobItem[] = [
  {
    id: "job-1",
    job_site_id: "site-1",
    title: "Senior Mason & Construction Helper",
    headcount_required: 5,
    max_daily_salary: 850,
    min_experience: 2,
    status: "OPEN",
  },
  {
    id: "job-2",
    job_site_id: "site-2",
    title: "Electrical Wiring Technician",
    headcount_required: 2,
    max_daily_salary: 950,
    min_experience: 3,
    status: "OPEN",
  },
];

export default function EmployerDashboardPreviewPage() {
  const [jobSites, setJobSites] = useState(initialJobSites);
  const [jobs, setJobs] = useState(initialJobs);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const originalAdapter = apiClient.defaults.adapter;

    // Attach mock adapter synchronously before child dashboard mounts
    apiClient.defaults.adapter = async (config: any) => {
      const url = config.url || "";
      const method = (config.method || "get").toLowerCase();

      if (url.includes("/api/v1/employers/me")) {
        return { data: mockProfile, status: 200, statusText: "OK", headers: {}, config };
      }
      if (url.includes("/api/v1/job-sites/me") || (url.includes("/api/v1/job-sites") && method === "get")) {
        return { data: jobSites, status: 200, statusText: "OK", headers: {}, config };
      }
      if (url.includes("/api/v1/job-sites") && method === "post") {
        const body = typeof config.data === "string" ? JSON.parse(config.data || "{}") : config.data || {};
        const newSite = {
          id: `site-${Date.now()}`,
          name: body.name || "New Work Site",
          address: body.address || "Location selected",
          latitude: body.latitude || 19.07,
          longitude: body.longitude || 72.87,
        };
        setJobSites((prev) => [newSite, ...prev]);
        return { data: newSite, status: 201, statusText: "Created", headers: {}, config };
      }
      if (url.includes("/api/v1/job-sites/") && method === "delete") {
        const parts = url.split("/");
        const siteId = parts[parts.length - 1];
        setJobSites((prev) => prev.filter((s) => s.id !== siteId));
        return { data: { message: "Work site removed" }, status: 200, statusText: "OK", headers: {}, config };
      }
      if (url.includes("/api/v1/jobs") && method === "get") {
        return { data: jobs, status: 200, statusText: "OK", headers: {}, config };
      }
      if (url.includes("/api/v1/jobs/nlp") && method === "post") {
        const body = typeof config.data === "string" ? JSON.parse(config.data || "{}") : config.data || {};
        const promptText = body.prompt || "Site Helper";
        return {
          data: {
            parsed_data: {
              title: promptText.length > 30 ? promptText.slice(0, 30) + "..." : promptText,
              headcount_required: 3,
              max_daily_salary: 800,
              min_experience: 1,
            },
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      }
      if (url.includes("/api/v1/jobs") && method === "post") {
        const body = typeof config.data === "string" ? JSON.parse(config.data || "{}") : config.data || {};
        const newJob: JobItem = {
          id: `job-${Date.now()}`,
          job_site_id: body.job_site_id,
          title: body.title,
          headcount_required: Number(body.headcount_required || 1),
          max_daily_salary: body.max_daily_salary ? Number(body.max_daily_salary) : null,
          min_experience: body.min_experience ? Number(body.min_experience) : null,
          status: "OPEN",
        };
        setJobs((prev) => [newJob, ...prev]);
        return { data: newJob, status: 201, statusText: "Created", headers: {}, config };
      }
      if (url.includes("/api/v1/payments/create-subscription-order")) {
        return { data: { payment_session_id: "mock_session_demo" }, status: 200, statusText: "OK", headers: {}, config };
      }
      if (url.includes("/api/v1/payments/verify")) {
        return { data: { status: "SUCCESS" }, status: 200, statusText: "OK", headers: {}, config };
      }

      // Return mock empty success for any other backend request
      return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };

    setIsReady(true);

    return () => {
      apiClient.defaults.adapter = originalAdapter;
    };
  }, [jobSites, jobs]);

  const mockAuthContextValue = useMemo(
    () => ({
      user: mockUser,
      isAuthenticated: true,
      isSubscribed: false,
      isLoading: false,
      nextStep: "DASHBOARD" as const,
      error: null,
      login: async () => {},
      loginWithMobile: async () => {},
      logout: async () => {},
      refreshUser: async () => "DASHBOARD" as const,
      requestOTP: async () => ({ requestId: null }),
      resendOTP: async () => {},
      signInWithEmail: async () => {},
      signInWithGoogle: async () => {},
      resolveGoogleSession: async () => ({ role: "EMPLOYER" as const, nextStep: "DASHBOARD" as const }),
      provisionSession: async () => ({ user: mockUser, nextStep: "DASHBOARD" as const }),
      completeEmailSignup: async () => {},
      requestPasswordReset: async () => {},
      verifyPasswordResetOTP: async () => "",
      completePasswordReset: async () => {},
      signupPreflight: async () => {},
      setAuthState: () => {},
    }),
    []
  );

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Loading Employer Dashboard Preview...</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={mockAuthContextValue}>
      <div className="relative min-h-screen">
        <div className="sticky top-0 z-50 flex items-center justify-between bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-md">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300"></span>
            <span>LOCAL UI PREVIEW MODE — Employer Dashboard (No backend or auth required)</span>
          </div>
          <span className="rounded-md bg-emerald-700 px-2 py-0.5 font-mono text-[11px]">
            /employer-preview
          </span>
        </div>
        <EmployerDashboard />
      </div>
    </AuthContext.Provider>
  );
}
