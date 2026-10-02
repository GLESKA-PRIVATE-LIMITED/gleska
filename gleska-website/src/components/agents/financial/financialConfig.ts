import {
  Home,
  LayoutDashboard,
  FileCheck,
  FileText,
  Scan,
  Settings,
} from "lucide-react";
import { AgentConfig } from "@/components/agent-dashboard/types";

export const financialConfig: AgentConfig = {
  agentId: "financial",
  agentName: "Financial Agent",
  badgeText: "FINANCIAL AI",
  title: "MANAGE FINANCIAL",
  variant: "compact-centered",
  accentColor: "indigo",
  sidebarItems: [
    { id: "home", label: "Home", icon: Home, href: "/#services" },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, isTab: true },
    { id: "audits", label: "Audits till date", icon: FileCheck, isTab: true },
    { id: "create-invoice", label: "Create Invoice", icon: FileText, isTab: true },
    { id: "scan-invoice", label: "Scan Invoice", icon: Scan, isTab: true },
    { id: "settings", label: "Settings", icon: Settings, isTab: true },
  ],
  actionOptions: [
    {
      id: "create",
      optionNumber: "OPTION 01",
      title: "Create Invoice",
      description: "Generate and send automated industrial invoices.",
      icon: FileText,
      badgeColor: "text-indigo-600 dark:text-indigo-400",
      iconBg: "bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-800",
      topBorderColor: "border-t-indigo-500",
    },
    {
      id: "scan",
      optionNumber: "OPTION 02",
      title: "Scan Invoice",
      description: "Scan and process incoming vendor bills and receipts.",
      icon: Scan,
      badgeColor: "text-purple-600 dark:text-purple-400",
      iconBg: "bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-950/60 dark:text-purple-400 dark:border-purple-800",
      topBorderColor: "border-t-purple-500",
    },
  ],
  searchTitle: "Quick Financial Search",
  searchSubtitle: "Search invoices, transactions, audits, vendors, or financial records.",
  searchPlaceholder: "Search invoices, transactions, audits, vendors, or financial records...",
};
