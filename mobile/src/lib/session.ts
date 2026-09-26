import { Capacitor } from "@capacitor/core";
import { apiPost } from "./api";

const SESSION_KEY = "goleska_sec_session_key";

export function getSessionKey(): string {
  let value = localStorage.getItem(SESSION_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, value);
  }
  return value;
}

export function clearSessionKey() {
  localStorage.removeItem(SESSION_KEY);
}

export async function registerMobileSession() {
  const platform = Capacitor.getPlatform();
  const userAgent = navigator.userAgent;
  await apiPost("/api/v1/auth/session", {
    session_key: getSessionKey(),
    device_name: platform === "web" ? "Web browser" : `GLESKA ${platform}`,
    browser: userAgent,
    os: platform,
  });
}