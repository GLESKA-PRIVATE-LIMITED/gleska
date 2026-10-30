"use client";

import React, { useState } from "react";
import { Info } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import ConnectorsList from "@/components/connectors/ConnectorsList";
import { useConnectors } from "@/components/connectors/useConnectors";

type Tab = "all" | "connected";

export default function PluginsView() {
  const { user } = useAuth();
  const connectorsState = useConnectors(Boolean(user));
  const [tab, setTab] = useState<Tab>("all");
  const connectedCount = connectorsState.connectors.filter((connector) => connector.connected).length;

  return (
    <div className="h-full overflow-y-auto bg-[#f7f8fc] dark:bg-slate-950">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Plugins</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Connect external services to your Gleska account. Connections are shared across your Gleska AI assistants.
        </p>

        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          <Info size={15} className="mt-0.5 shrink-0" />
          <p>
            Connected plugins are currently used by the Hiring AI Assistant. General Work chat doesn&apos;t call plugins yet.
            Signing in with a provider returns you to the Connectors page.
          </p>
        </div>

        <div className="mt-6 flex rounded-xl border border-slate-200 bg-white p-1 sm:inline-flex dark:border-slate-800 dark:bg-slate-900" role="tablist" aria-label="Plugin filter">
          {(["all", "connected"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex-1 rounded-lg px-4 py-1.5 text-xs font-semibold transition sm:flex-none ${
                tab === id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {id === "all" ? "Available" : `Connected${connectorsState.loading ? "" : ` (${connectedCount})`}`}
            </button>
          ))}
        </div>

        <div className="mt-6">
          <ConnectorsList
            state={connectorsState}
            connectedOnly={tab === "connected"}
            emptyMessage={tab === "connected" ? "No plugins are connected yet." : "No plugins are available."}
          />
        </div>
      </div>
    </div>
  );
}
