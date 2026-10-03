import { LucideIcon } from "lucide-react";

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  isTab?: boolean;
}

export interface ActionOption {
  id: string;
  optionNumber: string;
  title: string;
  description: string;
  icon: LucideIcon;
  badgeColor: string;
  iconBg: string;
  topBorderColor: string;
}

export interface HeaderAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
}

export interface AgentConfig {
  agentId: string;
  agentName: string;
  badgeText: string;
  title: string;
  sidebarItems: SidebarNavItem[];
  actionOptions: ActionOption[];
  searchTitle: string;
  searchSubtitle: string;
  searchPlaceholder: string;
  variant?: "default" | "compact-centered";
  accentColor?: "emerald" | "purple" | "indigo" | "blue" | "cyan" | "amber";
  headerAction?: HeaderAction;
}
