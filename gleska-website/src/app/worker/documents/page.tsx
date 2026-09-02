"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, FileText, LayoutDashboard, Loader2, LogOut, PanelLeft, ShieldCheck, User, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { DocumentsSection } from "@/components/DocumentsSection";

export default function WorkerDocumentsPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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
    <div className="flex min-h-screen flex-col bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:flex-row">
      <aside
        className={`hidden shrink-0 flex-col justify-between border-r border-slate-200 bg-white/95 p-4 shadow-xs backdrop-blur transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/95 md:flex md:sticky md:top-0 md:h-screen ${
          isSidebarOpen ? "w-64" : "w-20 items-center"
        }`}
      >
        <div className="w-full space-y-6">
          <div className={`flex items-center gap-2 ${isSidebarOpen ? "justify-between px-1" : "justify-center"}`}>
            {isSidebarOpen && (
              <Link href="/" className="font-[var(--font-anton)] text-xl uppercase tracking-wider text-slate-900 dark:text-white">
                GO LESKA AI
              </Link>
            )}
            <button type="button" onClick={() => setIsSidebarOpen(!isSidebarOpen)} title="Toggle sidebar" aria-label="Toggle sidebar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <PanelLeft size={20} />
            </button>
          </div>

          <nav className="w-full space-y-1.5">
            <Link href="/worker/dashboard" className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 ${isSidebarOpen ? "" : "justify-center"}`} title="Dashboard">
              <LayoutDashboard size={20} className="shrink-0" />
              {isSidebarOpen && <span>Dashboard</span>}
            </Link>
            <Link href="/worker/profile" className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 ${isSidebarOpen ? "" : "justify-center"}`} title="Profile">
              <User size={20} className="shrink-0" />
              {isSidebarOpen && <span>Profile</span>}
            </Link>
            <Link href="/worker/documents" className={`flex items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 ${isSidebarOpen ? "" : "justify-center"}`} title="Documents">
              <FileText size={20} className="shrink-0" />
              {isSidebarOpen && <span>Documents</span>}
            </Link>
            <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 dark:text-slate-500 ${isSidebarOpen ? "" : "justify-center"}`} title="Security">
              <ShieldCheck size={20} className="shrink-0" />
              {isSidebarOpen && <span>Security</span>}
            </div>
            <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 dark:text-slate-500 ${isSidebarOpen ? "" : "justify-center"}`} title="Companies Worked">
              <Building2 size={20} className="shrink-0" />
              {isSidebarOpen && <span>Companies Worked</span>}
            </div>
          </nav>
        </div>

        <button type="button" onClick={() => void handleLogout()} className={`flex w-full items-center gap-3 rounded-xl p-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 ${isSidebarOpen ? "" : "justify-center"}`} title="Log out">
          <LogOut size={18} />
          {isSidebarOpen && <span>Log out</span>}
        </button>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex w-full items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-xs backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
          <button type="button" onClick={() => setIsMobileMenuOpen(true)} title="Open sidebar" aria-label="Open sidebar" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <PanelLeft size={20} />
          </button>
          <Link href="/" className="font-[var(--font-anton)] text-lg uppercase tracking-wider text-slate-900 dark:text-white">GO LESKA AI</Link>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-xs font-bold text-white">{(user.name || "W").charAt(0).toUpperCase()}</span>
        </div>

        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <button type="button" aria-label="Close sidebar overlay" className="fixed inset-0 bg-slate-900/50" onClick={() => setIsMobileMenuOpen(false)} />
            <div className="relative flex w-4/5 max-w-xs flex-col bg-white p-4 shadow-2xl dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
                <span className="font-[var(--font-anton)] text-xl uppercase tracking-wider text-slate-900 dark:text-white">GO LESKA AI</span>
                <button type="button" onClick={() => setIsMobileMenuOpen(false)} title="Close sidebar" aria-label="Close sidebar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button>
              </div>
              <nav className="mt-4 flex-1 space-y-1.5">
                <Link href="/worker/dashboard" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"><LayoutDashboard size={20} /><span>Dashboard</span></Link>
                <Link href="/worker/profile" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"><User size={20} /><span>Profile</span></Link>
                <Link href="/worker/documents" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"><FileText size={20} /><span>Documents</span></Link>
                <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 dark:text-slate-500"><ShieldCheck size={20} /><span>Security</span></div>
                <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 dark:text-slate-500"><Building2 size={20} /><span>Companies Worked</span></div>
              </nav>
              <button type="button" onClick={() => void handleLogout()} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400"><LogOut size={20} /><span>Log out</span></button>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mb-6">
            <h1 className="font-[var(--font-anton)] text-3xl uppercase tracking-wide text-slate-900 dark:text-white">Documents</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Manage your verification documents</p>
          </div>
          <DocumentsSection />
        </main>
      </div>
    </div>
  );
}
