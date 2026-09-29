"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AccountManagementShell, { formatEmployerType } from "@/components/AccountManagementShell";
import PaymentHistoryList, { type PaymentHistoryItem } from "@/components/PaymentHistoryList";
import { formatSubscriptionExpiry, isSubscriptionActive } from "@/lib/subscription";

interface EmployerProfile {
  contact_person_name?: string | null;
  employer_type?: string | null;
  subscription_valid_until?: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_active?: boolean;
  trial_days_remaining?: number;
  subscription_active?: boolean;
  payment_required?: boolean;
  free_worker_limit: number;
  free_workers_used: number;
  free_workers_remaining: number;
  commission_required_for_next_worker: boolean;
  commission_amount: number;
  has_availed_free_dispatch?: boolean | null;
}

declare global {
  interface Window {
    Cashfree?: (options: { mode: "sandbox" | "production" }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<void> | void;
    };
  }
}

const BUSINESS_TYPES = new Set([
  "REGISTERED_INDUSTRY",
  "REGISTERED_BUSINESS",
  "UNREGISTERED_BUSINESS",
]);

function getRequestError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response;
    if (typeof response?.data?.detail === "string") return response.data.detail;
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

export default function SubscriptionPage() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [profile, setProfile] = React.useState<EmployerProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = React.useState(true);
  const [isPaymentLoading, setIsPaymentLoading] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [paymentState, setPaymentState] = React.useState<"idle" | "creating" | "verifying" | "success" | "failure">("idle");
  const [paymentHistory, setPaymentHistory] = React.useState<PaymentHistoryItem[]>([]);
  const verifiedOrderRef = React.useRef<string | null>(null);
  const profileRequestRef = React.useRef(0);
  const [employeeCount, setEmployeeCount] = React.useState(1);

  const loadPaymentHistory = React.useCallback(async () => {
    try {
      const response = await apiClient.get<PaymentHistoryItem[]>("/api/v1/payments/history", { withCredentials: true });
      setPaymentHistory(response.data);
    } catch {
      setPaymentHistory([]);
    }
  }, []);

  const verifyReturnedOrder = React.useCallback(async (orderId: string) => {
    setPaymentState("verifying");
    setMessage("Verifying payment...");
    try {
      const response = await apiClient.post(`/api/v1/payments/verify/${encodeURIComponent(orderId)}`);
      const profileResponse = await apiClient.get<EmployerProfile>("/api/v1/employers/me", { withCredentials: true });
      profileRequestRef.current += 1;
      setProfile(profileResponse.data);
      await loadPaymentHistory();
      if (response.data.status === "SUCCESS") {
        setPaymentState("success");
        setMessage("Payment successful");
        router.replace("/employer/subscription", { scroll: false });
      } else {
        setPaymentState("failure");
        setError(`Payment failed: ${response.data.status}`);
      }
    } catch (requestError: unknown) {
      setPaymentState("failure");
      setError(getRequestError(requestError));
    }
  }, [loadPaymentHistory, router]);

  React.useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/employer/auth");
      return;
    }
    if (user.role !== "EMPLOYER") {
      router.replace("/");
      return;
    }
    if (nextStep !== "DASHBOARD") {
      router.replace("/employer/onboarding");
      return;
    }

    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    void loadPaymentHistory();
    apiClient.get<EmployerProfile>("/api/v1/employers/me", { withCredentials: true })
      .then((response) => {
        if (profileRequestRef.current === requestId) setProfile(response.data);
      })
      .catch((requestError: unknown) => setError(getRequestError(requestError)))
      .finally(() => setIsProfileLoading(false));
  }, [isLoading, loadPaymentHistory, nextStep, router, user, verifyReturnedOrder]);

  React.useEffect(() => {
    if (isLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    const orderId = new URLSearchParams(window.location.search).get("order_id");
    if (!orderId) return;

    if (verifiedOrderRef.current === orderId) return;
    verifiedOrderRef.current = orderId;
    void verifyReturnedOrder(orderId);
  }, [isLoading, nextStep, router, user, verifyReturnedOrder]);

  const handleSubscribe = async () => {
    if (isPaymentLoading) return;
    setIsPaymentLoading(true);
    setMessage("");
    setError("");
    setPaymentState("creating");
    setMessage("Creating secure payment...");
    try {
      const response = await apiClient.post(
        "/api/v1/payments/create-subscription-order",
        isIndividual ? { employee_count: employeeCount } : undefined,
        { withCredentials: true },
      );
      const cashfree = await loadCashfree();
      const mode = process.env.NEXT_PUBLIC_CASHFREE_ENV === "production" ? "production" : "sandbox";
      await cashfree({ mode }).checkout({
        paymentSessionId: response.data.payment_session_id,
        redirectTarget: "_self",
      });
      setPaymentState("verifying");
    } catch (requestError: unknown) {
      setPaymentState("failure");
      setError(getRequestError(requestError));
    } finally {
      setIsPaymentLoading(false);
    }
  };

  if (isLoading || isProfileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <Loader2 size={36} className="animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user || user.role !== "EMPLOYER" || !profile) return null;

  const employerType = profile.employer_type || "";
  const isBusiness = BUSINESS_TYPES.has(employerType);
  const isIndividual = employerType === "INDIVIDUAL";
  const trialActive = Boolean(profile.trial_active);
  const subscriptionActive = Boolean(profile.subscription_active);
  const active = subscriptionActive || trialActive;
  const paymentRequired = Boolean(profile.payment_required);
  const expiry = formatSubscriptionExpiry(profile.subscription_valid_until) || formatSubscriptionExpiry(profile.trial_ends_at);
  const canSubscribe = isBusiness && paymentRequired;
  const plan = isBusiness ? "Business subscription" : isIndividual ? "Individual hirer" : "Subscription";
  const commissionAmount = profile.commission_amount;
  const freeWorkerLimit = profile.free_worker_limit;
  const freeWorkersUsed = profile.free_workers_used;
  const freeWorkersRemaining = profile.free_workers_remaining;
  const price = isBusiness ? "₹2,000 / month" : isIndividual ? `₹${commissionAmount} per additional worker dispatched` : "Unavailable";

  return (
    <AccountManagementShell
      kind="employer"
      name={profile.contact_person_name || user.name}
      accountLabel={formatEmployerType(employerType)}
      employerType={employerType}
      profileHref="/employer/company-profile"
      onLogout={() => void logout()}
    >
    <main className="min-h-screen px-4 py-8 text-slate-900 dark:text-slate-100 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 border-b border-slate-200 pb-6 dark:border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Account Management</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">
            {isIndividual ? "Commission & Billing" : "Subscription"}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {isIndividual
              ? "Review your pay-per-worker commission details and dispatch status."
              : "Manage your subscription and payment details."}
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {isIndividual ? "Billing Model" : "Current Subscription"}
            </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-800/70">
              <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Current status</p>
              {isIndividual ? (
                <>
                  <p className="mt-2 flex items-center gap-2 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {freeWorkersRemaining > 0 ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                    {freeWorkersRemaining > 0 ? `${freeWorkerLimit} Workers Free` : "No free workers remaining"}
                  </p>
                  <p className="mt-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                    {freeWorkersUsed} of {freeWorkerLimit} free workers used.
                  </p>
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    {freeWorkersRemaining > 0
                      ? `${freeWorkersRemaining} free workers remaining.`
                      : `Additional unique workers use the ₹${commissionAmount} commission flow.`}
                  </p>
                  <p className="mt-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                    {profile.commission_required_for_next_worker
                      ? `Commission required for the next unique worker: ₹${commissionAmount}.`
                      : "No commission is required for the next unique worker."}
                  </p>
                </>
              ) : (
                <>
                  <p className={`mt-2 flex items-center gap-2 text-lg font-bold ${active ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {active ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                    {trialActive ? "FREE TRIAL ACTIVE" : subscriptionActive ? "ACTIVE" : paymentRequired ? "Payment Required" : "Not Active"}
                  </p>
                  {expiry && (
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Active until: {expiry}</p>
                  )}
                  {!active && !paymentRequired && (
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">No active subscription or trial.</p>
                  )}
                </>
              )}
            </div>
            <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-800/70">
              <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Plan</p>
              <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{plan}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{price}</p>
              {isBusiness && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {trialActive ? "1 Month Free Trial" : subscriptionActive ? "₹2,000 / 30 days" : paymentRequired ? "₹2,000 / 30 days" : "Billing period: Monthly"}
                </p>
              )}
              {isIndividual && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {freeWorkersUsed} of {freeWorkerLimit} free unique workers used. Additional workers: ₹{commissionAmount} each.
                </p>
              )}
            </div>
          </div>

          {isIndividual && (
            <div className="mt-6 rounded-xl bg-blue-50 px-5 py-4 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
              <p className="font-semibold">How the free-worker entitlements work:</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-blue-800 dark:text-blue-300">
                <li>You receive {freeWorkerLimit} free unique workers for life.</li>
                <li>Each accepted worker is counted once per employer, even across jobs.</li>
                <li>Workers after the free limit use the existing ₹{commissionAmount} commission payment flow.</li>
              </ul>
            </div>
          )}
          {message && <p className={`mt-6 rounded-xl px-4 py-3 text-sm ${paymentState === "success" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"}`} role="status">{paymentState === "success" && "✓ "}{message}</p>}
          {error && <p className="mt-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" role="alert">{error}</p>}

          {canSubscribe && (
            <button
              type="button"
              onClick={() => void handleSubscribe()}
              disabled={isPaymentLoading}
              className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isPaymentLoading && <Loader2 size={17} className="animate-spin" />}
              {isPaymentLoading ? "Creating secure payment..." : paymentRequired ? "Subscribe Now" : "Renew Subscription"}
            </button>
          )}
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment</h2>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Payments are securely handled through Cashfree checkout.</p>
              <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Last payment status is available after returning from checkout.</p>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment History</h2>
              <PaymentHistoryList items={paymentHistory} emptyMessage={isIndividual ? "No commission payment history available." : "No business subscription payment history available."} />
            </section>
          </aside>
        </div>
      </div>
    </main>
    </AccountManagementShell>
  );
}
