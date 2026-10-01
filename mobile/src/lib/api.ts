import { Capacitor } from "@capacitor/core";
import { environment, missingBackendConfiguration, missingSupabaseConfiguration } from "../config/environment";
import { getSupabaseClient } from "./supabase";

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  skipSupabaseAuth?: boolean;
  timeoutMs?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail?: unknown;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, detail?: unknown, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function messageFromDetail(detail: unknown, status: number): string {
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (typeof item !== "object" || item === null || !("msg" in item)) return [];
      const message = (item as { msg: unknown }).msg;
      const location = "loc" in item && Array.isArray((item as { loc: unknown }).loc)
        ? ((item as { loc: unknown[] }).loc).filter((part) => part !== "body").join(".")
        : "";
      return [typeof message === "string" ? `${location ? `${location}: ` : ""}${message}` : ""];
    }).filter(Boolean);
    if (messages.length) return messages.join(" ");
  }
  if (typeof detail === "object" && detail !== null && "message" in detail) {
    const message = (detail as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return `Request failed (${status}).`;
}

function getApiBaseUrl(): string {
  const url = new URL(environment.apiBaseUrl);
  if (Capacitor.getPlatform() === "android" && ["localhost", "127.0.0.1"].includes(url.hostname)) {
    url.hostname = "10.0.2.2";
  }
  return url.toString().replace(/\/$/, "");
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  if (missingBackendConfiguration()) {
    throw new Error("The GLESKA API URL is not configured for this build.");
  }

  const { body, skipSupabaseAuth = false, timeoutMs = 20000, headers: inputHeaders, ...requestOptions } = options;
  const headers = new Headers(inputHeaders);
  headers.set("Accept", "application/json");
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const sessionKey = localStorage.getItem("goleska_sec_session_key");
  if (sessionKey) headers.set("X-Goleska-Session-Key", sessionKey);

  if (!skipSupabaseAuth && !missingSupabaseConfiguration()) {
    const { data: { session } } = await getSupabaseClient().auth.getSession();
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...requestOptions,
      headers,
      credentials: "include",
      signal: controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 204) return undefined as T;

    const contentType = response.headers.get("content-type") || "";
    const payload: unknown = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const detail = typeof payload === "object" && payload !== null && "detail" in payload
        ? (payload as { detail: unknown }).detail
        : payload;
      const message = messageFromDetail(detail, response.status);
      const retryAfterSeconds = Number(response.headers.get("Retry-After")) || undefined;
      throw new ApiError(message, response.status, detail, retryAfterSeconds);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The request timed out. Check your connection and try again.", { cause: error });
    }
    throw new Error("Could not connect to GLESKA. Check your connection and API configuration.", { cause: error });
  } finally {
    window.clearTimeout(timeout);
  }
}

export const apiGet = <T>(path: string, options?: ApiRequestOptions) => apiRequest<T>(path, { ...options, method: "GET" });
export const apiPost = <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) => apiRequest<T>(path, { ...options, method: "POST", body });
export const apiPut = <T = unknown>(path: string, body: unknown, options?: ApiRequestOptions) => apiRequest<T>(path, { ...options, method: "PUT", body });