"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import { AgentConfig } from "./types";
import { useAuth } from "@/context/AuthContext";
import { getRouteForNextStep } from "@/lib/auth-routing";
import AgentSidebar from "./AgentSidebar";
import AgentHeader from "./AgentHeader";
import AgentSearchBar from "./AgentSearchBar";

interface AgentLayoutProps {
  config: AgentConfig;
  children?: React.ReactNode;
  activeTab?: string;
  setActiveTab?: (tabId: string) => void;
}

export default function AgentLayout({
  config,
  children,
  activeTab: externalActiveTab,
  setActiveTab: externalSetActiveTab,
}: AgentLayoutProps) {
  const router = useRouter();
  const { user, isLoading, nextStep } = useAuth();
  const [internalActiveTab, setInternalActiveTab] = useState<string>("dashboard");
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      const requestedPath = `${window.location.pathname}${window.location.search}`;
      router.replace(`/auth/signin?next=${encodeURIComponent(requestedPath)}`);
      return;
    }
    if (user.role !== "EMPLOYER" || nextStep !== "DASHBOARD") {
      router.replace(getRouteForNextStep(user.role, nextStep));
    }
  }, [isLoading, nextStep, router, user]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileSidebarOpen]);

  const activeTab = externalActiveTab !== undefined ? externalActiveTab : internalActiveTab;
  const setActiveTab = externalSetActiveTab || setInternalActiveTab;

  if (isLoading || !user || user.role !== "EMPLOYER" || nextStep !== "DASHBOARD") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
          {isLoading ? "Checking your account..." : "Redirecting..."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex">
      {/* Mobile Header Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Toggle Navigation Menu"
          aria-expanded={mobileSidebarOpen}
          aria-controls="agent-sidebar"
        >
          {mobileSidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <Link href="/" className="flex items-center gap-2 min-w-0">
          <img src="/favicon.ico" alt="GO LESKA AI" className="h-7 w-7 rounded-md shrink-0" />
          <div className="min-w-0 text-left">
            <span className="block font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900 dark:text-white leading-tight">
              GO LESKA AI
            </span>
            <span className="block text-[9px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 leading-tight">
              {config.agentName}
            </span>
          </div>
        </Link>
        <span className="w-10" />
      </div>

      {/* Sidebar */}
      <AgentSidebar
        config={config}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        mobileSidebarOpen={mobileSidebarOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
      />

      {/* Main Content Area */}
      <main
        className={`min-w-0 max-w-full flex-1 overflow-x-hidden transition-all duration-300 min-h-screen pt-20 md:pt-8 p-3 sm:p-6 lg:p-12 ${
          isCollapsed ? "md:ml-20" : "md:ml-64"
        }`}
      >
        <div className="mx-auto max-w-5xl space-y-4 sm:space-y-6">
          {children ? (
            children
          ) : (
            <>
              {/* Main Header & Action Options */}
              <AgentHeader config={config} />

              {/* Lower-Middle Search Bar */}
              <AgentSearchBar
                title={config.searchTitle}
                subtitle={config.searchSubtitle}
                placeholder={config.searchPlaceholder}
                variant={config.variant}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
