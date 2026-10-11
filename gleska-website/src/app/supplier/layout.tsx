import React from "react";
import { SupplierProvider } from "@/context/SupplierContext";
import SupplierLayoutShell from "@/components/supplier/SupplierLayoutShell";

export const metadata = {
  title: "Supplier Workspace | GLESKA AI",
  description:
    "Manage RFQs, quotations, purchase orders, fulfillment, and material offerings.",
};

export default function SupplierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SupplierProvider>
      <SupplierLayoutShell>{children}</SupplierLayoutShell>
    </SupplierProvider>
  );
}
