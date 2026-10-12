"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Settings2,
  Bell,
  LayoutDashboard,
  LogOut,
  Building2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSupplier } from "@/context/SupplierContext";

// ---------------------------------------------------------------------------
// localStorage key for UI-only notification preferences
// ---------------------------------------------------------------------------
const NOTIF_PREFS_KEY = "gleska_supplier_notif_prefs";

interface NotifPrefs {
  readReceipts: boolean;
  orderStatusUpdates: boolean;
  rfqDeadlineReminders: boolean;
}

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  readReceipts: false,
  orderStatusUpdates: true,
  rfqDeadlineReminders: true,
};

function loadNotifPrefs(): NotifPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIF_PREFS;
  try {
    const raw = localStorage.getItem(NOTIF_PREFS_KEY);
    if (raw) return { ...DEFAULT_NOTIF_PREFS, ...JSON.parse(raw) };
  } catch {
    // ignore parse errors
  }
  return DEFAULT_NOTIF_PREFS;
}

// ---------------------------------------------------------------------------
// Reusable sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
      {children}
    </h3>
  );
}

interface ToggleRowProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ id, label, description, checked, onChange }: ToggleRowProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start justify-between gap-4 rounded-xl px-1 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
    >
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
            {description}
          </span>
        )}
      </div>
      {/* Toggle switch */}
      <div className="relative mt-0.5 shrink-0">
        <input
          id={id}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="h-5 w-9 rounded-full border border-slate-300 bg-slate-200 transition-colors peer-checked:border-purple-600 peer-checked:bg-purple-600 peer-focus-visible:ring-2 peer-focus-visible:ring-purple-500 peer-focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-700 dark:peer-checked:border-purple-500 dark:peer-checked:bg-purple-500" />
        <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SupplierSettingsPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const { selectedMembership, includeArchivedOfferings, setIncludeArchivedOfferings } =
    useSupplier();

  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);
  const [notifLoaded, setNotifLoaded] = useState(false);

  // Hydrate from localStorage only on the client to avoid SSR mismatch
  useEffect(() => {
    setNotifPrefs(loadNotifPrefs());
    setNotifLoaded(true);
  }, []);

  function updateNotifPref<K extends keyof NotifPrefs>(key: K, value: boolean) {
    setNotifPrefs((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(next));
      } catch {
        // storage quota / disabled
      }
      return next;
    });
  }

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/auth/login");
    } catch {
      router.push("/");
    }
  };

  const companyName = selectedMembership?.company_name ?? "—";
  const role = selectedMembership?.role ?? "—";

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
            <Settings2 size={19} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Settings
            </h2>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {companyName}
              </span>{" "}
              &middot; {role.charAt(0) + role.slice(1).toLowerCase()}
            </p>
          </div>
        </div>
      </section>

      {/* ── Notification preferences ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={15} className="text-slate-400 dark:text-slate-500" />
          <SectionHeading>Notification Preferences</SectionHeading>
        </div>

        {notifLoaded ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <ToggleRow
              id="notif-read-receipts"
              label="Read receipts"
              description="Mark messages as read when you open them."
              checked={notifPrefs.readReceipts}
              onChange={(v) => updateNotifPref("readReceipts", v)}
            />
            <ToggleRow
              id="notif-order-status"
              label="Order status updates"
              description="Get notified when a purchase order changes status."
              checked={notifPrefs.orderStatusUpdates}
              onChange={(v) => updateNotifPref("orderStatusUpdates", v)}
            />
            <ToggleRow
              id="notif-rfq-deadlines"
              label="RFQ deadline reminders"
              description="Receive reminders before an open RFQ closes."
              checked={notifPrefs.rfqDeadlineReminders}
              onChange={(v) => updateNotifPref("rfqDeadlineReminders", v)}
            />
          </div>
        ) : (
          <div className="space-y-3 py-1">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        )}

        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          These preferences are stored locally in your browser and do not affect
          server-side notifications.
        </p>
      </section>

      {/* ── Display preferences ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <LayoutDashboard
            size={15}
            className="text-slate-400 dark:text-slate-500"
          />
          <SectionHeading>Display Preferences</SectionHeading>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <ToggleRow
            id="display-archived-offerings"
            label="Show archived offerings"
            description="Include archived material offerings in the offerings list."
            checked={includeArchivedOfferings}
            onChange={setIncludeArchivedOfferings}
          />
        </div>
      </section>

      {/* ── Account ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={15} className="text-slate-400 dark:text-slate-500" />
          <SectionHeading>Account</SectionHeading>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <Link
            href="/supplier/company"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          >
            <Building2 size={15} />
            Edit Company Profile
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-400 dark:hover:border-red-800 dark:hover:bg-red-950/30"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
