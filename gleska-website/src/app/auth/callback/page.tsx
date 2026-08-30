"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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

function clearStoredRole() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem("goleska_oauth_role");
  localStorage.removeItem("goleska_oauth_role");
  document.cookie = "goleska_oauth_role=; path=/; max-age=0; SameSite=Lax";
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const { provisionSession, refreshUser } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const handleCallback = async () => {
      // 1. PKCE flow: exchange authorization code (ONLY place where code is exchanged)
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          throw new Error(`OAuth code exchange failed: ${exchangeError.message}`);
        }
      } else {
        throw new Error("Missing authorization code in callback URL");
      }

      // 2. Check if user is already provisioned in the backend
      try {
        const meRes = await apiClient.get("/api/v1/auth/me", { withCredentials: true });
        if (meRes.data?.user?.role) {
          // Existing user - just redirect to appropriate route
          const existingRole = meRes.data.user.role as "WORKER" | "EMPLOYER";
          const nextStep = meRes.data.next_step;
          clearStoredRole();
          await refreshUser();
          if (active) {
            router.replace(getRouteForNextStep(existingRole, nextStep));
          }
          return;
        }
      } catch (meError) {
        // User not yet provisioned in backend (401 or other error) -> proceed to provisioning
        console.log("User not yet provisioned, will proceed to provisioning");
      }

      // 3. New user: provision with selected role (no second code exchange)
      const storedRole = getStoredRole() || "EMPLOYER";
      
      try {
        // Provision the user in the backend using the Supabase session from step 1
        await provisionSession(storedRole);
        
        // Get the user's next_step from backend
        const meRes = await apiClient.get("/api/v1/auth/me", { withCredentials: true });
        const authenticatedRole = meRes.data?.user?.role as "WORKER" | "EMPLOYER";
        const nextStep = meRes.data?.next_step;
        
        if (!authenticatedRole) {
          throw new Error("Unable to determine account role after provisioning");
        }
        
        clearStoredRole();
        if (active) {
          router.replace(getRouteForNextStep(authenticatedRole, nextStep));
        }
      } catch (provisionError) {
        throw new Error(provisionError instanceof Error ? provisionError.message : "Failed to provision user account");
      }
    };

    handleCallback().catch((callbackError: Error) => {
      if (!active) return;
      clearStoredRole();
      const message = callbackError.message || "Google authentication failed";
      toast.error(message);
      setError(message);
    });

    return () => {
      active = false;
    };
  }, [provisionSession, refreshUser, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#040d1e] px-6 text-white">
      <div className="text-center">
        {error ? (
          <>
            <p className="mb-5 text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => router.replace("/auth/signin")}
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
