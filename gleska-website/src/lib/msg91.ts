"use client";

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
let lastReqId: string | null = null;
let otpVerificationInFlight = false;

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

function isAlreadyVerifiedError(value: unknown): boolean {
  const record = asRecord(value);
  return record?.code === 703 || String(record?.message ?? "").toLowerCase().includes("already verif");
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
    asRecord(record.data)?.request_id;

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
    success: (data: unknown) => {
      console.log("[MSG91] configuration success:", data);
    },
    failure: (error: unknown) => {
      if (isAlreadyVerifiedError(error)) {
        console.info("[MSG91] OTP transaction was already completed.");
        return;
      }
      console.error("[MSG91] configuration failure:", error);
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

export async function sendOTP(mobile: string): Promise<{ normalizedMobile: string; [key: string]: unknown }> {
  const normalizedMobile = normalizeIndianMobile(mobile);
  if (!normalizedMobile) {
    throw new Error("Invalid mobile number.");
  }

  if (typeof window === "undefined") {
    throw new Error("MSG91 SDK is not available in the server environment.");
  }

  const globalWindow = window as Msg91Window;
  await initializeMSG91Widget();

  if (typeof globalWindow.sendOtp !== "function") {
    throw new Error("MSG91 SDK failed to load.");
  }

  return await new Promise<{ normalizedMobile: string; [key: string]: unknown }>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("MSG91 OTP request timed out after 20 seconds."));
    }, OTP_TIMEOUT_MS);

    console.log("[MSG91] sendOtp called", normalizedMobile);
    globalWindow.sendOtp!(normalizedMobile, (data: unknown) => {
      window.clearTimeout(timeoutId);
      const reqId = resolveRequestId(data);
      if (reqId) {
        lastReqId = reqId;
      }
      console.log("[MSG91] sendOtp success:", data);
      resolve({ ...(asRecord(data) ?? {}), normalizedMobile });
    }, (error: unknown) => {
      window.clearTimeout(timeoutId);
      console.error("[MSG91] sendOtp failure:", error);
      reject(error instanceof Error ? error : new Error("MSG91 OTP send failed."));
    });
  });
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

  const globalWindow = window as Msg91Window;
  await initializeMSG91Widget();

  if (typeof globalWindow.verifyOtp !== "function") {
    throw new Error("MSG91 SDK failed to load.");
  }

  if (otpVerificationInFlight) {
    throw new Error("OTP verification is already in progress.");
  }
  otpVerificationInFlight = true;

  return await new Promise<{ accessToken: string; [key: string]: unknown }>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      settled = true;
      otpVerificationInFlight = false;
      reject(new Error("MSG91 OTP verification timed out after 20 seconds."));
    }, OTP_TIMEOUT_MS);

    console.log("[MSG91] verifyOtp called");
    globalWindow.verifyOtp!(otp, (data: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      otpVerificationInFlight = false;
      const value = asRecord(data) ?? {};
      const accessToken = extractMsg91AccessToken(data);

      console.log("[MSG91] verifyOtp success:", data);

      if (!accessToken) {
        reject(new Error("MSG91 verification succeeded but no access token was returned."));
        return;
      }

      resolve({ ...value, accessToken });
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      otpVerificationInFlight = false;
      console.error("[MSG91] verifyOtp failure:", error);
      if (isAlreadyVerifiedError(error)) {
        reject(new Error("This OTP has already been used. Request a new OTP and try again."));
        return;
      }
      reject(error instanceof Error ? error : new Error("MSG91 OTP verification failed."));
    });
  });
}

export async function retryOTP(reqId?: string): Promise<{ [key: string]: unknown }> {
  if (typeof window === "undefined") {
    throw new Error("MSG91 SDK is not available in the server environment.");
  }

  const globalWindow = window as Msg91Window;
  await initializeMSG91Widget();

  if (typeof globalWindow.retryOtp !== "function") {
    throw new Error("MSG91 SDK failed to load.");
  }

  const requestIdToUse = reqId ?? lastReqId ?? null;

  return await new Promise<{ [key: string]: unknown }>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("MSG91 OTP retry timed out after 20 seconds."));
    }, OTP_TIMEOUT_MS);

    console.log("[MSG91] retryOtp called", requestIdToUse ?? "null");
    globalWindow.retryOtp!(null, (data: unknown) => {
      window.clearTimeout(timeoutId);
      const nextRequestId = resolveRequestId(data);
      if (nextRequestId) lastReqId = nextRequestId;
      console.log("[MSG91] retryOtp success:", data);
      resolve((data as Record<string, unknown>) ?? {});
    }, (error: unknown) => {
      window.clearTimeout(timeoutId);
      console.error("[MSG91] retryOtp failure:", error);
      reject(error instanceof Error ? error : new Error("MSG91 OTP retry failed."));
    }, requestIdToUse ?? undefined);
  });
}

export const normalizeMobileForDisplay = (mobile: string) => {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return mobile;
};
