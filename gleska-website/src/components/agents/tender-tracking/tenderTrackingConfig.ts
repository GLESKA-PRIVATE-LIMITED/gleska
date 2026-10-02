import {
  Home,
  LayoutDashboard,
  Bell,
  Clock,
  Search,
  Settings,
} from "lucide-react";
import { AgentConfig } from "@/components/agent-dashboard/types";

export const tenderTrackingConfig: AgentConfig = {
  agentId: "tender-tracking",
  agentName: "TENDER TRACKING AGENT",
  badgeText: "REAL-TIME TENDER AI",
  title: "Track Tenders",
  sidebarItems: [
    { id: "home", label: "Home", icon: Home, href: "/#services" },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, isTab: true },
    { id: "alerts", label: "Deadline Alerts", icon: Bell, isTab: true },
    { id: "tracking", label: "Live Tracking", icon: Clock, isTab: true },
    { id: "settings", label: "Settings", icon: Settings, isTab: true },
  ],
  actionOptions: [
    {
      id: "track",
      optionNumber: "OPTION 01",
      title: "Track Bids",
      description: "Monitor government portal status, competitor bids, and submission deadlines.",
      icon: Search,
      badgeColor: "text-cyan-600 dark:text-cyan-400",
      iconBg: "bg-cyan-50 text-cyan-600 border-cyan-100 dark:bg-cyan-950/60 dark:text-cyan-400 dark:border-cyan-800",
      topBorderColor: "border-t-cyan-500",
    },
  ],
  searchTitle: "Quick Tender Search",
  searchSubtitle: "Search government portals, tender IDs, and bidding deadlines.",
  searchPlaceholder: "Search tender reference numbers, portal IDs, or keywords...",
};
