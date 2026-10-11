import { Building2, ClipboardList, Clock3, Package, Truck } from "lucide-react";
import type { AgentConfig } from "@/components/agent-dashboard/types";

export const supplierWorkspaceConfig: AgentConfig = {
  agentId: "supplier-procurement",
  agentName: "SUPPLIER WORKSPACE",
  sidebarSubtitle: "Supplier operations",
  sidebarItems: [
    { id: "rfqs", label: "RFQs & Quotations", icon: ClipboardList, isTab: true },
    { id: "orders", label: "Purchase Orders", icon: Truck, isTab: true },
    { id: "history", label: "Order History", icon: Clock3, isTab: true },
    { id: "company", label: "Company & Verification", icon: Building2, isTab: true },
    { id: "offerings", label: "Material Offerings", icon: Package, isTab: true },
  ],
  actionOptions: [],
  searchTitle: "",
  searchSubtitle: "",
  searchPlaceholder: "",
};
