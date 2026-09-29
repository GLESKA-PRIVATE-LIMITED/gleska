import {
  Building2,
  Clock3,
  CreditCard,
  FileText,
  HelpCircle,
  LayoutDashboard,
  ShieldCheck,
  UserRound,
} from "lucide-react";

export const workerNavigation = [
  { href: "/worker/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "pages", screen: "dashboard" },
  { href: "/worker/attendance", label: "Attendance", icon: Clock3, section: "pages", screen: "attendance" },
  { href: "/worker/companies-worked", label: "Companies Worked", icon: Building2, section: "pages", screen: "companies-worked" },
  { href: "/worker/documents", label: "Documents", icon: FileText, section: "pages", screen: "documents" },
  { href: "/worker/subscription", label: "Subscription", icon: CreditCard, section: "pages", screen: "subscription" },
  { href: "/worker/settings-security", label: "Settings & Security", icon: ShieldCheck, section: "pages", screen: "settings-security" },
  { href: "/worker/help", label: "Help", icon: HelpCircle, section: "pages", screen: "help" },
  { href: "/worker/profile", label: "Profile", icon: UserRound, section: "pages", screen: "profile" },
] as const;
