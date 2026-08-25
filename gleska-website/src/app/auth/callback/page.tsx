"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { getRouteForNextStep } from "@/lib/auth-routing";

export default function AuthCallbackPage() {
  const router = useRouter();
  const { resolveGoogleSession } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    const role = sessionStorage.getItem("goleska_oauth_role");
    if (role !== "WORKER" && role !== "EMPLOYER") {
      setError("Your login could not be linked to an application account.");
      return;
    }
    resolveGoogleSession(role)
      .then(({ role: authenticatedRole, nextStep }) => {
        sessionStorage.removeItem("goleska_oauth_role");
        router.replace(getRouteForNextStep(authenticatedRole, nextStep));
      })
      .catch((callbackError: Error) => {
        sessionStorage.removeItem("goleska_oauth_role");
        toast.error(callbackError.message || "Google authentication failed");
        setError("Google authentication was not completed. Please return to login and try again.");
      });
  }, [resolveGoogleSession, router]);

  return <main className="flex min-h-screen items-center justify-center bg-[#040d1e] px-6 text-white"><div className="text-center">{error ? <><p className="mb-5 text-sm text-red-300">{error}</p><button type="button" onClick={() => router.replace("/")} className="rounded-xl bg-blue-600 px-5 py-3 font-bold">Return home</button></> : <Loader2 className="animate-spin" />}</div></main>;
}