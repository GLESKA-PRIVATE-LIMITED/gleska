"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AdminShell from "@/components/admin/AdminShell";

export default function AdminHelpPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/admin/login");
    if (!isLoading && user && user.role !== "ADMIN") router.replace("/");
  }, [isLoading, router, user]);

  if (isLoading || !user || user.role !== "ADMIN") {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;
  }

  return (
    <AdminShell name={user.name} email={user.email} onLogout={() => void logout()}>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex items-center gap-3">
            <HelpCircle className="text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900">Admin Help</h1>
          </div>
          <p className="mt-4 text-sm text-slate-600">Contact the platform owner for help with administrative operations.</p>
        </div>
      </main>
    </AdminShell>
  );
}
