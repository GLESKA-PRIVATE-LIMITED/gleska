"use client";

import React from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import {
  formatCredits,
  formatRupees,
  openCashfreeCheckout,
  purchaseApi,
  purchaseError,
  type CreditPurchase,
  type PurchaseOptions,
} from "@/lib/billing-api";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900";

function requestCode(error: unknown): string | null {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : null;
}

const ERROR_TEXT: Record<string, string> = {
  BILLING_ACCOUNT_SUSPENDED: "Your billing account is suspended. Please contact GO LESKA support.",
  PAYMENT_PROVIDER_UNAVAILABLE: "The payment service is not responding. Please try again in a few minutes.",
};

/** Whole-credit purchase box. The server computes the rupee amount; this preview is display-only. */
export function BuyCredits({ options }: { options: PurchaseOptions }) {
  const [value, setValue] = React.useState("50");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const invalid = purchaseError(value, options);
  const preview = invalid ? null : formatRupees((Number(value) * Number(options.credit_value_inr)).toFixed(2));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const order = await purchaseApi.create(Number(value));
      await openCashfreeCheckout(order.payment_session_id);
    } catch (err) {
      const code = requestCode(err);
      setError((code && ERROR_TEXT[code]) || "We couldn't start the payment. Please try again.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/20">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Buy credits</h3>
      <p className="mt-1 text-xs text-slate-500">
        {options.min_credits}–{options.max_credits.toLocaleString("en-IN")} credits per payment · 1 credit = ₹{formatCredits(options.credit_value_inr)} · Paid securely via Cashfree
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="w-40 text-xs font-semibold text-slate-600 dark:text-slate-300">
          Credits
          <input
            className={`${inputClass} mt-1`}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={Boolean(invalid)}
            aria-describedby="buy-credits-hint"
          />
        </label>
        <button
          type="submit"
          disabled={Boolean(invalid) || busy}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {preview ? `Pay ${preview}` : "Pay"}
        </button>
      </div>
      <p id="buy-credits-hint" className={`mt-2 text-xs ${invalid ? "text-rose-600" : "text-slate-500"}`}>
        {invalid ?? "Credits are added as soon as Cashfree confirms the payment."}
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    </form>
  );
}

const STATUS_TEXT: Record<string, string> = { PAID: "Paid", PENDING: "Awaiting payment", EXPIRED: "Expired", FAILED: "Failed" };

export function PurchaseHistory({ purchases }: { purchases: CreditPurchase[] }) {
  if (purchases.length === 0) return <p className="mt-4 text-sm text-slate-500">No purchases yet.</p>;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr><th className="py-2 pr-4">Date</th><th className="pr-4">Credits</th><th className="pr-4">Amount</th><th className="pr-4">Status</th><th /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {purchases.map((p) => (
            <tr key={p.order_id}>
              <td className="whitespace-nowrap py-2 pr-4">{new Date(p.paid_at ?? p.created_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}</td>
              <td className="pr-4">{formatCredits(p.credits)}</td>
              <td className="pr-4">{formatRupees(p.amount_inr)}</td>
              <td className="pr-4">{STATUS_TEXT[p.status] ?? p.status}</td>
              <td className="text-right">
                {p.status === "PAID" && (
                  <Link href={`/employer/billing/receipt/${encodeURIComponent(p.order_id)}`} className="text-xs font-semibold text-blue-600 hover:underline">
                    Receipt
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type ReturnState = { kind: "checking" } | { kind: "paid"; credits: string } | { kind: "pending" } | { kind: "closed" } | { kind: "error" };

/** Shown after Cashfree redirects back with ?order_id=… */
export function PaymentReturnBanner({ state }: { state: ReturnState }) {
  const tone =
    state.kind === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : state.kind === "checking" || state.kind === "pending" ? "border-blue-200 bg-blue-50 text-blue-800"
      : "border-rose-200 bg-rose-50 text-rose-800";
  const text = {
    checking: "Confirming your payment with Cashfree...",
    paid: state.kind === "paid" ? `Payment received — ${formatCredits(state.credits)} credits added to your balance.` : "",
    pending: "We haven't received confirmation yet. If money was deducted, the credits will appear automatically within a few minutes.",
    closed: "This payment was not completed, so no credits were added.",
    error: "We couldn't confirm this payment right now. Refresh in a minute; credits are added automatically once Cashfree confirms.",
  }[state.kind];
  return (
    <div role="status" className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${tone}`}>
      {state.kind === "paid" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
        : state.kind === "checking" || state.kind === "pending" ? <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin" />
        : <XCircle size={18} className="mt-0.5 shrink-0" />}
      <p>{text}</p>
    </div>
  );
}

/** Polls the server-side verification a few times; Cashfree can take a moment to settle. */
export async function confirmReturnedOrder(orderId: string, attempts = 5, delayMs = 2000): Promise<ReturnState> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const purchase = await purchaseApi.verify(orderId);
      if (purchase.status === "PAID") return { kind: "paid", credits: purchase.credits };
      if (purchase.status !== "PENDING") return { kind: "closed" };
    } catch {
      if (i === attempts - 1) return { kind: "error" };
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { kind: "pending" };
}
