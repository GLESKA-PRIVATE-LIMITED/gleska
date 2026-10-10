import {
  Home,
  LayoutDashboard,
  Truck,
  Key,
  ClipboardList,
  HelpCircle,
  Settings,
} from "lucide-react";
import { AgentConfig } from "@/components/agent-dashboard/types";

export const logisticsConfig: AgentConfig = {
  agentId: "logistics",
  agentName: "LOGISTICS",
  badgeText: "",
  title: "",
  variant: "compact-centered",
  accentColor: "emerald",
  sidebarItems: [
    { id: "home", label: "Home", icon: Home, href: "/#services" },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, isTab: true },
    { id: "lend", label: "Lend Your Vehicle", icon: Truck, isTab: true },
    { id: "get", label: "Get Vehicle", icon: Key, isTab: true },
    { id: "vehicle-details", label: "Vehicle Details", icon: ClipboardList, isTab: true },
    { id: "help", label: "Help", icon: HelpCircle, isTab: true },
    { id: "settings", label: "Settings", icon: Settings, isTab: true },
  ],
  actionOptions: [
    {
      id: "lend",
      optionNumber: "OPTION 01",
      title: "Lend Your Vehicle",
      description: "Register and list commercial vehicles for operational dispatch.",
      icon: Truck,
      badgeColor: "text-emerald-600 dark:text-emerald-400",
      iconBg: "bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800",
      topBorderColor: "border-t-emerald-500",
    },
    {
      id: "get",
      optionNumber: "OPTION 02",
      title: "Get Vehicle",
      description: "Request verified transport, trucks, and industrial fleet dispatch.",
      icon: Key,
      badgeColor: "text-indigo-600 dark:text-indigo-400",
      iconBg: "bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-800",
      topBorderColor: "border-t-indigo-500",
    },
  ],
  searchTitle: "Quick Fleet & Route Search",
  searchSubtitle: "Search across available vehicles, routes, drivers, and operational dispatches.",
  searchPlaceholder: "Search vehicles, drivers, route IDs, or active dispatches...",
};
