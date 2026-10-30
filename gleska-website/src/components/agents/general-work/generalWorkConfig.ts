import { FolderKanban, Home, Library, LayoutDashboard, Puzzle, SquarePen } from "lucide-react";
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
};

/** Sidebar order is fixed: Home, Dashboard, New Chat, Library, Plugins, Projects. */
export function buildGeneralWorkConfig(options: { dashboardHref: string; onNewChat: () => void }): AgentConfig {
  const sidebarItems: SidebarNavItem[] = [
    { id: "home", label: "Home", icon: Home, href: generalWorkRoutes.home },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: options.dashboardHref },
    { id: "new-chat", label: "New Chat", icon: SquarePen, onClick: options.onNewChat },
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
  if (pathname.startsWith(generalWorkRoutes.library)) return "library";
  if (pathname.startsWith(generalWorkRoutes.plugins)) return "plugins";
  if (pathname.startsWith(generalWorkRoutes.projects)) return "projects";
  return "dashboard";
}
