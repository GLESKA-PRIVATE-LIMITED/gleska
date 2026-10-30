"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Plug, X } from "lucide-react";
import { groupConnectors, type useConnectors } from "./useConnectors";

type ConnectorsState = ReturnType<typeof useConnectors>;

interface ConnectorsListProps {
  state: ConnectorsState;
  /** Show only connected providers. */
  connectedOnly?: boolean;
  emptyMessage?: string;
}

export default function ConnectorsList({ state, connectedOnly = false, emptyMessage }: ConnectorsListProps) {
  const { connectors, loading, actionInFlight, handleConnect, handleDisconnect } = state;
  const visible = connectedOnly ? connectors.filter((c) => c.connected) : connectors;
  const groups = groupConnectors(visible);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 size={28} className="animate-spin text-blue-600" />
      </div>
    );
  }

  if (!groups.length) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        {emptyMessage || "No connectors available."}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {groups.map(({ category, connectors: items }) => (
          <section key={category}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {category}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((connector) => (
                <div
                  key={connector.id}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                        <Plug size={18} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                          {connector.name}
                        </h3>
                        {connector.connected && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 size={11} />
                            {connector.always_on ? "Always on" : "Connected"}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{connector.description}</p>
                  </div>
                  <div className="shrink-0">
                    {connector.connected && !connector.always_on ? (
                      <button
                        type="button"
                        onClick={() => handleDisconnect(connector)}
                        disabled={actionInFlight === connector.id}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                      >
                        {actionInFlight === connector.id ? <Loader2 size={12} className="animate-spin" /> : "Disconnect"}
                      </button>
                    ) : connector.always_on ? (
                      <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        Active
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleConnect(connector)}
                        disabled={actionInFlight === connector.id}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {state.tokenModalProvider && <ConnectorTokenModal state={state} />}
    </>
  );
}

function ConnectorTokenModal({ state }: { state: ConnectorsState }) {
  const provider = state.tokenModalProvider;
  const [tokenInput, setTokenInput] = useState("");
  if (!provider) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Connect {provider.name}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {provider.requires_oauth
                ? "Paste an OAuth access token from the provider. (Full OAuth flow setup requires platform admin configuration.)"
                : "Paste the API key or webhook URL for this provider."}
            </p>
          </div>
          <button
            type="button"
            onClick={state.closeTokenModal}
            className="shrink-0 text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <input
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder={
            provider.id === "microsoft_teams"
              ? "Teams webhook URL (https://...)"
              : "Access token or API key"
          }
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={state.closeTokenModal}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              if (await state.submitToken(tokenInput)) setTokenInput("");
            }}
            disabled={!tokenInput.trim() || state.actionInFlight === provider.id}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
          >
            {state.actionInFlight === provider.id ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              "Connect"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
