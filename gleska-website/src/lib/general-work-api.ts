// Typed client for the General Work workspace API (/api/v1/general-work).

import type { AxiosProgressEvent } from "axios";
import apiClient from "@/lib/api";

const BASE = "/api/v1/general-work";

export type GeneralWorkFileKind = "image" | "document";
export type GeneralWorkFileSource = "upload" | "camera" | "generated";

export interface GeneralWorkFile {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  kind: GeneralWorkFileKind;
  source: GeneralWorkFileSource;
  conversation_id: string | null;
  created_at: string;
  url: string | null;
}

export interface MessageAttachment {
  file_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  kind: GeneralWorkFileKind;
  url: string | null;
}

export interface GeneralWorkMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  attachments: MessageAttachment[];
  status: "completed" | "failed";
  /** Set on user messages; resending with the same id retries a failed reply. */
  client_message_id: string | null;
  created_at: string;
}

export interface GeneralWorkConversation {
  id: string;
  title: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

export interface GeneralWorkProject {
  id: string;
  name: string;
  description: string | null;
  conversation_count: number;
  created_at: string;
  updated_at: string;
}

export interface MessageExchange {
  conversation: GeneralWorkConversation;
  user_message: GeneralWorkMessage;
  assistant_message: GeneralWorkMessage;
}

export interface MessagePage {
  messages: GeneralWorkMessage[];
  has_more: boolean;
}

/** Client-side mirror of the backend upload rules (the backend re-validates everything). */
export const UPLOAD_RULES = {
  image: {
    extensions: ["png", "jpg", "jpeg", "webp"],
    accept: "image/png,image/jpeg,image/webp",
    maxBytes: 10 * 1024 * 1024,
  },
  document: {
    extensions: ["pdf", "docx", "xlsx", "csv", "txt"],
    accept: ".pdf,.docx,.xlsx,.csv,.txt",
    maxBytes: 25 * 1024 * 1024,
  },
} as const;

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const ERROR_MESSAGES: Record<string, string> = {
  UNSUPPORTED_FILE_TYPE: "This file type isn't supported.",
  FILE_TOO_LARGE: "This file is too large.",
  FILE_EMPTY: "This file is empty.",
  FILE_CONTENT_MISMATCH: "This file's contents don't match its file type.",
  UPLOAD_FAILED: "The file couldn't be uploaded. Please try again.",
  ATTACHMENT_NOT_FOUND: "One of the attachments is no longer available.",
  EMPTY_MESSAGE: "Type a message or attach a file first.",
  CONVERSATION_NOT_FOUND: "This conversation doesn't exist or was deleted.",
  PROJECT_NOT_FOUND: "This project doesn't exist or was deleted.",
  FILE_NOT_FOUND: "This file doesn't exist or was deleted.",
  UNSUPPORTED_AUDIO_TYPE: "This browser's audio format isn't supported for transcription.",
  AUDIO_TOO_LARGE: "The recording is too long. Please record a shorter message.",
  TRANSCRIPTION_AI_NOT_CONFIGURED: "Voice transcription isn't configured on the server yet.",
};

export function describeApiError(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && ERROR_MESSAGES[detail]) return ERROR_MESSAGES[detail];
  return fallback;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const generalWorkApi = {
  async listConversations(params: { search?: string; projectId?: string; limit?: number } = {}) {
    const { data } = await apiClient.get<{ conversations: GeneralWorkConversation[] }>(`${BASE}/conversations`, {
      params: { search: params.search || undefined, project_id: params.projectId, limit: params.limit },
    });
    return data.conversations;
  },
  async createConversation(projectId?: string | null) {
    const { data } = await apiClient.post<GeneralWorkConversation>(`${BASE}/conversations`, {
      project_id: projectId || null,
    });
    return data;
  },
  async getConversation(conversationId: string) {
    const { data } = await apiClient.get<GeneralWorkConversation>(`${BASE}/conversations/${conversationId}`);
    return data;
  },
  async updateConversation(
    conversationId: string,
    changes: { title?: string; project_id?: string; clear_project?: boolean },
  ) {
    const { data } = await apiClient.patch<GeneralWorkConversation>(`${BASE}/conversations/${conversationId}`, changes);
    return data;
  },
  async deleteConversation(conversationId: string) {
    await apiClient.delete(`${BASE}/conversations/${conversationId}`);
  },
  async listMessages(conversationId: string, before?: string, limit = 30) {
    const { data } = await apiClient.get<MessagePage>(`${BASE}/conversations/${conversationId}/messages`, {
      params: { before, limit },
    });
    return data;
  },
  async sendMessage(
    conversationId: string,
    payload: { content: string; attachment_ids: string[]; client_message_id: string },
  ) {
    const { data } = await apiClient.post<MessageExchange>(
      `${BASE}/conversations/${conversationId}/messages`,
      payload,
      { timeout: 180_000 },
    );
    return data;
  },
  async uploadFile(
    file: File | Blob,
    filename: string,
    source: "upload" | "camera",
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
  ) {
    const form = new FormData();
    form.append("file", file, filename);
    form.append("source", source);
    const { data } = await apiClient.post<GeneralWorkFile>(`${BASE}/files`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      signal,
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (onProgress && event.total) onProgress(event.loaded / event.total);
      },
    });
    return data;
  },
  async listFiles(params: { kind?: GeneralWorkFileKind; search?: string; limit?: number } = {}) {
    const { data } = await apiClient.get<{ items: GeneralWorkFile[] }>(`${BASE}/files`, {
      params: { kind: params.kind, search: params.search || undefined, limit: params.limit },
    });
    return data.items;
  },
  async fileUrl(fileId: string, download = false) {
    const { data } = await apiClient.get<{ url: string }>(`${BASE}/files/${fileId}/url`, { params: { download } });
    return data.url;
  },
  async deleteFile(fileId: string) {
    await apiClient.delete(`${BASE}/files/${fileId}`);
  },
  async listProjects() {
    const { data } = await apiClient.get<{ projects: GeneralWorkProject[] }>(`${BASE}/projects`);
    return data.projects;
  },
  async getProject(projectId: string) {
    const { data } = await apiClient.get<GeneralWorkProject>(`${BASE}/projects/${projectId}`);
    return data;
  },
  async createProject(name: string, description?: string) {
    const { data } = await apiClient.post<GeneralWorkProject>(`${BASE}/projects`, {
      name,
      description: description || null,
    });
    return data;
  },
  async updateProject(projectId: string, changes: { name?: string; description?: string | null }) {
    const { data } = await apiClient.patch<GeneralWorkProject>(`${BASE}/projects/${projectId}`, changes);
    return data;
  },
  async deleteProject(projectId: string) {
    await apiClient.delete(`${BASE}/projects/${projectId}`);
  },
  async transcribe(audio: Blob) {
    const form = new FormData();
    const extension = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "m4a" : "webm";
    form.append("audio", audio, `voice.${extension}`);
    const { data } = await apiClient.post<{ text: string }>(`${BASE}/transcribe`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120_000,
    });
    return data.text;
  },
};
