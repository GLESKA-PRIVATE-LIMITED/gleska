import {
  Home,
  LayoutDashboard,
  Wrench,
  Calendar,
  Activity,
  Settings,
} from "lucide-react";
import { AgentConfig } from "@/components/agent-dashboard/types";

export const maintenanceConfig: AgentConfig = {
  agentId: "industrial-maintenance",
  agentName: "INDUSTRIAL MAINTENANCE AGENT",
  badgeText: "PREDICTIVE MAINTENANCE AI",
  title: "Manage Maintenance",
  sidebarItems: [
    { id: "home", label: "Home", icon: Home, href: "/#services" },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, isTab: true },
    { id: "schedules", label: "Predictive Schedules", icon: Calendar, isTab: true },
    { id: "technicians", label: "Service Technicians", icon: Wrench, isTab: true },
    { id: "uptime", label: "Equipment Uptime", icon: Activity, isTab: true },
    { id: "settings", label: "Settings", icon: Settings, isTab: true },
  ],
  actionOptions: [
    {
      id: "schedule",
      optionNumber: "OPTION 01",
      title: "Schedule Service",
      description: "Dispatch certified maintenance technicians and track machine uptime.",
      icon: Wrench,
      badgeColor: "text-rose-600 dark:text-rose-400",
      iconBg: "bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800",
      topBorderColor: "border-t-rose-500",
    },
  ],
  searchTitle: "Quick Equipment Search",
  searchSubtitle: "Search machines, service technician schedules, and maintenance logs.",
  searchPlaceholder: "Search machine serial number, technician ID, or maintenance task...",
};
