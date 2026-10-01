import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, errorMessage, useAuth } from "./AuthProvider";
import { OtpVerificationError, SignupFlowError } from "../../lib/auth-errors";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  verifyMsg91Otp: vi.fn(),
  sendMsg91Otp: vi.fn(),
  registerMobileSession: vi.fn(),
  clearSessionKey: vi.fn(),
  supabaseSignOut: vi.fn(),
  supabaseSignInWithPassword: vi.fn(),
  supabaseOnAuthStateChange: vi.fn(),
  appAddListener: vi.fn(),
}));

vi.mock("../../config/environment", () => ({
  environment: {
    apiBaseUrl: "http://localhost:8000",
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "test-anon-key",
    oauthRedirectUrl: "com.gleska.app://auth/callback",
    msg91WidgetId: "test-widget",
    msg91Token: "test-token",
  },
  missingBackendConfiguration: () => false,
  missingSupabaseConfiguration: () => false,
  missingMsg91Configuration: () => false,
}));

vi.mock("../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly detail?: unknown;

    constructor(message: string, status: number, detail?: unknown) {
      super(message);
      this.status = status;
      this.detail = detail;
      this.name = "ApiError";
    }
  },
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));

vi.mock("../../lib/session", () => ({
  clearSessionKey: mocks.clearSessionKey,
  registerMobileSession: mocks.registerMobileSession,
}));

vi.mock("../../lib/supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      signOut: mocks.supabaseSignOut,
      signInWithPassword: mocks.supabaseSignInWithPassword,
      onAuthStateChange: mocks.supabaseOnAuthStateChange,
    },
  }),
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: mocks.appAddListener },
}));

vi.mock("@capacitor/browser", () => ({
  Browser: { open: vi.fn(), close: vi.fn() },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "web", isNativePlatform: () => false },
}));

vi.mock("../../lib/msg91", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/msg91")>();
  return {
    ...actual,
    verifyMsg91Otp: mocks.verifyMsg91Otp,
    sendMsg91Otp: mocks.sendMsg91Otp,
    retryMsg91Otp: vi.fn(),
    runWithOtpOperationLock: vi.fn(),
  };
});

const activeUser = {
  id: "active-user",
  name: "Active User",
  email: "active@example.com",
  mobile: "919876543210",
  role: "WORKER" as const,
  is_mobile_verified: true,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

class ApiError extends Error {
  readonly status: number;
  readonly detail?: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function configureApi(options: {
  loginError?: unknown;
  sessionError?: unknown;
  restoreError?: unknown;
  preflightError?: unknown;
  signupError?: unknown;
  initialUser?: typeof activeUser;
} = {}) {
  let meRequests = 0;
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path !== "/api/v1/auth/me") throw new Error(`Unexpected GET ${path}`);
    meRequests += 1;
    if (meRequests === 1) {
      if (options.initialUser) {
        return { user: options.initialUser, next_step: "DASHBOARD" };
      }
      throw new ApiError("Authentication required", 401, "Authentication required");
    }
    if (options.restoreError) throw options.restoreError;
    return { user: activeUser, next_step: "DASHBOARD" };
  });

  mocks.apiPost.mockImplementation(async (path: string) => {
    if (path === "/api/v1/auth/logout") return { success: true };
    if (path === "/api/v1/auth/signup-preflight") {
      if (options.preflightError) throw options.preflightError;
      return { success: true };
    }
    if (path === "/api/v1/auth/signup-mobile-verified") {
      if (options.signupError) throw options.signupError;
      return activeUser;
    }
    if (path === "/api/v1/auth/login-msg91") {
      if (options.loginError) throw options.loginError;
      return { success: true };
    }
    if (path === "/api/v1/auth/session") {
      if (options.sessionError) throw options.sessionError;
      return { success: true };
    }
    throw new Error(`Unexpected POST ${path}`);
  });

  mocks.registerMobileSession.mockImplementation(async () => {
    await mocks.apiPost("/api/v1/auth/session", { session_key: "test-session" });
  });
}

async function mountAuth() {
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

describe("mobile OTP login recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyMsg91Otp.mockResolvedValue("verified-msg91-token");
    mocks.sendMsg91Otp.mockResolvedValue({ requestId: "signup-request-id" });
    mocks.supabaseSignOut.mockResolvedValue({ error: null });
    mocks.supabaseSignInWithPassword.mockResolvedValue({ error: null });
    mocks.supabaseOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mocks.appAddListener.mockResolvedValue({ remove: vi.fn() });
    configureApi();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the inactive-account message without calling logout cleanup", async () => {
    configureApi({ loginError: new ApiError("User inactive", 401, "User inactive") });
    const { result } = await mountAuth();

    await expect(
      act(async () => result.current.signInWithMobileOtp("919876543210", "123456")),
    ).rejects.toThrow("User inactive");

    expect(errorMessage(new Error("User inactive"))).toBe("User inactive");
    expect(mocks.apiPost.mock.calls.map(([path]) => path)).not.toContain("/api/v1/auth/logout");
    expect(mocks.registerMobileSession).not.toHaveBeenCalled();
    expect(mocks.clearSessionKey).toHaveBeenCalledTimes(1);
  });

  it("calls existing logout cleanup when session registration fails after backend login", async () => {
    configureApi({ sessionError: new Error("session registration failed"), initialUser: activeUser });
    const { result } = await mountAuth();

    await expect(
      act(async () => result.current.signInWithMobileOtp("919876543210", "123456")),
    ).rejects.toThrow();

    const paths = mocks.apiPost.mock.calls.map(([path]) => path);
    expect(paths).toContain("/api/v1/auth/session");
    expect(paths).toContain("/api/v1/auth/logout");
    expect(mocks.supabaseSignOut).toHaveBeenCalled();
    expect(mocks.clearSessionKey).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("calls existing logout cleanup when auth restoration fails", async () => {
    configureApi({ restoreError: new Error("auth restoration failed"), initialUser: activeUser });
    const { result } = await mountAuth();

    await expect(
      act(async () => result.current.signInWithMobileOtp("919876543210", "123456")),
    ).rejects.toThrow();

    const paths = mocks.apiPost.mock.calls.map(([path]) => path);
    expect(paths).toContain("/api/v1/auth/session");
    expect(paths).toContain("/api/v1/auth/logout");
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("restores an active user without calling logout cleanup", async () => {
    configureApi();
    const { result } = await mountAuth();

    let loginResult: Awaited<ReturnType<typeof result.current.signInWithMobileOtp>> | undefined;
    await act(async () => {
      loginResult = await result.current.signInWithMobileOtp("919876543210", "123456");
    });

    const paths = mocks.apiPost.mock.calls.map(([path]) => path);
    expect(paths).toContain("/api/v1/auth/login-msg91");
    expect(paths).toContain("/api/v1/auth/session");
    expect(paths).not.toContain("/api/v1/auth/logout");
    expect(loginResult?.user).toEqual(activeUser);
    expect(result.current.user).toEqual(activeUser);
    expect(result.current.isAuthenticated).toBe(true);
    expect(mocks.clearSessionKey).not.toHaveBeenCalled();
  });
});

const signupInput = {
  name: "Signup User",
  email: "signup@example.com",
  mobile: "9876543210",
  password: "Password123!",
  confirmPassword: "Password123!",
  role: "WORKER" as const,
  accountType: "BUSINESS" as const,
};

describe("mobile email signup error boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyMsg91Otp.mockResolvedValue("verified-msg91-token");
    mocks.sendMsg91Otp.mockResolvedValue({ requestId: "signup-request-id" });
    mocks.supabaseSignOut.mockResolvedValue({ error: null });
    mocks.supabaseSignInWithPassword.mockResolvedValue({ error: null });
    mocks.supabaseOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mocks.appAddListener.mockResolvedValue({ remove: vi.fn() });
    configureApi();
  });

  async function captureSignupError(hook: Awaited<ReturnType<typeof mountAuth>>["result"]) {
    let caught: unknown;
    await act(async () => {
      try {
        await hook.current.completeSignup(signupInput, "123456");
      } catch (error) {
        caught = error;
      }
    });
    return caught;
  }

  it("keeps preflight failures separate from OTP-send failures", async () => {
    configureApi({ preflightError: new ApiError("backend unavailable", 500, "DATABASE_UNAVAILABLE") });
    const { result } = await mountAuth();
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.beginSignup(signupInput);
      } catch (error) {
        caught = error;
      }
    });

    expect((caught as SignupFlowError).code).toBe("SIGNUP_PREFLIGHT_FAILED");
    expect(errorMessage(caught)).toBe("We couldn't check your account details. Please try again.");
    expect(mocks.sendMsg91Otp).not.toHaveBeenCalled();
  });

  it("keeps mobile OTP-send failures in the send category", async () => {
    mocks.sendMsg91Otp.mockRejectedValue(new Error("unrecognized send-provider failure"));
    const { result } = await mountAuth();
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.beginSignup(signupInput);
      } catch (error) {
        caught = error;
      }
    });

    expect((caught as SignupFlowError).code).toBe("OTP_SEND_FAILED");
    expect(errorMessage(caught)).toBe("We couldn't send the OTP right now. Please try again in a moment.");
    expect(mocks.verifyMsg91Otp).not.toHaveBeenCalled();
  });

  it.each([
    [new Error("OTP_INVALID"), "OTP_INVALID", "Incorrect OTP. Please check the code and try again."],
    [new Error("OTP_EXPIRED"), "OTP_EXPIRED", "This OTP has expired. Please request a new OTP."],
    [new Error("OTP_ALREADY_USED"), "OTP_ALREADY_USED", "This OTP has already been used. Please request a new OTP."],
    [new Error("unrecognized provider response"), "OTP_PROVIDER_FAILURE", "We couldn't verify your OTP right now. Please try again."],
  ] as const)("preserves %s from the MSG91 verification boundary", async (providerError, code, message) => {
    mocks.verifyMsg91Otp.mockRejectedValue(providerError);
    const { result } = await mountAuth();

    const caught = await captureSignupError(result);

    expect(caught).toBeInstanceOf(OtpVerificationError);
    expect((caught as SignupFlowError).code).toBe(code);
    expect(errorMessage(caught)).toBe(message);
    expect(mocks.apiPost).not.toHaveBeenCalledWith("/api/v1/auth/signup-mobile-verified", expect.anything(), expect.anything());
  });

  it("maps OTP provider configuration and unavailable errors specifically", async () => {
    const { result } = await mountAuth();
    mocks.verifyMsg91Otp.mockRejectedValueOnce(new Error("MSG91 widget configuration failed"));
    const configurationError = await captureSignupError(result);
    expect((configurationError as SignupFlowError).code).toBe("OTP_PROVIDER_CONFIGURATION_ERROR");
    expect(errorMessage(configurationError)).toBe("OTP verification is temporarily unavailable. Please try again later.");

    mocks.verifyMsg91Otp.mockRejectedValueOnce(new Error("network timeout"));
    const unavailableError = await captureSignupError(result);
    expect((unavailableError as SignupFlowError).code).toBe("OTP_PROVIDER_UNAVAILABLE");
    expect(errorMessage(unavailableError)).toBe("We couldn't verify your OTP right now. Please check your connection and try again.");
  });

  it("does not remap an already-classified OTP error in errorMessage", () => {
    const error = new OtpVerificationError("OTP_INVALID");
    expect(errorMessage(error)).toBe("Incorrect OTP. Please check the code and try again.");
  });

  it.each([
    ["AUTH_USER_CREATION_FAILED", "AUTH_USER_CREATION_FAILED"],
    ["USER_PROVISIONING_FAILED", "USER_PROVISIONING_FAILED"],
  ] as const)("preserves %s after successful OTP verification", async (backendCode, expectedCode) => {
    configureApi({ signupError: new ApiError(backendCode, 500, backendCode) });
    const { result } = await mountAuth();

    const caught = await captureSignupError(result);

    expect(caught).toBeInstanceOf(SignupFlowError);
    expect((caught as SignupFlowError).code).toBe(expectedCode);
    expect(errorMessage(caught)).toBe("Your OTP was verified, but we couldn't finish setting up your account. Please try again.");
    expect(mocks.verifyMsg91Otp).toHaveBeenCalledOnce();
  });

  it("preserves the session registration category after successful signup", async () => {
    configureApi({ sessionError: new ApiError("SESSION_REGISTRATION_FAILED", 500, "SESSION_REGISTRATION_FAILED") });
    const { result } = await mountAuth();

    const caught = await captureSignupError(result);

    expect((caught as SignupFlowError).code).toBe("SESSION_REGISTRATION_FAILED");
    expect(errorMessage(caught)).toBe("Your account was created, but we couldn't finish signing you in. Please try again.");
  });

  it("uses account-session copy when post-signup restoration fails", async () => {
    configureApi({ restoreError: new Error("backend restore unavailable") });
    const { result } = await mountAuth();

    const caught = await captureSignupError(result);

    expect((caught as SignupFlowError).code).toBe("SESSION_RESTORATION_FAILED");
    expect(errorMessage(caught)).toBe("Your account was created, but we couldn't finish signing you in. Please try again.");
  });
});