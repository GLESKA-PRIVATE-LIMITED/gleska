"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { financialConfig } from "@/components/agents/financial/financialConfig";
import apiClient from "@/lib/api";

type Currency = "INR" | "USD" | "EUR";
type VendorFilter = "ALL" | "ACTIVE" | "INACTIVE";
const FINANCIAL_API = "/api/v1/financial";

interface VendorBill {
  id: string;
  scan_id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  bill_number: string | null;
  bill_date: string | null;
  due_date: string | null;
  currency: Currency | null;
  total: number | null;
  confirmed_at: string;
}

interface Vendor {
  id: string;
  vendor_name: string;
  normalized_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  tax_identifier: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  bill_count: number;
  bill_totals_by_currency: { currency: Currency; total: number }[];
  bills: VendorBill[];
}

interface VendorListResponse {
  vendors: Vendor[];
  total_count: number;
  active_count: number;
  inactive_count: number;
}

interface VendorForm {
  vendor_name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  tax_identifier: string;
  is_active: boolean;
}

const emptyForm: VendorForm = {
  vendor_name: "",
  contact_email: "",
  contact_phone: "",
  address: "",
  tax_identifier: "",
  is_active: true,
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (
    typeof error === "object"
    && error !== null
    && "response" in error
    && typeof error.response === "object"
    && error.response !== null
    && "data" in error.response
    && typeof error.response.data === "object"
    && error.response.data !== null
    && "detail" in error.response.data
  ) {
    const detail = error.response.data.detail;
    if (typeof detail === "string") {
      if (detail === "FINANCIAL_VENDOR_DUPLICATE") return "A vendor with this normalized name already exists in your directory.";
      if (detail === "FINANCIAL_VENDOR_BILL_ALREADY_LINKED") return "This bill is already associated with another vendor.";
      if (detail === "FINANCIAL_VENDOR_NOT_FOUND") return "This vendor could not be found in your account.";
      if (detail === "FINANCIAL_VENDOR_BILL_NOT_FOUND") return "This bill could not be found in your account.";
      return detail;
    }
  }
  return fallback;
};

const formatMoney = (amount: number, currency: Currency) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(date);
};

export default function FinancialVendorsPage() {
  const [directory, setDirectory] = useState<VendorListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState<VendorFilter>("ALL");
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [unassignedBills, setUnassignedBills] = useState<VendorBill[]>([]);
  const [unassignedLoading, setUnassignedLoading] = useState(false);
  const [unassignedError, setUnassignedError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [form, setForm] = useState<VendorForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkingBillId, setLinkingBillId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);

  const refreshDirectory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiClient.get<VendorListResponse>(`${FINANCIAL_API}/vendors`);
      setDirectory(response.data);
    } catch (error) {
      setDirectory(null);
      setLoadError(getErrorMessage(error, "Unable to load the vendor directory."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDirectory();
  }, [refreshDirectory]);

  const filteredVendors = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (directory?.vendors ?? []).filter((vendor) => {
      const visibleByStatus = vendorFilter === "ALL"
        || (vendorFilter === "ACTIVE" ? vendor.is_active : !vendor.is_active);
      const visibleBySearch = !query || [
        vendor.vendor_name,
        vendor.contact_email ?? "",
        vendor.contact_phone ?? "",
        vendor.tax_identifier ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(query));
      return visibleByStatus && visibleBySearch;
    });
  }, [directory?.vendors, search, vendorFilter]);

  const loadVendorDetail = async (vendorId: string) => {
    setDetailError(null);
    setDetailLoading(true);
    setLinkError(null);
    setLinkSuccess(null);
    try {
      const response = await apiClient.get<Vendor>(`${FINANCIAL_API}/vendors/${vendorId}`);
      setSelectedVendor(response.data);
    } catch (error) {
      setDetailError(getErrorMessage(error, "Unable to load vendor details and linked bills."));
    } finally {
      setDetailLoading(false);
    }
  };

  const loadUnassignedBills = async () => {
    setUnassignedLoading(true);
    setUnassignedError(null);
    try {
      const response = await apiClient.get<VendorBill[]>(`${FINANCIAL_API}/vendor-bills/unassigned`);
      setUnassignedBills(response.data);
    } catch (error) {
      setUnassignedError(getErrorMessage(error, "Unable to load bills awaiting an explicit vendor match."));
    } finally {
      setUnassignedLoading(false);
    }
  };

  const openCreate = () => {
    setEditingVendor(null);
    setForm(emptyForm);
    setFormError(null);
    setFormSuccess(null);
    setFormOpen(true);
  };

  const openEdit = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setForm({
      vendor_name: vendor.vendor_name,
      contact_email: vendor.contact_email ?? "",
      contact_phone: vendor.contact_phone ?? "",
      address: vendor.address ?? "",
      tax_identifier: vendor.tax_identifier ?? "",
      is_active: vendor.is_active,
    });
    setFormError(null);
    setFormSuccess(null);
    setFormOpen(true);
  };

  const saveVendor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      vendor_name: form.vendor_name.trim().replace(/\s+/g, " "),
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      address: form.address.trim() || null,
      tax_identifier: form.tax_identifier.trim() || null,
      ...(editingVendor ? { is_active: form.is_active } : {}),
    };
    try {
      const response = editingVendor
        ? await apiClient.put<Vendor>(`${FINANCIAL_API}/vendors/${editingVendor.id}`, payload)
        : await apiClient.post<Vendor>(`${FINANCIAL_API}/vendors`, payload);
      setFormSuccess(editingVendor ? "Vendor details updated." : "Vendor added to the directory.");
      setFormOpen(false);
      await refreshDirectory();
      if (selectedVendor?.id === response.data.id) await loadVendorDetail(response.data.id);
    } catch (error) {
      setFormError(getErrorMessage(error, "The vendor could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const associateBill = async (bill: VendorBill) => {
    if (!selectedVendor || linkingBillId) return;
    setLinkingBillId(bill.id);
    setLinkError(null);
    setLinkSuccess(null);
    try {
      await apiClient.post(`${FINANCIAL_API}/vendor-bills/${bill.id}/vendor`, {
        vendor_id: selectedVendor.id,
      });
      setLinkSuccess(`${bill.bill_number || "Bill"} explicitly linked to ${selectedVendor.vendor_name}.`);
      await Promise.all([loadVendorDetail(selectedVendor.id), loadUnassignedBills(), refreshDirectory()]);
    } catch (error) {
      setLinkError(getErrorMessage(error, "The bill could not be linked. No association was reported as saved."));
      await loadUnassignedBills();
    } finally {
      setLinkingBillId(null);
    }
  };

  const openDetails = async (vendor: Vendor) => {
    setSelectedVendor(vendor);
    setDetailLoading(true);
    await Promise.all([loadVendorDetail(vendor.id), loadUnassignedBills()]);
  };

  return (
    <AgentLayout config={financialConfig} activeTab="vendors" setActiveTab={() => undefined}>
      <div className="mt-3 space-y-5 sm:mt-6 sm:space-y-7">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">Vendor Management</h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Maintain your employer-scoped vendor directory and explicitly link scanned bills.</p>
          </div>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-700">
            <Plus size={15} /> Add vendor
          </button>
        </header>

        {formSuccess && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            {formSuccess}<button type="button" onClick={() => setFormSuccess(null)} className="ml-3 underline">Dismiss</button>
          </div>
        )}
        {linkSuccess && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            {linkSuccess}<button type="button" onClick={() => setLinkSuccess(null)} className="ml-3 underline">Dismiss</button>
          </div>
        )}

        {directory && (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="All vendors">{directory.total_count}</Metric>
            <Metric label="Active vendors">{directory.active_count}</Metric>
            <Metric label="Inactive vendors">{directory.inactive_count}</Metric>
          </section>
        )}

        <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">Directory</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Names are normalized for employer-level duplicate prevention. Inactive vendors remain available for history.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input aria-label="Search vendors" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vendors" className="w-48 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" />
              </label>
              <select aria-label="Filter vendors by status" value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value as VendorFilter)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                <option value="ALL">All vendors</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin" /> Loading vendor directory…</p>
          ) : loadError ? (
            <div className="py-12 text-center"><p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{loadError}</p><button type="button" onClick={() => void refreshDirectory()} className="mt-3 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 dark:border-rose-800 dark:text-rose-300">Retry</button></div>
          ) : filteredVendors.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{directory?.vendors.length ? "No vendors match this search and filter." : "No vendors yet. Add one to start organizing confirmed bills."}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredVendors.map((vendor) => (
                <div key={vendor.id} className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
                  <button type="button" onClick={() => void openDetails(vendor)} className="flex min-w-0 items-start gap-3 text-left">
                    <span className="rounded-xl bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><Building2 size={18} /></span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-900 dark:text-white">{vendor.vendor_name}</span>
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{vendor.contact_email || vendor.contact_phone || vendor.tax_identifier || "No contact details"}</span>
                      <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{vendor.bill_count} linked bills · {vendor.bill_totals_by_currency.map((total) => formatMoney(total.total, total.currency)).join(" · ") || "No bill totals"}</span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${vendor.is_active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{vendor.is_active ? "ACTIVE" : "INACTIVE"}</span>
                    <button type="button" onClick={() => openEdit(vendor)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><Pencil size={13} /> Edit</button>
                    <button type="button" onClick={() => void openDetails(vendor)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">Details</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {(detailLoading || detailError || selectedVendor) && (
          <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-xl dark:border-slate-800 dark:bg-slate-900/95">
            {detailLoading ? (
              <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin" /> Loading vendor details…</p>
            ) : detailError ? (
              <div className="py-10 text-center">
                <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{detailError}</p>
                {selectedVendor && <button type="button" onClick={() => void loadVendorDetail(selectedVendor.id)} className="mt-3 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 dark:border-rose-800 dark:text-rose-300">Retry</button>}
              </div>
            ) : selectedVendor && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-indigo-50 p-2 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"><UserRound size={18} /></span>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{selectedVendor.vendor_name}</h2>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selectedVendor.contact_email || "No email"}{selectedVendor.contact_phone ? ` · ${selectedVendor.contact_phone}` : ""}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Tax ID: {selectedVendor.tax_identifier || "—"} · {selectedVendor.is_active ? "Active" : "Inactive"}</p>
                      {selectedVendor.address && <p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">{selectedVendor.address}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => openEdit(selectedVendor)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold dark:border-slate-700"><Pencil size={13} /> Edit</button>
                    <button type="button" onClick={() => setSelectedVendor(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Close</button>
                  </div>
                </div>
                <div className="grid gap-4 p-5 lg:grid-cols-2">
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white">Linked bill summary</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selectedVendor.bill_count} confirmed bills · totals grouped by currency</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedVendor.bill_totals_by_currency.length
                        ? selectedVendor.bill_totals_by_currency.map((total) => <span key={total.currency} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold dark:bg-slate-800">{formatMoney(total.total, total.currency)}</span>)
                        : <span className="text-xs text-slate-500">No bill totals available.</span>}
                    </div>
                    {selectedVendor.bills.length ? (
                      <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedVendor.bills.map((bill) => (
                          <div key={bill.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
                            <div>
                              <p className="font-semibold text-slate-900 dark:text-white">{bill.bill_number || "Bill reference unavailable"}{bill.vendor_name && bill.vendor_name !== selectedVendor.vendor_name ? ` · scanned as ${bill.vendor_name}` : ""}</p>
                              <p className="mt-1 text-slate-500 dark:text-slate-400">Bill date {formatDate(bill.bill_date)} · Due {formatDate(bill.due_date)}</p>
                            </div>
                            <span className="font-mono font-bold">{bill.total != null && bill.currency ? formatMoney(bill.total, bill.currency) : "Amount unavailable"}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-xl bg-slate-50 p-4 text-xs text-slate-500 dark:bg-slate-950/40">No confirmed bills have been explicitly linked to this vendor.</p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                    <h3 className="font-bold text-slate-900 dark:text-white">Unassigned scanned bills</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Matching is always explicit. A scanned vendor name is not automatically treated as a directory match.</p>
                    {linkError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{linkError}</p>}
                    {unassignedError ? (
                      <div className="mt-3"><p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{unassignedError}</p><button type="button" onClick={() => void loadUnassignedBills()} className="mt-2 text-xs font-bold underline">Retry</button></div>
                    ) : unassignedLoading ? (
                      <p className="mt-3 text-xs text-slate-500">Loading unassigned bills…</p>
                    ) : unassignedBills.length === 0 ? (
                      <p className="mt-3 text-xs text-slate-500">No unassigned confirmed bills.</p>
                    ) : (
                      <div className="mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                        {unassignedBills.map((bill) => (
                          <div key={bill.id} className="flex items-center justify-between gap-2 py-3">
                            <div className="min-w-0 text-xs">
                              <p className="truncate font-semibold text-slate-900 dark:text-white">{bill.vendor_name || "Vendor not detected"} · {bill.bill_number || "Bill number unavailable"}</p>
                              <p className="mt-1 text-slate-500 dark:text-slate-400">{bill.currency && bill.total != null ? formatMoney(bill.total, bill.currency) : "Amount unavailable"} · {formatDate(bill.bill_date)}</p>
                            </div>
                            <button type="button" onClick={() => void associateBill(bill)} disabled={linkingBillId !== null} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">
                              {linkingBillId === bill.id ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />} Link
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
          <form onSubmit={(event) => void saveVendor(event)} role="dialog" aria-modal="true" aria-labelledby="vendor-form-title" className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div>
              <h2 id="vendor-form-title" className="text-lg font-bold text-slate-900 dark:text-white">{editingVendor ? "Update vendor" : "Add vendor"}</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Vendor names are normalized for duplicate checking within your employer account.</p>
            </div>
            {formError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">{formError}</p>}
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Vendor name
              <input required maxLength={240} value={form.vendor_name} onChange={(event) => setForm((current) => ({ ...current, vendor_name: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Contact email
                <input type="email" maxLength={254} value={form.contact_email} onChange={(event) => setForm((current) => ({ ...current, contact_email: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
              </label>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Contact phone
                <input maxLength={40} value={form.contact_phone} onChange={(event) => setForm((current) => ({ ...current, contact_phone: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
              </label>
            </div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Tax identifier
              <input maxLength={64} value={form.tax_identifier} onChange={(event) => setForm((current) => ({ ...current, tax_identifier: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Address
              <textarea maxLength={1000} rows={3} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            {editingVendor && (
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
                Active vendor
              </label>
            )}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">Cancel</button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving && <LoaderCircle size={14} className="animate-spin" />}{saving ? "Saving…" : editingVendor ? "Save changes" : "Add vendor"}
              </button>
            </div>
          </form>
        </div>
      )}
    </AgentLayout>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{children}</p>
    </div>
  );
}
