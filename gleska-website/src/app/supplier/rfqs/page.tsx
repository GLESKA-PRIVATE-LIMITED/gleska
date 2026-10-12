"use client";

import React, { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import {
  QuotationDraft,
  localDateString,
  quotationDraftFrom,
  quotationUnits,
  useSupplier,
} from "@/context/SupplierContext";
import { ProcurementUnit, SupplierQuotation } from "@/lib/procurement-api";

function SupplierRFQsContent() {
  const searchParams = useSearchParams();
  const initialRfqId = searchParams.get("rfqId") || "";

  const {
    selectedCompanyId,
    companyDataId,
    rfqs,
    rfqsLoading,
    rfqsError,
    rfqsSuccess,
    setRfqsError,
    setRfqsSuccess,
    refreshRFQs,
    respondToRfq,
    submitQuotation,
  } = useSupplier();

  const [selectedRfqId, setSelectedRfqId] = useState(initialRfqId);
  const [rfqResponseNote, setRfqResponseNote] = useState("");
  const [rfqBusy, setRfqBusy] = useState(false);
  const [quotationDraft, setQuotationDraft] = useState<QuotationDraft | null>(
    null,
  );
  const [quotationFormOpen, setQuotationFormOpen] = useState(false);
  const [quotationReview, setQuotationReview] = useState(false);
  const [quotationBusy, setQuotationBusy] = useState(false);

  // Sync selected RFQ
  useEffect(() => {
    if (initialRfqId && rfqs.some((r) => r.id === initialRfqId)) {
      setSelectedRfqId(initialRfqId);
    } else if (!selectedRfqId && rfqs.length > 0) {
      setSelectedRfqId(rfqs[0].id);
    }
  }, [initialRfqId, rfqs, selectedRfqId]);

  const selectedRfq = rfqs.find((rfq) => rfq.id === selectedRfqId) || null;

  useEffect(() => {
    setQuotationDraft(
      selectedRfq ? quotationDraftFrom(selectedRfq.quotation, selectedRfq) : null,
    );
    setQuotationFormOpen(false);
    setQuotationReview(false);
  }, [selectedRfqId, selectedRfq]);

  const canSubmitQuotation = Boolean(
    selectedRfq &&
      selectedRfq.recipient_status !== "DECLINED" &&
      selectedRfq.status === "OPEN" &&
      new Date(selectedRfq.quotation_deadline).getTime() > Date.now(),
  );

  const canRespondToRfq = Boolean(
    selectedRfq &&
      selectedRfq.recipient_status === "INVITED" &&
      selectedRfq.status === "OPEN" &&
      new Date(selectedRfq.quotation_deadline).getTime() > Date.now(),
  );

  const handleRespond = async (status: "ACKNOWLEDGED" | "DECLINED") => {
    if (!selectedRfq) return;
    setRfqBusy(true);
    const success = await respondToRfq(
      selectedRfq.id,
      status,
      rfqResponseNote.trim() || undefined,
    );
    if (success) {
      setRfqResponseNote("");
    }
    setRfqBusy(false);
  };

  const reviewQuotation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRfq || !quotationDraft || !canSubmitQuotation) return;
    if (
      Number(quotationDraft.unit_price) < 0 ||
      !Number.isFinite(Number(quotationDraft.unit_price)) ||
      Number(quotationDraft.quantity_offered) <= 0 ||
      !Number.isFinite(Number(quotationDraft.quantity_offered)) ||
      !Number.isInteger(Number(quotationDraft.estimated_delivery_lead_time_days)) ||
      quotationDraft.quotation_valid_until < localDateString()
    ) {
      setRfqsError(
        "Check price, positive quantity, delivery lead time and quotation validity date.",
      );
      return;
    }
    setRfqsError("");
    setQuotationReview(true);
  };

  const handleConfirmQuotation = async () => {
    if (!selectedRfq || !quotationDraft) return;
    setQuotationBusy(true);
    const success = await submitQuotation(
      selectedRfq.id,
      quotationDraft,
      selectedRfq.quotation?.revision ?? null,
    );
    if (success) {
      setQuotationReview(false);
      setQuotationFormOpen(false);
    }
    setQuotationBusy(false);
  };

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
            <ClipboardList size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">RFQ Inbox</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Incoming buyer invitations · acknowledge, quote, or decline</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {rfqs.length > 1 && (
            <div className="relative flex-1 sm:flex-none">
              <select
                aria-label="Select RFQ"
                value={selectedRfqId}
                onChange={(e) => {
                  setSelectedRfqId(e.target.value);
                  setRfqResponseNote("");
                  setRfqsError("");
                  setRfqsSuccess("");
                }}
                className="h-8 w-full sm:max-w-[260px] truncate rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-2xs hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
              >
                {rfqs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.item_name} ({r.quantity} {r.unit})
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={() => void refreshRFQs()}
            disabled={rfqsLoading}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw size={13} className={rfqsLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {rfqsError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          <span className="min-w-0 break-words">{rfqsError}</span>
          <button
            type="button"
            onClick={() => void refreshRFQs()}
            disabled={rfqsLoading}
            className="shrink-0 font-semibold underline disabled:opacity-60"
          >
            Retry RFQs
          </button>
        </div>
      )}

      {rfqsSuccess && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          {rfqsSuccess}
        </div>
      )}

      {rfqsLoading ? (
        <div
          role="status"
          className="flex items-center gap-2 py-5 text-sm text-slate-500"
        >
          <Loader2 size={16} className="animate-spin text-purple-600" /> Loading
          company RFQs…
        </div>
      ) : rfqs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
          No RFQs have been addressed to this company yet.
        </div>
      ) : (
        <div>
          {/* RFQ Detail & Quotation Full-Width View */}
          {selectedRfq && (
            <article className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6 space-y-6">
              {/* Header Banner */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                <div>
                  <span className="inline-block rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                    Buyer Request
                  </span>
                  <h3 className="mt-1.5 text-lg font-bold text-slate-900 dark:text-white">
                    {selectedRfq.item_name}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold uppercase ${
                      selectedRfq.status === "OPEN"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {selectedRfq.status}
                  </span>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold uppercase ${
                      selectedRfq.recipient_status === "INVITED"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                        : "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300"
                    }`}
                  >
                    {selectedRfq.recipient_status}
                  </span>
                </div>
              </div>

              {/* Essential Specifications Grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Quantity
                  </span>
                  <span className="mt-1 block text-sm font-bold text-slate-900 dark:text-white">
                    {selectedRfq.quantity} {selectedRfq.unit}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Deadline
                  </span>
                  <span className="mt-1 block text-sm font-semibold text-slate-800 dark:text-slate-200 truncate" title={new Date(selectedRfq.quotation_deadline).toLocaleString()}>
                    {new Date(selectedRfq.quotation_deadline).toLocaleDateString()}
                  </span>
                </div>
                <div className="col-span-2 rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Location
                  </span>
                  <span className="mt-1 block text-sm font-medium text-slate-800 dark:text-slate-200 truncate" title={selectedRfq.delivery_location}>
                    {selectedRfq.delivery_location}
                  </span>
                </div>
              </div>

              {/* Detail Blocks */}
              {(selectedRfq.specification || selectedRfq.buyer_notes) && (
                <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                  {selectedRfq.specification && (
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Specification & Requirements
                      </h4>
                      <p className="mt-1 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                        {selectedRfq.specification}
                      </p>
                    </div>
                  )}
                  {selectedRfq.buyer_notes && (
                    <div className={selectedRfq.specification ? "border-t border-slate-200/60 pt-3 dark:border-slate-800" : ""}>
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Buyer Notes
                      </h4>
                      <p className="mt-1 text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                        {selectedRfq.buyer_notes}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Your Response Banner */}
              {selectedRfq.responded_at && (
                <div className="flex items-center justify-between rounded-xl border border-purple-100 bg-purple-50/50 px-4 py-3 dark:border-purple-900/50 dark:bg-purple-950/20">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                      Your Response
                    </span>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {selectedRfq.recipient_status} ·{" "}
                      <span className="font-normal text-slate-500">
                        {new Date(selectedRfq.responded_at).toLocaleString()}
                      </span>
                    </p>
                    {selectedRfq.response_note && (
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        “{selectedRfq.response_note}”
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Quotation Section */}
              <section className="space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-base font-bold text-slate-900 dark:text-white">
                      Your Quotation
                    </h4>
                    {selectedRfq.quotation && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {selectedRfq.quotation.quotation_valid_until < localDateString()
                          ? "Expired"
                          : `Submitted ${new Date(selectedRfq.quotation.submitted_at).toLocaleDateString()}`}
                        {" · "}Rev {selectedRfq.quotation.revision + 1}
                      </p>
                    )}
                  </div>
                  {canSubmitQuotation && !quotationFormOpen && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuotationDraft(
                          quotationDraftFrom(selectedRfq.quotation, selectedRfq),
                        );
                        setQuotationReview(false);
                        setQuotationFormOpen(true);
                        setRfqsError("");
                      }}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-purple-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-purple-700"
                    >
                      <Pencil size={13} />
                      {selectedRfq.quotation ? "Edit Quotation" : "Submit Quotation"}
                    </button>
                  )}
                </div>

                {selectedRfq.quotation && (
                  <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-950/60 sm:grid-cols-3">
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Price
                      </span>
                      <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                        {selectedRfq.quotation.currency} {selectedRfq.quotation.unit_price} / {selectedRfq.quotation.unit}
                      </p>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Qty Offered
                      </span>
                      <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                        {selectedRfq.quotation.quantity_offered} {selectedRfq.quotation.unit}
                      </p>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Lead Time
                      </span>
                      <p className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                        {selectedRfq.quotation.estimated_delivery_lead_time_days} days
                      </p>
                    </div>
                    {selectedRfq.quotation.delivery_terms && (
                      <div className="sm:col-span-3 border-t border-slate-200/60 pt-2.5 dark:border-slate-800">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Delivery Terms
                        </span>
                        <p className="mt-0.5 text-xs text-slate-700 dark:text-slate-300">
                          {selectedRfq.quotation.delivery_terms}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {selectedRfq.recipient_status === "DECLINED" && (
                  <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Your company declined this invitation, so a quotation cannot be submitted.
                  </p>
                )}
                {!canSubmitQuotation && selectedRfq.recipient_status !== "DECLINED" && (
                  <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    The RFQ is closed. Quotations can no longer be submitted or edited.
                  </p>
                )}

                {quotationFormOpen &&
                  quotationDraft &&
                  canSubmitQuotation &&
                  (quotationReview ? (
                    <div className="space-y-4 rounded-xl border border-purple-200 bg-purple-50/60 p-4 dark:border-purple-900 dark:bg-purple-950/20 overflow-y-auto max-h-[90vh]">
                      <div>
                        <h5 className="font-semibold">Review your quotation</h5>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {quotationDraft.currency} {quotationDraft.unit_price} /{" "}
                          {quotationDraft.unit} ·{" "}
                          {quotationDraft.quantity_offered}{" "}
                          {quotationDraft.unit}
                        </p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          Requested: {selectedRfq.quantity} {selectedRfq.unit}
                          {quotationDraft.unit.toLowerCase() !==
                          selectedRfq.unit.trim().toLowerCase()
                            ? " — different unit; the buyer will see this as non-comparable"
                            : ""}
                        </p>
                      </div>
                      <dl className="grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-semibold text-slate-500">
                            Estimated delivery
                          </dt>
                          <dd>
                            {quotationDraft.estimated_delivery_lead_time_days}{" "}
                            days
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-slate-500">
                            Valid until
                          </dt>
                          <dd>{quotationDraft.quotation_valid_until}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold text-slate-500">
                            Delivery terms
                          </dt>
                          <dd className="whitespace-pre-wrap">
                            {quotationDraft.delivery_terms}
                          </dd>
                        </div>
                        {quotationDraft.notes && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-semibold text-slate-500">
                              Notes
                            </dt>
                            <dd className="whitespace-pre-wrap">
                              {quotationDraft.notes}
                            </dd>
                          </div>
                        )}
                      </dl>
                      <div className="flex flex-wrap justify-between gap-2">
                        <button
                          type="button"
                          disabled={quotationBusy}
                          onClick={() => setQuotationReview(false)}
                          className="w-full sm:w-auto min-h-9 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700"
                        >
                          Edit quotation
                        </button>
                        <button
                          type="button"
                          disabled={quotationBusy}
                          onClick={() => void handleConfirmQuotation()}
                          className="w-full sm:w-auto inline-flex min-h-9 items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60"
                        >
                          {quotationBusy ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={15} />
                          )}
                          {quotationBusy ? "Saving…" : "Confirm and submit"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form
                      onSubmit={reviewQuotation}
                      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700 overflow-y-auto max-h-[90vh]"
                    >
                      <p className="text-xs text-slate-500">
                        The RFQ requests {selectedRfq.quantity}{" "}
                        {selectedRfq.unit}. Your offered quantity and unit are
                        recorded as entered; no unit conversion is performed.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm font-medium">
                          Unit price *
                          <input
                            type="number"
                            required
                            min="0"
                            max="1000000000000"
                            step="0.0001"
                            value={quotationDraft.unit_price}
                            onChange={(event) =>
                              setQuotationDraft({
                                ...quotationDraft,
                                unit_price: event.target.value,
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          />
                        </label>
                        <label className="block text-sm font-medium">
                          Currency *
                          <select
                            required
                            value={quotationDraft.currency}
                            onChange={(event) =>
                              setQuotationDraft({
                                ...quotationDraft,
                                currency: event.target
                                  .value as SupplierQuotation["currency"],
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          >
                            {["INR", "USD", "EUR", "GBP", "AED"].map(
                              (currency) => (
                                <option key={currency} value={currency}>
                                  {currency}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label className="block text-sm font-medium">
                          Quantity offered *
                          <input
                            type="number"
                            required
                            min="0.0001"
                            max="1000000000"
                            step="0.0001"
                            value={quotationDraft.quantity_offered}
                            onChange={(event) =>
                              setQuotationDraft({
                                ...quotationDraft,
                                quantity_offered: event.target.value,
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          />
                        </label>
                        <label className="block text-sm font-medium">
                          Unit *
                          <select
                            required
                            value={quotationDraft.unit}
                            onChange={(event) =>
                              setQuotationDraft({
                                ...quotationDraft,
                                unit: event.target.value as ProcurementUnit,
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          >
                            {quotationUnits.map((unit) => (
                              <option key={unit} value={unit}>
                                {unit}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-sm font-medium">
                          Estimated delivery lead time (days) *
                          <input
                            type="number"
                            required
                            min="0"
                            max="3650"
                            step="1"
                            value={
                              quotationDraft.estimated_delivery_lead_time_days
                            }
                            onChange={(event) =>
                              setQuotationDraft({
                                ...quotationDraft,
                                estimated_delivery_lead_time_days:
                                  event.target.value,
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          />
                        </label>
                        <label className="block text-sm font-medium">
                          Quotation valid until *
                          <input
                            type="date"
                            required
                            min={localDateString()}
                            value={quotationDraft.quotation_valid_until}
                            onChange={(event) =>
                              setQuotationDraft({
                                ...quotationDraft,
                                quotation_valid_until: event.target.value,
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          />
                        </label>
                        <label className="block text-sm font-medium sm:col-span-2">
                          Delivery terms *
                          <textarea
                            required
                            maxLength={2000}
                            rows={2}
                            value={quotationDraft.delivery_terms}
                            onChange={(event) =>
                              setQuotationDraft({
                                ...quotationDraft,
                                delivery_terms: event.target.value,
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          />
                        </label>
                        <label className="block text-sm font-medium sm:col-span-2">
                          Notes{" "}
                          <span className="font-normal text-slate-500">
                            (optional)
                          </span>
                          <textarea
                            maxLength={4000}
                            rows={2}
                            value={quotationDraft.notes}
                            onChange={(event) =>
                              setQuotationDraft({
                                ...quotationDraft,
                                notes: event.target.value,
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setQuotationFormOpen(false)}
                          className="w-full sm:w-auto min-h-9 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={quotationBusy}
                          className="w-full sm:w-auto min-h-9 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60"
                        >
                          Review quotation
                        </button>
                      </div>
                    </form>
                  ))}
              </section>

              {/* Acknowledge / Decline Action */}
              {canRespondToRfq ? (
                <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <label className="block text-sm font-semibold">
                    Response note{" "}
                    <span className="font-normal text-slate-500">
                      (optional)
                    </span>
                    <textarea
                      value={rfqResponseNote}
                      onChange={(event) =>
                        setRfqResponseNote(event.target.value)
                      }
                      maxLength={2000}
                      rows={3}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
                    />
                    <span className="mt-1 block text-right text-xs font-normal text-slate-500">
                      {rfqResponseNote.length}/2000
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={rfqBusy}
                      onClick={() => void handleRespond("ACKNOWLEDGED")}
                      className="w-full sm:w-auto inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                    >
                      {rfqBusy ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={15} />
                      )}
                      Acknowledge
                    </button>
                    <button
                      type="button"
                      disabled={rfqBusy}
                      onClick={() => void handleRespond("DECLINED")}
                      className="w-full sm:w-auto inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                    >
                      {rfqBusy ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <X size={15} />
                      )}
                      Decline invitation
                    </button>
                  </div>
                </div>
              ) : selectedRfq.recipient_status === "INVITED" &&
                selectedRfq.status === "CLOSED" ? (
                <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  This RFQ is closed. Its response window has ended or it has
                  been awarded.
                </p>
              ) : null}
            </article>
          )}
        </div>
      )}
    </section>
  );
}

export default function SupplierRFQsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-slate-500">Loading RFQs...</div>
      }
    >
      <SupplierRFQsContent />
    </Suspense>
  );
}
