import apiClient from "@/lib/api";

export interface BrainSource {
  id: string;
  label: string;
  value: string;
  period: string | null;
  source_agent: string;
  source_table: string;
  source_type: string;
  record_count: number | null;
  freshness: "live" | "indexed" | string;
  retrieved_at: string;
  source_updated_at: string | null;
  calculation_id: string | null;
  document_id: string | null;
}

export interface BrainAnswer {
  conversation_id: string;
  message_id: string | null;
  answer: string;
  answer_status: "validated" | "regenerated" | "fallback" | "clarification" | "general" | "not_verified";
  sources: BrainSource[];
  limitations: string[];
  conflicts: string[];
  generated_at: string;
}

export interface BrainConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface StoredEvidenceItem extends Omit<BrainSource, "document_id"> {
  detail?: { document_id?: string } | null;
}

export interface BrainMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "completed" | "failed";
  answer_status: BrainAnswer["answer_status"] | null;
  evidence: { items?: StoredEvidenceItem[]; limitations?: string[]; conflicts?: string[] } | null;
  error_code: string | null;
  created_at: string;
}

export interface BrainDocument {
  id: string;
  source_type: "upload" | "general_work_file" | "invoice_scan";
  filename: string;
  status: "pending" | "indexed" | "failed" | "deleted";
  embedding_status: "pending" | "embedded" | "not_configured" | "failed";
  error_code: string | null;
  chunk_count: number;
  indexed_at: string | null;
  created_at: string;
}

export interface BrainStatus {
  documents: Record<string, number>;
  documents_without_embeddings: number;
  last_indexed_at: string | null;
  sources: { agent: string; status: "connected" | "no_data"; freshness: string | null }[];
}

const BASE = "/api/v1/company-brain";

export const companyBrainApi = {
  status: () => apiClient.get<BrainStatus>(`${BASE}/status`).then((r) => r.data),
  ask: (question: string, conversationId?: string | null) =>
    apiClient
      .post<BrainAnswer>(`${BASE}/ask`, { question, ...(conversationId ? { conversation_id: conversationId } : {}) })
      .then((r) => r.data),
  summary: (periodName: string, conversationId?: string | null) =>
    apiClient
      .post<BrainAnswer>(`${BASE}/summary`, {
        period: { name: periodName },
        ...(conversationId ? { conversation_id: conversationId } : {}),
      })
      .then((r) => r.data),
  conversations: (search?: string) =>
    apiClient
      .get<{ conversations: BrainConversation[] }>(`${BASE}/conversations`, { params: search ? { search } : {} })
      .then((r) => r.data.conversations),
  conversation: (id: string) =>
    apiClient
      .get<{ conversation: BrainConversation; messages: BrainMessage[] }>(`${BASE}/conversations/${encodeURIComponent(id)}`)
      .then((r) => r.data),
  rename: (id: string, title: string) => apiClient.patch(`${BASE}/conversations/${encodeURIComponent(id)}`, { title }),
  remove: (id: string) => apiClient.delete(`${BASE}/conversations/${encodeURIComponent(id)}`),
  documents: () => apiClient.get<{ documents: BrainDocument[] }>(`${BASE}/documents`).then((r) => r.data.documents),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient
      .post<{ document: BrainDocument }>(`${BASE}/documents`, form, { headers: { "Content-Type": "multipart/form-data" } })
      .then((r) => r.data.document);
  },
  deleteDocument: (id: string) => apiClient.delete(`${BASE}/documents/${encodeURIComponent(id)}`),
  documentUrl: (id: string) =>
    apiClient.get<{ url: string }>(`${BASE}/documents/${encodeURIComponent(id)}/url`).then((r) => r.data.url),
};

/** Stored assistant messages carry their evidence; rebuild the source list shown under an answer. */
export function sourcesFromMessage(message: BrainMessage): BrainSource[] {
  return (message.evidence?.items ?? [])
    .filter((item) => item.source_type !== "unavailable")
    .map((item) => ({ ...item, document_id: item.detail?.document_id ?? null }));
}

const ERRORS: Record<string, string> = {
  INSUFFICIENT_CREDITS: "Your AI credits have run out. Add credits on the AI Credits page to keep using Company Brain.",
  AI_PRICING_NOT_CONFIGURED: "AI is not set up yet (no model price). Please contact GO LESKA support.",
  AI_FX_RATE_NOT_CONFIGURED: "AI is not set up yet (no exchange rate). Please contact GO LESKA support.",
  BILLING_UNAVAILABLE: "AI billing is temporarily unavailable. Please try again shortly.",
  BILLING_ACCOUNT_SUSPENDED: "Your AI billing account is suspended. Please contact GO LESKA support.",
  RATE_LIMITED: "You're asking questions very quickly. Please wait a minute and try again.",
  EMPLOYER_PROFILE_REQUIRED: "Company Brain is available to employer accounts only.",
  CONVERSATION_NOT_FOUND: "This conversation no longer exists.",
  UNSUPPORTED_FILE_TYPE: "This file type is not supported. Use PDF, DOCX, XLSX, CSV, TXT or an image.",
  FILE_TOO_LARGE: "This file is too large.",
  FILE_CONTENT_MISMATCH: "The file's contents don't match its extension.",
};

export function brainErrorText(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? ERRORS[detail] ?? fallback : fallback;
}
