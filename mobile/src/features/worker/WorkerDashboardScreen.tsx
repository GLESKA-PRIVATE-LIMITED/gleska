import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, MapPin, RefreshCw, User, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { apiGet, apiPost, apiPut, ApiError } from "../../lib/api";
import { useRefreshOnFocus } from "../../lib/useRefreshOnFocus";
import WorkerMobileShell from "./WorkerMobileShell";

const MAX_LOCATION_ACCURACY_METERS = 1000;
const LIVE_LOCATION_UPDATE_INTERVAL_MS = 15000;
const MIN_LOCATION_MOVEMENT_METERS = 25;
const LOCATION_HEARTBEAT_MS = 60000;

type LiveLocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  updated_at: number;
  captured_at: number;
};

type NormalizedLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

function normalizeCoordinates(latitude: number, longitude: number, accuracy: number): NormalizedLocation | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (accuracy <= 0 || accuracy > MAX_LOCATION_ACCURACY_METERS) return null;
  return { latitude, longitude, accuracy };
}

function shouldSendLiveLocationUpdate(
  current: LiveLocationSnapshot | null,
  next: LiveLocationSnapshot,
  now = Date.now(),
): boolean {
  if (!current) return true;

  const timeDeltaMs = now - current.updated_at;
  const hasHeartbeat = timeDeltaMs >= LOCATION_HEARTBEAT_MS;
  const latitudeDeltaMeters = Math.abs((next.latitude - current.latitude) * 111_000);
  const longitudeDeltaMeters = Math.abs(
    (next.longitude - current.longitude) * 111_000 * Math.cos((next.latitude * Math.PI) / 180),
  );
  const movementMeters = Math.max(latitudeDeltaMeters, longitudeDeltaMeters);

  if (movementMeters < MIN_LOCATION_MOVEMENT_METERS && timeDeltaMs < LIVE_LOCATION_UPDATE_INTERVAL_MS && !hasHeartbeat) {
    return false;
  }

  return hasHeartbeat || movementMeters >= MIN_LOCATION_MOVEMENT_METERS;
}

function formatSubscriptionExpiry(value?: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

type WorkerProfile = {
  profile_completed: boolean;
  availability_status: "AVAILABLE" | "ON_JOB" | "OFFLINE";
  address?: string | null;
  city?: string | null;
  state?: string | null;
  current_location?: {
    accuracy_m: number;
    updated_at: string;
  } | null;
  latitude?: number | null;
  longitude?: number | null;
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

function SectionState({
  loading,
  error,
  retry,
  retryLabel = "Try again",
  errorAction,
  children,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  retryLabel?: string;
  errorAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="worker-dashboard-state">
        <Loader2 size={18} className="spin icon-secondary" />
        <span>Loading...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="worker-dashboard-error-card">
        <p className="worker-dashboard-error-text">{error}</p>
        {errorAction}
        <button type="button" onClick={retry} className="worker-retry-button">
          {retryLabel}
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

export default function WorkerDashboardScreen() {
  const { user, isLoading } = useAuth();
  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [availableJobs, setAvailableJobs] = useState<AvailableJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobDetails | null>(null);
  const [selectedJobDistance, setSelectedJobDistance] = useState<number | null>(null);
  const [jobDetailsLoading, setJobDetailsLoading] = useState(false);
  const [jobDetailsError, setJobDetailsError] = useState("");
  const [displayLocation, setDisplayLocation] = useState<{
    accuracy: number;
    timestamp: number | null;
    freshnessSource: "captured" | "saved";
  } | null>(null);
  const [locationPermission, setLocationPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [jobsRetryMode, setJobsRetryMode] = useState<"GPS" | "MATCHING" | "FETCH">("GPS");
  const [loading, setLoading] = useState({ profile: true, jobs: true });
  const [errors, setErrors] = useState({ profile: "", jobs: "" });

  const watcherIdRef = useRef<number | null>(null);
  const lastLiveLocationRef = useRef<LiveLocationSnapshot | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading((current) => ({ ...current, profile: true }));
    setErrors((current) => ({ ...current, profile: "" }));
    try {
      const data = await apiGet<WorkerProfile>("/api/v1/workers/me");
      setProfile(data);
      const currentLocation = data.current_location;
      const savedTimestamp = currentLocation ? Date.parse(currentLocation.updated_at) : NaN;
      setDisplayLocation(
        currentLocation && currentLocation.accuracy_m <= MAX_LOCATION_ACCURACY_METERS
          ? {
              accuracy: currentLocation.accuracy_m,
              timestamp: Number.isFinite(savedTimestamp) ? savedTimestamp : null,
              freshnessSource: "saved",
            }
          : null,
      );
    } catch {
      setErrors((current) => ({ ...current, profile: "Unable to load your profile summary." }));
    } finally {
      setLoading((current) => ({ ...current, profile: false }));
    }
  }, []);

  const loadAvailableJobs = useCallback(async () => {
    setLoading((current) => ({ ...current, jobs: true }));
    setErrors((current) => ({ ...current, jobs: "" }));
    try {
      const data = await apiGet<{ jobs: AvailableJob[] }>("/api/v1/workers/me/available-jobs");
      setAvailableJobs(data.jobs || []);
      setJobsRetryMode("FETCH");
    } catch (error: unknown) {
      const status = error instanceof ApiError ? error.status : undefined;
      const detail = error instanceof ApiError ? error.detail : undefined;
      setJobsRetryMode(detail === "CURRENT_LOCATION_REQUIRED" ? "GPS" : detail === "WORKER_REMATCH_FAILED" ? "MATCHING" : "FETCH");
      if (status === 402 || detail === "SUBSCRIPTION_REQUIRED") {
        setErrors((current) => ({
          ...current,
          jobs: "Your worker subscription is inactive. Subscribe for ₹200/month to access nearby jobs.",
        }));
      } else if (detail === "CURRENT_LOCATION_REQUIRED") {
        setErrors((current) => ({
          ...current,
          jobs: "Your current GPS is missing, stale, or too inaccurate for nearby work. Refresh your current location and try again.",
        }));
      } else if (detail === "WORKER_REMATCH_FAILED") {
        setErrors((current) => ({
          ...current,
          jobs: "Your current GPS was saved, but candidate matching could not be refreshed. Retry matching with this saved GPS.",
        }));
      } else if (detail === "MATCHING_RPC_UNAVAILABLE") {
        setJobsRetryMode("FETCH");
        setErrors((current) => ({
          ...current,
          jobs: "The nearby-work matching service is unavailable on the server. Your GPS remains saved; retry nearby work after the service is restored.",
        }));
      } else {
        setErrors((current) => ({
          ...current,
          jobs: "Nearby work could not be loaded.",
        }));
      }
    } finally {
      setLoading((current) => ({ ...current, jobs: false }));
    }
  }, []);

  const refreshCurrentLocationAndJobs = useCallback(async () => {
    setLoading((current) => ({ ...current, jobs: true }));
    setErrors((current) => ({ ...current, jobs: "" }));
    let acquiredLocation: { accuracy: number; timestamp: number } | null = null;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErrors((current) => ({ ...current, jobs: "Location services are unavailable on this device." }));
      setJobsRetryMode("GPS");
      setLoading((current) => ({ ...current, jobs: false }));
      return;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 30000,
        });
      });
      acquiredLocation = { accuracy: position.coords.accuracy, timestamp: position.timestamp };
      const ageMs = Date.now() - position.timestamp;
      if (!Number.isFinite(position.timestamp) || ageMs < -30000 || ageMs > 10 * 60 * 1000) {
        throw new Error("LOCATION_STALE");
      }
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MAX_LOCATION_ACCURACY_METERS) {
        throw new Error("LOCATION_INACCURATE");
      }
      const normalized = normalizeCoordinates(latitude, longitude, accuracy);
      if (!normalized) throw new Error("LOCATION_INVALID");
      await apiPut("/api/v1/workers/me/location", {
        latitude: normalized.latitude,
        longitude: normalized.longitude,
        accuracy_m: normalized.accuracy,
        captured_at: new Date(position.timestamp).toISOString(),
        location_source: "GPS",
      });
      setDisplayLocation({
        accuracy: normalized.accuracy,
        timestamp: Number.isFinite(position.timestamp) ? position.timestamp : null,
        freshnessSource: "captured",
      });
      setLocationPermission("granted");
      await loadAvailableJobs();
    } catch (error: unknown) {
      setLoading((current) => ({ ...current, jobs: false }));
      if (error instanceof ApiError) {
        if (error.detail === "WORKER_REMATCH_FAILED" || error.detail === "MATCHING_RPC_UNAVAILABLE") {
          if (acquiredLocation) {
            setDisplayLocation({
              accuracy: acquiredLocation.accuracy,
              timestamp: Number.isFinite(acquiredLocation.timestamp) ? acquiredLocation.timestamp : null,
              freshnessSource: "captured",
            });
          }
          setLocationPermission("granted");
          setJobsRetryMode("MATCHING");
          setErrors((current) => ({
            ...current,
            jobs: error.detail === "MATCHING_RPC_UNAVAILABLE"
              ? "The nearby-work matching service is unavailable on the server. Your GPS remains saved; retry matching after the service is restored."
              : "Your current GPS was saved, but candidate matching could not be refreshed. Retry matching with this saved GPS.",
          }));
          return;
        }
        setJobsRetryMode("GPS");
        const message = error.detail === "GPS_LOCATION_STALE"
          ? "The GPS fix became stale before it could be saved. Try again to request a fresh location."
          : `Current GPS could not be saved: ${error.detail || "request failed"}. Try again.`;
        setErrors((current) => ({ ...current, jobs: message }));
        return;
      }
      setJobsRetryMode("GPS");
      const code = typeof error === "object" && error !== null && "code" in error
        ? Number((error as { code: unknown }).code)
        : undefined;
      if (code === 1) setLocationPermission("denied");
      const message = error instanceof Error && error.message === "LOCATION_STALE"
        ? "The device returned a stale location. Enable location services and try again."
        : error instanceof Error && error.message === "LOCATION_INACCURATE"
          ? "Current GPS accuracy is worse than 1,000 metres. Move to an area with a clearer GPS signal and try again."
          : error instanceof Error && error.message === "LOCATION_INVALID"
            ? "The device returned invalid coordinates. A valid current GPS fix is required."
            : code === 1
              ? "Location permission was denied. Enable location access to find nearby work."
              : code === 2
                ? "Your device could not determine a location. Check location services and try again."
                : code === 3
                  ? "Timed out waiting for current GPS. Try again when location services are available."
                  : "Nearby work could not be refreshed because current GPS is unavailable.";
      setErrors((current) => ({ ...current, jobs: message }));
    }
  }, [loadAvailableJobs]);

  const refreshMatchingAndJobs = useCallback(async () => {
    setLoading((current) => ({ ...current, jobs: true }));
    setErrors((current) => ({ ...current, jobs: "" }));
    try {
      await apiPost("/api/v1/workers/me/available-jobs/refresh");
      await loadAvailableJobs();
    } catch (error: unknown) {
      const detail = error instanceof ApiError ? error.detail : undefined;
      if (detail === "CURRENT_LOCATION_REQUIRED") {
        setJobsRetryMode("GPS");
        setErrors((current) => ({
          ...current,
          jobs: "The saved GPS fix is no longer fresh enough for matching. Get a new current GPS fix to continue.",
        }));
      } else if (detail === "MATCHING_RPC_UNAVAILABLE") {
        setJobsRetryMode("MATCHING");
        setErrors((current) => ({
          ...current,
          jobs: "The nearby-work matching service is unavailable on the server. Your GPS remains saved; retry matching after the service is restored.",
        }));
      } else {
        setJobsRetryMode("MATCHING");
        setErrors((current) => ({
          ...current,
          jobs: "Your GPS is saved, but candidate matching is still unavailable. Retry matching; you do not need to request GPS again while this fix remains fresh.",
        }));
      }
    } finally {
      setLoading((current) => ({ ...current, jobs: false }));
    }
  }, [loadAvailableJobs]);

  const retryNearbyJobs = useCallback(() => {
    if (jobsRetryMode === "MATCHING") return void refreshMatchingAndJobs();
    if (jobsRetryMode === "FETCH") return void loadAvailableJobs();
    return void refreshCurrentLocationAndJobs();
  }, [jobsRetryMode, loadAvailableJobs, refreshCurrentLocationAndJobs, refreshMatchingAndJobs]);

  const loadJobDetails = useCallback(async (job: AvailableJob) => {
    setSelectedJobId(job.job_id);
    setSelectedJob(null);
    setSelectedJobDistance(job.distance_km);
    setJobDetailsError("");
    setJobDetailsLoading(true);
    try {
      const data = await apiGet<JobDetails>(`/api/v1/workers/me/jobs/${encodeURIComponent(job.job_id)}`);
      setSelectedJob(data);
    } catch {
      setJobDetailsError("Unable to load this job right now.");
    } finally {
      setJobDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || user.role !== "WORKER" || isLoading) return;
    void Promise.resolve().then(() => Promise.all([loadProfile(), loadAvailableJobs()]));
  }, [isLoading, loadAvailableJobs, loadProfile, user]);


  useRefreshOnFocus(
    async () => {
      await Promise.all([loadProfile(), loadAvailableJobs()]);
    },
    !isLoading && user?.role === "WORKER",
  );

  useEffect(() => {
    if (
      !user ||
      user.role !== "WORKER" ||
      typeof navigator === "undefined" ||
      !navigator.geolocation ||
      watcherIdRef.current !== null
    ) {
      return;
    }

    let locationCallbackNumber = 0;
    const onPosition = (position: GeolocationPosition) => {
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
      const normalized = normalizeCoordinates(
        latitude,
        longitude,
        accuracy,
      );
      if (!Number.isFinite(timestamp) || ageMs < -30000 || ageMs > 10 * 60 * 1000) {
        traceCallback("REJECTED", "stale_location");
        setJobsRetryMode("GPS");
        setErrors((current) => ({
          ...current,
          jobs: "The device returned a stale location. Wait for a fresh GPS fix, then try again.",
        }));
        setLoading((current) => ({ ...current, jobs: false }));
        return;
      }
      if (!normalized) {
        const reason = accuracy > MAX_LOCATION_ACCURACY_METERS
          ? "accuracy_above_threshold"
          : "invalid_coordinates_or_accuracy";
        traceCallback("REJECTED", reason);
        setJobsRetryMode("GPS");
        setErrors((current) => ({
          ...current,
          jobs: accuracy > MAX_LOCATION_ACCURACY_METERS
            ? "Current GPS accuracy is worse than 1,000 metres. Move to an area with a clearer GPS signal and try again."
            : "The device returned invalid coordinates. A valid current GPS fix is required.",
        }));
        setLoading((current) => ({ ...current, jobs: false }));
        return;
      }

      const next: LiveLocationSnapshot = {
        latitude: normalized.latitude,
        longitude: normalized.longitude,
        accuracy_m: normalized.accuracy,
        updated_at: Date.now(),
        captured_at: timestamp,
      };
      if (!shouldSendLiveLocationUpdate(lastLiveLocationRef.current, next)) {
        traceCallback("REJECTED", "movement_or_heartbeat_update_not_due");
        return;
      }
      lastLiveLocationRef.current = next;
      traceCallback("ACCEPTED", "eligible_for_upload");
      console.debug("[Location Trace][HTTP OUT]", {
        lat: next.latitude,
        lng: next.longitude,
        accuracy_m: next.accuracy_m,
        source_context: "capacitor_worker_dashboard",
        timestamp,
      });
      apiPut<{
        latitude?: number;
        longitude?: number;
        accuracy_m?: number;
        location_source?: string;
        updated_at?: string;
      }>("/api/v1/workers/me/location", {
        latitude: next.latitude,
        longitude: next.longitude,
        accuracy_m: next.accuracy_m,
        captured_at: new Date(timestamp).toISOString(),
        location_source: "GPS",
      })
        .then((response) => {
          console.debug("[Location Trace][HTTP IN]", {
            status: 200,
            latitude: response?.latitude ?? null,
            longitude: response?.longitude ?? null,
            accuracy_m: response?.accuracy_m ?? null,
            location_source: response?.location_source ?? null,
            timestamp: response?.updated_at ?? null,
            server_message: null,
          });
          lastLiveLocationRef.current = next;
          setDisplayLocation({
            accuracy: next.accuracy_m,
            timestamp: Number.isFinite(next.captured_at) ? next.captured_at : null,
            freshnessSource: "captured",
          });
          setLocationPermission("granted");
          void loadAvailableJobs();
        })
        .catch((error: unknown) => {
          const apiError = error instanceof ApiError ? error : null;
          console.debug("[Location Trace][HTTP IN]", {
            status: apiError?.status ?? null,
            latitude: null,
            longitude: null,
            accuracy_m: null,
            location_source: null,
            timestamp: null,
            server_message: apiError?.detail ?? null,
          });
          lastLiveLocationRef.current = null;
          setLoading((current) => ({ ...current, jobs: false }));
          if (apiError?.detail === "WORKER_REMATCH_FAILED" || apiError?.detail === "MATCHING_RPC_UNAVAILABLE") {
            lastLiveLocationRef.current = next;
            setDisplayLocation({
              accuracy: next.accuracy_m,
              timestamp: Number.isFinite(next.captured_at) ? next.captured_at : null,
              freshnessSource: "captured",
            });
            setLocationPermission("granted");
            setJobsRetryMode("MATCHING");
            setErrors((current) => ({
              ...current,
              jobs: apiError?.detail === "MATCHING_RPC_UNAVAILABLE"
                ? "The nearby-work matching service is unavailable on the server. Your GPS remains saved; retry matching after the service is restored."
                : "Your current GPS was saved, but candidate matching could not be refreshed. Retry matching with this saved GPS.",
            }));
            return;
          }
          setJobsRetryMode("GPS");
          if (apiError?.detail === "GPS_LOCATION_STALE") {
            setErrors((current) => ({
              ...current,
              jobs: "The GPS fix became stale before it could be saved. Try again to request a fresh location.",
            }));
            return;
          }
          setErrors((current) => ({
            ...current,
            jobs: "Current GPS could not be saved. Check your connection and try again.",
          }));
        });
    };

    const onError = (error: GeolocationPositionError) => {
      setLoading((current) => ({ ...current, jobs: false }));
      setJobsRetryMode("GPS");
      if (error.code === 1) setLocationPermission("denied");
      setErrors((current) => ({
        ...current,
        jobs: error.code === 1
          ? "Location permission was denied. Enable location access to find nearby work."
          : error.code === 2
            ? "Your device could not determine a location. Check location services and try again."
            : "Timed out waiting for current GPS. Try again when location services are available.",
      }));
    };

    watcherIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000,
    });

    return () => {
      if (watcherIdRef.current !== null) {
        navigator.geolocation.clearWatch(watcherIdRef.current);
        watcherIdRef.current = null;
      }
      lastLiveLocationRef.current = null;
    };
  }, [loadAvailableJobs, user]);

  const locationAgeMs = displayLocation?.timestamp == null ? null : Date.now() - displayLocation.timestamp;
  const locationAgeLabel = locationAgeMs === null || !Number.isFinite(locationAgeMs) || locationAgeMs < -30_000
    ? "timestamp unavailable"
    : locationAgeMs < 60_000
      ? "less than 1 minute ago"
      : `${Math.floor(locationAgeMs / 60_000)} minutes ago`;
  const locationFreshnessLabel = displayLocation?.freshnessSource === "saved" ? "saved GPS update" : "GPS fix";
  const locationAccuracyLabel = displayLocation
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
    <WorkerMobileShell>
      <main className="worker-dashboard worker-home-dashboard">
        <section className="worker-welcome-banner">
          <div className="worker-welcome-copy">
            <p>Welcome back</p>
            <h1>{user?.name || "Worker"}</h1>
            <span>Here is your work overview.</span>
            {profile?.profile_completed === false && (
              <small className="worker-profile-warning">Profile completion in progress</small>
            )}
          </div>
          <Link
            to="/worker/profile"
            className="worker-avatar"
            title="View profile"
            aria-label="View profile"
          >
            {user?.profile_photo_url ? (
              <img src={user.profile_photo_url} alt="Profile" />
            ) : (
              <User size={32} />
            )}
          </Link>
        </section>

        <section className="worker-summary-grid" aria-label="Worker summary">
          {/* Card 1: Availability */}
          <article className="worker-summary-item">
            <div className="worker-summary-heading">
              <h2>Availability</h2>
              <CheckCircle2 size={20} className="icon-emerald" />
            </div>
            <SectionState loading={loading.profile} error={errors.profile} retry={loadProfile}>
              <strong>{profile?.availability_status || "-"}</strong>
            </SectionState>
          </article>

          {/* Card 2: Subscription */}
          <article className="worker-summary-item">
            <div className="worker-summary-heading">
              <h2>Subscription</h2>
              <CheckCircle2
                size={20}
                className={subscriptionActive ? "icon-emerald" : "icon-amber"}
              />
            </div>
            <SectionState loading={loading.profile} error={errors.profile} retry={loadProfile}>
              <strong>
                {subscriptionActive
                  ? trialActive
                    ? "FREE TRIAL ACTIVE"
                    : "Active"
                  : "Not Active"}
              </strong>
              {subscriptionExpiry && (
                <p>{trialActive ? "Active until " : "Expires "}{subscriptionExpiry}</p>
              )}
              <small>{trialActive ? "Worker / Employee · 1 month free trial" : "Worker / Employee · ₹200 / month"}</small>
              {!subscriptionActive && (
                <Link to="/worker/subscription" className="worker-renew-link">
                  Renew Subscription
                </Link>
              )}
            </SectionState>
          </article>

          {/* Card 3: Current location */}
          <article className="worker-summary-item">
            <div className="worker-summary-heading">
              <h2>Current location</h2>
              <MapPin size={20} className="icon-blue" />
            </div>
            <SectionState loading={loading.profile} error={errors.profile} retry={loadProfile}>
              <p className="worker-location-value">
                {displayLocation ? "Current location detected" : "Current GPS unavailable"}
              </p>
              {displayLocation && (
                <small>
                  Current GPS location received and saved · accuracy about {locationAccuracyLabel} · {locationFreshnessLabel} {locationAgeLabel} · permission {locationPermission === "unknown" ? "not checked" : locationPermission}
                </small>
              )}
            </SectionState>
          </article>
        </section>

        <section className="worker-jobs-section">
          <div className="worker-jobs-heading">
            <div>
              <p className="auth-eyebrow">Matching</p>
              <h2>Nearby work</h2>
            </div>
            {!loading.jobs && !errors.jobs && (
              <span>
                {availableJobs.length} {availableJobs.length === 1 ? "job" : "jobs"} found{availableJobs.length > 3 ? " · showing first 3" : ""}
              </span>
            )}
            <Link to="/worker/jobs" className="worker-profile-link">View all jobs</Link>
          </div>

          <SectionState
            loading={loading.jobs}
            error={errors.jobs}
            retry={retryNearbyJobs}
            retryLabel={jobsRetryMode === "MATCHING" ? "Retry matching" : jobsRetryMode === "FETCH" ? "Retry nearby work" : "Refresh current GPS"}
            errorAction={
              errors.jobs.includes("subscription") ? (
                <Link to="/worker/subscription" className="worker-subscribe-button">
                  Subscribe / Renew (₹200/mo)
                </Link>
              ) : undefined
            }
          >
            {availableJobs.length ? (
              <div className="worker-jobs-list">
                {availableJobs.slice(0, 3).map((job) => (
                  <article key={job.job_id} className="worker-job-item">
                    <div className="worker-job-card-header">
                      <div>
                        <h3>{job.title}</h3>
                        <p>{job.employer_name}</p>
                      </div>
                      <MapPin size={18} className="icon-blue shrink-0" />
                    </div>
                    <div className="worker-job-facts">
                      <span>
                        {job.salary > 0 ? `₹${job.salary}/day` : "Daily wage not specified"}
                      </span>
                      <span>
                        {job.distance_km == null ? "Distance unavailable" : `${job.distance_km} km`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadJobDetails(job)}
                      className="worker-view-details-button"
                    >
                      View Details
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="worker-dashboard-state worker-dashboard-empty">
                No suitable nearby jobs found
              </div>
            )}
          </SectionState>
        </section>

        {selectedJobId && (
          <div
            className="worker-job-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedJobId(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="worker-job-details-title"
              className="worker-job-dialog"
            >
              <div className="worker-job-dialog-heading">
                <div>
                  <p className="auth-eyebrow">Job details</p>
                  <h2 id="worker-job-details-title">
                    {selectedJob?.title || (jobDetailsLoading ? "Loading job details" : "Job details")}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedJobId(null)}
                  aria-label="Close job details"
                  className="dashboard-icon-button"
                >
                  <X size={20} />
                </button>
              </div>

              {jobDetailsLoading ? (
                <div className="worker-dashboard-state">
                  <Loader2 size={20} className="spin icon-secondary" />
                  <span>Loading job details...</span>
                </div>
              ) : jobDetailsError ? (
                <div className="worker-dashboard-error-card">
                  <p className="worker-dashboard-error-text">{jobDetailsError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      const job = availableJobs.find((item) => item.job_id === selectedJobId);
                      if (job) void loadJobDetails(job);
                    }}
                    className="worker-retry-inline-button"
                  >
                    <RefreshCw size={16} /> Try again
                  </button>
                </div>
              ) : selectedJob ? (
                <div className="worker-job-dialog-body">
                  <div className="worker-job-status-banner">
                    <div>
                      <strong>{selectedJob.title}</strong>
                      <p>{selectedJob.employer_name || "Employer unavailable"}</p>
                    </div>
                    <span className="worker-job-status-pill">{selectedJob.status}</span>
                  </div>

                  <div className="worker-job-detail-block">
                    <h3>Work site</h3>
                    <p className="worker-site-name">{selectedJob.site_name || "Site unavailable"}</p>
                    <p className="worker-site-address">
                      {[selectedJob.address, selectedJob.city, selectedJob.state]
                        .filter(Boolean)
                        .join(", ") || "Address unavailable"}
                    </p>
                    <p className="worker-site-location-status">
                      <MapPin size={16} className="icon-secondary shrink-0" />
                      <span>
                        {selectedJob.target_lat != null && selectedJob.target_lng != null
                          ? "Location available"
                          : "Location unavailable"}
                      </span>
                    </p>
                  </div>

                  <div className="worker-job-detail-block">
                    <h3>Requirements</h3>
                    <dl className="worker-job-spec-grid">
                      <div>
                        <dt>Workers needed</dt>
                        <dd>{selectedJob.headcount}</dd>
                      </div>
                      <div>
                        <dt>Workers remaining</dt>
                        <dd>Not available from current response</dd>
                      </div>
                      <div>
                        <dt>Minimum experience</dt>
                        <dd>
                          {selectedJob.min_experience != null
                            ? `${selectedJob.min_experience} years`
                            : "Not specified"}
                        </dd>
                      </div>
                      <div>
                        <dt>Daily wage</dt>
                        <dd>{selectedJob.salary > 0 ? `₹${selectedJob.salary}/day` : "Not specified"}</dd>
                      </div>
                    </dl>
                    {selectedJob.required_skills?.length ? (
                      <div className="worker-job-skills-block">
                        <p className="worker-skills-heading">Required skills</p>
                        <ul className="worker-skills-list">
                          {selectedJob.required_skills.map((skill) => (
                            <li key={skill}>{skill}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="worker-no-skills">Required skills: Not specified</p>
                    )}
                  </div>

                  <div className="worker-job-detail-block">
                    <h3>Work details</h3>
                    <dl className="worker-job-spec-grid">
                      <div>
                        <dt>Work duration</dt>
                        <dd>
                          {selectedJob.work_duration_days != null
                            ? `${selectedJob.work_duration_days} days`
                            : "Not specified"}
                        </dd>
                      </div>
                      <div>
                        <dt>Daily timing</dt>
                        <dd>{selectedJob.work_timing || "Not specified"}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="worker-job-detail-block">
                    <h3>Distance</h3>
                    <p className="worker-job-distance-value">
                      {selectedJobDistance == null
                        ? "Distance unavailable"
                        : `${selectedJobDistance} km away`}
                    </p>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        )}
      </main>
    </WorkerMobileShell>
  );
}