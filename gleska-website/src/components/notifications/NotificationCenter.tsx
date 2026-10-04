"use client";

import React from "react";
import { Bell, Check, Loader2, RefreshCw } from "lucide-react";
import apiClient from "@/lib/api";

type NotificationItem = {
  id: string;
  category: "job_matching" | "attendance" | "security";
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};

type NotificationResponse = {
  notifications: NotificationItem[];
  unread_count: number;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    if (typeof detail === "string") return detail;
  }
  return "Unable to load notifications. Please try again.";
}

export default function NotificationCenter() {
  const [data, setData] = React.useState<NotificationResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [markingId, setMarkingId] = React.useState<string | null>(null);

  const fetchNotifications = React.useCallback(async () => {
    const response = await apiClient.get<NotificationResponse>("/api/v1/notifications?limit=50", { withCredentials: true });
    return response.data;
  }, []);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchNotifications());
    } catch (requestError: unknown) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [fetchNotifications]);

  React.useEffect(() => {
    let active = true;
    void fetchNotifications()
      .then((nextData) => {
        if (active) setData(nextData);
      })
      .catch((requestError: unknown) => {
        if (active) setError(errorMessage(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchNotifications]);

  const markRead = async (notification: NotificationItem) => {
    if (notification.read_at || markingId) return;
    setMarkingId(notification.id);
    setError("");
    try {
      const response = await apiClient.post<{ success: boolean; notification: NotificationItem }>(
        `/api/v1/notifications/${encodeURIComponent(notification.id)}/read`,
        undefined,
        { withCredentials: true },
      );
      setData((current) => current && ({
        unread_count: Math.max(0, current.unread_count - (notification.read_at ? 0 : 1)),
        notifications: current.notifications.map((item) =>
          item.id === notification.id ? response.data.notification : item
        ),
      }));
    } catch (requestError: unknown) {
      setError(errorMessage(requestError));
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bell size={21} className="text-blue-700 dark:text-blue-300" />
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Notifications</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {data ? `${data.unread_count} unread` : "Your recent account notifications"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300" role="alert">{error}</p>}
      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400" role="status">
          <Loader2 size={17} className="animate-spin" /> Loading notifications...
        </div>
      ) : data?.notifications.length ? (
        <ul className="mt-5 divide-y divide-slate-100 dark:divide-slate-800">
          {data.notifications.map((notification) => (
            <li key={notification.id} className={`flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0 ${notification.read_at ? "opacity-75" : ""}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{notification.title}</h3>
                  {!notification.read_at && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200">New</span>}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{notification.category.replace("_", " ")}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{notification.message}</p>
                <time className="mt-2 block text-xs text-slate-500 dark:text-slate-400">{formatDate(notification.created_at)}</time>
              </div>
              {!notification.read_at && (
                <button
                  type="button"
                  onClick={() => void markRead(notification)}
                  disabled={markingId !== null}
                  aria-label={`Mark ${notification.title} as read`}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {markingId === notification.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : !error ? (
        <p className="mt-5 rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">You have no notifications yet.</p>
      ) : null}
    </section>
  );
}
