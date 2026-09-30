import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { environment, missingBackendConfiguration, missingSupabaseConfiguration } from "../../config/environment";
import type { AccountType, AuthStateResponse, AuthUser, NextStep, UserRole } from "../../types/auth";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import { clearSessionKey, registerMobileSession } from "../../lib/session";
import { getSupabaseClient } from "../../lib/supabase";
import { normalizeIndianMobile, retryMsg91Otp, sendMsg91Otp, verifyMsg91Otp } from "../../lib/msg91";

type SignupInput = {
  name: string;
  email: string;
  mobile: string;
  password: string;
  confirmPassword: string;
  role: Exclude<UserRole, "ADMIN">;
  accountType: AccountType;
};

interface AuthContextValue {
  user: AuthUser | null;
  nextStep: NextStep | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string;
  refreshAuth: () => Promise<AuthStateResponse>;
  signInWithEmail: (email: string, password: string) => Promise<AuthStateResponse>;
  sendLoginOtp: (mobile: string) => Promise<{ requestId: string | null }>;
  signInWithMobileOtp: (mobile: string, otp: string) => Promise<AuthStateResponse>;
  beginSignup: (input: SignupInput) => Promise<{ requestId: string | null }>;
  completeSignup: (input: SignupInput, otp: string) => Promise<AuthStateResponse>;
  startGoogleAuth: (role: Exclude<UserRole, "ADMIN"> | undefined, accountType: AccountType) => Promise<void>;
  completeOAuthCallback: () => Promise<AuthStateResponse>;
  requestPasswordResetOtp: (mobile: string) => Promise<{ requestId: string | null }>;
  verifyPasswordResetOtp: (mobile: string, otp: string) => Promise<string>;
  retryPasswordResetOtp: (mobile: string, requestId: string | null) => Promise<string | null>;
  retryOtp: (mobile: string, requestId: string | null) => Promise<string | null>;
  resetPasswordWithAuthorization: (authorization: string, password: string, confirmPassword: string) => Promise<void>;
  resetPasswordWithRecoverySession: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const oauthCallbackTasks = new Map<string, Promise<AuthStateResponse>>();

function accountTypeFromStorage(): AccountType {
  return localStorage.getItem("goleska_oauth_account_type") === "INDIVIDUAL" ? "INDIVIDUAL" : "BUSINESS";
}

function storedSignupRole(): Exclude<UserRole, "ADMIN"> | null {
  const role = localStorage.getItem("goleska_oauth_role");
  return role === "WORKER" || role === "EMPLOYER" ? role : null;
}

function clearOAuthState() {
  localStorage.removeItem("goleska_oauth_role");
  localStorage.removeItem("goleska_oauth_account_type");
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [nextStep, setNextStep] = useState<NextStep | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const applyAuthState = (state: AuthStateResponse) => {
    setUser(state.user);
    setNextStep(state.next_step);
    setError("");
    return state;
  };

  const refreshAuth = async () => {
    const state = await apiGet<AuthStateResponse>("/api/v1/auth/me");
    return applyAuthState(state);
  };

  const provisionAndRestore = async (
    role?: Exclude<UserRole, "ADMIN">,
    name = "",
    accountType: AccountType = "BUSINESS",
  ) => {
    const { data: { session } } = await getSupabaseClient().auth.getSession();
    if (!session) throw new Error("Supabase did not establish an authenticated session.");

    await apiPost("/api/v1/auth/provision", {
      ...(role ? { role } : {}),
      name,
      mobile: session.user.phone || undefined,
    });
    await registerMobileSession();

    let state = await apiGet<AuthStateResponse>("/api/v1/auth/me");
    if (role === "EMPLOYER" && state.user.role === "EMPLOYER" && accountType === "INDIVIDUAL" && !state.user.employer_type) {
      await apiPost("/api/v1/employers/onboarding/type", { employer_type: "INDIVIDUAL" });
      state = await apiGet<AuthStateResponse>("/api/v1/auth/me");
    }
    return applyAuthState(state);
  };

  useEffect(() => {
    let disposed = false;
    const restore = async () => {
      if (missingBackendConfiguration()) {
        setIsLoading(false);
        return;
      }
      try {
        const state = await refreshAuth();
        if (disposed) return;
        applyAuthState(state);
      } catch (restoreError) {
        if (disposed) return;
        if (restoreError instanceof ApiError && restoreError.status === 401) {
          setUser(null);
          setNextStep(null);
          clearSessionKey();
          if (!missingSupabaseConfiguration()) {
            await getSupabaseClient().auth.signOut();
          }
        } else {
          setError(errorMessage(restoreError));
        }
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };
    void restore();

    let authSubscription: { unsubscribe: () => void } | undefined;
    if (!missingSupabaseConfiguration()) {
      const { data } = getSupabaseClient().auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          setUser(null);
          setNextStep(null);
        }
      });
      authSubscription = data.subscription;
    }

    let appListener: { remove: () => Promise<void> } | undefined;
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && !missingBackendConfiguration()) {
        void refreshAuth().catch(() => undefined);
      }
    }).then((listener) => {
      appListener = listener;
      if (disposed) void listener.remove();
    }).catch(() => undefined);

    let backListener: { remove: () => Promise<void> } | undefined;
    void CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack && window.history.length > 1) window.history.back();
      else void CapacitorApp.exitApp();
    }).then((listener) => {
      backListener = listener;
      if (disposed) void listener.remove();
    }).catch(() => undefined);

    let urlListener: { remove: () => Promise<void> } | undefined;
    void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
      try {
        const incoming = new URL(url);
        if (incoming.host !== "auth") return;
        const target = incoming.pathname === "/reset-password" ? "/auth/reset-password" : "/auth/callback";
        const query = incoming.search;
        const fragment = incoming.hash;
        window.history.replaceState(null, "", `${target}${query}${fragment}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
        void Browser.close().catch(() => undefined);
      } catch {
        setError("The sign-in callback link is invalid.");
      }
    }).then((listener) => {
      urlListener = listener;
      if (disposed) void listener.remove();
    }).catch(() => undefined);

    return () => {
      disposed = true;
      authSubscription?.unsubscribe();
      if (appListener) void appListener.remove();
      if (backListener) void backListener.remove();
      if (urlListener) void urlListener.remove();
    };
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    setError("");
    if (missingSupabaseConfiguration()) throw new Error("Supabase is not configured for this build.");
    if (missingBackendConfiguration()) throw new Error("The GLESKA API URL is not configured for this build.");

    try {
      try {
        await apiPost("/api/v1/auth/logout", {}, { skipSupabaseAuth: true });
      } catch {
        // Match the website: clear any previous local session even if backend logout is unavailable.
      }
      clearSessionKey();
      await getSupabaseClient().auth.signOut();
      const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      setIsLoading(true);
      return await provisionAndRestore();
    } catch (authError) {
      await getSupabaseClient().auth.signOut();
      setUser(null);
      setNextStep(null);
      const message = errorMessage(authError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const sendLoginOtp = async (mobile: string) => {
    setError("");
    return await sendMsg91Otp(mobile);
  };

  const signInWithMobileOtp = async (mobile: string, otp: string) => {
    setError("");
    setIsLoading(true);
    try {
      const msg91AccessToken = await verifyMsg91Otp(otp);
      if (!missingSupabaseConfiguration()) await getSupabaseClient().auth.signOut();
      clearSessionKey();
      await apiPost("/api/v1/auth/login-msg91", {
        mobile: normalizeIndianMobile(mobile),
        msg91_access_token: msg91AccessToken,
      }, { skipSupabaseAuth: true });
      await registerMobileSession();
      return await refreshAuth();
    } catch (authError) {
      const message = errorMessage(authError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const beginSignup = async (input: SignupInput) => {
    setError("");
    const mobile = normalizeIndianMobile(input.mobile);
    await apiPost("/api/v1/auth/signup-preflight", {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      mobile,
      password: input.password,
      confirm_password: input.confirmPassword,
      role: input.role,
      terms_accepted: true,
    }, { skipSupabaseAuth: true });
    return await sendMsg91Otp(mobile);
  };

  const completeSignup = async (input: SignupInput, otp: string) => {
    setError("");
    setIsLoading(true);
    try {
      const msg91AccessToken = await verifyMsg91Otp(otp);
      await apiPost("/api/v1/auth/signup-mobile-verified", {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        mobile: normalizeIndianMobile(input.mobile),
        password: input.password,
        confirm_password: input.confirmPassword,
        role: input.role,
        msg91_access_token: msg91AccessToken,
        terms_accepted: true,
      }, { skipSupabaseAuth: true });

      const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({
        email: input.email.trim().toLowerCase(),
        password: input.password,
      });
      if (signInError) throw signInError;
      await registerMobileSession();
      let state = await refreshAuth();
      if (input.role === "EMPLOYER" && input.accountType === "INDIVIDUAL" && !state.user.employer_type) {
        await apiPost("/api/v1/employers/onboarding/type", { employer_type: "INDIVIDUAL" });
        state = await refreshAuth();
      }
      return state;
    } catch (authError) {
      if (!missingSupabaseConfiguration()) await getSupabaseClient().auth.signOut();
      const message = errorMessage(authError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const startGoogleAuth = async (role: Exclude<UserRole, "ADMIN"> | undefined, accountType: AccountType) => {
    setError("");
    if (missingSupabaseConfiguration()) throw new Error("Supabase is not configured for this build.");
    clearSessionKey();
    if (role) localStorage.setItem("goleska_oauth_role", role);
    else localStorage.removeItem("goleska_oauth_role");
    localStorage.setItem("goleska_oauth_account_type", accountType);

    const { data, error: oauthError } = await getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: Capacitor.isNativePlatform() ? environment.oauthRedirectUrl : `${window.location.origin}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });
    if (oauthError) throw oauthError;
    if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");

    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: data.url });
    } else {
      window.location.assign(data.url);
    }
  };

  const completeOAuthCallback = () => {
    setError("");
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error_description") || params.get("error");
    if (oauthError) throw new Error(oauthError);
    const code = params.get("code");
    if (!code) throw new Error("The Google sign-in callback did not include an authorization code.");

    const existingTask = oauthCallbackTasks.get(code);
    if (existingTask) return existingTask;

    const callbackTask = (async () => {
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          const { data: { session: recoveredSession } } = await supabase.auth.getSession();
          if (!recoveredSession) throw exchangeError;
        }
      }

      const callbackUrl = new URL(window.location.href);
      callbackUrl.searchParams.delete("code");
      callbackUrl.searchParams.delete("state");
      callbackUrl.searchParams.delete("error");
      callbackUrl.searchParams.delete("error_description");
      window.history.replaceState(window.history.state, "", `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);

      try {
        const state = await refreshAuth();
        await registerMobileSession();
        clearOAuthState();
        return state;
      } catch (authError) {
        if (!(authError instanceof ApiError) || authError.status !== 401) throw authError;
        const role = storedSignupRole();
        if (!role) throw new Error("Cannot determine the selected account type for this new Google account.");
        const state = await provisionAndRestore(role, "", accountTypeFromStorage());
        clearOAuthState();
        return state;
      }
    })();

    oauthCallbackTasks.set(code, callbackTask);
    while (oauthCallbackTasks.size > 4) {
      const oldestCode = oauthCallbackTasks.keys().next().value;
      if (oldestCode === undefined) break;
      oauthCallbackTasks.delete(oldestCode);
    }
    return callbackTask;
  };

  const requestPasswordResetOtp = async (mobile: string) => {
    const normalizedMobile = normalizeIndianMobile(mobile);
    await apiPost("/api/v1/auth/forgot-password/request-otp", { phone: normalizedMobile }, { skipSupabaseAuth: true });
    return await sendMsg91Otp(normalizedMobile);
  };

  const verifyPasswordResetOtp = async (mobile: string, otp: string) => {
    const msg91AccessToken = await verifyMsg91Otp(otp);
    const response = await apiPost<{ reset_authorization: string }>("/api/v1/auth/forgot-password/verify-otp", {
      phone: normalizeIndianMobile(mobile),
      msg91_access_token: msg91AccessToken,
    }, { skipSupabaseAuth: true });
    return response.reset_authorization;
  };

  const retryPasswordResetOtp = async (mobile: string, requestId: string | null) => {
    const normalizedMobile = normalizeIndianMobile(mobile);
    await apiPost("/api/v1/auth/resend-otp", { mobile: normalizedMobile, channel: "SMS" }, { skipSupabaseAuth: true });
    const result = await retryMsg91Otp("SMS", requestId);
    return result.requestId;
  };

  const retryOtp = async (mobile: string, requestId: string | null) => {
    const normalizedMobile = normalizeIndianMobile(mobile);
    await apiPost("/api/v1/auth/resend-otp", { mobile: normalizedMobile, channel: "SMS" }, { skipSupabaseAuth: true });
    const result = await retryMsg91Otp("SMS", requestId);
    return result.requestId;
  };

  const resetPasswordWithAuthorization = async (authorization: string, password: string, confirmPassword: string) => {
    await apiPost("/api/v1/auth/forgot-password/reset", {
      reset_authorization: authorization,
      password,
      confirm_password: confirmPassword,
    }, { skipSupabaseAuth: true });
  };

  const resetPasswordWithRecoverySession = async (password: string) => {
    const { error: updateError } = await getSupabaseClient().auth.updateUser({ password });
    if (updateError) throw updateError;
    await getSupabaseClient().auth.signOut();
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await apiPost("/api/v1/auth/logout", {});
    } catch {
      // Sign out locally even when the backend session has already expired.
    } finally {
      if (!missingSupabaseConfiguration()) {
        try {
          await getSupabaseClient().auth.signOut();
        } catch {
          // Clear local app state regardless of the provider response.
        }
      }
      clearSessionKey();
      clearOAuthState();
      setUser(null);
      setNextStep(null);
      setError("");
      setIsLoading(false);
    }
  };

  const value: AuthContextValue = {
    user,
    nextStep,
    isLoading,
    isAuthenticated: !!user,
    error,
    refreshAuth,
    signInWithEmail,
    sendLoginOtp,
    signInWithMobileOtp,
    beginSignup,
    completeSignup,
    startGoogleAuth,
    completeOAuthCallback,
    requestPasswordResetOtp,
    verifyPasswordResetOtp,
    retryPasswordResetOtp,
    retryOtp,
    resetPasswordWithAuthorization,
    resetPasswordWithRecoverySession,
    logout,
    clearError: () => setError(""),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}