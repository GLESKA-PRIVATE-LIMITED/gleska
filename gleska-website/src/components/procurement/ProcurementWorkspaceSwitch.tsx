"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import type { ProcurementWorkspaceKind } from "@/lib/procurement-api";

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
  const targetHref = currentWorkspace === "BUYER" ? "/supplier" : "/procurement";
  const targetLabel = currentWorkspace === "BUYER" ? "Provide Procurement" : "Get Procurement";

  return (
    <button
      type="button"
      onClick={() => {
        onSwitch?.();
        router.push(targetHref);
      }}
      className={`inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 ${className}`}
      title={targetLabel}
    >
      <ArrowLeftRight size={15} />
      <span>{targetLabel}</span>
    </button>
  );
}
