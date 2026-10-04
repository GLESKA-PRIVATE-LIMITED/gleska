"use client";

import React from "react";
import { Bell, CheckCircle2, Loader2, Monitor, RefreshCw, ShieldCheck, Smartphone, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import AccountManagementShell from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { getSessionKey, updateLastActive } from "@/lib/security";
import { supabase } from "@/lib/supabase";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import { WorkerEmptyState, WorkerErrorState, WorkerLoadingState, WorkerPageFrame, WorkerPageHeader, WorkspaceCard } from "@/components/worker/WorkspaceUI";

type WorkerPreferences = {
  job_matching_notifications: boolean;
  attendance_notifications: boolean;
  security_alerts: boolean;
};

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

type SecurityResponse = { sessions: SecuritySession[]; activities: SecurityActivity[] };
type PreferenceKey = keyof WorkerPreferences;

const preferenceItems: { key: PreferenceKey; label: string; description: string }[] = [
  { key: "job_matching_notifications", label: "Job & matching notifications", description: "Updates about jobs and match opportunities." },
  { key: "attendance_notifications", label: "Attendance notifications", description: "Updates related to attendance." },
  { key: "security_alerts", label: "Security alerts", description: "Alerts about account security activity." },
];

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function requestMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null) {
    const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

export default function WorkerSettingsSecurityPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [preferences, setPreferences] = React.useState<WorkerPreferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = React.useState(true);
  const [preferencesError, setPreferencesError] = React.useState("");
  const [savingPreference, setSavingPreference] = React.useState<PreferenceKey | null>(null);
  const [security, setSecurity] = React.useState<SecurityResponse>({ sessions: [], activities: [] });
  const [securityLoading, setSecurityLoading] = React.useState(true);
  const [securityError, setSecurityError] = React.useState("");
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [sessionToRevoke, setSessionToRevoke] = React.useState<SecuritySession | null>(null);

  const loadPreferences = React.useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setPreferencesLoading(true);
    setPreferencesError("");
    try {
      const response = await apiClient.get<WorkerPreferences>("/api/v1/workers/me/preferences", { withCredentials: true });
      setPreferences({
        job_matching_notifications: response.data.job_matching_notifications,
        attendance_notifications: response.data.attendance_notifications,
        security_alerts: response.data.security_alerts,
      });
    } catch (error: unknown) {
      setPreferencesError(requestMessage(error, "Unable to load your saved preferences."));
    } finally {
      setPreferencesLoading(false);
    }
  }, [user]);

  const loadSecurity = React.useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setSecurityLoading(true);
    setSecurityError("");
    try {
      await updateLastActive(supabase, user.id);
      const response = await apiClient.get<SecurityResponse>("/api/v1/workers/me/security", {
        headers: { "X-Goleska-Session-Key": getSessionKey() || "" },
        withCredentials: true,
      });
      setSecurity(response.data);
    } catch (error: unknown) {
      setSecurityError(requestMessage(error, "Unable to load security activity."));
    } finally {
      setSecurityLoading(false);
    }
  }, [user]);

  const refresh = () => {
    void Promise.all([loadPreferences(), loadSecurity()]);
  };

  React.useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) {
      router.replace("/worker/auth");
      return;
    }
    if (user?.role === "WORKER") {
      void Promise.resolve().then(() => Promise.all([loadPreferences(), loadSecurity()]));
    }
  }, [isLoading, loadPreferences, loadSecurity, router, user]);

  const updatePreference = async (key: PreferenceKey) => {
    if (!preferences || savingPreference) return;
    const nextValue = !preferences[key];
    setSavingPreference(key);
    setPreferencesError("");
    try {
      const response = await apiClient.put<WorkerPreferences>("/api/v1/workers/me/preferences", { [key]: nextValue }, { withCredentials: true });
      setPreferences({
        job_matching_notifications: response.data.job_matching_notifications,
        attendance_notifications: response.data.attendance_notifications,
        security_alerts: response.data.security_alerts,
      });
      toast.success("Settings saved.");
    } catch (error: unknown) {
      setPreferencesError(requestMessage(error, "Unable to save this setting. Your saved value has not changed."));
      toast.error("Unable to save this setting.");
    } finally {
      setSavingPreference(null);
    }
  };

  const revokeSession = async () => {
    if (!sessionToRevoke || revokingId) return;
    const session = sessionToRevoke;
    setRevokingId(session.id);
    setSecurityError("");
    try {
      await apiClient.post(`/api/v1/workers/me/security/sessions/${encodeURIComponent(session.id)}/revoke`, undefined, { withCredentials: true });
      setSessionToRevoke(null);
      if (session.is_current) {
        toast.success("This session was signed out.");
        await logout();
        return;
      }
      toast.success(`Session revoked: ${session.device_name || "Unknown device"}`);
      await loadSecurity();
    } catch (error: unknown) {
      setSecurityError(requestMessage(error, "Unable to revoke this session. Please try again."));
      toast.error("Unable to revoke this session.");
    } finally {
      setRevokingId(null);
    }
  };

  if (isLoading || !user || user.role !== "WORKER") {
    return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950"><Loader2 size={36} className="animate-spin text-blue-600" /></div>;
  }

  return (
    <AccountManagementShell kind="worker" name={user.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void logout()}>
      <WorkerPageFrame>
        <WorkerPageHeader
          title="Settings & Security"
          description="Manage notification preferences and review your active sessions."
          action={<button type="button" onClick={refresh} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><RefreshCw size={16} /> Refresh</button>}
        />

        <div className="mt-8 space-y-6">
          <WorkspaceCard>
            <div className="flex items-center gap-3">
              <Bell size={22} className="text-blue-700 dark:text-blue-300" />
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Settings</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Notification preferences</p>
              </div>
            </div>
            {preferencesLoading ? <WorkerLoadingState label="Loading preferences..." /> : preferencesError && !preferences ? <div className="mt-4"><WorkerErrorState message={preferencesError} onRetry={() => void loadPreferences()} /></div> : (
              <div className="mt-4 space-y-3">
                {preferencesError && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300" role="alert">{preferencesError}</p>}
                {preferenceItems.map(({ key, label, description }) => {
                  const enabled = Boolean(preferences?.[key]);
                  return <button key={key} type="button" role="switch" aria-checked={enabled} disabled={!preferences || savingPreference !== null} onClick={() => void updatePreference(key)} className="flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800">
                    <span className="min-w-0"><span className="block font-semibold text-slate-900 dark:text-white">{label}</span><span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{description}</span></span>
                    <span className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-1 transition ${enabled ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-700"}`}><span className={`h-4 w-4 rounded-full bg-white transition ${enabled ? "translate-x-5" : "translate-x-0"}`} /></span>
                  </button>;
                })}
                {savingPreference && <p className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300" role="status"><Loader2 size={16} className="animate-spin" /> Saving setting...</p>}
              </div>
            )}
          </WorkspaceCard>

          <NotificationCenter />

          <WorkspaceCard>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-bold text-slate-900 dark:text-white">Change password</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Verify your phone with an OTP to set a new password.</p>
              </div>
              <button
                type="button"
                onClick={() => router.push("/auth/forgot-password")}
                className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 dark:border-blue-500 dark:text-blue-300 dark:hover:bg-blue-950/30"
              >
                Continue to password reset
              </button>
            </div>
          </WorkspaceCard>

          <WorkspaceCard>
            <div className="flex items-center gap-3">
              <ShieldCheck size={22} className="text-blue-700 dark:text-blue-300" />
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Security</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Active sessions and recent activity</p>
              </div>
            </div>
            {securityLoading ? <WorkerLoadingState label="Loading security activity..." /> : securityError ? <div className="mt-4"><WorkerErrorState message={securityError} onRetry={() => void loadSecurity()} /></div> : (
              <div className="mt-6 space-y-8">
                <section>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-white">Active sessions <span className="font-normal text-slate-500">({security.sessions.length})</span></h3>
                  </div>
                  <div className="mt-3 space-y-3">
                    {security.sessions.length === 0 ? <WorkerEmptyState icon={<Monitor size={26} />}>No active sessions found.</WorkerEmptyState> : security.sessions.map((session) => {
                      const location = [session.city, session.country].filter(Boolean).join(", ");
                      const deviceDetails = [session.browser, session.os].filter(Boolean).join(" · ");
                      return <article key={session.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                        <div className="flex min-w-0 items-start gap-3">
                          {session.device_name?.toLowerCase().includes("mobile") ? <Smartphone size={20} className="mt-0.5 shrink-0 text-slate-500" /> : <Monitor size={20} className="mt-0.5 shrink-0 text-slate-500" />}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-white">{session.device_name || "Unknown device"}{session.is_current && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 size={13} /> Current</span>}</p>
                            {deviceDetails && <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">Reported browser / OS: {deviceDetails}</p>}
                            {location && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Approximate location: {location}</p>}
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">First seen {formatDate(session.first_seen)} · Last active {formatDate(session.last_active)}</p>
                          </div>
                        </div>
                        <button type="button" disabled={revokingId === session.id} onClick={() => setSessionToRevoke(session)} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30">
                          {session.is_current ? "Sign out this session" : "Revoke session"}
                        </button>
                      </article>;
                    })}
                  </div>
                </section>

                <section>
                  <h3 className="font-bold text-slate-900 dark:text-white">Recent security activity</h3>
                  <div className="mt-3 space-y-3">
                    {security.activities.length === 0 ? <WorkerEmptyState icon={<ShieldCheck size={26} />}>No recent security activity.</WorkerEmptyState> : security.activities.map((activity) => {
                      const activityLocation = [activity.city, activity.country].filter(Boolean).join(", ");
                      const context = [activity.device_name, activityLocation ? `Approximate location: ${activityLocation}` : null].filter(Boolean).join(" · ");
                      return <article key={activity.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <div className="min-w-0"><p className="font-semibold capitalize text-slate-900 dark:text-white">{activity.event_type.replaceAll("_", " ")}</p><p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">{activity.description || "Security activity recorded"}</p>{context && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{context}</p>}</div>
                          <time className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatDate(activity.created_at)}</time>
                        </div>
                      </article>;
                    })}
                  </div>
                </section>
              </div>
            )}
          </WorkspaceCard>
        </div>

        {sessionToRevoke && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="revoke-session-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div><h2 id="revoke-session-title" className="font-bold text-slate-900 dark:text-white">{sessionToRevoke.is_current ? "Sign out this device?" : "Revoke this session?"}</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{sessionToRevoke.is_current ? "You will be signed out of this device after its session is revoked." : `This will sign out ${sessionToRevoke.device_name || "the selected device"}.`}</p></div>
              <button type="button" onClick={() => setSessionToRevoke(null)} disabled={revokingId !== null} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800" aria-label="Close confirmation"><X size={20} /></button>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setSessionToRevoke(null)} disabled={revokingId !== null} className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
              <button type="button" onClick={() => void revokeSession()} disabled={revokingId !== null} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{revokingId && <Loader2 size={16} className="animate-spin" />}{revokingId ? "Revoking..." : "Confirm"}</button>
            </div>
          </section>
        </div>}
      </WorkerPageFrame>
    </AccountManagementShell>
  );
}