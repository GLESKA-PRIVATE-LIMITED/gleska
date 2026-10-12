import {
  LayoutDashboard,
  FileText,
  Activity,
  ShoppingCart,
  Boxes,
  ClipboardList,
  Settings,
  ArrowLeftRight,
  Package,
  Briefcase,
} from "lucide-react";
import { AgentConfig } from "@/components/agent-dashboard/types";

export const procurementWorkspacesPath = "/procurement/workspaces?switch=1";

export const procurementConfig: AgentConfig = {
  agentId: "procurement",
  agentName: "PROCUREMENT",
  badgeText: "",
  title: "",
  variant: "compact-centered",
  accentColor: "purple",
  sidebarItems: [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, isTab: true },
    { id: "material-details", label: "Requirement Details", icon: Boxes, isTab: true },
    { id: "details", label: "Procurement Details", icon: FileText, isTab: true },
    { id: "status", label: "Current Status", icon: Activity, isTab: true },
    { id: "get-procurement", label: "Get Procurement", icon: ShoppingCart, isTab: true },
    { id: "rfqs", label: "Requests for Quote", icon: ClipboardList, isTab: true },
    { id: "settings", label: "Settings", icon: Settings, isTab: true },
    { id: "switch-workspace", label: "Switch Workspace", icon: ArrowLeftRight, isTab: false },
    { id: "employer-dashboard", label: "Employer Dashboard", icon: Briefcase, href: "/employer/dashboard" },
  ],
  actionOptions: [
    {
      id: "workspaces",
      optionNumber: "OPTION 01",
      title: "Choose a Procurement Workspace",
      description: "Open the Buyer or Supplier workspace available to your account.",
      icon: Package,
      badgeColor: "text-purple-600 dark:text-purple-400",
      iconBg: "bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-950/60 dark:text-purple-400 dark:border-purple-800",
      topBorderColor: "border-t-purple-500",
    },
    {
      id: "get",
      optionNumber: "OPTION 02",
      title: "Get Procurement",
      description: "Match a saved material requirement against current eligible supplier offerings.",
      icon: ShoppingCart,
      badgeColor: "text-indigo-600 dark:text-indigo-400",
      iconBg: "bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-800",
      topBorderColor: "border-t-indigo-500",
    },
  ],
  searchTitle: "Supplier offering discovery",
  searchSubtitle: "Choose a saved material requirement in Get Procurement to view matching listings.",
  searchPlaceholder: "Open Get Procurement to match a saved requirement",
};
