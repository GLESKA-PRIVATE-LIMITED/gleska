import { useCallback, useEffect, useState } from "react";
import { Clock3, MapPin, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import WorkerMobileShell from "./WorkerMobileShell";

type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT";

type AttendanceRecord = {
  id: string;
  attendance_date: string;
  job_title: string;
  site_name: string;
  status: AttendanceStatus;
  check_in_at?: string | null;
  check_out_at?: string | null;
};

type AttendanceResponse = {
  items: AttendanceRecord[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
};

type ActiveJob = {
  match_id: string;
  title: string;
} | null;

const formatTime = (value?: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};

const formatDuration = (checkIn?: string | null, checkOut?: string | null) => {
  if (!checkIn || !checkOut) return "-";
  const minutes = Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
};

const formatDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function getBrowserLocation(): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  if (!navigator.geolocation) {
    throw new Error("Location unavailable");
  }

  const getPosition = (options: PositionOptions): Promise<GeolocationPosition> => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });

  return getPosition({ enableHighAccuracy: false, maximumAge: 300000, timeout: 30000 })
    .catch((error: GeolocationPositionError) => {
      const code = error.code;
      if (code !== 2 && code !== 3) throw error;
      return getPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 45000 });
    })
    .then((position) => {
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("Invalid location coordinates");
      }
      if (accuracy <= 0 || accuracy > 1000) {
        throw new Error("Location accuracy is too low");
      }
      return { latitude, longitude, accuracy };
    });
}

function attendanceMessage(error: unknown): string {
  const detail = error instanceof ApiError ? error.detail : undefined;
  const detailObject = typeof detail === "object" && detail !== null ? detail as Record<string, unknown> : {};
  const code = typeof detailObject.code === "string" ? detailObject.code : typeof detail === "string" ? detail : undefined;
  const messageMap: Record<string, string> = {
    OUTSIDE_ATTENDANCE_GEOFENCE: "You’re too far from the work site to check in.",
    CURRENT_LOCATION_REQUIRED: "Location is required for attendance.",
    INVALID_GPS_ACCURACY: "Your location is not accurate enough. Please try again.",
    ATTENDANCE_ALREADY_EXISTS: "You’re already checked in.",
    ATTENDANCE_ALREADY_CHECKED_OUT: "You’re already checked out.",
    CHECK_IN_REQUIRED: "You can’t check out because you haven’t checked in.",
  };

  if (code && code in messageMap) return messageMap[code];
  if (error instanceof Error) return error.message;
  return "Unable to update attendance right now.";
}

export default function WorkerAttendanceScreen() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const [today, setToday] = useState<AttendanceRecord | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob>(null);
  const [history, setHistory] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"check-in" | "check-out" | null>(null);
  const [error, setError] = useState("");

  const loadAttendance = useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setLoading(true);
    setError("");

    try {
      const [jobs, current, records] = await Promise.all([
        apiGet<{ active_job?: ActiveJob }>('/api/v1/workers/me/jobs'),
        apiGet<{ items: AttendanceRecord[] }>('/api/v1/workers/me/attendance/today'),
        apiGet<AttendanceResponse>('/api/v1/workers/me/attendance?page=1&limit=10'),
      ]);

      setActiveJob(jobs.active_job ?? null);
      setToday(current.items?.[0] ?? null);
      setHistory(records);
    } catch {
      setError("Unable to load attendance right now.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user && !isLoading) {
      navigate("/auth/signin", { replace: true });
      return;
    }
    if (user && user.role !== "WORKER" && !isLoading) {
      navigate("/worker/auth", { replace: true });
      return;
    }
    if (!user || isLoading) return;

    void loadAttendance();
  }, [isLoading, loadAttendance, navigate, user]);

  const act = async (kind: "check-in" | "check-out") => {
    if (action) return;
    if (kind === "check-in" && !activeJob) return;
    if (kind === "check-out" && !today) return;

    setAction(kind);
    setError("");

    try {
      const location = await getBrowserLocation();
      const payload = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
      };

      if (kind === "check-in") {
        await apiPost('/api/v1/workers/me/attendance/check-in', { ...payload, job_match_id: activeJob?.match_id });
      } else {
        await apiPost('/api/v1/workers/me/attendance/check-out', { ...payload, attendance_id: today?.id });
      }

      await loadAttendance();
    } catch (requestError) {
      setError(attendanceMessage(requestError));
    } finally {
      setAction(null);
    }
  };

  const emptyHistory = !history || history.items.length === 0;

  return (
    <WorkerMobileShell>
      <main className="worker-dashboard worker-attendance-page">
        <header className="worker-dashboard-header worker-attendance-header">
          <div>
            <p className="worker-page-eyebrow">Worker workspace</p>
            <h1>Attendance</h1>
          </div>
          <button type="button" className="worker-refresh-button" onClick={() => void loadAttendance()}>
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
        </header>

        <section className="worker-card worker-attendance-card">
          <div className="worker-attendance-header-row">
            <div>
              <p className="worker-section-label">Today</p>
              <h2>{today?.job_title || activeJob?.title || "No accepted job"}</h2>
              <p className="worker-attendance-subtitle">
                {today?.site_name || "Attendance becomes available after a job match is accepted."}
              </p>
            </div>
            {today && <span className="worker-status-badge">{today.status}</span>}
          </div>

          {error && <p className="worker-attendance-alert" role="alert">{error}</p>}

          <div className="worker-attendance-actions">
            <button
              type="button"
              className="worker-primary-button"
              disabled={Boolean(action) || Boolean(today) || !activeJob}
              onClick={() => void act("check-in")}
            >
              {action === "check-in" ? "Checking you in..." : "Check in"}
            </button>
            <button
              type="button"
              className="worker-secondary-button"
              disabled={Boolean(action) || !today || Boolean(today?.check_out_at)}
              onClick={() => void act("check-out")}
            >
              {action === "check-out" ? "Checking you out..." : "Check out"}
            </button>
          </div>

          {today && (
            <div className="worker-attendance-inline-metrics">
              <div>
                <span>Check in</span>
                <strong>{formatTime(today.check_in_at)}</strong>
              </div>
              <div>
                <span>Check out</span>
                <strong>{formatTime(today.check_out_at)}</strong>
              </div>
              <div>
                <span>Duration</span>
                <strong>{formatDuration(today.check_in_at, today.check_out_at)}</strong>
              </div>
            </div>
          )}
        </section>

        {loading ? (
          <div className="worker-dashboard-state">
            <Clock3 size={18} className="icon-secondary" />
            <span>Loading attendance...</span>
          </div>
        ) : error && !today && emptyHistory ? (
          <div className="worker-dashboard-error-card">
            <p className="worker-dashboard-error-text">{error}</p>
            <button type="button" onClick={() => void loadAttendance()} className="worker-retry-button">
              Try again
            </button>
          </div>
        ) : (
          <section className="worker-card worker-attendance-history">
            <div className="worker-attendance-header-row worker-attendance-history-header">
              <div>
                <p className="worker-section-label">Recent record</p>
                <h3>Attendance history</h3>
              </div>
            </div>

            {emptyHistory ? (
              <div className="worker-empty-card">
                <MapPin size={24} className="icon-secondary" />
                <p>No attendance records yet.</p>
              </div>
            ) : (
              <div className="worker-attendance-list">
                {history?.items.map((item) => (
                  <article key={item.id} className="worker-attendance-item">
                    <div className="worker-attendance-item-header">
                      <div>
                        <strong>{item.job_title}</strong>
                        <span>{item.site_name}</span>
                      </div>
                      <span className="worker-status-badge worker-status-badge--small">{item.status}</span>
                    </div>

                    <div className="worker-attendance-meta">
                      <div>
                        <span>Date</span>
                        <strong>{formatDate(item.attendance_date)}</strong>
                      </div>
                      <div>
                        <span>Check in</span>
                        <strong>{formatTime(item.check_in_at)}</strong>
                      </div>
                      <div>
                        <span>Check out</span>
                        <strong>{formatTime(item.check_out_at)}</strong>
                      </div>
                      <div>
                        <span>Hours</span>
                        <strong>{formatDuration(item.check_in_at, item.check_out_at)}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </WorkerMobileShell>
  );
}
