"use client";

import React, { useState } from "react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import AgentHeader from "@/components/agent-dashboard/AgentHeader";
import AgentSearchBar from "@/components/agent-dashboard/AgentSearchBar";
import { tenderFilingConfig } from "./tenderFilingConfig";

export default function TenderFilingAgentPage() {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleExtensionClick = () => {
    setToastMessage("Use as Extension UI Placeholder (No extension package or authentication created)");
    setTimeout(() => setToastMessage(null), 3500);
  };

  const configWithHandler = {
    ...tenderFilingConfig,
    headerAction: tenderFilingConfig.headerAction
      ? {
          ...tenderFilingConfig.headerAction,
          onClick: handleExtensionClick,
        }
      : undefined,
  };

  return (
    <AgentLayout
      config={configWithHandler}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
    >
      {/* Visual Feedback Toast for UI-only Extension Button */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 transition-all animate-pulse">
          {toastMessage}
        </div>
      )}

      <div className="space-y-10">
        {/* Main Header with Title, Category Pill, and Top-Right USE AS EXTENSION Button */}
        <AgentHeader config={configWithHandler} />

        {/* Tab Content / Placeholder for Non-Dashboard Sidebar Options */}
        {activeTab !== "dashboard" && (
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white capitalize">
              {activeTab} Section
            </h3>
            <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              UI Placeholder for Tender Filing ({activeTab}).
            </p>
          </div>
        )}

        {/* LOWER-MIDDLE SEARCH BAR WITH INTENTIONAL VERTICAL SPACING */}
        <div className="pt-24 sm:pt-36">
          <AgentSearchBar
            title={tenderFilingConfig.searchTitle}
            subtitle={tenderFilingConfig.searchSubtitle}
            placeholder={tenderFilingConfig.searchPlaceholder}
          />
        </div>
      </div>
    </AgentLayout>
  );
}
