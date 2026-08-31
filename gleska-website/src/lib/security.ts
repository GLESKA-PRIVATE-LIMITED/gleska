/**
 * security.ts — Client-side utilities for session tracking and security activity logging.
 *
 * IMPORTANT:
 * - This module does NOT store or transmit passwords, Supabase access tokens,
 *   refresh tokens, or any other authentication secrets.
 * - session_key is a random UUID generated per-browser; it is NOT a Supabase token.
 * - IP/location info is fetched from ipapi.co (public, no API key required) only
 *   at login time — not on every page load.
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserSession {
  id: string;
  user_id: string;
  session_key: string;
  device_name: string | null;
  browser: string | null;
  os: string | null;
  ip_address: string | null;
  city: string | null;
  country: string | null;
  first_seen: string;
  last_active: string;
  is_revoked: boolean;
  revoked_at: string | null;
}

export interface SecurityActivity {
  id: string;
  user_id: string;
  event_type: "login" | "logout" | "session_revoked" | "password_changed" | string;
  description: string | null;
  device_name: string | null;
  browser: string | null;
  os: string | null;
  city: string | null;
  country: string | null;
  created_at: string;
}

export interface DeviceInfo {
  browser: string;
  os: string;
  deviceName: string;
  userAgent: string;
}

export interface GeoInfo {
  city: string | null;
  country: string | null;
  ip: string | null;
}

// ---------------------------------------------------------------------------
// Session key (stored in localStorage, NOT a Supabase token)
// ---------------------------------------------------------------------------

const SESSION_KEY_STORAGE_KEY = "goleska_sec_session_key";

/**
 * Returns the persistent session key for this browser.
 * Creates a new one if none exists. This is a random UUID, not a Supabase token.
 */
export function getOrCreateSessionKey(): string {
  if (typeof window === "undefined") return "";
  try {
    let key = localStorage.getItem(SESSION_KEY_STORAGE_KEY);
    if (!key) {
      key = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY_STORAGE_KEY, key);
    }
    return key;
  } catch {
    return "";
  }
}

/**
 * Returns the current session key if it exists, null otherwise.
 */
export function getSessionKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SESSION_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// User-agent parsing (no external library needed — basic heuristics)
// ---------------------------------------------------------------------------

/**
 * Parses the browser user-agent string into human-readable device info.
 * Uses simple heuristics — accurate enough for display purposes.
 */
export function parseDeviceInfo(ua?: string): DeviceInfo {
  const userAgent = ua || (typeof navigator !== "undefined" ? navigator.userAgent : "");

  // OS detection
  let os = "Unknown OS";
  if (/Windows NT 10/.test(userAgent) || /Windows NT 11/.test(userAgent)) os = "Windows 10/11";
  else if (/Windows NT 6\.3/.test(userAgent)) os = "Windows 8.1";
  else if (/Windows/.test(userAgent)) os = "Windows";
  else if (/iPhone OS 1[5-9]/.test(userAgent) || /iPhone OS [2-9]\d/.test(userAgent)) os = "iOS";
  else if (/iPhone/.test(userAgent)) os = "iOS";
  else if (/iPad/.test(userAgent)) os = "iPadOS";
  else if (/Android/.test(userAgent)) {
    const match = userAgent.match(/Android (\d+)/);
    os = match ? `Android ${match[1]}` : "Android";
  } else if (/Mac OS X/.test(userAgent)) {
    if (/iPhone|iPad/.test(userAgent)) os = "iOS";
    else os = "macOS";
  } else if (/Linux/.test(userAgent)) os = "Linux";
  else if (/CrOS/.test(userAgent)) os = "Chrome OS";

  // Browser detection
  let browser = "Unknown Browser";
  if (/Edg\//.test(userAgent)) {
    const match = userAgent.match(/Edg\/(\d+)/);
    browser = match ? `Edge ${match[1]}` : "Edge";
  } else if (/OPR\//.test(userAgent)) {
    const match = userAgent.match(/OPR\/(\d+)/);
    browser = match ? `Opera ${match[1]}` : "Opera";
  } else if (/Firefox\//.test(userAgent)) {
    const match = userAgent.match(/Firefox\/(\d+)/);
    browser = match ? `Firefox ${match[1]}` : "Firefox";
  } else if (/Chrome\//.test(userAgent) && !/Chromium/.test(userAgent)) {
    const match = userAgent.match(/Chrome\/(\d+)/);
    browser = match ? `Chrome ${match[1]}` : "Chrome";
  } else if (/Safari\//.test(userAgent) && !/Chrome/.test(userAgent)) {
    const match = userAgent.match(/Version\/(\d+)/);
    browser = match ? `Safari ${match[1]}` : "Safari";
  } else if (/MSIE|Trident/.test(userAgent)) {
    browser = "Internet Explorer";
  }

  // Device type
  const isMobile = /Mobi|Android|iPhone|iPod/.test(userAgent);
  const isTablet = /iPad|Tablet/.test(userAgent);
  let deviceType = "Desktop";
  if (isTablet) deviceType = "Tablet";
  else if (isMobile) deviceType = "Mobile";

  const deviceName = `${browser} on ${os}`;

  return { browser, os, deviceName, userAgent };
}

// ---------------------------------------------------------------------------
// Geolocation via public IP lookup (no API key, only at login)
// ---------------------------------------------------------------------------

/**
 * Fetches approximate city/country from the caller's public IP.
 * Uses ipapi.co (free, no key, rate limited to 45 req/day per IP on free tier).
 * Only called at login time. Returns null fields on failure — never throws.
 */
export async function getGeoInfo(): Promise<GeoInfo> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    const res = await fetch("https://ipapi.co/json/", { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { city: null, country: null, ip: null };
    const data = await res.json();
    return {
      city: data.city || null,
      country: data.country_name || null,
      ip: data.ip || null,
    };
  } catch {
    return { city: null, country: null, ip: null };
  }
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

/**
 * Registers/upserts the current browser session in user_sessions.
 * Called after each successful login. Never throws — failures are silenced
 * to prevent blocking the login flow.
 */
export async function registerSession(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  try {
    const sessionKey = getOrCreateSessionKey();
    if (!sessionKey || !userId) return;

    const deviceInfo = parseDeviceInfo();
    const geo = await getGeoInfo();
    const now = new Date().toISOString();

    await supabase.from("user_sessions").upsert(
      {
        user_id: userId,
        session_key: sessionKey,
        device_name: deviceInfo.deviceName,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        ip_address: geo.ip,
        city: geo.city,
        country: geo.country,
        last_active: now,
        is_revoked: false,
      },
      {
        onConflict: "user_id,session_key",
        ignoreDuplicates: false,
      }
    );

    // Log the login event
    await logSecurityActivity(supabase, userId, {
      event_type: "login",
      description: `New login on ${deviceInfo.deviceName}`,
      device_name: deviceInfo.deviceName,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      city: geo.city,
      country: geo.country,
    });
  } catch (err) {
    // Never block the login flow
    console.warn("[security] registerSession failed silently:", err);
  }
}

/**
 * Updates last_active for the current session. Called on Security page load.
 * Never throws.
 */
export async function updateLastActive(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  try {
    const sessionKey = getSessionKey();
    if (!sessionKey || !userId) return;

    await supabase
      .from("user_sessions")
      .update({ last_active: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("session_key", sessionKey)
      .eq("is_revoked", false);
  } catch (err) {
    console.warn("[security] updateLastActive failed silently:", err);
  }
}

/**
 * Appends a security activity event to the audit log.
 * Never throws.
 */
export async function logSecurityActivity(
  supabase: SupabaseClient,
  userId: string,
  event: {
    event_type: string;
    description?: string;
    device_name?: string | null;
    browser?: string | null;
    os?: string | null;
    city?: string | null;
    country?: string | null;
  }
): Promise<void> {
  try {
    if (!userId) return;
    await supabase.from("security_activity").insert({
      user_id: userId,
      event_type: event.event_type,
      description: event.description || null,
      device_name: event.device_name || null,
      browser: event.browser || null,
      os: event.os || null,
      city: event.city || null,
      country: event.country || null,
    });
  } catch (err) {
    console.warn("[security] logSecurityActivity failed silently:", err);
  }
}

/**
 * Revokes a session by ID. Marks it as revoked in user_sessions and logs the event.
 * Returns true on success, false on error.
 */
export async function revokeSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  revokedSessionDeviceName?: string | null
): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("user_sessions")
      .update({ is_revoked: true, revoked_at: now })
      .eq("id", sessionId)
      .eq("user_id", userId); // RLS already enforces this; double-check in query too

    if (error) {
      console.error("[security] revokeSession error:", error);
      return false;
    }

    // Log the revocation event
    const deviceInfo = parseDeviceInfo();
    await logSecurityActivity(supabase, userId, {
      event_type: "session_revoked",
      description: revokedSessionDeviceName
        ? `Session revoked: ${revokedSessionDeviceName}`
        : "A session was revoked",
      device_name: deviceInfo.deviceName,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
    });

    return true;
  } catch (err) {
    console.error("[security] revokeSession failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable "time ago" string for a given ISO timestamp.
 */
export function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 30) return `${diffDay} days ago`;
  return new Date(isoString).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Formats an ISO timestamp as a friendly date string.
 */
export function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
