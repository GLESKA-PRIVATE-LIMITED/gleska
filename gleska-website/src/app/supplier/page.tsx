"use client";

import React from "react";
import Link from "next/link";
import { Building2, ClipboardList, Search, Truck } from "lucide-react";
import { useSupplier } from "@/context/SupplierContext";

const historicalOrderStatuses = ["REJECTED", "CANCELLED", "DELIVERED"];

export default function SupplierDashboardPage() {
  const {
    companies,
    selectedMembership,
    company,
    selectedCompanyId,
    companyDataId,
    companyError,
    loading,
    rfqs,
    purchaseOrders,
    loadCompany,
  } = useSupplier();

  const pendingInvitations = rfqs.filter(
    (rfq) => rfq.recipient_status === "INVITED" && rfq.status === "OPEN",
  );
  const activeOrders = purchaseOrders.filter(
    (order) => !historicalOrderStatuses.includes(order.status),
  );

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-purple-600 border-t-transparent"
          />
          Loading supplier workspace...
        </div>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Building2
          className="mx-auto text-purple-600 dark:text-purple-400"
          size={36}
        />
        <h2 className="mt-4 text-xl font-bold">Welcome to Supplier Workspace</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
          To start receiving RFQs and participating in procurement, create or
          join a supplier company.
        </p>
        <Link
          href="/supplier/company"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-purple-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-purple-800"
        >
          Set up supplier company
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {selectedMembership && (
        <div className="flex flex-wrap justify-center gap-2 text-[11px] font-semibold">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Operations ·{" "}
            {selectedMembership.operational_status || "Status unavailable"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Verification ·{" "}
            {selectedMembership.verification_status?.replaceAll("_", " ") ||
              "Status unavailable"}
          </span>
        </div>
      )}

      {selectedCompanyId &&
        companyDataId === selectedCompanyId &&
        !company &&
        companyError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
          >
            <span>Company details could not be loaded: {companyError}</span>
            <button
              type="button"
              onClick={() => void loadCompany(selectedCompanyId)}
              className="font-semibold underline"
            >
              Retry company details
            </button>
          </div>
        )}

      {selectedCompanyId &&
        companyDataId === selectedCompanyId &&
        !company &&
        !companyError && (
          <div
            role="status"
            className="text-center text-sm text-slate-500 dark:text-slate-400"
          >
            Loading selected company details…
          </div>
        )}

      {selectedCompanyId && companyDataId !== selectedCompanyId && (
        <div
          role="status"
          className="text-center text-sm text-slate-500 dark:text-slate-400"
        >
          Switching supplier company…
        </div>
      )}

      {selectedCompanyId && companyDataId === selectedCompanyId && (
        <>
          <nav
            aria-label="Supplier dashboard actions"
            className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-slate-200/90 bg-white/95 p-1.5 shadow-sm dark:border-slate-800/90 dark:bg-slate-900/95"
          >
            <Link
              href="/supplier/rfqs"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-purple-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-purple-700"
            >
              <ClipboardList size={15} />
              RFQs & Quotations
            </Link>
            <Link
              href="/supplier/orders"
              className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <Truck size={15} />
              Purchase Orders
            </Link>
          </nav>

          <section className="mx-auto max-w-2xl pt-10 sm:pt-20">
            <Link
              href="/supplier/rfqs"
              className="relative flex items-center rounded-full border border-slate-200/90 bg-white/95 py-3.5 pl-11 pr-4 text-xs font-medium text-slate-500 shadow-sm transition hover:border-purple-300 hover:text-purple-700 dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-400 dark:hover:border-purple-700 dark:hover:text-purple-300 sm:text-sm"
            >
              <Search
                size={17}
                className="absolute left-4 text-slate-400"
                aria-hidden="true"
              />
              Review incoming RFQ invitations and quotations
            </Link>
            <p className="mx-auto mt-3 max-w-xl text-center text-xs text-slate-500 dark:text-slate-400">
              Respond to buyer invitations and manage purchase orders from
              their dedicated Supplier pages.
            </p>
          </section>

          <section
            aria-label="Supplier summary"
            className="mx-auto grid max-w-2xl gap-3 sm:grid-cols-2"
          >
            <Link
              href="/supplier/rfqs"
              className="rounded-2xl border border-slate-200 bg-white/90 p-5 text-center shadow-sm transition hover:border-purple-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/90"
            >
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {pendingInvitations.length}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                Invitations pending response
              </p>
            </Link>
            <Link
              href="/supplier/orders"
              className="rounded-2xl border border-slate-200 bg-white/90 p-5 text-center shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/90"
            >
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {activeOrders.length}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                Active purchase orders
              </p>
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
