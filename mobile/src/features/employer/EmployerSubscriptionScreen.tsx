import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import { useRefreshOnFocus } from "../../lib/useRefreshOnFocus";
import type { EmployerType } from "../../types/auth";
import { useAuth } from "../auth/AuthProvider";
import EmployerMobileShell from "./EmployerMobileShell";

declare global {
  interface Window {
    Cashfree?: (options: { mode: "sandbox" | "production" }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<void> | void;
    };
  }
}

type EmployerProfile = {
  contact_person_name?: string | null;
  employer_type?: EmployerType | null;
  subscription_valid_until?: string | null;
  trial_ends_at?: string | null;
  trial_active?: boolean;
  subscription_active?: boolean;
  payment_required?: boolean;
  free_worker_limit: number;
  free_workers_used: number;
  free_workers_remaining: number;
  commission_required_for_next_worker: boolean;
  commission_amount: number;
};

type PaymentHistoryItem = {
  id: string;
  order_id: string;
  payment_category: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  payment_success_at?: string | null;
  subscription_valid_from?: string | null;
  subscription_valid_until?: string | null;
  validity_status: string;
  job_title?: string | null;
  worker_name?: string | null;
};

type SubscriptionOrder = {
  order_id: string;
  payment_session_id: string;
};

type PaymentVerification = {
  status: string;
};

const BUSINESS_TYPES = new Set<EmployerType>([
  "REGISTERED_INDUSTRY",
  "REGISTERED_BUSINESS",
  "UNREGISTERED_BUSINESS",
]);

function requestError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Unable to complete the request.";
}

async function loadCashfree() {
  if (window.Cashfree) return window.Cashfree;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load secure Cashfree checkout."));
    document.head.appendChild(script);
  });
  if (!window.Cashfree) throw new Error("Cashfree checkout is unavailable.");
  return window.Cashfree;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryLabel(category: string) {
  return category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(amount);
}

function PaymentHistoryCard({ payment }: { payment: PaymentHistoryItem }) {
  return (
    <article className="employer-subscription-payment">
      <div className="employer-subscription-payment-heading">
        <div>
          <h3>{categoryLabel(payment.payment_category)}</h3>
          <p>{payment.order_id}</p>
        </div>
        <strong>{money(payment.amount, payment.currency)}</strong>
      </div>
      <div className="employer-subscription-payment-details">
        <p><strong>Date:</strong> {formatDateTime(payment.payment_success_at || payment.created_at)}</p>
        <p><strong>Status:</strong> {payment.status}</p>
        {payment.job_title && <p><strong>Job:</strong> {payment.job_title}</p>}
        {payment.worker_name && <p><strong>Worker:</strong> {payment.worker_name}</p>}
        <p><strong>Valid from:</strong> {payment.validity_status === "N/A" ? "N/A" : formatDateTime(payment.subscription_valid_from)}</p>
        <p><strong>Valid until:</strong> {payment.validity_status === "N/A" ? "N/A" : formatDateTime(payment.subscription_valid_until)}</p>
      </div>
      <p className="employer-subscription-validity">Validity: {payment.validity_status}</p>
    </article>
  );
}

export default function EmployerSubscriptionScreen() {
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState<EmployerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentState, setPaymentState] = useState<"idle" | "creating" | "verifying" | "success" | "failure">("idle");
  const [reloadToken, setReloadToken] = useState(0);
  const verifiedOrderRef = useRef<string | null>(null);
  const verificationInProgressRef = useRef(false);
  const returnOrderId = new URLSearchParams(location.search).get("order_id");

  const verifyReturnedOrder = useCallback(async (orderId: string) => {
    if (verificationInProgressRef.current) return;
    verificationInProgressRef.current = true;
    verifiedOrderRef.current = orderId;
    setPaymentState("verifying");
    setPaymentMessage("Verifying payment...");
    setPaymentError("");
    try {
      const verification = await apiPost<PaymentVerification>(`/api/v1/payments/verify/${encodeURIComponent(orderId)}`, {});
      setReloadToken((current) => current + 1);
      if (verification.status === "SUCCESS") {
        setPaymentState("success");
        setPaymentMessage("Payment successful");
        navigate("/employer/subscription", { replace: true });
      } else {
        setPaymentState("failure");
        setPaymentError(`Payment status: ${verification.status}`);
      }
    } catch (error: unknown) {
      setPaymentState("failure");
      setPaymentError(requestError(error));
    } finally {
      verificationInProgressRef.current = false;
    }
  }, [navigate]);

  useEffect(() => {
    if (authLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    let active = true;
    void apiGet<EmployerProfile>("/api/v1/employers/me")
      .then((response) => {
        if (active) {
          setProfile(response);
          setProfileError("");
        }
      })
      .catch((error: unknown) => {
        if (active) setProfileError(requestError(error));
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, nextStep, reloadToken, user]);

  useEffect(() => {
    if (authLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    let active = true;
    void apiGet<PaymentHistoryItem[]>("/api/v1/payments/history")
      .then((response) => {
        if (active) {
          setPaymentHistory(response);
          setHistoryError("");
        }
      })
      .catch((error: unknown) => {
        if (active) setHistoryError(requestError(error));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, nextStep, reloadToken, user]);

  useEffect(() => {
    if (authLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    const orderId = returnOrderId;
    if (!orderId || verifiedOrderRef.current === orderId) return;
    void verifyReturnedOrder(orderId);
  }, [authLoading, nextStep, returnOrderId, user, verifyReturnedOrder]);

  useRefreshOnFocus(() => {
    setProfileLoading(true);
    setHistoryLoading(true);
    setProfileError("");
    setHistoryError("");
    setReloadToken((current) => current + 1);
  }, !authLoading && user?.role === "EMPLOYER" && nextStep === "DASHBOARD" && !paymentLoading);

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (user.role !== "EMPLOYER") return <Navigate to={user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;

  const refresh = () => {
    setProfileLoading(true);
    setHistoryLoading(true);
    setProfileError("");
    setHistoryError("");
    setReloadToken((current) => current + 1);
  };

  const subscribe = async () => {
    if (paymentLoading) return;
    setPaymentLoading(true);
    setPaymentMessage("Creating secure payment...");
    setPaymentError("");
    setPaymentState("creating");
    try {
      const order = await apiPost<SubscriptionOrder>("/api/v1/payments/create-subscription-order");
      const cashfree = await loadCashfree();
      const mode = import.meta.env.VITE_CASHFREE_ENV === "production" ? "production" : "sandbox";
      await cashfree({ mode }).checkout({ paymentSessionId: order.payment_session_id, redirectTarget: "_self" });
      setPaymentState("verifying");
      setPaymentMessage("Payment is processing. Payment status will update after checkout returns.");
    } catch (error: unknown) {
      setPaymentState("failure");
      setPaymentMessage("");
      setPaymentError(requestError(error));
    } finally {
      setPaymentLoading(false);
    }
  };

  const retryHistory = () => {
    setHistoryLoading(true);
    setHistoryError("");
    setReloadToken((current) => current + 1);
  };

  if (profileLoading && !profile) {
    return (
      <EmployerMobileShell name={user.name} employerType={user.employer_type} profilePhotoUrl={user.profile_photo_url}>
        <main className="employer-dashboard">
          <div className="employer-subscription-loading" role="status"><LoaderCircle size={20} className="spin" /> Loading subscription...</div>
        </main>
      </EmployerMobileShell>
    );
  }

  if (profileError || !profile) {
    return (
      <EmployerMobileShell name={user.name} employerType={user.employer_type} profilePhotoUrl={user.profile_photo_url}>
        <main className="employer-dashboard">
          <div className="employer-subscription-error" role="alert">
            <p>{profileError || "Unable to load subscription details."}</p>
            <button className="employer-primary-button" type="button" onClick={refresh}>Try again</button>
          </div>
        </main>
      </EmployerMobileShell>
    );
  }

  const employerType = profile.employer_type || user.employer_type || null;
  const isIndividual = employerType === "INDIVIDUAL";
  const isBusiness = employerType !== null && BUSINESS_TYPES.has(employerType);
  const trialActive = Boolean(profile.trial_active);
  const subscriptionActive = Boolean(profile.subscription_active);
  const active = subscriptionActive || trialActive;
  const paymentRequired = Boolean(profile.payment_required);
  const expiry = formatDate(profile.subscription_valid_until) || formatDate(profile.trial_ends_at);
  const canSubscribe = isBusiness && paymentRequired;
  const plan = isBusiness ? "Business subscription" : isIndividual ? "Individual hirer" : "Subscription";
  const price = isBusiness ? "₹2,000 / month" : isIndividual ? `₹${profile.commission_amount} per additional worker dispatched` : "Unavailable";
  const showHistoryEmpty = !historyLoading && !historyError && paymentHistory.length === 0;

  return (
    <EmployerMobileShell name={profile.contact_person_name || user.name} employerType={employerType} profilePhotoUrl={user.profile_photo_url}>
      <main className="employer-dashboard employer-subscription-page">
        <header className="employer-subscription-heading">
          <p className="employer-eyebrow">Account management</p>
          <h1>{isIndividual ? "Commission & Billing" : "Subscription"}</h1>
          <p>{isIndividual ? "Review your pay-per-worker commission details and dispatch status." : "Manage your subscription and payment details."}</p>
          <button className="employer-subscription-refresh" type="button" onClick={refresh} disabled={profileLoading || historyLoading}>
            <RefreshCw size={16} className={profileLoading || historyLoading ? "spin" : ""} aria-hidden="true" />
            Refresh
          </button>
        </header>

        <section className="employer-section-card employer-subscription-billing">
          <h2>{isIndividual ? "Billing model" : "Current subscription"}</h2>
          <div className="employer-subscription-overview">
            <article className="employer-subscription-info-card">
              <p className="employer-subscription-label">Current status</p>
              {isIndividual ? (
                <>
                  <strong className={`employer-subscription-status${profile.free_workers_remaining > 0 ? " is-active" : " is-inactive"}`}>
                    {profile.free_workers_remaining > 0 ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
                    {profile.free_workers_remaining > 0 ? `${profile.free_worker_limit} Workers Free` : "No free workers remaining"}
                  </strong>
                  <p>{profile.free_workers_used} of {profile.free_worker_limit} free workers used.</p>
                  <p>{profile.free_workers_remaining > 0
                    ? `${profile.free_workers_remaining} free workers remaining.`
                    : `Additional unique workers use the ₹${profile.commission_amount} commission flow.`}</p>
                  <p>{profile.commission_required_for_next_worker
                    ? `Commission required for the next unique worker: ₹${profile.commission_amount}.`
                    : "No commission is required for the next unique worker."}</p>
                </>
              ) : (
                <>
                  <strong className={`employer-subscription-status${active ? " is-active" : " is-inactive"}`}>
                    {active ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
                    {trialActive ? "FREE TRIAL ACTIVE" : subscriptionActive ? "ACTIVE" : paymentRequired ? "Payment Required" : "Not Active"}
                  </strong>
                  {expiry && <p>Active until: {expiry}</p>}
                  {!active && !paymentRequired && <p>No active subscription or trial.</p>}
                </>
              )}
            </article>
            <article className="employer-subscription-info-card">
              <p className="employer-subscription-label">Plan</p>
              <strong className="employer-subscription-plan">{plan}</strong>
              <p className="employer-subscription-price">{price}</p>
              {isBusiness && <p>{trialActive ? "1 Month Free Trial" : subscriptionActive || paymentRequired ? "₹2,000 / 30 days" : "Billing period: Monthly"}</p>}
              {isIndividual && <p>{profile.free_workers_used} of {profile.free_worker_limit} free unique workers used. Additional workers: ₹{profile.commission_amount} each.</p>}
            </article>
          </div>

          {isIndividual && (
            <div className="employer-subscription-entitlements">
              <strong>How the free-worker entitlements work:</strong>
              <ul>
                <li>You receive {profile.free_worker_limit} free unique workers for life.</li>
                <li>Each accepted worker is counted once per employer, even across jobs.</li>
                <li>Workers after the free limit use the existing ₹{profile.commission_amount} commission payment flow.</li>
              </ul>
            </div>
          )}
          {paymentMessage && (
            <p className={`employer-subscription-message${paymentState === "success" ? " is-success" : ""}`} role="status">
              {paymentState === "success" && <CheckCircle2 size={17} aria-hidden="true" />}
              {paymentMessage}
            </p>
          )}
          {paymentError && (
            <div className="employer-subscription-payment-error" role="alert">
              <AlertCircle size={17} />
              <span>{paymentError}</span>
              {returnOrderId && (
                <button type="button" onClick={() => void verifyReturnedOrder(returnOrderId)} disabled={paymentState === "verifying"}>
                  {paymentState === "verifying" ? "Verifying..." : "Retry verification"}
                </button>
              )}
            </div>
          )}
          {canSubscribe && (
            <button className="employer-primary-button employer-subscription-action" type="button" onClick={() => void subscribe()} disabled={paymentLoading}>
              {paymentLoading && <LoaderCircle size={17} className="spin" aria-hidden="true" />}
              {paymentLoading ? "Creating secure payment..." : paymentRequired ? "Subscribe Now" : "Renew Subscription"}
            </button>
          )}
        </section>

        <aside className="employer-subscription-side">
          <section className="employer-section-card employer-subscription-payment-info">
            <h2>Payment</h2>
            <p>Payments are securely handled through Cashfree checkout.</p>
            <p>Last payment status is available after returning from checkout.</p>
          </section>
          <section className="employer-section-card employer-subscription-history">
            <h2>Payment history</h2>
            {historyLoading && <p className="employer-subscription-history-state" role="status"><LoaderCircle size={17} className="spin" /> Loading payment history...</p>}
            {!historyLoading && historyError && (
              <div className="employer-subscription-history-error" role="alert">
                <p>{historyError}</p>
                <button type="button" onClick={retryHistory}>Try again</button>
              </div>
            )}
            {showHistoryEmpty && <p className="employer-subscription-history-state">{isIndividual ? "No commission payment history available." : "No business subscription payment history available."}</p>}
            {!historyLoading && !historyError && paymentHistory.map((payment) => <PaymentHistoryCard key={payment.id} payment={payment} />)}
          </section>
        </aside>
      </main>
    </EmployerMobileShell>
  );
}
