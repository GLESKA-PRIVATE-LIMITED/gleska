import { environment, missingMsg91Configuration } from "../config/environment";

type Callback = (value: unknown) => void;
type Msg91Methods = {
  initSendOTP: (configuration: Record<string, unknown>) => void;
  sendOtp: (mobile: string, success: Callback, failure: Callback) => void;
  verifyOtp: (otp: string, success: Callback, failure: Callback) => void;
  retryOtp: (channel: string | null, success: Callback, failure: Callback, requestId?: string) => void;
};

declare global {
  interface Window {
    __msg91_widget_initialized__?: boolean;
    initSendOTP?: Msg91Methods["initSendOTP"];
    sendOtp?: Msg91Methods["sendOtp"];
    verifyOtp?: Msg91Methods["verifyOtp"];
    retryOtp?: Msg91Methods["retryOtp"];
  }
}

let sdkPromise: Promise<Msg91Methods> | null = null;
let requestId: string | undefined;

function getMethods(): Msg91Methods | null {
  if (window.initSendOTP && window.sendOtp && window.verifyOtp && window.retryOtp) {
    return {
      initSendOTP: window.initSendOTP,
      sendOtp: window.sendOtp,
      verifyOtp: window.verifyOtp,
      retryOtp: window.retryOtp,
    };
  }
  return null;
}

function providerError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.trim()) return new Error(value.trim());
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : "";
    const code = typeof record.code === "string" || typeof record.code === "number" ? String(record.code) : "";
    const reason = [message, code && `code ${code}`].filter(Boolean).join("; ");
    if (reason) return new Error(reason);
  }
  return new Error(fallback);
}

export function normalizeIndianMobile(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export async function initializeMsg91(): Promise<Msg91Methods> {
  if (missingMsg91Configuration()) throw new Error("MSG91 OTP is not configured for this build.");
  const loaded = getMethods();
  if (window.__msg91_widget_initialized__ && loaded) return loaded;
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<Msg91Methods>((resolve, reject) => {
    let settled = false;
    let poll: number | undefined;
    const finish = (error?: Error, methods?: Msg91Methods) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (poll !== undefined) window.clearInterval(poll);
      if (error) reject(error);
      else if (methods) {
        window.__msg91_widget_initialized__ = true;
        resolve(methods);
      }
    };
    const timeout = window.setTimeout(() => finish(new Error("MSG91 widget initialization timed out. Check the mobile app origin and MSG91 widget configuration.")), 10000);
    const initialize = () => {
      if (!window.initSendOTP) {
        finish(new Error("MSG91 SDK loaded without initSendOTP."));
        return;
      }
      try {
        window.initSendOTP({
          widgetId: environment.msg91WidgetId,
          tokenAuth: environment.msg91Token,
          identifier: "",
          exposeMethods: true,
          captchaRenderId: "",
          success: () => undefined,
          failure: (error: unknown) => finish(providerError(error, "MSG91 rejected the widget configuration.")),
        });
      } catch (error) {
        finish(providerError(error, "MSG91 widget initialization failed."));
        return;
      }
      if (settled) return;
      poll = window.setInterval(() => {
        const methods = getMethods();
        if (methods) finish(undefined, methods);
      }, 100);
    };

    const current = document.querySelector<HTMLScriptElement>('script[data-msg91-sdk="true"]');
    if (current?.dataset.loaded === "true" || current?.dataset.msg91Loaded === "true" || window.initSendOTP) {
      initialize();
      return;
    }
    if (current) {
      current.addEventListener("load", initialize, { once: true });
      current.addEventListener("error", () => finish(new Error("MSG91 SDK could not be loaded from verify.msg91.com.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://verify.msg91.com/otp-provider.js";
    script.async = true;
    script.dataset.msg91Sdk = "true";
    script.onload = () => {
      script.dataset.loaded = "true";
      script.dataset.msg91Loaded = "true";
      initialize();
    };
    script.onerror = () => finish(new Error("MSG91 SDK could not be loaded from verify.msg91.com."));
    document.body.appendChild(script);
  }).catch((error: unknown) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
}

function requestIdFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const data = value as Record<string, unknown>;
  const nested = typeof data.data === "object" && data.data !== null ? data.data as Record<string, unknown> : {};
  const candidate = data.reqId ?? data.requestId ?? data.req_id ?? data.request_id ?? data.requestid ?? data.id ?? nested.reqId ?? nested.requestId ?? nested.req_id ?? nested.request_id;
  return typeof candidate === "string" ? candidate : undefined;
}

export async function sendMsg91Otp(mobile: string) {
  const normalizedMobile = normalizeIndianMobile(mobile);
  if (!/^91\d{10}$/.test(normalizedMobile)) throw new Error("Enter a valid Indian mobile number.");
  const sdk = await initializeMsg91();
  requestId = undefined;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new Error("MSG91 did not respond to the OTP send request within 20 seconds."));
    }, 20000);
    sdk.sendOtp(normalizedMobile, (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      requestId = requestIdFrom(result);
      resolve();
    }, (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(providerError(error, "MSG91 could not send the OTP. Try again."));
    });
  });
}

export async function verifyMsg91Otp(otp: string): Promise<string> {
  if (!/^\d{6}$/.test(otp)) throw new Error("Enter the six-digit code.");
  const sdk = await initializeMsg91();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new Error("MSG91 did not respond to OTP verification within 20 seconds."));
    }, 20000);
    sdk.verifyOtp(otp, (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (typeof result !== "object" || result === null) {
        reject(new Error("MSG91 verification did not return an access token."));
        return;
      }
      const record = result as Record<string, unknown>;
      const nested = typeof record.data === "object" && record.data !== null ? record.data as Record<string, unknown> : {};
      const resultRecord = typeof record.result === "object" && record.result !== null ? record.result as Record<string, unknown> : {};
      const nestedResult = typeof nested.result === "object" && nested.result !== null ? nested.result as Record<string, unknown> : {};
      const candidates = [
        record.accessToken,
        record.access_token,
        record.token,
        nested.accessToken,
        nested.access_token,
        nested.token,
        resultRecord.accessToken,
        resultRecord.access_token,
        resultRecord.token,
        nestedResult.accessToken,
        nestedResult.access_token,
        nestedResult.token,
      ];
      const jwtMessage = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
      candidates.push(jwtMessage(record.message), jwtMessage(nested.message), jwtMessage(resultRecord.message));
      const token = candidates.find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
      if (typeof token !== "string" || !token.trim()) {
        reject(new Error("MSG91 verification did not return an access token."));
        return;
      }
      resolve(token.trim());
    }, (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(providerError(error, "The OTP could not be verified. Check it or request a new code."));
    });
  });
}

export async function retryMsg91Otp(channel: "SMS" | "EMAIL" = "SMS") {
  const sdk = await initializeMsg91();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new Error("MSG91 did not respond to the OTP resend request within 20 seconds."));
    }, 20000);
    sdk.retryOtp(channel === "SMS" ? "11" : "3", (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      requestId = requestIdFrom(result) ?? requestId;
      resolve();
    }, (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(providerError(error, "MSG91 could not resend the OTP."));
    }, requestId);
  });
}