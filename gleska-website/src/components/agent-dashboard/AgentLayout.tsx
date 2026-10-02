"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { AgentConfig } from "./types";
import AgentSidebar from "./AgentSidebar";
import AgentHeader from "./AgentHeader";
import AgentSearchBar from "./AgentSearchBar";

interface AgentLayoutProps {
  config: AgentConfig;
}

export default function AgentLayout({ config }: AgentLayoutProps) {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

  return (
    <div className="min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex">
      {/* Mobile Header Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
        <Link href="/" className="flex items-center gap-2">
          <img src="/favicon.ico" alt="GO LESKA" className="h-7 w-7 rounded-md" />
          <span className="font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900 dark:text-white">
            {config.agentName}
          </span>
        </Link>
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Toggle Navigation Menu"
        >
          {mobileSidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
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
        className={`flex-1 transition-all duration-300 min-h-screen pt-20 md:pt-8 p-6 sm:p-10 lg:p-12 ${
          isCollapsed ? "md:ml-20" : "md:ml-64"
        }`}
      >
        <div className="mx-auto max-w-5xl space-y-10">
          {/* Main Header & Action Options */}
          <AgentHeader config={config} />

          {/* Lower-Middle Search Bar */}
          <AgentSearchBar
            title={config.searchTitle}
            subtitle={config.searchSubtitle}
            placeholder={config.searchPlaceholder}
            variant={config.variant}
          />
        </div>
      </main>
    </div>
  );
}
