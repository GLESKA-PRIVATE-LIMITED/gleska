"use client";

// Shared state and actions for the AI Assistant connectors (/api/v1/connectors).
// Used by /employer/connectors and the General Work Plugins page.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import apiClient from "@/lib/api";

export type Connector = {
  id: string;
  name: string;
  description: string;
  icon: string;
  requires_oauth: boolean;
  oauth_configured?: boolean;
  always_on: boolean;
  connected: boolean;
  /** "expired" means the grant could not be renewed and the user must reconnect. */
  status?: "active" | "expired" | "disconnected" | null;
  connected_at?: string | null;
  expires_at?: string | null;
};

export const CONNECTOR_CATEGORY_MAP: Record<string, { category: string; order: number }> = {
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

/** One Google sign-in covers all of these; the backend connects and disconnects them together. */
const GOOGLE_CONNECTOR_IDS = new Set(["gmail", "google_calendar", "google_drive", "google_docs", "google_sheets", "google_forms"]);

/** The backend OAuth callback always returns to this page with ?connected= or ?error=. */
export const CONNECTORS_OAUTH_RETURN_PATH = "/employer/connectors";

export function groupConnectors(connectors: Connector[]): { category: string; connectors: Connector[] }[] {
  const grouped = connectors.reduce<Record<string, Connector[]>>((acc, c) => {
    const meta = CONNECTOR_CATEGORY_MAP[c.id] || { category: "Other", order: 99 };
    if (!acc[meta.category]) acc[meta.category] = [];
    acc[meta.category].push(c);
    return acc;
  }, {});

  return Object.keys(grouped)
    .sort(
      (a, b) =>
        (grouped[a][0] ? (CONNECTOR_CATEGORY_MAP[grouped[a][0].id]?.order ?? 99) : 99) -
        (grouped[b][0] ? (CONNECTOR_CATEGORY_MAP[grouped[b][0].id]?.order ?? 99) : 99),
    )
    .map((category) => ({ category, connectors: grouped[category] }));
}

export function useConnectors(enabled: boolean) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [tokenModalProvider, setTokenModalProvider] = useState<Connector | null>(null);

  const loadConnectors = useCallback(
    () =>
      apiClient
        .get<{ connectors: Connector[] }>("/api/v1/connectors", { withCredentials: true })
        .then(({ data }) => setConnectors(data.connectors))
        .catch(() => {
          toast.error("Failed to load connectors.");
        })
        .finally(() => setLoading(false)),
    [],
  );

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    await loadConnectors();
  }, [loadConnectors]);

  useEffect(() => {
    // `loading` starts as true, so the initial load doesn't need to set it.
    if (enabled) void loadConnectors();
  }, [enabled, loadConnectors]);

  const handleConnect = useCallback(async (connector: Connector) => {
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
  }, []);

  const handleDisconnect = useCallback(async (connector: Connector) => {
    const prompt = GOOGLE_CONNECTOR_IDS.has(connector.id)
      ? `Disconnect your Google account? Gmail, Calendar, Drive, Docs, Sheets and Forms share one Google sign-in and will all be disconnected.`
      : `Disconnect ${connector.name}?`;
    if (!confirm(prompt)) return;
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
  }, [fetchConnectors]);

  const submitToken = useCallback(async (token: string) => {
    if (!tokenModalProvider || !token.trim()) return false;
    try {
      setActionInFlight(tokenModalProvider.id);
      await apiClient.post(
        "/api/v1/connectors/connect",
        {
          provider: tokenModalProvider.id,
          access_token: token.trim(),
        },
        { withCredentials: true },
      );
      toast.success(`${tokenModalProvider.name} connected.`);
      setTokenModalProvider(null);
      await fetchConnectors();
      return true;
    } catch {
      toast.error("Failed to save credentials.");
      return false;
    } finally {
      setActionInFlight(null);
    }
  }, [fetchConnectors, tokenModalProvider]);

  return {
    connectors,
    loading,
    actionInFlight,
    tokenModalProvider,
    closeTokenModal: () => setTokenModalProvider(null),
    fetchConnectors,
    handleConnect,
    handleDisconnect,
    submitToken,
  };
}
