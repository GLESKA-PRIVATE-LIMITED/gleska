import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AuthMethodPanel from "@/components/auth/AuthMethodPanel";
import { OtpVerificationError } from "@/lib/auth-errors";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  verifyOTP: vi.fn(),
  sendOTP: vi.fn(),
  registerSession: vi.fn(),
  clearSessionKey: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  default: { get: mocks.apiGet, post: mocks.apiPost },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: mocks.signOut,
      signInWithPassword: mocks.signInWithPassword,
      onAuthStateChange: mocks.onAuthStateChange,
      getSession: mocks.getSession,
    },
  },
}));

vi.mock("@/lib/security", () => ({
  registerSession: mocks.registerSession,
  clearSessionKey: mocks.clearSessionKey,
  logSecurityActivity: vi.fn(),
  parseDeviceInfo: () => ({ deviceName: "Test browser" }),
}));

vi.mock("@/lib/msg91", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/msg91")>();
  return {
    ...actual,
    initializeMSG91Widget: vi.fn(),
    verifyOTP: mocks.verifyOTP,
    retryOTP: vi.fn(),
    sendOTP: mocks.sendOTP,
  };
});

vi.mock("@/context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

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

function makeAxiosError(detail: string) {
  return Object.assign(new Error("Request failed"), { code: "ERR_BAD_RESPONSE", response: { data: { detail } } });
}

function configureApi(options: {
  loginError?: unknown;
  sessionError?: unknown;
  restoreError?: unknown;
  restoreErrorAt?: number;
  preflightError?: unknown;
  signupError?: unknown;
  initialUser?: typeof activeUser;
} = {}) {
  let meRequests = 0;
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path !== "/api/v1/auth/me") throw new Error(`Unexpected GET ${path}`);
    meRequests += 1;
    if (meRequests === 1) {
      return options.initialUser
        ? { data: { user: options.initialUser, next_step: "DASHBOARD" } }
        : { data: {} };
    }
    if (options.restoreError && meRequests === (options.restoreErrorAt ?? 2)) throw options.restoreError;
    return { data: { user: activeUser, next_step: "DASHBOARD" } };
  });

  mocks.apiPost.mockImplementation(async (path: string) => {
    if (path === "/api/v1/auth/logout") return { data: { success: true } };
    if (path === "/api/v1/auth/signup-preflight") {
      if (options.preflightError) throw options.preflightError;
      return { data: { success: true } };
    }
    if (path === "/api/v1/auth/signup-mobile-verified") {
      if (options.signupError) throw options.signupError;
      return { data: activeUser };
    }
    if (path === "/api/v1/auth/login-msg91") {
      if (options.loginError) throw options.loginError;
      return { data: { user: activeUser } };
    }
    if (path === "/api/v1/auth/session") {
      if (options.sessionError) throw options.sessionError;
      return { data: { success: true } };
    }
    throw new Error(`Unexpected POST ${path}`);
  });

  mocks.registerSession.mockImplementation(async () => {
    await mocks.apiPost("/api/v1/auth/session", { session_key: "test-session" });
  });
}

async function mountAuth(initialUser?: typeof activeUser) {
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  if (initialUser) {
    act(() => hook.result.current.setAuthState(initialUser, "DASHBOARD"));
  }
  return hook;
}

describe("website mobile login recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyOTP.mockResolvedValue({ accessToken: "verified-msg91-token" });
    mocks.sendOTP.mockResolvedValue({ requestId: "signup-request-id" });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.routerReplace.mockReset();
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    configureApi();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("propagates an inactive-account response without post-login cleanup or session restoration", async () => {
    configureApi({ loginError: makeAxiosError("User inactive") });
    const { result } = await mountAuth();

    await expect(
      act(async () => result.current.loginWithMobile("919876543210", "123456")),
    ).rejects.toThrow("User inactive");

    const paths = mocks.apiPost.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path === "/api/v1/auth/logout")).toHaveLength(1);
    expect(paths).not.toContain("/api/v1/auth/session");
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    expect(mocks.clearSessionKey).toHaveBeenCalledTimes(1);
  });

  it("uses the existing logout endpoint and clears local auth after session registration fails", async () => {
    configureApi({
      sessionError: new Error("session registration failed"),
      initialUser: activeUser,
    });
    const { result } = await mountAuth(activeUser);

    await expect(
      act(async () => result.current.loginWithMobile("919876543210", "123456")),
    ).rejects.toThrow();

    const paths = mocks.apiPost.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path === "/api/v1/auth/logout")).toHaveLength(2);
    expect(paths).toContain("/api/v1/auth/session");
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(mocks.clearSessionKey).toHaveBeenCalledTimes(2);
  });

  it("uses the existing logout endpoint and clears local auth after /auth/me fails", async () => {
    configureApi({
      restoreError: new Error("auth restoration failed"),
      initialUser: activeUser,
    });
    const { result } = await mountAuth(activeUser);

    await expect(
      act(async () => result.current.loginWithMobile("919876543210", "123456")),
    ).rejects.toThrow();

    const paths = mocks.apiPost.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path === "/api/v1/auth/logout")).toHaveLength(2);
    expect(paths).toContain("/api/v1/auth/session");
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(mocks.clearSessionKey).toHaveBeenCalledTimes(2);
  });

  it("restores an active user without triggering cleanup", async () => {
    configureApi();
    const { result } = await mountAuth();

    let loginResult: Awaited<ReturnType<typeof result.current.loginWithMobile>> | undefined;
    await act(async () => {
      loginResult = await result.current.loginWithMobile("919876543210", "123456");
    });

    const paths = mocks.apiPost.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path === "/api/v1/auth/logout")).toHaveLength(1);
    expect(paths).toContain("/api/v1/auth/login-msg91");
    expect(paths).toContain("/api/v1/auth/session");
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
    expect(loginResult).toEqual({ user: activeUser, nextStep: "DASHBOARD" });
    expect(result.current.user).toEqual(activeUser);
    expect(result.current.isAuthenticated).toBe(true);
    expect(mocks.clearSessionKey).toHaveBeenCalledTimes(1);
  });
});

describe("website email signup error boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyOTP.mockResolvedValue({ accessToken: "verified-msg91-token" });
    mocks.sendOTP.mockResolvedValue({ requestId: "signup-request-id" });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    configureApi();
  });

  async function submitSignupForm() {
    render(
      <AuthProvider>
        <AuthMethodPanel role="WORKER" initialMode="signup" hideModeSelector />
      </AuthProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText("auth.fullNameLabel"), { target: { value: "Signup User" } });
    fireEvent.change(screen.getByPlaceholderText("auth.emailLabel"), { target: { value: "signup@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("auth.passwordLabel"), { target: { value: "Password123!" } });
    fireEvent.change(screen.getByPlaceholderText("auth.confirmPasswordLabel"), { target: { value: "Password123!" } });
    fireEvent.change(screen.getByPlaceholderText("auth.mobileLabel"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "auth.signupButton" }));
  }

  async function fillIndividualSignupForm(password = "abcdefgh1@", confirmPassword = password) {
    render(
      <AuthProvider>
        <AuthMethodPanel role="EMPLOYER" accountType="INDIVIDUAL" initialMode="signup" hideModeSelector />
      </AuthProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText("auth.fullNameLabel"), { target: { value: "Samiksha Lone" } });
    fireEvent.change(screen.getByPlaceholderText("auth.emailLabel"), { target: { value: "individual@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("auth.passwordLabel"), { target: { value: password } });
    fireEvent.change(screen.getByPlaceholderText("auth.confirmPasswordLabel"), { target: { value: confirmPassword } });
    fireEvent.change(screen.getByPlaceholderText("auth.mobileLabel"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("checkbox"));
  }

  it("does not start preflight or OTP for an incomplete password", async () => {
    await fillIndividualSignupForm("abcdefgh");

    const signupButton = screen.getByRole("button", { name: "auth.signupButton" });
    expect(signupButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("auth.passwordContainsNumber")).toBeTruthy();
    expect(screen.getByText("auth.passwordContainsSpecialCharacter")).toBeTruthy();
    expect(mocks.apiPost).not.toHaveBeenCalledWith("/api/v1/auth/signup-preflight", expect.anything(), expect.anything());
    expect(mocks.sendOTP).not.toHaveBeenCalled();
  });

  it("continues to the existing OTP flow for a valid Individual Employer signup", async () => {
    await fillIndividualSignupForm();
    fireEvent.click(screen.getByRole("button", { name: "auth.signupButton" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/v1/auth/signup-preflight", expect.anything());
    expect(mocks.sendOTP).toHaveBeenCalledWith("919876543210");
  });

  it("shows a mismatch message and disables signup until passwords match", async () => {
    await fillIndividualSignupForm("abcdefgh1@", "abcdefgh1");

    expect(screen.getByText("auth.signupPasswordMismatch")).toBeTruthy();
    expect(screen.getByRole("button", { name: "auth.signupButton" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.sendOTP).not.toHaveBeenCalled();
  });

  it("renders only active inline errors and removes them as fields are corrected", async () => {
    await fillIndividualSignupForm();

    expect(screen.queryByText("auth.nameLettersOnly")).toBeNull();
    expect(screen.queryByText("auth.signupValidMobile")).toBeNull();
    expect(screen.queryByText("auth.signupPasswordMismatch")).toBeNull();
    expect(document.getElementById("auth-name-error")).toBeNull();
    expect(document.getElementById("auth-mobile-error")).toBeNull();
    expect(document.getElementById("auth-confirm-password-error")).toBeNull();

    const nameInput = screen.getByPlaceholderText("auth.fullNameLabel");
    fireEvent.change(nameInput, { target: { value: "Samiksha123" } });
    expect(screen.getByText("auth.nameLettersOnly")).toBeTruthy();
    fireEvent.change(nameInput, { target: { value: "Samiksha Lone" } });
    expect(screen.queryByText("auth.nameLettersOnly")).toBeNull();

    const mobileInput = screen.getByPlaceholderText("auth.mobileLabel");
    fireEvent.change(mobileInput, { target: { value: "+919876543210" } });
    expect(screen.getByText("auth.signupValidMobile")).toBeTruthy();
    fireEvent.change(mobileInput, { target: { value: "9876543211" } });
    expect(screen.queryByText("auth.signupValidMobile")).toBeNull();

    const confirmInput = screen.getByPlaceholderText("auth.confirmPasswordLabel");
    fireEvent.change(confirmInput, { target: { value: "mismatched" } });
    expect(screen.getByText("auth.signupPasswordMismatch")).toBeTruthy();
    fireEvent.change(confirmInput, { target: { value: "abcdefgh1@" } });
    expect(screen.queryByText("auth.signupPasswordMismatch")).toBeNull();
  });

  it("shows name and mobile validation errors for rejected input", async () => {
    render(
      <AuthProvider>
        <AuthMethodPanel role="EMPLOYER" accountType="INDIVIDUAL" initialMode="signup" hideModeSelector />
      </AuthProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText("auth.fullNameLabel"), { target: { value: "Samiksha123" } });
    fireEvent.change(screen.getByPlaceholderText("auth.mobileLabel"), { target: { value: "+919876543210" } });

    expect(screen.getByText("auth.nameLettersOnly")).toBeTruthy();
    expect(screen.getByText("auth.signupValidMobile")).toBeTruthy();
    expect(screen.getByPlaceholderText<HTMLInputElement>("auth.fullNameLabel").value).toBe("Samiksha");
    expect(screen.getByPlaceholderText<HTMLInputElement>("auth.mobileLabel").value).toBe("");
    expect(screen.getByRole("button", { name: "auth.signupButton" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.sendOTP).not.toHaveBeenCalled();
  });

  async function openSignupOtpDialog() {
    await submitSignupForm();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  }

  async function submitSignupOtp() {
    fireEvent.change(screen.getByLabelText("6-digit verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "shared.verifyCreate" }));
  }

  it("keeps a genuine MSG91 verification failure OTP-specific", async () => {
    mocks.verifyOTP.mockRejectedValue(new Error("OTP_INVALID"));
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Incorrect OTP. Please check the code and try again."));
    expect(mocks.apiPost).not.toHaveBeenCalledWith("/api/v1/auth/signup-mobile-verified", expect.anything(), expect.anything());
  });

  it("shows a preflight error instead of an OTP-send error", async () => {
    configureApi({ preflightError: makeAxiosError("database unavailable") });
    await submitSignupForm();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "We couldn't check your account details. Please try again.",
    ));
    expect(mocks.sendOTP).not.toHaveBeenCalled();
  });

  it("keeps OTP-send failures in the send category", async () => {
    mocks.sendOTP.mockRejectedValue(new Error("unrecognized send-provider response"));
    await submitSignupForm();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "We couldn't send the OTP right now. Please try again in a moment.",
    ));
    expect(mocks.verifyOTP).not.toHaveBeenCalled();
  });

  it.each([
    ["OTP_EXPIRED", "This OTP has expired. Please request a new OTP."],
    ["OTP_ALREADY_USED", "This OTP has already been used. Please request a new OTP."],
    ["provider refused", "We couldn't verify your OTP right now. Please try again."],
    ["MSG91 widget configuration error", "OTP verification is temporarily unavailable. Please try again later."],
    ["Network timeout while verifying", "We couldn't verify your OTP right now. Please check your connection and try again."],
  ])("maps MSG91 verification failure %s to its stable category", async (providerError, message) => {
    mocks.verifyOTP.mockRejectedValue(new Error(providerError));
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(message));
  });

  it("does not remap an already-classified OTP_INVALID at the panel boundary", async () => {
    mocks.verifyOTP.mockRejectedValue(new OtpVerificationError("OTP_INVALID"));
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Incorrect OTP. Please check the code and try again."));
    expect(mocks.toastError.mock.calls[0][0]).not.toContain("account");
  });

  it("shows an account-setup error after MSG91 succeeds but Auth user creation fails", async () => {
    configureApi({ signupError: makeAxiosError("AUTH_USER_CREATION_FAILED") });
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Your OTP was verified, but we couldn't finish setting up your account. Please try again.",
    ));
    expect(mocks.verifyOTP).toHaveBeenCalledOnce();
    expect(mocks.toastError.mock.calls[0][0]).not.toContain("We couldn't verify the OTP");
  });

  it("shows an account-setup error after MSG91 succeeds but provisioning fails", async () => {
    configureApi({ signupError: makeAxiosError("USER_PROVISIONING_FAILED") });
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Your OTP was verified, but we couldn't finish setting up your account. Please try again.",
    ));
    expect(mocks.toastError.mock.calls[0][0]).not.toContain("We couldn't verify the OTP");
  });

  it("shows a session error after MSG91 and account creation succeed", async () => {
    configureApi({ sessionError: makeAxiosError("SESSION_REGISTRATION_FAILED") });
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Your account was created, but we couldn't finish signing you in. Please try again.",
    ));
    expect(mocks.toastError.mock.calls[0][0]).not.toContain("OTP");
  });

  it("does not swallow a failure in the panel's post-signup refresh", async () => {
    configureApi({ restoreError: new Error("late auth state request failed"), restoreErrorAt: 3 });
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Your account was created, but we couldn't finish signing you in. Please try again.",
    ));
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith("auth.accountCreated");
  });

  it("uses a phone-verification message when the backend rejects MSG91 token revalidation", async () => {
    configureApi({ signupError: makeAxiosError("INVALID_MSG91_VERIFICATION") });
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "We couldn't confirm this phone verification. Please request a new code and try again.",
    ));
  });

  it("continues normally when MSG91 and backend signup both succeed", async () => {
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.routerReplace).toHaveBeenCalled());
    expect(mocks.toastSuccess).toHaveBeenCalledWith("auth.accountCreated");
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("uses a generic account-setup error for an unknown backend failure", async () => {
    configureApi({ signupError: makeAxiosError("UNEXPECTED_DATABASE_FAILURE") });
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Your OTP was verified, but we couldn't finish setting up your account. Please try again.",
    ));
    expect(mocks.toastError.mock.calls[0][0]).not.toContain("We couldn't verify the OTP");
  });

  it("preserves a safe backend account-conflict message", async () => {
    configureApi({ signupError: makeAxiosError("An account already exists with this email or mobile number. Please login instead.") });
    await openSignupOtpDialog();
    await submitSignupOtp();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "An account already exists with this email or mobile number. Please login instead.",
    ));
  });
});