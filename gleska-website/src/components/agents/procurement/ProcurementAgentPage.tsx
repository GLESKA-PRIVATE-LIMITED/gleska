"use client";

import React, { FormEvent, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Activity,
  Boxes,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  Hash,
  ListFilter,
  Loader2,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  PlusCircle,
  RotateCcw,
  Save,
  Search,
  ShoppingCart,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import {
  MaterialRequestDraft,
  ProcurementConversation,
  ProcurementMaterialRequest,
  procurementApi,
} from "@/lib/procurement-api";
import { procurementConfig } from "./procurementConfig";

type Section =
  | "dashboard"
  | "new-request"
  | "saved-requests"
  | "details"
  | "status"
  | "companies-out"
  | "get-procurement"
  | "material-details"
  | "companies"
  | "settings";
type CreationMode = "ai" | "manual";
type DraftField = keyof MaterialRequestDraft;

const plannedSectionDetails: Partial<Record<Section, { title: string; description: string }>> = {
  details: {
    title: "Procurement Details",
    description: "Procurement profile and sourcing preferences are not available yet.",
  },
  status: {
    title: "Current Status",
    description: "Request lifecycle and fulfillment tracking are not available yet. Saved material requests remain available in Saved Requests.",
  },
  "companies-out": {
    title: "Procurement to Companies",
    description: "Company sourcing and procurement coordination are planned for a future release.",
  },
  companies: {
    title: "Procurement Companies",
    description: "A supplier and procurement-company directory is not available yet.",
  },
  settings: {
    title: "Procurement Settings",
    description: "Procurement-specific preferences are not available yet.",
  },
};

const draftFieldLabels: Record<DraftField, string> = {
  title: "Request title",
  item_name: "Material / item name",
  specification: "Specification or grade",
  quantity: "Quantity",
  unit: "Unit of measure",
  required_by: "Required by date",
  delivery_location: "Delivery location",
  additional_requirements: "Additional requirements",
  notes: "Notes",
};

const draftFieldNames = Object.keys(draftFieldLabels) as DraftField[];

const draftFieldMaxLengths: Partial<Record<DraftField, number>> = {
  title: 160,
  item_name: 240,
  specification: 2000,
  unit: 48,
  delivery_location: 500,
  notes: 4000,
};

const commonUnits = ["MT", "Bags", "Pieces", "Kg", "Tons", "Meters", "Sq.ft", "Boxes", "Liters"];

function emptyDraft(): MaterialRequestDraft {
  return {
    title: null,
    item_name: null,
    specification: null,
    quantity: null,
    unit: null,
    required_by: null,
    delivery_location: null,
    additional_requirements: [],
    notes: null,
  };
}

function editableDraft(value: MaterialRequestDraft): MaterialRequestDraft {
  return {
    title: value.title ?? null,
    item_name: value.item_name ?? null,
    specification: value.specification ?? null,
    quantity: value.quantity == null ? null : String(value.quantity),
    unit: value.unit ?? null,
    required_by: value.required_by?.slice(0, 10) ?? null,
    delivery_location: value.delivery_location ?? null,
    additional_requirements: value.additional_requirements ?? [],
    notes: value.notes ?? null,
  };
}

function mergeSameRevisionRequest(
  detail: ProcurementMaterialRequest,
  listed: ProcurementMaterialRequest | undefined,
): ProcurementMaterialRequest {
  if (!listed || detail.revision !== listed.revision) return detail;
  return {
    ...detail,
    title: detail.title ?? listed.title,
    item_name: detail.item_name ?? listed.item_name,
    specification: detail.specification ?? listed.specification,
    quantity: detail.quantity ?? listed.quantity,
    unit: detail.unit ?? listed.unit,
    required_by: detail.required_by ?? listed.required_by,
    delivery_location: detail.delivery_location ?? listed.delivery_location,
    additional_requirements: detail.additional_requirements?.length
      ? detail.additional_requirements
      : listed.additional_requirements,
    notes: detail.notes ?? listed.notes,
  };
}

function canonicalDecimal(value: MaterialRequestDraft["quantity"]): string | null {
  if (value === null || value === "") return null;
  const match = String(value).trim().match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  if (!match) return `invalid:${String(value)}`;
  const sign = match[1] === "-" ? "-" : "";
  const whole = match[2] || "0";
  const fraction = match[3] || match[4] || "";
  const exponent = Number(match[5] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
    return `invalid:${String(value)}`;
  }
  let digits = `${whole}${fraction}`.replace(/^0+/, "") || "0";
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  if (scale >= digits.length) {
    digits = `${"0".repeat(scale - digits.length + 1)}${digits}`;
  }
  let integer = scale ? digits.slice(0, -scale) : digits;
  let decimal = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  integer = integer.replace(/^0+/, "") || "0";
  const isZero = integer === "0" && !decimal;
  return `${isZero ? "" : sign}${integer}${decimal ? `.${decimal}` : ""}`;
}

function canonicalOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function requestFingerprint(value: MaterialRequestDraft | ProcurementMaterialRequest): string {
  const normalizedRequirements = (value.additional_requirements || [])
    .map((item) => item.trim())
    .filter(Boolean);
  return JSON.stringify({
    title: canonicalOptionalText(value.title),
    item_name: canonicalOptionalText(value.item_name),
    specification: canonicalOptionalText(value.specification),
    quantity: canonicalDecimal(value.quantity),
    unit: canonicalOptionalText(value.unit),
    required_by: canonicalOptionalText(value.required_by),
    delivery_location: canonicalOptionalText(value.delivery_location),
    additional_requirements: normalizedRequirements,
    notes: canonicalOptionalText(value.notes),
  });
}

function errorCode(error: unknown): string | null {
  const detail = (error as {
    response?: { data?: { detail?: unknown } };
  })?.response?.data?.detail;
  return typeof detail === "string" ? detail : null;
}

function validationFieldErrors(error: unknown): Partial<Record<DraftField, string>> {
  const detail = (error as {
    response?: { data?: { detail?: unknown } };
  })?.response?.data?.detail;
  if (!Array.isArray(detail)) return {};

  const fieldNames = new Set<DraftField>(draftFieldNames);
  const errors: Partial<Record<DraftField, string>> = {};
  for (const item of detail) {
    if (typeof item !== "object" || item === null || !("loc" in item)) continue;
    const location = (item as { loc?: unknown }).loc;
    if (!Array.isArray(location)) continue;
    const field = [...location].reverse().find(
      (part): part is DraftField => typeof part === "string" && fieldNames.has(part as DraftField),
    );
    if (field) {
      const messages: Record<DraftField, string> = {
        title: "Check the request title and try again.",
        item_name: "Enter a valid material / item name.",
        specification: "Check the specification and try again.",
        quantity: "Enter a valid quantity greater than zero.",
        unit: "Enter a valid unit of measure.",
        required_by: "Enter a valid date in YYYY-MM-DD format.",
        delivery_location: "Check the delivery location and try again.",
        additional_requirements: "Check the additional requirements and try again.",
        notes: "Check the notes and try again.",
      };
      errors[field] = messages[field];
    }
  }
  return errors;
}

function httpStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === "number" ? status : null;
}

function conflictError(code: string) {
  return Object.assign(new Error(code), {
    response: { status: 409, data: { detail: code } },
  });
}

function errorMessage(error: unknown, fallback: string): string {
  const response = (error as {
    response?: { data?: { detail?: unknown } };
  })?.response?.data?.detail;
  const status = httpStatus(error);
  if (typeof response === "string") {
    const readable: Record<string, string> = {
      STALE_CONVERSATION_STATE: "This conversation has a newer version on the server. Reload the latest version before continuing; your unsaved edits remain in this form.",
      REQUIRED_FIELDS_NOT_CONFIRMED: "Please review and confirm the material name, quantity, and unit of measure before saving.",
      REQUIRED_FIELDS_CANNOT_BE_EMPTY: "Material name, quantity, and unit of measure are required. Enter a value for each before saving.",
      MATERIAL_REQUEST_INVALID: "One or more request values are invalid. Check the material name, quantity, and unit.",
      CONVERSATION_NOT_ACTIVE: "This conversation is already completed and saved. Check Saved Requests to view or edit the request, or start a new request.",
      CONVERSATION_STATE_INVALID: "This conversation could not be loaded due to an invalid format. Reload your Procurement workspace.",
      CONVERSATION_ALREADY_SAVED: "A material request has already been saved from this conversation. Open Saved Requests to review it.",
      REQUEST_SAVED_CONVERSATION_STALE: "The material request was saved, but the conversation could not be marked complete. Check Saved Requests.",
      MATERIAL_REQUEST_SAVE_FAILED: "The server could not save this material request. Your details remain available; please retry shortly.",
      STALE_MATERIAL_REQUEST: "This saved request has changed on the server since it was loaded. Reload the latest version before editing; your edits remain in this form.",
      MATERIAL_REQUEST_NOT_FOUND: "This saved request is no longer available. Refresh the saved-request list.",
      MATERIAL_REQUEST_STATE_INVALID: "A saved material request could not be loaded due to an invalid format. Please refresh your workspace.",
      CONVERSATION_HISTORY_INVALID: "The conversation history contains invalid data.",
      CONVERSATION_NOT_FOUND: "This conversation is no longer available. Refresh your Procurement workspace.",
      LLM_RATE_LIMITED: "The AI service is receiving too many requests. Please try again in a few moments; your entered form details have not been cleared.",
      LLM_TIMEOUT: "The AI assistant did not respond in time. Please retry; your entered form details have not been cleared.",
      LLM_UNAVAILABLE: "The AI assistant is temporarily unavailable. Please try again shortly. Your entered form details have not been cleared.",
      LLM_CONFIGURATION_ERROR: "The AI assistant is not configured correctly right now. Contact support if this continues.",
      LLM_PROVIDER_ERROR: "The AI service could not accept the request. Please try again shortly; your entered form details have not been cleared.",
      LLM_INVALID_RESPONSE: "The AI assistant returned an unexpected response format. Please retry; your entered form details have not been cleared.",
      IDEMPOTENCY_KEY_REUSED: "This save retry key is already associated with a different request. The existing saved request was not changed.",
      IDEMPOTENCY_PAYLOAD_CONFLICT: "This save retry key was previously used for different request details. Reload the saved request before continuing.",
    };
    if (readable[response]) return readable[response];
  }
  if (Array.isArray(response)) {
    const fields = response.flatMap((item) => {
      if (typeof item !== "object" || item === null || !("loc" in item)) return [];
      const location = (item as { loc?: unknown }).loc;
      return Array.isArray(location)
        ? location.filter((part): part is string => typeof part === "string")
        : [];
    });
    const labels: Record<string, string> = {
      title: "request title",
      item_name: "material/item name",
      specification: "specification or grade",
      quantity: "quantity",
      unit: "unit of measure",
      required_by: "required-by date",
      delivery_location: "delivery location",
      additional_requirements: "additional requirements",
      notes: "notes",
    };
    const invalidFields = [...new Set(fields.map((field) => labels[field]).filter(Boolean))];
    if (invalidFields.length) {
      return `Please correct these fields: ${invalidFields.join(", ")}. Your entered values have been kept.`;
    }
  }
  if (status === 401) return "Your sign-in has expired. Sign in again to continue; unsaved form values remain on this page.";
  if (status === 403) return "You do not have permission to access this Procurement workspace.";
  if (status === 404) return "This conversation or saved request is no longer available. Refresh the workspace.";
  if (status === 409) return "This action conflicts with the current server revision. Reload to reconcile your latest state.";
  if (status === 422) return "Some request fields are missing or invalid. Check the highlighted request details and try again.";
  if (status === 429) return "The AI service is receiving too many requests. Please try again later; your entered form details have not been cleared.";
  if (status !== null && status >= 500) return "The server encountered an error. Your entered form details have been kept; please try again shortly.";
  if (!status) return "A network connection problem prevented this action. Check your connection and retry; your entered form details have been kept.";
  return fallback;
}

function validateRequestDraft(draft: MaterialRequestDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.item_name?.trim()) {
    errors.item_name = "Material / item name is required.";
  } else if (draft.item_name.length > 240) {
    errors.item_name = "Material name cannot exceed 240 characters.";
  }

  if (draft.quantity === null || draft.quantity === "" || String(draft.quantity).trim() === "") {
    errors.quantity = "Quantity is required.";
  } else {
    const num = Number(draft.quantity);
    if (!Number.isFinite(num) || num <= 0) {
      errors.quantity = "Quantity must be greater than zero.";
    } else if (num > 1_000_000_000) {
      errors.quantity = "Quantity cannot exceed 1,000,000,000.";
    }
  }

  if (!draft.unit?.trim()) {
    errors.unit = "Unit of measure is required (e.g., MT, Bags, Pieces).";
  } else if (draft.unit.length > 48) {
    errors.unit = "Unit cannot exceed 48 characters.";
  }
  if (draft.required_by) {
    const match = draft.required_by.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      errors.required_by = "Enter a valid required-by date.";
    } else {
      const [, year, month, day] = match;
      const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (
        parsed.getUTCFullYear() !== Number(year)
        || parsed.getUTCMonth() !== Number(month) - 1
        || parsed.getUTCDate() !== Number(day)
      ) {
        errors.required_by = "Enter a valid required-by date.";
      }
    }
  }

  if (draft.title && draft.title.length > 160) {
    errors.title = "Request title cannot exceed 160 characters.";
  }
  if (draft.specification && draft.specification.length > 2000) {
    errors.specification = "Specification cannot exceed 2,000 characters.";
  }
  if (draft.delivery_location && draft.delivery_location.length > 500) {
    errors.delivery_location = "Delivery location cannot exceed 500 characters.";
  }
  if (draft.notes && draft.notes.length > 4000) {
    errors.notes = "Notes cannot exceed 4,000 characters.";
  }
  if (draft.additional_requirements && draft.additional_requirements.length > 50) {
    errors.additional_requirements = "Maximum 50 additional requirements permitted.";
  }

  return errors;
}

export default function ProcurementAgentPage() {
  const [section, setSection] = useState<Section>("dashboard");
  const [creationMode, setCreationMode] = useState<CreationMode>("ai");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [staleRequestId, setStaleRequestId] = useState<string | null>(null);
  const [conversationNeedsReload, setConversationNeedsReload] = useState(false);
  const [conversations, setConversations] = useState<ProcurementConversation[]>([]);
  const [conversation, setConversation] = useState<ProcurementConversation | null>(null);
  const [requests, setRequests] = useState<ProcurementMaterialRequest[]>([]);
  const [draft, setDraft] = useState<MaterialRequestDraft>(emptyDraft);
  const [confirmedFields, setConfirmedFields] = useState<string[]>([]);
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [messageRetryAvailable, setMessageRetryAvailable] = useState(false);
  const [activeRequest, setActiveRequest] = useState<ProcurementMaterialRequest | null>(null);
  const [requestDraft, setRequestDraft] = useState<MaterialRequestDraft>(emptyDraft);
  const [requestFieldErrors, setRequestFieldErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [savedRequestSearch, setSavedRequestSearch] = useState("");
  const [isDraftExpandedMobile, setIsDraftExpandedMobile] = useState(false);

  const idempotencyRef = useRef<{ conversationId: string; key: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const formErrors = validateRequestDraft(draft);
  const isFormReady = Object.keys(formErrors).length === 0;

  const isDraftDirty = Boolean(
    conversation
    && (
      requestFingerprint(draft) !== requestFingerprint(editableDraft(conversation.draft))
      || [...confirmedFields].sort().join("|") !== [...conversation.confirmed_fields].sort().join("|")
    )
  );

  const isRequestDirty = Boolean(
    activeRequest
    && requestFingerprint(requestDraft) !== requestFingerprint(editableDraft(activeRequest))
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (creationMode === "ai" && section === "new-request") {
      scrollToBottom();
    }
  }, [conversation?.history, busy, creationMode, section]);

  const applyConversationState = (value: ProcurementConversation) => {
    setConversation(value);
    setDraft(editableDraft(value.draft));
    setConfirmedFields(value.confirmed_fields);
    setConversationNeedsReload(false);
  };

  const selectConversation = (value: ProcurementConversation) => {
    applyConversationState(value);
    setConversations((current) => [
      value,
      ...current.filter((item) => item.conversation_id !== value.conversation_id),
    ]);
    setActionError("");
    setActionSuccess("");
  };

  const refreshRequests = async () => {
    try {
      const latest = await procurementApi.listRequests();
      setRequests(latest);
      return latest;
    } catch (err) {
      setActionError(errorMessage(err, "Failed to refresh saved requests."));
      return [];
    }
  };

  const loadWorkspace = async (isManualReload = false) => {
    if (!isManualReload) setLoading(true);
    else setBusy(true);
    setWorkspaceError("");

    let loadedConversations: ProcurementConversation[] = [];
    let loadedRequests: ProcurementMaterialRequest[] = [];
    const errors: string[] = [];

    try {
      const [convosResult, requestsResult] = await Promise.allSettled([
        procurementApi.listConversations(),
        procurementApi.listRequests(),
      ]);

      if (convosResult.status === "fulfilled") {
        loadedConversations = convosResult.value;
        setConversations(loadedConversations);
      } else {
        errors.push(`Conversations: ${errorMessage(convosResult.reason, "Failed to load conversations.")}`);
      }

      if (requestsResult.status === "fulfilled") {
        loadedRequests = requestsResult.value;
        setRequests(loadedRequests);
      } else {
        errors.push(`Saved requests: ${errorMessage(requestsResult.reason, "Failed to load saved requests.")}`);
      }

      if (convosResult.status === "fulfilled") {
        const activeConvo = loadedConversations.find((item) => item.status === "ACTIVE");
        if (activeConvo) {
          try {
            const latest = await procurementApi.getConversation(activeConvo.conversation_id);
            applyConversationState(latest);
          } catch (err) {
            errors.push(`Active conversation: ${errorMessage(err, "Failed to load active conversation.")}`);
          }
        } else if (loadedConversations.length > 0) {
          try {
            const latest = await procurementApi.getConversation(loadedConversations[0].conversation_id);
            applyConversationState(latest);
          } catch {
            // Non-critical if last conversation cannot be loaded
          }
        }
      }

      if (convosResult.status === "rejected" && requestsResult.status === "rejected") {
        setWorkspaceError(errors.join(" · ") || "Unable to load Procurement workspace.");
      } else if (errors.length > 0) {
        setActionError(errors.join(" · "));
      }
    } catch (unexpectedError) {
      setWorkspaceError(errorMessage(unexpectedError, "An unexpected error occurred while loading your workspace."));
    } finally {
      setLoading(false);
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, []);

  useEffect(() => {
    if (!isDraftDirty && !isRequestDirty && !message.trim()) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDraftDirty, isRequestDirty, message]);

  const confirmDiscardDraft = () => (
    (!isDraftDirty && !message.trim())
    || window.confirm("Discard unsaved material request edits or your unsent message?")
  );

  const startConversation = async () => {
    if (isDraftDirty && !confirmDiscardDraft()) return;
    setBusy(true);
    setActionError("");
    setActionSuccess("");
    try {
      const created = await procurementApi.createConversation();
      setConversations((current) => [created, ...current]);
      selectConversation(created);
      setMessage("");
      setManualConfirmed(false);
      setTouchedFields({});
      idempotencyRef.current = null;
      setSection("new-request");
    } catch (error) {
      setActionError(errorMessage(error, "Unable to start a Procurement conversation."));
    } finally {
      setBusy(false);
    }
  };

  const resumeConversation = async (id: string) => {
    if (!id || id === conversation?.conversation_id) return;
    if (isDraftDirty && !confirmDiscardDraft()) return;
    setBusy(true);
    setActionError("");
    setActionSuccess("");
    try {
      const loaded = await procurementApi.getConversation(id);
      selectConversation(loaded);
      setMessage("");
      setManualConfirmed(false);
      setTouchedFields({});
      setSection("new-request");
    } catch (error) {
      setActionError(errorMessage(error, "Unable to restore this conversation."));
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const text = message.trim();
    if (!conversation || !text || busy || conversationNeedsReload) return;
    setBusy(true);
    setActionError("");
    setActionSuccess("");
    setMessageRetryAvailable(false);
    try {
      let currentConversation = conversation;
      if (isDraftDirty) {
        currentConversation = await procurementApi.updateDraft(
          conversation.conversation_id,
          draft,
          confirmedFields,
          conversation.revision,
        );
        selectConversation(currentConversation);
      }
      const updated = await procurementApi.sendMessage(
        currentConversation.conversation_id,
        text,
        currentConversation.revision,
      );
      selectConversation(updated);
      setConversations((current) => [
        updated,
        ...current.filter((item) => item.conversation_id !== updated.conversation_id),
      ]);
      setMessage("");
      setMessageRetryAvailable(false);
    } catch (error) {
      setActionError(errorMessage(error, "The assistant could not process that message. Please retry."));
      setMessageRetryAvailable(true);
      if (errorCode(error) === "STALE_CONVERSATION_STATE") {
        setConversationNeedsReload(true);
        setMessageRetryAvailable(false);
        setActionError("This conversation has changed on the server. Reload its latest state before retrying; your message and draft are preserved.");
      }
    } finally {
      setBusy(false);
    }
  };

  const reloadConversation = async () => {
    if (!conversation) return;
    const conversationId = conversation.conversation_id;
    setBusy(true);
    setActionError("");
    setActionSuccess("");
    try {
      const latest = await procurementApi.getConversation(conversationId);
      if (isDraftDirty) {
        setConversation(latest);
      } else {
        selectConversation(latest);
      }
      setConversationNeedsReload(false);
      setActionSuccess("Conversation reloaded to latest server version.");
    } catch (error) {
      setActionError(errorMessage(error, "Unable to reload the latest conversation."));
    } finally {
      setBusy(false);
    }
  };

  const updateDraftField = (field: DraftField, value: string) => {
    setDraft((current) => ({
      ...current,
      [field]: field === "additional_requirements"
        ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        : value === "" ? null : value,
    }));
    setConfirmedFields((current) => current.filter((item) => item !== field));
    setActionError("");
    setActionSuccess("");
  };

  const getSaveIdempotencyKey = (conversationId: string): string => {
    if (idempotencyRef.current?.conversationId === conversationId) {
      return idempotencyRef.current.key;
    }
    const storageKey = `gleska:procurement:save:${conversationId}`;
    let storedKey: string | null = null;
    try {
      storedKey = window.localStorage.getItem(storageKey);
    } catch {
      // Continue with in-memory key
    }
    const key = storedKey || crypto.randomUUID();
    if (!storedKey) {
      try {
        window.localStorage.setItem(storageKey, key);
      } catch {
        // Keep in-memory key
      }
    }
    idempotencyRef.current = { conversationId, key };
    return key;
  };

  const displaySavedRequest = (saved: ProcurementMaterialRequest) => {
    setActiveRequest(saved);
    setRequestDraft(editableDraft(saved));
    setStaleRequestId(null);
    setRequests((current) => [
      saved,
      ...current.filter((item) => item.id !== saved.id),
    ]);
    setSection("saved-requests");
  };

  const recoverSavedRequest = async (
    conversationId: string,
    expectedConversation: ProcurementConversation,
  ): Promise<"saved" | "not-found" | "mismatch"> => {
    const [latestConversation, latestRequests] = await Promise.all([
      procurementApi.getConversation(conversationId),
      procurementApi.listRequests(),
    ]);
    setRequests(latestRequests);
    const saved = latestRequests.find((item) => item.origin_conversation_id === conversationId);
    if (saved) {
      displaySavedRequest(saved);
      selectConversation(latestConversation);
      if (requestFingerprint(saved) !== requestFingerprint(expectedConversation.draft)) {
        setActionSuccess("");
        setActionError(
          `A saved request exists for this conversation, but its details differ from the draft. The saved request is open in Saved Requests; compare it before making another change.`,
        );
        return "mismatch";
      }
      setActionSuccess(`“${saved.title || saved.item_name}” is saved and available in Saved Requests.`);
      setActionError("");
      return "saved";
    }

    setConversations((current) => [
      latestConversation,
      ...current.filter((item) => item.conversation_id !== latestConversation.conversation_id),
    ]);
    if (
      latestConversation.revision !== expectedConversation.revision
      || latestConversation.status !== expectedConversation.status
    ) {
      setConversation(latestConversation);
      setConversationNeedsReload(true);
    }
    return "not-found";
  };

  const saveReviewedRequest = async (isFromManual = false) => {
    if (busy || conversationNeedsReload) return;

    if (isFromManual && !manualConfirmed) {
      setActionError("Please check the confirmation box before saving.");
      return;
    }

    const validationErrors = validateRequestDraft(draft);
    if (Object.keys(validationErrors).length > 0) {
      setTouchedFields({
        item_name: true,
        quantity: true,
        unit: true,
        specification: true,
        title: true,
      });
      setActionSuccess("");
      setActionError(`Complete or correct required fields: ${Object.values(validationErrors).join(", ")}`);
      return;
    }

    let activeConvo = conversation;
    if (!activeConvo || activeConvo.status !== "ACTIVE") {
      setBusy(true);
      setActionError("");
      try {
        activeConvo = await procurementApi.createConversation();
        selectConversation(activeConvo);
      } catch (err) {
        setBusy(false);
        setActionError(errorMessage(err, "Unable to initialize a new request conversation."));
        return;
      }
    }

    setBusy(true);
    setActionError("");
    setActionSuccess("");

    let reviewedConversation: ProcurementConversation | null = null;
    let saveAttempted = false;
    let saveConfirmed = false;
    const fieldsConfirmedBySave = draftFieldNames.filter((field) => {
      const value = draft[field];
      return value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
    });

    try {
      const needsDraftUpdate = (
        requestFingerprint(draft) !== requestFingerprint(editableDraft(activeConvo.draft))
        || [...fieldsConfirmedBySave].sort().join("|")
          !== [...activeConvo.confirmed_fields].sort().join("|")
      );

      if (needsDraftUpdate) {
        reviewedConversation = await procurementApi.updateDraft(
          activeConvo.conversation_id,
          draft,
          fieldsConfirmedBySave,
          activeConvo.revision,
        );
        selectConversation(reviewedConversation);
      } else {
        reviewedConversation = activeConvo;
      }

      const confirmedConversation = reviewedConversation;
      if (!confirmedConversation) {
        throw new Error("PROCUREMENT_REVIEW_STATE_UNAVAILABLE");
      }

      const pendingIdempotency = getSaveIdempotencyKey(confirmedConversation.conversation_id);
      saveAttempted = true;
      const saveResponse = await procurementApi.saveRequest(
        confirmedConversation.conversation_id,
        confirmedConversation.revision,
        pendingIdempotency,
      );

      if (requestFingerprint(saveResponse) !== requestFingerprint(confirmedConversation.draft)) {
        throw conflictError("IDEMPOTENCY_PAYLOAD_CONFLICT");
      }

      displaySavedRequest(saveResponse);
      setActionSuccess(`“${saveResponse.title || saveResponse.item_name}” was saved successfully.`);
      saveConfirmed = true;
    } catch (error) {
      const originalMessage = errorMessage(
        error,
        "The request could not be saved. Your entered details remain in the form; correct the issue or retry.",
      );

      if (saveAttempted || errorCode(error) === "CONVERSATION_NOT_ACTIVE") {
        try {
          const recovery = await recoverSavedRequest(
            activeConvo.conversation_id,
            reviewedConversation || activeConvo,
          );
          if (recovery === "not-found") {
            setActionError(`${originalMessage} Recovery found no saved request; your current draft remains available.`);
          } else if (recovery === "mismatch") {
            setActionError(`${originalMessage} Recovery found a saved request with different details; it is open in Saved Requests for review.`);
          }
        } catch (recoveryError) {
          setActionSuccess("");
          setActionError(
            `${originalMessage} We could not confirm whether the server saved it: ${errorMessage(recoveryError, "the recovery lookup failed")}`,
          );
        }
      } else {
        if (errorCode(error) === "STALE_CONVERSATION_STATE") {
          setConversationNeedsReload(true);
        }
        setActionError(originalMessage);
      }
    }

    if (saveConfirmed) {
      try {
        const latestConversation = await procurementApi.getConversation(activeConvo.conversation_id);
        selectConversation(latestConversation);
        await refreshRequests();
        try {
          window.localStorage.removeItem(`gleska:procurement:save:${activeConvo.conversation_id}`);
        } catch {
          // Ignore storage clean up failure
        }
        idempotencyRef.current = null;
        setActionSuccess(`“${draft.title || draft.item_name}” was saved successfully.`);
      } catch {
        setActionSuccess("The request was saved and is available in Saved Requests.");
      }
    }
    setBusy(false);
  };

  const openRequest = async (id: string) => {
    if (
      isRequestDirty
      && !window.confirm("Discard unsaved edits to the currently selected saved request?")
    ) return;
    setBusy(true);
    setActionError("");
    setActionSuccess("");
    setRequestFieldErrors({});
    const selected = requests.find((item) => item.id === id);
    if (selected) {
      setActiveRequest(selected);
      setRequestDraft(editableDraft(selected));
      setStaleRequestId(null);
    }
    try {
      const loaded = await procurementApi.getRequest(id);
      const resolved = mergeSameRevisionRequest(loaded, selected);
      setActiveRequest(resolved);
      setRequestDraft(editableDraft(resolved));
      setStaleRequestId(null);
    } catch (error) {
      setActionError(errorMessage(error, "Unable to load the saved request."));
    } finally {
      setBusy(false);
    }
  };

  const reloadRequest = async () => {
    if (!activeRequest) return;
    const currentRequestId = activeRequest.id;
    setBusy(true);
    setActionError("");
    setActionSuccess("");
    try {
      const latest = await procurementApi.getRequest(currentRequestId);
      setActiveRequest(latest);
      if (!isRequestDirty) {
        setRequestDraft(editableDraft(latest));
      }
      setRequestFieldErrors({});
      setStaleRequestId(null);
      setActionSuccess("Saved request reloaded to latest server version.");
    } catch (error) {
      if (errorCode(error) === "STALE_MATERIAL_REQUEST") setStaleRequestId(currentRequestId);
      setActionError(errorMessage(error, "Unable to reload the latest saved request."));
    } finally {
      setBusy(false);
    }
  };

  const updateSavedRequestField = (field: DraftField, value: string) => {
    setRequestDraft((current) => ({
      ...current,
      [field]: field === "additional_requirements"
        ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        : value === "" ? null : value,
    }));
    setRequestFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setActionError("");
    setActionSuccess("");
  };

  const saveRequestEdits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRequest || busy || staleRequestId === activeRequest.id) return;
    const errors = validateRequestDraft(requestDraft);
    if (Object.keys(errors).length > 0) {
      setRequestFieldErrors(errors);
      setActionSuccess("");
      setActionError("Please correct the highlighted fields before saving.");
      return;
    }
    setRequestFieldErrors({});
    setBusy(true);
    setActionError("");
    setActionSuccess("");
    try {
      const updated = await procurementApi.updateRequest(
        activeRequest.id,
        requestDraft,
        activeRequest.revision,
      );
      setActiveRequest(updated);
      setRequestDraft(editableDraft(updated));
      setRequestFieldErrors({});
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      setActionSuccess("Saved request changes were updated successfully.");
    } catch (error) {
      if (errorCode(error) === "STALE_MATERIAL_REQUEST") setStaleRequestId(activeRequest.id);
      const fieldErrors = validationFieldErrors(error);
      if (Object.keys(fieldErrors).length > 0) {
        setRequestFieldErrors(fieldErrors);
        setActionError("The server rejected one or more fields. Please correct the highlighted fields.");
      } else {
        setActionError(errorMessage(error, "Unable to update this request. Reload it and try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  const deleteSavedRequest = async () => {
    if (!activeRequest || busy) return;
    const requestId = activeRequest.id;
    const requestTitle = activeRequest.title || activeRequest.item_name;
    if (!window.confirm(`Delete "${requestTitle}"? This permanently removes the saved request. Unsaved edits will be lost.`)) {
      return;
    }

    setBusy(true);
    setActionError("");
    setActionSuccess("");
    try {
      await procurementApi.deleteRequest(requestId);
      setRequests((current) => current.filter((item) => item.id !== requestId));
      setActiveRequest((current) => current?.id === requestId ? null : current);
      setRequestDraft(emptyDraft());
      setRequestFieldErrors({});
      setStaleRequestId(null);
      setActionSuccess(`"${requestTitle}" was deleted.`);

      try {
        const latestRequests = await procurementApi.listRequests();
        setRequests(latestRequests);
      } catch {
        setActionError(`"${requestTitle}" was deleted, but the saved-request list could not refresh. Reload the page to confirm the latest list.`);
      }
    } catch (error) {
      setActionError(errorMessage(error, "Unable to delete this saved request. It remains in your saved requests."));
    } finally {
      setBusy(false);
    }
  };

  const handleEditExtractedInManualForm = () => {
    setCreationMode("manual");
  };

  const onSectionChange = (id: string) => {
    const destination: Record<string, Section> = {
      dashboard: "dashboard",
      "new-request": "new-request",
      "saved-requests": "saved-requests",
      details: "details",
      status: "status",
      "companies-out": "companies-out",
      "get-procurement": "new-request",
      "material-details": "saved-requests",
      companies: "companies",
      settings: "settings",
    };
    const nextSection = destination[id];
    if (!nextSection) return;
    setSection(nextSection);
    setActionError("");
    setActionSuccess("");
  };

  const filteredRequests = requests.filter((item) => {
    if (!savedRequestSearch.trim()) return true;
    const term = savedRequestSearch.toLowerCase();
    return (
      (item.title && item.title.toLowerCase().includes(term))
      || (item.item_name && item.item_name.toLowerCase().includes(term))
      || (item.specification && item.specification.toLowerCase().includes(term))
      || (item.unit && item.unit.toLowerCase().includes(term))
    );
  });

  const filledDetailsCount = [
    Boolean(draft.item_name),
    draft.quantity !== null && draft.quantity !== "",
    Boolean(draft.unit),
    Boolean(draft.specification),
    Boolean(draft.required_by),
    Boolean(draft.delivery_location),
    Boolean(draft.title),
    draft.additional_requirements && draft.additional_requirements.length > 0,
    Boolean(draft.notes),
  ].filter(Boolean).length;

  const isSavedFromConversation = Boolean(
    conversation && conversation.status === "COMPLETED"
  );

  const missingRequiredFields: string[] = [];
  if (!draft.item_name?.trim()) missingRequiredFields.push("material name");
  if (draft.quantity === null || draft.quantity === "" || Number(draft.quantity) <= 0) missingRequiredFields.push("quantity");
  if (!draft.unit?.trim()) missingRequiredFields.push("unit");

  return (
    <AgentLayout
      config={procurementConfig}
      activeTab={section}
      setActiveTab={onSectionChange}
    >
      <div className="space-y-6">
        {/* Page Header */}
        <header className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-anton text-2xl uppercase tracking-wide text-slate-900 dark:text-white sm:text-3xl">
                {section === "dashboard"
                  ? "Manage Procurement"
                  : section === "saved-requests" || section === "material-details"
                    ? "Saved Material Requests"
                    : plannedSectionDetails[section]?.title || "Procurement Agent"}
              </h1>
              <p className="mt-1 max-w-2xl text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                {section === "dashboard"
                  ? "Manage your material requests and explore the Procurement Agent workspace."
                  : section === "saved-requests" || section === "material-details"
                    ? "Retrieve, review, edit, and remove saved material requests."
                    : "Clarify, review, and save structured material requests for your projects."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div
                role="tablist"
                aria-label="Procurement workspace views"
                className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === "dashboard"}
                  onClick={() => onSectionChange("dashboard")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    section === "dashboard"
                      ? "bg-white text-purple-700 shadow-sm dark:bg-slate-700 dark:text-purple-300 font-bold"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === "new-request"}
                  onClick={() => onSectionChange("new-request")}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    section === "new-request"
                      ? "bg-white text-purple-700 shadow-sm dark:bg-slate-700 dark:text-purple-300 font-bold"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <PlusCircle size={13} />
                  New Request
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === "saved-requests"}
                  onClick={() => onSectionChange("saved-requests")}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    section === "saved-requests"
                      ? "bg-white text-purple-700 shadow-sm dark:bg-slate-700 dark:text-purple-300 font-bold"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <ClipboardList size={13} />
                  Saved Requests {requests.length > 0 && `(${requests.length})`}
                </button>
              </div>

              {(section === "new-request" || section === "get-procurement") && (
                <button
                  type="button"
                  onClick={() => void startConversation()}
                  disabled={busy || loading}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-xl bg-purple-700 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-purple-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer shadow-sm"
                >
                  <Plus size={14} />
                  Start new request
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Workspace Load Error Banner */}
        {workspaceError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs sm:text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 shadow-xs"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span className="flex-1 leading-relaxed">{workspaceError}</span>
            <button
              type="button"
              onClick={() => void loadWorkspace(true)}
              disabled={busy}
              className="shrink-0 font-bold underline disabled:opacity-60 cursor-pointer"
            >
              Retry loading
            </button>
          </div>
        )}

        {/* Action Error Banner */}
        {actionError && (
          <div
            role="alert"
            className="flex flex-wrap items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs sm:text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 shadow-xs"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span className="flex-1 leading-relaxed">{actionError}</span>
            {messageRetryAvailable
              && conversation?.status === "ACTIVE"
              && !conversationNeedsReload
              && message.trim() && (
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={busy}
                  className="shrink-0 font-bold underline disabled:opacity-60 cursor-pointer"
                >
                  Retry message
                </button>
              )}
          </div>
        )}

        {/* Action Success Banner */}
        {actionSuccess && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs sm:text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 shadow-xs"
          >
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Main Content Area */}
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-16 text-center text-sm font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <LoaderCircle size={24} className="animate-spin text-purple-600" />
            <p>Loading your Procurement workspace…</p>
          </div>
        ) : section === "dashboard" ? (
          <div className="space-y-6">
            <section aria-label="Procurement actions" className="grid gap-4 lg:grid-cols-2">
              <button
                type="button"
                onClick={() => onSectionChange("get-procurement")}
                className="group flex min-h-40 items-center justify-between rounded-2xl border border-slate-200 border-t-4 border-t-indigo-500 bg-white p-5 text-left shadow-lg shadow-slate-900/5 transition hover:-translate-y-1 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-6"
              >
                <span className="min-w-0 pr-4">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">OPTION 02 · AVAILABLE</span>
                  <span className="mt-1 block text-xl font-bold text-slate-900 dark:text-white">Get Procurement</span>
                  <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">
                    Create, review, and manage material requests for your projects.
                  </span>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-indigo-700 dark:text-indigo-300">
                    Open material requests <ArrowRight size={15} />
                  </span>
                </span>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-400">
                  <ShoppingCart size={24} />
                </span>
              </button>

              <article className="flex min-h-40 items-center justify-between rounded-2xl border border-slate-200 border-t-4 border-t-purple-500 bg-white p-5 shadow-lg shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
                <div className="min-w-0 pr-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">OPTION 01</span>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      Planned
                    </span>
                  </div>
                  <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Provide Procurement</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Supplier discovery, catalogs, and company sourcing are not available yet.
                  </p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-purple-100 bg-purple-50 text-purple-600 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-400">
                  <Package size={24} />
                </span>
              </article>
            </section>

            <section aria-label="Material request overview" className="grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => onSectionChange("saved-requests")}
                className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-xs transition hover:border-purple-300 hover:bg-purple-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-purple-800 dark:hover:bg-purple-950/20"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                  <Boxes size={17} className="text-purple-600 dark:text-purple-400" />
                  Saved material requests
                </span>
                <span className="mt-2 block text-3xl font-bold text-slate-900 dark:text-white">{requests.length}</span>
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Open the saved request list</span>
              </button>
              <button
                type="button"
                onClick={() => onSectionChange("new-request")}
                className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-xs transition hover:border-purple-300 hover:bg-purple-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-purple-800 dark:hover:bg-purple-950/20"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                  <Activity size={17} className="text-purple-600 dark:text-purple-400" />
                  Active conversations
                </span>
                <span className="mt-2 block text-3xl font-bold text-slate-900 dark:text-white">
                  {conversations.filter((item) => item.status === "ACTIVE").length}
                </span>
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Continue an in-progress material request</span>
              </button>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <div className="mb-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Search material requests</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Search is limited to your saved requests; supplier and purchase-order search is not available.
                </p>
              </div>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSectionChange("saved-requests");
                }}
              >
                <div className="relative flex-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
                  <input
                    type="search"
                    value={savedRequestSearch}
                    onChange={(event) => setSavedRequestSearch(event.target.value)}
                    placeholder="Search by title, material, specification, or unit"
                    aria-label="Search saved material requests"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-purple-800"
                >
                  <Search size={15} /> Search requests
                </button>
              </form>
            </section>
          </div>
        ) : section === "new-request" || section === "get-procurement" ? (
          <div className="space-y-4">
            {/* Mode Switcher: AI Assistant vs Manual Form (matching Hiring Agent tabs) */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div
                role="tablist"
                aria-label="Request creation mode"
                className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
              >
                <button
                  role="tab"
                  type="button"
                  aria-selected={creationMode === "ai"}
                  onClick={() => setCreationMode("ai")}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    creationMode === "ai"
                      ? "bg-white text-purple-700 shadow-sm dark:bg-slate-700 dark:text-purple-300 font-bold"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <Sparkles size={13} />
                  AI Assistant
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={creationMode === "manual"}
                  onClick={() => setCreationMode("manual")}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    creationMode === "manual"
                      ? "bg-white text-purple-700 shadow-sm dark:bg-slate-700 dark:text-purple-300 font-bold"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <FileText size={13} />
                  Manual Form
                </button>
              </div>

              <div className="flex items-center gap-3">
                {creationMode === "manual" ? (
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                      isFormReady
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                    }`}
                  >
                    {isFormReady ? "Ready to save" : `Incomplete (${Object.keys(formErrors).length} required)`}
                  </span>
                ) : conversations.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">Previous:</span>
                    <select
                      value={conversation?.conversation_id || ""}
                      onChange={(event) => void resumeConversation(event.target.value)}
                      disabled={busy}
                      aria-label="Select conversation"
                      className="h-8 max-w-[190px] truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                    >
                      {conversations.map((item) => (
                        <option key={item.conversation_id} value={item.conversation_id}>
                          {item.draft.item_name
                            || item.history.find((entry) => entry.role === "user")?.content.slice(0, 30)
                            || `Request ${new Date(item.created_at).toLocaleDateString()}`}
                          {" · "}{item.status === "ACTIVE" ? "Active" : "Saved"}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            </div>

            {/* TAB 1: AI Assistant */}
            {creationMode === "ai" && (
              <div className="grid min-h-0 items-stretch gap-5 lg:grid-cols-12">
                {/* Left Column: Chat Conversation Thread */}
                <section className="flex h-[520px] sm:h-[560px] lg:h-[600px] min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
                  {/* Header Toolbar */}
                  <div className="flex flex-none items-center justify-between gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
                        <Sparkles size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                            AI Assistant
                          </h3>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {conversation?.status === "ACTIVE" ? "Active" : "Completed"}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block truncate">
                          Chat naturally to specify and clarify material requirements
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void startConversation()}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 active:scale-95 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                        title="Start new conversation"
                      >
                        <RotateCcw size={12} />
                        <span className="hidden sm:inline">New chat</span>
                      </button>
                    </div>
                  </div>

                  {/* Conflict alert if conversation state changed on server */}
                  {conversationNeedsReload && (
                    <div
                      role="alert"
                      className="mt-3 flex-none flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                    >
                      <span className="flex-1">This conversation has a newer server revision. Your unsent message and draft are preserved.</span>
                      <button
                        type="button"
                        onClick={() => void reloadConversation()}
                        disabled={busy}
                        className="font-bold underline disabled:opacity-50 cursor-pointer"
                      >
                        Reload conversation
                      </button>
                    </div>
                  )}

                  {/* Messages Thread */}
                  <div
                    className="my-3 min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain pr-1.5 custom-scrollbar"
                    aria-live="polite"
                  >
                    {!conversation || conversation.history.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8 space-y-2 text-slate-500 dark:text-slate-400">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400 mb-1">
                          <Sparkles size={20} />
                        </div>
                        <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                          How can I help with your material request?
                        </p>
                        <p className="text-xs max-w-sm">
                          Tell me what you need, including material name, specification or grade, quantity, unit, or delivery requirements.
                        </p>
                      </div>
                    ) : (
                      conversation.history.map((entry, index) => (
                        <div
                          key={`${index}-${entry.role}`}
                          className={`flex ${entry.role === "user" ? "justify-end" : "justify-start items-start gap-2.5"}`}
                        >
                          {entry.role === "assistant" && (
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400 mt-0.5">
                              <Sparkles size={13} />
                            </div>
                          )}
                          <div
                            className={`max-w-[85%] sm:max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed ${
                              entry.role === "user"
                                ? "rounded-br-xs bg-purple-600 text-white shadow-2xs"
                                : "rounded-bl-xs border border-slate-200/90 bg-slate-50/90 text-slate-800 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-200 shadow-2xs"
                            }`}
                          >
                            <p>{entry.content}</p>
                            <time
                              className={`mt-1 block text-[10px] ${
                                entry.role === "user" ? "text-purple-200" : "text-slate-400"
                              }`}
                            >
                              {new Date(entry.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </time>
                          </div>
                        </div>
                      ))
                    )}

                    {busy && (
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl w-fit">
                        <Loader2 size={14} className="animate-spin text-purple-600" />
                        <span>AI is analyzing material requirements…</span>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Chat Input Bar */}
                  {conversation?.status === "ACTIVE" ? (
                    <form
                      className="mt-auto flex flex-none items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
                      onSubmit={(event) => void sendMessage(event)}
                    >
                      <div className="relative flex flex-1 items-center rounded-full border border-slate-200 bg-slate-50/90 p-1 shadow-2xs transition focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500/20 dark:border-slate-700 dark:bg-slate-800/80">
                        <input
                          value={message}
                          disabled={busy || conversationNeedsReload}
                          onChange={(event) => {
                            setMessage(event.target.value);
                            setMessageRetryAvailable(false);
                          }}
                          placeholder="Describe material, grade, quantity, or delivery site…"
                          className="w-full bg-transparent px-3.5 py-1.5 text-xs sm:text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500"
                        />
                        <button
                          type="submit"
                          disabled={busy || conversationNeedsReload || !message.trim()}
                          className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white shadow-xs transition hover:bg-purple-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                          aria-label="Send message to AI Assistant"
                        >
                          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-auto flex flex-none items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800 text-xs text-slate-500">
                      <span>This conversation has been finalized.</span>
                      <button
                        type="button"
                        onClick={() => void startConversation()}
                        disabled={busy}
                        className="font-bold text-purple-700 underline dark:text-purple-300 cursor-pointer"
                      >
                        Start a new request
                      </button>
                    </div>
                  )}
                </section>

                {/* Right Column: Live Material Request Draft Preview & Save Workflow */}
                <aside className="flex h-[520px] sm:h-[560px] lg:h-[600px] min-h-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
                  {/* Preview Header */}
                  <div className="flex flex-none items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
                        <Package size={16} />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">Material Request Draft</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">Live extracted requirements</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isSavedFromConversation ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                          Saved ✓
                        </span>
                      ) : isFormReady ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 animate-pulse">
                          Ready to save ✨
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                          {filledDetailsCount}/3 required details
                        </span>
                      )}

                      {/* Mobile toggle */}
                      <button
                        type="button"
                        onClick={() => setIsDraftExpandedMobile((prev) => !prev)}
                        className="lg:hidden p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 cursor-pointer"
                        aria-label="Toggle details summary"
                      >
                        {isDraftExpandedMobile ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Detail Rows */}
                  <div className={`my-2 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 ${isDraftExpandedMobile ? "block" : "hidden lg:block"}`}>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {[
                        {
                          label: "Request title",
                          value: draft.title,
                          fallback: "Not specified yet",
                          icon: FileText,
                        },
                        {
                          label: "Material name",
                          value: draft.item_name,
                          fallback: "Not specified yet",
                          icon: Package,
                          isRequired: true,
                        },
                        {
                          label: "Quantity",
                          value: draft.quantity !== null && draft.quantity !== "" ? String(draft.quantity) : null,
                          fallback: "Not specified yet",
                          icon: Hash,
                          isRequired: true,
                        },
                        {
                          label: "Unit of measure",
                          value: draft.unit,
                          fallback: "Not specified yet",
                          icon: Hash,
                          isRequired: true,
                        },
                        {
                          label: "Specification / grade",
                          value: draft.specification,
                          fallback: "Not specified yet",
                          icon: FileText,
                        },
                        {
                          label: "Required by date",
                          value: draft.required_by ? new Date(draft.required_by).toLocaleDateString() : null,
                          fallback: "Not specified yet",
                          icon: Calendar,
                        },
                        {
                          label: "Delivery location",
                          value: draft.delivery_location,
                          fallback: "Not specified yet",
                          icon: MapPin,
                        },
                        {
                          label: "Notes",
                          value: draft.notes,
                          fallback: "Not specified yet",
                          icon: StickyNote,
                        },
                      ].map((item) => (
                        <div key={item.label} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)] items-center gap-3 py-2">
                          <span className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300">
                            {item.icon && <item.icon size={15} className="shrink-0 text-slate-400" />}
                            <span className="truncate">
                              {item.label}
                              {item.isRequired && <span className="text-rose-500 ml-0.5">*</span>}
                            </span>
                          </span>
                          <span
                            className={`text-right text-xs sm:text-sm truncate ${
                              item.value
                                ? "text-slate-900 dark:text-white font-bold"
                                : "text-slate-400 italic font-normal"
                            }`}
                          >
                            {item.value || item.fallback}
                          </span>
                        </div>
                      ))}

                      {/* Additional Requirements Tags */}
                      <div className="py-2.5">
                        <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                          <ListFilter size={15} className="shrink-0 text-slate-400" />
                          <span>Additional requirements</span>
                        </div>
                        {draft.additional_requirements && draft.additional_requirements.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {draft.additional_requirements.map((req, idx) => (
                              <span
                                key={`${req}-${idx}`}
                                className="inline-flex items-center rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-300"
                              >
                                {req}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs sm:text-sm text-slate-400 italic font-normal">None specified</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions pinned at bottom: Always visible Save action */}
                  <div className="flex-none pt-3 space-y-2 border-t border-slate-100 dark:border-slate-800">
                    {isSavedFromConversation ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                          <span>Material request saved!</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSection("saved-requests")}
                          className="font-bold underline text-emerald-800 dark:text-emerald-300 cursor-pointer"
                        >
                          View in Saved Requests
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveReviewedRequest(false)}
                          disabled={busy || conversationNeedsReload || !isFormReady}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-purple-700 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md transition hover:bg-purple-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        >
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                          Confirm &amp; Save Request
                        </button>

                        {!isFormReady && (
                          <p className="text-[11px] text-center text-slate-400">
                            Required to save: {missingRequiredFields.join(", ")}
                          </p>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      onClick={handleEditExtractedInManualForm}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      <span>Edit Details in Manual Form</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </aside>
              </div>
            )}

            {/* TAB 2: Manual Form (Independent of Gemini) */}
            {creationMode === "manual" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveReviewedRequest(true);
                  }}
                  className="space-y-6"
                >
                  {/* SECTION 1: MATERIAL DETAILS */}
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 pb-2 dark:border-slate-800">
                      1. Material Details
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {/* Request Title */}
                      <div className="space-y-1">
                        <label htmlFor="manual-title" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Request title <span className="text-slate-400 font-normal">(optional reference)</span>
                        </label>
                        <input
                          id="manual-title"
                          type="text"
                          maxLength={draftFieldMaxLengths.title}
                          value={draft.title || ""}
                          onChange={(e) => updateDraftField("title", e.target.value)}
                          placeholder="e.g. Steel Rebar for Foundation Block A"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 focus:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800"
                        />
                      </div>

                      {/* Material / Item Name */}
                      <div className="space-y-1">
                        <label htmlFor="manual-item_name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Material / item name <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="manual-item_name"
                          type="text"
                          maxLength={draftFieldMaxLengths.item_name}
                          value={draft.item_name || ""}
                          onChange={(e) => updateDraftField("item_name", e.target.value)}
                          onBlur={() => setTouchedFields((prev) => ({ ...prev, item_name: true }))}
                          placeholder="e.g. TMT Steel Bars, OPC Cement 53 Grade, River Sand"
                          className={`w-full rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 focus:bg-white dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800 ${
                            touchedFields.item_name && formErrors.item_name
                              ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                              : "border-slate-200 dark:border-slate-700"
                          }`}
                        />
                        {touchedFields.item_name && formErrors.item_name && (
                          <p className="text-xs font-medium text-rose-500">{formErrors.item_name}</p>
                        )}
                      </div>

                      {/* Quantity */}
                      <div className="space-y-1">
                        <label htmlFor="manual-quantity" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Quantity <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="manual-quantity"
                          type="number"
                          min="0.000001"
                          step="any"
                          value={draft.quantity === null ? "" : String(draft.quantity)}
                          onChange={(e) => updateDraftField("quantity", e.target.value)}
                          onBlur={() => setTouchedFields((prev) => ({ ...prev, quantity: true }))}
                          placeholder="e.g. 500"
                          className={`w-full rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 focus:bg-white dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800 ${
                            touchedFields.quantity && formErrors.quantity
                              ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                              : "border-slate-200 dark:border-slate-700"
                          }`}
                        />
                        {touchedFields.quantity && formErrors.quantity && (
                          <p className="text-xs font-medium text-rose-500">{formErrors.quantity}</p>
                        )}
                      </div>

                      {/* Unit */}
                      <div className="space-y-1">
                        <label htmlFor="manual-unit" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Unit of measure <span className="text-rose-500">*</span>
                        </label>
                        <div className="space-y-1.5">
                          <input
                            id="manual-unit"
                            type="text"
                            maxLength={draftFieldMaxLengths.unit}
                            value={draft.unit || ""}
                            onChange={(e) => updateDraftField("unit", e.target.value)}
                            onBlur={() => setTouchedFields((prev) => ({ ...prev, unit: true }))}
                            placeholder="e.g. MT, Bags, Pieces, Kg"
                            className={`w-full rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 focus:bg-white dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800 ${
                              touchedFields.unit && formErrors.unit
                                ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                                : "border-slate-200 dark:border-slate-700"
                            }`}
                          />
                          <div className="flex flex-wrap gap-1">
                            {commonUnits.map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() => updateDraftField("unit", u)}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition cursor-pointer ${
                                  draft.unit?.toLowerCase() === u.toLowerCase()
                                    ? "bg-purple-600 text-white"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                                }`}
                              >
                                {u}
                              </button>
                            ))}
                          </div>
                        </div>
                        {touchedFields.unit && formErrors.unit && (
                          <p className="text-xs font-medium text-rose-500">{formErrors.unit}</p>
                        )}
                      </div>

                      {/* Specification */}
                      <div className="sm:col-span-2 space-y-1">
                        <label htmlFor="manual-specification" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Specification or grade <span className="text-slate-400 font-normal">(recommended)</span>
                        </label>
                        <textarea
                          id="manual-specification"
                          rows={2}
                          maxLength={draftFieldMaxLengths.specification}
                          value={draft.specification || ""}
                          onChange={(e) => updateDraftField("specification", e.target.value)}
                          placeholder="e.g. Fe 550D TMT bars, 12mm & 16mm diameter, ISI certified, primary producers only"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 focus:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800"
                        />
                      </div>
                    </div>
                  </div>

                  {/* SECTION 2: SCHEDULE & DELIVERY */}
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 pb-2 dark:border-slate-800">
                      2. Schedule &amp; Delivery
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {/* Required By Date */}
                      <div className="space-y-1">
                        <label htmlFor="manual-required_by" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Required by date
                        </label>
                        <input
                          id="manual-required_by"
                          type="date"
                          value={draft.required_by || ""}
                          onChange={(e) => updateDraftField("required_by", e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 focus:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800"
                        />
                      </div>

                      {/* Delivery Location */}
                      <div className="space-y-1">
                        <label htmlFor="manual-delivery_location" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Delivery location / site
                        </label>
                        <input
                          id="manual-delivery_location"
                          type="text"
                          maxLength={draftFieldMaxLengths.delivery_location}
                          value={draft.delivery_location || ""}
                          onChange={(e) => updateDraftField("delivery_location", e.target.value)}
                          placeholder="e.g. Site #4, Sector 62, Noida, Uttar Pradesh"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 focus:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800"
                        />
                      </div>
                    </div>
                  </div>

                  {/* SECTION 3: REQUIREMENTS & NOTES */}
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 pb-2 dark:border-slate-800">
                      3. Requirements &amp; Notes
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {/* Additional Requirements */}
                      <div className="space-y-1">
                        <label htmlFor="manual-additional_requirements" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Additional requirements <span className="text-slate-400 font-normal">(one per line)</span>
                        </label>
                        <textarea
                          id="manual-additional_requirements"
                          rows={3}
                          value={draft.additional_requirements.join("\n")}
                          onChange={(e) => updateDraftField("additional_requirements", e.target.value)}
                          placeholder="e.g. Test certificate required with delivery&#10;Unloading at site by supplier&#10;Trailer access permitted only after 8 PM"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 focus:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800"
                        />
                      </div>

                      {/* Notes */}
                      <div className="space-y-1">
                        <label htmlFor="manual-notes" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Notes / instructions
                        </label>
                        <textarea
                          id="manual-notes"
                          rows={3}
                          maxLength={draftFieldMaxLengths.notes}
                          value={draft.notes || ""}
                          onChange={(e) => updateDraftField("notes", e.target.value)}
                          placeholder="e.g. Contact site engineer 2 hours prior to arrival for gate entry pass."
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 focus:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Confirmation & Actions */}
                  <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <label className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={manualConfirmed}
                        onChange={(e) => setManualConfirmed(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                      />
                      <span>
                        I confirm that these material specifications and quantities have been reviewed and are ready to be saved.
                      </span>
                    </label>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={busy || !isFormReady || !manualConfirmed}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-purple-700 px-6 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md transition hover:bg-purple-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      >
                        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
                        Confirm &amp; Save Request
                      </button>

                      <button
                        type="button"
                        onClick={() => setCreationMode("ai")}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Sparkles size={14} />
                        Switch to AI Assistant
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (confirmDiscardDraft()) {
                            setDraft(emptyDraft());
                            setManualConfirmed(false);
                            setTouchedFields({});
                          }
                        }}
                        className="text-xs text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 cursor-pointer ml-auto"
                      >
                        Clear form
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}
          </div>
        ) : section === "saved-requests" || section === "material-details" ? (
          /* SECTION 2: Saved Requests */
          <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
            {/* Left Column: Request List */}
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Your Saved Requests</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {requests.length} total
                </span>
              </div>

              {/* Search filter */}
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={savedRequestSearch}
                  onChange={(e) => setSavedRequestSearch(e.target.value)}
                  placeholder="Search saved requests…"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 py-2 text-xs font-medium text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-purple-600 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {requests.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700 space-y-2">
                  <Package size={24} className="mx-auto text-slate-400" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No saved requests yet</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Create your first material request using AI Assistant or Manual Form.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSection("new-request");
                      void startConversation();
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-800 cursor-pointer"
                  >
                    <Plus size={14} />
                    New Request
                  </button>
                </div>
              ) : filteredRequests.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">
                  No requests matching “{savedRequestSearch}”.
                </p>
              ) : (
                <ul className="space-y-2 max-h-[540px] overflow-y-auto custom-scrollbar pr-1">
                  {filteredRequests.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => void openRequest(item.id)}
                        disabled={busy}
                        className={`w-full rounded-xl border p-3.5 text-left transition cursor-pointer ${
                          activeRequest?.id === item.id
                            ? "border-purple-400 bg-purple-50/70 shadow-xs dark:border-purple-700 dark:bg-purple-950/30"
                            : "border-slate-200 hover:border-purple-300 hover:bg-slate-50/50 dark:border-slate-700 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">
                            {item.title || item.item_name}
                          </span>
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <Check size={11} /> {item.status}
                          </span>
                        </div>
                        <span className="mt-1 block text-xs font-semibold text-purple-700 dark:text-purple-300">
                          {item.quantity} {item.unit}
                          {item.specification ? ` · ${item.specification.slice(0, 40)}` : ""}
                        </span>
                        <span className="mt-1.5 block text-[11px] text-slate-400 dark:text-slate-500">
                          Saved {new Date(item.created_at).toLocaleDateString()}
                          {item.delivery_location ? ` · ${item.delivery_location.slice(0, 30)}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Right Column: Request Details & Edit */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-4 dark:border-slate-800">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {activeRequest ? (activeRequest.title || activeRequest.item_name) : "Request Details"}
                </h2>
                {activeRequest && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Revision: {activeRequest.revision}
                  </span>
                )}
              </div>

              {!activeRequest ? (
                <div className="rounded-xl bg-slate-50 p-8 text-center text-xs sm:text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  Select a saved request from the list to inspect or edit its specifications.
                </div>
              ) : (
                <form onSubmit={(event) => void saveRequestEdits(event)} className="space-y-4">
                  {/* Conflict alert when saved request changed on server */}
                  {staleRequestId === activeRequest.id && (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                    >
                      <span className="flex-1">
                        This saved request has a newer server revision. Your local edits are preserved; reload latest before saving.
                      </span>
                      <button
                        type="button"
                        onClick={() => void reloadRequest()}
                        disabled={busy}
                        className="font-bold underline disabled:opacity-50 cursor-pointer"
                      >
                        Reload latest request
                      </button>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    {draftFieldNames.map((field) => {
                      const multiline = ["specification", "delivery_location", "additional_requirements", "notes"].includes(field);
                      const inputType = field === "required_by" ? "date" : field === "quantity" ? "number" : "text";
                      const value = field === "additional_requirements"
                        ? requestDraft.additional_requirements.join("\n")
                        : requestDraft[field] === null ? "" : String(requestDraft[field]);

                      return (
                        <div
                          key={field}
                          className={field === "additional_requirements" || field === "notes" ? "sm:col-span-2" : ""}
                        >
                          <label
                            htmlFor={`request-${field}`}
                            className={`mb-1 block text-xs font-semibold ${
                              requestFieldErrors[field]
                                ? "text-rose-700 dark:text-rose-300"
                                : "text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {draftFieldLabels[field]}
                            {["item_name", "quantity", "unit"].includes(field) && (
                              <span className="text-rose-500 ml-0.5">*</span>
                            )}
                          </label>

                          {multiline ? (
                            <textarea
                              id={`request-${field}`}
                              rows={field === "additional_requirements" ? 3 : 2}
                              maxLength={draftFieldMaxLengths[field]}
                              value={value}
                              onChange={(event) => updateSavedRequestField(field, event.target.value)}
                              aria-invalid={Boolean(requestFieldErrors[field])}
                              aria-describedby={requestFieldErrors[field] ? `request-${field}-error` : undefined}
                              disabled={busy || staleRequestId === activeRequest.id}
                              className={`w-full rounded-xl border bg-white px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 disabled:bg-slate-100 dark:bg-slate-950 dark:text-white dark:disabled:bg-slate-900 ${
                                requestFieldErrors[field]
                                  ? "border-rose-500 dark:border-rose-500"
                                  : "border-slate-200 dark:border-slate-700"
                              }`}
                            />
                          ) : (
                            <input
                              id={`request-${field}`}
                              type={inputType}
                              min={field === "quantity" ? "0.000001" : undefined}
                              step={field === "quantity" ? "any" : undefined}
                              maxLength={draftFieldMaxLengths[field]}
                              value={value}
                              onChange={(event) => updateSavedRequestField(field, event.target.value)}
                              aria-invalid={Boolean(requestFieldErrors[field])}
                              aria-describedby={requestFieldErrors[field] ? `request-${field}-error` : undefined}
                              disabled={busy || staleRequestId === activeRequest.id}
                              className={`w-full rounded-xl border bg-white px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-900 outline-none transition focus:border-purple-600 disabled:bg-slate-100 dark:bg-slate-950 dark:text-white dark:disabled:bg-slate-900 ${
                                requestFieldErrors[field]
                                  ? "border-rose-500 dark:border-rose-500"
                                  : "border-slate-200 dark:border-slate-700"
                              }`}
                            />
                          )}
                          {requestFieldErrors[field] && (
                            <p
                              id={`request-${field}-error`}
                              className="mt-1 text-xs text-rose-700 dark:text-rose-300"
                            >
                              {requestFieldErrors[field]}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Updated {new Date(activeRequest.updated_at).toLocaleString()}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void deleteSavedRequest()}
                        disabled={busy}
                        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-300 px-4 py-2 text-xs sm:text-sm font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                      >
                        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        Delete Request
                      </button>
                      <button
                        type="submit"
                        disabled={busy || staleRequestId === activeRequest.id || !isRequestDirty}
                        className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-purple-700 px-5 py-2 text-xs sm:text-sm font-bold text-white shadow-md transition hover:bg-purple-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      >
                        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
                        Save edits
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </section>
          </div>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-8">
            <div className="mx-auto max-w-2xl text-center">
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                Planned · Not connected to a backend
              </span>
              <h2 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
                {plannedSectionDetails[section]?.title || "Procurement workspace"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                {plannedSectionDetails[section]?.description || "This procurement workflow is not available yet."}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onSectionChange("new-request")}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-purple-800"
                >
                  <PlusCircle size={16} /> Create material request
                </button>
                <button
                  type="button"
                  onClick={() => onSectionChange("saved-requests")}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ClipboardList size={16} /> Saved requests
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </AgentLayout>
  );
}
