import { useEffect, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { Navigate } from "react-router-dom";
import { ApiError, apiGet } from "../../lib/api";
import { useRefreshOnFocus } from "../../lib/useRefreshOnFocus";
import { useAuth } from "../auth/AuthProvider";
import EmployerMobileShell from "./EmployerMobileShell";

type AttendanceRecord = {
  attendance_date: string;
  status: string;
  check_in_at?: string | null;
  check_out_at?: string | null;
  duration_minutes?: number | null;
};

type WorkerRecord = {
  worker_profile_id: string;
  name: string;
  profile_photo_url?: string | null;
  trade_id?: string | null;
  skills: string[];
  experience_years?: number | null;
  expected_daily_wage?: number | string | null;
  availability_status: string;
  city?: string | null;
  state?: string | null;
  is_verified: boolean;
  job_id: string;
  job_title: string;
  match_status: string;
  job_site_id: string;
  site_name: string;
  site_address?: string | null;
  site_city?: string | null;
  site_state?: string | null;
  site_pincode?: string | null;
  attendance: AttendanceRecord[];
};

type WorkerListResponse = {
  items: WorkerRecord[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
};

type Filters = {
  search: string;
  trade: string;
  skill: string;
  min_experience: string;
  max_experience: string;
  min_wage: string;
  max_wage: string;
  availability: string;
  city: string;
  sort: string;
};

const initialFilters: Filters = {
  search: "",
  trade: "",
  skill: "",
  min_experience: "",
  max_experience: "",
  min_wage: "",
  max_wage: "",
  availability: "",
  city: "",
  sort: "name_asc",
};

function titleCase(value?: string | null) {
  if (!value) return "Not specified";
  return value.trim().toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatTime(value?: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(minutes?: number | null) {
  if (minutes == null) return "Not available";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatExperience(value?: number | null) {
  if (value == null) return "Not specified";
  return `${value} ${value === 1 ? "year" : "years"}`;
}

function formatWage(value?: number | string | null) {
  if (value == null || !Number.isFinite(Number(value))) return "Not specified";
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}/day`;
}

function requestError(error: unknown) {
  if (error instanceof ApiError && error.detail === "WORKER_DIRECTORY_FAILED") {
    return "We couldn't load workers right now.";
  }
  return error instanceof Error ? error.message : "We couldn't load workers right now.";
}

function WorkerDetails({ worker, onClose }: { worker: WorkerRecord; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="employer-worker-dialog-backdrop">
      <button className="employer-worker-dialog-scrim" type="button" onClick={onClose} aria-label="Close worker details" />
      <section className="employer-worker-dialog" role="dialog" aria-modal="true" aria-labelledby="employer-worker-dialog-title">
        <button className="employer-worker-dialog-close" type="button" onClick={onClose} aria-label="Close worker details">
          <X size={20} />
        </button>
        <div className="employer-worker-dialog-heading">
          <div className="employer-worker-avatar employer-worker-avatar-large">
            {worker.profile_photo_url ? <img src={worker.profile_photo_url} alt="" /> : worker.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 id="employer-worker-dialog-title">{worker.name}</h2>
            <p>{titleCase(worker.trade_id)}</p>
          </div>
        </div>
        <div className="employer-worker-detail-grid">
          <div><span>Experience</span><strong>{formatExperience(worker.experience_years)}</strong></div>
          <div><span>Expected daily wage</span><strong>{formatWage(worker.expected_daily_wage)}</strong></div>
          <div><span>Availability</span><strong>{formatStatus(worker.availability_status)}</strong></div>
          <div><span>Location</span><strong>{[worker.city, worker.state].filter(Boolean).map(titleCase).join(", ") || "Not specified"}</strong></div>
        </div>
        {worker.skills.length > 0 && (
          <div className="employer-worker-dialog-skills">
            <span>Skills</span>
            <p>{worker.skills.map(titleCase).join(" · ")}</p>
          </div>
        )}
        <p className="employer-worker-dialog-note">Hiring actions remain available through job-specific worker matching.</p>
      </section>
    </div>
  );
}

export default function EmployerWorkersScreen() {
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const [filters, setFilters] = useState(initialFilters);
  const [submittedFilters, setSubmittedFilters] = useState(initialFilters);
  const [workers, setWorkers] = useState<WorkerListResponse | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<WorkerRecord | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  useEffect(() => {
    if (authLoading || !user || user.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    let active = true;
    const loadWorkers = async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ page: String(page), limit: "12" });
      Object.entries(submittedFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      try {
        const response = await apiGet<WorkerListResponse>(`/api/v1/employers/me/workers?${params.toString()}`);
        if (active) setWorkers(response);
      } catch (requestErrorValue: unknown) {
        if (active) setError(requestError(requestErrorValue));
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadWorkers();
    return () => {
      active = false;
    };
  }, [authLoading, nextStep, page, reloadToken, submittedFilters, user]);

  useRefreshOnFocus(
    () => setReloadToken((current) => current + 1),
    !authLoading && user?.role === "EMPLOYER" && nextStep === "DASHBOARD",
  );

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (user.role !== "EMPLOYER") return <Navigate to={user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSubmittedFilters({ ...filters });
  };

  const clearFilters = () => {
    setFilters(initialFilters);
    setSubmittedFilters(initialFilters);
    setPage(1);
  };

  return (
    <EmployerMobileShell name={user.name} employerType={user.employer_type} profilePhotoUrl={user.profile_photo_url}>
      <main className="employer-dashboard employer-workers-page">
        <header className="employer-workers-heading">
          <p className="employer-eyebrow">Employer workspace</p>
          <h1>Work history</h1>
          <p>Workers engaged through your jobs and their recorded work details.</p>
        </header>

        <form className="employer-workers-filters employer-section-card" onSubmit={applyFilters}>
          <label className="employer-workers-field">
            <span>Search workers</span>
            <span className="employer-workers-search">
              <Search size={18} aria-hidden="true" />
              <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Name, trade, or skill" />
            </span>
          </label>
          <label className="employer-workers-field">
            <span>Trade</span>
            <input value={filters.trade} onChange={(event) => updateFilter("trade", event.target.value)} placeholder="e.g. Electrician" />
          </label>
          <label className="employer-workers-field">
            <span>City</span>
            <input value={filters.city} onChange={(event) => updateFilter("city", event.target.value)} placeholder="City" />
          </label>
          <label className="employer-workers-field">
            <span>Availability</span>
            <select value={filters.availability} onChange={(event) => updateFilter("availability", event.target.value)}>
              <option value="">Any status</option>
              <option value="AVAILABLE">Available</option>
              <option value="ON_JOB">On job</option>
              <option value="OFFLINE">Offline</option>
            </select>
          </label>
          <button className="employer-workers-apply employer-primary-button" type="submit">
            <SlidersHorizontal size={16} aria-hidden="true" />
            Apply filters
          </button>
          <button
            className="employer-workers-more"
            type="button"
            aria-expanded={showMoreFilters}
            onClick={() => setShowMoreFilters((open) => !open)}
          >
            {showMoreFilters ? "Hide filters" : "More filters"}
          </button>
          {showMoreFilters && (
            <div className="employer-workers-extra-filters">
              <label className="employer-workers-field">
                <span>Exact skill</span>
                <input value={filters.skill} onChange={(event) => updateFilter("skill", event.target.value)} placeholder="Skill" />
              </label>
              <label className="employer-workers-field">
                <span>Min experience</span>
                <input type="number" min="0" value={filters.min_experience} onChange={(event) => updateFilter("min_experience", event.target.value)} placeholder="Years" />
              </label>
              <label className="employer-workers-field">
                <span>Max experience</span>
                <input type="number" min="0" value={filters.max_experience} onChange={(event) => updateFilter("max_experience", event.target.value)} placeholder="Years" />
              </label>
              <label className="employer-workers-field">
                <span>Min daily wage</span>
                <input type="number" min="0" value={filters.min_wage} onChange={(event) => updateFilter("min_wage", event.target.value)} placeholder="Amount" />
              </label>
              <label className="employer-workers-field">
                <span>Max daily wage</span>
                <input type="number" min="0" value={filters.max_wage} onChange={(event) => updateFilter("max_wage", event.target.value)} placeholder="Amount" />
              </label>
              <label className="employer-workers-field">
                <span>Sort workers</span>
                <select value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}>
                  <option value="name_asc">Name A-Z</option>
                  <option value="name_desc">Name Z-A</option>
                  <option value="experience_desc">Most experience</option>
                  <option value="wage_asc">Lowest wage</option>
                  <option value="wage_desc">Highest wage</option>
                </select>
              </label>
            </div>
          )}
          {Object.entries(submittedFilters).some(([key, value]) => key !== "sort" && Boolean(value)) && (
            <button className="employer-workers-clear" type="button" onClick={clearFilters}>Clear filters</button>
          )}
        </form>

        {loading && (
          <div className="employer-workers-state" role="status">
            <LoaderCircle size={20} className="spin" />
            <span>Loading your work history...</span>
          </div>
        )}
        {!loading && error && (
          <div className="employer-workers-state employer-workers-error" role="alert">
            <p>{error}</p>
            <button type="button" className="employer-primary-button" onClick={() => setReloadToken((token) => token + 1)}>Try again</button>
          </div>
        )}
        {!loading && !error && workers?.items.length === 0 && (
          <div className="employer-workers-state employer-workers-empty">
            <Users size={32} aria-hidden="true" />
            <h2>No workers have worked with you yet.</h2>
            <p>Workers will appear here after they are connected to one of your jobs.</p>
            {Object.entries(submittedFilters).some(([key, value]) => key !== "sort" && Boolean(value)) && (
              <button type="button" className="employer-secondary-button" onClick={clearFilters}>Clear filters</button>
            )}
          </div>
        )}
        {!loading && !error && workers && workers.items.length > 0 && (
          <section className="employer-workers-results" aria-label="Worker work history">
            <div className="employer-workers-count">
              <strong>{workers.total} work history record{workers.total === 1 ? "" : "s"}</strong>
              <span>Page {workers.page} of {Math.max(1, Math.ceil(workers.total / workers.limit))}</span>
            </div>
            {workers.items.map((worker) => {
              const latestAttendance = worker.attendance[0];
              const siteAddress = [worker.site_address, worker.site_city, worker.site_state, worker.site_pincode].filter(Boolean).join(", ");
              return (
                <article className="employer-worker-record employer-section-card" key={`${worker.worker_profile_id}-${worker.job_id}`}>
                  <div className="employer-worker-record-heading">
                    <div className="employer-worker-avatar">
                      {worker.profile_photo_url ? <img src={worker.profile_photo_url} alt="" /> : worker.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="employer-worker-record-person">
                      <h2>{worker.name}{worker.is_verified && <BadgeCheck size={17} aria-label="Verified worker" />}</h2>
                      <p>{worker.trade_id || "Trade not specified"}</p>
                    </div>
                  </div>
                  <div className="employer-worker-job">
                    <p>Job</p>
                    <strong>{worker.job_title}</strong>
                    <span>{worker.site_name}</span>
                    <span>{siteAddress || "Site details not available"}</span>
                  </div>
                  <div className="employer-worker-summary">
                    <div><span>Match status</span><strong>{formatStatus(worker.match_status)}</strong></div>
                    <div><span>Work date</span><strong>{formatDate(latestAttendance?.attendance_date)}</strong></div>
                    <div><span>Expected daily wage</span><strong>{formatWage(worker.expected_daily_wage)}</strong></div>
                    <div><span>Duration</span><strong>{formatDuration(latestAttendance?.duration_minutes)}</strong></div>
                  </div>
                  {worker.attendance.length > 0 && (
                    <div className="employer-worker-attendance">
                      <strong>Attendance</strong>
                      {worker.attendance.map((record) => (
                        <div key={record.attendance_date}>
                          <span>{formatDate(record.attendance_date)}</span>
                          <span>{formatTime(record.check_in_at)} – {formatTime(record.check_out_at)}</span>
                          <span>{formatDuration(record.duration_minutes)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {worker.skills.length > 0 && <p className="employer-worker-skills">{worker.skills.map(titleCase).join(" · ")}</p>}
                  <button className="employer-workers-view" type="button" onClick={() => setSelectedWorker(worker)}>
                    <Eye size={16} aria-hidden="true" />
                    View worker
                  </button>
                </article>
              );
            })}
            <nav className="employer-workers-pagination" aria-label="Worker history pages">
              <button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>
                <ChevronLeft size={17} aria-hidden="true" /> Previous
              </button>
              <button type="button" disabled={!workers.has_more} onClick={() => setPage((current) => current + 1)}>
                Next <ChevronRight size={17} aria-hidden="true" />
              </button>
            </nav>
          </section>
        )}
      </main>
      {selectedWorker && <WorkerDetails worker={selectedWorker} onClose={() => setSelectedWorker(null)} />}
    </EmployerMobileShell>
  );
}
