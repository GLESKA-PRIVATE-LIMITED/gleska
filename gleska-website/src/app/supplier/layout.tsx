import React from "react";
import SupplierLayoutShell from "@/components/supplier/SupplierLayoutShell";

export const metadata = {
  title: "Procurement | GLESKA AI",
  description:
    "Provide procurement by managing company offerings, RFQs, quotations, orders, and fulfillment.",
};

export default function SupplierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SupplierLayoutShell>{children}</SupplierLayoutShell>;
}
