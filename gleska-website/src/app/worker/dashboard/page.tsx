"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Briefcase, CheckCircle2, Clock3, Loader2, MapPin, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import AccountManagementShell from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { getLocationErrorMessage, normalizeCoordinates, shouldSendLiveLocationUpdate, type LiveLocationSnapshot } from "@/lib/location";

type WorkerProfile = {
  profile_completed: boolean;
  availability_status: "AVAILABLE" | "ON_JOB" | "OFFLINE";
  address?: string | null;
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  subscription_valid_until?: string | null;
};

type AvailableJob = {
  job_id: string;
  title: string;
  salary: number;
  employer_name: string;
  distance_km: number | null;
};

type WorkerJob = {
  match_id: string;
  job_id: string;
  title: string;
  employer_name?: string | null;
  status: string;
  completed_at?: string | null;
};

type WorkerJobDetails = {
  site_name?: string | null;
};

type AttendanceRecord = {
  job_title: string;
  site_name: string;
  status: "PRESENT" | "LATE" | "ABSENT";
  check_in_at?: string | null;
  check_out_at?: string | null;
};

function formatTime(value?: string | null): string {
  return value ? new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "-";
}

function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Date unavailable";
}

function isSubscriptionActive(value?: string | null): boolean {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

function SectionState({ loading, error, retry, errorAction, children }: { loading: boolean; error: string; retry: () => void; errorAction?: React.ReactNode; children: React.ReactNode }) {
  if (loading) return <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" /> Loading...</div>;
  if (error) return <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/20 dark:text-rose-300"><p>{error}</p>{errorAction}<button type="button" onClick={retry} className="mt-3 block font-bold underline">Try again</button></div>;
  return <>{children}</>;
}

export default function WorkerDashboard() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [profile, setProfile] = React.useState<WorkerProfile | null>(null);
  const [availableJobs, setAvailableJobs] = React.useState<AvailableJob[]>([]);
  const [activeJob, setActiveJob] = React.useState<WorkerJob | null>(null);
  const [recentJobs, setRecentJobs] = React.useState<WorkerJob[]>([]);
  const [activeJobDetails, setActiveJobDetails] = React.useState<WorkerJobDetails | null>(null);
  const [todayAttendance, setTodayAttendance] = React.useState<AttendanceRecord | null>(null);
  const [currentLocationAddress, setCurrentLocationAddress] = React.useState("");
  const [loading, setLoading] = React.useState({ profile: true, jobs: true, currentJob: true, attendance: true });
  const [errors, setErrors] = React.useState({ profile: "", jobs: "", currentJob: "", attendance: "" });
  const watcherIdRef = React.useRef<number | null>(null);
  const lastLiveLocationRef = React.useRef<LiveLocationSnapshot | null>(null);
  const lastLocationWarningAtRef = React.useRef(0);
  const jobsRefreshedAfterLiveLocationRef = React.useRef(false);

  React.useEffect(() => {
    if (!isLoading && !user) router.push("/worker/auth");
    if (!isLoading && user && nextStep !== "DASHBOARD") router.push(nextStep === "WORKER_PROFILE" ? "/worker/onboarding" : "/worker/auth");
  }, [isLoading, nextStep, router, user]);

  const loadProfile = React.useCallback(async () => {
    setLoading((current) => ({ ...current, profile: true }));
    setErrors((current) => ({ ...current, profile: "" }));
    try {
      const response = await apiClient.get<WorkerProfile>("/api/v1/workers/me");
      setProfile(response.data);
      setCurrentLocationAddress(response.data.address || [response.data.city, response.data.state].filter(Boolean).join(", "));
    } catch {
      setErrors((current) => ({ ...current, profile: "Unable to load your profile summary." }));
    } finally {
      setLoading((current) => ({ ...current, profile: false }));
    }
  }, []);

  const loadAvailableJobs = React.useCallback(async () => {
    setLoading((current) => ({ ...current, jobs: true }));
    setErrors((current) => ({ ...current, jobs: "" }));
    try {
      const response = await apiClient.get<{ jobs: AvailableJob[] }>("/api/v1/workers/me/available-jobs");
      setAvailableJobs((response.data.jobs || []).slice(0, 3));
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setErrors((current) => ({ ...current, jobs: detail === "CURRENT_LOCATION_REQUIRED" ? "Location unavailable. Nearby work could not be updated." : "Nearby work could not be loaded." }));
    } finally {
      setLoading((current) => ({ ...current, jobs: false }));
    }
  }, []);

  const loadCurrentWork = React.useCallback(async () => {
    setLoading((current) => ({ ...current, currentJob: true }));
    setErrors((current) => ({ ...current, currentJob: "" }));
    try {
      const response = await apiClient.get<{ active_job?: WorkerJob | null; recent_jobs?: WorkerJob[] }>("/api/v1/workers/me/jobs");
      const currentJob = response.data.active_job || null;
      setActiveJob(currentJob);
      setRecentJobs(response.data.recent_jobs || []);
      if (currentJob) {
        try {
          const detailResponse = await apiClient.get<WorkerJobDetails>(`/api/v1/workers/me/jobs/${currentJob.job_id}`);
          setActiveJobDetails(detailResponse.data);
        } catch {
          setActiveJobDetails(null);
        }
      } else {
        setActiveJobDetails(null);
      }
    } catch {
      setErrors((current) => ({ ...current, currentJob: "Unable to load your work summary." }));
    } finally {
      setLoading((current) => ({ ...current, currentJob: false }));
    }
  }, []);

  const loadAttendance = React.useCallback(async () => {
    setLoading((current) => ({ ...current, attendance: true }));
    setErrors((current) => ({ ...current, attendance: "" }));
    try {
      const response = await apiClient.get<{ items: AttendanceRecord[] }>("/api/v1/workers/me/attendance/today");
      setTodayAttendance(response.data.items?.[0] || null);
    } catch {
      setErrors((current) => ({ ...current, attendance: "Unable to load today's attendance." }));
    } finally {
      setLoading((current) => ({ ...current, attendance: false }));
    }
  }, []);

  React.useEffect(() => {
    if (!user || user.role !== "WORKER" || isLoading || nextStep !== "DASHBOARD") return;
    void Promise.resolve().then(() => Promise.all([
      loadProfile(),
      loadAvailableJobs(),
      loadCurrentWork(),
      loadAttendance(),
    ]));
  }, [isLoading, loadAttendance, loadAvailableJobs, loadCurrentWork, loadProfile, nextStep, user]);

  React.useEffect(() => {
    if (!user || user.role !== "WORKER" || typeof navigator === "undefined" || !navigator.geolocation || watcherIdRef.current !== null) return;

    const onPosition = (position: GeolocationPosition) => {
      const normalized = normalizeCoordinates(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
      if (!normalized) {
        const now = Date.now();
        if (now - lastLocationWarningAtRef.current >= 30000) {
          lastLocationWarningAtRef.current = now;
          toast.error(getLocationErrorMessage({ code: "INACCURATE", accuracy: position.coords.accuracy }));
        }
        return;
      }

      const next: LiveLocationSnapshot = { latitude: normalized.latitude, longitude: normalized.longitude, accuracy_m: normalized.accuracy, updated_at: Date.now() };
      if (!shouldSendLiveLocationUpdate(lastLiveLocationRef.current, next)) return;
      lastLiveLocationRef.current = next;
      apiClient.put<{ address?: string | null }>("/api/v1/workers/me/location", {
        latitude: next.latitude,
        longitude: next.longitude,
        accuracy_m: next.accuracy_m,
      }).then((response) => {
        if (response.data.address) setCurrentLocationAddress(response.data.address);
        if (!jobsRefreshedAfterLiveLocationRef.current) {
          jobsRefreshedAfterLiveLocationRef.current = true;
          void loadAvailableJobs();
        }
      }).catch(() => {
        // The backend remains authoritative; the next valid position retries the update.
      });
    };

    const onError = (error: GeolocationPositionError) => {
      const now = Date.now();
      if (now - lastLocationWarningAtRef.current >= 30000) {
        lastLocationWarningAtRef.current = now;
        toast.error(getLocationErrorMessage(error));
      }
    };

    watcherIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 300000,
      timeout: 30000,
    });

    return () => {
      if (watcherIdRef.current !== null) navigator.geolocation.clearWatch(watcherIdRef.current);
      watcherIdRef.current = null;
      lastLiveLocationRef.current = null;
    };
  }, [loadAvailableJobs, user]);

  if (isLoading || !user) return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950"><Loader2 size={40} className="animate-spin text-blue-600" /></div>;

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
      toast.success("Logged out successfully");
    } catch {
      toast.error("Logout failed");
    }
  };

  const location = currentLocationAddress || profile?.address || [profile?.city, profile?.state].filter(Boolean).join(", ");
  const subscriptionActive = isSubscriptionActive(profile?.subscription_valid_until);
  const completedJobCount = recentJobs.length;
  const companiesWorkedCount = new Set(recentJobs.map((job) => job.employer_name).filter(Boolean)).size;

  return (
    <AccountManagementShell kind="worker" name={user.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void handleLogout()}>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="rounded-3xl bg-linear-to-br from-amber-50 to-yellow-50 p-5 sm:p-8 dark:from-amber-950/20 dark:to-yellow-950/20">
          <div className="flex flex-col-reverse items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Welcome back</p><h1 className="mt-1 font-(--font-anton) text-3xl uppercase text-slate-900 dark:text-white">{user.name}</h1><p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Here is your work overview.</p></div>
            <Link href="/worker/profile" className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-amber-400 text-white shadow-lg" title="View profile">
              {user.profile_photo_url ? <Image src={user.profile_photo_url} alt="Profile" width={64} height={64} className="h-full w-full object-cover" unoptimized /> : <User size={32} />}
            </Link>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="font-bold">Profile completion</h2><User size={20} className="text-blue-600" /></div><SectionState loading={loading.profile} error={errors.profile} retry={loadProfile}><p className="mt-5 text-2xl font-bold">{profile?.profile_completed ? "Complete" : "Incomplete"}</p></SectionState></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="font-bold">Availability</h2><CheckCircle2 size={20} className="text-emerald-600" /></div><SectionState loading={loading.profile} error={errors.profile} retry={loadProfile}><p className="mt-5 text-2xl font-bold">{profile?.availability_status || "-"}</p></SectionState></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="font-bold">Subscription</h2><CheckCircle2 size={20} className={subscriptionActive ? "text-emerald-600" : "text-amber-600"} /></div><SectionState loading={loading.profile} error={errors.profile} retry={loadProfile}><p className="mt-5 text-2xl font-bold">{subscriptionActive ? "Active" : "No active subscription"}</p>{subscriptionActive && <p className="mt-1 text-sm text-slate-500">Expires {formatDate(profile?.subscription_valid_until)}</p>}</SectionState></section>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Matching</p><h2 className="mt-1 text-xl font-bold">Nearby work</h2></div><span className="text-sm text-slate-500">{availableJobs.length ? "Showing up to 3" : ""}</span></div><SectionState loading={loading.jobs} error={errors.jobs} retry={loadAvailableJobs} errorAction={errors.jobs === "Location unavailable. Nearby work could not be updated." && <Link href="/worker/profile" className="mt-4 inline-block font-bold text-blue-700">Add location in Profile</Link>}>{availableJobs.length ? <div className="mt-5 space-y-3">{availableJobs.map((job) => <article key={job.job_id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{job.title}</h3><p className="mt-1 text-sm text-slate-500">{job.employer_name}</p></div><MapPin size={18} className="text-blue-600" /></div><div className="mt-3 flex flex-wrap gap-4 text-sm"><span>₹{job.salary}/day</span><span>{job.distance_km == null ? "Distance unavailable" : `${job.distance_km} km`}</span></div></article>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No matching jobs nearby.</div>}</SectionState></section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Current work</p><h2 className="mt-1 text-xl font-bold">Accepted job</h2></div><Briefcase size={20} className="text-blue-600" /></div><SectionState loading={loading.currentJob} error={errors.currentJob} retry={loadCurrentWork}>{activeJob ? <div className="mt-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><h3 className="font-bold">{activeJob.title}</h3><p className="mt-1 text-sm text-slate-500">{activeJob.employer_name || "Employer unavailable"}</p><p className="mt-2 text-sm">Status: <strong>{activeJob.status}</strong></p>{activeJobDetails?.site_name && <p className="mt-1 text-sm text-slate-500">Site: {activeJobDetails.site_name}</p>}</div> : <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No active work right now.</div>}</SectionState></section>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="font-bold">Today&apos;s work</h2><Clock3 size={20} className="text-blue-600" /></div><SectionState loading={loading.attendance} error={errors.attendance} retry={loadAttendance}>{todayAttendance ? <div className="mt-5"><p className="text-lg font-bold">{todayAttendance.status}</p><p className="mt-1 text-sm text-slate-500">{todayAttendance.job_title} · {todayAttendance.site_name}</p><p className="mt-3 text-sm">Check-in: {formatTime(todayAttendance.check_in_at)}</p>{todayAttendance.check_out_at && <p className="text-sm">Check-out: {formatTime(todayAttendance.check_out_at)}</p>}</div> : <p className="mt-5 text-sm text-slate-500">No attendance recorded today.</p>}</SectionState></section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="font-bold">Work history</h2><CheckCircle2 size={20} className="text-emerald-600" /></div><SectionState loading={loading.currentJob} error={errors.currentJob} retry={loadCurrentWork}>{recentJobs.length ? <div className="mt-5 grid grid-cols-2 gap-4"><div><p className="text-xs uppercase tracking-wide text-slate-400">Completed jobs</p><p className="mt-1 text-2xl font-bold">{completedJobCount}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-400">Companies worked with</p><p className="mt-1 text-2xl font-bold">{companiesWorkedCount}</p></div></div> : <p className="mt-5 text-sm text-slate-500">No completed work records yet.</p>}</SectionState></section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="font-bold">Current location</h2><MapPin size={20} className="text-blue-600" /></div><SectionState loading={loading.profile} error={errors.profile} retry={loadProfile}>{profile?.latitude != null && profile.longitude != null ? <><p className="mt-5 text-sm font-semibold">{location || "Current location available"}</p><p className="mt-1 text-xs text-slate-500">Used for matching and attendance checks.</p></> : <><p className="mt-5 text-sm text-slate-500">Location unavailable</p><Link href="/worker/profile" className="mt-3 inline-block text-sm font-bold text-blue-700">Add location in Profile</Link></>}</SectionState></section>
        </div>

      </main>
    </AccountManagementShell>
  );
}
