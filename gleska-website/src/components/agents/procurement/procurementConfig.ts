import {
  Home,
  ClipboardList,
  PlusCircle,
} from "lucide-react";
import { AgentConfig } from "@/components/agent-dashboard/types";

export const procurementConfig: AgentConfig = {
  agentId: "procurement",
  agentName: "PROCUREMENT AGENT",
  badgeText: "MATERIAL REQUESTS",
  title: "MANAGE PROCUREMENT",
  variant: "compact-centered",
  accentColor: "purple",
  sidebarItems: [
    { id: "home", label: "Home", icon: Home, href: "/#services" },
    { id: "new-request", label: "New Request", icon: PlusCircle, isTab: true },
    { id: "saved-requests", label: "Saved Requests", icon: ClipboardList, isTab: true },
  ],
  actionOptions: [],
  searchTitle: "",
  searchSubtitle: "",
  searchPlaceholder: "",
};
