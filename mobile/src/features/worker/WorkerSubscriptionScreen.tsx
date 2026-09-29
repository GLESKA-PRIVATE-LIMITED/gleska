import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { apiGet, apiPost } from "../../lib/api";
import WorkerMobileShell from "./WorkerMobileShell";

declare global {
  interface Window {
    Cashfree?: (options: { mode: "sandbox" | "production" }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<void> | void;
    };
  }
}

type WorkerProfile = {
  id?: string;
  account_type?: string | null;
  subscription_valid_until?: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_active?: boolean;
  subscription_active?: boolean;
  payment_required?: boolean;
};

function getRequestError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    if (typeof detail === "string") return detail;
  }
  return error instanceof Error ? error.message : "Unable to complete the request.";
}

async function loadCashfree() {
  if (window.Cashfree) return window.Cashfree;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Cashfree checkout"));
    document.head.appendChild(script);
  });
  if (!window.Cashfree) throw new Error("Cashfree checkout is unavailable");
  return window.Cashfree;
}

function formatSubscriptionExpiry(value?: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export default function WorkerSubscriptionScreen() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [paymentState, setPaymentState] = useState<"idle" | "creating" | "verifying" | "success" | "failure">("idle");
  const verifiedOrderRef = useRef<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<WorkerProfile>("/api/v1/workers/me");
      setProfile(data);
    } catch (requestError) {
      setError(getRequestError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyReturnedOrder = useCallback(async (orderId: string) => {
    setPaymentState("verifying");
    setMessage("Verifying payment...");
    try {
      const response = await apiPost<{ status: string }>(`/api/v1/payments/worker/verify/${encodeURIComponent(orderId)}`);
      await loadProfile();
      if (response.status === "SUCCESS") {
        setPaymentState("success");
        setMessage("Payment successful");
      } else {
        setPaymentState("failure");
        setError(`Payment failed: ${response.status}`);
      }
    } catch (requestError) {
      setPaymentState("failure");
      setError(getRequestError(requestError));
    }
  }, [loadProfile]);

  useEffect(() => {
    if (!user && !isLoading) {
      navigate("/auth/signin", { replace: true });
      return;
    }
    if (user && user.role !== "WORKER" && !isLoading) {
      navigate("/worker/auth", { replace: true });
      return;
    }
    if (!user || isLoading) return;
    void loadProfile();
  }, [isLoading, loadProfile, navigate, user]);

  useEffect(() => {
    if (isLoading || user?.role !== "WORKER") return;
    const orderId = new URLSearchParams(window.location.search).get("order_id");
    if (!orderId) return;
    if (verifiedOrderRef.current === orderId) return;
    verifiedOrderRef.current = orderId;
    void verifyReturnedOrder(orderId);
  }, [isLoading, user, verifyReturnedOrder]);

  const handleSubscribe = async () => {
    if (paymentLoading) return;
    setPaymentLoading(true);
    setMessage("");
    setError("");
    setPaymentState("creating");
    setMessage("Creating secure payment...");
    try {
      const response = await apiPost<{ payment_session_id: string }>("/api/v1/payments/worker/create-subscription-order");
      const cashfree = await loadCashfree();
      const mode = import.meta.env.VITE_CASHFREE_ENV === "production" ? "production" : "sandbox";
      await cashfree({ mode }).checkout({ paymentSessionId: response.payment_session_id, redirectTarget: "_self" });
      setPaymentState("verifying");
    } catch (requestError) {
      setPaymentState("failure");
      setError(getRequestError(requestError));
    } finally {
      setPaymentLoading(false);
    }
  };

  if (isLoading || loading) {
    return (
      <WorkerMobileShell>
        <main className="worker-dashboard worker-attendance-page">
          <div className="worker-dashboard-state" style={{ minHeight: "260px" }}>
            <Loader2 size={18} className="icon-secondary spin" />
            <span>Loading subscription...</span>
          </div>
        </main>
      </WorkerMobileShell>
    );
  }

  if (!user || user.role !== "WORKER" || !profile) {
    return null;
  }

  const active = profile.subscription_active === true;
  const trialActive = profile.trial_active === true;

  const expiry = formatSubscriptionExpiry(profile.subscription_valid_until) || formatSubscriptionExpiry(profile.trial_ends_at);
  const showPaymentCta = !active;

  return (
    <WorkerMobileShell>
      <main className="worker-subscription-page">
        <header className="worker-subscription-header">
          <div>
            <p className="worker-subscription-eyebrow">Worker workspace</p>
            <h1>Subscription</h1>
          </div>
          <button type="button" className="worker-refresh-button" onClick={() => void loadProfile()}>
            <Loader2 size={16} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>
        </header>

        <section className="worker-subscription-intro">
          <p>Manage your subscription and payment details</p>
        </section>

        <section className="worker-subscription-panel">
          <h2 className="worker-subscription-section-heading">Current subscription</h2>

          <div className="worker-subscription-card">
            <div className="worker-subscription-card-header">
              <div>
                <p className="worker-subscription-card-label">Current status</p>
                <h3 className={active ? "worker-subscription-status worker-subscription-status--active" : "worker-subscription-status worker-subscription-status--inactive"}>
                  {active ? (
                    <>
                      <CheckCircle2 size={18} aria-hidden="true" />
                      <span>{trialActive ? "ACTIVE — FREE TRIAL" : "ACTIVE"}</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={18} aria-hidden="true" />
                      <span>SUBSCRIPTION REQUIRED</span>
                    </>
                  )}
                </h3>
              </div>
              {active && (
                <span className="worker-subscription-badge worker-subscription-badge--active">Active</span>
              )}
            </div>

            {active ? (
              <p className="worker-subscription-note">
                {trialActive ? "Free trial active until " : "Valid until "}
                {expiry || "your current plan"}
              </p>
            ) : (
              <p className="worker-subscription-note">Your free trial or subscription has ended.</p>
            )}
          </div>

          <div className="worker-subscription-card worker-subscription-plan-card">
            <p className="worker-subscription-card-label">Plan</p>
            <h3 className="worker-subscription-plan">Worker / Employee</h3>
            <p className="worker-subscription-plan-copy">
              {trialActive ? "1 Month Free Trial" : active ? "₹200 / 30 days" : "₹200 / 30 days"}
            </p>
            <p className="worker-subscription-plan-description">
              {trialActive
                ? "No payment required while the free trial is active."
                : active
                  ? "Your active subscription remains valid and no payment is required right now."
                  : "Secure payment through Cashfree is required to continue working."}
            </p>
          </div>

          {message && (
            <p className={`worker-subscription-message ${paymentState === "success" ? "is-success" : "is-info"}`} role="status">
              {paymentState === "success" && <CheckCircle2 size={16} aria-hidden="true" />}
              <span>{message}</span>
            </p>
          )}

          {error && (
            <p className="worker-subscription-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          {showPaymentCta && (
            <button
              type="button"
              className="worker-subscription-action-button"
              disabled={paymentLoading}
              onClick={() => void handleSubscribe()}
            >
              {paymentLoading ? "Creating secure payment..." : "Subscribe / Renew"}
            </button>
          )}

          {!showPaymentCta && !paymentLoading && (
            <div className="worker-subscription-active-banner" aria-live="polite">
              {trialActive ? "Trial Active — No Payment Required" : "Subscription Active — No Payment Required"}
            </div>
          )}

          {paymentLoading && (
            <div className="worker-subscription-processing" role="status">
              <Loader2 size={18} className="spin" aria-hidden="true" />
              <span>Processing secure payment...</span>
            </div>
          )}
        </section>
      </main>
    </WorkerMobileShell>
  );
}
