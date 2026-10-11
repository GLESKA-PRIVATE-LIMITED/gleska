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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList
              size={19}
              className="text-purple-700 dark:text-purple-300"
            />
            <h2 className="text-lg font-bold">RFQ inbox</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            Invitations addressed to this supplier company. Acknowledge or
            decline, then submit a quotation from an open RFQ. Awarded
            quotations appear as purchase orders.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshRFQs()}
          disabled={rfqsLoading}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <RefreshCw
            size={14}
            className={rfqsLoading ? "animate-spin" : ""}
          />{" "}
          Refresh inbox
        </button>
      </div>

      {rfqsError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          <span>{rfqsError}</span>
          <button
            type="button"
            onClick={() => void refreshRFQs()}
            disabled={rfqsLoading}
            className="font-semibold underline disabled:opacity-60"
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
        <div className="grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
          {/* RFQ List Column */}
          <ul className="space-y-2">
            {rfqs.map((rfq) => (
              <li key={rfq.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRfqId(rfq.id);
                    setRfqResponseNote("");
                    setRfqsError("");
                    setRfqsSuccess("");
                  }}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    rfq.id === selectedRfqId
                      ? "border-purple-300 bg-purple-50/60 dark:border-purple-800 dark:bg-purple-950/30"
                      : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <span className="block font-semibold text-slate-900 dark:text-white">
                    {rfq.item_name}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {rfq.quantity} {rfq.unit}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {rfq.status}
                    </span>
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                      {rfq.recipient_status}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* RFQ Detail & Quotation Column */}
          {selectedRfq && (
            <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                    Buyer request
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                    {selectedRfq.item_name}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {selectedRfq.status}
                  </span>
                  <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-bold text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                    {selectedRfq.recipient_status}
                  </span>
                </div>
              </div>

              <dl className="grid gap-x-5 gap-y-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Requested quantity
                  </dt>
                  <dd className="mt-1 font-medium">
                    {selectedRfq.quantity} {selectedRfq.unit}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Delivery location
                  </dt>
                  <dd className="mt-1">{selectedRfq.delivery_location}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Quotation deadline
                  </dt>
                  <dd className="mt-1 inline-flex items-center gap-1.5">
                    <Clock3 size={14} />
                    {new Date(selectedRfq.quotation_deadline).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Invited
                  </dt>
                  <dd className="mt-1">
                    {new Date(selectedRfq.created_at).toLocaleString()}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-slate-500">
                    Specification
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap">
                    {selectedRfq.specification || "Not specified"}
                  </dd>
                </div>
                {selectedRfq.buyer_notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-slate-500">
                      Buyer notes
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap">
                      {selectedRfq.buyer_notes}
                    </dd>
                  </div>
                )}
                {selectedRfq.responded_at && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-slate-500">
                      Your response
                    </dt>
                    <dd className="mt-1">
                      {selectedRfq.recipient_status} ·{" "}
                      {new Date(selectedRfq.responded_at).toLocaleString()}
                      {selectedRfq.response_note && (
                        <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                          {selectedRfq.response_note}
                        </p>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              {/* Quotation Section */}
              <section className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-semibold text-slate-900 dark:text-white">
                      Your quotation
                    </h4>
                    {selectedRfq.quotation && (
                      <p className="mt-1 text-xs text-slate-500">
                        {selectedRfq.quotation.quotation_valid_until <
                        localDateString()
                          ? "Quotation validity expired"
                          : `Submitted ${new Date(
                              selectedRfq.quotation.submitted_at,
                            ).toLocaleString()}`}
                        {" · "}Revision {selectedRfq.quotation.revision + 1}
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
                      className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-purple-700 px-3 py-2 text-sm font-semibold text-white hover:bg-purple-800"
                    >
                      <Pencil size={14} />
                      {selectedRfq.quotation
                        ? "Edit quotation"
                        : "Submit quotation"}
                    </button>
                  )}
                </div>

                {selectedRfq.quotation && (
                  <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-950 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">
                        Unit price
                      </dt>
                      <dd className="mt-1">
                        {selectedRfq.quotation.currency}{" "}
                        {selectedRfq.quotation.unit_price} /{" "}
                        {selectedRfq.quotation.unit}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">
                        Quantity offered
                      </dt>
                      <dd className="mt-1">
                        {selectedRfq.quotation.quantity_offered}{" "}
                        {selectedRfq.quotation.unit}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">
                        Estimated delivery
                      </dt>
                      <dd className="mt-1">
                        {
                          selectedRfq.quotation
                            .estimated_delivery_lead_time_days
                        }{" "}
                        days
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">
                        Valid until
                      </dt>
                      <dd className="mt-1">
                        {new Date(
                          `${selectedRfq.quotation.quotation_valid_until}T00:00:00`,
                        ).toLocaleDateString()}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-semibold text-slate-500">
                        Delivery terms
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap">
                        {selectedRfq.quotation.delivery_terms}
                      </dd>
                    </div>
                    {selectedRfq.quotation.notes && (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold text-slate-500">
                          Supplier notes
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap">
                          {selectedRfq.quotation.notes}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}

                {selectedRfq.recipient_status === "DECLINED" && (
                  <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Your company declined this invitation, so a quotation cannot
                    be submitted.
                  </p>
                )}
                {!canSubmitQuotation &&
                  selectedRfq.recipient_status !== "DECLINED" && (
                    <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      The RFQ is closed. Quotations can no longer be submitted
                      or edited.
                    </p>
                  )}

                {quotationFormOpen &&
                  quotationDraft &&
                  canSubmitQuotation &&
                  (quotationReview ? (
                    <div className="space-y-4 rounded-xl border border-purple-200 bg-purple-50/60 p-4 dark:border-purple-900 dark:bg-purple-950/20">
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
                          className="min-h-9 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700"
                        >
                          Edit quotation
                        </button>
                        <button
                          type="button"
                          disabled={quotationBusy}
                          onClick={() => void handleConfirmQuotation()}
                          className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60"
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
                      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
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
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setQuotationFormOpen(false)}
                          className="min-h-9 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={quotationBusy}
                          className="min-h-9 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60"
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
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
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
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
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
