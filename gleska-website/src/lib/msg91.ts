"use client";

import { OtpVerificationError, SignupFlowError, classifyOtpVerificationError } from "@/lib/auth-errors";

export type Msg91SdkMethods = {
  sendOtp: (
    mobile: string,
    success?: (data: unknown) => void,
    failure?: (error: unknown) => void
  ) => void;
  verifyOtp: (
    otp: string | number,
    success?: (data: unknown) => void,
    failure?: (error: unknown) => void
  ) => void;
  retryOtp: (
    channel: string | null,
    success?: (data: unknown) => void,
    failure?: (error: unknown) => void,
    reqId?: string
  ) => void;
  initSendOTP?: (configuration: unknown) => void;
};

export interface Msg91Window extends Window {
  initSendOTP?: Msg91SdkMethods["initSendOTP"];
  sendOtp?: Msg91SdkMethods["sendOtp"];
  verifyOtp?: Msg91SdkMethods["verifyOtp"];
  retryOtp?: Msg91SdkMethods["retryOtp"];
  __msg91_widget_ready__?: boolean;
  __msg91_widget_initialized__?: boolean;
}

const SDK_URL = "https://verify.msg91.com/otp-provider.js";
const SDK_TIMEOUT_MS = 10000;
const OTP_TIMEOUT_MS = 20000;

let sdkPromise: Promise<void> | null = null;
type OtpOperation = "send" | "verify" | "retry";
export type Msg91OperationLock = symbol;

let activeOtpOperation: { operation: OtpOperation; lock: Msg91OperationLock } | null = null;
let verificationCompleted = false;

export function otpUserMessage(error: unknown, operation: "send" | "verify" | "resend" | "auth" = "verify"): string {
  if (error instanceof SignupFlowError) return error.message;
  const errorRecord = asRecord(error);
  const response = asRecord(errorRecord?.response);
  const responseData = asRecord(response?.data);
  const details = responseData?.detail ?? errorRecord?.detail ?? errorRecord?.message ?? error;
  const text = typeof details === "string" ? details : String(asRecord(details)?.message ?? "");
  const normalized = text.toLowerCase();
  const headers = asRecord(response?.headers);
  const retryHeader = headers?.["retry-after"] ?? headers?.["Retry-After"];
  const parsedRetry = typeof retryHeader === "string" ? Number(retryHeader) : Number.NaN;
  const durationMatch = normalized.match(/(\d+)\s*(?:seconds?|secs?)\b/);
  const retryAfter = Number.isFinite(parsedRetry) && parsedRetry > 0
    ? Math.ceil(parsedRetry)
    : durationMatch ? Number(durationMatch[1]) : 30;

  if (normalized === "email not found. please register first.") {
    return "Email not found. Please register first.";
  }
  if (normalized === "mobile number not found. please register first.") {
    return "Mobile number not found. Please register first.";
  }
  if (/otp_resend_cooldown|please wait before requesting/.test(normalized)) {
    return `Please wait ${retryAfter} seconds before requesting another OTP.`;
  }
  if (/already used|already verified|code\s*703|otp_already_used/.test(normalized)) {
    return "This OTP has already been used. Request a new OTP and try again.";
  }
  if (/expired|invalid_or_expired_otp/.test(normalized)) {
    return "This OTP session has expired. Request a new OTP and try again.";
  }
  if (/invalid otp|incorrect otp|wrong otp|otp_invalid/.test(normalized)) {
    return "The OTP you entered is incorrect. Check the latest OTP and try again.";
  }
  if (/request.?id|transaction.*missing|otp session.*expired/.test(normalized)) {
    return "This OTP session has expired. Request a new OTP and try again.";
  }
  if (/invalid login credentials|invalid_credentials/.test(normalized)) {
    return "The email or password is incorrect. Check your sign-in details and try again.";
  }
  if (/no account exists|sign up first/.test(normalized)) {
    return "No account was found for this mobile number. Sign up to create an account.";
  }
  if (/duplicate|already exists|user_already_exists|email_exists|account_identifier_conflict/.test(normalized)) {
    return "An account already exists with these details. Sign in or use account recovery.";
  }
  if (/terms.*accepted|accept the terms/.test(normalized)) {
    return "Accept the Terms & Conditions before creating your account.";
  }
  if (/role_conflict|admin_role_unauthorized/.test(normalized)) {
    return "This account cannot use the selected account type. Sign in with the correct account.";
  }
  if (/ipblocked|invalid_grant|configuration|widget|jwt|provider access token|msg91_service_unavailable|service unavailable/.test(normalized)) {
    return "OTP service is temporarily unavailable. Please try again later.";
  }
  if (/timeout|timed out|network|could not connect|connection/.test(normalized)) {
    return "We couldn't complete the OTP request. Check your connection and try again.";
  }
  if (/user_provisioning_failed|auth_user_creation_failed|session_registration_failed/.test(normalized)) {
    return "Your verification succeeded, but we couldn't finish setting up your account. Sign in or contact support.";
  }
  if (/invalid_msg91_token|msg91_mobile_mismatch|msg91_verified_mobile_missing/.test(normalized)) {
    return "We couldn't verify this phone number. Request a new OTP for the number you entered.";
  }
  if (/enter a valid|passwords do not match|password must|is required|choose an account|enter your email|enter your name/.test(normalized)) {
    return text;
  }
  if (operation === "send") return "We couldn't send the OTP right now. Please try again in a moment.";
  if (operation === "resend") return "We couldn't resend the OTP right now. Please try again in a moment.";
  if (operation === "auth") return "We couldn't complete sign-in or account setup. Check your details and try again.";
  return "We couldn't verify the OTP. Check the latest code or request a new one.";
}

function beginOtpOperation(
  operation: OtpOperation,
  lock?: Msg91OperationLock
): { lock: Msg91OperationLock; ownsLock: boolean } {
  if (activeOtpOperation) {
    if (lock && activeOtpOperation.operation === operation && activeOtpOperation.lock === lock) {
      return { lock, ownsLock: false };
    }
    throw new Error("OTP_OPERATION_IN_PROGRESS");
  }
  if (operation === "verify" && verificationCompleted) {
    throw new OtpVerificationError("OTP_ALREADY_USED");
  }
  const operationLock = lock ?? Symbol(operation);
  activeOtpOperation = { operation, lock: operationLock };
  return { lock: operationLock, ownsLock: true };
}

function finishOtpOperation(lock: Msg91OperationLock): void {
  if (activeOtpOperation?.lock === lock) activeOtpOperation = null;
}

export async function runWithOtpOperationLock<T>(
  operation: OtpOperation,
  action: (lock: Msg91OperationLock) => Promise<T>
): Promise<T> {
  const { lock, ownsLock } = beginOtpOperation(operation);
  try {
    return await action(lock);
  } finally {
    if (ownsLock) finishOtpOperation(lock);
  }
}

export function normalizeIndianMobile(mobile: string): string {
  const cleaned = mobile.replace(/\D/g, "");
  if (!cleaned) return "";
  if (cleaned.length === 10) return `91${cleaned}`;
  if (cleaned.length === 12 && cleaned.startsWith("91")) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith("0")) return `91${cleaned.slice(1)}`;
  return cleaned;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeDiagnosticText(value: string, sensitiveValues: string[]): string {
  let sanitized = value;
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue) sanitized = sanitized.split(sensitiveValue).join("[redacted]");
  }

  return sanitized
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/([?&](?:access_token|token|auth|secret|key|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(?<!\d)\+?\d(?:[\d\s().-]*\d)?(?!\d)/g, (match) =>
      match.replace(/\D/g, "").length >= 4 ? "[redacted-number]" : match
    )
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted-value]")
    .slice(0, 240);
}

function logSdkFailure(
  operation: "sendOtp" | "retryOtp",
  error: unknown,
  globalWindow: Msg91Window,
  channel: "SMS" | "EMAIL" | "unknown",
  requestId?: string | null,
  sensitiveValues: string[] = []
): void {
  const record = asRecord(error);
  const nestedRecord = asRecord(record?.error) ?? asRecord(record?.data);
  const details = nestedRecord ?? record;
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : details?.message;
  const rawType = details?.type ?? details?.category ?? (error instanceof Error ? error.name : details?.name);
  const rawCode = details?.code ?? record?.code;
  const secrets = [
    ...sensitiveValues,
    process.env.NEXT_PUBLIC_MSG91_WIDGET_ID ?? "",
    process.env.NEXT_PUBLIC_MSG91_TOKEN ?? "",
  ];
  const safeText = (value: unknown): string | undefined => {
    if (typeof value !== "string" || !value) return undefined;
    return sanitizeDiagnosticText(value, secrets);
  };
  const safeCode = typeof rawCode === "number" ? rawCode : safeText(rawCode);
  const safeType = safeText(rawType);

  console.error(`[MSG91][TEMP DEBUG] ${operation} failure details.`, {
    operation,
    callbackObjectKeys: record
      ? Object.keys(record).filter((key) => /^[A-Za-z_$][\w$.-]{0,63}$/.test(key)).slice(0, 32)
      : null,
    ...(safeCode !== undefined ? { errorCode: safeCode } : {}),
    ...(safeText(rawMessage) ? { errorMessage: safeText(rawMessage) } : {}),
    ...(safeType ? { errorType: safeType } : {}),
    ...(operation === "retryOtp" ? {
      requestIdExists: Boolean(requestId?.trim()),
      requestIdLength: requestId?.length ?? 0,
    } : {}),
    widgetInitialized: globalWindow.__msg91_widget_initialized__ === true,
    channel,
  });
}

function isAlreadyVerifiedError(value: unknown): boolean {
  const record = asRecord(value);
  return record?.code === 703 || String(record?.message ?? "").toLowerCase().includes("already verif");
}

function isConfigError(value: unknown): boolean {
  const record = asRecord(value);
  return record?.code === 701 || String(record?.message ?? "").toLowerCase().includes("invalid retrychannel");
}

function resolveRequestId(data: unknown): string | null {
  const record = asRecord(data);
  if (!record) return null;

  const value =
    record.reqId ??
    record.requestId ??
    record.req_id ??
    record.request_id ??
    record.requestid ??
    record.id ??
    asRecord(record.data)?.reqId ??
    asRecord(record.data)?.requestId ??
    asRecord(record.data)?.req_id ??
    asRecord(record.data)?.request_id ??
    (typeof record.message === "string" && !isJwtLike(record.message) && /^[a-zA-Z0-9]+$/.test(record.message) ? record.message : null);

  return typeof value === "string" && value ? value : null;
}

function isJwtLike(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part) && part.length > 0);
}

function getConfiguration(identifier = "") {
  const widgetId = process.env.NEXT_PUBLIC_MSG91_WIDGET_ID;
  const tokenAuth = process.env.NEXT_PUBLIC_MSG91_TOKEN;

  if (!widgetId) {
    throw new Error("MSG91 Widget ID is missing.");
  }

  if (!tokenAuth) {
    throw new Error("MSG91 Widget Token is missing.");
  }

  return {
    widgetId,
    tokenAuth,
    identifier,
    exposeMethods: true,
    captchaRenderId: "",
    success: () => {
      console.log("[MSG91] widget configuration succeeded.");
    },
    failure: (error: unknown) => {
      if (isAlreadyVerifiedError(error)) {
        console.info("[MSG91] OTP transaction was already completed.");
        return;
      }
      console.error("[MSG91] widget configuration failed.");
    },
  };
}

export async function initializeMSG91Widget(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("MSG91 SDK can only run in the browser.");
  }

  const globalWindow = window as Msg91Window;

  if (globalWindow.__msg91_widget_initialized__ && globalWindow.sendOtp && globalWindow.verifyOtp && globalWindow.retryOtp) {
    return;
  }

  if (sdkPromise) {
    await sdkPromise;
    return;
  }

  if (!process.env.NEXT_PUBLIC_MSG91_WIDGET_ID) {
    throw new Error("MSG91 Widget ID is missing.");
  }

  if (!process.env.NEXT_PUBLIC_MSG91_TOKEN) {
    throw new Error("MSG91 Widget Token is missing.");
  }

  sdkPromise = new Promise<void>((resolve, reject) => {
    let resolved = false;
    let pollTimer: number | null = null;

    const finish = (success: boolean, value?: unknown) => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timeoutId);
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      if (success) {
        globalWindow.__msg91_widget_initialized__ = true;
        globalWindow.__msg91_widget_ready__ = true;
        console.log("[MSG91] widget initialized");
        resolve();
      } else {
        reject(value instanceof Error ? value : new Error(String(value ?? "MSG91 widget initialization failed.")));
      }
    };

    const timeoutId = window.setTimeout(() => {
      finish(false, new Error("MSG91 widget initialization timed out after 10 seconds."));
    }, SDK_TIMEOUT_MS);

    const scriptSelector = `script[data-msg91-sdk="true"]`;
    let script = document.querySelector(scriptSelector) as HTMLScriptElement | null;

    const initializeWidget = () => {
      if (typeof globalWindow.initSendOTP !== "function") {
        finish(false, new Error("MSG91 SDK loaded but initSendOTP is not available."));
        return;
      }

      try {
        console.log("[MSG91] initializing widget");
        globalWindow.initSendOTP(getConfiguration());
      } catch (error) {
        finish(false, error instanceof Error ? error : new Error("MSG91 widget initialization failed."));
        return;
      }

      const pollForMethods = () => {
        const methodsReady =
          typeof globalWindow.sendOtp === "function" &&
          typeof globalWindow.verifyOtp === "function" &&
          typeof globalWindow.retryOtp === "function";

        if (methodsReady) {
          finish(true);
          return;
        }

        pollTimer = window.setTimeout(pollForMethods, 200);
      };

      pollForMethods();
    };

    if (!script) {
      script = document.createElement("script");
      script.type = "text/javascript";
      script.async = true;
      script.dataset.msg91Sdk = "true";
      script.src = SDK_URL;

      script.onload = () => {
        script!.dataset.msg91Loaded = "true";
        console.log("[MSG91] SDK script loaded");
        initializeWidget();
      };

      script.onerror = () => {
        finish(false, new Error("MSG91 SDK failed to load from verify.msg91.com."));
      };

      document.body.appendChild(script);
      return;
    }

    if (script.dataset.msg91Sdk === "true") {
      if (typeof globalWindow.sendOtp === "function" && typeof globalWindow.verifyOtp === "function" && typeof globalWindow.retryOtp === "function") {
        finish(true);
        return;
      }

      if (script.dataset.msg91Loaded === "true") {
        initializeWidget();
        return;
      }

      script.addEventListener("load", () => {
        console.log("[MSG91] SDK script loaded");
        initializeWidget();
      }, { once: true });
      return;
    }

    script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.dataset.msg91Sdk = "true";
    script.src = SDK_URL;
    script.onload = () => {
      script!.dataset.msg91Loaded = "true";
      console.log("[MSG91] SDK script loaded");
      initializeWidget();
    };
    script.onerror = () => {
      finish(false, new Error("MSG91 SDK failed to load from verify.msg91.com."));
    };
    document.body.appendChild(script);
  });

  try {
    await sdkPromise;
  } catch (error) {
    sdkPromise = null;
    throw error;
  }
}

export async function sendOTP(mobile: string, operationLock?: Msg91OperationLock): Promise<{ normalizedMobile: string; requestId: string | null; [key: string]: unknown }> {
  const normalizedMobile = normalizeIndianMobile(mobile);
  if (!normalizedMobile) {
    throw new Error("Invalid mobile number.");
  }

  if (typeof window === "undefined") {
    throw new Error("MSG91 SDK is not available in the server environment.");
  }

  const { lock, ownsLock } = beginOtpOperation("send", operationLock);
  try {
    const globalWindow = window as Msg91Window;
    await initializeMSG91Widget();

    if (typeof globalWindow.sendOtp !== "function") {
      throw new Error("MSG91 SDK failed to load.");
    }

    return await new Promise<{ normalizedMobile: string; requestId: string | null; [key: string]: unknown }>((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        settled = true;
        reject(new Error("MSG91 OTP request timed out after 20 seconds."));
      }, OTP_TIMEOUT_MS);

      console.log("[MSG91] OTP requested for mobile (last 4 digits):", normalizedMobile.slice(-4));
      globalWindow.sendOtp!(normalizedMobile, (data: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        const requestId = resolveRequestId(data);
        verificationCompleted = false;
        console.log(`[MSG91] OTP request ID received: ${requestId ? "present" : "absent"}`);
        console.log("[MSG91] OTP channel: SMS (managed internally by MSG91)");
        console.log("[MSG91] sendOtp succeeded.");
        resolve({ ...(asRecord(data) ?? {}), normalizedMobile, requestId });
      }, (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        logSdkFailure("sendOtp", error, globalWindow, "SMS", null, [normalizedMobile]);
        reject(new Error(otpUserMessage(error, "send")));
      });
    });
  } finally {
    if (ownsLock) finishOtpOperation(lock);
  }
}

function extractMsg91AccessToken(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const dataRecord = asRecord(record.data);
  const resultRecord = asRecord(record.result);

  const candidate =
    record.accessToken ??
    record.access_token ??
    record.token ??
    dataRecord?.accessToken ??
    dataRecord?.access_token ??
    dataRecord?.token ??
    resultRecord?.accessToken ??
    resultRecord?.access_token ??
    resultRecord?.token ??
    (typeof record.message === "string" && isJwtLike(record.message) ? record.message : null) ??
    (typeof dataRecord?.message === "string" && isJwtLike(dataRecord.message) ? dataRecord.message : null) ??
    (typeof resultRecord?.message === "string" && isJwtLike(resultRecord.message) ? resultRecord.message : null);

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    return trimmed || null;
  }

  return null;
}

export async function verifyOTP(otp: string): Promise<{ accessToken: string; [key: string]: unknown }> {
  if (typeof window === "undefined") {
    throw new Error("MSG91 SDK is not available in the server environment.");
  }

  const { lock, ownsLock } = beginOtpOperation("verify");
  try {
    const globalWindow = window as Msg91Window;
    await initializeMSG91Widget();

    if (typeof globalWindow.verifyOtp !== "function") {
      throw new Error("MSG91 SDK failed to load.");
    }

    return await new Promise<{ accessToken: string; [key: string]: unknown }>((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        settled = true;
        reject(new Error("MSG91 OTP verification timed out after 20 seconds."));
      }, OTP_TIMEOUT_MS);

      console.log("[MSG91] verifyOtp called");
      globalWindow.verifyOtp!(otp, (data: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        const value = asRecord(data) ?? {};
        const accessToken = extractMsg91AccessToken(data);
        verificationCompleted = true;

        console.log("[MSG91] verifyOtp succeeded.");

        if (!accessToken) {
          reject(new Error("MSG91 verification succeeded but no access token was returned."));
          return;
        }

        resolve({ ...value, accessToken });
      }, (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        console.error("[MSG91] verifyOtp failed.");
        if (isAlreadyVerifiedError(error)) {
          verificationCompleted = true;
          reject(classifyOtpVerificationError(error));
          return;
        }
        reject(classifyOtpVerificationError(error));
      });
    });
  } catch (error) {
    throw classifyOtpVerificationError(error);
  } finally {
    if (ownsLock) finishOtpOperation(lock);
  }
}

export async function retryOTP(channel: string | null, requestId: string | null, operationLock?: Msg91OperationLock): Promise<{ requestId: string | null; [key: string]: unknown }> {
  if (typeof window === "undefined") {
    throw new Error("MSG91 SDK is not available in the server environment.");
  }

  if (!requestId?.trim()) {
    throw new Error("A current MSG91 request ID is unavailable. Start a new OTP transaction to resend.");
  }

  let retryChannel: string | null = null;
  if (channel === "SMS") {
    retryChannel = "11";
  } else if (channel === "EMAIL") {
    retryChannel = "3";
  } else if (channel === "11" || channel === "3" || channel === "4" || channel === "12") {
    retryChannel = channel;
  }
  if (!retryChannel) {
    throw new Error("This OTP channel cannot be resent.");
  }

  const { lock, ownsLock } = beginOtpOperation("retry", operationLock);
  try {
    const globalWindow = window as Msg91Window;
    await initializeMSG91Widget();

    if (typeof globalWindow.retryOtp !== "function") {
      throw new Error("MSG91 SDK failed to load.");
    }

    return await new Promise<{ requestId: string | null; [key: string]: unknown }>((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        settled = true;
        reject(new Error("MSG91 OTP retry timed out after 20 seconds."));
      }, OTP_TIMEOUT_MS);

      console.log("[MSG91] Resend requested");
      console.log(`[MSG91] Original OTP channel: ${channel || "unknown"}`);
      console.log("[MSG91] Calling MSG91 retry");

      globalWindow.retryOtp!(retryChannel, (data: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        const nextRequestId = resolveRequestId(data);
        verificationCompleted = false;
        if (nextRequestId) {
          console.log("[MSG91] MSG91 retry successful; new request ID received.");
        } else {
          console.log("[MSG91] MSG91 retry successful; no new request ID returned.");
        }
        resolve({ ...(asRecord(data) ?? {}), requestId: nextRequestId });
      }, (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        logSdkFailure(
          "retryOtp",
          error,
          globalWindow,
          channel === "SMS" || channel === "EMAIL" ? channel : retryChannel === "11" ? "SMS" : retryChannel === "3" ? "EMAIL" : "unknown",
          requestId,
          [requestId]
        );
        if (isConfigError(error)) {
          reject(new Error(otpUserMessage(error, "resend")));
        } else {
          reject(new Error(otpUserMessage(error, "resend")));
        }
      }, requestId);
    });
  } finally {
    if (ownsLock) finishOtpOperation(lock);
  }
}

export const normalizeMobileForDisplay = (mobile: string) => {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return mobile;
};
