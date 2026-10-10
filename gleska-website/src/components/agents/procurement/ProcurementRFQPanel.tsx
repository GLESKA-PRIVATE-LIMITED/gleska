"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import {
  ProcurementMaterialRequest,
  ProcurementRFQ,
  ProcurementRFQRecipient,
  ProcurementSupplierOfferingMatch,
  ProcurementSupplierDiscovery,
  procurementApi,
} from "@/lib/procurement-api";

type View = "list" | "compose" | "review" | "detail";
type DiscoverySupplier = {
  companyId: string;
  name: string;
  match: ProcurementSupplierOfferingMatch;
};
type RecipientFilter =
  | "ALL"
  | "NOT_RESPONDED"
  | "ACKNOWLEDGED"
  | "DECLINED"
  | "SUBMITTED"
  | "EXPIRED";
type RecipientState = Exclude<RecipientFilter, "ALL"> | "SUBMITTED" | "UNAVAILABLE";

function decimalParts(value: string | number): { digits: string; scale: number } | null {
  const match = String(value).match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  let whole = match[1].replace(/^0+/, "") || "0";
  let fraction = (match[2] || "").replace(/0+$/, "");
  if (!fraction) return { digits: whole, scale: 0 };
  return { digits: `${whole}${fraction}`, scale: fraction.length };
}

function compareDecimals(left: string | number, right: string | number): number | null {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const leftDigits = `${a.digits}${"0".repeat(scale - a.scale)}`.padStart(scale + 1, "0");
  const rightDigits = `${b.digits}${"0".repeat(scale - b.scale)}`.padStart(scale + 1, "0");
  const leftWhole = leftDigits.slice(0, -scale || undefined).replace(/^0+/, "") || "0";
  const rightWhole = rightDigits.slice(0, -scale || undefined).replace(/^0+/, "") || "0";
  if (leftWhole.length !== rightWhole.length) return leftWhole.length < rightWhole.length ? -1 : 1;
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;
  const leftFraction = scale ? leftDigits.slice(-scale).padEnd(scale, "0") : "";
  const rightFraction = scale ? rightDigits.slice(-scale).padEnd(scale, "0") : "";
  return leftFraction < rightFraction ? -1 : leftFraction > rightFraction ? 1 : 0;
}

function estimatedTotal(unitPrice: string | number, requestedQuantity: string | number): string | null {
  const price = decimalParts(unitPrice);
  const quantity = decimalParts(requestedQuantity);
  if (!price || !quantity) return null;
  const left = price.digits.split("").map(Number).reverse();
  const right = quantity.digits.split("").map(Number).reverse();
  const result = Array(left.length + right.length).fill(0) as number[];
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      result[i + j] += left[i] * right[j];
    }
  }
  for (let i = 0; i < result.length - 1; i += 1) {
    result[i + 1] += Math.floor(result[i] / 10);
    result[i] %= 10;
  }
  let digits = result.reverse().join("").replace(/^0+/, "") || "0";
  const scale = price.scale + quantity.scale;
  if (!scale) return digits;
  digits = digits.padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function localDateString(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recipientState(recipient: ProcurementRFQRecipient, rfq: ProcurementRFQ): RecipientState {
  if (recipient.quotation) {
    if (recipient.quotation.quotation_valid_until < localDateString()) {
      return "EXPIRED";
    }
    return "SUBMITTED";
  }
  if (recipient.status === "ACKNOWLEDGED") return "ACKNOWLEDGED";
  if (recipient.status === "DECLINED") return "DECLINED";
  if (rfq.status === "CLOSED") return "UNAVAILABLE";
  return "NOT_RESPONDED";
}

function localDateTimeAfterDays(days: number): string {
  const value = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function errorDetail(error: unknown): string | null {
  const detail = (
    error as { response?: { data?: { detail?: unknown } } }
  )?.response?.data?.detail;
  return typeof detail === "string" ? detail : null;
}

function rfqErrorMessage(error: unknown): string {
  const detail = errorDetail(error);
  const messages: Record<string, string> = {
    RFQ_CREATE_FAILED: "We couldn’t create your RFQ. Please try again shortly.",
    RFQ_LIST_FAILED: "We couldn’t load your RFQs. Please try again shortly.",
    RFQ_LOAD_FAILED: "This RFQ could not be loaded. Refresh the list and try again.",
    RFQ_NOT_FOUND: "This RFQ is no longer available to your account.",
    MATERIAL_REQUEST_NOT_FOUND: "That saved requirement is no longer available. Refresh the requirements and try again.",
    RFQ_SUPPLIER_INELIGIBLE: "One or more suppliers are no longer eligible for this requirement. Refresh matching results and choose again.",
    RFQ_DEADLINE_INVALID: "The quotation deadline must be in the future.",
    RFQ_DELIVERY_LOCATION_REQUIRED: "Enter a delivery location before reviewing the RFQ.",
    RFQ_RECIPIENTS_INVALID: "Choose at least one unique eligible supplier.",
    RFQ_IDEMPOTENCY_CONFLICT: "This submission key was already used for different RFQ details. Start a fresh submission.",
    EMPLOYER_ONBOARDING_INCOMPLETE: "Complete employer onboarding before creating an RFQ.",
    EMPLOYER_NOT_FOUND: "An onboarded employer profile is required to use RFQs.",
    PROCUREMENT_SETTINGS_LOAD_FAILED: "Procurement Settings could not be loaded.",
  };
  if (detail && messages[detail]) return messages[detail];
  if (detail === "MATERIAL_REQUEST_NOT_FOUND") return messages.MATERIAL_REQUEST_NOT_FOUND;
  if (detail === "SUPPLIER_DISCOVERY_FAILED") {
    return "Supplier matching is temporarily unavailable. Retry before creating the RFQ.";
  }
  return detail || "The RFQ request failed. Please refresh and try again.";
}

function statusClass(status: string): string {
  if (status === "ACKNOWLEDGED") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
  if (status === "DECLINED") return "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300";
  if (status === "CLOSED") return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
}

export default function ProcurementRFQPanel({
  requests,
}: {
  requests: ProcurementMaterialRequest[];
}) {
  const [view, setView] = useState<View>("list");
  const [rfqs, setRfqs] = useState<ProcurementRFQ[]>([]);
  const [selectedRFQ, setSelectedRFQ] = useState<ProcurementRFQ | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [discovery, setDiscovery] = useState<ProcurementSupplierDiscovery | null>(null);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [deadline, setDeadline] = useState(() => localDateTimeAfterDays(7));
  const [buyerNotes, setBuyerNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [rfqListLoaded, setRfqListLoaded] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [defaultLocation, setDefaultLocation] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>("ALL");
  const [recipientCurrency, setRecipientCurrency] = useState("ALL");
  const [recipientSort, setRecipientSort] = useState<"SUPPLIER" | "PRICE">("SUPPLIER");
  const submissionKey = useRef<{ signature: string; key: string } | null>(null);

  const selectedRequest = requests.find((item) => item.id === selectedRequestId) || null;
  const suppliers = useMemo<DiscoverySupplier[]>(() => {
    const unique = new Map<string, DiscoverySupplier>();
    for (const match of discovery?.matches || []) {
      if (!unique.has(match.supplier_company_id)) {
        unique.set(match.supplier_company_id, {
          companyId: match.supplier_company_id,
          name: match.supplier_name,
          match,
        });
      }
    }
    return [...unique.values()];
  }, [discovery]);
  const comparisonRecipients = useMemo(() => {
    if (!selectedRFQ) return { rows: [], currencies: [] as string[] };
    const recipients = selectedRFQ.recipients;
    const currencyOptions = [...new Set(
      recipients.flatMap((recipient) => recipient.quotation ? [recipient.quotation.currency] : []),
    )];
    const filtered = recipients.filter((recipient) => {
      const state = recipientState(recipient, selectedRFQ);
      if (recipientFilter !== "ALL" && state !== recipientFilter) return false;
      if (recipientCurrency !== "ALL" && recipient.quotation?.currency !== recipientCurrency) return false;
      return true;
    });
    filtered.sort((a, b) => {
      if (recipientSort === "PRICE") {
        const currencyOrder = (a.quotation?.currency || "").localeCompare(b.quotation?.currency || "");
        if (currencyOrder) return currencyOrder;
        const priceOrder = a.quotation && b.quotation
          ? compareDecimals(a.quotation.unit_price, b.quotation.unit_price)
          : null;
        if (priceOrder) return priceOrder;
      }
      return a.company_name.localeCompare(b.company_name);
    });
    return { rows: filtered, currencies: currencyOptions };
  }, [recipientCurrency, recipientFilter, recipientSort, selectedRFQ]);

  const refreshRFQs = useCallback(async () => {
    setLoading(true);
    setRfqListLoaded(false);
    setError("");
    try {
      setRfqs(await procurementApi.listRFQs());
      setRfqListLoaded(true);
    } catch (loadError) {
      setError(rfqErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRFQs();
    void procurementApi.getSettings()
      .then((settings) => setDefaultLocation(settings.default_delivery_location))
      .catch((settingsLoadError: unknown) => {
        setSettingsError(
          `Procurement defaults could not be loaded: ${rfqErrorMessage(settingsLoadError)} You can enter a delivery location manually.`,
        );
      })
      .finally(() => setSettingsLoaded(true));
  }, [refreshRFQs]);

  useEffect(() => {
    if (!selectedRequestId || view !== "compose" || !settingsLoaded) {
      setDiscovery(null);
      setDiscoveryLoading(false);
      return;
    }
    let current = true;
    setDiscovery(null);
    setDiscoveryLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      const effectiveLocation = selectedRequest?.delivery_location || deliveryLocation.trim() || null;
      void procurementApi.discoverSuppliers(selectedRequestId, effectiveLocation)
        .then((results) => {
          if (current) setDiscovery(results);
        })
        .catch((discoveryError: unknown) => {
          if (current) setError(rfqErrorMessage(discoveryError));
        })
        .finally(() => {
          if (current) setDiscoveryLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [deliveryLocation, selectedRequestId, selectedRequest?.delivery_location, settingsLoaded, view]);

  useEffect(() => {
    if (!selectedRequest) return;
    setDeliveryLocation(selectedRequest.delivery_location || defaultLocation || "");
    setSelectedCompanies([]);
  }, [defaultLocation, selectedRequest]);

  const openDetails = async (id: string) => {
    setError("");
    try {
      setSelectedRFQ(await procurementApi.getRFQ(id));
      setRecipientFilter("ALL");
      setRecipientCurrency("ALL");
      setRecipientSort("SUPPLIER");
      setView("detail");
    } catch (loadError) {
      setError(rfqErrorMessage(loadError));
    }
  };

  const toggleSupplier = (companyId: string) => {
    setSelectedCompanies((current) => current.includes(companyId)
      ? current.filter((id) => id !== companyId)
      : [...current, companyId]);
  };

  const submissionPayload = () => {
    if (!selectedRequest) return null;
    return {
      material_request_id: selectedRequest.id,
      supplier_company_ids: [...selectedCompanies].sort(),
      delivery_location: selectedRequest.delivery_location || deliveryLocation.trim(),
      quotation_deadline: new Date(deadline).toISOString(),
      buyer_notes: buyerNotes.trim() || null,
    };
  };

  const submitRFQ = async () => {
    const payload = submissionPayload();
    if (!payload) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const signature = JSON.stringify(payload);
      if (!submissionKey.current || submissionKey.current.signature !== signature) {
        submissionKey.current = { signature, key: crypto.randomUUID() };
      }
      const created = await procurementApi.createRFQ({
        ...payload,
        idempotency_key: submissionKey.current.key,
      });
      submissionKey.current = null;
      setRfqs((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedRFQ(created);
      setView("detail");
      setSuccess("RFQ saved. Invited suppliers can access it in Supplier Workspace. No email or SMS notification was sent.");
    } catch (submitError) {
      setError(rfqErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const startCompose = () => {
    setError("");
    setSuccess("");
    setBuyerNotes("");
    setDeadline(localDateTimeAfterDays(7));
    setSelectedCompanies([]);
    setDiscovery(null);
    submissionKey.current = null;
    setSelectedRequestId(requests[0]?.id || "");
    setView("compose");
  };

  const selectedSupplierNames = suppliers
    .filter((supplier) => selectedCompanies.includes(supplier.companyId))
    .map((supplier) => supplier.name);
  const deadlineIsValid = Boolean(deadline && new Date(deadline).getTime() > Date.now());

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
            Procurement
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {view === "compose" || view === "review" ? "Create a request for quotation" : view === "detail" ? "RFQ details" : "Your RFQs"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            Request quotations from eligible suppliers and track their responses.
          </p>
        </div>
        <div className="flex gap-2">
          {view !== "list" && (
            <button
              type="button"
              onClick={() => {
                setView("list");
                setError("");
                setSuccess("");
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <ArrowLeft size={15} /> RFQ list
            </button>
          )}
          {view === "list" && (
            <>
              <button
                type="button"
                onClick={() => void refreshRFQs()}
                disabled={loading}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
              </button>
              <button
                type="button"
                onClick={startCompose}
                disabled={requests.length === 0}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText size={16} /> Create RFQ
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {success}
        </div>
      )}
      {settingsError && view === "compose" && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {settingsError}
        </div>
      )}

      {view === "list" && (
        <>
          {requests.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
              <p className="text-sm font-semibold">Save a material requirement before creating an RFQ.</p>
            </div>
          )}
          {loading ? (
            <div role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 size={17} className="animate-spin" /> Loading RFQs…
            </div>
          ) : rfqListLoaded && rfqs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              No RFQs have been created yet.
            </div>
          ) : rfqListLoaded ? (
            <ul className="space-y-3">
              {rfqs.map((rfq) => (
                <li key={rfq.id}>
                  <button
                    type="button"
                    onClick={() => void openDetails(rfq.id)}
                    className="w-full rounded-xl border border-slate-200 p-4 text-left transition hover:border-purple-300 hover:bg-purple-50/40 dark:border-slate-700 dark:hover:border-purple-800 dark:hover:bg-purple-950/20"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{rfq.item_name}</p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{rfq.quantity} {rfq.unit} · {rfq.delivery_location}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(rfq.status)}`}>{rfq.status}</span>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Deadline {formatDate(rfq.quotation_deadline)} · {rfq.recipients.length} supplier{rfq.recipients.length === 1 ? "" : "s"} · {rfq.recipients.filter((recipient) => recipient.status !== "INVITED").length} responded
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      {view === "compose" && (
        <div className="space-y-5">
          {requests.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
              There are no saved requirements to use.
            </p>
          ) : (
            <>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Saved material requirement
                <select
                  value={selectedRequestId}
                  onChange={(event) => {
                    setSelectedRequestId(event.target.value);
                    setSelectedCompanies([]);
                    setError("");
                  }}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
                >
                  {requests.map((request) => (
                    <option key={request.id} value={request.id}>
                      {request.title || request.item_name} — {request.quantity} {request.unit}
                    </option>
                  ))}
                </select>
              </label>
              {selectedRequest && (
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <h3 className="font-semibold text-slate-900 dark:text-white">Requirement snapshot</h3>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs font-semibold text-slate-500">Material</dt><dd className="mt-1">{selectedRequest.item_name}</dd></div>
                    <div><dt className="text-xs font-semibold text-slate-500">Quantity / unit</dt><dd className="mt-1">{selectedRequest.quantity} {selectedRequest.unit}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Specification</dt><dd className="mt-1 whitespace-pre-wrap">{selectedRequest.specification || "Not specified"}</dd></div>
                  </dl>
                  <p className="mt-3 text-xs text-slate-500">The saved requirement remains the source of truth for material, specification, quantity and unit.</p>
                </div>
              )}

              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Delivery location
                <input
                  value={selectedRequest?.delivery_location || deliveryLocation}
                  onChange={(event) => setDeliveryLocation(event.target.value)}
                  readOnly={Boolean(selectedRequest?.delivery_location)}
                  maxLength={500}
                  required
                  aria-invalid={!selectedRequest?.delivery_location && !deliveryLocation.trim()}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal read-only:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:read-only:bg-slate-900"
                  placeholder="Enter the delivery location"
                />
                {!selectedRequest?.delivery_location && !deliveryLocation.trim() && (
                  <span className="mt-1 block text-xs font-medium text-rose-700 dark:text-rose-300">Enter a delivery location to continue.</span>
                )}
                {!selectedRequest?.delivery_location && defaultLocation && (
                  <span className="mt-1 block text-xs font-normal text-slate-500">Prefilled from Procurement Settings; change it for this RFQ if needed.</span>
                )}
              </label>

              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Eligible suppliers</h3>
                <p className="mt-1 text-xs text-slate-500">Current matching results are rechecked before submission. Select one or more supplier companies.</p>
                {discoveryLoading ? (
                  <div role="status" className="flex items-center gap-2 py-5 text-sm text-slate-500">
                    <Loader2 size={16} className="animate-spin" /> Checking verified supplier offerings…
                  </div>
                ) : suppliers.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 dark:border-slate-700">
                    No eligible supplier offerings currently match this saved requirement.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {suppliers.map((supplier) => (
                      <li key={supplier.companyId}>
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                          <input
                            type="checkbox"
                            checked={selectedCompanies.includes(supplier.companyId)}
                            onChange={() => toggleSupplier(supplier.companyId)}
                            className="mt-1 accent-purple-700"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-slate-900 dark:text-white">{supplier.name}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              Matching offering: {supplier.match.name} · {supplier.match.unit}
                              {supplier.match.specification ? ` · ${supplier.match.specification}` : ""}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {!discoveryLoading && suppliers.length > 0 && selectedCompanies.length === 0 && (
                  <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-300">Select at least one eligible supplier company.</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Quotation deadline
                  <input
                    type="datetime-local"
                    value={deadline}
                    min={localDateTimeAfterDays(0)}
                    onChange={(event) => setDeadline(event.target.value)}
                    required
                    aria-invalid={!deadlineIsValid}
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
                  />
                  {!deadlineIsValid && <span className="mt-1 block text-xs font-medium text-rose-700 dark:text-rose-300">Choose a future quotation deadline.</span>}
                </label>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">
                  Buyer notes <span className="font-normal text-slate-500">(optional)</span>
                  <textarea
                    value={buyerNotes}
                    onChange={(event) => setBuyerNotes(event.target.value)}
                    maxLength={4000}
                    rows={3}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
                  />
                  <span className="mt-1 block text-right text-xs font-normal text-slate-500">{buyerNotes.length}/4000</span>
                </label>
              </div>
              <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setView("review");
                  }}
                  disabled={!selectedRequest || discoveryLoading || selectedCompanies.length === 0 || !deliveryLocation.trim() || !deadlineIsValid || buyerNotes.length > 4000}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Review RFQ <Send size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {view === "review" && selectedRequest && (
        <div className="space-y-5">
          <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4 dark:border-purple-900 dark:bg-purple-950/20">
            <h3 className="font-bold text-slate-900 dark:text-white">Review before creating</h3>
            <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-semibold text-slate-500">Material</dt><dd className="mt-1">{selectedRequest.item_name}</dd></div>
              <div><dt className="text-xs font-semibold text-slate-500">Quantity</dt><dd className="mt-1">{selectedRequest.quantity} {selectedRequest.unit}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Specification</dt><dd className="mt-1 whitespace-pre-wrap">{selectedRequest.specification || "Not specified"}</dd></div>
              <div><dt className="text-xs font-semibold text-slate-500">Delivery location</dt><dd className="mt-1">{selectedRequest.delivery_location || deliveryLocation}</dd></div>
              <div><dt className="text-xs font-semibold text-slate-500">Quotation deadline</dt><dd className="mt-1">{new Date(deadline).toLocaleString()}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Suppliers</dt><dd className="mt-1">{selectedSupplierNames.join(", ")}</dd></div>
              {buyerNotes && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Buyer notes</dt><dd className="mt-1 whitespace-pre-wrap">{buyerNotes}</dd></div>}
            </dl>
          </div>
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            This creates a persistent RFQ and supplier inbox entries. No email or SMS notification will be sent.
          </p>
          <div className="flex flex-wrap justify-between gap-3">
            <button type="button" onClick={() => setView("compose")} disabled={submitting} className="min-h-10 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
              Edit details
            </button>
            <button
              type="button"
              onClick={() => void submitRFQ()}
              disabled={submitting}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-purple-700 px-5 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {submitting ? "Saving RFQ…" : "Create RFQ"}
            </button>
          </div>
        </div>
      )}

      {view === "detail" && selectedRFQ && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{selectedRFQ.item_name}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {selectedRFQ.quantity} {selectedRFQ.unit} · {selectedRFQ.delivery_location}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(selectedRFQ.status)}`}>{selectedRFQ.status}</span>
          </div>
          <dl className="grid gap-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700 sm:grid-cols-2">
            <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Specification</dt><dd className="mt-1 whitespace-pre-wrap">{selectedRFQ.specification || "Not specified"}</dd></div>
            <div><dt className="text-xs font-semibold text-slate-500">Quotation deadline</dt><dd className="mt-1 flex items-center gap-1.5"><Clock3 size={14} />{formatDate(selectedRFQ.quotation_deadline)}</dd></div>
            <div><dt className="text-xs font-semibold text-slate-500">Created</dt><dd className="mt-1">{formatDate(selectedRFQ.created_at)}</dd></div>
            {selectedRFQ.buyer_notes && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Buyer notes</dt><dd className="mt-1 whitespace-pre-wrap">{selectedRFQ.buyer_notes}</dd></div>}
          </dl>
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">Supplier quotations & comparison</h3>
                <p className="mt-1 text-xs text-slate-500">Prices are grouped by currency. No currency or unit conversion is applied.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Response
                  <select
                    value={recipientFilter}
                    onChange={(event) => setRecipientFilter(event.target.value as RecipientFilter)}
                    className="ml-2 min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="ALL">All suppliers</option>
                    <option value="NOT_RESPONDED">Not responded</option>
                    <option value="ACKNOWLEDGED">Acknowledged, no quote</option>
                    <option value="DECLINED">Declined, no quote</option>
                    <option value="SUBMITTED">Quotation submitted</option>
                    <option value="EXPIRED">Quotation expired</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Currency
                  <select
                    value={recipientCurrency}
                    onChange={(event) => setRecipientCurrency(event.target.value)}
                    className="ml-2 min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="ALL">All currencies</option>
                    {comparisonRecipients.currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Sort
                  <select
                    value={recipientSort}
                    onChange={(event) => setRecipientSort(event.target.value as "SUPPLIER" | "PRICE")}
                    className="ml-2 min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="SUPPLIER">Supplier</option>
                    <option value="PRICE">Price within currency</option>
                  </select>
                </label>
              </div>
            </div>
            <ul className="mt-3 space-y-3">
              {comparisonRecipients.rows.map((recipient) => {
                const state = recipientState(recipient, selectedRFQ);
                const quote = recipient.quotation;
                const unitMatches = Boolean(
                  quote && quote.unit.trim().toLowerCase() === selectedRFQ.unit.trim().toLowerCase(),
                );
                const enoughQuantity = Boolean(
                  quote && compareDecimals(quote.quantity_offered, selectedRFQ.quantity) !== null
                    && (compareDecimals(quote.quantity_offered, selectedRFQ.quantity) || 0) >= 0,
                );
                const total = quote && unitMatches && enoughQuantity
                  ? estimatedTotal(quote.unit_price, selectedRFQ.quantity)
                  : null;
                const stateLabel = {
                  NOT_RESPONDED: "Not responded",
                  ACKNOWLEDGED: "Acknowledged · no quotation",
                  DECLINED: "Declined · no quotation",
                  SUBMITTED: "Quotation submitted",
                  EXPIRED: "Quotation expired",
                  UNAVAILABLE: "Unavailable · RFQ closed",
                }[state];
                return (
                <li key={recipient.company_id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{recipient.company_name}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(state === "SUBMITTED" ? "ACKNOWLEDGED" : state === "EXPIRED" || state === "UNAVAILABLE" ? "CLOSED" : recipient.status)}`}>{stateLabel}</span>
                  </div>
                  {recipient.responded_at && <p className="mt-2 text-xs text-slate-500">Responded {formatDate(recipient.responded_at)}</p>}
                  {recipient.response_note && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{recipient.response_note}</p>}
                  {quote && (
                    <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-3">
                      <div><dt className="text-xs font-semibold text-slate-500">Quoted unit price</dt><dd className="mt-1 font-semibold">{quote.currency} {quote.unit_price} / {quote.unit}</dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">Quantity offered</dt><dd className="mt-1">{quote.quantity_offered} {quote.unit}</dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">Requested quantity</dt><dd className="mt-1">{selectedRFQ.quantity} {selectedRFQ.unit}</dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">Estimated delivery</dt><dd className="mt-1">{quote.estimated_delivery_lead_time_days} days</dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">Valid until</dt><dd className="mt-1">{quote.quotation_valid_until}</dd></div>
                      <div className="lg:col-span-3"><dt className="text-xs font-semibold text-slate-500">Delivery terms</dt><dd className="mt-1 whitespace-pre-wrap">{quote.delivery_terms}</dd></div>
                      {quote.notes && <div className="lg:col-span-3"><dt className="text-xs font-semibold text-slate-500">Supplier notes</dt><dd className="mt-1 whitespace-pre-wrap">{quote.notes}</dd></div>}
                      <div className="lg:col-span-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                        <dt className="text-xs font-semibold text-slate-500">Estimated total</dt>
                        {total !== null ? (
                          <dd className="mt-1 font-semibold">{quote.currency} {total} <span className="font-normal text-slate-500">for requested quantity; estimate only</span></dd>
                        ) : (
                          <dd className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                            {unitMatches
                              ? "Not estimated: the quoted quantity is less than requested."
                              : `Not comparable: quotation unit (${quote.unit}) differs from requested unit (${selectedRFQ.unit}). No conversion applied.`}
                          </dd>
                        )}
                        <p className="mt-1 text-xs text-slate-500">Taxes, freight and other costs not represented in the quotation are excluded.</p>
                      </div>
                    </dl>
                  )}
                </li>
                );
              })}
            </ul>
            {comparisonRecipients.rows.length === 0 && (
              <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 dark:border-slate-700">
                No supplier responses match these filters.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
