"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CreditCard, Eye, LoaderCircle, Plus, Search, Wallet } from "lucide-react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { financialConfig } from "@/components/agents/financial/financialConfig";
import apiClient from "@/lib/api";

type Currency = "INR" | "USD" | "EUR";
type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";
const FINANCIAL_API = "/api/v1/financial";

interface CurrencyAmount {
  currency: Currency;
  amount: number;
}

interface ReceivableInvoice {
  invoice_id: string;
  invoice_number: string;
  client_name: string;
  issue_date: string;
  due_date: string;
  currency: Currency;
  invoice_total: number;
  paid_amount: number;
  outstanding_amount: number;
  payment_status: PaymentStatus;
  is_overdue: boolean;
}

interface ReceivablesResponse {
  summary: {
    as_of_date: string;
    generated_invoice_count: number;
    outstanding_invoice_count: number;
    unpaid_count: number;
    partially_paid_count: number;
    overdue_count: number;
    paid_count: number;
    outstanding_by_currency: CurrencyAmount[];
  };
  invoices: ReceivableInvoice[];
}

interface PaymentRecord {
  id: string;
  invoice_id: string;
  amount: number;
  currency: Currency;
  payment_date: string;
  payment_reference: string | null;
  notes: string;
  idempotency_key: string;
  created_at: string;
}

interface InvoicePaymentsResponse {
  invoice_id: string;
  currency: Currency;
  invoice_total: number;
  paid_amount: number;
  outstanding_amount: number;
  as_of_date: string;
  payments: PaymentRecord[];
}

const apiErrorMessage = (error: unknown, fallback: string) => {
  if (
    typeof error === "object"
    && error !== null
    && "response" in error
    && typeof error.response === "object"
    && error.response !== null
    && "data" in error.response
    && typeof error.response.data === "object"
    && error.response.data !== null
    && "detail" in error.response.data
  ) {
    const detail = error.response.data.detail;
    if (typeof detail === "string") {
      if (detail === "PAYMENT_EXCEEDS_OUTSTANDING") return "This payment exceeds the current outstanding balance. Refresh the invoice and try again.";
      if (detail === "PAYMENT_IDEMPOTENCY_KEY_REUSED") return "This payment request key was already used for different payment details. Close the form and start a new payment.";
      if (detail === "INVOICE_NOT_GENERATED") return "Only generated invoices can receive payments.";
      return detail;
    }
  }
  return fallback;
};

const formatMoney = (amount: number, currency: Currency) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));

const statusLabel = (invoice: ReceivableInvoice) => {
  if (invoice.is_overdue) return "OVERDUE";
  if (invoice.payment_status === "PARTIALLY_PAID") return "PARTIALLY PAID";
  return invoice.payment_status;
};

export default function FinancialReceivablesPage() {
  const [data, setData] = useState<ReceivablesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | PaymentStatus | "OVERDUE">("ALL");
  const [historyInvoiceId, setHistoryInvoiceId] = useState<string | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<InvoicePaymentsResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<ReceivableInvoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [paymentPending, setPaymentPending] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);
  const paymentLock = useRef(false);

  const refreshReceivables = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiClient.get<ReceivablesResponse>(`${FINANCIAL_API}/receivables`);
      setData(response.data);
    } catch (error) {
      setData(null);
      setLoadError(apiErrorMessage(error, "Unable to load receivables."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshReceivables();
  }, [refreshReceivables]);

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (data?.invoices ?? []).filter((invoice) => {
      const matchesSearch = !query || [
        invoice.invoice_number,
        invoice.client_name,
        invoice.currency,
        invoice.issue_date,
        invoice.due_date,
      ].some((value) => value.toLocaleLowerCase().includes(query));
      const matchesStatus = statusFilter === "ALL"
        || (statusFilter === "OVERDUE" ? invoice.is_overdue : invoice.payment_status === statusFilter);
      return matchesSearch && matchesStatus;
    });
  }, [data?.invoices, search, statusFilter]);

  const loadPaymentHistory = async (invoiceId: string) => {
    setHistoryInvoiceId(invoiceId);
    setPaymentHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const response = await apiClient.get<InvoicePaymentsResponse>(
        `${FINANCIAL_API}/invoices/${invoiceId}/payments`,
      );
      setPaymentHistory(response.data);
    } catch (error) {
      setHistoryError(apiErrorMessage(error, "Unable to load payment history."));
    } finally {
      setHistoryLoading(false);
    }
  };

  const openPaymentForm = (invoice: ReceivableInvoice) => {
    setPaymentInvoice(invoice);
    setPaymentAmount(invoice.outstanding_amount.toFixed(2));
    setPaymentDate(data?.summary.as_of_date ?? "");
    setPaymentReference("");
    setPaymentNotes("");
    setPaymentError(null);
    setIdempotencyKey(window.crypto.randomUUID());
  };

  const closePaymentForm = () => {
    if (paymentPending) return;
    setPaymentInvoice(null);
    setPaymentError(null);
    setIdempotencyKey("");
  };

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentInvoice || paymentLock.current) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) / 100 > paymentInvoice.outstanding_amount) {
      setPaymentError("Enter an amount greater than zero and no greater than the current outstanding balance.");
      return;
    }
    if (!paymentDate || !idempotencyKey) {
      setPaymentError("The payment date or request key is unavailable. Close the form and try again.");
      return;
    }

    paymentLock.current = true;
    setPaymentPending(true);
    setPaymentError(null);
    try {
      await apiClient.post(
        `${FINANCIAL_API}/invoices/${paymentInvoice.invoice_id}/payments`,
        {
          amount: paymentAmount,
          payment_date: paymentDate,
          payment_reference: paymentReference.trim() || null,
          notes: paymentNotes.trim(),
          idempotency_key: idempotencyKey,
        },
      );
      setPaymentSuccess(`Payment of ${formatMoney(amount, paymentInvoice.currency)} recorded for ${paymentInvoice.invoice_number}.`);
      const invoiceId = paymentInvoice.invoice_id;
      setPaymentInvoice(null);
      setIdempotencyKey("");
      await refreshReceivables();
      if (historyInvoiceId === invoiceId) await loadPaymentHistory(invoiceId);
      window.dispatchEvent(new Event("financial-receivables-updated"));
    } catch (error) {
      setPaymentError(apiErrorMessage(error, "The payment could not be saved. No payment was reported as recorded."));
      await refreshReceivables();
    } finally {
      paymentLock.current = false;
      setPaymentPending(false);
    }
  };

  const summary = data?.summary;

  return (
    <AgentLayout
      config={financialConfig}
      activeTab="receivables"
      setActiveTab={() => undefined}
    >
      <div className="mt-3 space-y-5 sm:mt-6 sm:space-y-7">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">Pending Receivables</h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Invoice balances and manually recorded payments. Overdue status uses the server’s UTC business date
              {summary ? ` (${formatDate(summary.as_of_date)}).` : "."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshReceivables()}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            Refresh
          </button>
        </header>

        {paymentSuccess && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            {paymentSuccess}
            <button type="button" onClick={() => setPaymentSuccess(null)} className="ml-3 underline">Dismiss</button>
          </div>
        )}

        {summary && (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MetricCard label="Total outstanding">
              {summary.outstanding_by_currency.length === 0
                ? <span className="text-slate-400">No balance</span>
                : summary.outstanding_by_currency.map((entry) => (
                  <span key={entry.currency} className="block">{formatMoney(entry.amount, entry.currency)}</span>
                ))}
            </MetricCard>
            <MetricCard label="Unpaid">{summary.unpaid_count}</MetricCard>
            <MetricCard label="Partially paid">{summary.partially_paid_count}</MetricCard>
            <MetricCard label="Overdue">{summary.overdue_count}</MetricCard>
            <MetricCard label="Paid">{summary.paid_count}</MetricCard>
          </section>
        )}

        <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">Generated invoices</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Payment state is derived from the immutable payment ledger; invoice status is unchanged.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  aria-label="Search invoices"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search invoices"
                  className="w-48 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <select
                aria-label="Filter by payment status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <option value="ALL">All statuses</option>
                <option value="UNPAID">Unpaid</option>
                <option value="PARTIALLY_PAID">Partially paid</option>
                <option value="OVERDUE">Overdue</option>
                <option value="PAID">Paid</option>
              </select>
            </div>
          </div>

          {loading ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin" /> Loading receivables…</p>
          ) : loadError ? (
            <div className="py-12 text-center">
              <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{loadError}</p>
              <button type="button" onClick={() => void refreshReceivables()} className="mt-3 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 dark:border-rose-800 dark:text-rose-300">Retry</button>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {data?.invoices.length ? "No invoices match these search and status filters." : "No generated invoices to show yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1020px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Invoice / client</th>
                    <th className="px-4 py-3">Issue date</th>
                    <th className="px-4 py-3">Due date</th>
                    <th className="px-4 py-3 text-right">Invoice total</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Outstanding</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredInvoices.map((invoice) => (
                    <React.Fragment key={invoice.invoice_id}>
                      <tr className="text-slate-700 dark:text-slate-200">
                        <td className="px-4 py-4">
                          <span className="block font-mono font-bold text-slate-900 dark:text-white">{invoice.invoice_number}</span>
                          <span className="mt-1 block">{invoice.client_name}</span>
                        </td>
                        <td className="px-4 py-4">{formatDate(invoice.issue_date)}</td>
                        <td className="px-4 py-4">{formatDate(invoice.due_date)}</td>
                        <td className="px-4 py-4 text-right font-mono">{formatMoney(invoice.invoice_total, invoice.currency)}</td>
                        <td className="px-4 py-4 text-right font-mono">{formatMoney(invoice.paid_amount, invoice.currency)}</td>
                        <td className="px-4 py-4 text-right font-mono font-bold">{formatMoney(invoice.outstanding_amount, invoice.currency)}</td>
                        <td className="px-4 py-4">
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                            invoice.is_overdue
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                              : invoice.payment_status === "PAID"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : invoice.payment_status === "PARTIALLY_PAID"
                                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}>{statusLabel(invoice)}</span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <Link href={`/financial?invoice=${encodeURIComponent(invoice.invoice_id)}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                              <Eye size={13} /> Invoice
                            </Link>
                            <button type="button" onClick={() => void loadPaymentHistory(invoice.invoice_id)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                              History
                            </button>
                            {invoice.outstanding_amount > 0 && (
                              <button type="button" onClick={() => openPaymentForm(invoice)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 font-bold text-white hover:bg-indigo-700">
                                <Plus size={13} /> Payment
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {historyInvoiceId === invoice.invoice_id && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50/70 px-4 py-4 dark:bg-slate-950/30">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="font-bold text-slate-900 dark:text-white">Payment history · {invoice.invoice_number}</h3>
                              <button type="button" onClick={() => { setHistoryInvoiceId(null); setPaymentHistory(null); }} className="text-xs font-semibold text-slate-500 hover:underline">Close</button>
                            </div>
                            {historyLoading ? (
                              <p className="mt-3 text-xs text-slate-500">Loading payment history…</p>
                            ) : historyError ? (
                              <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">{historyError}</p>
                            ) : paymentHistory?.payments.length ? (
                              <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
                                {paymentHistory.payments.map((payment) => (
                                  <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                                    <div>
                                      <span className="font-semibold text-slate-900 dark:text-white">{formatDate(payment.payment_date)}</span>
                                      {payment.payment_reference && <span className="ml-2 text-slate-500">Ref: {payment.payment_reference}</span>}
                                      {payment.notes && <p className="mt-1 text-slate-500">{payment.notes}</p>}
                                    </div>
                                    <span className="font-mono font-bold">{formatMoney(payment.amount, payment.currency)}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-3 text-xs text-slate-500">No payments recorded for this invoice.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {paymentInvoice && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
          <form onSubmit={(event) => void submitPayment(event)} role="dialog" aria-modal="true" aria-labelledby="record-payment-title" className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"><CreditCard size={12} /> RECORD PAYMENT</span>
                <h2 id="record-payment-title" className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{paymentInvoice.invoice_number}</h2>
                <p className="text-xs text-slate-500">{paymentInvoice.client_name} · Outstanding {formatMoney(paymentInvoice.outstanding_amount, paymentInvoice.currency)}</p>
              </div>
              <button type="button" onClick={closePaymentForm} disabled={paymentPending} aria-label="Close payment form" className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">×</button>
            </div>
            {paymentError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">{paymentError}</p>}
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Amount ({paymentInvoice.currency})
              <input required type="number" min="0.01" max={paymentInvoice.outstanding_amount} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Payment date <span className="font-normal text-slate-500">(server business date: UTC)</span>
              <input required type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Payment reference <span className="font-normal text-slate-500">(optional)</span>
              <input maxLength={120} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Notes <span className="font-normal text-slate-500">(optional)</span>
              <textarea maxLength={1000} rows={3} value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button type="button" onClick={closePaymentForm} disabled={paymentPending} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">Cancel</button>
              <button type="submit" disabled={paymentPending} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                {paymentPending ? <LoaderCircle size={14} className="animate-spin" /> : <Wallet size={14} />}
                {paymentPending ? "Saving payment…" : "Record payment"}
              </button>
            </div>
          </form>
        </div>
      )}
    </AgentLayout>
  );
}

function MetricCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-h-24 rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-2 text-base font-bold text-slate-900 dark:text-white">{children}</div>
    </div>
  );
}
