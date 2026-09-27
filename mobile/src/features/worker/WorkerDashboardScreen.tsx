import { useEffect, useState } from "react";
import { BriefcaseBusiness, CheckCircle2, LayoutDashboard, LoaderCircle, LogOut, MapPin, PanelLeft, UserRound, X } from "lucide-react";
import { useAuth, errorMessage } from "../auth/AuthProvider";
import { apiGet } from "../../lib/api";
import { useNavigate } from "react-router-dom";

type WorkerProfile = {
  profile_completed: boolean;
  availability_status: "AVAILABLE" | "ON_JOB" | "OFFLINE";
  address?: string | null;
  city?: string | null;
  state?: string | null;
  subscription_valid_until?: string | null;
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

function isSubscriptionActive(expiry?: string | null) {
  return !!expiry && new Date(expiry).getTime() > Date.now();
}

export default function WorkerDashboardScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [jobs, setJobs] = useState<AvailableJob[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [jobsError, setJobsError] = useState("");
  const [selectedJob, setSelectedJob] = useState<JobDetails | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState("");

  const loadProfile = async () => {
    setProfileLoading(true);
    setProfileError("");
    try {
      setProfile(await apiGet<WorkerProfile>("/api/v1/workers/me"));
    } catch (loadError) {
      setProfileError(errorMessage(loadError));
    } finally {
      setProfileLoading(false);
    }
  };

  const loadJobs = async () => {
    setJobsLoading(true);
    setJobsError("");
    try {
      const result = await apiGet<{ jobs: AvailableJob[] }>("/api/v1/workers/me/available-jobs");
      setJobs((result.jobs || []).slice(0, 3));
    } catch (loadError) {
      setJobsError(errorMessage(loadError));
    } finally {
      setJobsLoading(false);
    }
  };

  const refreshDashboard = () => {
    void loadProfile();
    void loadJobs();
  };

  useEffect(() => {
    refreshDashboard();
    const onFocus = () => refreshDashboard();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const openJob = async (jobId: string) => {
    setSelectedJob(null);
    setJobError("");
    setJobLoading(true);
    try {
      setSelectedJob(await apiGet<JobDetails>(`/api/v1/workers/me/jobs/${encodeURIComponent(jobId)}`));
    } catch (loadError) {
      setJobError(errorMessage(loadError));
    } finally {
      setJobLoading(false);
    }
  };

  const location = profile?.address || [profile?.city, profile?.state].filter(Boolean).join(", ") || "Location unavailable";
  const activeSubscription = isSubscriptionActive(profile?.subscription_valid_until);
  const subscriptionExpiry = profile?.subscription_valid_until
    ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(profile.subscription_valid_until))
    : "";

  const logout = async () => {
    await auth.logout();
    navigate("/auth/signin", { replace: true });
  };

  return <div className="worker-app-shell">
    <header className="worker-app-header">
      <button className="worker-menu-trigger" type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation">
        <PanelLeft size={21} />
      </button>
      <span className="worker-brand">GO LESKA AI</span>
      <span className="worker-header-spacer" />
    </header>

    <main className="worker-dashboard">
      <section className="worker-welcome-banner">
        <div className="worker-welcome-copy">
          <p>Welcome back</p>
          <h1>{auth.user?.name || "Worker"}</h1>
          <span>Here is your work overview.</span>
        </div>
        <div className="worker-avatar" aria-label="Worker profile photo">
          {auth.user?.profile_photo_url
            ? <img src={auth.user.profile_photo_url} alt="" />
            : <UserRound size={34} aria-hidden="true" />}
        </div>
      </section>

      <section className="worker-summary-grid" aria-label="Worker summary">
        <article className="worker-summary-item">
          <div className="worker-summary-heading"><h2>Availability</h2><CheckCircle2 size={22} /></div>
          {profileLoading ? <LoaderCircle className="spin" size={20} /> : profileError ? <p className="worker-dashboard-error">{profileError}</p> : <strong>{profile?.availability_status || "-"}</strong>}
        </article>
        <article className="worker-summary-item">
          <div className="worker-summary-heading"><h2>Subscription</h2><CheckCircle2 size={22} /></div>
          {profileLoading ? <LoaderCircle className="spin" size={20} /> : profileError ? <p className="worker-dashboard-error">{profileError}</p> : <><strong>{activeSubscription ? "Active" : profile?.subscription_valid_until ? "Expired" : "Not Active"}</strong>{subscriptionExpiry && <p>Expires {subscriptionExpiry}</p>}<small>Worker / Employee · ₹200 / month</small></>}
        </article>
        <article className="worker-summary-item">
          <div className="worker-summary-heading"><h2>Current location</h2><MapPin size={22} /></div>
          {profileLoading ? <LoaderCircle className="spin" size={20} /> : profileError ? <p className="worker-dashboard-error">{profileError}</p> : <p className="worker-location-value">{location}</p>}
        </article>
      </section>

      <section className="worker-jobs-section">
        <div className="worker-jobs-heading"><div><p className="auth-eyebrow">Matching</p><h2>Nearby work</h2></div><span>Showing up to 3</span></div>
        {jobsLoading ? <div className="worker-dashboard-state"><LoaderCircle className="spin" size={20} /> Loading...</div> : jobsError ? <div className="worker-dashboard-state worker-dashboard-error"><p>{jobsError}</p><button className="text-link" type="button" onClick={() => void loadJobs()}>Try again</button></div> : jobs.length ? <div className="worker-jobs-list">{jobs.map((job) => <article className="worker-job-item" key={job.job_id}><div className="worker-job-title"><BriefcaseBusiness size={18} /><div><h3>{job.title}</h3><p>{job.employer_name || "Employer unavailable"}</p></div></div><div className="worker-job-facts"><span>{job.salary > 0 ? `₹${job.salary}/day` : "Daily wage not specified"}</span><span>{job.distance_km == null ? "Distance unavailable" : `${job.distance_km} km`}</span></div><button className="text-link" type="button" onClick={() => void openJob(job.job_id)}>View Details</button></article>)}</div> : <div className="worker-dashboard-state">No suitable nearby jobs found</div>}
      </section>

    {(selectedJob || jobLoading || jobError) && <div className="worker-job-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelectedJob(null); setJobError(""); } }}><section className="worker-job-dialog" role="dialog" aria-modal="true" aria-labelledby="worker-job-title"><div className="worker-job-dialog-heading"><div><p className="auth-eyebrow">Job details</p><h2 id="worker-job-title">{selectedJob?.title || (jobLoading ? "Loading job details" : "Unable to load job")}</h2></div><button className="dashboard-icon-button" type="button" aria-label="Close job details" onClick={() => { setSelectedJob(null); setJobError(""); }}><X size={19} /></button></div>{jobLoading ? <div className="worker-dashboard-state"><LoaderCircle className="spin" size={20} /> Loading job details...</div> : jobError ? <div className="worker-dashboard-state worker-dashboard-error"><p>{jobError}</p></div> : selectedJob && <dl className="worker-job-detail-list"><div><dt>Employer</dt><dd>{selectedJob.employer_name || "Unavailable"}</dd></div><div><dt>Work site</dt><dd>{[selectedJob.site_name, selectedJob.address, selectedJob.city, selectedJob.state].filter(Boolean).join(", ") || "Unavailable"}</dd></div><div><dt>Daily wage</dt><dd>{selectedJob.salary > 0 ? `₹${selectedJob.salary}/day` : "Not specified"}</dd></div><div><dt>Positions</dt><dd>{selectedJob.headcount}</dd></div><div><dt>Experience</dt><dd>{selectedJob.min_experience == null ? "Not specified" : `${selectedJob.min_experience}+ years`}</dd></div><div><dt>Duration</dt><dd>{selectedJob.work_duration_days == null ? "Not specified" : `${selectedJob.work_duration_days} days`}</dd></div><div><dt>Work timing</dt><dd>{selectedJob.work_timing || "Not specified"}</dd></div><div><dt>Status</dt><dd>{selectedJob.status}</dd></div>{!!selectedJob.required_skills?.length && <div><dt>Required skills</dt><dd>{selectedJob.required_skills.join(", ")}</dd></div>}</dl>}</section></div>}

    {menuOpen && <div className="worker-menu-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
      <aside className="worker-menu-drawer" aria-label="Worker navigation">
        <div className="worker-menu-heading"><span className="worker-brand">GO LESKA AI</span><button className="worker-menu-close" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={21} /></button></div>
        <div className="worker-menu-current"><LayoutDashboard size={19} /><strong>Dashboard</strong></div>
        <div className="worker-menu-account"><span className="worker-account-initial">{auth.user?.name?.charAt(0).toUpperCase() || "W"}</span><div><strong>{auth.user?.name || "Worker"}</strong><span>Worker</span></div></div>
        <button className="worker-menu-logout" type="button" onClick={() => void logout()}><LogOut size={18} /><span>Log out</span></button>
      </aside>
    </div>}
    </main>
  </div>;
}