import {
  Home,
  LayoutDashboard,
  FileText,
  ShieldCheck,
  Settings,
  Puzzle,
} from "lucide-react";
import { AgentConfig } from "@/components/agent-dashboard/types";

export const tenderFilingConfig: AgentConfig = {
  agentId: "tender-filing",
  agentName: "Tender Filing Agent",
  badgeText: "TENDER & BIDDING AI",
  title: "MANAGE TENDER FILING",
  variant: "compact-centered",
  accentColor: "amber",
  sidebarItems: [
    { id: "home", label: "Home", icon: Home, href: "/#services" },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, isTab: true },
    { id: "documents", label: "Documents", icon: FileText, isTab: true },
    { id: "policies", label: "Policies", icon: ShieldCheck, isTab: true },
    { id: "settings", label: "Settings", icon: Settings, isTab: true },
  ],
  actionOptions: [],
  headerAction: {
    id: "use-as-extension",
    label: "USE AS EXTENSION",
    icon: Puzzle,
  },
  searchTitle: "Quick Tender Filing Search",
  searchSubtitle: "Search tenders, documents, bids, or filing records.",
  searchPlaceholder: "Search tenders, documents, bids, or filing records...",
};
