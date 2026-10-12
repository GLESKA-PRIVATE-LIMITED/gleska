"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  Package,
  Pencil,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import {
  ProcurementMaterialRequest,
  ProcurementPurchaseOrder,
  ProcurementRFQ,
  ProcurementRFQRecipient,
  ProcurementSupplierOfferingMatch,
  ProcurementSupplierDiscovery,
  procurementApi,
} from "@/lib/procurement-api";

type View = "list" | "compose" | "review" | "detail" | "orders";
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

function localDateTimeValue(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
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
    RFQ_UPDATE_FAILED: "We couldn’t update this RFQ. Please try again shortly.",
    RFQ_UPDATE_RESULT_LOAD_FAILED: "The RFQ was updated, but its details could not be refreshed. Reload the RFQ.",
    RFQ_CLOSE_FAILED: "We couldn’t close this RFQ. Please try again shortly.",
    RFQ_CLOSE_RESULT_LOAD_FAILED: "The RFQ was closed, but its details could not be refreshed. Reload the RFQ.",
    RFQ_ACTIVITY_EXISTS: "This RFQ can no longer be edited because a supplier has responded or submitted a quotation.",
    RFQ_UPDATE_INVALID: "Check that the delivery location and deadline are valid and the notes are within the allowed length.",
    RFQ_LIST_FAILED: "We couldn’t load your RFQs. Please try again shortly.",
    RFQ_LOAD_FAILED: "This RFQ could not be loaded. Refresh the list and try again.",
    RFQ_NOT_FOUND: "This RFQ is no longer available to your account.",
    RFQ_CLOSED: "This RFQ is closed or its quotation deadline has passed. Refresh the RFQ list.",
    MATERIAL_REQUEST_NOT_FOUND: "That saved requirement is no longer available. Refresh the requirements and try again.",
    RFQ_SUPPLIER_INELIGIBLE: "One or more suppliers are no longer eligible for this requirement. Refresh matching results and choose again.",
    RFQ_DEADLINE_INVALID: "The quotation deadline must be in the future.",
    RFQ_DELIVERY_LOCATION_REQUIRED: "Enter a delivery location before reviewing the RFQ.",
    RFQ_RECIPIENTS_INVALID: "Choose at least one unique eligible supplier.",
    RFQ_IDEMPOTENCY_CONFLICT: "This submission key was already used for different RFQ details. Start a fresh submission.",
    EMPLOYER_ONBOARDING_INCOMPLETE: "Complete employer onboarding before creating an RFQ.",
    EMPLOYER_NOT_FOUND: "An onboarded employer profile is required to use RFQs.",
    PROCUREMENT_SETTINGS_LOAD_FAILED: "Procurement Settings could not be loaded.",
    RFQ_ALREADY_AWARDED: "A purchase order has already been created for this RFQ. Refresh to see it.",
    QUOTATION_NOT_FOUND: "That quotation is no longer available. Refresh the RFQ before selecting it.",
    QUOTATION_EXPIRED: "This quotation has expired and cannot be selected.",
    QUOTATION_NOT_COMPARABLE: "The quotation must cover the requested quantity in the requested unit before it can be selected.",
    SUPPLIER_COMPANY_INELIGIBLE: "This supplier company is no longer active and verified, so its quotation cannot be awarded.",
    QUOTATION_SELECTION_FAILED: "The purchase order could not be created. Please retry.",
    PURCHASE_ORDER_LOAD_FAILED: "The purchase order was created, but its details could not be loaded. Refresh purchase orders before trying another selection.",
    PURCHASE_ORDER_LIST_FAILED: "Purchase orders could not be loaded. Confirm migration 078 and migration 079 are applied, then refresh.",
    PURCHASE_ORDER_FULFILLMENT_NOT_ALLOWED: "Fulfillment tracking is available only for accepted purchase orders.",
    FULFILLMENT_UPDATE_FAILED: "Fulfillment progress could not be loaded. Confirm migrations 078 and 079 are applied, then refresh.",
    PURCHASE_ORDER_SUPPLIER_NOT_FOUND: "The supplier details for a purchase order could not be loaded. Refresh and retry.",
    PURCHASE_ORDER_TRANSITION_INVALID: "This purchase order has already changed and can no longer be updated.",
    PURCHASE_ORDER_UPDATE_FAILED: "The purchase order could not be updated. Please refresh and retry.",
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

function purchaseOrderStatusClass(status: string): string {
  if (status === "ACCEPTED" || status === "PARTIALLY_DELIVERED" || status === "DELIVERED") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
  if (status === "REJECTED" || status === "CANCELLED") return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
}

function purchaseOrderDeliveryStatus(order: ProcurementPurchaseOrder): string {
  const latestFulfillment = order.fulfillment_events[0];
  if (latestFulfillment) return latestFulfillment.status;
  if (
    order.status === "PREPARING"
    || order.status === "DISPATCHED"
    || order.status === "PARTIALLY_DELIVERED"
    || order.status === "DELIVERED"
  ) {
    return order.status;
  }
  return "Not started";
}

export default function ProcurementRFQPanel({
  requests,
  requestsHasMore,
  requestsLoadingMore,
  onLoadMoreRequests,
}: {
  requests: ProcurementMaterialRequest[];
  requestsHasMore: boolean;
  requestsLoadingMore: boolean;
  onLoadMoreRequests: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("list");
  const [rfqs, setRfqs] = useState<ProcurementRFQ[]>([]);
  const [rfqsPage, setRfqsPage] = useState(1);
  const [rfqsHasMore, setRfqsHasMore] = useState(false);
  const [rfqsLoadingMore, setRfqsLoadingMore] = useState(false);
  const [selectedRFQ, setSelectedRFQ] = useState<ProcurementRFQ | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<ProcurementPurchaseOrder[]>([]);
  const [purchaseOrdersPage, setPurchaseOrdersPage] = useState(1);
  const [purchaseOrdersHasMore, setPurchaseOrdersHasMore] = useState(false);
  const [purchaseOrdersLoadingMore, setPurchaseOrdersLoadingMore] = useState(false);
  const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(false);
  const [purchaseOrdersLoaded, setPurchaseOrdersLoaded] = useState(false);
  const [purchaseOrdersError, setPurchaseOrdersError] = useState("");
  const [purchaseOrderActionId, setPurchaseOrderActionId] = useState("");
  const [selectedQuotationRecipient, setSelectedQuotationRecipient] = useState<ProcurementRFQRecipient | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [discovery, setDiscovery] = useState<ProcurementSupplierDiscovery | null>(null);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [deadline, setDeadline] = useState(() => localDateTimeAfterDays(7));
  const [buyerNotes, setBuyerNotes] = useState("");
  const [editingRFQ, setEditingRFQ] = useState(false);
  const [editDeliveryLocation, setEditDeliveryLocation] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editBuyerNotes, setEditBuyerNotes] = useState("");
  const [rfqLifecycleBusy, setRfqLifecycleBusy] = useState(false);
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
  const urlLoadRequest = useRef(0);
  const selectedRFQIdRef = useRef<string | null>(null);
  selectedRFQIdRef.current = selectedRFQ?.id ?? null;

  const navigateView = useCallback((nextView: View, rfqId?: string, replace = false) => {
    setView(nextView);
    if (nextView === "list") setSelectedRFQ(null);
    const params = new URLSearchParams(window.location.search);
    params.set("rfqView", nextView);
    if (nextView === "detail" && rfqId) params.set("rfqId", rfqId);
    else params.delete("rfqId");
    const query = params.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }, [pathname, router]);

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
    setPurchaseOrdersLoading(true);
    setPurchaseOrdersLoaded(false);
    setPurchaseOrdersError("");
    setRfqsHasMore(false);
    setPurchaseOrdersHasMore(false);
    const [rfqResult, purchaseOrderResult] = await Promise.allSettled([
      procurementApi.listRFQs(),
      procurementApi.listPurchaseOrders(),
    ]);
    if (rfqResult.status === "fulfilled") {
      setRfqs(rfqResult.value.items);
      setRfqsPage(rfqResult.value.page);
      setRfqsHasMore(rfqResult.value.has_more);
      setRfqListLoaded(true);
    } else {
      setError(rfqErrorMessage(rfqResult.reason));
    }
    if (purchaseOrderResult.status === "fulfilled") {
      setPurchaseOrders(purchaseOrderResult.value.items);
      setPurchaseOrdersPage(purchaseOrderResult.value.page);
      setPurchaseOrdersHasMore(purchaseOrderResult.value.has_more);
      setPurchaseOrdersLoaded(true);
    } else {
      setPurchaseOrders([]);
      setPurchaseOrdersError(rfqErrorMessage(purchaseOrderResult.reason));
    }
    setLoading(false);
    setPurchaseOrdersLoading(false);
  }, []);

  const loadMoreRFQs = async () => {
    if (!rfqsHasMore || rfqsLoadingMore) return;
    setRfqsLoadingMore(true);
    setError("");
    try {
      const nextPage = await procurementApi.listRFQs(rfqsPage + 1);
      setRfqs((current) => {
        const knownIds = new Set(current.map((item) => item.id));
        return [...current, ...nextPage.items.filter((item) => !knownIds.has(item.id))];
      });
      setRfqsPage(nextPage.page);
      setRfqsHasMore(nextPage.has_more);
    } catch (loadError) {
      setError(rfqErrorMessage(loadError));
    } finally {
      setRfqsLoadingMore(false);
    }
  };

  const loadMorePurchaseOrders = async () => {
    if (!purchaseOrdersHasMore || purchaseOrdersLoadingMore) return;
    setPurchaseOrdersLoadingMore(true);
    setPurchaseOrdersError("");
    try {
      const nextPage = await procurementApi.listPurchaseOrders(purchaseOrdersPage + 1);
      setPurchaseOrders((current) => {
        const knownIds = new Set(current.map((item) => item.id));
        return [...current, ...nextPage.items.filter((item) => !knownIds.has(item.id))];
      });
      setPurchaseOrdersPage(nextPage.page);
      setPurchaseOrdersHasMore(nextPage.has_more);
    } catch (loadError) {
      setPurchaseOrdersError(rfqErrorMessage(loadError));
    } finally {
      setPurchaseOrdersLoadingMore(false);
    }
  };

  const refreshPurchaseOrders = useCallback(async () => {
    setPurchaseOrdersLoading(true);
    setPurchaseOrdersLoaded(false);
    setPurchaseOrdersError("");
    setPurchaseOrdersHasMore(false);
    try {
      const result = await procurementApi.listPurchaseOrders();
      setPurchaseOrders(result.items);
      setPurchaseOrdersPage(result.page);
      setPurchaseOrdersHasMore(result.has_more);
      setPurchaseOrdersLoaded(true);
    } catch (loadError) {
      setPurchaseOrdersError(rfqErrorMessage(loadError));
    } finally {
      setPurchaseOrdersLoading(false);
    }
  }, []);

  const refreshSelectionState = async (rfqId: string): Promise<ProcurementPurchaseOrder[] | null> => {
    setPurchaseOrdersLoading(true);
    setPurchaseOrdersLoaded(false);
    setPurchaseOrdersError("");
    setPurchaseOrdersHasMore(false);
    const [rfqResult, ordersResult] = await Promise.allSettled([
      procurementApi.getRFQ(rfqId),
      procurementApi.listPurchaseOrders(),
    ]);
    if (rfqResult.status === "fulfilled") {
      setSelectedRFQ(rfqResult.value);
      setRfqs((current) => current.map((rfq) => (
        rfq.id === rfqResult.value.id ? rfqResult.value : rfq
      )));
    } else {
      setError(rfqErrorMessage(rfqResult.reason));
    }
    if (ordersResult.status === "fulfilled") {
      setPurchaseOrders(ordersResult.value.items);
      setPurchaseOrdersPage(ordersResult.value.page);
      setPurchaseOrdersHasMore(ordersResult.value.has_more);
      setPurchaseOrdersLoaded(true);
    } else {
      setPurchaseOrdersError(rfqErrorMessage(ordersResult.reason));
    }
    setPurchaseOrdersLoading(false);
    return ordersResult.status === "fulfilled" ? ordersResult.value.items : null;
  };

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const requestedView = params.get("rfqView");
    const validViews: View[] = ["list", "compose", "review", "detail", "orders"];
    const nextView: View = validViews.includes(requestedView as View)
      ? requestedView as View
      : params.has("rfqId") ? "detail" : "list";
    const rfqId = nextView === "detail" ? params.get("rfqId") : null;
    if (view !== nextView) setView(nextView);
    if (!requestedView && nextView === "detail" && rfqId) {
      navigateView("detail", rfqId, true);
      return;
    }
    if (nextView !== "detail" || !rfqId) {
      if (nextView === "list") setSelectedRFQ(null);
      if (!requestedView || (nextView === "detail" && !rfqId)) {
        navigateView("list", undefined, true);
      }
      return;
    }
    if (selectedRFQIdRef.current === rfqId) return;
    setSelectedRFQ(null);
    const requestId = ++urlLoadRequest.current;
    setLoading(true);
    setError("");
    void procurementApi.getRFQ(rfqId)
      .then((rfq) => {
        if (
          urlLoadRequest.current === requestId
          && new URLSearchParams(window.location.search).get("rfqId") === rfqId
        ) {
          setSelectedRFQ(rfq);
          setRfqs((current) => [rfq, ...current.filter((item) => item.id !== rfq.id)]);
          setRecipientFilter("ALL");
          setRecipientCurrency("ALL");
          setRecipientSort("SUPPLIER");
          void refreshPurchaseOrders();
        }
      })
      .catch((loadError) => {
        if (urlLoadRequest.current === requestId) setError(rfqErrorMessage(loadError));
      })
      .finally(() => {
        if (urlLoadRequest.current === requestId) setLoading(false);
      });
  }, [navigateView, searchParams]);

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
      const rfq = await procurementApi.getRFQ(id);
      setSelectedRFQ(rfq);
      setRecipientFilter("ALL");
      setRecipientCurrency("ALL");
      setRecipientSort("SUPPLIER");
      setSelectedQuotationRecipient(null);
      navigateView("detail", id);
      setPurchaseOrdersError("");
      await refreshPurchaseOrders();
    } catch (loadError) {
      setError(rfqErrorMessage(loadError));
    }
  };

  const selectQuotation = async (recipient: ProcurementRFQRecipient) => {
    if (!selectedRFQ || selectionBusy || !recipient.quotation) return;
    if (!purchaseOrdersLoaded || purchaseOrdersHasMore || purchaseOrdersError) {
      setError("Load all purchase orders before selecting a quotation.");
      return;
    }
    if (purchaseOrders.some((order) => order.rfq_id === selectedRFQ.id)) {
      setError("This RFQ already has a purchase order.");
      return;
    }
    const rfqId = selectedRFQ.id;
    const quotationId = recipient.quotation.id;
    setSelectionBusy(true);
    setError("");
    setSuccess("");
    try {
      const order = await procurementApi.selectQuotation(rfqId, quotationId);
      setPurchaseOrders((current) => [order, ...current.filter((item) => item.id !== order.id)]);
      setSelectedQuotationRecipient(null);
      setSuccess(`Purchase order ${order.order_reference} was created for ${order.supplier_company_name}.`);
      await refreshSelectionState(rfqId);
    } catch (selectionError) {
      const refreshedOrders = await refreshSelectionState(rfqId);
      const recoveredOrder = refreshedOrders?.find(
        (order) => order.rfq_id === rfqId && order.quotation_id === quotationId,
      );
      if (recoveredOrder) {
        setSelectedQuotationRecipient(null);
        setError("");
        setSuccess(`Purchase order ${recoveredOrder.order_reference} was created for ${recoveredOrder.supplier_company_name}.`);
      } else {
        setError(rfqErrorMessage(selectionError));
      }
    } finally {
      setSelectionBusy(false);
    }
  };

  const startEditingRFQ = () => {
    if (!selectedRFQ || !selectedRFQCanEdit) return;
    setEditDeliveryLocation(selectedRFQ.delivery_location);
    setEditDeadline(localDateTimeValue(selectedRFQ.quotation_deadline));
    setEditBuyerNotes(selectedRFQ.buyer_notes || "");
    setEditingRFQ(true);
    setError("");
    setSuccess("");
  };

  const saveRFQEdits = async () => {
    if (!selectedRFQ || rfqLifecycleBusy) return;
    const deadlineTimestamp = Date.parse(editDeadline);
    if (!editDeliveryLocation.trim() || !Number.isFinite(deadlineTimestamp) || deadlineTimestamp <= Date.now()) {
      setError("Enter a delivery location and a future quotation deadline.");
      return;
    }
    setRfqLifecycleBusy(true);
    setError("");
    setSuccess("");
    try {
      const updated = await procurementApi.updateRFQ(selectedRFQ.id, {
        delivery_location: editDeliveryLocation.trim(),
        quotation_deadline: new Date(editDeadline).toISOString(),
        buyer_notes: editBuyerNotes.trim() || null,
      });
      setRfqs((current) => current.map((rfq) => rfq.id === updated.id ? updated : rfq));
      setSelectedRFQ(updated);
      setEditingRFQ(false);
      setSuccess("RFQ details updated. The latest details are available in supplier inboxes after refresh.");
    } catch (updateError) {
      setError(rfqErrorMessage(updateError));
    } finally {
      setRfqLifecycleBusy(false);
    }
  };

  const closeRFQ = async () => {
    if (!selectedRFQ || !selectedRFQIsOpen || rfqLifecycleBusy) return;
    if (!window.confirm("Close this RFQ? Suppliers will no longer be able to respond or submit quotations. Existing records will be kept.")) return;
    setRfqLifecycleBusy(true);
    setError("");
    setSuccess("");
    try {
      const closed = await procurementApi.closeRFQ(selectedRFQ.id);
      setRfqs((current) => current.map((rfq) => rfq.id === closed.id ? closed : rfq));
      setSelectedRFQ(closed);
      setEditingRFQ(false);
      setSuccess("RFQ closed. Suppliers can no longer respond or submit quotations.");
    } catch (closeError) {
      setError(rfqErrorMessage(closeError));
    } finally {
      setRfqLifecycleBusy(false);
    }
  };

  const cancelPurchaseOrder = async (order: ProcurementPurchaseOrder) => {
    if (
      order.status !== "ISSUED"
      || purchaseOrderActionId
      || !window.confirm(`Cancel ${order.order_reference}? The order cannot be reopened.`)
    ) return;
    setPurchaseOrderActionId(order.id);
    setPurchaseOrdersError("");
    setSuccess("");
    try {
      const updated = await procurementApi.cancelPurchaseOrder(order.id);
      setPurchaseOrders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSuccess(`${updated.order_reference} was cancelled.`);
    } catch (cancelError) {
      setPurchaseOrdersError(rfqErrorMessage(cancelError));
    } finally {
      setPurchaseOrderActionId("");
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
      navigateView("detail", created.id);
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
    navigateView("compose");
  };

  const selectedSupplierNames = suppliers
    .filter((supplier) => selectedCompanies.includes(supplier.companyId))
    .map((supplier) => supplier.name);
  const deadlineIsValid = Boolean(deadline && new Date(deadline).getTime() > Date.now());
  const selectedRFQOrder = selectedRFQ
    ? purchaseOrders.find((order) => order.rfq_id === selectedRFQ.id)
    : undefined;
  const selectedRFQHasSupplierActivity = Boolean(selectedRFQ?.recipients.some(
    (recipient) => recipient.status !== "INVITED" || recipient.quotation,
  ));
  const selectedRFQIsOpen = Boolean(
    selectedRFQ
    && selectedRFQ.status === "OPEN"
    && new Date(selectedRFQ.quotation_deadline).getTime() > Date.now(),
  );
  const selectedRFQCanEdit = Boolean(
    selectedRFQIsOpen && !selectedRFQOrder && !selectedRFQHasSupplierActivity,
  );

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
            Procurement
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {view === "compose" || view === "review"
              ? "Create a request for quotation"
              : view === "detail"
                ? "RFQ details"
                : view === "orders"
                  ? "Purchase orders"
                  : "Your RFQs"}
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
                navigateView("list");
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
                onClick={() => {
                  navigateView("orders");
                  void refreshPurchaseOrders();
                }}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <Package size={15} /> Purchase orders
              </button>
              <button
                type="button"
                onClick={() => void refreshRFQs()}
                disabled={loading || purchaseOrdersLoading}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <RefreshCw size={15} className={loading || purchaseOrdersLoading ? "animate-spin" : ""} /> Refresh
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
          {purchaseOrdersError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <span>Purchase-order delivery status could not be loaded: {purchaseOrdersError}</span>
              <button
                type="button"
                onClick={() => void refreshRFQs()}
                disabled={loading || purchaseOrdersLoading}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-60 dark:border-amber-800"
              >
                <RefreshCw size={14} className={purchaseOrdersLoading ? "animate-spin" : ""} /> Retry
              </button>
            </div>
          )}
          {purchaseOrdersHasMore && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              <span>Additional purchase orders are available; delivery badges here reflect the loaded orders only.</span>
              <button
                type="button"
                onClick={() => {
                  navigateView("orders");
                  void refreshPurchaseOrders();
                }}
                className="font-semibold text-purple-700 underline dark:text-purple-300"
              >
                Open purchase orders
              </button>
            </div>
          )}
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
            <div className="space-y-3">
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
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(rfq.status)}`}>RFQ status: {rfq.status}</span>
                          {purchaseOrdersLoaded && (() => {
                            const order = purchaseOrders.find((item) => item.rfq_id === rfq.id);
                            return order ? (
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${purchaseOrderStatusClass(purchaseOrderDeliveryStatus(order))}`}>
                                <Package size={12} /> Delivery status: {purchaseOrderDeliveryStatus(order)}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">
                        Deadline {formatDate(rfq.quotation_deadline)} · {rfq.recipients.length} supplier{rfq.recipients.length === 1 ? "" : "s"} · {rfq.recipients.filter((recipient) => recipient.status !== "INVITED").length} responded
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              {rfqsHasMore && (
                <button
                  type="button"
                  onClick={() => void loadMoreRFQs()}
                  disabled={rfqsLoadingMore}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-purple-700 disabled:opacity-50 dark:border-slate-700 dark:text-purple-300"
                >
                  {rfqsLoadingMore ? "Loading RFQs…" : "Load more RFQs"}
                </button>
              )}
            </div>
          ) : null}
        </>
      )}

      {view === "orders" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Before the supplier responds, an issued order may be accepted, rejected, or cancelled. Accepted orders continue through fulfillment and delivery. Rejected, cancelled, and fully delivered orders are terminal.
            </p>
            <button
              type="button"
              onClick={() => void refreshPurchaseOrders()}
              disabled={purchaseOrdersLoading}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-60 dark:border-slate-700"
            >
              <RefreshCw size={14} className={purchaseOrdersLoading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
          {purchaseOrdersError && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {purchaseOrdersError}
            </div>
          )}
          {purchaseOrdersLoading ? (
            <div role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 size={17} className="animate-spin" /> Loading purchase orders…
            </div>
          ) : purchaseOrdersLoaded && purchaseOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              No purchase orders have been created yet. Select an eligible submitted quotation from an RFQ to create one.
            </div>
          ) : purchaseOrdersLoaded ? (
            <div className="space-y-3">
              <ul className="space-y-3">
                {purchaseOrders.map((order) => (
                  <li key={order.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">{order.order_reference} · {order.item_name}</p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {order.supplier_company_name} · {order.quantity} {order.unit} · {order.currency} {order.unit_price} / {order.offered_unit}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Supplier offered {order.quantity_offered} {order.offered_unit}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${purchaseOrderStatusClass(order.status)}`}>{order.status}</span>
                  </div>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs font-semibold text-slate-500">Ordered quantity</dt><dd className="mt-1">{order.quantity} {order.unit}</dd></div>
                    <div><dt className="text-xs font-semibold text-slate-500">Fulfillment progress</dt><dd className="mt-1">{order.dispatched_quantity} {order.fulfillment_unit} dispatched · {order.delivered_quantity} {order.fulfillment_unit} delivered</dd></div>
                    <div><dt className="text-xs font-semibold text-slate-500">Delivery</dt><dd className="mt-1">{order.delivery_location} · {order.estimated_delivery_lead_time_days} day lead time</dd></div>
                    <div><dt className="text-xs font-semibold text-slate-500">Estimated delivery</dt><dd className="mt-1">{order.estimated_delivery_date || "Not provided"}</dd></div>
                    <div><dt className="text-xs font-semibold text-slate-500">Latest dispatch</dt><dd className="mt-1">{order.dispatch_date || "Not dispatched"}{order.carrier ? ` · ${order.carrier}` : ""}</dd></div>
                    <div><dt className="text-xs font-semibold text-slate-500">Tracking / reference</dt><dd className="mt-1 break-words">{order.tracking_reference || "Not provided"}</dd></div>
                    {order.delivery_date && <div><dt className="text-xs font-semibold text-slate-500">Last delivery date</dt><dd className="mt-1">{order.delivery_date}</dd></div>}
                    <div><dt className="text-xs font-semibold text-slate-500">Order created</dt><dd className="mt-1">{formatDate(order.created_at)}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Delivery terms</dt><dd className="mt-1 whitespace-pre-wrap">{order.delivery_terms}</dd></div>
                    {order.delivery_notes && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Latest supplier delivery notes</dt><dd className="mt-1 whitespace-pre-wrap">{order.delivery_notes}</dd></div>}
                    {order.supplier_notes && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Supplier quotation notes</dt><dd className="mt-1 whitespace-pre-wrap">{order.supplier_notes}</dd></div>}
                  </dl>
                  <details className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Delivery history ({order.fulfillment_events.length})
                    </summary>
                    {order.fulfillment_events.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">No fulfillment updates have been recorded yet.</p>
                    ) : (
                      <ol className="mt-3 space-y-3">
                        {order.fulfillment_events.map((event) => (
                          <li key={event.id} className="border-l-2 border-purple-200 pl-3 dark:border-purple-900">
                            <p className="font-semibold text-slate-800 dark:text-slate-200">{event.status.replaceAll("_", " ")} · {formatDate(event.created_at)}</p>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                              +{event.dispatched_quantity} {event.unit} dispatched · +{event.delivered_quantity} {event.unit} delivered
                            </p>
                            {(event.dispatch_date || event.carrier || event.tracking_reference) && (
                              <p className="mt-1 text-xs text-slate-500">
                                {event.dispatch_date || "Dispatch date not stated"}
                                {event.carrier ? ` · ${event.carrier}` : ""}
                                {event.tracking_reference ? ` · ${event.tracking_reference}` : ""}
                              </p>
                            )}
                            {event.estimated_delivery_date && <p className="mt-1 text-xs text-slate-500">Estimated delivery {event.estimated_delivery_date}</p>}
                            {event.delivery_date && <p className="mt-1 text-xs text-slate-500">Delivered {event.delivery_date}</p>}
                            {event.delivery_notes && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{event.delivery_notes}</p>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </details>
                  {order.status === "ISSUED" && (
                    <button
                      type="button"
                      onClick={() => void cancelPurchaseOrder(order)}
                      disabled={Boolean(purchaseOrderActionId)}
                      className="mt-3 min-h-9 rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                    >
                      {purchaseOrderActionId === order.id ? "Cancelling…" : "Cancel order"}
                    </button>
                  )}
                  </li>
                ))}
              </ul>
              {purchaseOrdersHasMore && (
                <button
                  type="button"
                  onClick={() => void loadMorePurchaseOrders()}
                  disabled={purchaseOrdersLoadingMore}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-purple-700 disabled:opacity-50 dark:border-slate-700 dark:text-purple-300"
                >
                  {purchaseOrdersLoadingMore ? "Loading purchase orders…" : "Load more purchase orders"}
                </button>
              )}
            </div>
          ) : null}
        </div>
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
              {requestsHasMore && (
                <button
                  type="button"
                  onClick={onLoadMoreRequests}
                  disabled={requestsLoadingMore}
                  className="text-sm font-semibold text-purple-700 underline disabled:opacity-50 dark:text-purple-300"
                >
                  {requestsLoadingMore ? "Loading requirements…" : "Load more saved requirements"}
                </button>
              )}
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
                {discovery?.search_limit_reached && (
                  <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    Showing up to 100 top-ranked matching listings; additional matching listings or suppliers may exist.
                  </p>
                )}
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
                    navigateView("review");
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
            <button type="button" onClick={() => navigateView("compose")} disabled={submitting} className="min-h-10 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
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
          {purchaseOrdersError && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Purchase-order state could not be loaded: {purchaseOrdersError} Refresh the RFQ details before awarding a quotation.
            </div>
          )}
          {!purchaseOrdersError
            && purchaseOrdersLoaded
            && purchaseOrdersHasMore
            && !purchaseOrders.some((order) => order.rfq_id === selectedRFQ.id) && (
              <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <span>This RFQ has no order in the loaded results. Load all purchase orders to confirm its status before selecting a quotation.</span>
                <button
                  type="button"
                  onClick={() => void loadMorePurchaseOrders()}
                  disabled={purchaseOrdersLoadingMore}
                  className="font-semibold underline disabled:opacity-50"
                >
                  {purchaseOrdersLoadingMore ? "Loading…" : "Load more purchase orders"}
                </button>
              </div>
            )}
          {(() => {
            const existingOrder = purchaseOrders.find((order) => order.rfq_id === selectedRFQ.id);
            return existingOrder ? (
              <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4 dark:border-purple-900 dark:bg-purple-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold text-slate-900 dark:text-white">Awarded · {existingOrder.order_reference}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${purchaseOrderStatusClass(existingOrder.status)}`}>{existingOrder.status}</span>
                </div>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                  {existingOrder.supplier_company_name} · {existingOrder.currency} {existingOrder.unit_price} / {existingOrder.offered_unit}
                </p>
              </div>
            ) : null;
          })()}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{selectedRFQ.item_name}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {selectedRFQ.quantity} {selectedRFQ.unit} · {selectedRFQ.delivery_location}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(selectedRFQ.status)}`}>{selectedRFQ.status}</span>
          </div>
          {selectedRFQIsOpen && !selectedRFQOrder && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={startEditingRFQ}
                  disabled={!selectedRFQCanEdit || rfqLifecycleBusy}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
                  title={selectedRFQHasSupplierActivity ? "RFQs cannot be edited after a supplier responds or submits a quotation." : undefined}
                >
                  <Pencil size={14} /> Edit RFQ
                </button>
                <button
                  type="button"
                  onClick={() => void closeRFQ()}
                  disabled={rfqLifecycleBusy}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300"
                >
                  {rfqLifecycleBusy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                  Close RFQ
                </button>
              </div>
              {selectedRFQHasSupplierActivity && (
                <p className="text-xs text-slate-500">Editing is unavailable after supplier responses or quotations; closing remains available.</p>
              )}
            </div>
          )}
          {editingRFQ && (
            <div className="space-y-3 rounded-xl border border-purple-200 bg-purple-50/50 p-4 dark:border-purple-900 dark:bg-purple-950/20">
              <div>
                <h4 className="font-semibold">Edit RFQ details</h4>
                <p className="mt-1 text-xs text-slate-500">The requested material and invited suppliers remain unchanged. Edits are allowed only before supplier activity.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Delivery location
                  <input
                    value={editDeliveryLocation}
                    onChange={(event) => setEditDeliveryLocation(event.target.value)}
                    maxLength={500}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="text-sm font-medium">
                  Quotation deadline
                  <input
                    type="datetime-local"
                    value={editDeadline}
                    onChange={(event) => setEditDeadline(event.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="text-sm font-medium sm:col-span-2">
                  Buyer notes
                  <textarea
                    value={editBuyerNotes}
                    onChange={(event) => setEditBuyerNotes(event.target.value)}
                    maxLength={4000}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingRFQ(false)}
                  disabled={rfqLifecycleBusy}
                  className="min-h-9 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void saveRFQEdits()}
                  disabled={rfqLifecycleBusy}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-purple-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {rfqLifecycleBusy && <Loader2 size={14} className="animate-spin" />}
                  {rfqLifecycleBusy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          )}
          <dl className="grid gap-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700 sm:grid-cols-2">
            <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Specification</dt><dd className="mt-1 whitespace-pre-wrap">{selectedRFQ.specification || "Not specified"}</dd></div>
            <div><dt className="text-xs font-semibold text-slate-500">Quotation deadline</dt><dd className="mt-1 flex items-center gap-1.5"><Clock3 size={14} />{formatDate(selectedRFQ.quotation_deadline)}</dd></div>
            <div><dt className="text-xs font-semibold text-slate-500">Created</dt><dd className="mt-1">{formatDate(selectedRFQ.created_at)}</dd></div>
            {selectedRFQ.buyer_notes && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Buyer notes</dt><dd className="mt-1 whitespace-pre-wrap">{selectedRFQ.buyer_notes}</dd></div>}
          </dl>
          {selectedQuotationRecipient?.quotation && (
            <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">Confirm quotation selection</h3>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                  This creates a purchase order and closes the RFQ to further quotation activity.
                </p>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-semibold text-slate-500">Supplier</dt><dd className="mt-1 font-semibold">{selectedQuotationRecipient.company_name}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">Agreed price</dt><dd className="mt-1">{selectedQuotationRecipient.quotation.currency} {selectedQuotationRecipient.quotation.unit_price} / {selectedQuotationRecipient.quotation.unit}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">Requested quantity</dt><dd className="mt-1">{selectedRFQ.quantity} {selectedRFQ.unit}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">Supplier quantity offered</dt><dd className="mt-1">{selectedQuotationRecipient.quotation.quantity_offered} {selectedQuotationRecipient.quotation.unit}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">Estimated total for requested quantity</dt><dd className="mt-1">{selectedQuotationRecipient.quotation.currency} {estimatedTotal(selectedQuotationRecipient.quotation.unit_price, selectedRFQ.quantity) ?? "Unavailable"}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">Lead time</dt><dd className="mt-1">{selectedQuotationRecipient.quotation.estimated_delivery_lead_time_days} days</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">Quotation valid until</dt><dd className="mt-1">{selectedQuotationRecipient.quotation.quotation_valid_until}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Delivery terms</dt><dd className="mt-1 whitespace-pre-wrap">{selectedQuotationRecipient.quotation.delivery_terms}</dd></div>
                {selectedQuotationRecipient.quotation.notes && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Supplier notes</dt><dd className="mt-1 whitespace-pre-wrap">{selectedQuotationRecipient.quotation.notes}</dd></div>}
                <p className="text-xs text-slate-500 sm:col-span-2">Estimated total excludes taxes, freight, and charges not stated in the quotation. No currency conversion is applied.</p>
              </dl>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setSelectedQuotationRecipient(null)} disabled={selectionBusy} className="min-h-10 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Back</button>
                <button type="button" onClick={() => void selectQuotation(selectedQuotationRecipient)} disabled={selectionBusy || !purchaseOrdersLoaded || purchaseOrdersHasMore || Boolean(purchaseOrdersError) || purchaseOrders.some((order) => order.rfq_id === selectedRFQ.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60">
                  {selectionBusy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  {selectionBusy ? "Creating purchase order…" : "Confirm selection & create order"}
                </button>
              </div>
            </div>
          )}
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
                const existingOrder = purchaseOrders.find((order) => order.rfq_id === selectedRFQ.id);
                const quoteExpired = Boolean(quote && quote.quotation_valid_until < localDateString());
                const canSelectQuote = Boolean(
                  quote
                  && state === "SUBMITTED"
                  && selectedRFQ.status === "OPEN"
                  && new Date(selectedRFQ.quotation_deadline).getTime() > Date.now()
                  && !existingOrder
                  && purchaseOrdersLoaded
                  && !purchaseOrdersHasMore
                  && !purchaseOrdersError
                  && !quoteExpired
                  && unitMatches
                  && enoughQuantity
                  && recipient.status !== "DECLINED",
                );
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
                  {quote && !existingOrder && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      {!canSelectQuote && state === "SUBMITTED" && selectedRFQ.status === "OPEN" && (
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                          {quoteExpired
                            ? "Expired quotations cannot be selected."
                            : !unitMatches
                              ? "Cannot select: the offered unit differs from the requested unit."
                              : !enoughQuantity
                                ? "Cannot select: the offered quantity is below the requested quantity."
                                : ""}
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={!canSelectQuote || selectionBusy}
                        onClick={() => setSelectedQuotationRecipient(recipient)}
                        className="ml-auto inline-flex min-h-9 items-center gap-2 rounded-lg border border-purple-300 px-3 py-1.5 text-sm font-semibold text-purple-800 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-800 dark:text-purple-300 dark:hover:bg-purple-950/40"
                      >
                        <CheckCircle2 size={14} /> Select & create purchase order
                      </button>
                    </div>
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
