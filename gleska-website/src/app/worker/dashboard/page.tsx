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
import { MAX_LOCATION_ACCURACY_METERS, retainAccurateLocationSnapshot, shouldSendLiveLocationUpdate, type LiveLocationSnapshot } from "@/lib/location";
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

const CURRENT_LOCATION_REQUIRED = "Select a current location to find nearby work.";

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
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [selectedJob, setSelectedJob] = React.useState<JobDetails | null>(null);
  const [selectedJobDistance, setSelectedJobDistance] = React.useState<number | null>(null);
  const [jobDetailsLoading, setJobDetailsLoading] = React.useState(false);
  const [jobDetailsError, setJobDetailsError] = React.useState("");
  const [currentLocationAddress, setCurrentLocationAddress] = React.useState("");
  const [currentLocationSource, setCurrentLocationSource] = React.useState<"GPS" | "PROFILE" | null>(null);
  const [locationStatus, setLocationStatus] = React.useState<"acquiring" | "ready" | "error">("acquiring");
  const [selectingProfileLocation, setSelectingProfileLocation] = React.useState(false);
  const [loading, setLoading] = React.useState({ profile: true, jobs: true });
  const [errors, setErrors] = React.useState({ profile: "", jobs: "" });
  const watcherIdRef = React.useRef<number | null>(null);
  const locationTimeoutRef = React.useRef<number | null>(null);
  const lastLiveLocationRef = React.useRef<LiveLocationSnapshot | null>(null);
  const locationUpdatePendingRef = React.useRef(false);
  const locationWriteVersionRef = React.useRef(0);
  const currentLocationSourceRef = React.useRef<"GPS" | "PROFILE" | null>(null);

  React.useEffect(() => {
    if (!isLoading && !user) router.replace("/worker/auth");
    if (!isLoading && user && user.role === "WORKER" && nextStep !== "DASHBOARD") router.replace("/worker/dashboard");
  }, [isLoading, nextStep, router, user]);

  const loadAvailableJobs = React.useCallback(async () => {
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
        setErrors((current) => ({ ...current, jobs: CURRENT_LOCATION_REQUIRED }));
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
    const locationWriteVersion = locationWriteVersionRef.current;
    try {
      const response = await apiClient.get<WorkerProfile>("/api/v1/workers/me");
      setProfile(response.data);
      if (response.data.current_location && locationWriteVersion === locationWriteVersionRef.current) {
        setCurrentLocationAddress(response.data.current_location.address || "");
        setCurrentLocationSource(response.data.current_location.location_source);
        currentLocationSourceRef.current = response.data.current_location.location_source;
        setLocationStatus("ready");
        void loadAvailableJobs();
      }
    } catch {
      setErrors((current) => ({ ...current, profile: "Unable to load your profile summary." }));
    } finally {
      setLoading((current) => ({ ...current, profile: false }));
    }
  }, [loadAvailableJobs]);

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
    let permissionStatus: PermissionStatus | null = null;

    const clearLocationAcquisition = () => {
      active = false;
      if (locationTimeoutRef.current !== null) window.clearTimeout(locationTimeoutRef.current);
      locationTimeoutRef.current = null;
      if (watcherIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watcherIdRef.current);
      }
      watcherIdRef.current = null;
      if (permissionStatus) permissionStatus.onchange = null;
    };

    const setAcquisitionError = () => {
      clearLocationAcquisition();
      locationUpdatePendingRef.current = false;
      setLocationStatus("error");
      if (!currentLocationSourceRef.current) {
        setErrors((current) => ({ ...current, jobs: CURRENT_LOCATION_REQUIRED }));
      }
      setLoading((current) => ({ ...current, jobs: false }));
    };

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setAcquisitionError();
      return;
    }

    let lastInaccurateReading: number | null = null;
    let locationCallbackNumber = 0;

    const onPosition = (position: GeolocationPosition) => {
      if (!active) return;
      const callback = ++locationCallbackNumber;
      const { latitude, longitude, accuracy } = position.coords;
      const timestamp = position.timestamp;
      const ageMs = Date.now() - timestamp;
      const traceCallback = (status: "ACCEPTED" | "REJECTED", reason: string) => {
        console.debug("[Location Trace][Frontend]", {
          callback,
          lat: latitude,
          lng: longitude,
          accuracy_m: accuracy,
          timestamp,
          age_ms: ageMs,
          status,
          reason,
        });
      };
      const current = lastLiveLocationRef.current;
      if (accuracy > MAX_LOCATION_ACCURACY_METERS) {
        lastInaccurateReading = accuracy;
        setLocationStatus("acquiring");
        traceCallback("REJECTED", "accuracy_above_threshold");
        return;
      }
      const next = retainAccurateLocationSnapshot(
        current,
        latitude,
        longitude,
        accuracy,
        Date.now(),
      );
      if (!next) {
        traceCallback("REJECTED", "invalid_coordinates_or_accuracy");
        return;
      }
      if (next === current) {
        traceCallback("REJECTED", "unchanged_location_snapshot");
        return;
      }
      if (!shouldSendLiveLocationUpdate(current, next)) {
        traceCallback("REJECTED", "movement_or_heartbeat_update_not_due");
        return;
      }
      if (locationUpdatePendingRef.current) {
        traceCallback("REJECTED", "location_request_already_pending");
        return;
      }
      if (locationTimeoutRef.current !== null) window.clearTimeout(locationTimeoutRef.current);
      locationTimeoutRef.current = null;
      setCurrentLocationAddress("");
      locationUpdatePendingRef.current = true;
      locationWriteVersionRef.current += 1;
      traceCallback("ACCEPTED", "eligible_for_upload");
      console.debug("[Location Trace][HTTP OUT]", {
        lat: next.latitude,
        lng: next.longitude,
        accuracy_m: next.accuracy_m,
        source_context: "website_worker_dashboard",
        timestamp,
      });
      apiClient.put<NonNullable<WorkerProfile["current_location"]>>("/api/v1/workers/me/location", {
        latitude: next.latitude,
        longitude: next.longitude,
        accuracy_m: next.accuracy_m,
        location_source: "GPS",
      }).then((response) => {
        if (!active) return;
        console.debug("[Location Trace][HTTP IN]", {
          status: response.status,
          latitude: response.data.latitude,
          longitude: response.data.longitude,
          accuracy_m: response.data.accuracy_m,
          location_source: response.data.location_source,
          timestamp: response.data.updated_at,
          server_message: null,
        });
        locationUpdatePendingRef.current = false;
        lastLiveLocationRef.current = next;
        if (response.data.address) setCurrentLocationAddress(response.data.address);
        setCurrentLocationSource("GPS");
        currentLocationSourceRef.current = "GPS";
        setLocationStatus("ready");
        clearLocationAcquisition();
        void loadAvailableJobs();
      }).catch((error: unknown) => {
        if (!active) return;
        const response = axios.isAxiosError(error) ? error.response : undefined;
        const responseBody = response?.data as Record<string, unknown> | undefined;
        console.debug("[Location Trace][HTTP IN]", {
          status: response?.status ?? null,
          latitude: responseBody?.latitude ?? null,
          longitude: responseBody?.longitude ?? null,
          accuracy_m: responseBody?.accuracy_m ?? null,
          location_source: responseBody?.location_source ?? null,
          timestamp: responseBody?.updated_at ?? null,
          server_message: responseBody?.detail ?? null,
        });
        setAcquisitionError();
      });
    };

    const onError = (error: GeolocationPositionError) => {
      if (!active) return;
      if (error.code === error.PERMISSION_DENIED) {
        setAcquisitionError();
        return;
      }
      setLocationStatus("error");
    };

    const watchOptions: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000,
    };

    const startLocationWatch = () => {
      if (!active || watcherIdRef.current !== null) return;
      locationTimeoutRef.current = window.setTimeout(() => {
        setAcquisitionError();
      }, 60000);
      watcherIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, watchOptions);
    };

    if (typeof navigator.permissions?.query === "function") {
      void navigator.permissions.query({ name: "geolocation" }).then((permission) => {
        if (!active) return;
        permissionStatus = permission;
        permissionStatus.onchange = () => {
          if (!active || permissionStatus?.state !== "denied") return;
          setAcquisitionError();
        };
        if (permission.state === "denied") {
          setAcquisitionError();
          return;
        }
        startLocationWatch();
      }).catch(() => {
        startLocationWatch();
      });
    } else {
      startLocationWatch();
    }

    return () => {
      clearLocationAcquisition();
      lastLiveLocationRef.current = null;
      locationUpdatePendingRef.current = false;
    };
  }, [isLoading, loadAvailableJobs, nextStep, user]);

  const useProfileLocation = React.useCallback(async () => {
    if (
      profile?.latitude == null
      || profile.longitude == null
      || !Number.isFinite(profile.latitude)
      || !Number.isFinite(profile.longitude)
      || profile.latitude < -90
      || profile.latitude > 90
      || profile.longitude < -180
      || profile.longitude > 180
      || (profile.latitude === 0 && profile.longitude === 0)
      || locationUpdatePendingRef.current
    ) return;

    setSelectingProfileLocation(true);
    locationUpdatePendingRef.current = true;
    setErrors((current) => ({ ...current, jobs: "" }));
    setLoading((current) => ({ ...current, jobs: true }));
    locationWriteVersionRef.current += 1;
    try {
      const response = await apiClient.put<NonNullable<WorkerProfile["current_location"]>>(
        "/api/v1/workers/me/location",
        { location_source: "PROFILE" },
      );
      setCurrentLocationAddress(response.data.address || "");
      setCurrentLocationSource("PROFILE");
      currentLocationSourceRef.current = "PROFILE";
      setLocationStatus("ready");
      await loadAvailableJobs();
    } catch {
      setLocationStatus("error");
      setErrors((current) => ({ ...current, jobs: CURRENT_LOCATION_REQUIRED }));
      setLoading((current) => ({ ...current, jobs: false }));
    } finally {
      locationUpdatePendingRef.current = false;
      setSelectingProfileLocation(false);
    }
  }, [loadAvailableJobs, profile]);

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
  const hasProfileCoordinates = profile?.latitude != null
    && profile.longitude != null
    && Number.isFinite(profile.latitude)
    && Number.isFinite(profile.longitude)
    && !(profile.latitude === 0 && profile.longitude === 0);
  const showProfileLocationAction = hasProfileCoordinates
    && currentLocationSource !== "PROFILE"
    && (currentLocationSource === null || locationStatus === "error");
  const hasSelectedCurrentLocation = currentLocationSource === "PROFILE"
    || (currentLocationSource === "GPS" && locationStatus === "ready");
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
            <div className="flex items-center justify-between gap-3"><h2 className="font-bold">{hasSelectedCurrentLocation ? "Current location" : "Your address"}</h2><MapPin size={20} className="text-blue-600" /></div>
            {hasSelectedCurrentLocation && <p className="mt-1 text-xs text-slate-500">Used to find nearby work</p>}
            <p className="mt-4 wrap-break-word text-sm font-semibold leading-6" role="status">
              {currentLocationSource === "GPS" && locationStatus === "ready"
                ? currentLocationAddress || "Current location updated"
                : currentLocationSource === "PROFILE"
                  ? currentLocationAddress || savedProfileAddress || "Saved profile location"
                  : savedProfileAddress || "Add a permanent address to your profile."}
            </p>
            {profile?.pincode && !hasSelectedCurrentLocation && <p className="mt-1 text-xs text-slate-500">PIN: {profile.pincode}</p>}
            {currentLocationSource === "PROFILE" && <p className="mt-2 text-xs font-medium text-emerald-700">Current location selected</p>}
            {currentLocationSource === "GPS" && locationStatus === "ready" && <p className="mt-2 text-xs text-slate-500">Updated just now</p>}
            {showProfileLocationAction && <button type="button" onClick={() => void useProfileLocation()} disabled={selectingProfileLocation || locationUpdatePendingRef.current} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
              {selectingProfileLocation ? <><Loader2 size={16} className="animate-spin" /> Selecting location...</> : "Use this location as current"}
            </button>}
            {!hasProfileCoordinates && !currentLocationSource && savedProfileAddress && <p className="mt-3 text-xs text-slate-500">Add location coordinates to your profile to use this address as current.</p>}
          </section>
        </div>

        <section>
          <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Matching</p><h2 className="mt-1 text-xl font-bold">Nearby work</h2></div><span className="text-sm text-slate-500">Showing up to 3</span></div>
          {errors.jobs === CURRENT_LOCATION_REQUIRED
            ? <p className="mt-5 text-sm text-slate-500">{CURRENT_LOCATION_REQUIRED}</p>
            : <SectionState loading={loading.jobs} error={errors.jobs} retry={loadAvailableJobs} errorAction={errors.jobs.includes("subscription") ? <Link href="/worker/subscription" className="mt-4 inline-flex items-center gap-1 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-600 transition">Subscribe / Renew (₹200/mo)</Link> : undefined}>
              {availableJobs.length ? <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{availableJobs.map((job) => <article key={job.job_id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{job.title}</h3><p className="mt-1 text-sm text-slate-500">{job.employer_name}</p></div><MapPin size={18} className="shrink-0 text-blue-600" /></div><div className="mt-4 flex flex-wrap gap-4 text-sm"><span>{job.salary > 0 ? `₹${job.salary}/day` : "Daily wage not specified"}</span><span>{job.distance_km == null ? "Distance unavailable" : `${job.distance_km} km`}</span></div><button type="button" onClick={() => void loadJobDetails(job)} className="mt-5 inline-flex text-sm font-bold text-blue-700 hover:text-blue-800">View Details</button></article>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No suitable nearby jobs found</div>}
            </SectionState>}
        </section>
      </main>
      {selectedJobId && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedJobId(null); }}><section role="dialog" aria-modal="true" aria-labelledby="worker-job-details-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Job details</p><h2 id="worker-job-details-title" className="mt-1 text-2xl font-bold">{selectedJob?.title || "Loading job details"}</h2></div><button type="button" onClick={() => setSelectedJobId(null)} aria-label="Close job details" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button></div>{jobDetailsLoading ? <div className="flex items-center gap-2 py-12 text-sm text-slate-500"><Loader2 size={20} className="animate-spin" /> Loading job details...</div> : jobDetailsError ? <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700"><p>{jobDetailsError}</p><button type="button" onClick={() => { const job = availableJobs.find((item) => item.job_id === selectedJobId); if (job) void loadJobDetails(job); }} className="mt-3 inline-flex items-center gap-2 font-bold underline"><RefreshCw size={16} /> Try again</button></div> : selectedJob ? <div className="mt-6 space-y-6 text-sm"><div className="rounded-2xl bg-amber-50 p-4 dark:bg-amber-950/20"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{selectedJob.title}</p><p className="mt-1 text-slate-600 dark:text-slate-300">{selectedJob.employer_name || "Employer unavailable"}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase text-slate-700 dark:bg-slate-900 dark:text-slate-200">{selectedJob.status}</span></div></div><div><h3 className="font-bold">Work site</h3><p className="mt-2 font-semibold">{selectedJob.site_name || "Site unavailable"}</p><p className="mt-1 wrap-break-word text-slate-500">{[selectedJob.address, selectedJob.city, selectedJob.state].filter(Boolean).join(", ") || "Address unavailable"}</p><p className="mt-2 flex items-center gap-2 text-slate-500"><MapPin size={16} />{selectedJob.target_lat != null && selectedJob.target_lng != null ? "Location available" : "Location unavailable"}</p></div><div><h3 className="font-bold">Requirements</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-slate-500">Workers needed</dt><dd className="font-semibold">{selectedJob.headcount}</dd></div><div><dt className="text-slate-500">Workers remaining</dt><dd className="font-semibold">Not available from current response</dd></div><div><dt className="text-slate-500">Minimum experience</dt><dd className="font-semibold">{selectedJob.min_experience != null ? `${selectedJob.min_experience} years` : "Not specified"}</dd></div><div><dt className="text-slate-500">Daily wage</dt><dd className="font-semibold">{selectedJob.salary > 0 ? `₹${selectedJob.salary}/day` : "Not specified"}</dd></div></dl>{selectedJob.required_skills?.length ? <div className="mt-4"><p className="font-semibold">Required skills</p><ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">{selectedJob.required_skills.map((skill) => <li key={skill}>{skill}</li>)}</ul></div> : <p className="mt-4 text-slate-500">Required skills: Not specified</p>}</div><div><h3 className="font-bold">Work details</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-slate-500">Work duration</dt><dd className="font-semibold">{selectedJob.work_duration_days != null ? `${selectedJob.work_duration_days} days` : "Not specified"}</dd></div><div><dt className="text-slate-500">Daily timing</dt><dd className="font-semibold">{selectedJob.work_timing || "Not specified"}</dd></div></dl></div><div><h3 className="font-bold">Distance</h3><p className="mt-2 font-semibold">{selectedJobDistance == null ? "Distance unavailable" : `${selectedJobDistance} km away`}</p></div></div> : null}</section></div>}
    </AccountManagementShell>
  );
}