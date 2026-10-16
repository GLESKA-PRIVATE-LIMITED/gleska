import { useEffect, useState, type FormEvent } from "react";
import {
  Clock3,
  FileClock,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { Navigate } from "react-router-dom";
import { ApiError, apiGet, apiPost, apiRequest } from "../../lib/api";
import { useRefreshOnFocus } from "../../lib/useRefreshOnFocus";
import { useAuth } from "../auth/AuthProvider";
import EmployerMobileShell from "./EmployerMobileShell";

type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT";

type AttendanceRecord = {
  id: string;
  job_match_id: string;
  worker_profile_id: string;
  job_id: string;
  job_site_id: string;
  worker_name: string;
  job_title: string;
  site_name: string;
  attendance_date: string;
  status: AttendanceStatus;
  check_in_at?: string | null;
  check_out_at?: string | null;
  employer_manual_override: boolean;
  correction_reason?: string | null;
};

type AttendanceResponse = {
  items: AttendanceRecord[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  present_count: number;
  late_count: number;
  absent_count: number;
};

type AuditEntry = {
  id: string;
  action: string;
  reason?: string | null;
  created_at: string;
};

type SelectOption = {
  id: string;
  title?: string;
  name?: string;
};

type MatchOption = {
  job_match_id: string;
  worker_name: string;
  job_title: string;
  site_name: string;
};

type Filters = {
  date: string;
  worker: string;
  job_id: string;
  job_site_id: string;
  status: string;
};

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

const initialFilters: Filters = { date: localDate(), worker: "", job_id: "", job_site_id: "", status: "" };

function formatTime(value?: string | null) {
  return value ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "-";
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatHours(item: AttendanceRecord) {
  if (!item.check_in_at || !item.check_out_at) return "-";
  const minutes = Math.max(0, Math.round((new Date(item.check_out_at).getTime() - new Date(item.check_in_at).getTime()) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function statusLabel(status: AttendanceStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function attendanceError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function toDateTimeInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  return <span className={`employer-attendance-badge is-${status.toLowerCase()}`}>{statusLabel(status)}</span>;
}

function AttendanceDialog({
  record,
  onClose,
  onSaved,
}: {
  record: AttendanceRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [attendance, setAttendance] = useState(record);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyReload, setHistoryReload] = useState(0);
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [form, setForm] = useState({
    status: record.status,
    check_in_at: toDateTimeInput(record.check_in_at),
    check_out_at: toDateTimeInput(record.check_out_at),
    reason: "",
  });

  useEffect(() => {
    let active = true;
    void Promise.all([
        apiGet<AttendanceRecord>(`/api/v1/employers/me/attendance/${record.id}`),
        apiGet<AuditEntry[]>(`/api/v1/employers/me/attendance/${record.id}/audit`),
      ])
      .then(([detail, auditEntries]) => {
        if (active) {
          setAttendance(detail);
          setAudit(auditEntries);
        }
      })
      .catch((error: unknown) => {
        if (active) setHistoryError(attendanceError(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [historyReload, record.id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const saveCorrection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.reason.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      await apiRequest<AttendanceRecord>(`/api/v1/employers/me/attendance/${record.id}`, {
        method: "PATCH",
        body: {
          status: form.status,
          check_in_at: toIso(form.check_in_at),
          check_out_at: toIso(form.check_out_at),
          reason: form.reason.trim(),
        },
      });
      onSaved();
    } catch (error: unknown) {
      setSaveError(attendanceError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="employer-attendance-dialog-backdrop">
      <button className="employer-attendance-dialog-scrim" type="button" onClick={onClose} aria-label="Close attendance details" />
      <section className="employer-attendance-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-dialog-title">
        <button className="employer-attendance-dialog-close" type="button" onClick={onClose} aria-label="Close attendance details">
          <X size={20} />
        </button>
        <h2 id="attendance-dialog-title">{attendance.worker_name}</h2>
        <p className="employer-attendance-dialog-subtitle">{attendance.job_title} · {attendance.site_name}</p>
        <div className="employer-attendance-detail-grid">
          <div><span>Date</span><strong>{formatDay(attendance.attendance_date)}</strong></div>
          <div><span>Status</span><strong><StatusBadge status={attendance.status} /></strong></div>
          <div><span>Check in</span><strong>{formatTime(attendance.check_in_at)}</strong></div>
          <div><span>Check out</span><strong>{formatTime(attendance.check_out_at)}</strong></div>
          <div><span>Hours worked</span><strong>{formatHours(attendance)}</strong></div>
        </div>
        {attendance.employer_manual_override && (
          <p className="employer-attendance-correction">
            <strong>Manually corrected.</strong> {attendance.correction_reason}
          </p>
        )}
        <button
          className="employer-primary-button employer-attendance-correct-button"
          type="button"
          onClick={() => {
            setForm({
              status: attendance.status,
              check_in_at: toDateTimeInput(attendance.check_in_at),
              check_out_at: toDateTimeInput(attendance.check_out_at),
              reason: "",
            });
            setSaveError("");
            setEdit(true);
          }}
        >
          Correct attendance
        </button>

        <div className="employer-attendance-history">
          <h3><FileClock size={17} aria-hidden="true" /> Attendance history</h3>
          {loading && <p className="employer-attendance-muted">Loading attendance history...</p>}
          {!loading && historyError && (
            <div className="employer-attendance-inline-error" role="alert">
              <p>{historyError}</p>
              <button type="button" onClick={() => {
                setLoading(true);
                setHistoryError("");
                setHistoryReload((current) => current + 1);
              }}>Try again</button>
            </div>
          )}
          {!loading && !historyError && audit.length === 0 && <p className="employer-attendance-muted">No changes have been recorded.</p>}
          {!loading && !historyError && audit.map((entry) => (
            <article className="employer-attendance-audit-entry" key={entry.id}>
              <strong>{entry.action.replaceAll("_", " ")}</strong>
              {entry.reason && <span>{entry.reason}</span>}
              <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("en-IN")}</time>
            </article>
          ))}
        </div>

        {edit && (
          <form className="employer-attendance-edit-form" onSubmit={(event) => void saveCorrection(event)}>
            <p>Changes are recorded in attendance history.</p>
            <label className="employer-attendance-field">
              <span>Status</span>
              <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as AttendanceStatus }))}>
                <option value="PRESENT">Present</option>
                <option value="LATE">Late</option>
                <option value="ABSENT">Absent</option>
              </select>
            </label>
            <label className="employer-attendance-field">
              <span>Check in</span>
              <input type="datetime-local" value={form.check_in_at} onChange={(event) => setForm((current) => ({ ...current, check_in_at: event.target.value }))} />
            </label>
            <label className="employer-attendance-field">
              <span>Check out</span>
              <input type="datetime-local" value={form.check_out_at} onChange={(event) => setForm((current) => ({ ...current, check_out_at: event.target.value }))} />
            </label>
            <label className="employer-attendance-field">
              <span>Reason for correction</span>
              <textarea required maxLength={500} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Explain why this attendance is being corrected" />
            </label>
            {saveError && <p className="employer-attendance-inline-error" role="alert">{saveError}</p>}
            <div className="employer-attendance-form-actions">
              <button type="button" className="employer-secondary-button" onClick={() => setEdit(false)}>Cancel</button>
              <button type="submit" className="employer-primary-button" disabled={saving}>{saving ? "Saving..." : "Save correction"}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export default function EmployerAttendanceScreen() {
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const [filters, setFilters] = useState(initialFilters);
  const [submitted, setSubmitted] = useState(initialFilters);
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [jobs, setJobs] = useState<SelectOption[]>([]);
  const [sites, setSites] = useState<SelectOption[]>([]);
  const [matchOptions, setMatchOptions] = useState<MatchOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsReload, setOptionsReload] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<AttendanceRecord | null>(null);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState("");
  const [markOpen, setMarkOpen] = useState(false);
  const [markForm, setMarkForm] = useState({
    job_match_id: "",
    attendance_date: localDate(),
    status: "PRESENT" as AttendanceStatus,
    reason: "",
  });

  useEffect(() => {
    if (authLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    let active = true;
    void Promise.allSettled([
      apiGet<SelectOption[]>("/api/v1/jobs"),
      apiGet<SelectOption[]>("/api/v1/job-sites/me"),
      apiGet<MatchOption[]>("/api/v1/employers/me/attendance/match-options"),
    ]).then((results) => {
      if (!active) return;
      const failures: string[] = [];
      if (results[0].status === "fulfilled") setJobs(results[0].value);
      else failures.push("jobs");
      if (results[1].status === "fulfilled") setSites(results[1].value);
      else failures.push("work sites");
      if (results[2].status === "fulfilled") setMatchOptions(results[2].value);
      else failures.push("accepted job matches");
      if (failures.length) setOptionsError(`Unable to load ${failures.join(", ")}.`);
      else setOptionsError("");
      setOptionsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [authLoading, nextStep, optionsReload, user]);

  useEffect(() => {
    if (authLoading || !user || user.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    let active = true;
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    Object.entries(submitted).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    void apiGet<AttendanceResponse>(`/api/v1/employers/me/attendance?${params.toString()}`)
      .then((response) => {
        if (active) setData(response);
      })
      .catch((requestError: unknown) => {
        if (active) setError(attendanceError(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, nextStep, page, reload, submitted, user]);

  useRefreshOnFocus(() => {
    setLoading(true);
    setError("");
    setOptionsLoading(true);
    setOptionsError("");
    setReload((current) => current + 1);
    setOptionsReload((current) => current + 1);
  }, !authLoading && user?.role === "EMPLOYER" && nextStep === "DASHBOARD" && !marking && !markOpen);

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (user.role !== "EMPLOYER") return <Navigate to={user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setPage(1);
    setSubmitted({ ...filters });
  };

  const clearFilters = () => {
    const cleared = { ...initialFilters, date: "" };
    setLoading(true);
    setError("");
    setFilters(cleared);
    setSubmitted(cleared);
    setPage(1);
  };

  const markAttendance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!markForm.job_match_id || !markForm.reason.trim()) return;
    setMarking(true);
    setMarkError("");
    try {
      await apiPost("/api/v1/employers/me/attendance/mark", { ...markForm, reason: markForm.reason.trim() });
      setMarkForm({ job_match_id: "", attendance_date: localDate(), status: "PRESENT", reason: "" });
      setMarkOpen(false);
      setLoading(true);
      setError("");
      setPage(1);
      setReload((current) => current + 1);
    } catch (requestError: unknown) {
      setMarkError(attendanceError(requestError));
    } finally {
      setMarking(false);
    }
  };

  const refreshAfterCorrection = () => {
    setSelected(null);
    setLoading(true);
    setError("");
    setReload((current) => current + 1);
  };

  const changePage = (nextPage: number) => {
    setLoading(true);
    setError("");
    setPage(nextPage);
  };

  const retryHistory = () => {
    setLoading(true);
    setError("");
    setReload((current) => current + 1);
  };

  return (
    <EmployerMobileShell name={user.name} employerType={user.employer_type} profilePhotoUrl={user.profile_photo_url}>
      <main className="employer-dashboard employer-attendance-page">
        <header className="employer-attendance-heading">
          <div>
            <p className="employer-eyebrow">Employer workspace</p>
            <h1>Attendance</h1>
            <p>Track attendance for workers hired through GO LESKA.</p>
          </div>
          <button type="button" className="employer-secondary-button employer-attendance-mark-button" onClick={() => {
            setMarkError("");
            setMarkOpen(true);
          }}>
            Mark attendance
          </button>
        </header>

        <section className="employer-attendance-summary" aria-label="Attendance summary">
          <article className="employer-summary-card">
            <p>Present</p>
            <strong className="is-present">{data?.present_count ?? 0}</strong>
          </article>
          <article className="employer-summary-card">
            <p>Late</p>
            <strong className="is-late">{data?.late_count ?? 0}</strong>
          </article>
          <article className="employer-summary-card">
            <p>Absent</p>
            <strong className="is-absent">{data?.absent_count ?? 0}</strong>
          </article>
        </section>

        <form className="employer-attendance-filters employer-section-card" onSubmit={applyFilters}>
          <label className="employer-attendance-field">
            <span>Date</span>
            <input type="date" value={filters.date} onChange={(event) => updateFilter("date", event.target.value)} />
          </label>
          <label className="employer-attendance-field">
            <span>Search worker</span>
            <span className="employer-attendance-search">
              <Search size={17} aria-hidden="true" />
              <input value={filters.worker} onChange={(event) => updateFilter("worker", event.target.value)} placeholder="Worker name" />
            </span>
          </label>
          <label className="employer-attendance-field">
            <span>Job</span>
            <select value={filters.job_id} onChange={(event) => updateFilter("job_id", event.target.value)}>
              <option value="">All jobs</option>
              {jobs.map((job) => <option key={job.id} value={job.id}>{job.title || "Job"}</option>)}
            </select>
          </label>
          <label className="employer-attendance-field">
            <span>Work site</span>
            <select value={filters.job_site_id} onChange={(event) => updateFilter("job_site_id", event.target.value)}>
              <option value="">All sites</option>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name || "Work site"}</option>)}
            </select>
          </label>
          <label className="employer-attendance-field">
            <span>Status</span>
            <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
              <option value="">All statuses</option>
              <option value="PRESENT">Present</option>
              <option value="LATE">Late</option>
              <option value="ABSENT">Absent</option>
            </select>
          </label>
          <button type="submit" className="employer-primary-button employer-attendance-filter-button">
            <Search size={16} aria-hidden="true" /> Filter
          </button>
          {Object.values(submitted).some(Boolean) && (
            <button className="employer-attendance-clear" type="button" onClick={clearFilters}>
              <X size={15} aria-hidden="true" /> Clear filters
            </button>
          )}
        </form>

        {optionsError && (
          <div className="employer-attendance-options-error" role="alert">
            <span>{optionsError}</span>
            <button type="button" onClick={() => {
              setOptionsLoading(true);
              setOptionsError("");
              setOptionsReload((current) => current + 1);
            }} disabled={optionsLoading}>{optionsLoading ? "Loading..." : "Try again"}</button>
          </div>
        )}
        {loading && (
          <div className="employer-attendance-state" role="status">
            <LoaderCircle size={20} className="spin" />
            <span>Loading attendance...</span>
          </div>
        )}
        {!loading && error && (
          <div className="employer-attendance-state employer-attendance-load-error" role="alert">
            <p>{error}</p>
            <button type="button" className="employer-primary-button" onClick={retryHistory}>Try again</button>
          </div>
        )}
        {!loading && !error && data?.items.length === 0 && (
          <div className="employer-attendance-state employer-attendance-empty">
            <Clock3 size={34} aria-hidden="true" />
            <h2>No attendance records</h2>
            <p>No attendance has been recorded for this date.</p>
          </div>
        )}
        {!loading && !error && data && data.items.length > 0 && (
          <section className="employer-attendance-results" aria-label="Attendance records">
            <div className="employer-attendance-count">
              <strong>{data.total} record{data.total === 1 ? "" : "s"}</strong>
              <span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span>
            </div>
            {data.items.map((item) => (
              <article className="employer-attendance-record employer-section-card" key={item.id}>
                <div className="employer-attendance-record-heading">
                  <div>
                    <h2>{item.worker_name}</h2>
                    <p>{item.job_title} · {item.site_name}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <div className="employer-attendance-record-grid">
                  <div><span>Date</span><strong>{formatDay(item.attendance_date)}</strong></div>
                  <div><span>Check in</span><strong>{formatTime(item.check_in_at)}</strong></div>
                  <div><span>Check out</span><strong>{formatTime(item.check_out_at)}</strong></div>
                  <div><span>Hours</span><strong>{formatHours(item)}</strong></div>
                </div>
                <button type="button" className="employer-attendance-details-button" onClick={() => setSelected(item)}>View details</button>
              </article>
            ))}
            <nav className="employer-attendance-pagination" aria-label="Attendance pages">
              <button type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>Previous</button>
              <button type="button" disabled={!data.has_more} onClick={() => changePage(page + 1)}>Next</button>
            </nav>
          </section>
        )}
      </main>

      {markOpen && (
        <div className="employer-attendance-dialog-backdrop">
          <button type="button" className="employer-attendance-dialog-scrim" onClick={() => setMarkOpen(false)} aria-label="Close mark attendance" />
          <form className="employer-attendance-dialog employer-attendance-mark-dialog" onSubmit={(event) => void markAttendance(event)}>
            <button type="button" className="employer-attendance-dialog-close" onClick={() => setMarkOpen(false)} aria-label="Close mark attendance"><X size={20} /></button>
            <h2>Mark attendance</h2>
            <p className="employer-attendance-dialog-subtitle">Changes are recorded in attendance history.</p>
            <label className="employer-attendance-field">
              <span>Accepted job match</span>
              <select required value={markForm.job_match_id} onChange={(event) => setMarkForm((current) => ({ ...current, job_match_id: event.target.value }))}>
                <option value="">{optionsLoading ? "Loading accepted matches..." : "Select worker and job"}</option>
                {matchOptions.map((match) => (
                  <option key={match.job_match_id} value={match.job_match_id}>
                    {match.worker_name} · {match.job_title} · {match.site_name}
                  </option>
                ))}
              </select>
            </label>
            {matchOptions.length === 0 && !optionsLoading && (
              <p className="employer-attendance-muted">No accepted job matches are available for manual attendance.</p>
            )}
            <label className="employer-attendance-field">
              <span>Date</span>
              <input type="date" required value={markForm.attendance_date} onChange={(event) => setMarkForm((current) => ({ ...current, attendance_date: event.target.value }))} />
            </label>
            <label className="employer-attendance-field">
              <span>Status</span>
              <select value={markForm.status} onChange={(event) => setMarkForm((current) => ({ ...current, status: event.target.value as AttendanceStatus }))}>
                <option value="PRESENT">Present</option>
                <option value="LATE">Late</option>
                <option value="ABSENT">Absent</option>
              </select>
            </label>
            <label className="employer-attendance-field">
              <span>Reason for manual marking</span>
              <textarea required maxLength={500} value={markForm.reason} onChange={(event) => setMarkForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason for manual marking" />
            </label>
            {markError && <p className="employer-attendance-inline-error" role="alert">{markError}</p>}
            <div className="employer-attendance-form-actions">
              <button type="button" className="employer-secondary-button" onClick={() => setMarkOpen(false)}>Cancel</button>
              <button type="submit" className="employer-primary-button" disabled={marking || optionsLoading || matchOptions.length === 0}>{marking ? "Saving..." : "Save attendance"}</button>
            </div>
          </form>
        </div>
      )}
      {selected && <AttendanceDialog record={selected} onClose={() => setSelected(null)} onSaved={refreshAfterCorrection} />}
    </EmployerMobileShell>
  );
}
