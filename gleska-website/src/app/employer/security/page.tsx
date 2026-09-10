"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  UserSession,
  SecurityActivity,
  updateLastActive,
  revokeSession,
  getSessionKey,
  timeAgo,
  formatDate,
} from "@/lib/security";
import AccountManagementShell, { formatEmployerType } from "@/components/AccountManagementShell";
import {
  ShieldCheck,
  Shield,
  Lock,
  Key,
  CheckCircle2,
  Check,
  Laptop,
  Smartphone,
  Monitor,
  Lightbulb,
  ChevronRight,
  Users,
  Briefcase,
  Clock,
  CreditCard,
  FileText,
  HelpCircle,
  LayoutDashboard,
  Loader2,
  AlertTriangle,
  MapPin,
  RefreshCw,
  Bell,
  Languages,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/api";

type EmployerPreferenceState = {
  job_matching_notifications: boolean;
  attendance_notifications: boolean;
  security_alerts: boolean;
  language: "EN" | "HI" | "MR" | "TA";
};

const DEFAULT_EMPLOYER_PREFERENCES: EmployerPreferenceState = {
  job_matching_notifications: true,
  attendance_notifications: true,
  security_alerts: true,
  language: "EN",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function DeviceIcon({ os, browser }: { os: string | null; browser: string | null }) {
  const ua = `${os ?? ""} ${browser ?? ""}`.toLowerCase();
  if (/iphone|android/.test(ua)) {
    return <Smartphone size={20} />;
  }
  if (/ipad|tablet/.test(ua)) {
    return <Monitor size={20} />;
  }
  return <Laptop size={20} />;
}

function locationLabel(city: string | null, country: string | null): string {
  if (city && country) return `${city}, ${country}`;
  if (country) return country;
  return "";
}

function activityEventColor(eventType: string): string {
  switch (eventType) {
    case "password_changed":
      return "bg-emerald-500";
    case "session_revoked":
      return "bg-rose-500";
    case "logout":
      return "bg-amber-500";
    case "login":
    default:
      return "bg-blue-600";
  }
}

function activityIcon(eventType: string) {
  switch (eventType) {
    case "password_changed":
      return <Check size={10} className="stroke-[3]" />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function EmployerSecurityPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  // --- Real data state ---
  const [sessions, setSessions] = React.useState<UserSession[]>([]);
  const [activities, setActivities] = React.useState<SecurityActivity[]>([]);
  const [loadingData, setLoadingData] = React.useState(true);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const currentSessionKey = React.useRef<string | null>(null);
  const [preferences, setPreferences] = React.useState<EmployerPreferenceState>(DEFAULT_EMPLOYER_PREFERENCES);
  const [loadingPreferences, setLoadingPreferences] = React.useState(true);
  const [savingPreference, setSavingPreference] = React.useState(false);

  // --- Auth guard ---
  React.useEffect(() => {
    if (!isLoading && !user) {
      router.push("/employer/auth");
      return;
    }
    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.push("/");
      return;
    }
  }, [user, isLoading, router]);

  // --- Load real data + update last_active ---
  const loadSecurityData = React.useCallback(async () => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    if (!authSession?.user?.id) return;

    const uid = authSession.user.id;
    currentSessionKey.current = getSessionKey();

    // Update last_active for current session (non-blocking)
    updateLastActive(supabase, uid);

    setLoadingData(true);
    try {
      const [sessionsRes, activityRes] = await Promise.all([
        supabase
          .from("user_sessions")
          .select("*")
          .eq("user_id", uid)
          .eq("is_revoked", false)
          .order("last_active", { ascending: false }),
        supabase
          .from("security_activity")
          .select("*")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (sessionsRes.data) setSessions(sessionsRes.data as UserSession[]);
      if (activityRes.data) setActivities(activityRes.data as SecurityActivity[]);
    } catch (err) {
      console.error("[security page] loadSecurityData error:", err);
    } finally {
      setLoadingData(false);
    }
  }, []);

  React.useEffect(() => {
    if (!isLoading && user) {
      loadSecurityData();
    }
  }, [isLoading, user, loadSecurityData]);

  const loadEmployerPreferences = React.useCallback(async () => {
    if (!user || user.role !== "EMPLOYER") return;
    setLoadingPreferences(true);
    try {
      const response = await apiClient.get<EmployerPreferenceState>("/api/v1/employers/me/preferences", { withCredentials: true });
      setPreferences({ ...DEFAULT_EMPLOYER_PREFERENCES, ...response.data });
    } catch {
      toast.error("Unable to load employer settings.");
    } finally {
      setLoadingPreferences(false);
    }
  }, [user]);

  React.useEffect(() => {
    if (!isLoading && user?.role === "EMPLOYER") {
      void loadEmployerPreferences();
    }
  }, [isLoading, loadEmployerPreferences, user]);

  const updateEmployerPreference = async (key: keyof EmployerPreferenceState, value: boolean | string) => {
    const next = { ...preferences, [key]: value } as EmployerPreferenceState;
    setPreferences(next);
    setSavingPreference(true);
    try {
      const response = await apiClient.put<EmployerPreferenceState>("/api/v1/employers/me/preferences", next, { withCredentials: true });
      setPreferences({ ...DEFAULT_EMPLOYER_PREFERENCES, ...response.data });
      toast.success("Employer settings saved.");
    } catch {
      setPreferences(preferences);
      toast.error("Unable to save employer settings.");
    } finally {
      setSavingPreference(false);
    }
  };

  // --- Derived data ---
  const currentSession = sessions.find(
    (s) => s.session_key === currentSessionKey.current
  );
  const otherSessions = sessions.filter(
    (s) => s.session_key !== currentSessionKey.current
  );

  const passwordChangedActivity = activities.find(
    (a) => a.event_type === "password_changed"
  );

  // Security status: "Strong" only if user has at least one active session
  const hasActiveSessions = sessions.length > 0;
  const securityStatus = hasActiveSessions ? "Strong" : "Unknown";

  // --- Handlers ---
  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
      toast.success("Logged out successfully");
    } catch (err) {
      toast.error("Logout failed");
    }
  };

  const handleChangePassword = () => {
    router.push("/auth/forgot-password");
  };

  const handleRemoveSession = async (session: UserSession) => {
    if (session.session_key === currentSessionKey.current) {
      toast.error("You cannot remove your current session. Use Log Out instead.");
      return;
    }

    const { data: { session: authSession } } = await supabase.auth.getSession();
    if (!authSession?.user?.id) {
      toast.error("Authentication error. Please refresh and try again.");
      return;
    }

    setRevokingId(session.id);
    try {
      const success = await revokeSession(
        supabase,
        authSession.user.id,
        session.id,
        session.device_name
      );
      if (success) {
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
        // Re-fetch activity to show the revoke event
        const { data: activityData } = await supabase
          .from("security_activity")
          .select("*")
          .eq("user_id", authSession.user.id)
          .order("created_at", { ascending: false })
          .limit(20);
        if (activityData) setActivities(activityData as SecurityActivity[]);
        toast.success(`Session removed: ${session.device_name ?? "Unknown device"}`);
      } else {
        toast.error("Failed to remove session. Please try again.");
      }
    } finally {
      setRevokingId(null);
    }
  };

  // --- Loading screen ---
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fc] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={36} className="animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
            Loading Security Settings...
          </p>
        </div>
      </div>
    );
  }

  if (!user || user.role !== "EMPLOYER") {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <AccountManagementShell kind="employer" name={user.name} accountLabel={formatEmployerType(user.employer_type)} employerType={user.employer_type} onLogout={handleLogout}>
      <div className="flex-1 min-w-0">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="font-bold text-3xl text-slate-900 dark:text-white">Security</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Manage your account security and keep your information safe.
              </p>
            </div>
            {/* Refresh button */}
            <button
              type="button"
              onClick={loadSecurityData}
              disabled={loadingData}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition disabled:opacity-50"
              title="Refresh security data"
            >
              <RefreshCw size={14} className={loadingData ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="space-y-8">
            <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-8">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                      <Languages size={20} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">Settings</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Manage your employer preferences.</p>
                    </div>
                  </div>
                </div>
                {savingPreference && <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Saving...</span>}
              </div>

              {loadingPreferences ? (
                <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Loading settings...</span>
                </div>
              ) : (
                <div className="mt-5 grid gap-6 lg:grid-cols-2">
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <Languages size={16} className="text-blue-600 dark:text-blue-400" />
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Language</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                      {(["EN", "HI", "MR", "TA"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => void updateEmployerPreference("language", option)}
                          disabled={savingPreference}
                          className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition disabled:opacity-60 ${preferences.language === option ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"}`}
                        >
                          {option === "EN" ? "English" : option === "HI" ? "Hindi" : option === "MR" ? "Marathi" : "Tamil"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <Bell size={16} className="text-blue-600 dark:text-blue-400" />
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Notifications</h3>
                    </div>
                    <div className="space-y-2">
                      {[
                        { key: "job_matching_notifications" as const, label: "Job / matching notifications" },
                        { key: "attendance_notifications" as const, label: "Attendance notifications" },
                        { key: "security_alerts" as const, label: "Security alerts" },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => void updateEmployerPreference(key, !preferences[key])}
                          disabled={savingPreference}
                          className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                        >
                          <span className="text-xs font-semibold text-slate-900 dark:text-white">{label}</span>
                          <span className={`inline-flex h-6 w-11 items-center rounded-full p-1 transition ${preferences[key] ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-700"}`}>
                            <span className={`h-4 w-4 rounded-full bg-white transition ${preferences[key] ? "translate-x-5" : "translate-x-0"}`} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* 1. Security Overview Banner Card */}
            <div className="rounded-3xl border border-blue-200/80 bg-gradient-to-br from-blue-50/80 via-indigo-50/40 to-blue-100/50 p-6 sm:p-8 dark:border-slate-800 dark:from-slate-900 dark:via-blue-950/20 dark:to-slate-900 shadow-md">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                  {/* Security Shield Graphic */}
                  <div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-blue-600/10 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800">
                    <ShieldCheck size={56} className="text-blue-600 dark:text-blue-400" />
                    <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md">
                      <Check size={18} className="stroke-[3]" />
                    </div>
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                      {hasActiveSessions ? "Your account is secure" : "Monitoring your account"}
                    </h2>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 max-w-lg leading-relaxed">
                      We&apos;re constantly monitoring your account for suspicious activity. Your data is protected by industry-leading encryption.
                    </p>
                  </div>
                </div>

                {/* Security Status Box */}
                <div className="w-full lg:w-auto shrink-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 min-w-[280px]">
                  <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Security Status
                    </span>
                    {hasActiveSessions ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 size={13} />
                        {securityStatus}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-0.5 text-xs font-bold text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-300">
                        <AlertTriangle size={13} />
                        {securityStatus}
                      </span>
                    )}
                  </div>

                  <ul className="mt-3 space-y-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                    <li className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-500 shrink-0" />
                      <span>No security issues found</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-500 shrink-0" />
                      <span>Your account is up to date</span>
                    </li>
                    <li className="flex items-center gap-2">
                      {hasActiveSessions ? (
                        <Check size={14} className="text-emerald-500 shrink-0" />
                      ) : (
                        <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                      )}
                      <span>
                        {sessions.length > 0
                          ? `${sessions.length} active session${sessions.length === 1 ? "" : "s"} tracked`
                          : "No sessions registered yet"}
                      </span>
                    </li>
                  </ul>

                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById("trusted-devices-section")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="mt-4 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition cursor-pointer"
                  >
                    View security recommendations →
                  </button>
                </div>
              </div>
            </div>

            {/* 2 & 3. Account Protection & Security Activity Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Account Protection */}
              <div className="lg:col-span-7 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                      <Lock size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Account Protection
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Manage your account access and credentials
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Password Row */}
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 dark:text-white">
                              Password
                            </span>
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300 uppercase">
                              Set
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {passwordChangedActivity
                              ? `Last changed ${formatDate(passwordChangedActivity.created_at)}`
                              : "Last changed: unknown — change it now to stay secure"}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={handleChangePassword}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-600 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-950/50 transition cursor-pointer shrink-0"
                        >
                          <Key size={14} />
                          <span>Change Password</span>
                        </button>
                      </div>
                    </div>

                    {/* Two-Factor Authentication Row */}
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 dark:text-white">
                              Two-Factor Authentication
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-300 uppercase">
                              via OTP
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Secured via mobile OTP — required for password reset and sign-in.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => toast.info("OTP-based authentication is enabled for all sign-in flows.")}
                          className="inline-flex items-center justify-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer shrink-0"
                        >
                          <span>Learn More</span>
                        </button>
                      </div>
                    </div>

                    {/* Active Sessions Row */}
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            Active Sessions
                          </span>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {loadingData
                              ? "Loading..."
                              : sessions.length === 0
                              ? "No active sessions tracked yet. Sessions appear after your next login."
                              : `You're currently signed in on ${sessions.length} device${sessions.length === 1 ? "" : "s"}.`}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            document
                              .getElementById("trusted-devices-section")
                              ?.scrollIntoView({ behavior: "smooth" })
                          }
                          className="inline-flex items-center justify-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer shrink-0"
                        >
                          <span>View Sessions</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Security Activity */}
              <div className="lg:col-span-5 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-6 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <Shield size={18} className="text-blue-600 dark:text-blue-400" />
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Security Activity
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={loadSecurityData}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                    >
                      Refresh
                    </button>
                  </div>

                  {/* Activity Timeline List */}
                  {loadingData ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
                      <Loader2 size={14} className="animate-spin" />
                      <span>Loading activity...</span>
                    </div>
                  ) : activities.length === 0 ? (
                    <div className="py-8 text-center">
                      <Shield size={28} className="mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        No security events recorded yet.
                      </p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                        Events appear here after login, logout, password changes, and session revocations.
                      </p>
                    </div>
                  ) : (
                    <div className="relative pl-6 space-y-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800 max-h-80 overflow-y-auto pr-1">
                      {activities.map((activity) => {
                        const isSuccess = activity.event_type === "password_changed";
                        const icon = activityIcon(activity.event_type);
                        const dotColor = activityEventColor(activity.event_type);

                        return (
                          <div key={activity.id} className="relative">
                            <div
                              className={`absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full ${dotColor} text-white ring-4 ring-white dark:ring-slate-900`}
                            >
                              {icon}
                            </div>
                            <p className="text-xs font-bold text-slate-900 dark:text-white">
                              {activity.description || activity.event_type}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {formatDate(activity.created_at)}
                              {activity.city && (
                                <span className="ml-1">
                                  •{" "}
                                  <MapPin size={9} className="inline -mt-0.5" />{" "}
                                  {locationLabel(activity.city, activity.country)}
                                </span>
                              )}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 4 & 5. Trusted Devices & Security Tips Grid */}
            <div id="trusted-devices-section" className="grid grid-cols-1 lg:grid-cols-12 gap-8 scroll-mt-8">
              {/* Left Column: Trusted Devices */}
              <div className="lg:col-span-7 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-6 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                      <Monitor size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Trusted Devices
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Devices that have access to your account
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={loadSecurityData}
                    disabled={loadingData}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer disabled:opacity-50"
                  >
                    Manage All Devices
                  </button>
                </div>

                {/* Devices List */}
                {loadingData ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-6">
                    <Loader2 size={14} className="animate-spin" />
                    <span>Loading devices...</span>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="py-10 text-center">
                    <Monitor size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-700" />
                    <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                      No devices tracked yet
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs mx-auto">
                      Sessions will appear here after you log in. If you just logged in, try refreshing.
                    </p>
                    <button
                      type="button"
                      onClick={loadSecurityData}
                      className="mt-4 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400"
                    >
                      Refresh →
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Current session first */}
                    {currentSession && (
                      <div className="flex items-center justify-between gap-4 rounded-2xl border border-blue-200/80 bg-blue-50/30 p-4 dark:border-blue-800/50 dark:bg-blue-950/20">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100/60 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                            <DeviceIcon os={currentSession.os} browser={currentSession.browser} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {currentSession.device_name ?? "This Device"}
                              </p>
                              <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300 shrink-0">
                                This device
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {locationLabel(currentSession.city, currentSession.country)
                                ? `${locationLabel(currentSession.city, currentSession.country)} • `
                                : ""}
                              <span className="text-blue-600 dark:text-blue-400 font-semibold">
                                Current Session
                              </span>
                            </p>
                          </div>
                        </div>

                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300 uppercase shrink-0">
                          CURRENT
                        </span>
                      </div>
                    )}

                    {/* Other sessions */}
                    {otherSessions.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100/60 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                            <DeviceIcon os={session.os} browser={session.browser} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {session.device_name ?? "Unknown Device"}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {locationLabel(session.city, session.country)
                                ? `${locationLabel(session.city, session.country)} • `
                                : ""}
                              Active {timeAgo(session.last_active)}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveSession(session)}
                          disabled={revokingId === session.id}
                          className="rounded-xl border border-rose-200 px-3.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40 transition cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                          {revokingId === session.id ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              <span>Removing...</span>
                            </>
                          ) : (
                            <span>Remove</span>
                          )}
                        </button>
                      </div>
                    ))}

                    {/* If only the current session exists */}
                    {currentSession && otherSessions.length === 0 && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 text-center pt-2">
                        No other active sessions found.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Security Tips */}
              <div className="lg:col-span-5 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-6 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <Lightbulb size={20} className="text-amber-500" />
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      Security Tips
                    </h3>
                  </div>

                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => toast.info("Password tip: Use at least 12 characters including symbols.")}
                      className="group flex w-full items-center justify-between rounded-2xl bg-blue-50/60 p-4 text-left border border-blue-100/60 hover:bg-blue-100/60 dark:bg-slate-800/60 dark:border-slate-800 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                          <Key size={16} />
                        </div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          How to create a strong password
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>

                    <button
                      type="button"
                      onClick={() => toast.info("2FA tip: All logins require OTP verification on this platform.")}
                      className="group flex w-full items-center justify-between rounded-2xl bg-blue-50/60 p-4 text-left border border-blue-100/60 hover:bg-blue-100/60 dark:bg-slate-800/60 dark:border-slate-800 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                          <ShieldCheck size={16} />
                        </div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Importance of enabling 2FA
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>

                    <button
                      type="button"
                      onClick={() => toast.info("Device tip: Sign out of public computers after use.")}
                      className="group flex w-full items-center justify-between rounded-2xl bg-blue-50/60 p-4 text-left border border-blue-100/60 hover:bg-blue-100/60 dark:bg-slate-800/60 dark:border-slate-800 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                          <Monitor size={16} />
                        </div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Keeping your devices secure
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => toast.info("Review our security documentation for best practices.")}
                    className="mt-6 w-full text-center text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 transition cursor-pointer"
                  >
                    Learn more about account security
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </AccountManagementShell>

  );
}
