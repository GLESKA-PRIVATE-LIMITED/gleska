import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, MapPin, RefreshCw } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { ApiError, apiGet } from "../../lib/api";
import { useRefreshOnFocus } from "../../lib/useRefreshOnFocus";
import { useAuth } from "../auth/AuthProvider";
import WorkerMobileShell from "./WorkerMobileShell";

type AvailableJob = {
  job_id: string;
  title: string;
  salary: number;
  headcount: number;
  min_experience: number | null;
  employer_name: string;
  distance_km: number | null;
};

export default function WorkerJobsScreen() {
  const { user, isLoading } = useAuth();
  const [jobs, setJobs] = useState<AvailableJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadJobs = useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setLoading(true);
    setError("");
    try {
      const response = await apiGet<{ jobs: AvailableJob[] }>("/api/v1/workers/me/available-jobs");
      setJobs(response.jobs || []);
    } catch (requestError) {
      const status = requestError instanceof ApiError ? requestError.status : undefined;
      const detail = requestError instanceof ApiError ? requestError.detail : undefined;
      if (status === 402 || detail === "SUBSCRIPTION_REQUIRED") {
        setError("Your worker subscription is inactive. Subscribe for ₹200/month to access nearby jobs.");
      } else if (detail === "CURRENT_LOCATION_REQUIRED") {
        setError("Add a current location to see nearby jobs.");
      } else {
        setError(requestError instanceof Error ? requestError.message : "Unable to load nearby jobs right now.");
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isLoading || !user || user.role !== "WORKER") return;
    void Promise.resolve().then(loadJobs);
  }, [isLoading, loadJobs, user]);
  useRefreshOnFocus(loadJobs, !isLoading && user?.role === "WORKER");

  if (isLoading) return null;
  if (!user || user.role !== "WORKER") return <Navigate to="/" replace />;

  return <WorkerMobileShell>
    <main className="worker-dashboard worker-jobs-page">
      <header className="worker-dashboard-header">
        <div>
          <p className="worker-page-eyebrow">Work</p>
          <h1>Jobs near you</h1>
          <p>Eligible jobs matched to your profile and current location.</p>
        </div>
        <button type="button" className="worker-refresh-button" onClick={() => void loadJobs()} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          <span>Refresh</span>
        </button>
      </header>

      {loading ? <div className="worker-dashboard-state" role="status"><Loader2 size={18} className="spin" /> Loading nearby jobs...</div>
        : error ? <section className="worker-dashboard-error-card" role="alert">
          <p className="worker-dashboard-error-text">{error}</p>
          {error.includes("subscription") && <Link to="/worker/subscription" className="worker-subscribe-button">Subscribe / Renew</Link>}
          {error.includes("location") && <Link to="/worker/profile" className="worker-profile-link">Open profile</Link>}
          <button type="button" onClick={() => void loadJobs()} className="worker-retry-button">Try again</button>
        </section>
          : jobs.length ? <div className="worker-jobs-list">
            {jobs.map((job) => <article key={job.job_id} className="worker-job-item">
              <div className="worker-job-card-header">
                <div><h3>{job.title}</h3><p>{job.employer_name || "Employer"}</p></div>
                <MapPin size={18} className="icon-blue shrink-0" />
              </div>
              <div className="worker-job-facts">
                <span>{job.salary > 0 ? `₹${job.salary}/day` : "Daily wage not specified"}</span>
                <span>{job.distance_km == null ? "Distance unavailable" : `${job.distance_km} km`}</span>
                <span>{job.min_experience == null ? "Experience not specified" : `${job.min_experience} years experience`}</span>
                <span>{job.headcount} worker{job.headcount === 1 ? "" : "s"} needed</span>
              </div>
              <Link className="worker-view-details-button" to={`/worker/jobs/${encodeURIComponent(job.job_id)}`}>View details</Link>
            </article>)}
          </div> : <div className="worker-dashboard-state worker-dashboard-empty">
            <AlertCircle size={20} /> No eligible nearby jobs are available.
          </div>}
    </main>
  </WorkerMobileShell>;
}
