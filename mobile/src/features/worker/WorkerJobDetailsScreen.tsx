import { useCallback, useEffect, useState } from "react";
import { Loader2, MapPin, RefreshCw } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ApiError, apiGet } from "../../lib/api";
import { useRefreshOnFocus } from "../../lib/useRefreshOnFocus";
import { useAuth } from "../auth/AuthProvider";
import WorkerMobileShell from "./WorkerMobileShell";

type JobDetails = {
  job_id: string;
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
};

export default function WorkerJobDetailsScreen() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user, isLoading } = useAuth();
  const [job, setJob] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadJob = useCallback(async () => {
    if (!user || user.role !== "WORKER" || !jobId) return;
    setLoading(true);
    setError("");
    try {
      setJob(await apiGet<JobDetails>(`/api/v1/workers/me/jobs/${encodeURIComponent(jobId)}`));
    } catch (requestError) {
      const detail = requestError instanceof ApiError ? requestError.detail : undefined;
      setError(detail === "JOB_NOT_AVAILABLE_TO_WORKER"
        ? "This job is not available to your worker account."
        : requestError instanceof Error ? requestError.message : "Unable to load this job right now.");
    } finally {
      setLoading(false);
    }
  }, [jobId, user]);

  useEffect(() => {
    if (!isLoading && user?.role === "WORKER") void Promise.resolve().then(loadJob);
  }, [isLoading, loadJob, user]);
  useRefreshOnFocus(loadJob, !isLoading && user?.role === "WORKER");

  if (isLoading) return null;
  if (!user || user.role !== "WORKER") return <Navigate to="/" replace />;
  const address = [job?.address, job?.city, job?.state].filter(Boolean).join(", ");

  return <WorkerMobileShell>
    <main className="worker-dashboard worker-job-details-page">
      <div className="worker-jobs-heading">
        <div><p className="worker-page-eyebrow">Work</p><h1>Job details</h1></div>
        <button type="button" className="worker-refresh-button" onClick={() => void loadJob()} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} /><span>Refresh</span>
        </button>
      </div>
      <Link to="/worker/jobs" className="worker-profile-link">Back to jobs near you</Link>
      {loading ? <div className="worker-dashboard-state" role="status"><Loader2 size={18} className="spin" /> Loading job details...</div>
        : error ? <section className="worker-dashboard-error-card" role="alert">
          <p className="worker-dashboard-error-text">{error}</p>
          <button type="button" onClick={() => void loadJob()} className="worker-retry-button">Try again</button>
        </section>
          : job ? <article className="worker-job-item">
            <div className="worker-job-card-header">
              <div><h2>{job.title}</h2><p>{job.employer_name || "Employer unavailable"}</p></div>
              <MapPin size={18} className="icon-blue shrink-0" />
            </div>
            <p className="worker-job-distance-value">{job.site_name || "Work site unavailable"}{address ? ` · ${address}` : ""}</p>
            <dl className="worker-job-detail-list">
              <div><dt>Daily wage</dt><dd>{job.salary > 0 ? `₹${job.salary}/day` : "Not specified"}</dd></div>
              <div><dt>Workers needed</dt><dd>{job.headcount}</dd></div>
              <div><dt>Minimum experience</dt><dd>{job.min_experience == null ? "Not specified" : `${job.min_experience} years`}</dd></div>
              <div><dt>Work duration</dt><dd>{job.work_duration_days == null ? "Not specified" : `${job.work_duration_days} days`}</dd></div>
              <div><dt>Daily timing</dt><dd>{job.work_timing || "Not specified"}</dd></div>
              <div><dt>Status</dt><dd>{job.status.replaceAll("_", " ")}</dd></div>
            </dl>
            {job.required_skills?.length ? <section className="worker-job-skills-block">
              <h3>Required skills</h3><ul>{job.required_skills.map((skill) => <li key={skill}>{skill}</li>)}</ul>
            </section> : null}
          </article> : null}
    </main>
  </WorkerMobileShell>;
}
