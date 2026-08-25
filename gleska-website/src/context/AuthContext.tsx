"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import apiClient from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { initializeMSG91Widget, retryOTP, sendOTP, verifyOTP } from "@/lib/msg91";

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
  isLoading: boolean;
  nextStep: NextStep | null;
  error: string | null;
  login: (mobile: string, otp: string, name: string, role: "WORKER" | "EMPLOYER") => Promise<void>;
  loginWithMobile: (mobile: string, otp: string, role: "WORKER" | "EMPLOYER") => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<NextStep | null>;
  requestOTP: (mobile: string) => Promise<void>;
  resendOTP: () => Promise<void>;
  signInWithEmail: (email: string, password: string, role: "WORKER" | "EMPLOYER") => Promise<void>;
  signInWithGoogle: (role: "WORKER" | "EMPLOYER") => Promise<void>;
  resolveGoogleSession: (role: "WORKER" | "EMPLOYER") => Promise<{ role: "WORKER" | "EMPLOYER"; nextStep: NextStep | null }>;
  provisionSession: (role: "WORKER" | "EMPLOYER", name?: string) => Promise<void>;
  completeEmailSignup: (email: string, password: string, name: string, mobile: string, otp: string, role: "WORKER" | "EMPLOYER") => Promise<void>;
  requestPasswordReset: (phone: string) => Promise<void>;
  verifyPasswordResetOTP: (phone: string, msg91AccessToken: string) => Promise<string>;
  completePasswordReset: (resetAuthorization: string, password: string, confirmPassword: string) => Promise<void>;
  signupPreflight: (name: string, email: string, mobile: string, password: string, confirmPassword: string, role: "WORKER" | "EMPLOYER") => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  nextStep: null,
  error: null,
  login: async () => {},
  loginWithMobile: async () => {},
  logout: async () => {},
  refreshUser: async () => null,
  requestOTP: async () => {},
  resendOTP: async () => {},
  signInWithEmail: async () => {},
  signInWithGoogle: async () => {},
  resolveGoogleSession: async () => ({ role: "WORKER", nextStep: null }),
  provisionSession: async () => {},
  completeEmailSignup: async () => {},
  requestPasswordReset: async () => {},
  verifyPasswordResetOTP: async () => "",
  completePasswordReset: async () => {},
  signupPreflight: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nextStep, setNextStep] = useState<NextStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const response = await apiClient.get("/api/v1/auth/me");
        if (response.data?.user) {
          setUser(response.data.user);
          setNextStep(response.data.next_step);
        }
      } catch (err: any) {
        if (err.response?.status === 401) {
          setUser(null);
          setNextStep(null);
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
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  const requestOTP = async (mobile: string) => {
    try {
      setError(null);
      await initializeMSG91Widget();
      await sendOTP(mobile);
    } catch (err: any) {
      const message = err.message || "Failed to send OTP";
      setError(message);
      throw new Error(message);
    }
  };

  const signupPreflight = async (name: string, email: string, mobile: string, password: string, confirmPassword: string, role: "WORKER" | "EMPLOYER") => {
    await apiClient.post("/api/v1/auth/signup-preflight", { name: name.trim(), email: email.trim().toLowerCase(), mobile, password, confirm_password: confirmPassword, role });
  };

  const resendOTP = async () => {
    try {
      setError(null);
      await initializeMSG91Widget();
      await retryOTP();
    } catch (err: any) {
      const message = err.message || "Failed to resend OTP";
      setError(message);
      throw new Error(message);
    }
  };

  const provisionSession = async (role: "WORKER" | "EMPLOYER", name = "") => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication session was not created");
    const response = await apiClient.post("/api/v1/auth/provision", {
      role,
      name,
      mobile: session.user.phone || undefined,
    });
    setUser(response.data);
    const state = await apiClient.get("/api/v1/auth/me");
    setNextStep(state.data?.next_step || null);
  };

  const signInWithEmail = async (email: string, password: string, role: "WORKER" | "EMPLOYER") => {
    setError(null);
    setIsLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      await provisionSession(role);
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || "Email login failed";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async (role: "WORKER" | "EMPLOYER") => {
    sessionStorage.setItem("goleska_oauth_role", role);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) throw oauthError;
  };

  const resolveGoogleSession = async (role: "WORKER" | "EMPLOYER") => {
    let { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      session = await new Promise<Session | null>((resolve) => {
        let settled = false;
        const finish = (value: NonNullable<typeof session> | null) => {
          if (settled) return;
          settled = true;
          subscription.subscription.unsubscribe();
          resolve(value);
        };
        const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
          if (nextSession || event === "SIGNED_OUT") finish(nextSession);
        });
        window.setTimeout(() => finish(null), 10000);
      });
    }
    if (!session) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const sessionResult = await supabase.auth.getSession();
        if (sessionResult.data.session) {
          session = sessionResult.data.session;
          break;
        }
      }
    }
    if (!session) throw new Error("Google authentication session was not created");
    await provisionSession(role, session.user.user_metadata?.full_name || session.user.user_metadata?.name || "");
    const response = await apiClient.get("/api/v1/auth/me", { withCredentials: true });
    const authenticatedRole = response.data?.user?.role;
    if (authenticatedRole !== "WORKER" && authenticatedRole !== "EMPLOYER") throw new Error("Unable to determine account role");
    return { role: authenticatedRole, nextStep: response.data?.next_step || null };
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

  const completeEmailSignup = async (email: string, password: string, name: string, mobile: string, otp: string, role: "WORKER" | "EMPLOYER") => {
    setError(null);
    setIsLoading(true);
    try {
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
      }, { skipSupabaseAuth: true });

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      setUser(response.data);
      const state = await apiClient.get("/api/v1/auth/me");
      setNextStep(state.data?.next_step || null);
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || "Signup failed";
      setError(message);
      await supabase.auth.signOut();
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (mobile: string, otp: string, name: string, role: "WORKER" | "EMPLOYER") => {
    try {
      setError(null);
      setIsLoading(true);
      const msg91Result = await verifyOTP(otp);

      const response = await apiClient.post("/api/v1/auth/complete-msg91", {
        mobile,
        name,
        role,
        msg91_access_token: msg91Result.accessToken,
      }, { withCredentials: true });

      if (response.data?.user) {
        setUser(response.data.user);
        setNextStep(response.data.next_step);
      }
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || "Authentication failed";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithMobile = async (mobile: string, otp: string, role: "WORKER" | "EMPLOYER") => {
    setError(null);
    setIsLoading(true);
    try {
      const msg91Result = await verifyOTP(otp);
      await supabase.auth.signOut();
      const response = await apiClient.post("/api/v1/auth/login-msg91", {
        mobile,
        role,
        msg91_access_token: msg91Result.accessToken,
      }, { skipSupabaseAuth: true });
      setUser(response.data.user);
      setNextStep(response.data.next_step);
    } catch (err: any) {
      const message = err.response?.data?.detail || err.message || "Mobile login failed";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      setError(null);
      await apiClient.post("/api/v1/auth/logout", {}, { withCredentials: true });
      await supabase.auth.signOut();
      setUser(null);
      setNextStep(null);
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUser = async (): Promise<NextStep | null> => {
    try {
      const response = await apiClient.get("/api/v1/auth/me", { withCredentials: true });
      if (response.data?.user) {
        setUser(response.data.user);
        setNextStep(response.data.next_step);
        setError(null);
        return response.data.next_step || null;
      }
    } catch (err) {
      console.error("Failed to refresh user:", err);
      setUser(null);
      setNextStep(null);
    }
    return null;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
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
        resolveGoogleSession,
        provisionSession,
        completeEmailSignup,
        requestPasswordReset,
        verifyPasswordResetOTP,
        completePasswordReset,
        signupPreflight,
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
