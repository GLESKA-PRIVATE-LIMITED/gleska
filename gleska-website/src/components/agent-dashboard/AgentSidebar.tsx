"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight, ChevronLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AgentConfig } from "./types";
import AgentProfile from "./AgentProfile";

interface AgentSidebarProps {
  config: AgentConfig;
  activeTab: string;
  setActiveTab: (tabId: string) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
}

export default function AgentSidebar({
  config,
  activeTab,
  setActiveTab,
  isCollapsed,
  setIsCollapsed,
  mobileSidebarOpen,
  setMobileSidebarOpen,
}: AgentSidebarProps) {
  return (
    <>
      {/* Backdrop for Mobile */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs md:hidden"
        />
      )}

      {/* SIDEBAR CONTAINER */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col justify-between border-r border-slate-200/80 bg-white/95 p-4 sm:p-6 shadow-xl backdrop-blur-xl transition-all duration-300 dark:border-slate-800/80 dark:bg-slate-900/95 ${
          isCollapsed ? "w-20" : "w-64"
        } ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="space-y-6">
          {/* Logo & Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-5 dark:border-slate-800">
            <Link href="/" className="flex items-center gap-3 group min-w-0">
              <img
                src="/favicon.ico"
                alt="GO LESKA"
                className="h-8 w-8 shrink-0 rounded-lg object-contain"
              />
              {!isCollapsed && (
                <div className="min-w-0">
                  <span className="block truncate font-[var(--font-anton)] text-lg uppercase tracking-wider text-slate-900 dark:text-white">
                    {config.agentName}
                  </span>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                    Autonomous AI
                  </span>
                </div>
              )}
            </Link>

            {/* Desktop Collapse Toggle */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden md:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
              title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
              aria-label={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="space-y-1.5 overflow-y-auto max-h-[calc(100vh-220px)] scrollbar-none">
            {config.sidebarItems.map((item) => {
              const Icon = item.icon;
              const isSelected = activeTab === item.id;

              if (item.href) {
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setMobileSidebarOpen(false)}
                    title={isCollapsed ? item.label : undefined}
                    className={`flex items-center gap-3 rounded-xl py-3 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white ${
                      isCollapsed ? "justify-center px-0" : "px-4"
                    }`}
                  >
                    <Icon size={18} className="shrink-0 text-slate-500 dark:text-slate-400" />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              }

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileSidebarOpen(false);
                  }}
                  title={isCollapsed ? item.label : undefined}
                  className={`flex w-full items-center rounded-xl py-3 text-sm font-semibold transition-all ${
                    isCollapsed ? "justify-center px-0" : "justify-between px-4"
                  } ${
                    isSelected
                      ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400 font-bold"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      size={18}
                      className={`shrink-0 ${
                        isSelected
                          ? "text-indigo-600 dark:text-indigo-400"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                    />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!isCollapsed && isSelected && (
                    <ChevronRight size={16} className="shrink-0 text-indigo-600 dark:text-indigo-400" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Profile Component at Bottom */}
        <AgentProfile isCollapsed={isCollapsed} />
      </aside>
    </>
  );
}
