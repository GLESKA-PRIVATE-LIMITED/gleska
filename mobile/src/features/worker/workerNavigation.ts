import {
  Building2,
  Clock3,
  CreditCard,
  FileText,
  HelpCircle,
  Home,
  LayoutDashboard,
  ShieldCheck,
  Settings,
  UserRound,
} from "lucide-react";

export const workerNavigation = [
  { href: "/worker/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "pages", screen: "dashboard" },
  { href: "/worker/attendance", label: "Attendance", icon: Clock3, section: "pages", screen: "unavailable" },
  { href: "/worker/companies-worked", label: "Companies Worked", icon: Building2, section: "pages", screen: "unavailable" },
  { href: "/worker/documents", label: "Documents", icon: FileText, section: "pages", screen: "unavailable" },
  { href: "/worker/subscription", label: "Subscription", icon: CreditCard, section: "pages", screen: "unavailable" },
  { href: "/worker/security", label: "Security", icon: ShieldCheck, section: "pages", screen: "unavailable" },
  { href: "/worker/settings", label: "Settings", icon: Settings, section: "pages", screen: "unavailable" },
  { href: "/worker/help", label: "Help", icon: HelpCircle, section: "pages", screen: "unavailable" },
  { href: "/worker/profile", label: "Profile", icon: UserRound, section: "account", screen: "profile" },
] as const;

export const workerHomeNavigation = {
  href: "/",
  label: "Back to Home",
  icon: Home,
};
