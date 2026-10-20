"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AdminShell from "@/components/admin/AdminShell";
import DeleteAccountSection from "@/components/DeleteAccountSection";

export default function AdminProfilePage() {
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
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <User className="text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Profile</h1>
          </div>
          <dl className="mt-6 space-y-4 text-sm">
            <div><dt className="font-semibold text-slate-500 dark:text-slate-400">Name</dt><dd className="mt-1 text-slate-900 dark:text-white">{user.name}</dd></div>
            <div><dt className="font-semibold text-slate-500 dark:text-slate-400">Email</dt><dd className="mt-1 text-slate-900 dark:text-white">{user.email || "Not provided"}</dd></div>
            <div><dt className="font-semibold text-slate-500 dark:text-slate-400">Role</dt><dd className="mt-1 text-slate-900 dark:text-white">Administrator</dd></div>
          </dl>
        </div>

        <DeleteAccountSection roleLabel="Administrator" />
      </main>
    </AdminShell>
  );
}
