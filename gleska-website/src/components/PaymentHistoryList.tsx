"use client";

import React from "react";

export interface PaymentHistoryItem {
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
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryLabel(category: string): string {
  return category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function PaymentHistoryList({
  items,
  emptyMessage = "No payment history available.",
}: {
  items: PaymentHistoryItem[];
  emptyMessage?: string;
}) {
  if (!items.length) {
    return <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{emptyMessage}</p>;
  }

  return (
    <div className="mt-4 space-y-3">
      {items.map((payment) => (
        <article key={payment.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{categoryLabel(payment.payment_category)}</p>
              <p className="mt-1 font-mono text-xs text-slate-500">{payment.order_id}</p>
            </div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">₹{payment.amount.toLocaleString("en-IN")}</span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
            <p><span className="font-semibold">Date:</span> {formatDateTime(payment.payment_success_at || payment.created_at)}</p>
            <p><span className="font-semibold">Status:</span> {payment.status}</p>
            {payment.job_title && <p><span className="font-semibold">Job:</span> {payment.job_title}</p>}
            {payment.worker_name && <p><span className="font-semibold">Worker:</span> {payment.worker_name}</p>}
            <p><span className="font-semibold">Valid from:</span> {payment.validity_status === "N/A" ? "N/A" : formatDateTime(payment.subscription_valid_from)}</p>
            <p><span className="font-semibold">Valid until:</span> {payment.validity_status === "N/A" ? "N/A" : formatDateTime(payment.subscription_valid_until)}</p>
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Validity: {payment.validity_status}
          </p>
        </article>
      ))}
    </div>
  );
}
