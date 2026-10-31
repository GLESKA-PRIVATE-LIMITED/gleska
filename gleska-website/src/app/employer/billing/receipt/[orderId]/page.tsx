"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { formatCredits, formatRupees, purchaseApi, type CreditReceipt } from "@/lib/billing-api";

/** Printable payment receipt for a paid AI-credit purchase (owner only; enforced by the API). */
export default function CreditReceiptPage() {
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const orderId = decodeURIComponent(params.orderId ?? "");
  const { user, isLoading } = useAuth();
  const [receipt, setReceipt] = React.useState<CreditReceipt | null>(null);
  const [failed, setFailed] = React.useState(false);
  const isEmployer = user?.role === "EMPLOYER";

  React.useEffect(() => {
    if (!isLoading && !isEmployer) router.replace("/employer/auth");
  }, [isLoading, isEmployer, router]);

  React.useEffect(() => {
    if (!isEmployer || !orderId) return;
    void purchaseApi.receipt(orderId).then(setReceipt).catch(() => setFailed(true));
  }, [isEmployer, orderId]);

  if (isLoading || !isEmployer || (!receipt && !failed)) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 size={32} className="animate-spin text-blue-600" /></div>;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 print:py-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/employer/billing" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
          <ArrowLeft size={16} /> Back to AI Credits
        </Link>
        {receipt && (
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Printer size={16} /> Print / Save as PDF
          </button>
        )}
      </div>

      {!receipt ? (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          This receipt isn&apos;t available. Receipts exist only for completed payments on your own account.
        </p>
      ) : (
        <article className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-900 shadow-sm print:border-0 print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment receipt</p>
              <h1 className="mt-1 text-2xl font-bold">{receipt.seller_name}</h1>
            </div>
            <dl className="text-right text-sm">
              <dt className="text-slate-500">Receipt no.</dt>
              <dd className="font-semibold" data-testid="receipt-number">{receipt.receipt_number}</dd>
              <dt className="mt-2 text-slate-500">Date</dt>
              <dd className="font-semibold">{new Date(receipt.paid_at).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })}</dd>
            </dl>
          </header>

          <section className="mt-6 text-sm">
            <p className="text-slate-500">Received from</p>
            <p className="font-semibold">{receipt.buyer_name || "Employer"}</p>
            {receipt.buyer_email && <p className="text-slate-600">{receipt.buyer_email}</p>}
          </section>

          <table className="mt-6 w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <tr><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th></tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-3">GO LESKA AI credits (prepaid)</td>
                <td className="py-3 text-right">{formatCredits(receipt.credits)}</td>
                <td className="py-3 text-right">{formatRupees(receipt.credit_value_inr)}</td>
                <td className="py-3 text-right">{formatRupees(receipt.amount_inr)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr><td colSpan={3} className="pt-4 text-right font-bold">Total paid</td><td className="pt-4 text-right text-lg font-bold" data-testid="receipt-total">{formatRupees(receipt.amount_inr)}</td></tr>
            </tfoot>
          </table>

          <dl className="mt-6 grid grid-cols-2 gap-3 text-xs text-slate-600">
            <div><dt className="text-slate-400">Order ID</dt><dd className="break-all">{receipt.order_id}</dd></div>
            {receipt.cf_payment_id && <div><dt className="text-slate-400">Payment reference</dt><dd className="break-all">{receipt.cf_payment_id}</dd></div>}
            {receipt.payment_method && <div><dt className="text-slate-400">Payment method</dt><dd className="uppercase">{receipt.payment_method.replace(/_/g, " ")}</dd></div>}
          </dl>
          <p className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">{receipt.note}</p>
        </article>
      )}
    </main>
  );
}
