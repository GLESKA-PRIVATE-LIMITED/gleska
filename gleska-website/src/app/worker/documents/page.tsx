"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { DocumentsSection } from "@/components/DocumentsSection";
import AccountManagementShell from "@/components/AccountManagementShell";
import { WorkerPageFrame, WorkerPageHeader } from "@/components/worker/WorkspaceUI";

export default function WorkerDocumentsPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) {
      router.push("/worker/auth");
    }
  }, [isLoading, user, router]);

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
      toast.success("Logged out successfully");
    } catch {
      toast.error("Logout failed");
    }
  };

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <Loader2 size={40} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <AccountManagementShell kind="worker" name={user.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void handleLogout()}>
      <WorkerPageFrame>
        <WorkerPageHeader title="Documents" description="Manage your verification documents." />
        <div className="mt-8"><DocumentsSection /></div>
      </WorkerPageFrame>
    </AccountManagementShell>
  );
}
