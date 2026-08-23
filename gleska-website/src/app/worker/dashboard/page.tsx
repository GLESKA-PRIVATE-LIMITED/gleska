"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  LogOut,
  Zap,
  User,
  MapPin,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import apiClient from "@/lib/api";

export default function WorkerDashboard() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [profile, setProfile] = React.useState<{ profile_completed: boolean; availability_status: string; expected_daily_wage?: number | null }>({ profile_completed: false, availability_status: "OFFLINE" });
  const [availableJobs, setAvailableJobs] = React.useState<Array<{ job_id: string; title: string; salary: number; headcount: number; min_experience: number | null; employer_name: string; distance_km: number | null }>>([]);
  const [jobsLoading, setJobsLoading] = React.useState(true);
  const [jobsError, setJobsError] = React.useState("");
  const [locationSaving, setLocationSaving] = React.useState(false);

  useEffect(() => {
    if (!user || user.role !== "WORKER") return;
    apiClient.get("/api/v1/workers/me").then((response) => setProfile(response.data)).catch(() => undefined);
    apiClient.get("/api/v1/workers/me/available-jobs").then((response) => setAvailableJobs(response.data.jobs || [])).catch((error) => setJobsError(error.response?.data?.detail || "Unable to load nearby jobs")).finally(() => setJobsLoading(false));
  }, [user]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/worker/auth");
    }

    // Redirect if next step is not DASHBOARD
    if (!isLoading && user && nextStep !== "DASHBOARD") {
      router.push(nextStep === "WORKER_PROFILE" ? "/worker/onboarding" : "/worker/auth");
    }
  }, [user, isLoading, nextStep, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="animate-spin text-indigo-600" />
          <p className="text-slate-600 dark:text-slate-400">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
      toast.success("Logged out successfully");
    } catch (err) {
      toast.error("Logout failed");
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setJobsError("Location is not supported by this browser.");
      return;
    }

    setLocationSaving(true);
    setJobsError("");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          await apiClient.put("/api/v1/workers/me/location", {
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
          const response = await apiClient.get("/api/v1/workers/me/available-jobs");
          setAvailableJobs(response.data.jobs || []);
          toast.success("Location updated");
        } catch (error: any) {
          setJobsError(error.response?.data?.detail || "Unable to update your location");
        } finally {
          setLocationSaving(false);
        }
      },
      () => {
        setJobsError("Location permission is required to find nearby jobs.");
        setLocationSaving(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  return (
    <div className="min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-600 to-indigo-600">
              <Zap size={16} className="text-white" fill="currentColor" />
            </div>
            <span className="font-(--font-anton) text-lg uppercase text-slate-900 dark:text-white">
              GO LESKA
            </span>
          </Link>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-6 py-12">
        {/* Welcome Card */}
        <div className="mb-8 rounded-3xl bg-linear-to-br from-amber-50 to-yellow-50 p-8 dark:from-amber-950/20 dark:to-yellow-950/20 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Welcome back
              </p>
              <h1 className="font-(--font-anton) text-4xl uppercase text-slate-900 dark:text-white">
                {user.name}
              </h1>
              <p className="mt-2 text-lg text-amber-700 dark:text-amber-300">
                Ready to find your next job?
              </p>
            </div>
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-linear-to-br from-amber-400 to-yellow-500 shadow-lg">
              <User size={40} className="text-white" />
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Profile Completion Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950">
                <User size={20} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Profile
              </h3>
            </div>
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Completion
                  </p>
                  <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{profile.profile_completed ? "100%" : "0%"}</p>
                </div>
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className={`h-full rounded-full bg-linear-to-r from-indigo-500 to-indigo-600 ${profile.profile_completed ? "w-full" : "w-0"}`}></div>
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add your trade, experience, and expected wage to improve matches
              </p>
              <Link
                href="/worker/profile"
                className="inline-block text-sm font-bold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400"
              >
                Complete Profile →
              </Link>
            </div>
          </div>

          {/* Availability Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950">
                <Clock size={20} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Availability
              </h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-slate-400"></div>
                <p className="font-semibold text-slate-700 dark:text-slate-300">{profile.availability_status}</p>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Set your availability to AVAILABLE to receive job pings
              </p>
              <button className="inline-block text-sm font-bold text-emerald-600 transition hover:text-emerald-700 dark:text-emerald-400">
                Go Online →
              </button>
            </div>
          </div>

          {/* Stats Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
                <MapPin size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Your Stats
              </h3>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Jobs Accepted
                </p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">0</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Hourly Rate
                </p>
                <p className="text-xl font-bold text-slate-900 dark:text-white">{profile.expected_daily_wage ? `₹${profile.expected_daily_wage}/day` : "Not set"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Jobs Section */}
        <div className="mt-12">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">Jobs Near You</h2>
            <button type="button" onClick={handleUseCurrentLocation} disabled={locationSaving} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-900 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/30">
              {locationSaving ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
              {locationSaving ? "Updating location..." : "Use current location"}
            </button>
          </div>
          {jobsLoading ? (
            <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 dark:border-slate-800 dark:bg-slate-900"><Loader2 className="animate-spin text-blue-600" /></div>
          ) : jobsError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300">{jobsError}</div>
          ) : availableJobs.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-12 text-center dark:border-slate-700 dark:bg-slate-800"><AlertCircle size={40} className="mx-auto mb-4 text-slate-400" /><p className="text-lg font-semibold text-slate-600 dark:text-slate-400">No nearby jobs available</p><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Eligible SEARCHING jobs within 30 km will appear here.</p></div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">{availableJobs.map((job) => <article key={job.job_id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between gap-4"><div><h3 className="font-bold text-slate-900 dark:text-white">{job.title}</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{job.employer_name}</p></div><MapPin size={18} className="shrink-0 text-blue-600" /></div><div className="mt-5 grid grid-cols-3 gap-3 text-sm"><div><p className="text-xs text-slate-500">Pay</p><p className="font-bold">₹{job.salary}/day</p></div><div><p className="text-xs text-slate-500">Workers</p><p className="font-bold">{job.headcount}</p></div><div><p className="text-xs text-slate-500">Distance</p><p className="font-bold">{job.distance_km ?? "-"} km</p></div></div></article>)}</div>
          )}
        </div>
      </main>
    </div>
  );
}
