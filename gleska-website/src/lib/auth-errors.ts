export type SignupErrorCode =
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_ALREADY_USED"
  | "OTP_PROVIDER_FAILURE"
  | "OTP_PROVIDER_CONFIGURATION_ERROR"
  | "OTP_PROVIDER_UNAVAILABLE"
  | "AUTH_USER_CREATION_FAILED"
  | "USER_PROVISIONING_FAILED"
  | "SESSION_REGISTRATION_FAILED"
  | "INVALID_MSG91_VERIFICATION"
  | "MSG91_MOBILE_MISMATCH"
  | "MSG91_VERIFIED_MOBILE_MISSING"
  | "USER_LOOKUP_FAILED"
  | "ACCOUNT_CONFLICT"
  | "SIGNUP_PREPARATION_FAILED"
  | "SIGNUP_PREFLIGHT_FAILED"
  | "OTP_SEND_FAILED"
  | "AUTH_SIGN_IN_FAILED"
  | "SESSION_RESTORATION_FAILED"
  | "ONBOARDING_SETUP_FAILED"
  | "ACCOUNT_SETUP_FAILED";

export type SignupFailureStage =
  | "preparation"
  | "preflight"
  | "send"
  | "backend-signup"
  | "auth-sign-in"
  | "session-registration"
  | "session-restoration"
  | "onboarding";

type OtpVerificationCode =
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_ALREADY_USED"
  | "OTP_PROVIDER_FAILURE"
  | "OTP_PROVIDER_CONFIGURATION_ERROR"
  | "OTP_PROVIDER_UNAVAILABLE";

const otpMessages: Record<OtpVerificationCode, string> = {
  OTP_INVALID: "Incorrect OTP. Please check the code and try again.",
  OTP_EXPIRED: "This OTP has expired. Please request a new OTP.",
  OTP_ALREADY_USED: "This OTP has already been used. Please request a new OTP.",
  OTP_PROVIDER_FAILURE: "We couldn't verify your OTP right now. Please try again.",
  OTP_PROVIDER_CONFIGURATION_ERROR: "OTP verification is temporarily unavailable. Please try again later.",
  OTP_PROVIDER_UNAVAILABLE: "We couldn't verify your OTP right now. Please check your connection and try again.",
};

export class SignupFlowError extends Error {
  readonly code: SignupErrorCode;

  constructor(code: SignupErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SignupFlowError";
  }
}

export class OtpVerificationError extends SignupFlowError {
  constructor(code: OtpVerificationCode) {
    super(code, otpMessages[code]);
    this.name = "OtpVerificationError";
  }
}

export class AccountSetupError extends SignupFlowError {
  readonly category = "account-setup";

  constructor(message: string, code: SignupErrorCode = "ACCOUNT_SETUP_FAILED") {
    super(code, message);
    this.name = "AccountSetupError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorDetail(error: unknown): unknown {
  const record = asRecord(error);
  const responseData = asRecord(asRecord(record?.response)?.data);
  return responseData?.detail ?? record?.detail ?? record?.code ?? record?.message ?? error;
}

function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail.trim();
  if (Array.isArray(detail)) {
    return detail.flatMap((item) => {
      const record = asRecord(item);
      return typeof record?.msg === "string" ? [record.msg] : [];
    }).join(" ");
  }
  const message = asRecord(detail)?.message;
  return typeof message === "string" ? message.trim() : "";
}

export function classifyOtpVerificationError(error: unknown): OtpVerificationError {
  if (error instanceof OtpVerificationError) return error;

  const record = asRecord(error);
  const text = `${detailText(errorDetail(error))} ${typeof record?.name === "string" ? record.name : ""}`.toLowerCase();
  if (/otp_already_used|already used|already verified|code\s*703/.test(text)) {
    return new OtpVerificationError("OTP_ALREADY_USED");
  }
  if (/otp_expired|invalid_or_expired_otp|expired|otp session.*expired/.test(text)) {
    return new OtpVerificationError("OTP_EXPIRED");
  }
  if (/otp_invalid|invalid otp|incorrect otp|wrong otp/.test(text)) {
    return new OtpVerificationError("OTP_INVALID");
  }
  if (/configuration|not configured|widget|initSendOTP|invalid grant|auth key|unauthori[sz]ed|authentication failed/.test(text)) {
    return new OtpVerificationError("OTP_PROVIDER_CONFIGURATION_ERROR");
  }
  if (/network|timeout|timed out|connection|could not connect|unreachable|fetch failed|econn|err_network|aborterror/.test(text)) {
    return new OtpVerificationError("OTP_PROVIDER_UNAVAILABLE");
  }
  return new OtpVerificationError("OTP_PROVIDER_FAILURE");
}

const safeBackendMessages = new Map<string, { code: SignupErrorCode; message: string }>([
  ["An account already exists with this email or mobile number. Please login instead.", {
    code: "ACCOUNT_CONFLICT",
    message: "An account already exists with this email or mobile number. Please login instead.",
  }],
  ["An authentication account already exists for this email. Sign in to restore your GLESKA profile.", {
    code: "ACCOUNT_CONFLICT",
    message: "An authentication account already exists for this email. Sign in to restore your GLESKA profile.",
  }],
  ["Terms & Conditions must be accepted before creating an account.", {
    code: "SIGNUP_PREFLIGHT_FAILED",
    message: "Terms & Conditions must be accepted before creating an account.",
  }],
  ["Enter a valid Indian mobile number", {
    code: "SIGNUP_PREFLIGHT_FAILED",
    message: "Enter a valid Indian mobile number",
  }],
  ["Passwords do not match", {
    code: "SIGNUP_PREFLIGHT_FAILED",
    message: "Passwords do not match",
  }],
]);

export function toSignupFlowError(error: unknown, stage: SignupFailureStage): SignupFlowError {
  if (error instanceof SignupFlowError) return error;

  const text = detailText(errorDetail(error));
  const code = text.toUpperCase();
  const safeMessage = safeBackendMessages.get(text);
  if (safeMessage) return new SignupFlowError(safeMessage.code, safeMessage.message);
  const normalized = text.toLowerCase();
  if (/email.*(valid|address)|valid.*email/.test(normalized)) {
    return new SignupFlowError("SIGNUP_PREFLIGHT_FAILED", "Enter a valid email address.");
  }
  if (/password.*(match|must|between|characters)|confirm_password/.test(normalized)) {
    return new SignupFlowError("SIGNUP_PREFLIGHT_FAILED", "Check that your passwords match and meet the requirements.");
  }
  if (/name.*(valid|required|length)|valid name/.test(normalized)) {
    return new SignupFlowError("SIGNUP_PREFLIGHT_FAILED", "Enter a valid name.");
  }
  if (/mobile.*(valid|required)|valid indian mobile/.test(normalized)) {
    return new SignupFlowError("SIGNUP_PREFLIGHT_FAILED", "Enter a valid Indian mobile number");
  }
  if (/field required|input required/.test(normalized)) {
    return new SignupFlowError("SIGNUP_PREFLIGHT_FAILED", "Complete all required signup fields.");
  }

  if (code === "AUTH_USER_CREATION_FAILED" || code === "USER_PROVISIONING_FAILED") {
    return new AccountSetupError("Your OTP was verified, but we couldn't finish setting up your account. Please try again.", code);
  }
  if (code === "SESSION_REGISTRATION_FAILED") {
    return new AccountSetupError("Your account was created, but we couldn't finish signing you in. Please try again.", code);
  }
  if (code === "INVALID_MSG91_VERIFICATION" || code === "MSG91_MOBILE_MISMATCH" || code === "MSG91_VERIFIED_MOBILE_MISSING") {
    return new SignupFlowError(code, "We couldn't confirm this phone verification. Please request a new code and try again.");
  }
  if (code === "USER_LOOKUP_FAILED") {
    return new AccountSetupError("Your OTP was verified, but we couldn't finish setting up your account. Please try again.", code);
  }

  switch (stage) {
    case "preparation":
      return new AccountSetupError("We couldn't prepare your signup. Please try again.", "SIGNUP_PREPARATION_FAILED");
    case "preflight":
      return new SignupFlowError("SIGNUP_PREFLIGHT_FAILED", "We couldn't check your account details. Please try again.");
    case "send":
      return new SignupFlowError("OTP_SEND_FAILED", "We couldn't send the OTP right now. Please try again in a moment.");
    case "auth-sign-in":
      return new AccountSetupError("Your OTP was verified, but we couldn't finish signing you in. Please try again.", "AUTH_SIGN_IN_FAILED");
    case "session-registration":
      return new AccountSetupError("Your account was created, but we couldn't finish signing you in. Please try again.", "SESSION_REGISTRATION_FAILED");
    case "session-restoration":
      return new AccountSetupError("Your account was created, but we couldn't finish signing you in. Please try again.", "SESSION_RESTORATION_FAILED");
    case "onboarding":
      return new AccountSetupError("Your account was created, but we couldn't finish setting up your account. Please try again.", "ONBOARDING_SETUP_FAILED");
    default:
      return new AccountSetupError("Your OTP was verified, but we couldn't finish setting up your account. Please try again.");
  }
}
