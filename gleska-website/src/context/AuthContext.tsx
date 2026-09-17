"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { initializeMSG91Widget, retryOTP, sendOTP, verifyOTP } from "@/lib/msg91";
import { registerSession, clearSessionKey, logSecurityActivity, parseDeviceInfo } from "@/lib/security";

export interface AuthUser {
  id: string;
  name: string;
  mobile?: string | null;
  email?: string | null;
  role: "WORKER" | "EMPLOYER" | "ADMIN";
  onboarding_status?: string;
  employer_type?: string;
  profile_completed?: boolean;
  is_mobile_verified: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  subscription_valid_until?: string | null;
  profile_photo_url?: string | null;
}

export type NextStep =
  | "DASHBOARD"
  | "EMPLOYER_TYPE_SELECTION"
  | "REGISTERED_INDUSTRY_DETAILS"
  | "REGISTERED_BUSINESS_DETAILS"
  | "UNREGISTERED_BUSINESS_DETAILS"
  | "INDIVIDUAL_DETAILS"
  | "WORKER_PROFILE";

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  isLoggingOut: boolean;
  nextStep: NextStep | null;
  error: string | null;
  login: (mobile: string, otp: string, name: string, role: "WORKER" | "EMPLOYER" | "ADMIN") => Promise<void>;
  loginWithMobile: (mobile: string, otp: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<NextStep | null>;
  requestOTP: (mobile: string) => Promise<{ requestId: string | null }>;
  resendOTP: (mobile: string, requestId?: string | null, channel?: "SMS" | "EMAIL") => Promise<void>;
  signInWithEmail: (email: string, password: string, role?: "WORKER" | "EMPLOYER" | "ADMIN") => Promise<AuthUser>;
  signInWithGoogle: (role?: "WORKER" | "EMPLOYER" | "ADMIN", accountType?: "BUSINESS" | "INDIVIDUAL") => Promise<void>;
  provisionSession: (role?: "WORKER" | "EMPLOYER" | "ADMIN", name?: string, accountType?: "BUSINESS" | "INDIVIDUAL") => Promise<{ user: AuthUser; nextStep: NextStep | null }>;
  completeEmailSignup: (email: string, password: string, name: string, mobile: string, otp: string, role: "WORKER" | "EMPLOYER" | "ADMIN", termsAccepted?: boolean, accountType?: "BUSINESS" | "INDIVIDUAL") => Promise<void>;
  requestPasswordReset: (phone: string) => Promise<void>;
  verifyPasswordResetOTP: (phone: string, msg91AccessToken: string) => Promise<string>;
  completePasswordReset: (resetAuthorization: string, password: string, confirmPassword: string) => Promise<void>;
  signupPreflight: (name: string, email: string, mobile: string, password: string, confirmPassword: string, role: "WORKER" | "EMPLOYER", termsAccepted?: boolean) => Promise<void>;
  setAuthState: (user: AuthUser, nextStep: NextStep | null) => void;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isSubscribed: false,
  isLoading: true,
  isLoggingOut: false,
  nextStep: null,
  error: null,
  login: async () => {},
  loginWithMobile: async () => ({} as AuthUser),
  logout: async () => {},
  refreshUser: async () => null,
  requestOTP: async () => ({ requestId: null }),
  resendOTP: async () => {},
  signInWithEmail: async () => ({} as AuthUser),
  signInWithGoogle: async () => {},
  provisionSession: async () => ({ user: {} as AuthUser, nextStep: null }),
  completeEmailSignup: async () => {},
  requestPasswordReset: async () => {},
  verifyPasswordResetOTP: async () => "",
  completePasswordReset: async () => {},
  signupPreflight: async () => {},
  setAuthState: () => {},
});

const setClientAuthCookie = () => {
  if (typeof document !== "undefined") {
    document.cookie = "goleska_client_auth=1; path=/; max-age=604800; SameSite=Lax";
  }
};

const clearClientAuthCookie = () => {
  if (typeof document !== "undefined") {
    document.cookie = "goleska_client_auth=; path=/; max-age=0; SameSite=Lax";
  }
};

const clearLanguageCache = () => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("goleska_lang");
  }
};

const AUTH_SYNC_KEY = "goleska_auth_sync";

const notifyAuthStateChange = () => {
  if (typeof window !== "undefined") {
    localStorage.setItem(AUTH_SYNC_KEY, String(Date.now()));
  }
};

const clearBackendSession = async () => {
  try {
    await apiClient.post("/api/v1/auth/logout", {}, { skipSupabaseAuth: true, withCredentials: true });
  } catch {
    // The backend may already consider the session expired.
  }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [nextStep, setNextStep] = useState<NextStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setAuthState = (newUser: AuthUser, newNextStep: NextStep | null) => {
    setUser(newUser);
    setNextStep(newNextStep);
    setClientAuthCookie();
    notifyAuthStateChange();
    setError(null);
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const response = await apiClient.get("/api/v1/auth/me");
        if (response.data?.user) {
          setUser(response.data.user);
          setNextStep(response.data.next_step);
          setClientAuthCookie();
        }
      } catch (err: any) {
        if (err.response?.status === 401) {
          setUser(null);
          setNextStep(null);
          clearClientAuthCookie();
        }
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setNextStep(null);
        clearClientAuthCookie();
        clearLanguageCache();
        notifyAuthStateChange();
      }
    });
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_SYNC_KEY) return;
      void apiClient.get("/api/v1/auth/me").then((response) => {
        if (response.data?.user) {
          setUser(response.data.user);
          setNextStep(response.data.next_step || null);
          setClientAuthCookie();
        } else {
          setUser(null);
          setNextStep(null);
          clearClientAuthCookie();
        }
      }).catch(() => {
        setUser(null);
        setNextStep(null);
        clearClientAuthCookie();
      });
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      subscription.subscription.unsubscribe();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const requestOTP = async (mobile: string) => {
    try {
      setError(null);
      await initializeMSG91Widget();
      const result = await sendOTP(mobile);
      return { requestId: result.requestId ?? null };
    } catch (err: any) {
      const message = err.message || "Failed to send OTP";
      setError(message);
      throw new Error(message);
    }
  };

  const signupPreflight = async (name: string, email: string, mobile: string, password: string, confirmPassword: string, role: "WORKER" | "EMPLOYER", termsAccepted = true) => {
    await apiClient.post("/api/v1/auth/signup-preflight", {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      mobile,
      password,
      confirm_password: confirmPassword,
      role,
      terms_accepted: termsAccepted,
    });
  };

const resendOTP = async (mobile: string, requestId: string | null = null, channel: "SMS" | "EMAIL" = "SMS") => {
    try {
      setError(null);

      if (!mobile) {
        throw new Error("Mobile number is required to resend OTP");
      }

      // Call backend endpoint to validate resend request and enforce rate limiting
      try {
        await apiClient.post(
          "/api/v1/auth/resend-otp",
          { mobile, channel },
          { skipSupabaseAuth: true }
        );
      } catch (backendErr: any) {
        const statusCode = backendErr.response?.status;
        const errorDetail = backendErr.response?.data?.detail || backendErr.message;

        if (statusCode === 429) {
          console.warn("[MSG91] Backend resend authorization: blocked (rate limited)");
          throw new Error(errorDetail || "Please wait before requesting another OTP");
        }

        console.warn("[MSG91] Backend resend authorization: blocked (error)", errorDetail);
        throw new Error(errorDetail || "Failed to authorize resend request");
      }

      // Only if backend approved, call MSG91 retry
      await initializeMSG91Widget();
      await retryOTP(channel, requestId);
    } catch (err: any) {
      const message = err.message || "Failed to resend OTP";
      setError(message);
      throw new Error(message);
    }
  };

  const provisionSession = async (role?: "WORKER" | "EMPLOYER" | "ADMIN", name = "", accountType: "BUSINESS" | "INDIVIDUAL" = "BUSINESS") => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication session was not created");
    await apiClient.post("/api/v1/auth/provision", {
      ...(role ? { role } : {}),
      name,
      mobile: session.user.phone || undefined,
    });
    await registerSession();
    let state = await apiClient.get("/api/v1/auth/me");
    if (!state.data?.user) {
      throw new Error("Backend authentication could not be confirmed");
    }
    if (role === "EMPLOYER" && accountType === "INDIVIDUAL" && !state.data.user.employer_type) {
      await apiClient.post("/api/v1/employers/onboarding/type", { employer_type: "INDIVIDUAL" });
      state = await apiClient.get("/api/v1/auth/me");
    }
    setUser(state.data.user);
    setNextStep(state.data.next_step || null);
    setClientAuthCookie();
    notifyAuthStateChange();
    return { user: state.data.user, nextStep: state.data.next_step || null };
  };

  const signInWithEmail = async (email: string, password: string, role?: "WORKER" | "EMPLOYER" | "ADMIN") => {
    setError(null);
    setIsLoading(true);
    try {
      await clearBackendSession();
      clearSessionKey();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      // provisionSession already calls registerSession internally
      const provisioned = await provisionSession(role);
      return provisioned.user;
    } catch (err: any) {
      let message = err.message || "Email login failed";
      
      // Handle specific ADMIN authorization error
      if (role === "ADMIN" && err.response?.data?.detail === "ADMIN_ROLE_UNAUTHORIZED") {
        message = "This account is not authorized for admin access.";
      } else if (err.response?.data?.detail) {
        message = err.response.data.detail;
      }
      
      setError(message);
      await supabase.auth.signOut();
      setUser(null);
      setNextStep(null);
      clearClientAuthCookie();
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async (role?: "WORKER" | "EMPLOYER" | "ADMIN", accountType: "BUSINESS" | "INDIVIDUAL" = "BUSINESS") => {
    clearSessionKey();
    const requestedNext = new URLSearchParams(window.location.search).get("next") || "";
      if (role) {
        sessionStorage.setItem("goleska_oauth_role", role);
      } else {
        sessionStorage.removeItem("goleska_oauth_role");
      }
    sessionStorage.setItem("goleska_oauth_account_type", accountType);
    sessionStorage.setItem("goleska_oauth_next", requestedNext);
    try {
      if (role) localStorage.setItem("goleska_oauth_role", role);
        else {
          localStorage.removeItem("goleska_oauth_role");
        }
      localStorage.setItem("goleska_oauth_account_type", accountType);
      localStorage.setItem("goleska_oauth_next", requestedNext);
      document.cookie = `goleska_oauth_role=${role}; path=/; max-age=600; SameSite=Lax`;
      document.cookie = `goleska_oauth_account_type=${accountType}; path=/; max-age=600; SameSite=Lax`;
      document.cookie = `goleska_oauth_next=${encodeURIComponent(requestedNext)}; path=/; max-age=600; SameSite=Lax`;
    } catch {}
    const redirectTo =
      process.env.NODE_ENV === "development"
        ? `${window.location.origin}/auth/callback`
        : "https://www.goleska.in/auth/callback";
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthError) throw oauthError;
  };

  const requestPasswordReset = async (phone: string) => {
    await apiClient.post("/api/v1/auth/forgot-password/request-otp", { phone: phone.trim() }, { skipSupabaseAuth: true });
  };

  const verifyPasswordResetOTP = async (phone: string, msg91AccessToken: string) => {
    const response = await apiClient.post("/api/v1/auth/forgot-password/verify-otp", {
      phone: phone.trim(),
      msg91_access_token: msg91AccessToken,
    }, { skipSupabaseAuth: true });
    return response.data.reset_authorization as string;
  };

  const completePasswordReset = async (resetAuthorization: string, password: string, confirmPassword: string) => {
    await apiClient.post("/api/v1/auth/forgot-password/reset", {
      reset_authorization: resetAuthorization,
      password,
      confirm_password: confirmPassword,
    }, { skipSupabaseAuth: true });
  };

  const completeEmailSignup = async (email: string, password: string, name: string, mobile: string, otp: string, role: "WORKER" | "EMPLOYER" | "ADMIN", termsAccepted = true, accountType: "BUSINESS" | "INDIVIDUAL" = "BUSINESS") => {
    setError(null);
    setIsLoading(true);
    try {
      clearSessionKey();
      const msg91Result = await verifyOTP(otp);
      const normalizedMobile = mobile.replace(/\D/g, "");
      const response = await apiClient.post("/api/v1/auth/signup-mobile-verified", {
        name,
        email: email.trim().toLowerCase(),
        mobile: normalizedMobile,
        password,
        confirm_password: password,
        role,
        msg91_access_token: msg91Result.accessToken,
        terms_accepted: termsAccepted,
      }, { skipSupabaseAuth: true });

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      await registerSession();
      setUser(response.data);
      setClientAuthCookie();
      let state = await apiClient.get("/api/v1/auth/me");
      if (role === "EMPLOYER" && accountType === "INDIVIDUAL" && !state.data?.user?.employer_type) {
        await apiClient.post("/api/v1/employers/onboarding/type", { employer_type: "INDIVIDUAL" });
        state = await apiClient.get("/api/v1/auth/me");
      }
      setNextStep(state.data?.next_step || null);
      notifyAuthStateChange();
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || "Signup failed";
      setError(message);
      await supabase.auth.signOut();
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (mobile: string, otp: string, name: string, role: "WORKER" | "EMPLOYER" | "ADMIN") => {
    try {
      setError(null);
      setIsLoading(true);
      clearSessionKey();
      const msg91Result = await verifyOTP(otp);

      const response = await apiClient.post("/api/v1/auth/complete-msg91", {
        mobile,
        name,
        role,
        msg91_access_token: msg91Result.accessToken,
      }, { withCredentials: true });

      if (response.data?.user) {
        await registerSession();
        setUser(response.data.user);
        setNextStep(response.data.next_step);
        notifyAuthStateChange();
      }
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || "Authentication failed";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithMobile = async (mobile: string, otp: string) => {
    setError(null);
    setIsLoading(true);
    try {
      await clearBackendSession();
      clearSessionKey();
      const msg91Result = await verifyOTP(otp);
      await supabase.auth.signOut();
      const response = await apiClient.post("/api/v1/auth/login-msg91", {
        mobile,
        msg91_access_token: msg91Result.accessToken,
      }, { skipSupabaseAuth: true });
      if (response.data.user?.id) {
        await registerSession();
      }
      setUser(response.data.user);
      setNextStep(response.data.next_step);
      setClientAuthCookie();
      notifyAuthStateChange();
      return response.data.user as AuthUser;
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || "Mobile login failed";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setError(null);
    setIsLoggingOut(true);
    try {
      // Log security activity before signing out (non-blocking, best-effort)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const deviceInfo = parseDeviceInfo();
        logSecurityActivity(supabase, session.user.id, {
          event_type: "logout",
          description: `Signed out from ${deviceInfo.deviceName}`,
          device_name: deviceInfo.deviceName,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
        });
      }
      await apiClient.post("/api/v1/auth/logout", {}, { withCredentials: true });
    } catch (err) {
      console.error("Backend logout error:", err);
    } finally {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error("Supabase logout error:", err);
      }
      setUser(null);
      setNextStep(null);
      clearClientAuthCookie();
      clearLanguageCache();
      clearSessionKey();
      notifyAuthStateChange();
      setIsLoading(false);
      setIsLoggingOut(false);
      if (typeof window !== "undefined") {
        window.location.replace("/");
      }
    }
  };

  const refreshUser = async (): Promise<NextStep | null> => {
    try {
      const response = await apiClient.get("/api/v1/auth/me", { withCredentials: true });
      if (response.data?.user) {
        setUser(response.data.user);
        setNextStep(response.data.next_step);
        setClientAuthCookie();
        setError(null);
        return response.data.next_step || null;
      }
    } catch (err) {
      console.error("Failed to refresh user:", err);
      setUser(null);
      setNextStep(null);
      clearClientAuthCookie();
    }
    return null;
  };

  const isSubscribed = Boolean(
    user?.subscription_valid_until &&
      new Date(user.subscription_valid_until).getTime() > Date.now()
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isSubscribed,
        isLoading,
        isLoggingOut,
        nextStep,
        error,
        login,
        loginWithMobile,
        logout,
        refreshUser,
        requestOTP,
        resendOTP,
        signInWithEmail,
        signInWithGoogle,
        provisionSession,
        completeEmailSignup,
        requestPasswordReset,
        verifyPasswordResetOTP,
        completePasswordReset,
        signupPreflight,
        setAuthState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
