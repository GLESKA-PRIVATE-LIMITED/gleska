import { useCallback, useEffect, useState } from "react";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { apiGet } from "../../lib/api";
import WorkerMobileShell from "./WorkerMobileShell";

type WorkRecord = {
  match_id: string;
  job_id: string;
  title: string;
  employer_name?: string | null;
  status: string;
  completed_at?: string | null;
};

type WorkerJobsResponse = {
  recent_jobs?: WorkRecord[];
};

function formatCompletionDate(value?: string | null) {
  if (!value) return "Date unavailable";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function WorkerCompaniesWorkedScreen() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRecords = useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setLoading(true);
    setError("");
    try {
      const response = await apiGet<WorkerJobsResponse>("/api/v1/workers/me/jobs");
      setRecords(response.recent_jobs || []);
    } catch {
      setError("Unable to load your work history right now.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) {
      navigate(user ? "/worker/auth" : "/auth/signin", { replace: true });
      return;
    }
    if (!user || isLoading) return;
    void loadRecords();
  }, [isLoading, loadRecords, navigate, user]);

  return (
    <WorkerMobileShell>
      <main className="worker-companies-worked">
        <p className="worker-companies-worked-eyebrow">Worker workspace</p>
        <h1 className="worker-companies-worked-title">Companies worked</h1>
        <p className="worker-companies-worked-subtitle">Completed jobs from your accepted work history.</p>

        {loading ? (
          <div className="worker-companies-worked-loading" role="status">
            <Loader2 size={18} className="worker-companies-worked-spinner" />
            <span>Loading work history...</span>
          </div>
        ) : error ? (
          <div className="worker-companies-worked-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void loadRecords()} className="worker-companies-worked-retry">
              Try again
            </button>
          </div>
        ) : records.length ? (
          <div className="worker-companies-worked-list">
            {records.map((record) => (
              <article key={record.match_id} className="worker-companies-worked-card">
                <div className="worker-companies-worked-card-heading">
                  <div className="worker-companies-worked-company">
                    <div className="worker-companies-worked-icon">
                      <Building2 size={20} />
                    </div>
                    <div className="worker-companies-worked-copy">
                      <h2>{record.employer_name || "Employer"}</h2>
                      <p>{record.title || "Completed job"}</p>
                    </div>
                  </div>
                  <CheckCircle2 size={19} className="worker-companies-worked-completed-icon" aria-label="Completed" />
                </div>
                <p className="worker-companies-worked-label">Completed</p>
                <p className="worker-companies-worked-date">{formatCompletionDate(record.completed_at)}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="worker-companies-worked-empty">
            <Building2 size={30} className="worker-companies-worked-empty-icon" />
            <p>No completed work records yet.</p>
          </div>
        )}
      </main>
    </WorkerMobileShell>
  );
}