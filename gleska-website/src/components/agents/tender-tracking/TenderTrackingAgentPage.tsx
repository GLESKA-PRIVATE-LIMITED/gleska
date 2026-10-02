"use client";

import React, { useState } from "react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import AgentHeader from "@/components/agent-dashboard/AgentHeader";
import AgentSearchBar from "@/components/agent-dashboard/AgentSearchBar";
import { tenderTrackingConfig } from "./tenderTrackingConfig";
import { FolderKanban, Plus, ArrowLeft, CheckCircle2, Clock, FileText } from "lucide-react";

export default function TenderTrackingAgentPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === "dashboard") {
      // Returning to the Tender Tracking Agent's project-selection view
      setSelectedProjectId(null);
    }
  };

  const handleAddProjectClick = () => {
    setToastMessage("Create Project UI Placeholder (Backend & Forms not implemented)");
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Configuration for selected project dashboard
  const currentProjectName = selectedProjectId
    ? selectedProjectId === "project-1"
      ? "PROJECT 1"
      : selectedProjectId === "project-2"
      ? "PROJECT 2"
      : "PROJECT 3"
    : null;

  const activeConfig = currentProjectName
    ? {
        ...tenderTrackingConfig,
        title: currentProjectName,
      }
    : tenderTrackingConfig;

  return (
    <AgentLayout
      config={activeConfig}
      activeTab={activeTab}
      setActiveTab={handleTabChange}
    >
      {/* Visual Feedback Toast for UI-only actions */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs font-semibold text-cyan-800 shadow-lg dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-200 transition-all animate-pulse">
          {toastMessage}
        </div>
      )}

      {!selectedProjectId ? (
        /* ========================================================= */
        /* TENDER TRACKING LANDING: PROJECT SELECTION                */
        /* ========================================================= */
        <div className="space-y-10">
          {/* Main Agent Header */}
          <AgentHeader config={tenderTrackingConfig} />

          {/* Project Options Container */}
          <div className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              Select Active Tender Project
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Option 1: Project 1 */}
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectId("project-1");
                  setActiveTab("dashboard");
                }}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white/95 p-6 text-left shadow-lg shadow-slate-900/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:shadow-xl dark:border-slate-800/90 dark:bg-slate-900/95 dark:hover:border-cyan-500 border-t-4 border-t-cyan-500 cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 items-center justify-center rounded-lg bg-cyan-50 px-3 text-xs font-bold text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
                      PROJECT 01
                    </span>
                    <FolderKanban className="h-5 w-5 text-cyan-500 group-hover:scale-110 transition-transform" />
                  </div>
                  <h3 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
                    Project 1
                  </h3>
                  <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Infrastructure & Commercial Bidding Dashboard
                  </p>
                </div>
                <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-cyan-600 dark:border-slate-800 dark:text-cyan-400">
                  <span>Open Project Dashboard</span>
                  <span>→</span>
                </div>
              </button>

              {/* Option 2: Project 2 */}
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectId("project-2");
                  setActiveTab("dashboard");
                }}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white/95 p-6 text-left shadow-lg shadow-slate-900/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-indigo-400 hover:shadow-xl dark:border-slate-800/90 dark:bg-slate-900/95 dark:hover:border-indigo-500 border-t-4 border-t-indigo-500 cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 items-center justify-center rounded-lg bg-indigo-50 px-3 text-xs font-bold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      PROJECT 02
                    </span>
                    <FolderKanban className="h-5 w-5 text-indigo-500 group-hover:scale-110 transition-transform" />
                  </div>
                  <h3 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
                    Project 2
                  </h3>
                  <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Highway & Civil Works Tender Dashboard
                  </p>
                </div>
                <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-indigo-600 dark:border-slate-800 dark:text-indigo-400">
                  <span>Open Project Dashboard</span>
                  <span>→</span>
                </div>
              </button>

              {/* Option 3: Project 3 */}
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectId("project-3");
                  setActiveTab("dashboard");
                }}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white/95 p-6 text-left shadow-lg shadow-slate-900/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-purple-400 hover:shadow-xl dark:border-slate-800/90 dark:bg-slate-900/95 dark:hover:border-purple-500 border-t-4 border-t-purple-500 cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 items-center justify-center rounded-lg bg-purple-50 px-3 text-xs font-bold text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
                      PROJECT 03
                    </span>
                    <FolderKanban className="h-5 w-5 text-purple-500 group-hover:scale-110 transition-transform" />
                  </div>
                  <h3 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
                    Project 3
                  </h3>
                  <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Industrial Plant Tender Bidding Dashboard
                  </p>
                </div>
                <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-purple-600 dark:border-slate-800 dark:text-purple-400">
                  <span>Open Project Dashboard</span>
                  <span>→</span>
                </div>
              </button>

              {/* Option 4: Add Project / Create Project */}
              <button
                type="button"
                onClick={handleAddProjectClick}
                className="group relative flex flex-col justify-between rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-left shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500 hover:bg-emerald-50/30 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-emerald-400 dark:hover:bg-emerald-950/20 cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 items-center justify-center rounded-lg bg-emerald-50 px-3 text-xs font-bold text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                      ADD PROJECT
                    </span>
                    <Plus className="h-5 w-5 text-emerald-500 group-hover:rotate-90 transition-transform" />
                  </div>
                  <h3 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
                    Create Project
                  </h3>
                  <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Register a new tender tracking project workflow (UI Only)
                  </p>
                </div>
                <div className="mt-6 flex items-center justify-between border-t border-slate-200/60 pt-4 text-xs font-semibold text-emerald-600 dark:border-slate-800 dark:text-emerald-400">
                  <span>Create Project UI</span>
                  <span>+</span>
                </div>
              </button>
            </div>
          </div>

          {/* LOWER-MIDDLE SEARCH BAR WITH INTENTIONAL VERTICAL SPACING */}
          <div className="pt-20 sm:pt-28">
            <AgentSearchBar
              title={tenderTrackingConfig.searchTitle}
              subtitle={tenderTrackingConfig.searchSubtitle}
              placeholder={tenderTrackingConfig.searchPlaceholder}
            />
          </div>
        </div>
      ) : (
        /* ========================================================= */
        /* PROJECT DASHBOARD VIEW (Project 1 / Project 2 / Project 3)*/
        /* ========================================================= */
        <div className="space-y-10">
          {/* Top Bar: Navigation Breadcrumb */}
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-4 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setSelectedProjectId(null)}
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-cyan-600 dark:text-slate-400 dark:hover:text-cyan-400 transition cursor-pointer"
            >
              <ArrowLeft size={16} />
              <span>Back to Tender Project Selection</span>
            </button>
            <span className="rounded-full bg-cyan-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
              Selected: {currentProjectName}
            </span>
          </div>

          {/* Data-Driven Project Dashboard Header */}
          <AgentHeader config={activeConfig} />

          {/* Dashboard Tab Content */}
          {activeTab === "dashboard" ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
                  <div className="flex items-center gap-3 text-cyan-600 dark:text-cyan-400">
                    <CheckCircle2 size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Active Tenders</span>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">12 Tenders</p>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Under evaluation for {currentProjectName}</p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
                  <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
                    <Clock size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Deadline Alert</span>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">3 Days Left</p>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Next portal bid submission</p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
                  <div className="flex items-center gap-3 text-purple-600 dark:text-purple-400">
                    <FileText size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Bidding Value</span>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">₹ 4.2 Cr</p>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Estimated tender contract value</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white capitalize">
                {activeTab.replace("-", " ")} Section
              </h3>
              <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                UI Placeholder for {currentProjectName} ({activeTab.replace("-", " ")}).
              </p>
            </div>
          )}

          {/* LOWER-MIDDLE SEARCH BAR WITH INTENTIONAL VERTICAL SPACING */}
          <div className="pt-20 sm:pt-28">
            <AgentSearchBar
              title={tenderTrackingConfig.searchTitle}
              subtitle={tenderTrackingConfig.searchSubtitle}
              placeholder={tenderTrackingConfig.searchPlaceholder}
            />
          </div>
        </div>
      )}
    </AgentLayout>
  );
}
