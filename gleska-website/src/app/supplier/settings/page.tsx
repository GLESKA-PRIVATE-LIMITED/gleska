"use client";

import { useState } from "react";
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
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: ToggleRowProps) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start justify-between gap-4 rounded-xl px-1 py-2.5 transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-70"
          : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
      }`}
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
          disabled={disabled}
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
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
  const {
    selectedMembership,
    includeArchivedOfferings,
    supplierSettingsLoaded,
    supplierSettingsLoading,
    supplierSettingsSaving,
    supplierSettingsError,
    setIncludeArchivedOfferings,
    refreshSupplierSettings,
  } = useSupplier();
  const [settingsSuccess, setSettingsSuccess] = useState("");

  async function updateArchivedOfferingsPreference(value: boolean) {
    setSettingsSuccess("");
    if (await setIncludeArchivedOfferings(value)) {
      setSettingsSuccess("Display preference saved to your supplier account.");
    }
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

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <ToggleRow
            id="notif-read-receipts"
            label="Read receipts"
            description="Unavailable: Supplier messaging does not currently support read receipts."
            checked={false}
            disabled
          />
          <ToggleRow
            id="notif-order-status"
            label="Order status updates"
            description="Unavailable: Supplier purchase-order status changes do not currently deliver notifications."
            checked={false}
            disabled
          />
          <ToggleRow
            id="notif-rfq-deadlines"
            label="RFQ deadline reminders"
            description="Unavailable: Supplier RFQ deadline reminders have no configured scheduler or delivery mechanism."
            checked={false}
            disabled
          />
        </div>

        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          These controls will become available when the corresponding Supplier
          messaging and notification services are implemented.
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
          {supplierSettingsLoaded ? (
            <ToggleRow
              id="display-archived-offerings"
              label="Show archived offerings"
              description="Include archived material offerings in the offerings list. This preference is saved to your authenticated supplier account."
              checked={includeArchivedOfferings}
              onChange={(value) => void updateArchivedOfferingsPreference(value)}
              disabled={
                !selectedMembership ||
                supplierSettingsLoading ||
                supplierSettingsSaving
              }
            />
          ) : (
            <div
              role="status"
              className="flex items-center gap-3 px-1 py-2.5 text-sm text-slate-500"
            >
              <span className="h-5 w-9 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
              {supplierSettingsLoading
                ? "Loading saved display preferences…"
                : "Saved display preferences are not available."}
            </div>
          )}
        </div>
        {!selectedMembership && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            An active supplier company membership is required to manage this preference.
          </p>
        )}
        {supplierSettingsError && (
          <div
            role="alert"
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          >
            <span>{supplierSettingsError}</span>
            <button
              type="button"
              onClick={() => void refreshSupplierSettings()}
              disabled={supplierSettingsLoading || supplierSettingsSaving}
              className="font-semibold underline disabled:opacity-60"
            >
              Retry
            </button>
          </div>
        )}
        {supplierSettingsSaving && (
          <p role="status" className="mt-3 text-sm text-slate-500">
            Saving display preference…
          </p>
        )}
        {settingsSuccess && !supplierSettingsError && (
          <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
            {settingsSuccess}
          </p>
        )}
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
