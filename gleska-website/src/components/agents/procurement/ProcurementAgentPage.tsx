"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, LoaderCircle, MessageCircle, Plus, Save } from "lucide-react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import {
  MaterialRequestDraft,
  ProcurementConversation,
  ProcurementMaterialRequest,
  procurementApi,
} from "@/lib/procurement-api";
import { procurementConfig } from "./procurementConfig";

type Section = "new-request" | "saved-requests";
type DraftField = keyof MaterialRequestDraft;

const draftFieldLabels: Record<DraftField, string> = {
  title: "Request title",
  item_name: "Material / item name",
  specification: "Specification or grade",
  quantity: "Quantity",
  unit: "Unit of measure",
  required_by: "Required by",
  delivery_location: "Delivery location",
  additional_requirements: "Additional requirements",
  notes: "Notes",
};

const draftFieldNames = Object.keys(draftFieldLabels) as DraftField[];

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
    ...value,
    quantity: value.quantity === null ? null : String(value.quantity),
    additional_requirements: value.additional_requirements || [],
  };
}

function errorMessage(error: unknown, fallback: string): string {
  const response = (error as {
    response?: { data?: { detail?: unknown } };
  })?.response?.data?.detail;
  if (typeof response === "string") {
    const readable: Record<string, string> = {
      STALE_CONVERSATION_STATE: "This conversation changed in another tab. Reload it before continuing.",
      REQUIRED_FIELDS_NOT_CONFIRMED: "Confirm the material name, quantity, and unit before saving.",
      CONVERSATION_NOT_ACTIVE: "This conversation is already complete. Start a new request to continue.",
      STALE_MATERIAL_REQUEST: "This saved request changed in another tab. Reload it before editing.",
    };
    return readable[response] || response.replaceAll("_", " ").toLowerCase();
  }
  if (Array.isArray(response)) {
    const messages = response
      .map((item) => {
        if (typeof item !== "object" || item === null || !("msg" in item)) return "";
        return String(item.msg);
      })
      .filter(Boolean);
    if (messages.length) return messages.join(" ");
  }
  return fallback;
}

export default function ProcurementAgentPage() {
  const [section, setSection] = useState<Section>("new-request");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [actionError, setActionError] = useState("");
  const [conversations, setConversations] = useState<ProcurementConversation[]>([]);
  const [conversation, setConversation] = useState<ProcurementConversation | null>(null);
  const [requests, setRequests] = useState<ProcurementMaterialRequest[]>([]);
  const [draft, setDraft] = useState<MaterialRequestDraft>(emptyDraft);
  const [confirmedFields, setConfirmedFields] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [activeRequest, setActiveRequest] = useState<ProcurementMaterialRequest | null>(null);
  const [requestDraft, setRequestDraft] = useState<MaterialRequestDraft>(emptyDraft);
  const idempotencyRef = useRef<{ conversationId: string; key: string } | null>(null);

  const selectConversation = (value: ProcurementConversation) => {
    setConversation(value);
    setDraft(editableDraft(value.draft));
    setConfirmedFields(value.confirmed_fields);
    setConversations((current) => [
      value,
      ...current.filter((item) => item.conversation_id !== value.conversation_id),
    ]);
    setActionError("");
  };

  const refreshRequests = async () => {
    const latest = await procurementApi.listRequests();
    setRequests(latest);
    return latest;
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setWorkspaceError("");
      try {
        const [loadedConversations, loadedRequests] = await Promise.all([
          procurementApi.listConversations(),
          procurementApi.listRequests(),
        ]);
        if (!active) return;
        setConversations(loadedConversations);
        setRequests(loadedRequests);
        const resumable = loadedConversations.find((item) => item.status === "ACTIVE")
          || loadedConversations[0];
        if (resumable) {
          const latest = await procurementApi.getConversation(resumable.conversation_id);
          if (active) selectConversation(latest);
        }
      } catch (error) {
        if (active) setWorkspaceError(errorMessage(error, "Unable to load Procurement requests."));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const startConversation = async () => {
    setBusy(true);
    setActionError("");
    try {
      const created = await procurementApi.createConversation();
      setConversations((current) => [created, ...current]);
      selectConversation(created);
      setMessage("");
      idempotencyRef.current = null;
      setSection("new-request");
    } catch (error) {
      setActionError(errorMessage(error, "Unable to start a Procurement conversation."));
    } finally {
      setBusy(false);
    }
  };

  const resumeConversation = async (id: string) => {
    if (!id) return;
    setBusy(true);
    setActionError("");
    try {
      const loaded = await procurementApi.getConversation(id);
      selectConversation(loaded);
      setSection("new-request");
    } catch (error) {
      setActionError(errorMessage(error, "Unable to restore this conversation."));
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (!conversation || !text || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = await procurementApi.sendMessage(
        conversation.conversation_id,
        text,
        conversation.revision,
      );
      selectConversation(updated);
      setConversations((current) => [
        updated,
        ...current.filter((item) => item.conversation_id !== updated.conversation_id),
      ]);
      setMessage("");
    } catch (error) {
      setActionError(errorMessage(error, "The assistant could not process that message. Please retry."));
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
  };

  const getSaveIdempotencyKey = (conversationId: string): string => {
    if (idempotencyRef.current?.conversationId === conversationId) {
      return idempotencyRef.current.key;
    }
    const storageKey = `gleska:procurement:save:${conversationId}`;
    const storedKey = window.localStorage.getItem(storageKey);
    const key = storedKey || crypto.randomUUID();
    if (!storedKey) window.localStorage.setItem(storageKey, key);
    idempotencyRef.current = { conversationId, key };
    return key;
  };

  const toggleConfirmed = (field: DraftField, checked: boolean) => {
    setConfirmedFields((current) => checked
      ? [...new Set([...current, field])]
      : current.filter((item) => item !== field));
  };

  const saveReviewedRequest = async () => {
    if (!conversation || conversation.status !== "ACTIVE" || busy) return;
    if (!draft.item_name?.trim() || !draft.quantity || !draft.unit?.trim()) {
      setActionError("Enter a material name, quantity, and unit before saving.");
      return;
    }
    if (!["item_name", "quantity", "unit"].every((field) => confirmedFields.includes(field))) {
      setActionError("Review and confirm the material name, quantity, and unit before saving.");
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      const reviewed = await procurementApi.updateDraft(
        conversation.conversation_id,
        draft,
        confirmedFields,
        conversation.revision,
      );
      selectConversation(reviewed);
      const pendingIdempotency = getSaveIdempotencyKey(reviewed.conversation_id);
      const saved = await procurementApi.saveRequest(
        reviewed.conversation_id,
        reviewed.revision,
        pendingIdempotency,
      );
      setActiveRequest(saved);
      setRequestDraft(editableDraft(saved));
      setRequests((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setSection("saved-requests");
      const latestConversation = await procurementApi.getConversation(reviewed.conversation_id);
      selectConversation(latestConversation);
      await refreshRequests();
      window.localStorage.removeItem(`gleska:procurement:save:${reviewed.conversation_id}`);
      idempotencyRef.current = null;
    } catch (error) {
      setActionError(errorMessage(error, "Unable to save this material request. Your draft remains available."));
    } finally {
      setBusy(false);
    }
  };

  const openRequest = async (id: string) => {
    setBusy(true);
    setActionError("");
    try {
      const loaded = await procurementApi.getRequest(id);
      setActiveRequest(loaded);
      setRequestDraft(editableDraft(loaded));
    } catch (error) {
      setActionError(errorMessage(error, "Unable to load the saved request."));
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
    setActionError("");
  };

  const saveRequestEdits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRequest || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = await procurementApi.updateRequest(
        activeRequest.id,
        requestDraft,
        activeRequest.revision,
      );
      setActiveRequest(updated);
      setRequestDraft(editableDraft(updated));
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      setActionError(errorMessage(error, "Unable to update this request. Reload it and try again."));
    } finally {
      setBusy(false);
    }
  };

  const onSectionChange = (id: string) => {
    if (id === "new-request" || id === "saved-requests") {
      setSection(id);
      setActionError("");
    }
  };

  return (
    <AgentLayout
      config={procurementConfig}
      activeTab={section}
      setActiveTab={onSectionChange}
    >
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-purple-700 dark:text-purple-300">
            Procurement Agent · Phase 1
          </p>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-[var(--font-anton)] text-3xl uppercase tracking-wide text-slate-900 dark:text-white sm:text-4xl">
                {section === "new-request" ? "Material request" : "Saved requests"}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                Describe what you need, review the structured details, and save your request.
                This phase does not contact suppliers or place orders.
              </p>
            </div>
            {section === "new-request" && (
              <button
                type="button"
                onClick={() => void startConversation()}
                disabled={busy || loading}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus size={17} />
                Start new request
              </button>
            )}
          </div>
        </header>

        {workspaceError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{workspaceError}</span>
          </div>
        )}
        {actionError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-sm font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <LoaderCircle size={18} className="animate-spin" />
            Loading your Procurement workspace…
          </div>
        ) : section === "new-request" ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <MessageCircle size={19} className="text-purple-700 dark:text-purple-300" />
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">Conversation</h2>
                </div>
                {conversations.length > 0 && (
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Open conversation
                    <select
                      value={conversation?.conversation_id || ""}
                      onChange={(event) => void resumeConversation(event.target.value)}
                      disabled={busy}
                      className="ml-2 max-w-48 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    >
                      {conversations.map((item) => (
                        <option key={item.conversation_id} value={item.conversation_id}>
                          {item.draft.item_name
                            || item.history.find((entry) => entry.role === "user")?.content.slice(0, 42)
                            || `Request started ${new Date(item.created_at).toLocaleDateString()}`}
                          {" · "}{item.status === "ACTIVE" ? "In progress" : "Saved"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {!conversation ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
                  <p className="text-sm text-slate-600 dark:text-slate-300">Start a conversation to describe your material requirement.</p>
                  <button
                    type="button"
                    onClick={() => void startConversation()}
                    disabled={busy}
                    className="mt-4 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60"
                  >
                    Start conversation
                  </button>
                </div>
              ) : (
                <>
                  <div className="max-h-[420px] min-h-56 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-4 dark:bg-slate-950/70">
                    {conversation.history.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Tell me what material you need, including any known size, grade, quantity, or delivery details.
                      </p>
                    ) : conversation.history.map((item, index) => (
                      <div
                        key={`${item.created_at}-${index}`}
                        className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${
                          item.role === "user"
                            ? "ml-auto bg-purple-700 text-white"
                            : "bg-white text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{item.content}</p>
                        <time className={`mt-1 block text-[10px] ${item.role === "user" ? "text-purple-100" : "text-slate-400"}`}>
                          {new Date(item.created_at).toLocaleString()}
                        </time>
                      </div>
                    ))}
                    {busy && (
                      <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
                        <LoaderCircle size={15} className="animate-spin" />
                        Working…
                      </div>
                    )}
                  </div>
                  {conversation.status === "ACTIVE" ? (
                    <form onSubmit={(event) => void sendMessage(event)} className="space-y-3">
                      <label htmlFor="procurement-message" className="sr-only">Describe or clarify the material request</label>
                      <textarea
                        id="procurement-message"
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        maxLength={4000}
                        rows={3}
                        placeholder="Describe your material requirement or answer a clarification…"
                        className="w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                      <button
                        type="submit"
                        disabled={busy || !message.trim()}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busy && <LoaderCircle size={16} className="animate-spin" />}
                        Send message
                      </button>
                    </form>
                  ) : (
                    <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                      This request has been saved. Start a new request to begin another conversation.
                    </p>
                  )}
                </>
              )}
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Review material details</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Agent suggestions are unconfirmed until you review and confirm them here.
                </p>
              </div>
              {!conversation ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  Start a conversation to build a request draft.
                </p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {draftFieldNames.map((field) => {
                      const multiline = ["specification", "delivery_location", "additional_requirements", "notes"].includes(field);
                      const inputType = field === "required_by" ? "date" : field === "quantity" ? "number" : "text";
                      const value = field === "additional_requirements"
                        ? draft.additional_requirements.join("\n")
                        : draft[field] === null ? "" : String(draft[field]);
                      return (
                        <div key={field} className={field === "additional_requirements" || field === "notes" ? "sm:col-span-2" : ""}>
                          <label htmlFor={`draft-${field}`} className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">
                            {draftFieldLabels[field]}
                          </label>
                          {multiline ? (
                            <textarea
                              id={`draft-${field}`}
                              rows={field === "additional_requirements" ? 3 : 2}
                              value={value}
                              onChange={(event) => updateDraftField(field, event.target.value)}
                              disabled={!conversation || conversation.status !== "ACTIVE" || busy}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-purple-600 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-900"
                            />
                          ) : (
                            <input
                              id={`draft-${field}`}
                              type={inputType}
                              min={field === "quantity" ? "0.000001" : undefined}
                              step={field === "quantity" ? "any" : undefined}
                              value={value}
                              onChange={(event) => updateDraftField(field, event.target.value)}
                              disabled={!conversation || conversation.status !== "ACTIVE" || busy}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-purple-600 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-900"
                            />
                          )}
                          {conversation?.status === "ACTIVE" && (
                            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                              <input
                                type="checkbox"
                                checked={confirmedFields.includes(field)}
                                disabled={!value || busy}
                                onChange={(event) => toggleConfirmed(field, event.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 accent-purple-700"
                              />
                              I reviewed and confirm this field
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {conversation.status === "ACTIVE" && (
                    <button
                      type="button"
                      onClick={() => void saveReviewedRequest()}
                      disabled={busy}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
                      Review and save request
                    </button>
                  )}
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Your requests</h2>
              {requests.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No saved material requests yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {requests.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => void openRequest(item.id)}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          activeRequest?.id === item.id
                            ? "border-purple-400 bg-purple-50 dark:border-purple-700 dark:bg-purple-950/30"
                            : "border-slate-200 hover:border-purple-300 dark:border-slate-700"
                        }`}
                      >
                        <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">
                          {item.title || item.item_name}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                          {item.quantity} {item.unit} · Saved {new Date(item.created_at).toLocaleDateString()}
                        </span>
                        <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                          <Check size={12} /> {item.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Request details</h2>
              {!activeRequest ? (
                <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  Select a saved request to review or edit it.
                </p>
              ) : (
                <form onSubmit={(event) => void saveRequestEdits(event)} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {draftFieldNames.map((field) => {
                      const multiline = ["specification", "delivery_location", "additional_requirements", "notes"].includes(field);
                      const inputType = field === "required_by" ? "date" : field === "quantity" ? "number" : "text";
                      const value = field === "additional_requirements"
                        ? requestDraft.additional_requirements.join("\n")
                        : requestDraft[field] === null ? "" : String(requestDraft[field]);
                      return (
                        <div key={field} className={field === "additional_requirements" || field === "notes" ? "sm:col-span-2" : ""}>
                          <label htmlFor={`request-${field}`} className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">
                            {draftFieldLabels[field]}
                          </label>
                          {multiline ? (
                            <textarea
                              id={`request-${field}`}
                              rows={field === "additional_requirements" ? 3 : 2}
                              value={value}
                              onChange={(event) => updateSavedRequestField(field, event.target.value)}
                              disabled={busy}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-purple-600 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-900"
                            />
                          ) : (
                            <input
                              id={`request-${field}`}
                              type={inputType}
                              min={field === "quantity" ? "0.000001" : undefined}
                              step={field === "quantity" ? "any" : undefined}
                              value={value}
                              onChange={(event) => updateSavedRequestField(field, event.target.value)}
                              disabled={busy}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-purple-600 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-900"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Status: {activeRequest.status} · Updated {new Date(activeRequest.updated_at).toLocaleString()}
                    </p>
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
                      Save edits
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </div>
    </AgentLayout>
  );
}
