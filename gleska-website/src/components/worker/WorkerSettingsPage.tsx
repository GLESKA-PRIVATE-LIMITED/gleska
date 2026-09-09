"use client";

import React from "react";
import { Loader2, RefreshCw, Settings2, Bell, Languages, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import AccountManagementShell from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { useLanguage } from "@/context/LanguageContext";
import { WorkerEmptyState, WorkerErrorState, WorkerLoadingState, WorkerPageFrame, WorkerPageHeader, WorkspaceCard } from "@/components/worker/WorkspaceUI";

type WorkerPreferenceState = {
  job_matching_notifications: boolean;
  attendance_notifications: boolean;
  security_alerts: boolean;
  language: "EN" | "HI" | "MR" | "TA";
};

const DEFAULT_PREFERENCES: WorkerPreferenceState = {
  job_matching_notifications: true,
  attendance_notifications: true,
  security_alerts: true,
  language: "EN",
};

export default function WorkerSettingsPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const [preferences, setPreferences] = React.useState<WorkerPreferenceState>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const normalizeLanguage = (value?: string | null): WorkerPreferenceState["language"] => {
    if (value === "HI" || value === "MR" || value === "TA") return value;
    return "EN";
  };

  const loadPreferences = React.useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<WorkerPreferenceState>("/api/v1/workers/me/preferences", { withCredentials: true });
      const loaded = {
        ...DEFAULT_PREFERENCES,
        ...response.data,
        language: normalizeLanguage(response.data?.language),
      };
      setPreferences(loaded);
      setLanguage(loaded.language);
    } catch {
      const fallback = { ...DEFAULT_PREFERENCES, language: normalizeLanguage(language) };
      setPreferences(fallback);
      setLanguage(fallback.language);
      setError("Unable to load your saved preferences right now.");
    } finally {
      setLoading(false);
    }
  }, [language, setLanguage, user]);

  React.useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) {
      router.replace("/worker/auth");
      return;
    }
    if (!isLoading && user?.role === "WORKER") {
      void loadPreferences();
    }
  }, [isLoading, loadPreferences, router, user]);

  const updatePreference = async (key: keyof WorkerPreferenceState, value: boolean | string) => {
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    setSaving(true);
    setError("");

    try {
      const response = await apiClient.put<WorkerPreferenceState>("/api/v1/workers/me/preferences", next, { withCredentials: true });
      const saved = {
        ...DEFAULT_PREFERENCES,
        ...response.data,
        language: normalizeLanguage(response.data?.language),
      };
      setPreferences(saved);
      setLanguage(saved.language);
    } catch {
      setError("Unable to save your preferences right now.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: "job_matching_notifications" | "attendance_notifications" | "security_alerts") => {
    const next = !preferences[key];
    void updatePreference(key, next);
  };

  if (isLoading || !user) {
    return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950"><Loader2 size={36} className="animate-spin text-blue-600" /></div>;
  }

  return (
    <AccountManagementShell kind="worker" name={user.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void logout()}>
      <WorkerPageFrame>
        <WorkerPageHeader
          title="Settings"
          description="Manage your Worker preferences. Changes are saved through the authenticated GO LESKA API."
          action={
            <button type="button" onClick={() => void loadPreferences()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              <RefreshCw size={16} /> Refresh
            </button>
          }
        />

        {loading ? (
          <WorkerLoadingState label="Loading settings..." />
        ) : error ? (
          <WorkerErrorState message={error} onRetry={() => void loadPreferences()} />
        ) : (
          <div className="mt-8 space-y-6">
            <WorkspaceCard>
              <div className="flex items-center gap-3">
                <Languages size={24} className="text-blue-700" />
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Language</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                {(["EN", "HI", "MR", "TA"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => void updatePreference("language", option)}
                    className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${preferences.language === option ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"}`}
                  >
                    {option === "EN" ? "English" : option === "HI" ? "हिन्दी" : option === "MR" ? "मराठी" : "தமிழ்"}
                  </button>
                ))}
              </div>
            </WorkspaceCard>

            <WorkspaceCard>
              <div className="flex items-center gap-3">
                <Bell size={24} className="text-blue-700" />
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Notifications</h2>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  { key: "job_matching_notifications", label: "Job / matching notifications", description: "Get updates about jobs and match opportunities." },
                  { key: "attendance_notifications", label: "Attendance notifications", description: "Receive attendance-related updates." },
                  { key: "security_alerts", label: "Security alerts", description: "Receive account security alerts." },
                ].map(({ key, label, description }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(key as "job_matching_notifications" | "attendance_notifications" | "security_alerts")}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                  >
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{label}</p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
                    </div>
                    <span className={`inline-flex h-6 w-11 items-center rounded-full p-1 transition ${preferences[key as keyof WorkerPreferenceState] ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-700"}`}>
                      <span className={`h-4 w-4 rounded-full bg-white transition ${preferences[key as keyof WorkerPreferenceState] ? "translate-x-5" : "translate-x-0"}`} />
                    </span>
                  </button>
                ))}
              </div>
            </WorkspaceCard>

            <WorkspaceCard>
              <div className="flex items-center gap-3">
                <ShieldCheck size={24} className="text-blue-700" />
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Privacy & account</h2>
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
                Worker account preferences are limited to settings that are actually backed by the authenticated GO LESKA API. Profile details, attendance, documents, subscriptions, and security sessions remain in their dedicated pages.
              </div>
            </WorkspaceCard>

            {saving && (
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                <Settings2 size={16} className="animate-spin" /> Saving preferences...
              </div>
            )}
          </div>
        )}
      </WorkerPageFrame>
    </AccountManagementShell>
  );
}
