"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AxiosError } from "axios";
import { useAuth } from "@/context/AuthContext";
import { getRouteForNextStep } from "@/lib/auth-routing";
import { supabase } from "@/lib/supabase";
import apiClient from "@/lib/api";

function getStoredRole(): "WORKER" | "EMPLOYER" | null {
  if (typeof window === "undefined") return null;
  const sessionRole = sessionStorage.getItem("goleska_oauth_role");
  if (sessionRole === "WORKER" || sessionRole === "EMPLOYER") return sessionRole;
  const localRole = localStorage.getItem("goleska_oauth_role");
  if (localRole === "WORKER" || localRole === "EMPLOYER") return localRole;
  const match = document.cookie.match(/(?:^|;\s*)goleska_oauth_role=([^;]+)/);
  if (match && (match[1] === "WORKER" || match[1] === "EMPLOYER")) return match[1] as "WORKER" | "EMPLOYER";
  return null;
}

function getStoredAccountType(): "BUSINESS" | "INDIVIDUAL" {
  if (typeof window === "undefined") return "BUSINESS";
  const sessionType = sessionStorage.getItem("goleska_oauth_account_type");
  if (sessionType === "INDIVIDUAL") return "INDIVIDUAL";
  const localType = localStorage.getItem("goleska_oauth_account_type");
  if (localType === "INDIVIDUAL") return "INDIVIDUAL";
  const match = document.cookie.match(/(?:^|;\s*)goleska_oauth_account_type=([^;]+)/);
  return match?.[1] === "INDIVIDUAL" ? "INDIVIDUAL" : "BUSINESS";
}

function clearStoredRole() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem("goleska_oauth_role");
  localStorage.removeItem("goleska_oauth_role");
  localStorage.removeItem("goleska_oauth_account_type");
  document.cookie = "goleska_oauth_role=; path=/; max-age=0; SameSite=Lax";
  document.cookie = "goleska_oauth_account_type=; path=/; max-age=0; SameSite=Lax";
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const { provisionSession, setAuthState } = useAuth();
  const [error, setError] = useState("");
  const exchangeHandled = useRef(false);

  useEffect(() => {
    if (exchangeHandled.current) {
      console.log("[OAuth] Callback already handled. Skipping duplicate execution.");
      return;
    }
    exchangeHandled.current = true;

    const handleCallback = async () => {
      // PHASE 1: Extract and validate authorization code from URL
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get("code");
      const errorParam = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");

      // Check for OAuth provider errors (user denied, etc.)
      if (errorParam) {
        const message = errorDescription || errorParam;
        throw new Error(`Google OAuth error: ${message}`);
      }

      // Validate authorization code exists
      if (!code) {
        throw new Error(
          "Missing authorization code in callback URL. " +
          "This may happen if: (1) Supabase Redirect URL is not configured correctly, " +
          "(2) the browser navigation occurred, or (3) the OAuth session expired."
        );
      }

      // PHASE 2: Exchange authorization code for Supabase session (PKCE)
      let { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        console.log("[OAuth] Exchanging authorization code for session...");
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          const sessionCheck = await supabase.auth.getSession();
          if (!sessionCheck.data.session) {
            throw new Error(
              `OAuth code exchange failed: ${exchangeError.message}. ` +
              "This typically means: (1) PKCE code verifier was not stored (cleared storage?), " +
              "(2) code was already exchanged, or (3) code has expired (>10 minutes)."
            );
          }
          session = sessionCheck.data.session;
        }
      }

      // PHASE 3: Verify Supabase session was established
      if (!session) {
        console.log("[OAuth] Verifying Supabase session...");
        const sessionResult = await supabase.auth.getSession();
        session = sessionResult.data.session;
      }

      if (!session || !session.user) {
        throw new Error(
          "No Supabase session established after code exchange. " +
          "This may indicate the code exchange succeeded but session was not stored."
        );
      }

      console.log("[OAuth] Session verified. User ID:", session.user.id);

      // PHASE 4: Check if user is already provisioned in backend
      console.log("[OAuth] Checking if user already exists in backend...");
      try {
        const meRes = await apiClient.get("/api/v1/auth/me", { withCredentials: true });
        if (meRes.data?.user?.role) {
          // Existing user - redirect to appropriate route
          console.log("[OAuth] User already provisioned. Role:", meRes.data.user.role);
          const existingRole = meRes.data.user.role as "WORKER" | "EMPLOYER";
          const nextStep = meRes.data.next_step;
          clearStoredRole();
          setAuthState(meRes.data.user, meRes.data.next_step || null);
          const targetRoute = getRouteForNextStep(existingRole, nextStep);
          console.log("[OAuth] Redirecting existing user to:", targetRoute);
          router.replace(targetRoute);
          return;
        }
      } catch (meError: unknown) {
        // User not yet provisioned in backend (401 is expected for new user)
        const axiosError = meError as AxiosError;
        if (axiosError?.response?.status === 401) {
          console.log("[OAuth] User not yet provisioned (401 expected for new user)");
        } else {
          console.warn("[OAuth] Unexpected error checking user:", axiosError?.message);
        }
      }

      // PHASE 5: New user provisioning with selected role
      const storedRole = getStoredRole();
      if (!storedRole) {
        throw new Error(
          "Cannot determine your role. This happens when: " +
          "(1) OAuth was started in a different browser/tab, " +
          "(2) storage was cleared during OAuth, or " +
          "(3) you navigated directly to this page."
        );
      }
      const storedAccountType = getStoredAccountType();

      console.log("[OAuth] Provisioning new user with role:", storedRole);
      try {
        // Provision the user in the backend using the Supabase session established in PHASE 2
        // provisionSession now returns the user and nextStep directly without needing a third API call here
        const provisionedData = await provisionSession(storedRole, "", storedAccountType);
        console.log("[OAuth] User provisioned successfully");

        const authenticatedRole = provisionedData.user.role as "WORKER" | "EMPLOYER";
        const nextStep = provisionedData.nextStep;

        if (!authenticatedRole) {
          throw new Error(
            "Unable to determine account role after provisioning. " +
            "Backend returned user but role is missing."
          );
        }

        console.log("[OAuth] Authentication complete. Role:", authenticatedRole, "NextStep:", nextStep);

        // Clear temporary OAuth state
        clearStoredRole();

        // Redirect to appropriate route
        const finalRoute = getRouteForNextStep(authenticatedRole, nextStep);
        console.log("[OAuth] Redirecting new user to:", finalRoute);
        router.replace(finalRoute);
      } catch (provisionError) {
        throw new Error(
          provisionError instanceof Error
            ? provisionError.message
            : "Failed to provision user account in backend"
        );
      }
    };

    handleCallback().catch(async (callbackError: Error) => {
      clearStoredRole();
      // Sign out any stale Supabase session to prevent middleware redirecting to dashboard/onboarding
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.warn("[OAuth] Error signing out stale session:", signOutError);
      }
      const message = callbackError.message || "Google authentication failed";
      console.error("[OAuth] Authentication error:", message);
      toast.error(message);
      setError(message);
    });
  }, [provisionSession, setAuthState, router]);

  const handleReturnToSignIn = () => {
    clearStoredRole();
    router.replace("/auth/signin");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#040d1e] px-6 text-white">
      <div className="text-center">
        {error ? (
          <>
            <p className="mb-5 text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={handleReturnToSignIn}
              className="rounded-xl bg-blue-600 px-5 py-3 font-bold hover:bg-blue-500 transition"
            >
              Return to Sign In
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            <p className="text-sm font-medium text-slate-400">Completing authentication...</p>
          </div>
        )}
      </div>
    </main>
  );
}
