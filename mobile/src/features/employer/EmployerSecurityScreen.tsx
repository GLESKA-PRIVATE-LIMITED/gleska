import { useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  LoaderCircle,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, apiGet, apiPost, apiPut } from "../../lib/api";
import { getSessionKey } from "../../lib/session";
import { useAuth } from "../auth/AuthProvider";
import EmployerMobileShell from "./EmployerMobileShell";

type EmployerPreferences = {
  job_matching_notifications: boolean;
  attendance_notifications: boolean;
  security_alerts: boolean;
};

type PreferenceKey = keyof EmployerPreferences;

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
  browser?: string | null;
  os?: string | null;
  city?: string | null;
  country?: string | null;
  created_at: string;
};

type SecurityData = {
  sessions: SecuritySession[];
  activities: SecurityActivity[];
  activity_count?: number | null;
  next_cursor?: string | null;
};

type NotificationItem = {
  id: string;
  category: "job_matching" | "attendance" | "security";
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};

type NotificationData = {
  notifications: NotificationItem[];
  unread_count: number;
};

const preferenceItems: { key: PreferenceKey; label: string; description: string }[] = [
  { key: "job_matching_notifications", label: "Job / matching notifications", description: "Updates when relevant job or worker matches are available." },
  { key: "attendance_notifications", label: "Attendance notifications", description: "Updates for check-in, check-out, and attendance changes." },
  { key: "security_alerts", label: "Security alerts", description: "In-app alerts for sign-ins, sign-outs, session revocations, and password changes." },
];

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

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
    <button
      className="employer-security-preference"
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="employer-security-preference-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
      <span className={`employer-security-toggle${checked ? " is-on" : ""}`} aria-hidden="true"><span /></span>
      {saving && <LoaderCircle className="employer-security-saving-icon spin" size={16} aria-label="Saving" />}
    </button>
  );
}

function SectionHeading({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="employer-security-section-heading">
      <span className="employer-security-section-icon">{icon}</span>
      <div><h2>{title}</h2><p>{description}</p></div>
    </div>
  );
}

export default function EmployerSecurityScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState<EmployerPreferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesError, setPreferencesError] = useState("");
  const [savingPreference, setSavingPreference] = useState<PreferenceKey | null>(null);
  const [security, setSecurity] = useState<SecurityData | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securityError, setSecurityError] = useState("");
  const [notifications, setNotifications] = useState<NotificationData | null>(null);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState("");
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null);
  const [sessionToRevoke, setSessionToRevoke] = useState<SecuritySession | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (auth.isLoading || !auth.user || auth.user.role !== "EMPLOYER") return;
    let active = true;
    void apiGet<EmployerPreferences>("/api/v1/employers/me/preferences")
      .then((response) => {
        if (active) setPreferences(response);
      })
      .catch((error: unknown) => {
        if (active) setPreferencesError(errorMessage(error, "Unable to load your saved notification preferences."));
      })
      .finally(() => {
        if (active) setPreferencesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.isLoading, auth.user, reloadToken]);

  useEffect(() => {
    if (auth.isLoading || !auth.user || auth.user.role !== "EMPLOYER") return;
    let active = true;
    void apiGet<SecurityData>("/api/v1/employers/me/security", {
      headers: { "X-Goleska-Session-Key": getSessionKey() },
    })
      .then((response) => {
        if (active) setSecurity(response);
      })
      .catch((error: unknown) => {
        if (active) setSecurityError(errorMessage(error, "Unable to load your security activity."));
      })
      .finally(() => {
        if (active) setSecurityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.isLoading, auth.user, reloadToken]);

  useEffect(() => {
    if (auth.isLoading || !auth.user || auth.user.role !== "EMPLOYER") return;
    let active = true;
    void apiGet<NotificationData>("/api/v1/notifications?limit=50")
      .then((response) => {
        if (active) setNotifications(response);
      })
      .catch((error: unknown) => {
        if (active) setNotificationsError(errorMessage(error, "Unable to load notifications. Please try again."));
      })
      .finally(() => {
        if (active) setNotificationsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.isLoading, auth.user, reloadToken]);

  if (auth.isLoading) {
    return (
      <EmployerMobileShell>
        <main className="employer-dashboard"><div className="employer-security-state" role="status"><LoaderCircle size={20} className="spin" /> Loading settings &amp; security...</div></main>
      </EmployerMobileShell>
    );
  }
  if (!auth.user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (auth.user.role !== "EMPLOYER") return <Navigate to={auth.user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  if (auth.nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;

  const refresh = () => {
    setStatusMessage("");
    setPreferencesLoading(true);
    setPreferencesError("");
    setSecurityLoading(true);
    setSecurityError("");
    setNotificationsLoading(true);
    setNotificationsError("");
    setReloadToken((current) => current + 1);
  };

  const updatePreference = async (key: PreferenceKey) => {
    if (!preferences || savingPreference) return;
    setSavingPreference(key);
    setPreferencesError("");
    setStatusMessage("");
    try {
      setPreferences(await apiPut<EmployerPreferences>("/api/v1/employers/me/preferences", { [key]: !preferences[key] }));
      setStatusMessage("Notification preference saved.");
    } catch (error: unknown) {
      setPreferencesError(errorMessage(error, "Unable to save this setting. Your saved value has not changed."));
    } finally {
      setSavingPreference(null);
    }
  };

  const markNotificationRead = async (notification: NotificationItem) => {
    if (notification.read_at || markingNotificationId) return;
    setMarkingNotificationId(notification.id);
    setNotificationsError("");
    try {
      const response = await apiPost<{ success: boolean; notification: NotificationItem }>(
        `/api/v1/notifications/${encodeURIComponent(notification.id)}/read`,
      );
      setNotifications((current) => current && ({
        unread_count: Math.max(0, current.unread_count - 1),
        notifications: current.notifications.map((item) => item.id === notification.id ? response.notification : item),
      }));
    } catch (error: unknown) {
      setNotificationsError(errorMessage(error, "Unable to mark this notification as read."));
    } finally {
      setMarkingNotificationId(null);
    }
  };

  const revokeSession = async () => {
    if (!sessionToRevoke || revokingId) return;
    const selectedSession = sessionToRevoke;
    setRevokingId(selectedSession.id);
    setSecurityError("");
    setStatusMessage("");
    try {
      await apiPost(`/api/v1/employers/me/security/sessions/${encodeURIComponent(selectedSession.id)}/revoke`);
      setSessionToRevoke(null);
      if (selectedSession.is_current) {
        await auth.logout();
        navigate("/auth/signin?role=EMPLOYER", { replace: true });
        return;
      }
      setStatusMessage(`Session revoked: ${selectedSession.device_name || "Unknown device"}.`);
      setSecurityLoading(true);
      setReloadToken((current) => current + 1);
    } catch (error: unknown) {
      setSecurityError(errorMessage(error, "Unable to revoke this session. Please try again."));
      setSessionToRevoke(null);
    } finally {
      setRevokingId(null);
    }
  };

  const retrySecurity = () => {
    setSecurityLoading(true);
    setSecurityError("");
    setReloadToken((current) => current + 1);
  };

  const retryNotifications = () => {
    setNotificationsLoading(true);
    setNotificationsError("");
    setReloadToken((current) => current + 1);
  };

  const retryPreferences = () => {
    setPreferencesLoading(true);
    setPreferencesError("");
    setReloadToken((current) => current + 1);
  };

  return (
    <EmployerMobileShell name={auth.user.name || "Employer"} employerType={auth.user.employer_type} profilePhotoUrl={auth.user.profile_photo_url}>
      <main className="employer-dashboard employer-security-page">
        <header className="employer-security-header">
          <div>
            <p className="employer-eyebrow">Employer workspace</p>
            <h1>Security &amp; Settings</h1>
            <p>Manage notification preferences, review tracked sessions, and protect your account.</p>
          </div>
          <button type="button" className="employer-secondary-button employer-security-refresh" onClick={refresh}>
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
        </header>

        {statusMessage && <p className="employer-security-success" role="status"><CheckCircle2 size={17} />{statusMessage}</p>}

        <section className="employer-section-card employer-security-card">
          <SectionHeading icon={<Bell size={20} />} title="Notification preferences" description="Choose which in-app notifications you receive." />
          {preferencesLoading ? (
            <div className="employer-security-state employer-security-inline-state" role="status"><LoaderCircle size={18} className="spin" /> Loading preferences...</div>
          ) : preferencesError && !preferences ? (
            <div className="employer-security-error" role="alert"><p>{preferencesError}</p><button type="button" onClick={retryPreferences}>Try again</button></div>
          ) : (
            <div className="employer-security-list">
              {preferencesError && <p className="employer-security-error-message" role="alert">{preferencesError}</p>}
              {preferenceItems.map(({ key, label, description }) => (
                <PreferenceRow
                  key={key}
                  label={label}
                  description={description}
                  checked={Boolean(preferences?.[key])}
                  disabled={!preferences || savingPreference !== null}
                  saving={savingPreference === key}
                  onToggle={() => void updatePreference(key)}
                />
              ))}
              {savingPreference && <p className="employer-security-saving" role="status"><LoaderCircle size={16} className="spin" /> Saving setting...</p>}
            </div>
          )}
        </section>

        <section className="employer-section-card employer-security-card">
          <div className="employer-security-notifications-heading">
            <SectionHeading
              icon={<Bell size={20} />}
              title="Notifications"
              description={notifications ? `${notifications.unread_count} unread` : "Your recent account notifications"}
            />
            <button type="button" className="employer-security-refresh-small" onClick={retryNotifications} disabled={notificationsLoading}>
              <RefreshCw size={15} className={notificationsLoading ? "spin" : ""} aria-hidden="true" /> Refresh
            </button>
          </div>
          {notificationsError && <p className="employer-security-error-message" role="alert">{notificationsError}</p>}
          {notificationsLoading ? (
            <div className="employer-security-state employer-security-inline-state" role="status"><LoaderCircle size={18} className="spin" /> Loading notifications...</div>
          ) : notifications?.notifications.length ? (
            <ul className="employer-security-notifications">
              {notifications.notifications.map((notification) => (
                <li className={notification.read_at ? "is-read" : ""} key={notification.id}>
                  <div className="employer-security-notification-copy">
                    <div className="employer-security-notification-tags">
                      <h3>{notification.title}</h3>
                      {!notification.read_at && <span className="employer-security-new-badge">New</span>}
                      <span className="employer-security-category">{notification.category.replace("_", " ")}</span>
                    </div>
                    <p>{notification.message}</p>
                    <time dateTime={notification.created_at}>{formatDate(notification.created_at)}</time>
                  </div>
                  {!notification.read_at && (
                    <button
                      type="button"
                      className="employer-security-mark-read"
                      disabled={markingNotificationId !== null}
                      aria-label={`Mark ${notification.title} as read`}
                      onClick={() => void markNotificationRead(notification)}
                    >
                      {markingNotificationId === notification.id ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : !notificationsError ? (
            <p className="employer-security-notifications-empty">You have no notifications yet.</p>
          ) : null}
        </section>

        <section className="employer-section-card employer-security-password">
          <div>
            <h2>Change password</h2>
            <p>Verify your phone with an OTP to set a new password.</p>
          </div>
          <button type="button" onClick={() => navigate("/auth/forgot-password")} className="employer-security-password-button">
            Continue to password reset
          </button>
        </section>

        <section className="employer-section-card employer-security-card">
          <SectionHeading icon={<ShieldCheck size={21} />} title="Security" description="Tracked sessions and recent security activity" />
          {securityLoading ? (
            <div className="employer-security-state employer-security-inline-state" role="status"><LoaderCircle size={18} className="spin" /> Loading security activity...</div>
          ) : securityError ? (
            <div className="employer-security-error" role="alert"><p>{securityError}</p><button type="button" onClick={retrySecurity}>Try again</button></div>
          ) : security && (
            <div className="employer-security-content">
              <section>
                <h3>Active sessions <span>({security.sessions.length})</span></h3>
                {security.sessions.length === 0 ? (
                  <div className="employer-security-empty"><Monitor size={25} /><p>No tracked sessions found.</p></div>
                ) : (
                  <div className="employer-security-list">
                    {security.sessions.map((session) => {
                      const location = [session.city, session.country].filter(Boolean).join(", ");
                      const browserOs = [session.browser, session.os].filter(Boolean).join(" · ");
                      return (
                        <article className="employer-security-session" key={session.id}>
                          <div className="employer-security-session-main">
                            {session.device_name?.toLowerCase().includes("mobile") ? <Smartphone size={20} aria-hidden="true" /> : <Monitor size={20} aria-hidden="true" />}
                            <div className="employer-security-session-copy">
                              <p className="employer-security-session-title">
                                {session.device_name || "Unknown device"}
                                {session.is_current && <span className="employer-security-current"><CheckCircle2 size={13} />Current</span>}
                              </p>
                              {browserOs && <p>Reported browser / OS: {browserOs}</p>}
                              <p>Approximate location: {location || "Location unavailable"}</p>
                              <p>First seen {formatDate(session.first_seen)}</p>
                              <p>Last active {formatDate(session.last_active)}</p>
                            </div>
                          </div>
                          <button type="button" className="employer-security-revoke" disabled={revokingId === session.id} onClick={() => setSessionToRevoke(session)}>
                            {session.is_current ? "Sign out this session" : "Revoke session"}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section>
                <h3>Recent security activity</h3>
                {security.activities.length === 0 ? (
                  <div className="employer-security-empty"><ShieldCheck size={25} /><p>No recent security activity.</p></div>
                ) : (
                  <div className="employer-security-list">
                    {security.activities.map((activity) => (
                      <article className="employer-security-activity" key={activity.id}>
                        <div>
                          <strong>{activity.event_type.replaceAll("_", " ")}</strong>
                          <p>{activity.description || "Security activity recorded"}</p>
                          {activity.device_name && <small>{activity.device_name}</small>}
                          {[activity.city, activity.country].filter(Boolean).length > 0 && (
                            <small>Approximate location: {[activity.city, activity.country].filter(Boolean).join(", ")}</small>
                          )}
                        </div>
                        <time dateTime={activity.created_at}>{formatDate(activity.created_at)}</time>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </section>

        {sessionToRevoke && (
          <div className="employer-security-dialog-backdrop">
            <button type="button" className="employer-security-dialog-scrim" aria-label="Close confirmation" disabled={revokingId !== null} onClick={() => setSessionToRevoke(null)} />
            <section className="employer-security-dialog" role="dialog" aria-modal="true" aria-labelledby="employer-revoke-session-title">
              <div className="employer-security-dialog-heading">
                <div>
                  <h2 id="employer-revoke-session-title">{sessionToRevoke.is_current ? "Sign out this device?" : "Revoke this session?"}</h2>
                  <p>{sessionToRevoke.is_current ? "This session will be revoked and you will be signed out." : `This will revoke ${sessionToRevoke.device_name || "the selected device"}'s session.`}</p>
                </div>
                <button type="button" aria-label="Close confirmation" disabled={revokingId !== null} onClick={() => setSessionToRevoke(null)}><X size={20} /></button>
              </div>
              <div className="employer-security-dialog-actions">
                <button type="button" className="employer-secondary-button" disabled={revokingId !== null} onClick={() => setSessionToRevoke(null)}>Cancel</button>
                <button type="button" className="employer-security-confirm-revoke" disabled={revokingId !== null} onClick={() => void revokeSession()}>
                  {revokingId ? <><LoaderCircle size={16} className="spin" /> Revoking...</> : "Confirm"}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </EmployerMobileShell>
  );
}
