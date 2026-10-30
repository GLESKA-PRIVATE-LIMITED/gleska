"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  Plug,
  Settings as SettingsIcon,
  X,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";

type Connector = {
  id: string;
  name: string;
  description: string;
  icon: string;
  requires_oauth: boolean;
  oauth_configured?: boolean;
  always_on: boolean;
  connected: boolean;
  connected_at?: string | null;
  expires_at?: string | null;
};

const CATEGORY_MAP: Record<string, { category: string; order: number }> = {
  ocr: { category: "Document Intelligence", order: 1 },
  whatsapp: { category: "Candidate Communication", order: 2 },
  gmail: { category: "Candidate Communication", order: 2 },
  outlook: { category: "Candidate Communication", order: 2 },
  linkedin: { category: "Candidate Communication", order: 2 },
  google_calendar: { category: "Scheduling", order: 3 },
  zoom: { category: "Scheduling", order: 3 },
  google_drive: { category: "Google Workspace", order: 4 },
  google_docs: { category: "Google Workspace", order: 4 },
  google_sheets: { category: "Google Workspace", order: 4 },
  google_forms: { category: "Google Workspace", order: 4 },
  microsoft_365: { category: "Microsoft 365", order: 5 },
  slack: { category: "Team Notifications", order: 6 },
  microsoft_teams: { category: "Team Notifications", order: 6 },
  instagram: { category: "Social Media", order: 7 },
  facebook: { category: "Social Media", order: 7 },
  github: { category: "Developer Portfolio", order: 8 },
  tallyprime: { category: "Accounting", order: 9 },
};

export default function ConnectorsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [tokenModalProvider, setTokenModalProvider] = useState<Connector | null>(null);
  const [tokenInput, setTokenInput] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const fetchConnectors = async () => {
    try {
      setLoading(true);
      const { data } = await apiClient.get<{ connectors: Connector[] }>(
        "/api/v1/connectors",
        { withCredentials: true },
      );
      setConnectors(data.connectors);
    } catch {
      toast.error("Failed to load connectors.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchConnectors();
  }, [user]);

  // Handle redirect-back from OAuth callback.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const err = params.get("error");
    const provider = params.get("provider");
    if (connected) {
      toast.success(`${connected} connected successfully.`);
      window.history.replaceState({}, "", "/employer/connectors");
      if (user) fetchConnectors();
    } else if (err) {
      toast.error(`Failed to connect ${provider || "provider"}: ${err}`);
      window.history.replaceState({}, "", "/employer/connectors");
    }
  }, [user]);

  const handleConnect = async (connector: Connector) => {
    if (connector.always_on) {
      toast.info(`${connector.name} is always available for your account.`);
      return;
    }

    // For OAuth providers with configured client credentials — redirect to the authorize URL.
    if (connector.requires_oauth && connector.oauth_configured) {
      try {
        setActionInFlight(connector.id);
        const { data } = await apiClient.get<{ authorize_url: string }>(
          `/api/v1/connectors/oauth/${connector.id}/init`,
          { withCredentials: true },
        );
        window.location.href = data.authorize_url;
        return;
      } catch {
        toast.error(`Failed to start OAuth for ${connector.name}.`);
        setActionInFlight(null);
        return;
      }
    }

    // Fallback: show the paste-a-token modal for providers without an OAuth client
    // (API-key-based providers like Teams webhooks, MSG91, Tally — or OAuth providers
    // whose client credentials haven't been configured in the backend yet).
    setTokenModalProvider(connector);
    setTokenInput("");
  };

  const handleDisconnect = async (connector: Connector) => {
    if (!confirm(`Disconnect ${connector.name}?`)) return;
    try {
      setActionInFlight(connector.id);
      await apiClient.post(
        "/api/v1/connectors/disconnect",
        { provider: connector.id },
        { withCredentials: true },
      );
      toast.success(`${connector.name} disconnected.`);
      await fetchConnectors();
    } catch {
      toast.error(`Failed to disconnect ${connector.name}.`);
    } finally {
      setActionInFlight(null);
    }
  };

  const submitToken = async () => {
    if (!tokenModalProvider || !tokenInput.trim()) return;
    try {
      setActionInFlight(tokenModalProvider.id);
      await apiClient.post(
        "/api/v1/connectors/connect",
        {
          provider: tokenModalProvider.id,
          access_token: tokenInput.trim(),
        },
        { withCredentials: true },
      );
      toast.success(`${tokenModalProvider.name} connected.`);
      setTokenModalProvider(null);
      setTokenInput("");
      await fetchConnectors();
    } catch {
      toast.error("Failed to save credentials.");
    } finally {
      setActionInFlight(null);
    }
  };

  const grouped = connectors.reduce<Record<string, Connector[]>>((acc, c) => {
    const meta = CATEGORY_MAP[c.id] || { category: "Other", order: 99 };
    if (!acc[meta.category]) acc[meta.category] = [];
    acc[meta.category].push(c);
    return acc;
  }, {});

  const sortedCategories = Object.keys(grouped).sort(
    (a, b) =>
      (grouped[a][0] ? (CATEGORY_MAP[grouped[a][0].id]?.order ?? 99) : 99) -
      (grouped[b][0] ? (CATEGORY_MAP[grouped[b][0].id]?.order ?? 99) : 99),
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/employer/dashboard")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">AI Assistant Connectors</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Connect external services to extend what the AI Assistant can do during conversations.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 size={28} className="animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="space-y-6">
            {sortedCategories.map((category) => (
              <section key={category}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {category}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {grouped[category].map((connector) => (
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
        )}
      </div>

      {tokenModalProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Connect {tokenModalProvider.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {tokenModalProvider.requires_oauth
                    ? "Paste an OAuth access token from the provider. (Full OAuth flow setup requires platform admin configuration.)"
                    : "Paste the API key or webhook URL for this provider."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTokenModalProvider(null)}
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
                tokenModalProvider.id === "microsoft_teams"
                  ? "Teams webhook URL (https://...)"
                  : "Access token or API key"
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTokenModalProvider(null)}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitToken}
                disabled={!tokenInput.trim() || actionInFlight === tokenModalProvider.id}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {actionInFlight === tokenModalProvider.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  "Connect"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
