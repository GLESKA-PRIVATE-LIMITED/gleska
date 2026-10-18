import { useCallback, useEffect, useState } from "react";
import { AlertCircle, LoaderCircle, Search, ShoppingCart, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { procurementWorkspaceApi } from "./procurementApi";

function errorText(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : "Procurement overview could not be loaded.";
}

export default function ProcurementOverviewScreen() {
  const [requirementsCount, setRequirementsCount] = useState<number | null>(null);
  const [requirementsHaveMore, setRequirementsHaveMore] = useState(false);
  const [activeConversationsCount, setActiveConversationsCount] = useState<number | null>(null);
  const [conversationsHaveMore, setConversationsHaveMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [requestsResult, conversationsResult] = await Promise.allSettled([
        procurementWorkspaceApi.listRequests(),
        procurementWorkspaceApi.listConversations(),
      ]);
      if (requestsResult.status === "fulfilled") {
        setRequirementsCount(requestsResult.value.items.length);
        setRequirementsHaveMore(requestsResult.value.has_more);
      } else {
        setRequirementsCount(null);
      }
      if (conversationsResult.status === "fulfilled") {
        setActiveConversationsCount(
          conversationsResult.value.items.filter((conversation) => conversation.status === "ACTIVE").length,
        );
        setConversationsHaveMore(conversationsResult.value.has_more);
      } else {
        setActiveConversationsCount(null);
      }
      const failures = [
        requestsResult.status === "rejected"
          ? `Saved requirements: ${errorText(requestsResult.reason)}`
          : "",
        conversationsResult.status === "rejected"
          ? `AI conversations: ${errorText(conversationsResult.reason)}`
          : "",
      ].filter(Boolean);
      if (failures.length) setError(failures.join(" "));
    } catch (loadError) {
      setRequirementsCount(null);
      setActiveConversationsCount(null);
      setError(errorText(loadError));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return (
    <main className="procurement-overview">
      <section className="procurement-overview-actions" aria-label="Procurement actions">
        <Link className="procurement-overview-action is-active" to="/procurement/requirements?view=create">
          <Sparkles size={16} aria-hidden="true" />
          <span>AI Procurement Assistant</span>
        </Link>
        <Link className="procurement-overview-action" to="/procurement/get">
          <ShoppingCart size={16} aria-hidden="true" />
          <span>Get Procurement</span>
        </Link>
      </section>

      <Link className="procurement-overview-search" to="/procurement/get">
        <Search size={17} aria-hidden="true" />
        <span>Open Get Procurement to match a saved requirement</span>
      </Link>
      <p className="procurement-overview-description">
        Compare active supplier listings in Get Procurement, then create a persistent RFQ from the Requests for Quote workspace. Matching alone does not contact suppliers.
      </p>

      {error && (
        <div className="procurement-overview-error" role="alert">
          <AlertCircle size={17} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => void loadOverview()} disabled={loading}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="procurement-overview-loading" role="status">
          <LoaderCircle size={20} className="procurement-agent-spin" />
          <span>Loading Procurement overview…</span>
        </div>
      ) : (
        <section className="procurement-overview-stats" aria-label="Procurement summary">
          <article className="procurement-overview-stat">
            <strong>{requirementsCount ?? "—"}</strong>
            <span>{requirementsHaveMore ? "Loaded saved material requirements" : "Saved material requirements"}</span>
          </article>
          <article className="procurement-overview-stat">
            <strong>{activeConversationsCount ?? "—"}</strong>
            <span>{conversationsHaveMore ? "Active conversations in loaded results" : "Active AI conversations"}</span>
          </article>
        </section>
      )}
    </main>
  );
}
