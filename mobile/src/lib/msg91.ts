import { environment, missingMsg91Configuration } from "../config/environment";
import { SignupFlowError, classifyOtpVerificationError } from "./auth-errors";

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
type OtpOperation = "send" | "verify" | "retry";
export type Msg91OperationLock = symbol;

let activeOtpOperation: { operation: OtpOperation; lock: Msg91OperationLock } | null = null;
let verificationCompleted = false;

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
  if (verificationCompleted && operation === "verify") throw classifyOtpVerificationError("OTP_ALREADY_USED");
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

export function otpUserMessage(error: unknown, operation: "send" | "verify" | "resend" | "auth" = "verify"): string {
  if (error instanceof SignupFlowError) return error.message;
  const errorRecord = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
  const text = String(errorRecord?.detail ?? errorRecord?.message ?? error ?? "");
  const normalized = text.toLowerCase();
  const retryValue = errorRecord?.retryAfterSeconds;
  const retrySeconds = typeof retryValue === "number" && retryValue > 0
    ? Math.ceil(retryValue)
    : Number(normalized.match(/(\d+)\s*(?:seconds?|secs?)\b/)?.[1]) || 30;

  if (normalized === "email not found. please register first.") {
    return "Email not found. Please register first.";
  }
  if (normalized === "mobile number not found. please register first.") {
    return "Mobile number not found. Please register first.";
  }
  if (/otp_resend_cooldown|please wait before requesting/.test(normalized)) {
    return `Please wait ${retrySeconds} seconds before requesting another OTP.`;
  }
  if (/already used|already verified|code\s*703|otp_already_used/.test(normalized)) {
    return "This OTP has already been used. Request a new OTP and try again.";
  }
  if (/expired|invalid_or_expired_otp|invalid_reset_authorization/.test(normalized)) {
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

export async function sendMsg91Otp(mobile: string, operationLock?: Msg91OperationLock): Promise<{ requestId: string | null }> {
  const normalizedMobile = normalizeIndianMobile(mobile);
  if (!/^91\d{10}$/.test(normalizedMobile)) throw new Error("Enter a valid Indian mobile number.");
  const { lock, ownsLock } = beginOtpOperation("send", operationLock);
  try {
    const sdk = await initializeMsg91();
    return await new Promise<{ requestId: string | null }>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new Error("MSG91 did not respond to the OTP send request within 20 seconds."));
    }, 20000);
    sdk.sendOtp(normalizedMobile, (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const nextRequestId = requestIdFrom(result) ?? null;
      verificationCompleted = false;
      resolve({ requestId: nextRequestId });
    }, (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error(otpUserMessage(providerError(error, "MSG91 could not send the OTP."), "send")));
    });
    });
  } finally {
    if (ownsLock) finishOtpOperation(lock);
  }
}

export async function verifyMsg91Otp(otp: string): Promise<string> {
  if (!/^\d{6}$/.test(otp)) throw new Error("Enter the six-digit code.");
  const { lock, ownsLock } = beginOtpOperation("verify");
  try {
    const sdk = await initializeMsg91();
    return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new Error("MSG91 did not respond to OTP verification within 20 seconds."));
    }, 20000);
    sdk.verifyOtp(otp, (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      verificationCompleted = true;
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
      reject(classifyOtpVerificationError(providerError(error, "The OTP could not be verified.")));
    });
    });
  } catch (error) {
    throw classifyOtpVerificationError(error);
  } finally {
    if (ownsLock) finishOtpOperation(lock);
  }
}

export async function retryMsg91Otp(channel: "SMS" | "EMAIL" = "SMS", currentRequestId?: string | null, operationLock?: Msg91OperationLock): Promise<{ requestId: string | null }> {
  if (!currentRequestId?.trim()) {
    throw new Error("A current MSG91 request ID is unavailable. Start a new OTP transaction to resend.");
  }

  const { lock, ownsLock } = beginOtpOperation("retry", operationLock);
  try {
    const sdk = await initializeMsg91();
    return await new Promise<{ requestId: string | null }>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new Error("MSG91 did not respond to the OTP resend request within 20 seconds."));
    }, 20000);
    sdk.retryOtp(channel === "SMS" ? "11" : "3", (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const nextRequestId = requestIdFrom(result) ?? null;
      verificationCompleted = false;
      resolve({ requestId: nextRequestId });
    }, (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error(otpUserMessage(providerError(error, "MSG91 could not resend the OTP."), "resend")));
    }, currentRequestId);
    });
  } finally {
    if (ownsLock) finishOtpOperation(lock);
  }
}