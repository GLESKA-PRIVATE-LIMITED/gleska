"use client";

import React from "react";
import { Loader2, Monitor, RefreshCw, Settings, ShieldCheck, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import AccountManagementShell from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { getSessionKey } from "@/lib/security";
import { WorkerEmptyState, WorkerErrorState, WorkerLoadingState, WorkerPageFrame, WorkerPageHeader, WorkspaceCard } from "@/components/worker/WorkspaceUI";

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

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function WorkerSecuritySettingsPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [data, setData] = React.useState<SecurityResponse>({ sessions: [], activities: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [revokingId, setRevokingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<SecurityResponse>("/api/v1/workers/me/security", {
        headers: { "X-Goleska-Session-Key": getSessionKey() || "" },
        withCredentials: true,
      });
      setData(response.data);
    } catch {
      setError("Unable to load security activity right now.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  React.useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) {
      router.replace("/worker/auth");
      return;
    }
    if (!isLoading && user?.role === "WORKER") void Promise.resolve().then(() => load());
  }, [isLoading, load, router, user]);

  const revoke = async (session: SecuritySession) => {
    if (!window.confirm("Sign out this session?")) return;
    setRevokingId(session.id);
    setError("");
    try {
      await apiClient.post(`/api/v1/workers/me/security/sessions/${session.id}/revoke`, undefined, { withCredentials: true });
      setData((current) => ({ ...current, sessions: current.sessions.filter((item) => item.id !== session.id) }));
    } catch {
      setError("Unable to revoke that session. Please try again.");
    } finally {
      setRevokingId(null);
    }
  };

  if (isLoading || !user) return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950"><Loader2 size={36} className="animate-spin text-blue-600" /></div>;

  return (
    <AccountManagementShell kind="worker" name={user.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void logout()}>
      <WorkerPageFrame>
        <WorkerPageHeader title="Security" description="Review your active sessions, recent account activity, and account verification status." action={<button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><RefreshCw size={16} /> Refresh</button>} />
        {loading ? <WorkerLoadingState label="Loading security activity..." /> : error ? <WorkerErrorState message={error} onRetry={() => void load()} /> : <div className="mt-8 space-y-6">
          <WorkspaceCard>
            <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><ShieldCheck size={21} /></div><div><h2 className="font-bold">Active sessions</h2><p className="text-sm text-slate-500">{data.sessions.length} active session{data.sessions.length === 1 ? "" : "s"}</p></div></div>
            {data.sessions.length ? <div className="mt-5 space-y-3">{data.sessions.map((session) => <article key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800"><div className="flex items-center gap-3">{session.device_name?.toLowerCase().includes("mobile") ? <Smartphone size={20} className="text-slate-500" /> : <Monitor size={20} className="text-slate-500" />}<div><p className="font-semibold">{session.device_name || "Unknown device"}{session.is_current && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">Current</span>}</p><p className="mt-1 text-sm text-slate-500">Last active {formatDate(session.last_active)}</p></div></div><button type="button" disabled={revokingId === session.id} onClick={() => void revoke(session)} className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">{revokingId === session.id ? "Revoking..." : "Revoke"}</button></article>)}</div> : <WorkerEmptyState icon={<Monitor size={28} />}>No active sessions found.</WorkerEmptyState>}
          </WorkspaceCard>

          <WorkspaceCard>
            <div className="flex items-center gap-3"><Settings size={24} className="text-blue-700" /><h2 className="text-xl font-bold text-slate-900 dark:text-white">Verification status</h2></div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Mobile verification</p>
                <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{user.is_mobile_verified ? "Verified" : "Not verified"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Email verification</p>
                <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Unavailable</p>
              </div>
            </div>
          </WorkspaceCard>

          <WorkspaceCard>
            <h2 className="font-bold">Recent security activity</h2>
            {data.activities.length ? <div className="mt-5 space-y-3">{data.activities.map((activity) => <article key={activity.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{activity.event_type.replace(/_/g, " ")}</p><p className="mt-1 text-sm text-slate-500">{activity.description || "Security activity recorded"}</p></div><time className="text-xs text-slate-400">{formatDate(activity.created_at)}</time></div></article>)}</div> : <WorkerEmptyState icon={<ShieldCheck size={28} />}>No security activity found.</WorkerEmptyState>}
          </WorkspaceCard>
        </div>}
      </WorkerPageFrame>
    </AccountManagementShell>
  );
}
