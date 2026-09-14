"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AccountManagementShell from "@/components/AccountManagementShell";
import { WorkerPageFrame, WorkerPageHeader, WorkspaceCard } from "@/components/worker/WorkspaceUI";
import PaymentHistoryList, { type PaymentHistoryItem } from "@/components/PaymentHistoryList";
import { formatSubscriptionExpiry, isSubscriptionActive } from "@/lib/subscription";

declare global {
  interface Window {
    Cashfree?: (options: { mode: "sandbox" | "production" }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<void> | void;
    };
  }
}

interface WorkerProfile {
  id: string;
  account_type?: string | null;
  subscription_valid_until?: string | null;
}

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

export default function WorkerSubscriptionPage() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [profile, setProfile] = React.useState<WorkerProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [paymentLoading, setPaymentLoading] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [paymentState, setPaymentState] = React.useState<"idle" | "creating" | "verifying" | "success" | "failure">("idle");
  const [paymentHistory, setPaymentHistory] = React.useState<PaymentHistoryItem[]>([]);
  const verifiedOrderRef = React.useRef<string | null>(null);
  const profileRequestRef = React.useRef(0);

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
      const response = await apiClient.post(`/api/v1/payments/worker/verify/${encodeURIComponent(orderId)}`);
      const profileResponse = await apiClient.get<WorkerProfile>("/api/v1/workers/me", { withCredentials: true });
      profileRequestRef.current += 1;
      setProfile(profileResponse.data);
      await loadPaymentHistory();
      if (response.data.status === "SUCCESS") {
        setPaymentState("success");
        setMessage("Payment successful");
        router.replace("/worker/subscription", { scroll: false });
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
      router.push("/worker/auth");
      return;
    }
    if (user.role !== "WORKER") {
      router.push("/");
      return;
    }
    if (nextStep !== "DASHBOARD") {
      router.push("/worker/onboarding");
      return;
    }
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    window.setTimeout(() => void loadPaymentHistory(), 0);
    apiClient.get<WorkerProfile>("/api/v1/workers/me", { withCredentials: true })
      .then((response) => {
        if (profileRequestRef.current === requestId) setProfile(response.data);
      })
      .catch((requestError: unknown) => setError(getRequestError(requestError)))
      .finally(() => setLoading(false));
  }, [isLoading, loadPaymentHistory, nextStep, router, user]);

  React.useEffect(() => {
    if (isLoading || user?.role !== "WORKER" || nextStep !== "DASHBOARD") return;
    const orderId = new URLSearchParams(window.location.search).get("order_id");
    if (!orderId) return;
    if (verifiedOrderRef.current === orderId) return;
    verifiedOrderRef.current = orderId;
    void verifyReturnedOrder(orderId);
  }, [isLoading, loadPaymentHistory, nextStep, router, user, verifyReturnedOrder]);

  const handleSubscribe = async () => {
    if (paymentLoading) return;
    setPaymentLoading(true);
    setMessage("");
    setError("");
    setPaymentState("creating");
    setMessage("Creating secure payment...");
    try {
      const response = await apiClient.post("/api/v1/payments/worker/create-subscription-order", undefined, { withCredentials: true });
      const cashfree = await loadCashfree();
      const mode = process.env.NEXT_PUBLIC_CASHFREE_ENV === "production" ? "production" : "sandbox";
      await cashfree({ mode }).checkout({ paymentSessionId: response.data.payment_session_id, redirectTarget: "_self" });
      setPaymentState("verifying");
    } catch (requestError: unknown) {
      setPaymentState("failure");
      setError(getRequestError(requestError));
    } finally {
      setPaymentLoading(false);
    }
  };

  if (isLoading || loading) return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950"><Loader2 size={36} className="animate-spin text-blue-600" /></div>;
  if (!user || user.role !== "WORKER" || !profile) return null;

  const active = isSubscriptionActive(profile.subscription_valid_until);
  const expiry = formatSubscriptionExpiry(profile.subscription_valid_until);
  return (
    <AccountManagementShell kind="worker" name={user.name} accountLabel={profile.account_type || "EMPLOYEE"} profileHref="/worker/profile" onLogout={() => void logout()}>
      <WorkerPageFrame className="text-slate-900 dark:text-slate-100">
          <WorkerPageHeader eyebrow="Worker workspace" title="Subscription" description="Manage your subscription and payment details." />
          <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-8"><h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Current Subscription</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-800/70"><p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Current status</p><p className={`mt-2 flex items-center gap-2 text-lg font-bold ${active ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{active ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}{active ? "Active" : profile.subscription_valid_until ? "Expired" : "Not Active"}</p>{expiry && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Expires: {expiry}</p>}</div>
              <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-800/70"><p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Plan</p><p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Worker / Employee</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">₹200 / month</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Billing period: Monthly</p></div>
            </div>
            {message && <p className={`mt-6 rounded-xl px-4 py-3 text-sm ${paymentState === "success" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"}`} role="status">{paymentState === "success" && "✓ "}{message}</p>}
            {error && <p className="mt-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" role="alert">{error}</p>}
            <button type="button" onClick={() => void handleSubscribe()} disabled={paymentLoading} className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{paymentLoading && <Loader2 size={17} className="animate-spin" />}{paymentLoading ? "Creating secure payment..." : active ? "Renew Subscription" : "Subscribe Now"}</button>
          </section><aside className="space-y-6"><WorkspaceCard><h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment</h2><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Payments are securely handled through Cashfree checkout.</p></WorkspaceCard><WorkspaceCard><h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment History</h2><PaymentHistoryList items={paymentHistory} emptyMessage="No worker payment history available." /></WorkspaceCard></aside></div>
      </WorkerPageFrame>
    </AccountManagementShell>
  );
}
