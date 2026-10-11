import {
  LayoutDashboard,
  ClipboardList,
  Truck,
  Clock3,
  Package,
  ArrowLeftRight,
  Briefcase,
} from "lucide-react";
import type { AgentConfig } from "@/components/agent-dashboard/types";

export const supplierWorkspaceConfig: AgentConfig = {
  agentId: "supplier-procurement",
  agentName: "SUPPLIER WORKSPACE",
  sidebarSubtitle: "Supplier operations",
  sidebarItems: [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/supplier" },
    { id: "rfqs", label: "RFQs & Quotations", icon: ClipboardList, href: "/supplier/rfqs" },
    { id: "orders", label: "Purchase Orders", icon: Truck, href: "/supplier/orders" },
    { id: "history", label: "Order History", icon: Clock3, href: "/supplier/history" },
    { id: "offerings", label: "Material Offerings", icon: Package, href: "/supplier/offerings" },
    { id: "switch-workspace", label: "Switch Workspace", icon: ArrowLeftRight, isTab: true },
    { id: "employer-dashboard", label: "Employer Dashboard", icon: Briefcase, href: "/employer/dashboard" },
  ],
  actionOptions: [],
  searchTitle: "",
  searchSubtitle: "",
  searchPlaceholder: "",
};
