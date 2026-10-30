"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import ConnectorsList from "@/components/connectors/ConnectorsList";
import { CONNECTORS_OAUTH_RETURN_PATH, useConnectors } from "@/components/connectors/useConnectors";

export default function ConnectorsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const connectorsState = useConnectors(Boolean(user));
  const { fetchConnectors } = connectorsState;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  // Handle redirect-back from OAuth callback.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const err = params.get("error");
    const provider = params.get("provider");
    if (connected) {
      toast.success(`${connected} connected successfully.`);
      window.history.replaceState({}, "", CONNECTORS_OAUTH_RETURN_PATH);
      if (user) fetchConnectors();
    } else if (err) {
      toast.error(`Failed to connect ${provider || "provider"}: ${err}`);
      window.history.replaceState({}, "", CONNECTORS_OAUTH_RETURN_PATH);
    }
  }, [user, fetchConnectors]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/employer/dashboard")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">AI Assistant Connectors</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Connect external services to extend what the AI Assistant can do during conversations.
            </p>
          </div>
        </div>

        <ConnectorsList state={connectorsState} />
      </div>
    </div>
  );
}
