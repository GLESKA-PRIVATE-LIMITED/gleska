"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, LoaderCircle, RefreshCw } from "lucide-react";
import { procurementApi } from "@/lib/procurement-api";
import type { ProcurementWorkspaces, ProcurementWorkspaceKind } from "@/lib/procurement-api";

interface ProcurementWorkspaceSwitchProps {
  className?: string;
  currentWorkspace?: ProcurementWorkspaceKind;
  onSwitch?: () => void;
}

export default function ProcurementWorkspaceSwitch({
  className = "",
  currentWorkspace,
  onSwitch,
}: ProcurementWorkspaceSwitchProps) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<ProcurementWorkspaces | null>(null);
  const [switching, setSwitching] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    setLoadError(false);
    try {
      setWorkspaces(await procurementApi.getWorkspaces());
    } catch {
      setWorkspaces(null);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const handleDirectSwitch = async () => {
    if (onSwitch) onSwitch();
    if (!workspaces) {
      router.push("/procurement/workspaces?switch=1");
      return;
    }

    // Determine target workspace:
    // If current is BUYER -> target is SUPPLIER (if authorized)
    // If current is SUPPLIER -> target is BUYER (if authorized)
    const targetKind: ProcurementWorkspaceKind =
      currentWorkspace === "BUYER" ? "SUPPLIER" : "BUYER";

    const isTargetAuthorized = workspaces.available_workspaces.some(
      (w) => w.kind === targetKind,
    );

    if (isTargetAuthorized) {
      setSwitching(true);
      try {
        await procurementApi.updateWorkspacePreference(targetKind);
        router.push(targetKind === "BUYER" ? "/procurement" : "/supplier");
      } catch {
        // Fallback safely to selector if preference save fails
        router.push("/procurement/workspaces?switch=1");
      } finally {
        setSwitching(false);
      }
    } else {
      // If target workspace is not directly authorized, send to selector or setup
      router.push("/procurement/workspaces?switch=1");
    }
  };

  const sharedClassName = `inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 disabled:opacity-60 disabled:cursor-wait ${className}`;

  if (loadError) {
    return (
      <button
        type="button"
        onClick={() => void loadWorkspaces()}
        className={`${sharedClassName} text-rose-700 dark:text-rose-300`}
        aria-label="Retry loading workspace options"
        aria-live="polite"
      >
        <RefreshCw size={15} />
        Workspace options unavailable — retry
      </button>
    );
  }

  if (!workspaces || workspaces.available_workspaces.length < 2) return null;

  return (
    <button
      type="button"
      onClick={() => void handleDirectSwitch()}
      disabled={switching}
      className={sharedClassName}
      title={currentWorkspace === "BUYER" ? "Switch to Supplier Workspace" : "Switch to Buyer Workspace"}
    >
      {switching ? (
        <LoaderCircle size={15} className="animate-spin text-purple-600 dark:text-purple-400" />
      ) : (
        <ArrowLeftRight size={15} />
      )}
      <span>Switch Workspace</span>
    </button>
  );
}
