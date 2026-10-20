import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Hash,
  LoaderCircle,
  ListFilter,
  MapPin,
  Package,
  PackageSearch,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import DeleteAccountSection from "../auth/DeleteAccountSection";
import { useAuth } from "../auth/AuthProvider";
import {
  procurementWorkspaceApi,
  type ProcurementConversation,
  type MaterialRequestDraft,
  type ProcurementMaterialRequest,
  type ProcurementPurchaseOrder,
  type ProcurementRFQ,
  type ProcurementRFQCreatePayload,
  type ProcurementSettings,
  type ProcurementSettingsUpdate,
  type ProcurementSupplierDiscovery,
  type ProcurementUnit,
} from "./procurementApi";

export type BuyerSection = "get" | "requirements" | "rfqs" | "orders" | "details" | "settings";

type RFQSubmissionPayload = Omit<ProcurementRFQCreatePayload, "idempotency_key">;

interface PendingRFQSubmission {
  key: string;
  signature: string;
  payload: RFQSubmissionPayload;
  requestRevision: number;
  requestSnapshot: Pick<
    ProcurementMaterialRequest,
    "title" | "item_name" | "specification" | "quantity" | "unit"
  >;
}

const units: ProcurementUnit[] = ["MT", "Bags", "Pieces", "Kg", "Tons", "Meters", "Sq. ft", "Boxes", "Liters"];
const sectionTitles: Record<BuyerSection, string> = {
  get: "Get Procurement",
  requirements: "Requirements",
  rfqs: "RFQs & Quotations",
  orders: "Orders & Fulfilment",
  details: "Procurement Details",
  settings: "Settings",
};

function errorText(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : "Could not complete this action. Please retry.";
}

function normalizeBackendWhitespace(value: string) {
  return value.replace(/[\s\u001c-\u001f\u0085]+/gu, " ").trim();
}

function canonicalRequirementDraft(draft: MaterialRequestDraft) {
  const optionalText = (value: string | null) => value?.trim() || null;
  const quantity = draft.quantity === null || draft.quantity === ""
    ? null
    : String(draft.quantity).trim().replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return JSON.stringify({
    title: optionalText(draft.title),
    item_name: optionalText(draft.item_name),
    specification: optionalText(draft.specification),
    quantity,
    unit: optionalText(draft.unit),
    required_by: optionalText(draft.required_by),
    delivery_location: optionalText(draft.delivery_location),
    additional_requirements: draft.additional_requirements.map((item) => item.trim()).filter(Boolean),
    notes: optionalText(draft.notes),
  });
}

function localDateTimeValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function rfqSubmissionSignature(payload: RFQSubmissionPayload) {
  return JSON.stringify(payload);
}

function parsePendingRFQSubmission(serialized: string): PendingRFQSubmission | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    const payloadValue = record.payload;
    const snapshotValue = record.requestSnapshot;
    if (typeof payloadValue !== "object" || payloadValue === null ||
        typeof snapshotValue !== "object" || snapshotValue === null) return null;
    const payload = payloadValue as Record<string, unknown>;
    const snapshot = snapshotValue as Record<string, unknown>;
    if (
      typeof record.key !== "string" ||
      typeof record.signature !== "string" ||
      typeof record.requestRevision !== "number" ||
      typeof payload.material_request_id !== "string" ||
      !Array.isArray(payload.supplier_company_ids) ||
      !payload.supplier_company_ids.every((id) => typeof id === "string") ||
      typeof payload.delivery_location !== "string" ||
      typeof payload.quotation_deadline !== "string" ||
      (payload.buyer_notes !== null && typeof payload.buyer_notes !== "string") ||
      (snapshot.title !== null && typeof snapshot.title !== "string") ||
      typeof snapshot.item_name !== "string" ||
      (snapshot.specification !== null && typeof snapshot.specification !== "string") ||
      (typeof snapshot.quantity !== "string" && typeof snapshot.quantity !== "number") ||
      typeof snapshot.unit !== "string"
    ) return null;

    const submissionPayload: RFQSubmissionPayload = {
      material_request_id: payload.material_request_id,
      supplier_company_ids: payload.supplier_company_ids,
      delivery_location: payload.delivery_location,
      quotation_deadline: payload.quotation_deadline,
      buyer_notes: payload.buyer_notes,
    };
    if (!record.key || rfqSubmissionSignature(submissionPayload) !== record.signature) return null;
    return {
      key: record.key,
      signature: record.signature,
      payload: submissionPayload,
      requestRevision: record.requestRevision,
      requestSnapshot: {
        title: snapshot.title,
        item_name: snapshot.item_name,
        specification: snapshot.specification,
        quantity: snapshot.quantity,
        unit: snapshot.unit,
      },
    };
  } catch {
    return null;
  }
}

function pendingRFQKeyFromStorage(serialized: string): string | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || value === null || !("key" in value)) return null;
    const key = (value as { key: unknown }).key;
    return typeof key === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
      ? key
      : null;
  } catch {
    return null;
  }
}

function emptyDraft(request?: ProcurementMaterialRequest): MaterialRequestDraft {
  return {
    title: request?.title ?? "",
    item_name: request?.item_name ?? "",
    specification: request?.specification ?? "",
    quantity: request?.quantity == null ? "" : String(request.quantity),
    unit: request?.unit ?? "",
    required_by: request?.required_by ?? "",
    delivery_location: request?.delivery_location ?? "",
    additional_requirements: request?.additional_requirements ?? [],
    notes: request?.notes ?? "",
  };
}

function decimalParts(value: string | number) {
  const match = String(value).trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || "";
  return { scale: fraction.length, value: BigInt(`${match[1]}${fraction}`) };
}

function compareDecimal(left: string | number, right: string | number) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const aValue = a.value * (10n ** BigInt(scale - a.scale));
  const bValue = b.value * (10n ** BigInt(scale - b.scale));
  return aValue === bValue ? 0 : aValue > bValue ? 1 : -1;
}

export default function ProcurementBuyerScreen({ section }: { section: BuyerSection }) {
  const [searchParams] = useSearchParams();
  const requestedRequirementView = searchParams.get("view");
  const { user } = useAuth();
  const [requests, setRequests] = useState<ProcurementMaterialRequest[]>([]);
  const [rfqs, setRfqs] = useState<ProcurementRFQ[]>([]);
  const [orders, setOrders] = useState<ProcurementPurchaseOrder[]>([]);
  const [purchaseOrderHistoryLoaded, setPurchaseOrderHistoryLoaded] = useState(false);
  const [settings, setSettings] = useState<ProcurementSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ProcurementSettingsUpdate | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [discovery, setDiscovery] = useState<ProcurementSupplierDiscovery | null>(null);
  const [discoveryLocation, setDiscoveryLocation] = useState("");
  const [rfqRequestId, setRfqRequestId] = useState("");
  const [rfqDiscovery, setRfqDiscovery] = useState<ProcurementSupplierDiscovery | null>(null);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [rfqDeliveryLocation, setRfqDeliveryLocation] = useState("");
  const [rfqDeadline, setRfqDeadline] = useState("");
  const [rfqNotes, setRfqNotes] = useState("");
  const [rfqReview, setRfqReview] = useState(false);
  const [pendingRfqRecovery, setPendingRfqRecovery] = useState<PendingRFQSubmission | null>(null);
  const [orphanedRfqAttemptKeys, setOrphanedRfqAttemptKeys] = useState<string[]>([]);
  const [rfqRecoveryLoaded, setRfqRecoveryLoaded] = useState(false);
  const [rfqRecoveryError, setRfqRecoveryError] = useState("");
  const [rfqRecoveryCheckNonce, setRfqRecoveryCheckNonce] = useState(0);
  const [rfqStorageNotice, setRfqStorageNotice] = useState("");
  const [editingRfqId, setEditingRfqId] = useState("");
  const [editRfqDeliveryLocation, setEditRfqDeliveryLocation] = useState("");
  const [editRfqDeadline, setEditRfqDeadline] = useState("");
  const [editRfqNotes, setEditRfqNotes] = useState("");
  const [editingRequestId, setEditingRequestId] = useState("");
  const [requestDraft, setRequestDraft] = useState<MaterialRequestDraft>(emptyDraft());
  const [requirementView, setRequirementView] = useState<"create" | "saved">("saved");
  const [creationMode, setCreationMode] = useState<"ai" | "manual">("ai");
  const [requirementConversation, setRequirementConversation] = useState<ProcurementConversation | null>(null);
  const [newRequestDraft, setNewRequestDraft] = useState<MaterialRequestDraft>(emptyDraft());
  const [requirementMessage, setRequirementMessage] = useState("");
  const [requirementMessageRecoveryRequired, setRequirementMessageRecoveryRequired] = useState(false);
  const [manualRequirementConfirmed, setManualRequirementConfirmed] = useState(false);
  const [requirementRecoveryLoading, setRequirementRecoveryLoading] = useState(false);
  const [requirementSaveLocked, setRequirementSaveLocked] = useState(false);
  const [requirementRecoveryRetry, setRequirementRecoveryRetry] = useState(0);
  const [requirementDraftExpanded, setRequirementDraftExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [requestCursors, setRequestCursors] = useState<(string | null)[]>([null]);
  const [nextRequestCursor, setNextRequestCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [rfqSettingsError, setRfqSettingsError] = useState("");
  const loadSequence = useRef(0);
  const discoverySequence = useRef(0);
  const rfqLocationTouchedRef = useRef(false);
  const rfqSubmissionLockRef = useRef(false);
  const requirementSaveLockRef = useRef(false);
  const userIdRef = useRef(user?.id || "");
  const requirementOwnerRef = useRef(user?.id || "");
  userIdRef.current = user?.id || "";
  const rfqRecoveryStorageKey = user?.id
    ? `gleska:procurement:rfq:create:${user.id}`
    : "";

  useEffect(() => {
    let current = true;
    setRfqRecoveryLoaded(false);
    setPendingRfqRecovery(null);
    setOrphanedRfqAttemptKeys([]);
    setRfqRecoveryError("");
    setRfqStorageNotice("");
    if (!user?.id) {
      setRfqRecoveryLoaded(true);
      return () => { current = false; };
    }
    const ownerId = user.id;
    const storageKey = `gleska:procurement:rfq:create:${ownerId}`;
    void (async () => {
      let pending: PendingRFQSubmission | null = null;
      let malformedKey: string | null = null;
      let storageFailure = false;
      let malformedStorage = false;
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          pending = parsePendingRFQSubmission(stored);
          malformedStorage = !pending;
          if (!pending) malformedKey = pendingRFQKeyFromStorage(stored);
        }
      } catch {
        storageFailure = true;
      }

      try {
        if (pending) {
          const recovery = await procurementWorkspaceApi.recoverRfqAttempt(pending.key);
          if (!current || userIdRef.current !== ownerId) return;
          if (recovery.status === "SUCCEEDED" && recovery.rfq) {
            try {
              localStorage.removeItem(storageKey);
            } catch {
              setRfqStorageNotice("The RFQ was confirmed as created, but its local recovery record could not be cleared. It remains scoped to this account.");
            }
            setPendingRfqRecovery(null);
            setRfqs((items) => [recovery.rfq!, ...items.filter((item) => item.id !== recovery.rfq!.id)]);
            setSuccess("The previous RFQ attempt was confirmed as created.");
          } else if (recovery.status === "SUCCEEDED") {
            setRfqRecoveryError("The server reports that the saved RFQ attempt succeeded but did not return its RFQ record. Its local data is preserved; retry the recovery check.");
          } else if (recovery.status === "NOT_CREATED") {
            try {
              localStorage.removeItem(storageKey);
            } catch {
              setRfqRecoveryError("The server confirmed that the previous attempt did not create an RFQ, but its local recovery record could not be cleared. Resolve local storage before starting another attempt.");
              return;
            }
            setPendingRfqRecovery(null);
            setRfqStorageNotice(`The server confirmed that the previous RFQ was not created${recovery.error_code ? ` (${recovery.error_code})` : ""}. You may review and submit a new RFQ.`);
          } else {
            setPendingRfqRecovery(pending);
          }
        } else if (malformedStorage && malformedKey) {
          const recovery = await procurementWorkspaceApi.recoverRfqAttempt(malformedKey);
          if (!current || userIdRef.current !== ownerId) return;
          if (recovery.status === "SUCCEEDED" && recovery.rfq) {
            try {
              localStorage.removeItem(storageKey);
            } catch {
              setRfqStorageNotice("The RFQ was confirmed as created, but the damaged local recovery record could not be cleared.");
            }
            malformedStorage = false;
            setRfqs((items) => [recovery.rfq!, ...items.filter((item) => item.id !== recovery.rfq!.id)]);
            setSuccess("The previous RFQ attempt was confirmed as created.");
          } else if (recovery.status === "NOT_CREATED") {
            try {
              localStorage.removeItem(storageKey);
            } catch {
              setRfqRecoveryError("The server confirmed that the damaged attempt was not created, but its local recovery record could not be cleared.");
              return;
            }
            malformedStorage = false;
            setRfqStorageNotice(`The damaged RFQ attempt was confirmed as not created${recovery.error_code ? ` (${recovery.error_code})` : ""}. You may review and submit a new RFQ.`);
          } else if (recovery.status === "SUCCEEDED") {
            setRfqRecoveryError("The server reports that the damaged RFQ attempt succeeded but did not return its RFQ record. The local data is preserved; retry recovery or contact support.");
          } else {
            setRfqRecoveryError(
              recovery.status === "PENDING"
                ? "The server still has this RFQ attempt pending, but its saved payload is damaged and cannot be retried safely. The key and local record are preserved; contact support to recover it."
                : "The server has not registered this damaged RFQ attempt. Its original payload cannot be reconstructed safely, so it remains preserved and a new RFQ is blocked.",
            );
          }
        } else if (malformedStorage) {
          setRfqRecoveryError("A saved RFQ attempt could not be read safely. It has not been discarded; creating another RFQ is blocked.");
        } else if (storageFailure) {
          setRfqRecoveryError("Pending RFQ recovery storage is unavailable. Creating a new RFQ is blocked to avoid losing an unresolved attempt.");
        }

        const unresolved = await procurementWorkspaceApi.listPendingRfqAttempts();
        if (!current || userIdRef.current !== ownerId) return;
        const localKey = pending?.key || malformedKey;
        const unmatchedKeys = unresolved.items
          .map((item) => item.idempotency_key)
          .filter((key) => key !== localKey);
        setOrphanedRfqAttemptKeys(unmatchedKeys);
        if (unresolved.has_more) {
          setRfqRecoveryError("There are more unresolved RFQ attempts than can be checked at once. Creating another RFQ is blocked; contact support to recover the remaining attempts.");
        } else if (unmatchedKeys.length) {
          setRfqRecoveryError("The server has unresolved RFQ attempts without a matching saved payload on this device. They cannot be retried safely here, so creating another RFQ is blocked.");
        }
      } catch (recoveryError) {
        if (!current || userIdRef.current !== ownerId) return;
        if (pending) setPendingRfqRecovery(pending);
        setRfqRecoveryError(`Could not confirm saved RFQ recovery (${errorText(recoveryError)}). Keep the original attempt and retry the recovery check before creating another RFQ.`);
      } finally {
        if (current && userIdRef.current === ownerId) setRfqRecoveryLoaded(true);
      }
    })();
    return () => { current = false; };
  }, [user?.id, rfqRecoveryCheckNonce]);

  const load = useCallback(async () => {
    const requestId = ++loadSequence.current;
    const isCurrent = () => loadSequence.current === requestId;
    setLoading(true);
    setError("");
    try {
      if (section === "settings") {
        const result = await procurementWorkspaceApi.getSettings();
        if (!isCurrent()) return;
        setSettings(result);
        setSettingsDraft({
          default_delivery_location: result.default_delivery_location,
          preferred_units: result.preferred_units,
          specification_match_policy: result.specification_match_policy,
          delivery_coverage_policy: result.delivery_coverage_policy,
        });
      } else if (section === "rfqs") {
        setPurchaseOrderHistoryLoaded(false);
        const [requestPage, rfqPage, allOrders, procurementSettings] = await Promise.all([
          procurementWorkspaceApi.listRequests(),
          procurementWorkspaceApi.listRfqs(page),
          procurementWorkspaceApi.listAllPurchaseOrders(),
          procurementWorkspaceApi.getSettings().catch((settingsError: unknown) => {
            if (isCurrent()) {
              setRfqSettingsError(errorText(settingsError));
            }
            return null;
          }),
        ]);
        if (!isCurrent()) return;
        setRequests(requestPage.items);
        setRfqs(rfqPage.items);
        setHasMore(rfqPage.has_more);
        setOrders(allOrders);
        setPurchaseOrderHistoryLoaded(true);
        setSettings(procurementSettings);
        if (procurementSettings) setRfqSettingsError("");
        setRfqRequestId((current) => current || requestPage.items[0]?.id || "");
      } else if (section === "orders") {
        const orderPage = await procurementWorkspaceApi.listPurchaseOrders(page);
        if (!isCurrent()) return;
        setOrders(orderPage.items);
        setHasMore(orderPage.has_more);
      } else {
        const result = await procurementWorkspaceApi.listRequests(requestCursors[page - 1] ?? null);
        if (!isCurrent()) return;
        setRequests(result.items);
        setHasMore(result.has_more);
        setNextRequestCursor(result.next_cursor || null);
        setSelectedRequestId((current) => current || result.items[0]?.id || "");
      }
    } catch (loadError) {
      if (isCurrent()) setError(errorText(loadError));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [page, requestCursors, section]);

  useEffect(() => {
    if (section !== "rfqs" || !rfqRequestId) return;
    const request = requests.find((item) => item.id === rfqRequestId);
    const requestLocation = request?.delivery_location?.trim();
    if (requestLocation) {
      setRfqDeliveryLocation(requestLocation);
    } else if (!rfqLocationTouchedRef.current) {
      setRfqDeliveryLocation(settings?.default_delivery_location?.trim() || "");
    }
  }, [rfqRequestId, requests, section, settings?.default_delivery_location]);

  useEffect(() => {
    setError("");
    setSuccess("");
    setPage(1);
    setRequestCursors([null]);
    setNextRequestCursor(null);
  }, [section]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (key: string, action: () => Promise<void>, successMessage: string) => {
    setBusy(key);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(successMessage);
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      setBusy("");
    }
  };

  const visibleRequests = requests.filter((item) =>
    [item.title, item.item_name, item.specification, item.unit]
      .some((value) => value?.toLowerCase().includes(search.toLowerCase())),
  );
  const requirementFieldsDisabled = requirementSaveLocked
    || requirementConversation?.status !== "ACTIVE"
    || Boolean(busy);
  const selectedRfqRequest = requests.find((item) => item.id === rfqRequestId) || null;
  const effectiveRfqLocation = normalizeBackendWhitespace(
    selectedRfqRequest?.delivery_location?.trim() || rfqDeliveryLocation,
  );
  const rfqDeadlineValid = Boolean(rfqDeadline && new Date(rfqDeadline).getTime() > Date.now());
  const selectedRfqSupplierNames = (rfqDiscovery?.matches || [])
    .filter((supplier) => selectedSupplierIds.includes(supplier.supplier_company_id))
    .map((supplier) => supplier.supplier_name);

  const discover = async (requestId: string, location?: string) => {
    const sequence = ++discoverySequence.current;
    setBusy("discovery");
    setError("");
    setDiscovery(null);
    try {
      const result = await procurementWorkspaceApi.discoverSuppliers(requestId, location);
      if (discoverySequence.current === sequence) setDiscovery(result);
    } catch (discoverError) {
      if (discoverySequence.current === sequence) setError(errorText(discoverError));
    } finally {
      if (discoverySequence.current === sequence) setBusy("");
    }
  };

  const loadRfqDiscovery = async (requestId: string) => {
    const sequence = ++discoverySequence.current;
    if (requestId !== rfqRequestId) {
      rfqLocationTouchedRef.current = false;
      setRfqDeliveryLocation("");
      setRfqReview(false);
      setError("");
      setSuccess("");
    }
    setRfqRequestId(requestId);
    setRfqDiscovery(null);
    setSelectedSupplierIds([]);
    if (!requestId) return;
    setBusy("rfq-discovery");
    setError("");
    try {
      const result = await procurementWorkspaceApi.discoverSuppliers(requestId);
      if (discoverySequence.current === sequence) setRfqDiscovery(result);
    } catch (discoverError) {
      if (discoverySequence.current === sequence) setError(errorText(discoverError));
    } finally {
      if (discoverySequence.current === sequence) setBusy("");
    }
  };

  const saveRequest = async (event: FormEvent) => {
    event.preventDefault();
    const current = requests.find((item) => item.id === editingRequestId);
    if (!current) return;
    await runAction("save-request", async () => {
      const updated = await procurementWorkspaceApi.updateRequest(
        current.id,
        {
          ...requestDraft,
          quantity: requestDraft.quantity === "" ? null : requestDraft.quantity,
          additional_requirements: requestDraft.additional_requirements,
        },
        current.revision,
      );
      setRequests((items) => items.map((item) => item.id === updated.id ? updated : item));
      setEditingRequestId("");
    }, "Requirement updated.");
  };

  const saveRfqEdits = async (rfq: ProcurementRFQ) => {
    const deliveryLocation = normalizeBackendWhitespace(editRfqDeliveryLocation);
    const buyerNotes = normalizeBackendWhitespace(editRfqNotes);
    if (!deliveryLocation || deliveryLocation.length > 500) {
      setError("Enter a delivery location of 1 to 500 characters.");
      return;
    }
    if (!editRfqDeadline || new Date(editRfqDeadline).getTime() <= Date.now()) {
      setError("Choose a future quotation deadline.");
      return;
    }
    await runAction(`edit-rfq-${rfq.id}`, async () => {
      const updated = await procurementWorkspaceApi.updateRfq(rfq.id, {
        delivery_location: deliveryLocation,
        quotation_deadline: new Date(editRfqDeadline).toISOString(),
        buyer_notes: buyerNotes || null,
      });
      setRfqs((items) => items.map((item) => item.id === updated.id ? updated : item));
      setEditingRfqId("");
    }, "RFQ details updated.");
  };

  const deleteRequest = async (request: ProcurementMaterialRequest) => {
    if (!window.confirm(`Delete the saved requirement "${request.title || request.item_name}"?`)) return;
    await runAction(`delete-${request.id}`, async () => {
      await procurementWorkspaceApi.deleteRequest(request.id);
      setRequests((items) => items.filter((item) => item.id !== request.id));
      if (selectedRequestId === request.id) {
        setSelectedRequestId(requests.find((item) => item.id !== request.id)?.id || "");
        setDiscovery(null);
      }
    }, "Requirement deleted.");
  };

  const openRequirementCreation = async (mode: "ai" | "manual") => {
    if (!user?.id) {
      setError("Sign in as an employer to create a procurement requirement.");
      return;
    }
    const ownerId = user.id;
    setBusy("requirement-create");
    setError("");
    setSuccess("");
    try {
      const storageKey = `gleska:procurement:material-request:create:${user.id}`;
      const existingConversationId = localStorage.getItem(storageKey);
      if (existingConversationId) {
        const existing = await procurementWorkspaceApi.getConversation(existingConversationId);
        const saved = await findRequestForConversation(existingConversationId);
        if (userIdRef.current !== ownerId) return;
        if (saved) {
          completeRequirementSave(saved);
          return;
        }
        if (existing.status !== "ACTIVE") {
          setRequirementConversation(existing);
          setNewRequestDraft(existing.draft);
          setRequirementSaveLocked(true);
          setRequirementView("create");
          setError("A previous requirement save is still unresolved. Its conversation is preserved; do not start another requirement until it is recovered.");
          return;
        }
        setRequirementConversation(existing);
        setNewRequestDraft(existing.draft);
        setRequirementMessageRecoveryRequired(false);
        setRequirementSaveLocked(Boolean(localStorage.getItem(
          `gleska:procurement:save:${existingConversationId}`,
        )));
        setCreationMode(mode);
        setRequirementView("create");
        setError("Resumed your existing requirement draft so it is not abandoned.");
        return;
      }
      const conversation = await procurementWorkspaceApi.createConversation();
      if (userIdRef.current !== ownerId) return;
      setRequirementConversation(conversation);
      setNewRequestDraft(conversation.draft);
      setRequirementMessage("");
      setRequirementMessageRecoveryRequired(false);
      setManualRequirementConfirmed(false);
      setRequirementSaveLocked(false);
      setCreationMode(mode);
      setRequirementView("create");
      localStorage.setItem(`gleska:procurement:material-request:create:${ownerId}`, conversation.conversation_id);
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      setBusy("");
    }
  };

  const sendRequirementMessage = async (event: FormEvent) => {
    event.preventDefault();
    const conversation = requirementConversation;
    const message = requirementMessage.trim();
    if (!conversation || conversation.status !== "ACTIVE" || !message || busy || requirementMessageRecoveryRequired) return;
    const ownerId = user?.id || "";
    setBusy("requirement-message");
    setError("");
    setSuccess("");
    try {
      const updated = await procurementWorkspaceApi.sendConversationMessage(
        conversation.conversation_id,
        message,
        conversation.revision,
      );
      if (userIdRef.current !== ownerId) return;
      setRequirementConversation(updated);
      setNewRequestDraft(updated.draft);
      setRequirementMessage("");
      setRequirementMessageRecoveryRequired(false);
    } catch (messageError) {
      try {
        const latest = await procurementWorkspaceApi.getConversation(conversation.conversation_id);
        if (userIdRef.current !== ownerId) return;
        setRequirementConversation(latest);
        setNewRequestDraft(latest.draft);
        if (latest.history.some((entry) => entry.role === "user" && entry.content === message)) {
          setRequirementMessage("");
          setError(`The response was interrupted, but the conversation was refreshed. Review the latest draft before continuing. ${errorText(messageError)}`);
        } else {
          setError(`The message was not confirmed. The conversation was refreshed; review its history before retrying. ${errorText(messageError)}`);
        }
      } catch (recoveryError) {
        setRequirementMessageRecoveryRequired(true);
        setError(`Could not confirm whether the message was processed. The server conversation remains saved; reload Requirements before sending it again. ${errorText(recoveryError)}`);
      }
    } finally {
      setBusy("");
    }
  };

  const refreshRequirementConversation = async () => {
    const conversation = requirementConversation;
    if (!conversation || busy) return;
    const ownerId = user?.id || "";
    setBusy("requirement-message-recovery");
    try {
      const latest = await procurementWorkspaceApi.getConversation(conversation.conversation_id);
      if (userIdRef.current !== ownerId) return;
      setRequirementConversation(latest);
      setNewRequestDraft(latest.draft);
      setRequirementMessage("");
      setRequirementMessageRecoveryRequired(false);
      setError("Conversation history refreshed. Review it before sending another message.");
    } catch (recoveryError) {
      setError(`The conversation is still unconfirmed. Do not resend the message until refresh succeeds. ${errorText(recoveryError)}`);
    } finally {
      setBusy("");
    }
  };

  const findRequestForConversation = useCallback(async (conversationId: string) => {
    let cursor: string | null = null;
    while (true) {
      const page = await procurementWorkspaceApi.listRequests(cursor);
      const saved = page.items.find((item) => item.origin_conversation_id === conversationId);
      if (saved) return saved;
      if (!page.has_more) return null;
      if (!page.next_cursor) {
        throw new Error("Saved requirement pagination did not return a continuation cursor.");
      }
      cursor = page.next_cursor;
    }
  }, []);

  const completeRequirementSave = useCallback((saved: ProcurementMaterialRequest) => {
    let cleanupWarning = "";
    if (user?.id && saved.origin_conversation_id) {
      try {
        localStorage.removeItem(`gleska:procurement:material-request:create:${user.id}`);
        localStorage.removeItem(`gleska:procurement:save:${saved.origin_conversation_id}`);
      } catch {
        cleanupWarning = "The requirement was saved, but its local recovery marker could not be cleared. It will remain scoped to this account.";
      }
    }
    setRequests((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
    setRequirementView("saved");
    setRequirementConversation(null);
    setManualRequirementConfirmed(false);
    setRequirementMessage("");
    setRequirementMessageRecoveryRequired(false);
    setRequirementSaveLocked(false);
    setSuccess(`“${saved.title || saved.item_name}” was saved successfully.`);
    if (cleanupWarning) setError(cleanupWarning);
  }, [user?.id]);

  useEffect(() => {
    const ownerId = user?.id || "";
    if (requirementOwnerRef.current !== ownerId) {
      requirementOwnerRef.current = ownerId;
      requirementSaveLockRef.current = false;
    }
    if (!ownerId || section !== "requirements") {
      if (!ownerId) {
        setRequirementConversation(null);
        setNewRequestDraft(emptyDraft());
        setRequirementSaveLocked(false);
        setRequirementMessage("");
        setRequirementMessageRecoveryRequired(false);
        setManualRequirementConfirmed(false);
        setRequirementRecoveryLoading(false);
      }
      return;
    }

    let current = true;
    setRequirementRecoveryLoading(true);
    setRequirementConversation(null);
    setNewRequestDraft(emptyDraft());
    setRequirementSaveLocked(false);
    setRequirementMessage("");
    setRequirementMessageRecoveryRequired(false);
    setManualRequirementConfirmed(false);
    setCreationMode("ai");
    setRequirementView(requestedRequirementView === "create" ? "create" : "saved");

    void (async () => {
      try {
        const storageKey = `gleska:procurement:material-request:create:${ownerId}`;
        const conversationId = localStorage.getItem(storageKey);
        if (!conversationId) {
          if (requestedRequirementView !== "create") return;
          const conversation = await procurementWorkspaceApi.createConversation();
          if (!current || userIdRef.current !== ownerId) return;
          localStorage.setItem(storageKey, conversation.conversation_id);
          setRequirementConversation(conversation);
          setNewRequestDraft(conversation.draft);
          setRequirementView("create");
          return;
        }

        const [conversation, saved] = await Promise.all([
          procurementWorkspaceApi.getConversation(conversationId),
          findRequestForConversation(conversationId),
        ]);
        if (!current || userIdRef.current !== ownerId) return;
        if (saved) {
          completeRequirementSave(saved);
          return;
        }

        setRequirementConversation(conversation);
        setNewRequestDraft(conversation.draft);
        const hasPendingSaveKey = Boolean(localStorage.getItem(
          `gleska:procurement:save:${conversationId}`,
        ));
        setRequirementSaveLocked(hasPendingSaveKey || conversation.status === "COMPLETED");
        setRequirementView("create");
        setError(conversation.status === "ACTIVE"
          ? "Resumed your saved requirement draft."
          : "A previous requirement save is unresolved. Keep this draft open and retry recovery before creating another requirement.");
      } catch (recoveryError) {
        if (current && userIdRef.current === ownerId) {
          setError(`Could not recover the saved requirement draft. It remains associated with this account; retry loading before creating another. ${errorText(recoveryError)}`);
        }
      } finally {
        if (current && userIdRef.current === ownerId) setRequirementRecoveryLoading(false);
      }
    })();

    return () => { current = false; };
  }, [
    completeRequirementSave,
    findRequestForConversation,
    requestedRequirementView,
    requirementRecoveryRetry,
    section,
    user?.id,
  ]);

  const recoverRequirementSave = async () => {
    const conversation = requirementConversation;
    if (!conversation || busy) return;
    const ownerId = user?.id || "";
    setBusy("requirement-recovery");
    setError("");
    try {
      const [latestConversation, saved] = await Promise.all([
        procurementWorkspaceApi.getConversation(conversation.conversation_id),
        findRequestForConversation(conversation.conversation_id),
      ]);
      if (userIdRef.current !== ownerId) return;
      if (saved) {
        completeRequirementSave(saved);
      } else {
        setRequirementConversation(latestConversation);
        setNewRequestDraft(latestConversation.draft);
        setRequirementSaveLocked(true);
        setError(latestConversation.status === "ACTIVE"
          ? "No saved requirement was found. Retry saving the unchanged details with the original key."
          : "The conversation is complete but no saved requirement was found. Keep this attempt unresolved and contact support.");
      }
    } catch (recoveryError) {
      if (userIdRef.current !== ownerId) return;
      setRequirementSaveLocked(true);
      setError(`The save outcome remains unknown. The original conversation and retry key are preserved. ${errorText(recoveryError)}`);
    } finally {
      setBusy("");
    }
  };

  const saveNewRequirement = async (event?: FormEvent) => {
    event?.preventDefault();
    const conversation = requirementConversation;
    if (!conversation || conversation.status !== "ACTIVE" || busy || requirementSaveLockRef.current) return;
    const ownerId = user?.id || "";
    if (creationMode === "manual" && !manualRequirementConfirmed) {
      setError("Confirm the requirement details before saving.");
      return;
    }
    const itemName = String(newRequestDraft.item_name || "").trim();
    const quantity = newRequestDraft.quantity;
    const quantityNumber = Number(quantity);
    const unit = String(newRequestDraft.unit || "").trim();
    if (!itemName || quantity === null || quantity === "" || !Number.isFinite(quantityNumber) || quantityNumber <= 0 || quantityNumber > 1_000_000_000 || !unit) {
      setError("Enter a material name, a quantity greater than zero and no more than 1,000,000,000, and a unit.");
      return;
    }
    const additionalRequirements = newRequestDraft.additional_requirements
      .map((value) => value.trim())
      .filter(Boolean);
    if (additionalRequirements.length > 50) {
      setError("A requirement can include at most 50 additional requirement lines.");
      return;
    }

    requirementSaveLockRef.current = true;
    setBusy("requirement-save");
    setError("");
    setSuccess("");
    let saveAttempted = false;
    try {
      const draft: MaterialRequestDraft = {
        title: String(newRequestDraft.title || "").trim() || null,
        item_name: itemName,
        specification: String(newRequestDraft.specification || "").trim() || null,
        quantity,
        unit,
        required_by: newRequestDraft.required_by || null,
        delivery_location: String(newRequestDraft.delivery_location || "").trim() || null,
        additional_requirements: additionalRequirements,
        notes: String(newRequestDraft.notes || "").trim() || null,
      };
      const draftFields = [
        "title",
        "item_name",
        "specification",
        "quantity",
        "unit",
        "required_by",
        "delivery_location",
        "additional_requirements",
        "notes",
      ] as const;
      const isEmptyDraftValue = (value: MaterialRequestDraft[keyof MaterialRequestDraft]) =>
        value === null || value === "" || (Array.isArray(value) && value.length === 0);
      const confirmedFields = draftFields.filter((field) => {
        const value = draft[field];
        return !isEmptyDraftValue(value);
      });
      const clearedFields = draftFields.filter((field) =>
        isEmptyDraftValue(draft[field]) && !isEmptyDraftValue(conversation.draft[field]),
      );
      const needsDraftUpdate = canonicalRequirementDraft(draft) !== canonicalRequirementDraft(conversation.draft)
        || [...confirmedFields].sort().join("|") !== [...conversation.confirmed_fields].sort().join("|")
        || [...clearedFields].sort().join("|") !== [...conversation.cleared_fields].sort().join("|");
      const updatedConversation = needsDraftUpdate
        ? await procurementWorkspaceApi.updateConversationDraft(
          conversation.conversation_id,
          draft,
          confirmedFields,
          conversation.revision,
          clearedFields,
        )
        : conversation;
      if (userIdRef.current !== ownerId) return;
      setRequirementConversation(updatedConversation);
      setNewRequestDraft(updatedConversation.draft);

      const storageKey = `gleska:procurement:save:${conversation.conversation_id}`;
      let idempotencyKey: string;
      try {
        const existingKey = localStorage.getItem(storageKey);
        if (existingKey && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existingKey)) {
          idempotencyKey = existingKey;
        } else if (existingKey) {
          setRequirementSaveLocked(true);
          throw new Error("The saved retry key is malformed. Keep this conversation open and contact support before retrying.");
        } else {
          idempotencyKey = crypto.randomUUID();
          localStorage.setItem(storageKey, idempotencyKey);
        }
      } catch (storageError) {
        throw new Error(`A safe save-retry key could not be stored: ${errorText(storageError)}`);
      }

      saveAttempted = true;
      setRequirementSaveLocked(true);
      const saved = await procurementWorkspaceApi.saveConversationRequest(
        conversation.conversation_id,
        updatedConversation.revision,
        idempotencyKey,
      );
      if (userIdRef.current !== ownerId) return;
      completeRequirementSave(saved);
    } catch (saveError) {
      if (userIdRef.current !== ownerId) return;
      if (!saveAttempted) {
        setError(errorText(saveError));
      } else {
        try {
          const [latestConversation, saved] = await Promise.all([
            procurementWorkspaceApi.getConversation(conversation.conversation_id),
            findRequestForConversation(conversation.conversation_id),
          ]);
          if (saved) {
            completeRequirementSave(saved);
            return;
          }
          setRequirementConversation(latestConversation);
          setNewRequestDraft(latestConversation.draft);
          setRequirementSaveLocked(true);
          if (latestConversation.status === "ACTIVE") {
            setError(`No saved requirement was found. The conversation and retry key are preserved; retry the unchanged details. ${errorText(saveError)}`);
          } else {
            setError(`The conversation is complete, but its saved requirement could not be recovered. Do not start another save; refresh Requirements or contact support. ${errorText(saveError)}`);
          }
        } catch (recoveryError) {
          setError(`The save outcome is unknown. Keep this conversation open and retry recovery before creating another requirement. ${errorText(recoveryError)}`);
        }
      }
    } finally {
      requirementSaveLockRef.current = false;
      setBusy("");
    }
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!settingsDraft) return;
    await runAction("settings", async () => {
      const updated = await procurementWorkspaceApi.updateSettings(settingsDraft);
      setSettings(updated);
      setSettingsDraft({
        default_delivery_location: updated.default_delivery_location,
        preferred_units: updated.preferred_units,
        specification_match_policy: updated.specification_match_policy,
        delivery_coverage_policy: updated.delivery_coverage_policy,
      });
    }, "Procurement settings saved.");
  };

  const reviewRfq = (event: FormEvent) => {
    event.preventDefault();
    if (!rfqRecoveryLoaded || rfqRecoveryError || orphanedRfqAttemptKeys.length || pendingRfqRecovery) {
      setError("Resolve the pending RFQ attempt before reviewing another RFQ.");
      return;
    }
    const request = requests.find((item) => item.id === rfqRequestId);
    const location = normalizeBackendWhitespace(
      request?.delivery_location?.trim() || rfqDeliveryLocation,
    );
    if (!request) {
      setError("Select a saved material requirement before reviewing the RFQ.");
      return;
    }
    if (!location || location.length > 500) {
      setError("Enter a delivery location of 1 to 500 characters before reviewing the RFQ.");
      return;
    }
    if (!rfqDeadlineValid) {
      setError("Choose a future quotation deadline before reviewing the RFQ.");
      return;
    }
    if (!rfqDiscovery || selectedSupplierIds.length === 0) {
      setError("Load eligible suppliers and select at least one supplier before reviewing the RFQ.");
      return;
    }
    setError("");
    setSuccess("");
    setRfqDeliveryLocation(location);
    setRfqNotes(normalizeBackendWhitespace(rfqNotes));
    setRfqReview(true);
  };

  const createRfq = async () => {
    if (rfqSubmissionLockRef.current || busy === "create-rfq" || busy === "checking-rfq") return;
    if (!rfqRecoveryLoaded || rfqRecoveryError || orphanedRfqAttemptKeys.length || !user?.id || !rfqRecoveryStorageKey) {
      setError("RFQ recovery is not ready. Do not start another RFQ until recovery storage is available.");
      return;
    }
    const ownerId = user.id;
    const ownerStorageKey = rfqRecoveryStorageKey;
    const pending = pendingRfqRecovery;
    const request = pending
      ? null
      : requests.find((item) => item.id === rfqRequestId) || null;
    if (!pending && (!request || !rfqDeadlineValid || selectedSupplierIds.length === 0)) {
      setError("The RFQ details are incomplete or invalid. Return to editing and correct them before submitting.");
      setRfqReview(false);
      return;
    }

    rfqSubmissionLockRef.current = true;
    setBusy("checking-rfq");
    setError("");
    setSuccess("");
    let requestSent = false;
    try {
      let attempt = pending;
      let recoveredRfq: ProcurementRFQ | null = null;
      let pendingStatus: "PENDING" | "NOT_FOUND" | null = null;
      if (attempt) {
        const recovery = await procurementWorkspaceApi.recoverRfqAttempt(attempt.key);
        if (userIdRef.current !== ownerId) return;
        if (recovery.status === "SUCCEEDED" && recovery.rfq) {
          recoveredRfq = recovery.rfq;
          try {
            localStorage.removeItem(ownerStorageKey);
          } catch {
            setRfqStorageNotice("The RFQ was confirmed as created, but its local recovery record could not be cleared. Any retry remains tied to the same key.");
          }
          setPendingRfqRecovery(null);
          setRfqs((current) => [recoveredRfq!, ...current.filter((item) => item.id !== recoveredRfq!.id)]);
          setSuccess("The existing RFQ was recovered; no duplicate was created.");
          setRfqReview(false);
          await load();
          return;
        }
        if (recovery.status === "SUCCEEDED") {
          setError("The server reports that this RFQ succeeded but did not return its RFQ record. The saved key remains preserved; retry the recovery check.");
          return;
        }
        if (recovery.status === "NOT_CREATED") {
          try {
            localStorage.removeItem(ownerStorageKey);
          } catch {
            setRfqRecoveryError("The server confirmed this attempt was not created, but local recovery storage could not be cleared. Resolve storage before starting a new RFQ.");
            return;
          }
          setPendingRfqRecovery(null);
          setRfqStorageNotice(`The server confirmed that this RFQ was not created${recovery.error_code ? ` (${recovery.error_code})` : ""}. Review the requirement and submit a new RFQ if needed.`);
          setRfqReview(false);
          return;
        }
        pendingStatus = recovery.status === "NOT_FOUND" ? "NOT_FOUND" : "PENDING";
      }

      if (!attempt) {
        const unresolved = await procurementWorkspaceApi.listPendingRfqAttempts();
        if (userIdRef.current !== ownerId) return;
        if (unresolved.items.length > 0 || unresolved.has_more) {
          setOrphanedRfqAttemptKeys(unresolved.items.map((item) => item.idempotency_key));
          setRfqRecoveryError("Another unresolved RFQ attempt exists for this employer. Recover it before creating a new RFQ.");
          return;
        }
        const latestRequest = await procurementWorkspaceApi.getRequest(request!.id);
        if (userIdRef.current !== ownerId) return;
        if (latestRequest.revision !== request!.revision) {
          setRequests((current) => current.map((item) =>
            item.id === latestRequest.id ? latestRequest : item,
          ));
          setRfqDiscovery(null);
          setSelectedSupplierIds([]);
          setRfqReview(false);
          setError("The saved requirement changed after review. Review the refreshed details and reload eligible suppliers before creating the RFQ.");
          return;
        }
        const location = normalizeBackendWhitespace(
          latestRequest.delivery_location?.trim() || rfqDeliveryLocation,
        );
        if (!location || location.length > 500) {
          setError("Enter a delivery location of 1 to 500 characters before submitting the RFQ.");
          setRfqReview(false);
          return;
        }
        const payload: RFQSubmissionPayload = {
          material_request_id: latestRequest.id,
          supplier_company_ids: [...new Set(selectedSupplierIds)].sort(),
          delivery_location: location,
          quotation_deadline: new Date(rfqDeadline).toISOString(),
          buyer_notes: normalizeBackendWhitespace(rfqNotes) || null,
        };
        attempt = {
          key: crypto.randomUUID(),
          signature: rfqSubmissionSignature(payload),
          payload,
          requestRevision: latestRequest.revision,
          requestSnapshot: {
            title: latestRequest.title,
            item_name: latestRequest.item_name,
            specification: latestRequest.specification,
            quantity: latestRequest.quantity,
            unit: latestRequest.unit,
          },
        };
        try {
          localStorage.setItem(ownerStorageKey, JSON.stringify(attempt));
        } catch {
          setError("The pending RFQ could not be saved for safe recovery, so it was not submitted. Check browser storage and try again.");
          return;
        }
        setPendingRfqRecovery(attempt);
      } else if (pendingStatus === "NOT_FOUND") {
        const latestRequest = await procurementWorkspaceApi.getRequest(attempt.payload.material_request_id);
        if (userIdRef.current !== ownerId) return;
        if (latestRequest.revision !== attempt.requestRevision) {
          setRequests((current) => current.map((item) =>
            item.id === latestRequest.id ? latestRequest : item,
          ));
          setError("The server has not registered this attempt, but its saved requirement has changed. The original key and payload remain preserved; do not start another RFQ until the original outcome is resolved.");
          return;
        }
      }

      const unresolved = await procurementWorkspaceApi.listPendingRfqAttempts();
      if (userIdRef.current !== ownerId) return;
      const otherPendingKeys = unresolved.items
        .map((item) => item.idempotency_key)
        .filter((key) => key !== attempt.key);
      if (otherPendingKeys.length || unresolved.has_more) {
        setOrphanedRfqAttemptKeys(otherPendingKeys);
        setRfqRecoveryError("Another unresolved RFQ attempt exists for this employer. Recover it before submitting this RFQ.");
        return;
      }

      if (userIdRef.current !== ownerId) return;
      setBusy("create-rfq");
      requestSent = true;
      const created = await procurementWorkspaceApi.createRfq({
        ...attempt.payload,
        idempotency_key: attempt.key,
      });
      try {
        localStorage.removeItem(ownerStorageKey);
        setRfqStorageNotice("");
      } catch {
        setRfqStorageNotice("The RFQ was created, but its local recovery record could not be cleared. Any retry will use the same key.");
      }
      if (userIdRef.current !== ownerId) return;
      setPendingRfqRecovery(null);
      setRfqs((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setRfqReview(false);
      setRfqNotes("");
      setSelectedSupplierIds([]);
      setSuccess("RFQ sent to the selected suppliers.");
      await load();
    } catch (createError) {
      if (userIdRef.current !== ownerId) return;
      setError(requestSent
        ? `${errorText(createError)} The RFQ outcome may be unknown. The exact payload and idempotency key are preserved; retry this attempt instead of starting a new RFQ.`
        : pending
          ? `${errorText(createError)} The unresolved attempt and its idempotency key remain saved. Retry when the requirement can be checked.`
          : errorText(createError));
    } finally {
      rfqSubmissionLockRef.current = false;
      setBusy("");
    }
  };

  const resetRfqDraft = () => {
    if (rfqSubmissionLockRef.current || busy === "checking-rfq" || busy === "create-rfq") {
      setError("Wait for the RFQ request to finish before changing or resetting this draft.");
      return;
    }
    if (pendingRfqRecovery) {
      setError("This RFQ attempt may already have succeeded. Retry it or check the RFQ list below; a new attempt cannot replace its saved key.");
      return;
    }
    rfqLocationTouchedRef.current = false;
    setRfqRequestId("");
    setRfqDiscovery(null);
    setSelectedSupplierIds([]);
    setRfqDeliveryLocation("");
    setRfqDeadline("");
    setRfqNotes("");
    setRfqReview(false);
    setError("");
    setSuccess("");
  };

  const retryRfqRecoveryCheck = () => {
    setRfqRecoveryError("");
    setRfqRecoveryLoaded(false);
    setRfqRecoveryCheckNonce((value) => value + 1);
  };

  const setSelectedSupplier = (companyId: string) => {
    setSelectedSupplierIds((current) =>
      current.includes(companyId)
        ? current.filter((id) => id !== companyId)
        : [...current, companyId],
    );
  };

  const renderAlert = () => (
    <>
      {error && <div className="procurement-workspace-alert is-error" role="alert"><AlertCircle size={17} /><span>{error}</span><button type="button" onClick={() => { void load(); if (section === "requirements") setRequirementRecoveryRetry((value) => value + 1); }}>Retry</button></div>}
      {success && <div className="procurement-workspace-alert is-success" role="status"><Check size={17} /><span>{success}</span></div>}
    </>
  );

  const renderRequestCard = (request: ProcurementMaterialRequest) => (
    <article className="procurement-workspace-card" key={request.id}>
      {editingRequestId === request.id ? (
        <form className="procurement-workspace-form" onSubmit={(event) => void saveRequest(event)}>
          <label>Title<input value={String(requestDraft.title || "")} onChange={(event) => setRequestDraft({ ...requestDraft, title: event.target.value })} /></label>
          <label>Item name<input required value={String(requestDraft.item_name || "")} onChange={(event) => setRequestDraft({ ...requestDraft, item_name: event.target.value })} /></label>
          <label>Specification<textarea value={String(requestDraft.specification || "")} onChange={(event) => setRequestDraft({ ...requestDraft, specification: event.target.value })} /></label>
          <div className="procurement-workspace-inline">
            <label>Quantity<input required type="number" min="0.0001" step="any" value={String(requestDraft.quantity || "")} onChange={(event) => setRequestDraft({ ...requestDraft, quantity: event.target.value })} /></label>
            <label>Unit<input required value={String(requestDraft.unit || "")} onChange={(event) => setRequestDraft({ ...requestDraft, unit: event.target.value })} /></label>
          </div>
          <label>Required by<input type="date" value={String(requestDraft.required_by || "")} onChange={(event) => setRequestDraft({ ...requestDraft, required_by: event.target.value })} /></label>
          <label>Delivery location<input value={String(requestDraft.delivery_location || "")} onChange={(event) => setRequestDraft({ ...requestDraft, delivery_location: event.target.value })} /></label>
          <label>Additional requirements (one per line)<textarea value={requestDraft.additional_requirements.join("\n")} onChange={(event) => setRequestDraft({ ...requestDraft, additional_requirements: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) })} /></label>
          <label>Notes<textarea value={String(requestDraft.notes || "")} onChange={(event) => setRequestDraft({ ...requestDraft, notes: event.target.value })} /></label>
          <div className="procurement-workspace-actions">
            <button className="procurement-workspace-primary" type="submit" disabled={busy === "save-request"}><Save size={16} />{busy === "save-request" ? "Saving…" : "Save changes"}</button>
            <button className="procurement-workspace-secondary" type="button" onClick={() => setEditingRequestId("")}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <div className="procurement-workspace-card-head">
            <div><h3>{request.title || request.item_name}</h3><p>{request.item_name} · {request.quantity} {request.unit}</p></div>
            <span className="procurement-workspace-status">{request.status}</span>
          </div>
          <p className="procurement-workspace-card-meta">
            Saved {new Date(request.created_at).toLocaleDateString()}
            {request.delivery_location ? ` · ${request.delivery_location}` : ""}
          </p>
          {request.specification && <p className="procurement-workspace-description">{request.specification}</p>}
          <dl className="procurement-workspace-facts">
            {request.required_by && <div><dt>Required by</dt><dd>{request.required_by}</dd></div>}
            {request.delivery_location && <div><dt>Delivery</dt><dd>{request.delivery_location}</dd></div>}
            {request.additional_requirements.length > 0 && <div><dt>Additional requirements</dt><dd>{request.additional_requirements.join(" · ")}</dd></div>}
            {request.notes && <div><dt>Notes</dt><dd>{request.notes}</dd></div>}
          </dl>
          <div className="procurement-workspace-actions">
            <button className="procurement-workspace-secondary" type="button" onClick={() => { setEditingRequestId(request.id); setRequestDraft(emptyDraft(request)); }}><Save size={15} />Edit</button>
            {section === "get" && <button className="procurement-workspace-primary" type="button" onClick={() => { setSelectedRequestId(request.id); void discover(request.id, discoveryLocation); }} disabled={busy === "discovery"}><PackageSearch size={15} />Find suppliers</button>}
            <button className="procurement-workspace-danger" type="button" onClick={() => void deleteRequest(request)} disabled={busy === `delete-${request.id}`}><Trash2 size={15} />Delete</button>
          </div>
        </>
      )}
    </article>
  );

  const renderPageControls = () => (
    <div className="procurement-workspace-pagination">
      <button type="button" className="procurement-workspace-secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
      <span>Page {page}</span>
      <button type="button" className="procurement-workspace-secondary" disabled={!hasMore || loading || (section !== "orders" && section !== "rfqs" && !nextRequestCursor)} onClick={() => {
        if (section !== "orders" && section !== "rfqs") {
          setRequestCursors((cursors) => [...cursors.slice(0, page), nextRequestCursor]);
        }
        setPage((value) => value + 1);
      }}>Next</button>
    </div>
  );

  if (loading) {
    return <main className="procurement-workspace"><div className="procurement-workspace-state" role="status"><LoaderCircle className="procurement-agent-spin" size={21} />Loading {sectionTitles[section].toLowerCase()}…</div></main>;
  }

  return (
    <main className="procurement-workspace">
      <header className="procurement-workspace-heading">
        <div><p className="procurement-agent-eyebrow">Procurement</p><h1>{sectionTitles[section]}</h1></div>
        <button className="procurement-workspace-icon-button" type="button" onClick={() => void load()} aria-label="Refresh section" disabled={loading}><RefreshCw size={18} /></button>
      </header>
      {renderAlert()}

      {(section === "requirements" || section === "get") && (
        <>
          {section === "get" && (
            <section className="procurement-workspace-panel">
              <h2>Discover supplier offerings</h2>
              <p>Select a saved requirement to compare with active eligible listings. Discovery does not contact suppliers or create an RFQ.</p>
              <div className="procurement-workspace-inline">
                <label>Saved requirement<select value={selectedRequestId} onChange={(event) => { discoverySequence.current += 1; setBusy(""); setSelectedRequestId(event.target.value); setDiscovery(null); }}><option value="">Select a requirement</option>{requests.map((item) => <option key={item.id} value={item.id}>{item.title || item.item_name} · {item.quantity} {item.unit}</option>)}</select></label>
                <label><span className="procurement-workspace-label-icon"><MapPin size={14} /> Delivery location (optional)</span><input value={discoveryLocation} onChange={(event) => setDiscoveryLocation(event.target.value)} placeholder="Use saved location" /></label>
              </div>
              <button className="procurement-workspace-primary" type="button" disabled={!selectedRequestId || busy === "discovery"} onClick={() => void discover(selectedRequestId, discoveryLocation)}><Search size={16} />{busy === "discovery" ? "Searching…" : "Search eligible suppliers"}</button>
              {discovery && (
                <div className="procurement-workspace-results">
                  <h3>{discovery.matches.length} supplier match{discovery.matches.length === 1 ? "" : "es"}</h3>
                  {discovery.matches.length === 0 ? <p className="procurement-workspace-empty">No eligible offerings matched this requirement.</p> : discovery.matches.map((match) => (
                    <article className="procurement-workspace-match" key={`${match.supplier_company_id}-${match.offering_id}`}>
                      <div><strong>{match.name}</strong><span>{match.supplier_name} · {match.unit}</span></div>
                      <p>{match.specification || "No specification listed"}</p>
                      <div className="procurement-workspace-match-meta">
                        <span>{match.indicative_price == null ? "Price not listed" : `${match.currency_code || ""} ${match.indicative_price} / ${match.unit}`}</span>
                        <span>{match.specification_match.replaceAll("_", " ").toLowerCase()} match</span>
                      </div>
                      {match.service_coverage.length > 0 && <small>Coverage: {match.service_coverage.join(", ")}</small>}
                    </article>
                  ))}
                  <p className="procurement-workspace-note">Indicative catalogue prices are not quotations. No supplier was contacted.</p>
                </div>
              )}
            </section>
          )}
          {section === "requirements" && (
            requirementView === "create" ? (
              <>
                <section className="procurement-workspace-panel">
                  <div className="procurement-workspace-panel-heading">
                    <div><h2>{creationMode === "ai" ? "Create with Agent" : "Enter Details Manually"}</h2><p>{creationMode === "ai" ? "Describe your requirement and review the live draft before saving." : "Enter and confirm the material details before saving."}</p></div>
                    <button className="procurement-workspace-secondary" type="button" onClick={() => setRequirementView("saved")}>Saved requirements</button>
                  </div>
                </section>

                {creationMode === "ai" ? (
                  <div className="procurement-requirement-ai-grid">
                    <section className="procurement-requirement-assistant" aria-label="Procurement Agent conversation">
                      <header>
                        <span className="procurement-requirement-icon"><Sparkles size={16} /></span>
                        <div className="procurement-requirement-assistant-title">
                          <strong>AI Assistant</strong>
                          <small>Ask about procurement, requirements, supplier matches, RFQs, or quotations</small>
                        </div>
                        <span className={`procurement-requirement-status${requirementConversation?.status === "ACTIVE" ? " is-active" : ""}`}>
                          <i />{requirementConversation?.status === "ACTIVE" ? "Active" : "Not started"}
                        </span>
                      </header>
                      <div className="procurement-requirement-messages" aria-live="polite">
                        {requirementConversation?.history.length ? requirementConversation.history.map((entry, index) => (
                          <article className={`procurement-requirement-message is-${entry.role}`} key={entry.message_id ?? `${entry.created_at}-${index}`}>
                            <p>{entry.content}</p>
                            <time>{new Date(entry.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                          </article>
                        )) : (
                          <div className="procurement-requirement-empty-chat">
                            <span><Sparkles size={18} /></span>
                            <strong>What can I help you with in procurement?</strong>
                            <p>Ask a general question, describe a material requirement, find current supplier offerings for a saved requirement, or review your RFQs, quotations, and purchase orders.</p>
                          </div>
                        )}
                        {busy === "requirement-message" && <div className="procurement-requirement-thinking"><LoaderCircle size={15} className="procurement-agent-spin" />Assistant is preparing a response…</div>}
                      </div>
                      <form className="procurement-requirement-composer" onSubmit={(event) => void sendRequirementMessage(event)}>
                        <input value={requirementMessage} onChange={(event) => setRequirementMessage(event.target.value)} maxLength={4000} placeholder="Ask about procurement, describe a requirement…" disabled={requirementFieldsDisabled || requirementMessageRecoveryRequired} />
                        <button type="submit" disabled={!requirementMessage.trim() || requirementFieldsDisabled || requirementMessageRecoveryRequired} aria-label="Send message">{busy === "requirement-message" ? <LoaderCircle className="procurement-agent-spin" size={16} /> : <ArrowRight size={16} />}</button>
                      </form>
                      {requirementMessageRecoveryRequired && <button className="procurement-workspace-secondary" type="button" onClick={() => void refreshRequirementConversation()} disabled={Boolean(busy)}>Refresh conversation status</button>}
                    </section>

                    <aside className="procurement-requirement-draft">
                      <header>
                        <span className="procurement-requirement-icon"><Package size={16} /></span>
                        <div className="procurement-requirement-draft-title"><strong>Material Request Draft</strong><small>Live extracted requirements</small></div>
                        {newRequestDraft.item_name?.trim() && Number.isFinite(Number(newRequestDraft.quantity)) && Number(newRequestDraft.quantity) > 0 && Number(newRequestDraft.quantity) <= 1_000_000_000 && newRequestDraft.unit?.trim()
                          ? <span className="procurement-requirement-count is-ready">Ready to save</span>
                          : <span className="procurement-requirement-count">{[newRequestDraft.item_name, newRequestDraft.quantity !== "" && newRequestDraft.quantity !== null ? String(newRequestDraft.quantity) : null, newRequestDraft.unit].filter(Boolean).length}/3 required details</span>}
                        <button type="button" className="procurement-requirement-expand" onClick={() => setRequirementDraftExpanded((value) => !value)} aria-label="Toggle details summary">
                          {requirementDraftExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </header>
                      <div className={`procurement-requirement-draft-rows${requirementDraftExpanded ? " is-expanded" : ""}`}>
                        {([
                          { label: "Request title", value: newRequestDraft.title, field: "title", icon: FileText },
                          { label: "Material name", value: newRequestDraft.item_name, field: "item_name", icon: Package, required: true },
                          { label: "Quantity", value: newRequestDraft.quantity == null || newRequestDraft.quantity === "" ? null : String(newRequestDraft.quantity), field: "quantity", icon: Hash, required: true },
                          { label: "Unit of measure", value: newRequestDraft.unit, field: "unit", icon: Hash, required: true },
                          { label: "Specification / grade", value: newRequestDraft.specification, field: "specification", icon: FileText },
                          { label: "Required by date", value: newRequestDraft.required_by, field: "required_by", icon: CalendarDays },
                          { label: "Delivery location", value: newRequestDraft.delivery_location, field: "delivery_location", icon: MapPin },
                          { label: "Notes", value: newRequestDraft.notes, field: "notes", icon: FileText },
                        ] as const).map((item) => {
                          const confirmed = requirementConversation?.confirmed_fields.includes(item.field) ?? false;
                          const value = item.field === "required_by" && item.value
                            ? new Date(`${item.value.slice(0, 10)}T00:00:00`).toLocaleDateString()
                            : item.value;
                          return (
                            <div className="procurement-requirement-draft-row" key={item.field}>
                              <span><item.icon size={14} />{item.label}{"required" in item && item.required && <b>*</b>}</span>
                              <span className={value ? "has-value" : "is-empty"}>{value || "Not specified yet"}<small>{confirmed ? "Confirmed" : value ? "Draft suggestion · review before saving" : "Not specified"}</small></span>
                            </div>
                          );
                        })}
                        <div className="procurement-requirement-additional">
                          <span><ListFilter size={14} />Additional requirements</span>
                          {newRequestDraft.additional_requirements.length
                            ? <><div>{newRequestDraft.additional_requirements.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div><small>{requirementConversation?.confirmed_fields.includes("additional_requirements") ? "Confirmed" : "Draft suggestion · review before saving"}</small></>
                            : <small>Not specified</small>}
                        </div>
                      </div>
                      <div className="procurement-requirement-draft-actions">
                        <button type="button" className="is-primary" onClick={() => void saveNewRequirement()} disabled={!requirementConversation || requirementConversation.status !== "ACTIVE" || Boolean(busy) || !newRequestDraft.item_name?.trim() || !newRequestDraft.quantity || !newRequestDraft.unit?.trim()}>
                          {busy === "requirement-save" ? <LoaderCircle size={15} className="procurement-agent-spin" /> : <CheckCircle2 size={15} />}Confirm &amp; Save Request
                        </button>
                        <p>Required to save: material name, quantity, and unit</p>
                        <button type="button" className="is-secondary" onClick={() => setCreationMode("manual")} disabled={requirementSaveLocked}>Edit Details in Manual Form <ArrowRight size={14} /></button>
                      </div>
                    </aside>
                  </div>
                ) : (
                  <form className="procurement-workspace-panel procurement-workspace-form procurement-requirement-form" onSubmit={(event) => void saveNewRequirement(event)}>
                    <div className="procurement-requirement-form-heading"><div><h2>1. Material Details</h2><p>Enter and confirm the material requirement details.</p></div><span className={newRequestDraft.item_name?.trim() && newRequestDraft.quantity && newRequestDraft.unit?.trim() ? "is-ready" : ""}>{newRequestDraft.item_name?.trim() && newRequestDraft.quantity && newRequestDraft.unit?.trim() ? "Ready to save" : "Incomplete"}</span></div>
                    <label>Request title <small>(optional reference)</small><input disabled={requirementFieldsDisabled} maxLength={160} value={newRequestDraft.title || ""} onChange={(event) => { setNewRequestDraft({ ...newRequestDraft, title: event.target.value }); setManualRequirementConfirmed(false); }} placeholder="e.g. Steel Rebar for Foundation Block A" /></label>
                    <label>Material / item name *<input disabled={requirementFieldsDisabled} required maxLength={240} value={newRequestDraft.item_name || ""} onChange={(event) => { setNewRequestDraft({ ...newRequestDraft, item_name: event.target.value }); setManualRequirementConfirmed(false); }} placeholder="e.g. TMT Steel Bars, OPC Cement 53 Grade" /></label>
                    <div className="procurement-workspace-inline">
                      <label>Quantity *<input disabled={requirementFieldsDisabled} required type="number" min="0.000001" max="1000000000" step="any" value={newRequestDraft.quantity == null ? "" : String(newRequestDraft.quantity)} onChange={(event) => { setNewRequestDraft({ ...newRequestDraft, quantity: event.target.value }); setManualRequirementConfirmed(false); }} placeholder="e.g. 500" /></label>
                      <div className="procurement-requirement-unit-field"><label>Unit of measure *<input disabled={requirementFieldsDisabled} required maxLength={48} value={newRequestDraft.unit || ""} onChange={(event) => { setNewRequestDraft({ ...newRequestDraft, unit: event.target.value }); setManualRequirementConfirmed(false); }} placeholder="e.g. MT, Bags, Pieces, Kg" /></label><span className="procurement-requirement-unit-options">{[...new Set([...(settings?.preferred_units ?? []), ...units])].map((unit) => <button type="button" key={unit} onClick={() => { setNewRequestDraft({ ...newRequestDraft, unit }); setManualRequirementConfirmed(false); }} disabled={requirementFieldsDisabled} className={newRequestDraft.unit?.toLowerCase() === unit.toLowerCase() ? "is-selected" : ""}>{unit}</button>)}</span></div>
                    </div>
                    <label>Specification or grade<textarea disabled={requirementFieldsDisabled} maxLength={2000} value={newRequestDraft.specification || ""} onChange={(event) => { setNewRequestDraft({ ...newRequestDraft, specification: event.target.value }); setManualRequirementConfirmed(false); }} /></label>
                    <div className="procurement-workspace-inline">
                      <label>Required by<input disabled={requirementFieldsDisabled} type="date" value={newRequestDraft.required_by || ""} onChange={(event) => { setNewRequestDraft({ ...newRequestDraft, required_by: event.target.value }); setManualRequirementConfirmed(false); }} /></label>
                      <label>Delivery location<input disabled={requirementFieldsDisabled} maxLength={500} value={newRequestDraft.delivery_location || ""} onChange={(event) => { setNewRequestDraft({ ...newRequestDraft, delivery_location: event.target.value }); setManualRequirementConfirmed(false); }} /></label>
                    </div>
                    <label>Additional requirements (one per line)<textarea disabled={requirementFieldsDisabled} value={newRequestDraft.additional_requirements.join("\n")} onChange={(event) => { setNewRequestDraft({ ...newRequestDraft, additional_requirements: event.target.value.split(/\r?\n/) }); setManualRequirementConfirmed(false); }} /></label>
                    <label>Notes<textarea disabled={requirementFieldsDisabled} maxLength={4000} value={newRequestDraft.notes || ""} onChange={(event) => { setNewRequestDraft({ ...newRequestDraft, notes: event.target.value }); setManualRequirementConfirmed(false); }} /></label>
                    <label className="procurement-workspace-check"><input type="checkbox" disabled={requirementFieldsDisabled} checked={manualRequirementConfirmed} onChange={(event) => setManualRequirementConfirmed(event.target.checked)} /><span>I confirm these requirement details are accurate.</span></label>
                    <div className="procurement-workspace-actions">
                      <button className="procurement-workspace-primary" type="submit" disabled={Boolean(busy) || (!requirementSaveLocked && !manualRequirementConfirmed)}><CheckCircle2 size={16} />{busy === "requirement-save" ? "Saving…" : requirementSaveLocked ? "Retry Save" : "Confirm & Save Request"}</button>
                      <button className="procurement-workspace-secondary" type="button" onClick={() => setCreationMode("ai")} disabled={requirementSaveLocked}>Back to AI Assistant</button>
                    </div>
                  </form>
                )}
                {(requirementSaveLocked || requirementConversation?.status === "COMPLETED") && (
                  <section className="procurement-workspace-panel">
                    <p className="procurement-workspace-note is-error">A previous save may have completed. Keep this conversation and retry key until the result is confirmed.</p>
                    <button className="procurement-workspace-secondary" type="button" onClick={() => void recoverRequirementSave()} disabled={Boolean(busy)}>Check save status</button>
                  </section>
                )}
              </>
            ) : (
              <section className="procurement-workspace-panel">
                <div className="procurement-workspace-panel-heading">
                  <div className="procurement-workspace-requirements-title">
                    <div><h2>Saved requirements</h2><p>Edit saved records or begin a new Agent-assisted draft.</p></div>
                    <span>{requests.length}{hasMore ? " loaded" : " total"}</span>
                  </div>
                  <button className="procurement-workspace-primary" type="button" onClick={() => void openRequirementCreation("ai")} disabled={Boolean(busy) || requirementRecoveryLoading}><Plus size={16} />{requirementRecoveryLoading ? "Recovering draft…" : "Create with Agent"}</button>
                </div>
                {hasMore && <p className="procurement-workspace-note">Search currently covers the {requests.length} loaded requirements.</p>}
                <label className="procurement-workspace-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search saved requests…" /></label>
                {requests.length === 0
                  ? <p className="procurement-workspace-empty">No saved requests yet. Create one with the Procurement Agent.</p>
                  : visibleRequests.length > 0
                    ? visibleRequests.map(renderRequestCard)
                    : <p className="procurement-workspace-empty">{hasMore ? `No loaded requirements match “${search}”. Load more requirements to search further.` : `No requests matching “${search}”.`}</p>}
                {hasMore && renderPageControls()}
              </section>
            )
          )}
          {section === "get" && requests.length > 0 && (
            <section className="procurement-workspace-panel">
              <h2>Your saved requirements</h2>
              <div className="procurement-workspace-list">{requests.map((request) => (
                <button className={`procurement-workspace-request-choice${selectedRequestId === request.id ? " is-selected" : ""}`} type="button" key={request.id} onClick={() => { setSelectedRequestId(request.id); setDiscovery(null); }}><span>{request.title || request.item_name}</span><small>{request.quantity} {request.unit}</small></button>
              ))}</div>
            </section>
          )}
        </>
      )}

      {section === "details" && (
        <section className="procurement-workspace-panel">
          <h2>Saved requirement specifications</h2><p>These specifications come from your saved requirements.</p>
          {requests.length === 0 ? <p className="procurement-workspace-empty">No saved requirements are available.</p> : requests.map(renderRequestCard)}
          {hasMore && renderPageControls()}
        </section>
      )}

      {section === "settings" && settingsDraft && (
        <>
        <form className="procurement-workspace-panel procurement-workspace-form" onSubmit={(event) => void saveSettings(event)}>
          <h2>Procurement preferences</h2>
          <label>Default delivery location<input value={settingsDraft.default_delivery_location || ""} onChange={(event) => setSettingsDraft({ ...settingsDraft, default_delivery_location: event.target.value || null })} /></label>
          <fieldset><legend>Preferred purchasing units</legend><div className="procurement-workspace-unit-list">{units.map((unit) => <label key={unit}><input type="checkbox" checked={settingsDraft.preferred_units.includes(unit)} onChange={(event) => setSettingsDraft({ ...settingsDraft, preferred_units: event.target.checked ? [...new Set([...settingsDraft.preferred_units, unit])] : settingsDraft.preferred_units.filter((item) => item !== unit) })} />{unit}</label>)}</div></fieldset>
          <label>Specification matching<select value={settingsDraft.specification_match_policy} onChange={(event) => setSettingsDraft({ ...settingsDraft, specification_match_policy: event.target.value as ProcurementSettingsUpdate["specification_match_policy"] })}><option value="REVIEW_DIFFERENCES">Review specification differences</option><option value="REQUIRE_OVERLAP">Require overlapping specifications</option></select></label>
          <label>Delivery coverage<select value={settingsDraft.delivery_coverage_policy} onChange={(event) => setSettingsDraft({ ...settingsDraft, delivery_coverage_policy: event.target.value as ProcurementSettingsUpdate["delivery_coverage_policy"] })}><option value="ALLOW_UNSPECIFIED">Allow unspecified coverage</option><option value="REQUIRE_MATCH">Require delivery coverage match</option></select></label>
          <p className="procurement-workspace-note">Eligible matches always require active, verified supplier companies and available, non-archived offerings.</p>
          <button className="procurement-workspace-primary" type="submit" disabled={busy === "settings"}><Save size={16} />{busy === "settings" ? "Saving…" : "Save settings"}</button>
          {settings?.updated_at && <small>Last updated {new Date(settings.updated_at).toLocaleString()}</small>}
        </form>
        <DeleteAccountSection roleLabel="Buyer" />
        </>
      )}

      {section === "rfqs" && (
        <>
          {!rfqRecoveryLoaded ? (
            <section className="procurement-workspace-panel" role="status">
              <h2>Checking for an unresolved RFQ</h2>
              <p>Please wait while saved RFQ recovery is checked.</p>
            </section>
          ) : rfqRecoveryError ? (
            <section className="procurement-workspace-panel" role="alert">
              <h2>RFQ recovery needs attention</h2>
              <p className="procurement-workspace-note is-error">{rfqRecoveryError}</p>
              {orphanedRfqAttemptKeys.length > 0 && (
                <p className="procurement-workspace-note">
                  Unresolved attempt keys: {orphanedRfqAttemptKeys.join(", ")}
                </p>
              )}
              <button className="procurement-workspace-secondary" type="button" onClick={retryRfqRecoveryCheck}>
                <RefreshCw size={16} />Retry recovery check
              </button>
            </section>
          ) : pendingRfqRecovery ? (
            <section className="procurement-workspace-panel">
              <h2>Resolve pending RFQ attempt</h2>
              <p className="procurement-workspace-note is-error" role="alert">
                The previous request may have created this RFQ, but its response was not confirmed. A new attempt is blocked until this one is resolved.
              </p>
              <dl className="procurement-workspace-facts">
                <div><dt>Requirement</dt><dd>{pendingRfqRecovery.requestSnapshot.title || pendingRfqRecovery.requestSnapshot.item_name}</dd></div>
                <div><dt>Material</dt><dd>{pendingRfqRecovery.requestSnapshot.item_name}</dd></div>
                <div><dt>Quantity / unit</dt><dd>{pendingRfqRecovery.requestSnapshot.quantity} {pendingRfqRecovery.requestSnapshot.unit}</dd></div>
                <div><dt>Specification</dt><dd>{pendingRfqRecovery.requestSnapshot.specification || "Not specified"}</dd></div>
                <div><dt>Delivery location</dt><dd>{pendingRfqRecovery.payload.delivery_location}</dd></div>
                <div><dt>Quotation deadline</dt><dd>{new Date(pendingRfqRecovery.payload.quotation_deadline).toLocaleString()}</dd></div>
                <div className="is-wide"><dt>Supplier company IDs</dt><dd>{pendingRfqRecovery.payload.supplier_company_ids.join(", ")}</dd></div>
                {pendingRfqRecovery.payload.buyer_notes && <div className="is-wide"><dt>Buyer notes</dt><dd>{pendingRfqRecovery.payload.buyer_notes}</dd></div>}
              </dl>
              <p className="procurement-workspace-note">
                Retry sends the exact saved payload with its original idempotency key. The server will return the existing RFQ if that attempt succeeded and the saved requirement is unchanged. Check the RFQ list below if the requirement has since changed; do not create a second RFQ while the outcome is unknown.
              </p>
              <div className="procurement-workspace-actions">
                <button
                  className="procurement-workspace-primary"
                  type="button"
                  onClick={() => void createRfq()}
                  disabled={busy === "checking-rfq" || busy === "create-rfq"}
                >
                  {busy === "checking-rfq" || busy === "create-rfq"
                    ? <LoaderCircle size={16} className="procurement-agent-spin" />
                    : <RefreshCw size={16} />}
                  {busy === "checking-rfq"
                    ? "Checking saved requirement…"
                    : busy === "create-rfq"
                      ? "Retrying RFQ…"
                      : "Retry this RFQ safely"}
                </button>
              </div>
            </section>
          ) : (
          <section className="procurement-workspace-panel">
            <h2>Create an RFQ</h2>
            <p>Choose eligible suppliers to invite. Sending an RFQ shares the selected requirement with those companies.</p>
            {settings && <p className="procurement-workspace-note">Default delivery location: {settings.default_delivery_location || "Not set"}.</p>}
            {rfqSettingsError && <p className="procurement-workspace-note is-error" role="status">Procurement defaults could not be loaded: {rfqSettingsError} Enter a delivery location manually.</p>}
            <form className="procurement-workspace-form" onSubmit={(event) => void reviewRfq(event)}>
              {!rfqReview ? (
                <>
              <label>Saved requirement<select required value={rfqRequestId} onChange={(event) => void loadRfqDiscovery(event.target.value)}><option value="">Select a saved requirement</option>{requests.map((request) => <option key={request.id} value={request.id}>{request.title || request.item_name} · {request.quantity} {request.unit}</option>)}</select></label>
              <button className="procurement-workspace-secondary" type="button" disabled={!rfqRequestId || busy === "rfq-discovery"} onClick={() => void loadRfqDiscovery(rfqRequestId)}>{busy === "rfq-discovery" ? "Loading eligible suppliers…" : "Load eligible suppliers"}</button>
              {rfqDiscovery && <fieldset><legend>Choose suppliers ({selectedSupplierIds.length} selected)</legend>{rfqDiscovery.matches.length === 0 ? <p className="procurement-workspace-empty">No eligible suppliers match this saved requirement.</p> : <div className="procurement-workspace-supplier-list">{rfqDiscovery.matches.map((match) => <label key={match.supplier_company_id}><input type="checkbox" checked={selectedSupplierIds.includes(match.supplier_company_id)} onChange={() => setSelectedSupplier(match.supplier_company_id)} /><span><strong>{match.supplier_name}</strong><small>{match.name} · {match.specification_match.replaceAll("_", " ").toLowerCase()}</small></span></label>)}</div>}</fieldset>}
              <label>Delivery location<input required maxLength={500} value={selectedRfqRequest?.delivery_location?.trim() || rfqDeliveryLocation} readOnly={Boolean(selectedRfqRequest?.delivery_location?.trim())} aria-invalid={!effectiveRfqLocation || effectiveRfqLocation.length > 500} placeholder="Enter the RFQ delivery location" onChange={(event) => { rfqLocationTouchedRef.current = true; setRfqDeliveryLocation(event.target.value); }} /></label>
              {!effectiveRfqLocation && <p className="procurement-workspace-note is-error">Enter a delivery location before continuing.</p>}
              {!selectedRfqRequest?.delivery_location?.trim() && settings?.default_delivery_location?.trim() && <p className="procurement-workspace-note">Prefilled from Procurement Settings. You can change it for this RFQ.</p>}
              <label>Quotation deadline<input type="datetime-local" required min={new Date(Date.now() + 60000).toISOString().slice(0, 16)} value={rfqDeadline} onChange={(event) => setRfqDeadline(event.target.value)} /></label>
              {!rfqDeadlineValid && <p className="procurement-workspace-note is-error">Choose a future quotation deadline.</p>}
              <label>Buyer notes<textarea value={rfqNotes} maxLength={4000} onChange={(event) => setRfqNotes(event.target.value)} /></label>
              <div className="procurement-workspace-actions">
                <button className="procurement-workspace-primary" type="submit" disabled={!selectedRfqRequest || selectedSupplierIds.length === 0 || !effectiveRfqLocation || effectiveRfqLocation.length > 500 || !rfqDeadlineValid || busy === "create-rfq" || busy === "rfq-discovery"}><Plus size={16} />Review RFQ</button>
                <button className="procurement-workspace-secondary" type="button" onClick={resetRfqDraft} disabled={busy === "checking-rfq" || busy === "create-rfq"}>Start new RFQ</button>
              </div>
                </>
              ) : (
                <>
                  <div className="procurement-rfq-review">
                    <h3>Review before creating</h3>
                    <dl className="procurement-workspace-facts">
                      <div><dt>Requirement</dt><dd>{selectedRfqRequest?.title || selectedRfqRequest?.item_name}</dd></div>
                      <div><dt>Material</dt><dd>{selectedRfqRequest?.item_name}</dd></div>
                      <div><dt>Quantity / unit</dt><dd>{selectedRfqRequest?.quantity} {selectedRfqRequest?.unit}</dd></div>
                      <div><dt>Specification</dt><dd>{selectedRfqRequest?.specification || "Not specified"}</dd></div>
                      <div><dt>Delivery location</dt><dd>{effectiveRfqLocation}</dd></div>
                      <div><dt>Quotation deadline</dt><dd>{rfqDeadline ? new Date(rfqDeadline).toLocaleString() : "Not set"}</dd></div>
                      <div className="is-wide"><dt>Suppliers</dt><dd>{selectedRfqSupplierNames.join(", ") || "None selected"}</dd></div>
                      {normalizeBackendWhitespace(rfqNotes) && <div className="is-wide"><dt>Buyer notes</dt><dd>{normalizeBackendWhitespace(rfqNotes)}</dd></div>}
                    </dl>
                  </div>
                  <p className="procurement-workspace-note">Creating this RFQ shares the saved requirement with selected suppliers. Confirm only when these details are correct.</p>
                  <div className="procurement-workspace-actions">
                    <button className="procurement-workspace-secondary" type="button" onClick={() => setRfqReview(false)} disabled={busy === "create-rfq" || busy === "checking-rfq"}>Edit details</button>
                    <button className="procurement-workspace-primary" type="button" onClick={() => void createRfq()} disabled={busy === "create-rfq" || busy === "checking-rfq" || rfqSubmissionLockRef.current}>
                      {busy === "create-rfq" || busy === "checking-rfq" ? <LoaderCircle size={16} className="procurement-agent-spin" /> : <Check size={16} />}
                      {busy === "checking-rfq" ? "Checking requirement…" : busy === "create-rfq" ? "Creating RFQ…" : "Confirm & create RFQ"}
                    </button>
                  </div>
                </>
              )}
            </form>
          </section>
          )}
          {rfqStorageNotice && <p className="procurement-workspace-note is-error" role="status">{rfqStorageNotice}</p>}
          <section className="procurement-workspace-panel">
            <div className="procurement-workspace-panel-heading"><div><h2>Requests for Quote</h2><p>Compare supplier responses and quotations.</p></div>{renderPageControls()}</div>
            {rfqs.length === 0 ? <p className="procurement-workspace-empty">No RFQs are available yet.</p> : rfqs.map((rfq) => {
              const existingOrder = orders.find((order) => order.rfq_id === rfq.id);
              const hasSupplierActivity = rfq.recipients.some(
                (recipient) => recipient.status !== "INVITED" || Boolean(recipient.quotation),
              );
              const canEdit = rfq.status === "OPEN"
                && new Date(rfq.quotation_deadline).getTime() > Date.now()
                && purchaseOrderHistoryLoaded
                && !existingOrder
                && !hasSupplierActivity;
              return (
              <details className="procurement-workspace-card" key={rfq.id}>
                <summary><span><strong>{rfq.item_name}</strong><small>{rfq.quantity} {rfq.unit} · deadline {new Date(rfq.quotation_deadline).toLocaleDateString()}</small></span><span className="procurement-workspace-status">{rfq.status}</span></summary>
                <div className="procurement-workspace-rfq-details">
                  <p>{rfq.specification || "No specification"}</p><p>Delivery: {rfq.delivery_location}</p>
                  {existingOrder && <p className="procurement-workspace-note">A purchase order already exists for this RFQ ({existingOrder.order_reference}, {existingOrder.status.replaceAll("_", " ")}). Another quotation cannot be awarded.</p>}
                  {!purchaseOrderHistoryLoaded && <p className="procurement-workspace-note">Checking all purchase orders before enabling award actions…</p>}
                  {canEdit && !editingRfqId && <button
                    className="procurement-workspace-secondary"
                    type="button"
                    onClick={() => {
                      setEditingRfqId(rfq.id);
                      setEditRfqDeliveryLocation(rfq.delivery_location);
                      setEditRfqDeadline(localDateTimeValue(rfq.quotation_deadline));
                      setEditRfqNotes(rfq.buyer_notes || "");
                    }}
                  >Edit RFQ</button>}
                  {editingRfqId === rfq.id && (
                    <div className="procurement-workspace-form">
                      <p className="procurement-workspace-note">The requirement and invited suppliers stay unchanged. Editing is available only before supplier activity or a purchase order.</p>
                      <label>Delivery location<input required maxLength={500} value={editRfqDeliveryLocation} onChange={(event) => setEditRfqDeliveryLocation(event.target.value)} /></label>
                      <label>Quotation deadline<input required type="datetime-local" min={new Date(Date.now() + 60000).toISOString().slice(0, 16)} value={editRfqDeadline} onChange={(event) => setEditRfqDeadline(event.target.value)} /></label>
                      <label>Buyer notes<textarea maxLength={4000} value={editRfqNotes} onChange={(event) => setEditRfqNotes(event.target.value)} /></label>
                      <div className="procurement-workspace-actions">
                        <button className="procurement-workspace-secondary" type="button" onClick={() => setEditingRfqId("")} disabled={busy === `edit-rfq-${rfq.id}`}>Cancel</button>
                        <button className="procurement-workspace-primary" type="button" onClick={() => void saveRfqEdits(rfq)} disabled={busy === `edit-rfq-${rfq.id}`}><Save size={16} />Save RFQ changes</button>
                      </div>
                    </div>
                  )}
                  {rfq.recipients.map((recipient) => {
                    const quote = recipient.quotation;
                    const comparable = Boolean(quote)
                      && quote!.unit.trim().toLowerCase() === rfq.unit.trim().toLowerCase()
                      && compareDecimal(quote!.quantity_offered, rfq.quantity) !== null
                      && (compareDecimal(quote!.quantity_offered, rfq.quantity) || 0) >= 0
                      && quote!.quotation_valid_until >= new Date().toISOString().slice(0, 10);
                    const canAward = comparable
                      && purchaseOrderHistoryLoaded
                      && !existingOrder
                      && rfq.status === "OPEN"
                      && new Date(rfq.quotation_deadline).getTime() > Date.now()
                      && recipient.status !== "DECLINED";
                    return <article className="procurement-workspace-quote" key={recipient.company_id}>
                      <strong>{recipient.company_name}</strong>
                      {!quote ? <p>{recipient.status}{recipient.response_note ? ` · ${recipient.response_note}` : ""}</p> : <>
                        <p>{quote.currency} {quote.unit_price} / {quote.unit} · {quote.quantity_offered} offered · {quote.estimated_delivery_lead_time_days} days</p>
                        <p>Valid until {quote.quotation_valid_until} · {quote.delivery_terms}</p>
                        {!canAward && <p className="procurement-workspace-note">Not eligible for award: check RFQ status, supplier response, quote validity, unit and quantity, and whether a purchase order already exists.</p>}
                        <button className="procurement-workspace-primary" type="button" disabled={!canAward || busy === `award-${quote.id}`} onClick={() => {
                          if (window.confirm(`Create a purchase order from ${recipient.company_name}'s quotation?`)) {
                            void runAction(`award-${quote.id}`, async () => {
                              await procurementWorkspaceApi.selectQuotation(rfq.id, quote.id);
                              await load();
                            }, "Quotation awarded and purchase order created.");
                          }
                        }}>Award quotation</button>
                      </>}
                    </article>;
                  })}
                  {rfq.status === "OPEN" && !existingOrder && <button className="procurement-workspace-danger" type="button" disabled={busy === `close-${rfq.id}`} onClick={() => {
                    if (window.confirm("Close this RFQ? Suppliers will no longer be able to respond.")) {
                      void runAction(`close-${rfq.id}`, async () => { await procurementWorkspaceApi.closeRfq(rfq.id); await load(); }, "RFQ closed.");
                    }
                  }}>Close RFQ</button>}
                </div>
              </details>
            );
            })}
          </section>
        </>
      )}

      {section === "orders" && (
        <section className="procurement-workspace-panel">
          <h2>Purchase orders and fulfilment</h2><p>Track supplier acceptance and recorded dispatch or delivery events.</p>
          {orders.length === 0 ? <p className="procurement-workspace-empty">No purchase orders are available.</p> : orders.map((order) => (
            <article className="procurement-workspace-card" key={order.id}>
              <div className="procurement-workspace-card-head"><div><h3>{order.order_reference}</h3><p>{order.item_name} · {order.quantity} {order.unit}</p></div><span className="procurement-workspace-status">{order.status.replaceAll("_", " ")}</span></div>
              <dl className="procurement-workspace-facts">
                <div><dt>Supplier</dt><dd>{order.supplier_company_name}</dd></div>
                <div><dt>Price</dt><dd>{order.currency} {order.unit_price} / {order.offered_unit}</dd></div>
                <div><dt>Delivery location</dt><dd>{order.delivery_location}</dd></div>
                <div><dt>Fulfilment</dt><dd>{order.dispatched_quantity} dispatched · {order.delivered_quantity} delivered {order.fulfillment_unit}</dd></div>
              </dl>
              {order.fulfillment_events.map((event) => <p className="procurement-workspace-event" key={event.id}>{event.status.replaceAll("_", " ")} · {event.dispatched_quantity} dispatched · {event.delivered_quantity} delivered{event.delivery_notes ? ` · ${event.delivery_notes}` : ""}</p>)}
              {["ISSUED", "ACCEPTED", "PREPARING"].includes(order.status) && <button className="procurement-workspace-danger" type="button" disabled={busy === `cancel-${order.id}`} onClick={() => {
                if (window.confirm(`Cancel purchase order ${order.order_reference}?`)) {
                  void runAction(`cancel-${order.id}`, async () => { await procurementWorkspaceApi.cancelPurchaseOrder(order.id); await load(); }, "Purchase order cancelled.");
                }
              }}>Cancel order</button>}
            </article>
          ))}
          {hasMore && renderPageControls()}
        </section>
      )}
    </main>
  );
}
