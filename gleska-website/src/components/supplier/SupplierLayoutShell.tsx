"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  Menu,
  Package,
  X,
} from "lucide-react";
import AgentSidebar from "@/components/agent-dashboard/AgentSidebar";
import { supplierWorkspaceConfig } from "@/components/agents/procurement/supplierWorkspaceConfig";
import { useSupplier } from "@/context/SupplierContext";
import { procurementApi } from "@/lib/procurement-api";

export default function SupplierLayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedMembership,
    error,
  } = useSupplier();

  // Derive active tab from current URL pathname
  let activeTab = "dashboard";
  if (pathname.startsWith("/supplier/rfqs")) {
    activeTab = "rfqs";
  } else if (pathname.startsWith("/supplier/orders")) {
    activeTab = "orders";
  } else if (pathname.startsWith("/supplier/history")) {
    activeTab = "history";
  } else if (
    pathname.startsWith("/supplier/company") ||
    pathname.startsWith("/supplier/profile")
  ) {
    activeTab = "company";
  } else if (pathname.startsWith("/supplier/offerings")) {
    activeTab = "offerings";
  } else if (pathname.startsWith("/supplier/settings")) {
    activeTab = "settings";
  }

  const handleSwitchWorkspace = async () => {
    try {
      const ws = await procurementApi.getWorkspaces();
      const hasBuyer = ws.available_workspaces.some((w) => w.kind === "BUYER");
      if (hasBuyer) {
        await procurementApi.updateWorkspacePreference("BUYER");
        router.push("/procurement");
        return;
      }
    } catch {
      // Fall back safely to selector
    }
    router.push("/procurement/workspaces?switch=1");
  };

  const handleTabChange = (tabId: string) => {
    if (tabId === "switch-workspace") {
      void handleSwitchWorkspace();
      return;
    }
    const item = supplierWorkspaceConfig.sidebarItems.find(
      (entry) => entry.id === tabId,
    );
    if (item?.href) {
      router.push(item.href);
    }
  };

  return (
    <div className="min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex">
      {/* Mobile Header Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Toggle Navigation Menu"
        >
          {mobileSidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <Link href="/" className="flex items-center gap-2">
          <img
            src="/favicon.ico"
            alt="GO LESKA AI"
            className="h-7 w-7 rounded-md"
          />
          <span className="font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900 dark:text-white">
            GO LESKA AI
          </span>
        </Link>
        <span className="w-10" />
      </div>

      {/* Shared Sidebar */}
      <AgentSidebar
        config={supplierWorkspaceConfig}
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        mobileSidebarOpen={mobileSidebarOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
        onProfileClick={() => router.push("/supplier/company")}
        profileHref="/supplier/company"
        profileRoleLabel="Supplier"
      />

      {/* Main Content Area */}
      <main
        className={`flex-1 transition-all duration-300 min-h-screen pt-24 sm:pt-20 md:pt-8 p-3 sm:p-6 lg:p-10 max-w-full overflow-x-hidden ${
          isCollapsed ? "md:ml-20" : "md:ml-64"
        }`}
      >
        <div className="mx-auto max-w-5xl space-y-4 sm:space-y-6">
          {/* Header Bar matching Procurement style */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-3 pt-1 sm:pb-4 sm:pt-0 text-left dark:border-slate-800/80">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-200/90 bg-purple-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-700 shadow-2xs dark:border-purple-800/80 dark:bg-purple-950/70 dark:text-purple-300">
                  <Package size={11} className="text-purple-600 dark:text-purple-400" />
                  Supplier Operations
                </span>
                {selectedMembership && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300 max-w-full truncate">
                    <Building2 size={11} className="text-slate-500 shrink-0" />
                    <span className="truncate max-w-[140px] sm:max-w-[200px]">
                      {selectedMembership.company_name}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="capitalize">{selectedMembership.role.toLowerCase()}</span>
                  </span>
                )}
              </div>
              <h1 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 dark:text-white sm:text-2xl md:text-3xl leading-tight">
                {activeTab === "dashboard" && "Supplier Dashboard"}
                {activeTab === "rfqs" && "RFQs & Quotations"}
                {activeTab === "orders" && "Purchase Orders"}
                {activeTab === "history" && "Order History"}
                {activeTab === "company" && "Company & Verification"}
                {activeTab === "offerings" && "Material Offerings"}
                {activeTab === "settings" && "Supplier Settings"}
              </h1>
            </div>

            <div className="flex items-center gap-3">
              {/* Company Selector for Multi-company users */}
              {companies.length > 1 && (
                <div className="relative">
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => setSelectedCompanyId(e.target.value)}
                    className="h-9 rounded-xl border border-slate-200 bg-white pl-3 pr-8 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
                    aria-label="Select company"
                  >
                    {companies.map((c) => (
                      <option key={c.company_id} value={c.company_id}>
                        {c.company_name} ({c.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Global Workspace Error Banner */}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
            >
              {error}
            </div>
          )}

          {/* Page Child Content */}
          {children}
        </div>
      </main>
    </div>
  );
}
