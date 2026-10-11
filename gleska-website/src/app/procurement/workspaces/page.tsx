"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Building2, LoaderCircle, ShoppingCart } from "lucide-react";
import type {
  ProcurementWorkspaceKind,
  ProcurementWorkspaceOption,
  ProcurementWorkspaces,
} from "@/lib/procurement-api";
import { procurementApi } from "@/lib/procurement-api";

function responseStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === "number" ? status : null;
}

export default function ProcurementWorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<ProcurementWorkspaces | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ProcurementWorkspaceKind | null>(null);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const autoRedirected = useRef(false);

  const loadWorkspaces = useCallback(async (forceSelection = false) => {
    setLoading(true);
    setError("");
    setUnauthorized(false);
    try {
      const response = await procurementApi.getWorkspaces();
      setWorkspaces(response);
      const preferredWorkspace = response.preferred_workspace;
      const preferenceIsAuthorized = preferredWorkspace !== null
        && response.available_workspaces.some((workspace) => workspace.kind === preferredWorkspace);
      if (!forceSelection && !autoRedirected.current && preferenceIsAuthorized) {
        autoRedirected.current = true;
        router.replace(preferredWorkspace === "BUYER" ? "/procurement" : "/supplier");
      }
    } catch (loadError) {
      if (responseStatus(loadError) === 401) {
        setUnauthorized(true);
      } else {
        setError("Procurement workspaces could not be loaded. Please retry.");
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const forceSelection = new URLSearchParams(window.location.search).get("switch") === "1";
    void loadWorkspaces(forceSelection);
  }, [loadWorkspaces]);

  const openWorkspace = async (workspace: ProcurementWorkspaceOption) => {
    setSaving(workspace.kind);
    setError("");
    try {
      const response = await procurementApi.updateWorkspacePreference(workspace.kind);
      const selectionWasSaved = response.preferred_workspace === workspace.kind
        && response.available_workspaces.some((available) => available.kind === workspace.kind);
      if (!selectionWasSaved) {
        setWorkspaces(response);
        setError("Your workspace access or preference changed. Reload the available workspaces and try again.");
        return;
      }
      router.replace(workspace.kind === "BUYER" ? "/procurement" : "/supplier");
    } catch (saveError) {
      if (responseStatus(saveError) === 401) {
        setUnauthorized(true);
      } else if (responseStatus(saveError) === 403) {
        setError("You no longer have access to that workspace. Reload the available workspaces.");
      } else {
        setError("Your workspace preference could not be saved. Please retry.");
      }
    } finally {
      setSaving(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-purple-700 dark:text-purple-300">
            GLESKA Procurement
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
            Choose a workspace
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Buyer and Supplier workspaces use your existing employer profile and supplier company memberships.
            Your preference is saved separately from those permissions.
          </p>
        </header>

        {error && (
          <div role="alert" className="mb-5 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <AlertCircle size={18} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => void loadWorkspaces()} className="font-semibold underline">
              Reload
            </button>
          </div>
        )}

        {unauthorized && (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            Your session has expired.{" "}
            <Link href="/auth/signin?next=%2Fprocurement%2Fworkspaces" className="font-bold underline">
              Sign in to continue
            </Link>
            .
          </div>
        )}

        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white text-sm font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <LoaderCircle size={20} className="animate-spin text-purple-600" />
            Loading authorized workspaces…
          </div>
        ) : !unauthorized && workspaces?.available_workspaces.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">No Procurement workspace available</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Buyer access requires a completed employer profile. Supplier access requires an active supplier company membership.
            </p>
            <Link href="/supplier" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-purple-700 hover:underline dark:text-purple-300">
              Open Supplier Workspace setup <ArrowRight size={16} />
            </Link>
          </div>
        ) : !unauthorized && workspaces ? (
          <section aria-label="Available Procurement workspaces" className="grid gap-4 sm:grid-cols-2">
            {workspaces.available_workspaces.map((workspace) => {
              const buyer = workspace.kind === "BUYER";
              const active = workspaces.preferred_workspace === workspace.kind;
              const Icon = buyer ? ShoppingCart : Building2;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => void openWorkspace(workspace)}
                  disabled={saving !== null}
                  className={`group rounded-2xl border bg-white p-5 text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-wait disabled:opacity-60 dark:bg-slate-900 ${
                    active
                      ? "border-purple-300 ring-2 ring-purple-100 dark:border-purple-700 dark:ring-purple-950"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                    buyer
                      ? "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300"
                      : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                  }`}>
                    <Icon size={21} />
                  </span>
                  <span className="mt-4 flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-base font-bold text-slate-900 dark:text-white">
                        {buyer ? "Buyer Workspace" : workspace.name}
                      </span>
                      <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">
                        {buyer
                          ? "Create material requests, discover suppliers, and manage RFQs and purchase orders."
                          : "Manage supplier companies, verification, offerings, RFQs, quotations, and fulfillment."}
                      </span>
                    </span>
                    {saving === workspace.kind
                      ? <LoaderCircle size={18} className="shrink-0 animate-spin text-purple-600" />
                      : <ArrowRight size={18} className="shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-purple-600" />}
                  </span>
                  {active && (
                    <span className="mt-4 inline-block rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
                      Preferred workspace
                    </span>
                  )}
                </button>
              );
            })}
          </section>
        ) : null}

        <footer className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href="/employer/dashboard" className="font-semibold text-slate-600 hover:text-purple-700 dark:text-slate-300 dark:hover:text-purple-300">
            Employer Dashboard
          </Link>
          <Link href="/supplier" className="font-semibold text-slate-600 hover:text-purple-700 dark:text-slate-300 dark:hover:text-purple-300">
            Supplier Workspace
          </Link>
        </footer>
      </div>
    </main>
  );
}
