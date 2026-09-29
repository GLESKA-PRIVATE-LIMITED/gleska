import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, MapPin, RefreshCw, User, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { apiGet, apiPut, ApiError } from "../../lib/api";
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
  current_location?: { address?: string | null } | null;
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
  errorAction,
  children,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
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
          Try again
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
  const [currentLocationAddress, setCurrentLocationAddress] = useState("");
  const [loading, setLoading] = useState({ profile: true, jobs: true });
  const [errors, setErrors] = useState({ profile: "", jobs: "" });

  const watcherIdRef = useRef<number | null>(null);
  const lastLiveLocationRef = useRef<LiveLocationSnapshot | null>(null);
  const jobsRefreshedAfterLiveLocationRef = useRef(false);

  const loadProfile = useCallback(async () => {
    setLoading((current) => ({ ...current, profile: true }));
    setErrors((current) => ({ ...current, profile: "" }));
    try {
      const data = await apiGet<WorkerProfile>("/api/v1/workers/me");
      setProfile(data);
      setCurrentLocationAddress(data.current_location?.address || data.address || [data.city, data.state].filter(Boolean).join(", "));
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
      setAvailableJobs((data.jobs || []).slice(0, 3));
    } catch (error: unknown) {
      const status = error instanceof ApiError ? error.status : undefined;
      const detail = error instanceof ApiError ? error.detail : undefined;
      if (status === 402 || detail === "SUBSCRIPTION_REQUIRED") {
        setErrors((current) => ({
          ...current,
          jobs: "Your worker subscription is inactive. Subscribe for ₹200/month to access nearby jobs.",
        }));
      } else if (detail === "CURRENT_LOCATION_REQUIRED") {
        setErrors((current) => ({
          ...current,
          jobs: "Location unavailable. Nearby work could not be updated.",
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

  useEffect(() => {
    if (!user || user.role !== "WORKER" || isLoading) return;
    const refresh = () => {
      void loadProfile();
      void loadAvailableJobs();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isLoading, loadAvailableJobs, loadProfile, user]);

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

    const onPosition = (position: GeolocationPosition) => {
      const normalized = normalizeCoordinates(
        position.coords.latitude,
        position.coords.longitude,
        position.coords.accuracy,
      );
      if (!normalized) return;

      const next: LiveLocationSnapshot = {
        latitude: normalized.latitude,
        longitude: normalized.longitude,
        accuracy_m: normalized.accuracy,
        updated_at: Date.now(),
      };
      if (!shouldSendLiveLocationUpdate(lastLiveLocationRef.current, next)) return;
      lastLiveLocationRef.current = next;

      apiPut<{ address?: string | null }>("/api/v1/workers/me/location", {
        latitude: next.latitude,
        longitude: next.longitude,
        accuracy_m: next.accuracy_m,
      })
        .then((response) => {
          if (response?.address) setCurrentLocationAddress(response.address);
          if (!jobsRefreshedAfterLiveLocationRef.current) {
            jobsRefreshedAfterLiveLocationRef.current = true;
            void loadAvailableJobs();
          }
        })
        .catch(() => {
          // Authoritative backend; next valid position will retry update.
        });
    };

    const onError = () => {
      // Graceful fallback without breaking dashboard usage
    };

    watcherIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 300000,
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

  const location =
    currentLocationAddress ||
    profile?.address ||
    [profile?.city, profile?.state].filter(Boolean).join(", ");
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
              <p className="worker-location-value">{location || "Location unavailable"}</p>
            </SectionState>
          </article>
        </section>

        <section className="worker-jobs-section">
          <div className="worker-jobs-heading">
            <div>
              <p className="auth-eyebrow">Matching</p>
              <h2>Nearby work</h2>
            </div>
            <span>Showing up to 3</span>
          </div>

          <SectionState
            loading={loading.jobs}
            error={errors.jobs}
            retry={loadAvailableJobs}
            errorAction={
              errors.jobs.includes("subscription") ? (
                <Link to="/worker/subscription" className="worker-subscribe-button">
                  Subscribe / Renew (₹200/mo)
                </Link>
              ) : errors.jobs === "Location unavailable. Nearby work could not be updated." ? (
                <Link to="/worker/profile" className="worker-profile-link">
                  Add location in Profile
                </Link>
              ) : undefined
            }
          >
            {availableJobs.length ? (
              <div className="worker-jobs-list">
                {availableJobs.map((job) => (
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