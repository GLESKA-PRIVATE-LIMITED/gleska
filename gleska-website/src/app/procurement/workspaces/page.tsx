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
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import BackLink from "@/components/auth/BackLink";

function responseStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === "number" ? status : null;
}

export default function ProcurementWorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<ProcurementWorkspaces | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [saving, setSaving] = useState<ProcurementWorkspaceKind | null>(null);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const autoRedirected = useRef(false);

  const loadWorkspaces = useCallback(async (forceSelection = false) => {
    setLoading(true);
    setIsRedirecting(false);
    setError("");
    setUnauthorized(false);
    try {
      const response = await procurementApi.getWorkspaces();
      const preferredWorkspace = response.preferred_workspace;
      const preferenceIsAuthorized = preferredWorkspace !== null
        && response.available_workspaces.some((workspace) => workspace.kind === preferredWorkspace);

      if (!forceSelection && !autoRedirected.current && preferenceIsAuthorized) {
        autoRedirected.current = true;
        setIsRedirecting(true);
        router.replace(preferredWorkspace === "BUYER" ? "/procurement" : "/supplier");
        return;
      }

      setWorkspaces(response);
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

  const showWorkspaceChooser = !loading && !isRedirecting && !unauthorized && workspaces && workspaces.available_workspaces.length > 0;

  return (
    <AuthPageFrame contentClassName="items-center">
      <div className="w-full">
        <div className="mx-auto w-full max-w-4xl space-y-6 text-center">
          <div className="mb-5 text-left">
            <BackLink href="/employer/dashboard" label="Back to Dashboard" />
          </div>

          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
              GLESKA Procurement
            </div>
            <h1 className="font-[var(--font-anton)] text-4xl sm:text-5xl uppercase leading-tight tracking-wide text-slate-900 dark:text-white">
              Choose a workspace
            </h1>
            <p className="mx-auto max-w-xl text-base font-medium text-slate-600 dark:text-slate-300">
              Select a workspace below to manage requests and supplier operations. Your preference is remembered for future visits.
            </p>
          </div>

          {error && (
            <div role="alert" className="mx-auto max-w-2xl flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-left text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              <div className="flex items-center gap-3">
                <AlertCircle size={18} className="shrink-0" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadWorkspaces(true)}
                className="font-semibold underline hover:text-rose-900 dark:hover:text-rose-100"
              >
                Reload
              </button>
            </div>
          )}

          {unauthorized && (
            <div role="alert" className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="font-semibold">Your session has expired.</p>
              <div className="mt-4">
                <Link
                  href="/auth/signin?next=%2Fprocurement%2Fworkspaces"
                  className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  Sign in to continue
                </Link>
              </div>
            </div>
          )}

          {(loading || isRedirecting) && (
            <div className="mx-auto flex min-h-64 max-w-md flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200/80 bg-white/80 p-8 shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 text-sm font-medium text-slate-600 dark:text-slate-300">
              <LoaderCircle size={24} className="animate-spin text-indigo-600 dark:text-indigo-400" />
              <span>{isRedirecting ? "Redirecting to your preferred workspace…" : "Loading authorized workspaces…"}</span>
            </div>
          )}

          {!loading && !isRedirecting && !unauthorized && workspaces && workspaces.available_workspaces.length === 0 && (
            <div className="mx-auto max-w-lg rounded-3xl border border-slate-200/80 bg-white/80 p-8 text-center shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wider text-slate-900 dark:text-white">
                No Workspace Available
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Buyer access requires a completed employer profile. Supplier access requires an active supplier company membership.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/supplier"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700"
                >
                  Set up Supplier Workspace <ArrowRight size={16} />
                </Link>
                <Link
                  href="/employer/dashboard"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Employer Dashboard
                </Link>
              </div>
            </div>
          )}

          {showWorkspaceChooser && (
            <div className={`grid grid-cols-1 gap-6 text-left ${workspaces.available_workspaces.length === 1 ? "mx-auto max-w-md" : "md:grid-cols-2"}`}>
              {workspaces.available_workspaces.map((workspace) => {
                const isBuyer = workspace.kind === "BUYER";
                const isPreferred = workspaces.preferred_workspace === workspace.kind;
                const isSavingThis = saving === workspace.kind;
                const Icon = isBuyer ? ShoppingCart : Building2;

                return (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => void openWorkspace(workspace)}
                    disabled={saving !== null}
                    className={`group relative flex flex-col justify-between rounded-3xl border bg-white/80 p-6 sm:p-8 shadow-2xl shadow-slate-900/5 backdrop-blur-xl text-left transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl disabled:cursor-wait disabled:opacity-60 dark:bg-slate-900/90 ${
                      isBuyer
                        ? "border-slate-200/80 hover:border-blue-500/60 dark:border-slate-800/80"
                        : "border-slate-200/80 hover:border-amber-500/60 dark:border-slate-800/80"
                    } ${
                      isPreferred
                        ? isBuyer
                          ? "ring-2 ring-blue-500/40 border-blue-400 dark:ring-blue-500/30"
                          : "ring-2 ring-amber-500/40 border-amber-400 dark:ring-amber-500/30"
                        : ""
                    }`}
                  >
                    <div className="w-full space-y-4">
                      <div className="flex items-center justify-between">
                        <div
                          className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl border transition-transform group-hover:scale-105 ${
                            isBuyer
                              ? "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400"
                              : "border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                          }`}
                        >
                          <Icon size={28} />
                        </div>
                        {isPreferred && (
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                              isBuyer
                                ? "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-300"
                                : "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-300"
                            }`}
                          >
                            Preferred
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        <h2
                          className={`font-[var(--font-anton)] text-2xl uppercase tracking-wider text-slate-900 transition-colors dark:text-white ${
                            isBuyer
                              ? "group-hover:text-blue-600 dark:group-hover:text-blue-400"
                              : "group-hover:text-amber-600 dark:group-hover:text-amber-400"
                          }`}
                        >
                          {isBuyer ? "Buyer Workspace" : workspace.name}
                        </h2>
                        <p className="text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                          {isBuyer
                            ? "Create material requests, discover suppliers, and manage RFQs and purchase orders."
                            : "Manage supplier companies, verification, offerings, RFQs, quotations, and fulfillment."}
                        </p>
                      </div>
                    </div>

                    <div
                      className={`mt-8 flex items-center justify-between gap-2 text-sm font-bold transition-colors ${
                        isBuyer
                          ? "text-blue-600 group-hover:text-blue-700 dark:text-blue-400 dark:group-hover:text-blue-300"
                          : "text-amber-600 group-hover:text-amber-700 dark:text-amber-400 dark:group-hover:text-amber-300"
                      }`}
                    >
                      <span>{isPreferred ? "Open Preferred Workspace" : "Select Workspace"}</span>
                      {isSavingThis ? (
                        <LoaderCircle size={18} className="shrink-0 animate-spin" />
                      ) : (
                        <ArrowRight size={18} className="shrink-0 transition-transform group-hover:translate-x-1" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AuthPageFrame>
  );
}
