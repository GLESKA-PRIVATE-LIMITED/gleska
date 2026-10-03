"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { CheckCircle2, Loader2, MapPin, RefreshCw, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import AccountManagementShell from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";
import axios from "axios";
import apiClient from "@/lib/api";
import {
  getLocationErrorCategory,
  InaccurateLocationError,
  watchBrowserLocation,
} from "@/lib/location";
import { formatSubscriptionExpiry } from "@/lib/subscription";

type WorkerProfile = {
  profile_completed: boolean;
  availability_status: "AVAILABLE" | "ON_JOB" | "OFFLINE";
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  current_location?: {
    latitude: number;
    longitude: number;
    accuracy_m: number;
    address?: string | null;
    location_source: "GPS" | "PROFILE";
    updated_at: string;
  } | null;
  subscription_valid_until?: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_active?: boolean;
  subscription_active?: boolean;
  trial_days_remaining?: number;
};

type AvailableJob = {
  job_id: string;
  title: string;
  salary: number;
  employer_name: string;
  distance_km: number | null;
};

type JobDetails = {
  job_id: string;
  match_id: string;
  title: string;
  employer_name?: string | null;
  site_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  salary: number;
  headcount: number;
  min_experience?: number | null;
  required_skills?: string[];
  work_duration_days?: number | null;
  work_timing?: string | null;
  status: string;
  target_lat?: number | null;
  target_lng?: number | null;
};

const MATCHING_LOCATION_REQUIRED = "A sufficiently accurate current location (within 1 km) is required to find nearby work. Try again with device location enabled or use a device with GPS.";

function SectionState({ loading, error, retry, errorAction, children }: { loading: boolean; error: string; retry?: () => void; errorAction?: React.ReactNode; children: React.ReactNode }) {
  if (loading) return <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" /> Loading...</div>;
  if (error) return <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/20 dark:text-rose-300"><p>{error}</p>{errorAction}{retry && <button type="button" onClick={retry} className="mt-3 block font-bold underline">Try again</button>}</div>;
  return <>{children}</>;
}

export default function WorkerDashboard() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [profile, setProfile] = React.useState<WorkerProfile | null>(null);
  const [availableJobs, setAvailableJobs] = React.useState<AvailableJob[]>([]);
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [selectedJob, setSelectedJob] = React.useState<JobDetails | null>(null);
  const [selectedJobDistance, setSelectedJobDistance] = React.useState<number | null>(null);
  const [jobDetailsLoading, setJobDetailsLoading] = React.useState(false);
  const [jobDetailsError, setJobDetailsError] = React.useState("");
  const [currentLocationAddress, setCurrentLocationAddress] = React.useState("");
  const [displayLocation, setDisplayLocation] = React.useState<{ accuracy: number; receivedAt: number } | null>(null);
  const [addressLookupUnavailable, setAddressLookupUnavailable] = React.useState(false);
  const [locationStatus, setLocationStatus] = React.useState<"acquiring" | "ready" | "error">("acquiring");
  const [matchingReady, setMatchingReady] = React.useState(false);
  const [loading, setLoading] = React.useState({ profile: true, jobs: true });
  const [errors, setErrors] = React.useState({ profile: "", jobs: "" });
  const matchingReadyRef = React.useRef(false);
  const displayAccuracyRef = React.useRef<number | null>(null);
  const reverseGeocodeRequestRef = React.useRef(0);

  React.useEffect(() => {
    if (!isLoading && !user) router.replace("/worker/auth");
    if (!isLoading && user && user.role === "WORKER" && nextStep !== "DASHBOARD") router.replace("/worker/dashboard");
  }, [isLoading, nextStep, router, user]);

  const loadAvailableJobs = React.useCallback(async () => {
    if (!matchingReadyRef.current) return;
    setLoading((current) => ({ ...current, jobs: true }));
    setErrors((current) => ({ ...current, jobs: "" }));
    try {
      const response = await apiClient.get<{ jobs: AvailableJob[] }>("/api/v1/workers/me/available-jobs");
      setAvailableJobs((response.data.jobs || []).slice(0, 3));
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } }).response?.status;
      const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      if (status === 402 || detail === "SUBSCRIPTION_REQUIRED") {
        setErrors((current) => ({ ...current, jobs: "Your worker subscription is inactive. Subscribe for ₹200/month to access nearby jobs." }));
      } else if (detail === "CURRENT_LOCATION_REQUIRED") {
        setErrors((current) => ({
          ...current,
          jobs: matchingReadyRef.current
            ? "Your current location no longer meets the accuracy or freshness requirements for nearby work. Wait for a new accurate location, then try again."
            : MATCHING_LOCATION_REQUIRED,
        }));
      } else {
        setErrors((current) => ({ ...current, jobs: "Nearby work could not be loaded." }));
      }
    } finally {
      setLoading((current) => ({ ...current, jobs: false }));
    }
  }, []);

  const loadProfile = React.useCallback(async () => {
    setLoading((current) => ({ ...current, profile: true }));
    setErrors((current) => ({ ...current, profile: "" }));
    try {
      const response = await apiClient.get<WorkerProfile>("/api/v1/workers/me");
      setProfile(response.data);
    } catch {
      setErrors((current) => ({ ...current, profile: "Unable to load your profile summary." }));
    } finally {
      setLoading((current) => ({ ...current, profile: false }));
    }
  }, []);

  const loadJobDetails = React.useCallback(async (job: AvailableJob) => {
    setSelectedJobId(job.job_id);
    setSelectedJob(null);
    setSelectedJobDistance(job.distance_km);
    setJobDetailsError("");
    setJobDetailsLoading(true);
    try {
      const response = await apiClient.get<JobDetails>(`/api/v1/workers/me/jobs/${encodeURIComponent(job.job_id)}`);
      setSelectedJob(response.data);
    } catch {
      setJobDetailsError("Unable to load this job right now.");
    } finally {
      setJobDetailsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!user || user.role !== "WORKER" || isLoading || nextStep !== "DASHBOARD") return;
    void Promise.resolve().then(loadProfile);
  }, [isLoading, loadProfile, nextStep, user]);

  React.useEffect(() => {
    if (!user || user.role !== "WORKER" || isLoading || nextStep !== "DASHBOARD") return;
    const refresh = () => {
      void loadProfile();
      if (locationStatus === "ready") void loadAvailableJobs();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isLoading, loadAvailableJobs, loadProfile, locationStatus, nextStep, user]);

  React.useEffect(() => {
    if (!user || user.role !== "WORKER" || isLoading || nextStep !== "DASHBOARD") return;
    let active = true;
    const controller = new AbortController();
    const onPosition = (location: { latitude: number; longitude: number; accuracy: number }) => {
      if (!active || (displayAccuracyRef.current !== null && location.accuracy >= displayAccuracyRef.current)) return;
      displayAccuracyRef.current = location.accuracy;
      setDisplayLocation({ accuracy: location.accuracy, receivedAt: Date.now() });
      setCurrentLocationAddress("");
      setAddressLookupUnavailable(false);
      const requestId = ++reverseGeocodeRequestRef.current;
      void apiClient.get<{ address: string }>("/api/v1/locations/reverse", {
        params: { latitude: location.latitude, longitude: location.longitude },
      }).then((response) => {
        if (active && reverseGeocodeRequestRef.current === requestId) {
          setCurrentLocationAddress(response.data.address || "");
          setAddressLookupUnavailable(!response.data.address);
        }
      }).catch(() => {
        if (active && reverseGeocodeRequestRef.current === requestId) {
          setAddressLookupUnavailable(true);
        }
      });
    };

    void watchBrowserLocation({ policy: "MATCHING", signal: controller.signal, onPosition }).then((location) => {
      if (!active) return;
      setLoading((current) => ({ ...current, jobs: true }));
      return apiClient.put<NonNullable<WorkerProfile["current_location"]>>("/api/v1/workers/me/location", {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy_m: location.accuracy,
        location_source: "GPS",
      });
    }).then((response) => {
      if (!active || !response) return;
      setLocationStatus("ready");
      matchingReadyRef.current = true;
      setMatchingReady(true);
      if (response.data.address) setCurrentLocationAddress(response.data.address);
      void loadAvailableJobs();
    }).catch((error: unknown) => {
      if (!active || controller.signal.aborted) return;
      setLocationStatus("error");
      setLoading((current) => ({ ...current, jobs: false }));
      if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        setErrors((current) => ({
          ...current,
          jobs: typeof detail === "string" && detail.length > 0
            ? `Unable to save your current location: ${detail}`
            : "Unable to save your current location. Nearby work could not be loaded.",
        }));
        return;
      }

      const category = getLocationErrorCategory(error);
      const message = category === "INACCURATE_LOCATION" && error instanceof InaccurateLocationError
        ? `${MATCHING_LOCATION_REQUIRED} The latest reported accuracy was ${Math.round(error.accuracy)} m.`
        : category === "PERMISSION_DENIED"
          ? "Location permission was denied. Enable location access to find nearby work."
          : category === "LOCATION_UNAVAILABLE"
            ? "Location services are unsupported or unavailable on this device."
            : category === "POSITION_UNAVAILABLE"
              ? "Your device could not determine a location. Try again or use a device with GPS."
              : category === "INVALID_COORDINATES"
                ? "The browser returned invalid coordinates. Nearby work requires a valid current location."
                : `Timed out waiting for a sufficiently accurate location. Accuracy within 1 km is required for nearby work.`;
      setErrors((current) => ({ ...current, jobs: message }));
    });

    return () => {
      active = false;
      controller.abort();
      displayAccuracyRef.current = null;
      reverseGeocodeRequestRef.current += 1;
    };
  }, [isLoading, loadAvailableJobs, nextStep, user]);

  if (isLoading || !user) return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950"><Loader2 size={40} className="animate-spin text-blue-600" /></div>;

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Logged out successfully");
    } catch {
      toast.error("Logout failed");
    }
  };

  const savedProfileAddress = [profile?.address, profile?.city, profile?.state]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
  const hasLiveGpsLocation = displayLocation !== null;
  const displayAccuracyLabel = displayLocation
    ? displayLocation.accuracy >= 1000
      ? `${(displayLocation.accuracy / 1000).toFixed(1)} km`
      : `${Math.round(displayLocation.accuracy)} m`
    : "";
  const subscriptionActive = profile?.subscription_active === true;
  const trialActive = profile?.trial_active === true;
  const subscriptionExpiry =
    formatSubscriptionExpiry(profile?.subscription_valid_until) ||
    formatSubscriptionExpiry(profile?.trial_ends_at);

  return (
    <AccountManagementShell kind="worker" name={user.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void handleLogout()}>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="rounded-3xl bg-linear-to-br from-amber-50 to-yellow-50 p-5 sm:p-8 dark:from-amber-950/20 dark:to-yellow-950/20">
          <div className="flex flex-col-reverse items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Welcome back</p><h1 className="mt-1 font-(--font-anton) text-3xl uppercase text-slate-900 dark:text-white">{user.name}</h1><p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Here is your work overview.</p>{profile?.profile_completed === false && <p className="mt-3 text-xs font-semibold text-slate-500">Profile completion in progress</p>}</div>
            <Link href="/worker/profile" className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-amber-400 text-white shadow-lg" title="View profile">
              {user.profile_photo_url ? <Image src={user.profile_photo_url} alt="Profile" width={64} height={64} className="h-full w-full object-cover" unoptimized /> : <User size={32} />}
            </Link>
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="font-bold">Availability</h2><CheckCircle2 size={20} className="text-emerald-600" /></div><SectionState loading={loading.profile} error={errors.profile} retry={loadProfile}><p className="mt-5 text-2xl font-bold">{profile?.availability_status || "-"}</p></SectionState></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="font-bold">Subscription</h2><CheckCircle2 size={20} className={subscriptionActive ? "text-emerald-600" : "text-amber-600"} /></div><SectionState loading={loading.profile} error={errors.profile} retry={loadProfile}><p className="mt-5 text-2xl font-bold">{subscriptionActive ? (trialActive ? "FREE TRIAL ACTIVE" : "Active") : profile?.subscription_valid_until || profile?.trial_ends_at ? "Not Active" : "Not Active"}</p>{subscriptionActive ? <p className="mt-1 text-sm text-slate-500">{trialActive ? "1 Month Free Trial" : "Worker / Employee · ₹200 / month"}</p> : <p className="mt-1 text-sm text-slate-500">Worker / Employee · ₹200 / month</p>}{subscriptionExpiry && <p className="mt-1 text-sm text-slate-500">{trialActive ? "Active until " : "Expires "}{subscriptionExpiry}</p>}{!subscriptionActive && <Link href="/worker/subscription" className="mt-3 inline-block text-sm font-bold text-blue-700">Renew Subscription</Link>}</SectionState></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3"><h2 className="font-bold">{hasLiveGpsLocation ? "Current location" : "Your address"}</h2><MapPin size={20} className="text-blue-600" /></div>
            {hasLiveGpsLocation && <p className="mt-1 text-xs text-slate-500">
              {matchingReady
                ? "Used to find nearby work"
                : displayLocation.accuracy > 1000
                  ? "Display location only; matching requires accuracy within 1 km"
                  : "Checking this location for nearby-work matching"}
            </p>}
            <p className="mt-4 wrap-break-word text-sm font-semibold leading-6" role="status">
              {hasLiveGpsLocation
                ? currentLocationAddress || (addressLookupUnavailable ? "Current location detected; address lookup unavailable." : "Current location detected.")
                : savedProfileAddress || "Add a permanent address to your profile."}
            </p>
            {profile?.pincode && !hasLiveGpsLocation && <p className="mt-1 text-xs text-slate-500">PIN: {profile.pincode}</p>}
            {hasLiveGpsLocation && <p className="mt-2 text-xs text-slate-500">Browser accuracy: about {displayAccuracyLabel} · received just now</p>}
          </section>
        </div>

        <section>
          <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Matching</p><h2 className="mt-1 text-xl font-bold">Nearby work</h2></div><span className="text-sm text-slate-500">Showing up to 3</span></div>
          <SectionState loading={loading.jobs} error={errors.jobs} retry={matchingReady ? loadAvailableJobs : undefined} errorAction={errors.jobs.includes("subscription") ? <Link href="/worker/subscription" className="mt-4 inline-flex items-center gap-1 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-600 transition">Subscribe / Renew (₹200/mo)</Link> : undefined}>
              {availableJobs.length ? <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{availableJobs.map((job) => <article key={job.job_id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{job.title}</h3><p className="mt-1 text-sm text-slate-500">{job.employer_name}</p></div><MapPin size={18} className="shrink-0 text-blue-600" /></div><div className="mt-4 flex flex-wrap gap-4 text-sm"><span>{job.salary > 0 ? `₹${job.salary}/day` : "Daily wage not specified"}</span><span>{job.distance_km == null ? "Distance unavailable" : `${job.distance_km} km`}</span></div><button type="button" onClick={() => void loadJobDetails(job)} className="mt-5 inline-flex text-sm font-bold text-blue-700 hover:text-blue-800">View Details</button></article>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No suitable nearby jobs found</div>}
            </SectionState>
        </section>
      </main>
      {selectedJobId && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedJobId(null); }}><section role="dialog" aria-modal="true" aria-labelledby="worker-job-details-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Job details</p><h2 id="worker-job-details-title" className="mt-1 text-2xl font-bold">{selectedJob?.title || "Loading job details"}</h2></div><button type="button" onClick={() => setSelectedJobId(null)} aria-label="Close job details" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button></div>{jobDetailsLoading ? <div className="flex items-center gap-2 py-12 text-sm text-slate-500"><Loader2 size={20} className="animate-spin" /> Loading job details...</div> : jobDetailsError ? <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700"><p>{jobDetailsError}</p><button type="button" onClick={() => { const job = availableJobs.find((item) => item.job_id === selectedJobId); if (job) void loadJobDetails(job); }} className="mt-3 inline-flex items-center gap-2 font-bold underline"><RefreshCw size={16} /> Try again</button></div> : selectedJob ? <div className="mt-6 space-y-6 text-sm"><div className="rounded-2xl bg-amber-50 p-4 dark:bg-amber-950/20"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{selectedJob.title}</p><p className="mt-1 text-slate-600 dark:text-slate-300">{selectedJob.employer_name || "Employer unavailable"}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase text-slate-700 dark:bg-slate-900 dark:text-slate-200">{selectedJob.status}</span></div></div><div><h3 className="font-bold">Work site</h3><p className="mt-2 font-semibold">{selectedJob.site_name || "Site unavailable"}</p><p className="mt-1 wrap-break-word text-slate-500">{[selectedJob.address, selectedJob.city, selectedJob.state].filter(Boolean).join(", ") || "Address unavailable"}</p><p className="mt-2 flex items-center gap-2 text-slate-500"><MapPin size={16} />{selectedJob.target_lat != null && selectedJob.target_lng != null ? "Location available" : "Location unavailable"}</p></div><div><h3 className="font-bold">Requirements</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-slate-500">Workers needed</dt><dd className="font-semibold">{selectedJob.headcount}</dd></div><div><dt className="text-slate-500">Workers remaining</dt><dd className="font-semibold">Not available from current response</dd></div><div><dt className="text-slate-500">Minimum experience</dt><dd className="font-semibold">{selectedJob.min_experience != null ? `${selectedJob.min_experience} years` : "Not specified"}</dd></div><div><dt className="text-slate-500">Daily wage</dt><dd className="font-semibold">{selectedJob.salary > 0 ? `₹${selectedJob.salary}/day` : "Not specified"}</dd></div></dl>{selectedJob.required_skills?.length ? <div className="mt-4"><p className="font-semibold">Required skills</p><ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">{selectedJob.required_skills.map((skill) => <li key={skill}>{skill}</li>)}</ul></div> : <p className="mt-4 text-slate-500">Required skills: Not specified</p>}</div><div><h3 className="font-bold">Work details</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-slate-500">Work duration</dt><dd className="font-semibold">{selectedJob.work_duration_days != null ? `${selectedJob.work_duration_days} days` : "Not specified"}</dd></div><div><dt className="text-slate-500">Daily timing</dt><dd className="font-semibold">{selectedJob.work_timing || "Not specified"}</dd></div></dl></div><div><h3 className="font-bold">Distance</h3><p className="mt-2 font-semibold">{selectedJobDistance == null ? "Distance unavailable" : `${selectedJobDistance} km away`}</p></div></div> : null}</section></div>}
    </AccountManagementShell>
  );
}