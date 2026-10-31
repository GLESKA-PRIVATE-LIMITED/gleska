import { FileText, Home, LayoutDashboard, SquarePen } from "lucide-react";
import { AgentConfig } from "@/components/agent-dashboard/types";

export const SUGGESTED_QUESTIONS = [
  "Give me today's company overview.",
  "What are our pending payments?",
  "Analyse our monthly expenses.",
  "Show me our tender pipeline.",
  "Which departments need attention?",
  "Summarise our operational performance.",
];

export function buildCompanyBrainConfig(options: { onNewChat: () => void; onDocuments: () => void }): AgentConfig {
  return {
    agentId: "company-brain",
    agentName: "Company's Brain",
    sidebarSubtitle: "Executive intelligence",
    sidebarItems: [
      { id: "home", label: "Home", icon: Home, href: "/#services" },
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/employer/dashboard" },
      { id: "new-chat", label: "New Chat", icon: SquarePen, onClick: options.onNewChat },
      { id: "documents", label: "Documents", icon: FileText, onClick: options.onDocuments },
    ],
    actionOptions: [],
    searchTitle: "",
    searchSubtitle: "",
    searchPlaceholder: "",
    accentColor: "purple",
  };
}
