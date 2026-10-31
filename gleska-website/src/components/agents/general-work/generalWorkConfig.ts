import { FolderKanban, History, Home, Library, LayoutDashboard, Puzzle, SquarePen } from "lucide-react";
import { AgentConfig, SidebarNavItem } from "@/components/agent-dashboard/types";

export const GENERAL_WORK_BASE_PATH = "/general-work";

export const generalWorkRoutes = {
  home: "/#services",
  newChat: GENERAL_WORK_BASE_PATH,
  conversation: (conversationId: string) => `${GENERAL_WORK_BASE_PATH}/c/${conversationId}`,
  newChatInProject: (projectId: string) => `${GENERAL_WORK_BASE_PATH}?project=${encodeURIComponent(projectId)}`,
  library: `${GENERAL_WORK_BASE_PATH}/library`,
  plugins: `${GENERAL_WORK_BASE_PATH}/plugins`,
  projects: `${GENERAL_WORK_BASE_PATH}/projects`,
  project: (projectId: string) => `${GENERAL_WORK_BASE_PATH}/projects/${projectId}`,
  history: `${GENERAL_WORK_BASE_PATH}/history`,
};

/** Sidebar order: Home, Dashboard, New Chat, History, Library, Plugins, Projects. */
export function buildGeneralWorkConfig(options: { dashboardHref: string; onNewChat: () => void }): AgentConfig {
  const sidebarItems: SidebarNavItem[] = [
    { id: "home", label: "Home", icon: Home, href: generalWorkRoutes.home },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: options.dashboardHref },
    { id: "new-chat", label: "New Chat", icon: SquarePen, onClick: options.onNewChat },
    { id: "history", label: "History", icon: History, href: generalWorkRoutes.history },
    { id: "library", label: "Library", icon: Library, href: generalWorkRoutes.library },
    { id: "plugins", label: "Plugins", icon: Puzzle, href: generalWorkRoutes.plugins },
    { id: "projects", label: "Projects", icon: FolderKanban, href: generalWorkRoutes.projects },
  ];

  return {
    agentId: "general-work",
    agentName: "General Work",
    sidebarSubtitle: "Gleska AI Workspace",
    sidebarItems,
    actionOptions: [],
    searchTitle: "",
    searchSubtitle: "",
    searchPlaceholder: "",
  };
}

export function activeTabForPath(pathname: string): string {
  if (pathname.startsWith(generalWorkRoutes.history)) return "history";
  if (pathname.startsWith(generalWorkRoutes.library)) return "library";
  if (pathname.startsWith(generalWorkRoutes.plugins)) return "plugins";
  if (pathname.startsWith(generalWorkRoutes.projects)) return "projects";
  return "dashboard";
}
