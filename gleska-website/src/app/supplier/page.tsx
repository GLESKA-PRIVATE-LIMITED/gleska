"use client";

import React from "react";
import Link from "next/link";
import { Building2, ClipboardList, Search, Truck } from "lucide-react";
import { useSupplier } from "@/context/SupplierContext";
import { isActiveSupplierPurchaseOrderStatus } from "@/lib/procurement-api";

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
    (order) => isActiveSupplierPurchaseOrderStatus(order.status),
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
    <div className="space-y-6">
      {selectedCompanyId &&
        companyDataId === selectedCompanyId &&
        !company &&
        companyError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200 shadow-xs"
          >
            <span>Company details could not be loaded: {companyError}</span>
            <button
              type="button"
              onClick={() => void loadCompany(selectedCompanyId)}
              className="font-semibold underline cursor-pointer"
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
            className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
          >
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
            Loading company details…
          </div>
        )}

      {selectedCompanyId && companyDataId !== selectedCompanyId && (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
        >
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
          Switching supplier company…
        </div>
      )}

      {selectedCompanyId && companyDataId === selectedCompanyId && (
        <>
          {/* Summary Cards */}
          <section
            aria-label="Supplier summary"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Link
              href="/supplier/rfqs"
              className="group rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:border-purple-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  RFQ Invitations
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-300">
                  <ClipboardList size={16} />
                </span>
              </div>
              <p className="mt-3 text-3xl font-bold text-slate-900 dark:text-white">
                {pendingInvitations.length}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Pending response
              </p>
            </Link>

            <Link
              href="/supplier/orders"
              className="group rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  Active Orders
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
                  <Truck size={16} />
                </span>
              </div>
              <p className="mt-3 text-3xl font-bold text-slate-900 dark:text-white">
                {activeOrders.length}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                In fulfilment
              </p>
            </Link>

            <Link
              href="/supplier/offerings"
              className="group rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:border-emerald-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Catalogue
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <Building2 size={16} />
                </span>
              </div>
              <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                Material Offerings
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Manage supply items
              </p>
            </Link>

            <Link
              href="/supplier/company"
              className="group rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:border-indigo-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Verification
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                  <Building2 size={16} />
                </span>
              </div>
              <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white truncate">
                {selectedMembership?.verification_status?.replaceAll("_", " ") || "Company Profile"}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Evidence & team
              </p>
            </Link>
          </section>

          {/* Quick Actions & Navigation Cards */}
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Operations & Quick Access
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                href="/supplier/rfqs"
                className="flex items-start gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition hover:border-purple-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-300">
                  <ClipboardList size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    RFQs & Quotations
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Review invitations from buyers, acknowledge deadlines, and submit competitive quotations.
                  </p>
                </div>
              </Link>

              <Link
                href="/supplier/orders"
                className="flex items-start gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition hover:border-blue-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
                  <Truck size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Purchase Orders & Fulfilment
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Accept or reject issued purchase orders and record progressive dispatch & delivery milestones.
                  </p>
                </div>
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
