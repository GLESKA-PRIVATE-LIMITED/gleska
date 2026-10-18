import {
  LayoutDashboard,
  ClipboardList,
  Truck,
  Clock3,
  Package,
  Settings,
  Briefcase,
  ShoppingCart,
  Building2,
} from "lucide-react";
import type { AgentConfig } from "@/components/agent-dashboard/types";

export const supplierWorkspaceConfig: AgentConfig = {
  agentId: "supplier-procurement",
  agentName: "PROCUREMENT",
  sidebarSubtitle: "Provide Procurement",
  sidebarItems: [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard, href: "/supplier" },
    { id: "get-procurement", label: "Get Procurement", icon: ShoppingCart, href: "/procurement" },
    { id: "provide-procurement", label: "Provide Procurement", icon: Package, href: "/supplier" },
    { id: "rfqs", label: "RFQs & Quotations", icon: ClipboardList, href: "/supplier/rfqs" },
    { id: "orders", label: "Orders & Fulfilment", icon: Truck, href: "/supplier/orders" },
    { id: "history", label: "Order History", icon: Clock3, href: "/supplier/history" },
    { id: "offerings", label: "Material Offerings", icon: Package, href: "/supplier/offerings" },
    { id: "company", label: "Companies & Verification", icon: Building2, href: "/supplier/company" },
    { id: "settings", label: "Settings", icon: Settings, href: "/supplier/settings" },
    { id: "employer-dashboard", label: "Employer Dashboard", icon: Briefcase, href: "/employer/dashboard" },
  ],
  actionOptions: [],
  searchTitle: "",
  searchSubtitle: "",
  searchPlaceholder: "",
};
