"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { procurementApi } from "@/lib/procurement-api";
import type { ProcurementWorkspaces } from "@/lib/procurement-api";

interface ProcurementWorkspaceSwitchProps {
  className?: string;
}

export default function ProcurementWorkspaceSwitch({
  className = "",
}: ProcurementWorkspaceSwitchProps) {
  const [workspaces, setWorkspaces] = useState<ProcurementWorkspaces | null>(null);
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

  const sharedClassName = `inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 ${className}`;

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
    <Link href="/procurement/workspaces?switch=1" className={sharedClassName}>
      Switch Workspace
    </Link>
  );
}
