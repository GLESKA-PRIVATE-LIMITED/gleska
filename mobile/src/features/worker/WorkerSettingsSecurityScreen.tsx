import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCircle2, LoaderCircle, Monitor, RefreshCw, ShieldCheck, Smartphone, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth, errorMessage } from "../auth/AuthProvider";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { getSessionKey } from "../../lib/session";
import WorkerMobileShell from "./WorkerMobileShell";
import "./WorkerSettingsSecurityScreen.css";

type WorkerPreferences = {
  job_matching_notifications: boolean;
  attendance_notifications: boolean;
  security_alerts: boolean;
};

type PreferenceKey = keyof WorkerPreferences;

type SecuritySession = {
  id: string;
  device_name?: string | null;
  browser?: string | null;
  os?: string | null;
  city?: string | null;
  country?: string | null;
  first_seen: string;
  last_active: string;
  is_current: boolean;
};

type SecurityActivity = {
  id: string;
  event_type: string;
  description?: string | null;
  device_name?: string | null;
  city?: string | null;
  country?: string | null;
  created_at: string;
};

type SecurityData = { sessions: SecuritySession[]; activities: SecurityActivity[] };

const preferenceItems: { key: PreferenceKey; label: string; description: string }[] = [
  { key: "job_matching_notifications", label: "Job & matching notifications", description: "Updates about jobs and match opportunities." },
  { key: "attendance_notifications", label: "Attendance notifications", description: "Updates related to attendance." },
  { key: "security_alerts", label: "Security alerts", description: "Alerts about account security activity." },
];

const formatDate = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function PreferenceRow({
  label,
  description,
  checked,
  disabled,
  saving,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  onToggle: () => void;
}) {
  return (
    <button className="worker-settings-security-preference" type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={onToggle}>
      <span className="worker-settings-security-preference-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
      <span className={`worker-settings-security-toggle${checked ? " is-on" : ""}`} aria-hidden="true">
        <span />
      </span>
      {saving && <LoaderCircle className="worker-settings-security-saving-icon spin" size={16} aria-label="Saving" />}
    </button>
  );
}

export default function WorkerSettingsSecurityScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState<WorkerPreferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesError, setPreferencesError] = useState("");
  const [savingPreference, setSavingPreference] = useState<PreferenceKey | null>(null);
  const [security, setSecurity] = useState<SecurityData | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securityError, setSecurityError] = useState("");
  const [sessionToRevoke, setSessionToRevoke] = useState<SecuritySession | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const loadPreferences = useCallback(async () => {
    if (!auth.user || auth.user.role !== "WORKER") return;
    setPreferencesLoading(true);
    setPreferencesError("");
    try {
      setPreferences(await apiGet<WorkerPreferences>("/api/v1/workers/me/preferences"));
    } catch (error) {
      setPreferencesError(errorMessage(error));
    } finally {
      setPreferencesLoading(false);
    }
  }, [auth.user]);

  const loadSecurity = useCallback(async () => {
    if (!auth.user || auth.user.role !== "WORKER") return;
    setSecurityLoading(true);
    setSecurityError("");
    try {
      setSecurity(await apiGet<SecurityData>("/api/v1/workers/me/security", {
        headers: { "X-Goleska-Session-Key": getSessionKey() },
      }));
    } catch (error) {
      setSecurityError(errorMessage(error));
    } finally {
      setSecurityLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    if (auth.isLoading) return;
    if (!auth.user || auth.user.role !== "WORKER") {
      navigate("/auth/signin", { replace: true });
      return;
    }
    void Promise.resolve().then(() => Promise.all([loadPreferences(), loadSecurity()]));
  }, [auth.isLoading, auth.user, loadPreferences, loadSecurity, navigate]);

  const refresh = () => {
    setStatusMessage("");
    void Promise.all([loadPreferences(), loadSecurity()]);
  };

  const updatePreference = async (key: PreferenceKey) => {
    if (!preferences || savingPreference) return;
    setSavingPreference(key);
    setPreferencesError("");
    setStatusMessage("");
    try {
      setPreferences(await apiPut<WorkerPreferences>("/api/v1/workers/me/preferences", { [key]: !preferences[key] }));
      setStatusMessage("Settings saved.");
    } catch (error) {
      setPreferencesError(errorMessage(error));
    } finally {
      setSavingPreference(null);
    }
  };

  const revokeSession = async () => {
    if (!sessionToRevoke || revokingId) return;
    const selectedSession = sessionToRevoke;
    setRevokingId(selectedSession.id);
    setSecurityError("");
    setStatusMessage("");
    try {
      await apiPost(`/api/v1/workers/me/security/sessions/${encodeURIComponent(selectedSession.id)}/revoke`);
      setSessionToRevoke(null);
      if (selectedSession.is_current) {
        await auth.logout();
        navigate("/auth/signin", { replace: true });
        return;
      }
      setStatusMessage(`Session revoked: ${selectedSession.device_name || "Unknown device"}.`);
      await loadSecurity();
    } catch (error) {
      setSecurityError(errorMessage(error));
      setSessionToRevoke(null);
    } finally {
      setRevokingId(null);
    }
  };

  if (auth.isLoading || !auth.user || auth.user.role !== "WORKER") {
    return <WorkerMobileShell><main className="worker-dashboard worker-settings-security-page"><div className="worker-dashboard-state"><LoaderCircle size={18} className="icon-secondary spin" /><span>Loading settings &amp; security...</span></div></main></WorkerMobileShell>;
  }

  return (
    <WorkerMobileShell>
      <main className="worker-dashboard worker-settings-security-page">
        <header className="worker-dashboard-header worker-settings-security-header">
          <div><p className="worker-page-eyebrow">Worker workspace</p><h1>Settings &amp; Security</h1><p>Manage notification preferences and review active sessions.</p></div>
          <button type="button" className="worker-refresh-button" onClick={refresh} aria-label="Refresh settings and security">
            <RefreshCw size={16} /><span>Refresh</span>
          </button>
        </header>

        {statusMessage && <p className="worker-settings-security-success" role="status"><CheckCircle2 size={17} />{statusMessage}</p>}

        <section className="worker-card worker-settings-security-card">
          <div className="worker-settings-security-section-heading"><span className="worker-settings-security-icon"><Bell size={20} /></span><div><h2>Settings</h2><p>Notification preferences</p></div></div>
          {preferencesLoading ? <div className="worker-dashboard-state"><LoaderCircle size={18} className="icon-secondary spin" /><span>Loading preferences...</span></div> : preferencesError && !preferences ? (
            <div className="worker-settings-security-error" role="alert"><p>{preferencesError}</p><button type="button" className="worker-secondary-button" onClick={() => void loadPreferences()}>Try again</button></div>
          ) : (
            <div className="worker-settings-security-list">
              {preferencesError && <p className="worker-settings-security-error-message" role="alert">{preferencesError}</p>}
              {preferenceItems.map(({ key, label, description }) => (
                <PreferenceRow key={key} label={label} description={description} checked={Boolean(preferences?.[key])} disabled={!preferences || savingPreference !== null} saving={savingPreference === key} onToggle={() => void updatePreference(key)} />
              ))}
              {savingPreference && <p className="worker-settings-security-saving" role="status"><LoaderCircle size={16} className="spin" />Saving setting...</p>}
            </div>
          )}
        </section>

        <section className="worker-card worker-settings-security-card">
          <div className="worker-settings-security-section-heading"><span className="worker-settings-security-icon"><ShieldCheck size={20} /></span><div><h2>Security</h2><p>Active sessions and recent activity</p></div></div>
          {securityLoading ? <div className="worker-dashboard-state"><LoaderCircle size={18} className="icon-secondary spin" /><span>Loading security activity...</span></div> : securityError && !security ? (
            <div className="worker-settings-security-error" role="alert"><p>{securityError}</p><button type="button" className="worker-secondary-button" onClick={() => void loadSecurity()}>Try again</button></div>
          ) : securityError ? (
            <div className="worker-settings-security-error" role="alert"><p>{securityError}</p><button type="button" className="worker-secondary-button" onClick={() => void loadSecurity()}>Try again</button></div>
          ) : (
            <div className="worker-settings-security-content">
              <section>
                <h3>Active sessions <span>({security?.sessions.length ?? 0})</span></h3>
                {security?.sessions.length ? <div className="worker-settings-security-list">
                  {security.sessions.map((session) => {
                    const location = [session.city, session.country].filter(Boolean).join(", ");
                    const browserOs = [session.browser, session.os].filter(Boolean).join(" · ");
                    return <article className="worker-settings-security-session" key={session.id}>
                      <div className="worker-settings-security-session-main">
                        {session.device_name?.toLowerCase().includes("mobile") ? <Smartphone size={20} /> : <Monitor size={20} />}
                        <div className="worker-settings-security-session-copy">
                          <p className="worker-settings-security-session-title">{session.device_name || "Unknown device"}{session.is_current && <span className="worker-settings-security-current"><CheckCircle2 size={13} />Current</span>}</p>
                          {browserOs && <p>Reported browser / OS: {browserOs}</p>}
                          {location && <p>Approximate location: {location}</p>}
                          <p>First seen {formatDate(session.first_seen)}</p><p>Last active {formatDate(session.last_active)}</p>
                        </div>
                      </div>
                      <button type="button" className="worker-settings-security-revoke" disabled={revokingId === session.id} onClick={() => setSessionToRevoke(session)}>{session.is_current ? "Sign out this session" : "Revoke session"}</button>
                    </article>;
                  })}
                </div> : <div className="worker-dashboard-empty"><Monitor size={24} /><p>No active sessions found.</p></div>}
              </section>

              <section>
                <h3>Recent security activity</h3>
                {security?.activities.length ? <div className="worker-settings-security-list">
                  {security.activities.map((activity) => {
                    const location = [activity.city, activity.country].filter(Boolean).join(", ");
                    return <article className="worker-settings-security-activity" key={activity.id}>
                      <div><strong>{activity.event_type.replaceAll("_", " ")}</strong><p>{activity.description || "Security activity recorded"}</p>{activity.device_name && <small>{activity.device_name}</small>}{location && <small>Approximate location: {location}</small>}</div>
                      <time>{formatDate(activity.created_at)}</time>
                    </article>;
                  })}
                </div> : <div className="worker-dashboard-empty"><ShieldCheck size={24} /><p>No recent security activity.</p></div>}
              </section>
            </div>
          )}
        </section>

        {sessionToRevoke && <div className="worker-settings-security-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && revokingId === null) setSessionToRevoke(null); }}>
          <section className="worker-settings-security-dialog" role="dialog" aria-modal="true" aria-labelledby="worker-revoke-session-title">
            <div className="worker-settings-security-dialog-heading"><div><h2 id="worker-revoke-session-title">{sessionToRevoke.is_current ? "Sign out this device?" : "Revoke this session?"}</h2><p>{sessionToRevoke.is_current ? "You will be signed out of this device after its session is revoked." : `This will sign out ${sessionToRevoke.device_name || "the selected device"}.`}</p></div><button type="button" aria-label="Close confirmation" disabled={revokingId !== null} onClick={() => setSessionToRevoke(null)}><X size={19} /></button></div>
            <div className="worker-settings-security-dialog-actions"><button type="button" className="worker-secondary-button" disabled={revokingId !== null} onClick={() => setSessionToRevoke(null)}>Cancel</button><button type="button" className="worker-settings-security-revoke worker-settings-security-revoke--confirm" disabled={revokingId !== null} onClick={() => void revokeSession()}>{revokingId ? <><LoaderCircle size={16} className="spin" />Revoking...</> : "Confirm"}</button></div>
          </section>
        </div>}
      </main>
    </WorkerMobileShell>
  );
}