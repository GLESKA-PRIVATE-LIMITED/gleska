"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AdminShell from "@/components/admin/AdminShell";

type Currency = "INR" | "USD" | "EUR";
type CurrencyAmount = { currency: Currency; amount: number | string };
type Employer = { id: string; name: string };
type Page<T> = { items: T[]; total: number; page: number; page_size: number; total_pages: number };

interface FinancialOverview {
  generated_invoice_count: number;
  invoiced_by_currency: CurrencyAmount[];
  outstanding_invoice_count: number;
  outstanding_by_currency: CurrencyAmount[];
  overdue_invoice_count: number;
  overdue_by_currency: CurrencyAmount[];
  payment_count: number;
  payments_by_currency: CurrencyAmount[];
  active_vendor_count: number;
  vendor_bill_count: number;
  vendor_bill_totals_by_currency: CurrencyAmount[];
  audit_runs_available: boolean;
  audit_run_count: number;
  completed_audit_run_count: number;
  failed_audit_run_count: number;
  running_audit_run_count: number;
  passed_check_count: number;
  failed_check_count: number;
  finding_count: number;
}

interface Invoice {
  id: string;
  employer: Employer;
  invoice_number: string;
  client_name: string;
  issue_date: string;
  due_date: string;
  currency: Currency;
  status: "DRAFT" | "GENERATED";
  subtotal: number | string;
  tax_rate: number | string;
  tax_amount: number | string;
  total: number | string;
  paid_amount: number | string;
  outstanding_amount: number | string;
  is_overdue: boolean;
  created_at: string;
}

interface InvoiceDetail extends Invoice {
  payment_terms_notes: string;
  updated_at: string;
  items: { id: string; description: string; quantity: number | string; unit_price: number | string; line_total: number | string }[];
}

interface Payment {
  id: string;
  employer: Employer;
  invoice_id: string;
  invoice_number: string;
  client_name: string;
  amount: number | string;
  currency: Currency;
  payment_date: string;
  payment_reference: string | null;
  notes: string;
  created_at: string;
}

interface Vendor {
  id: string;
  employer: Employer;
  vendor_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  tax_identifier: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  bill_count: number;
  bill_totals_by_currency: CurrencyAmount[];
}

interface VendorDetail extends Vendor {
  bills: VendorBill[];
  bill_page: number;
  bill_page_size: number;
  bill_total_pages: number;
}

interface VendorBill {
  id: string;
  employer: Employer;
  vendor_id: string | null;
  vendor_name: string | null;
  bill_number: string | null;
  bill_date: string | null;
  due_date: string | null;
  currency: Currency | null;
  subtotal: number | string | null;
  tax_amount: number | string | null;
  total: number | string | null;
  confirmed_at: string;
  is_assigned: boolean;
}

interface VendorBillDetail extends VendorBill {
  line_items: Record<string, unknown>[];
}

interface AuditCheck {
  id: string;
  check_id: string;
  title: string;
  result: "PASS" | "FAIL" | "NOT_APPLICABLE";
  explanation: string;
  entity_type: string | null;
  entity_id: string | null;
  findings: Record<string, unknown>[];
  checked_at: string;
}

interface AuditRun {
  id: string;
  employer: Employer;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  started_at: string;
  completed_at: string | null;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  not_applicable_checks: number;
  pass_rate: number | string | null;
  summary: Record<string, unknown>;
  error_message: string | null;
  checks: AuditCheck[];
}

type Tab = "overview" | "invoices" | "payments" | "vendors" | "bills" | "audits";
type ListData =
  | { kind: "invoices"; page: Page<Invoice> }
  | { kind: "payments"; page: Page<Payment> }
  | { kind: "vendors"; page: Page<Vendor> }
  | { kind: "bills"; page: Page<VendorBill> }
  | { kind: "audits"; page: Page<AuditRun> };
type Detail =
  | { kind: "invoice"; value: InvoiceDetail; payments: Page<Payment> }
  | { kind: "vendor"; value: VendorDetail }
  | { kind: "bill"; value: VendorBillDetail }
  | { kind: "audit"; value: AuditRun };

const API = "/api/v1/admin/financial";
const PAGE_SIZE = 25;
const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments & receivables" },
  { id: "vendors", label: "Vendors" },
  { id: "bills", label: "Vendor bills" },
  { id: "audits", label: "Audits" },
];

function amount(value: number | string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
}

function currencyTotals(values: CurrencyAmount[]): string {
  if (!values.length) return "—";
  return values.map(({ currency, amount: value }) => `${currency} ${amount(value)}`).join(" · ");
}

function dateText(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function dateTimeText(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function statusClass(value: string): string {
  if (value === "COMPLETED" || value === "GENERATED" || value === "PASS" || value === "ACTIVE") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (value === "FAILED" || value === "FAIL" || value === "OVERDUE") {
    return "bg-rose-50 text-rose-700";
  }
  if (value === "RUNNING" || value === "DRAFT" || value === "INACTIVE") {
    return "bg-amber-50 text-amber-700";
  }
  return "bg-slate-100 text-slate-600";
}

function Status({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(value)}`}>{value.replaceAll("_", " ")}</span>;
}

function CurrencyList({ values }: { values: CurrencyAmount[] }) {
  return values.length ? (
    <div className="mt-2 space-y-1">
      {values.map((entry) => (
        <p key={entry.currency} className="text-sm font-semibold text-slate-800">
          {entry.currency} {amount(entry.amount)}
        </p>
      ))}
    </div>
  ) : <p className="mt-2 text-sm text-slate-400">No persisted totals</p>;
}

export default function AdminFinancialPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [listData, setListData] = useState<ListData | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState<(() => void) | null>(null);
  const listRequestId = useRef(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [employerInput, setEmployerInput] = useState("");
  const [search, setSearch] = useState("");
  const [employer, setEmployer] = useState("");
  const [status, setStatus] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [issueDateFrom, setIssueDateFrom] = useState("");
  const [issueDateTo, setIssueDateTo] = useState("");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");

  useEffect(() => {
    if (!isLoading && !user) router.replace("/admin/login");
    else if (!isLoading && user && user.role !== "ADMIN") router.replace("/");
  }, [isLoading, router, user]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const response = await apiClient.get<FinancialOverview>(`${API}/overview`);
      setOverview(response.data);
    } catch {
      setOverviewError("Unable to load persisted financial metrics. Retry to check the reporting service.");
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === "ADMIN") void loadOverview();
  }, [loadOverview, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setEmployer(employerInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, employerInput]);

  useEffect(() => {
    setPage(1);
  }, [tab, search, employer, status, activeFilter, unassignedOnly, dateFrom, dateTo, issueDateFrom, issueDateTo, dueDateFrom, dueDateTo]);

  const loadList = useCallback(async () => {
    if (tab === "overview") return;
    const requestId = ++listRequestId.current;
    setListLoading(true);
    setListError("");
    setListData(null);
    try {
      const common = { page, page_size: PAGE_SIZE, ...(search ? { search } : {}), ...(employer ? { employer } : {}) };
      if (tab === "invoices") {
        const response = await apiClient.get<Page<Invoice>>(`${API}/invoices`, {
          params: {
            ...common,
            ...(status ? { status } : {}),
            ...(issueDateFrom ? { issue_date_from: issueDateFrom } : {}),
            ...(issueDateTo ? { issue_date_to: issueDateTo } : {}),
            ...(dueDateFrom ? { due_date_from: dueDateFrom } : {}),
            ...(dueDateTo ? { due_date_to: dueDateTo } : {}),
          },
        });
        if (requestId !== listRequestId.current) return;
        setListData({ kind: "invoices", page: response.data });
      } else if (tab === "payments") {
        const response = await apiClient.get<Page<Payment>>(`${API}/payments`, {
          params: { ...common, ...(dateFrom ? { payment_date_from: dateFrom } : {}), ...(dateTo ? { payment_date_to: dateTo } : {}) },
        });
        if (requestId !== listRequestId.current) return;
        setListData({ kind: "payments", page: response.data });
      } else if (tab === "vendors") {
        const response = await apiClient.get<Page<Vendor>>(`${API}/vendors`, {
          params: { ...common, ...(activeFilter ? { active: activeFilter === "true" } : {}) },
        });
        if (requestId !== listRequestId.current) return;
        setListData({ kind: "vendors", page: response.data });
      } else if (tab === "bills") {
        const response = await apiClient.get<Page<VendorBill>>(`${API}/vendor-bills`, {
          params: {
            ...common,
            ...(unassignedOnly ? { unassigned: true } : {}),
            ...(dateFrom ? { confirmed_from: dateFrom } : {}),
            ...(dateTo ? { confirmed_to: dateTo } : {}),
          },
        });
        if (requestId !== listRequestId.current) return;
        setListData({ kind: "bills", page: response.data });
      } else {
        const response = await apiClient.get<Page<AuditRun>>(`${API}/audit-runs`, {
          params: { page, page_size: PAGE_SIZE, ...(employer ? { employer } : {}), ...(status ? { status } : {}), ...(dateFrom ? { started_from: dateFrom } : {}), ...(dateTo ? { started_to: dateTo } : {}) },
        });
        if (requestId !== listRequestId.current) return;
        setListData({ kind: "audits", page: response.data });
      }
    } catch {
      if (requestId === listRequestId.current) {
        setListError("Unable to load these financial records. Check your connection and retry.");
      }
    } finally {
      if (requestId === listRequestId.current) setListLoading(false);
    }
  }, [activeFilter, dateFrom, dateTo, dueDateFrom, dueDateTo, employer, issueDateFrom, issueDateTo, page, search, status, tab, unassignedOnly]);

  useEffect(() => {
    if (user?.role === "ADMIN" && tab !== "overview") void loadList();
  }, [loadList, tab, user]);

  const openInvoice = async (id: string, paymentPage = 1) => {
    setDetailRetry(() => () => { void openInvoice(id, paymentPage); });
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const [invoiceResponse, paymentResponse] = await Promise.all([
        apiClient.get<InvoiceDetail>(`${API}/invoices/${id}`),
        apiClient.get<Page<Payment>>(`${API}/payments`, { params: { invoice_id: id, page: paymentPage, page_size: PAGE_SIZE } }),
      ]);
      setDetail({ kind: "invoice", value: invoiceResponse.data, payments: paymentResponse.data });
    } catch {
      setDetailError("Unable to load invoice details and payment history. Retry to try again.");
    } finally {
      setDetailLoading(false);
    }
  };

  const openVendor = async (id: string, billPage = 1) => {
    setDetailRetry(() => () => { void openVendor(id, billPage); });
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await apiClient.get<VendorDetail>(`${API}/vendors/${id}`, { params: { bill_page: billPage, bill_page_size: PAGE_SIZE } });
      setDetail({ kind: "vendor", value: response.data });
    } catch {
      setDetailError("Unable to load vendor details and linked bills. Retry to try again.");
    } finally {
      setDetailLoading(false);
    }
  };

  const openBill = async (id: string) => {
    setDetailRetry(() => () => { void openBill(id); });
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await apiClient.get<VendorBillDetail>(`${API}/vendor-bills/${id}`);
      setDetail({ kind: "bill", value: response.data });
    } catch {
      setDetailError("Unable to load vendor bill details. Retry to try again.");
    } finally {
      setDetailLoading(false);
    }
  };

  const openAudit = async (id: string) => {
    setDetailRetry(() => () => { void openAudit(id); });
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await apiClient.get<AuditRun>(`${API}/audit-runs/${id}`);
      setDetail({ kind: "audit", value: response.data });
    } catch {
      setDetailError("Unable to load persisted audit checks and findings. Retry to try again.");
    } finally {
      setDetailLoading(false);
    }
  };

  if (isLoading || !user || user.role !== "ADMIN") {
    return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb]"><Loader2 size={32} className="animate-spin text-blue-600" /></div>;
  }

  const currentPage = listData?.kind === tab ? listData.page : null;

  return (
    <AdminShell name={user.name} email={user.email} onLogout={() => void logout()}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-7 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-700"><Wallet size={14} /> Super Admin</p>
            <h1 className="mt-2 text-2xl font-bold uppercase tracking-wide text-slate-900 sm:text-3xl">Financial Management</h1>
            <p className="mt-1 text-sm text-slate-500">Persisted financial records across employers. Amounts remain grouped by currency.</p>
          </div>
          <button type="button" onClick={() => { void loadOverview(); if (tab !== "overview") void loadList(); }} className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw size={15} /> Refresh
          </button>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto border-b border-slate-200 pb-2">
          {tabs.map((item) => (
            <button key={item.id} type="button" onClick={() => { setTab(item.id); setStatus(""); setDetail(null); }} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition ${tab === item.id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`}>
              {item.label}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <section>
            {overviewError && <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><span className="flex items-center gap-2"><AlertCircle size={17} />{overviewError}</span><button type="button" onClick={() => void loadOverview()} className="font-bold underline">Retry</button></div>}
            {overviewLoading && !overview && <div className="flex min-h-56 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600"><Loader2 size={20} className="animate-spin text-blue-600" />Loading financial metrics…</div>}
            {overview && <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <MetricCard title="Generated invoices" value={overview.generated_invoice_count.toLocaleString()} icon={FileText} values={overview.invoiced_by_currency} caption="Generated invoices only" />
                <MetricCard title="Outstanding receivables" value={overview.outstanding_invoice_count.toLocaleString()} icon={Clock3} values={overview.outstanding_by_currency} caption="Open generated invoices" />
                <MetricCard title="Overdue invoices" value={overview.overdue_invoice_count.toLocaleString()} icon={AlertCircle} values={overview.overdue_by_currency} caption="Outstanding past due date" />
                <MetricCard title="Recorded payments" value={overview.payment_count.toLocaleString()} icon={CheckCircle2} values={overview.payments_by_currency} caption="Persisted invoice payments" />
                <MetricCard title="Vendors & bills" value={`${overview.active_vendor_count.toLocaleString()} active vendors`} icon={Building2} values={overview.vendor_bill_totals_by_currency} caption={`${overview.vendor_bill_count.toLocaleString()} confirmed vendor bills`} />
                <MetricCard title="Financial audit runs" value={overview.audit_runs_available ? overview.audit_run_count.toLocaleString() : "Unavailable"} icon={ShieldCheck} values={[]} caption={overview.audit_runs_available ? `${overview.completed_audit_run_count} completed · ${overview.running_audit_run_count} running · ${overview.failed_audit_run_count} failed` : "Audit-run data is not available"} />
              </div>
              {overview.audit_runs_available && <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <h2 className="font-bold text-slate-900">Persisted audit check results</h2>
                <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-600">
                  <span><strong className="text-emerald-700">{overview.passed_check_count.toLocaleString()}</strong> passed</span>
                  <span><strong className="text-rose-700">{overview.failed_check_count.toLocaleString()}</strong> failed</span>
                  <span><strong className="text-amber-700">{overview.finding_count.toLocaleString()}</strong> findings</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">These totals come from financial audit runs and check results, not action-history events.</p>
              </div>}
            </>}
          </section>
        ) : (
          <>
            <FilterBar
              tab={tab}
              searchInput={searchInput}
              employerInput={employerInput}
              status={status}
              activeFilter={activeFilter}
              unassignedOnly={unassignedOnly}
              dateFrom={dateFrom}
              dateTo={dateTo}
              issueDateFrom={issueDateFrom}
              issueDateTo={issueDateTo}
              dueDateFrom={dueDateFrom}
              dueDateTo={dueDateTo}
              onSearch={setSearchInput}
              onEmployer={setEmployerInput}
              onStatus={setStatus}
              onActive={setActiveFilter}
              onUnassigned={setUnassignedOnly}
              onDateFrom={setDateFrom}
              onDateTo={setDateTo}
              onIssueFrom={setIssueDateFrom}
              onIssueTo={setIssueDateTo}
              onDueFrom={setDueDateFrom}
              onDueTo={setDueDateTo}
            />
            {listError && <div className="mb-4 flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><span className="flex items-center gap-2"><AlertCircle size={17} />{listError}</span><button type="button" onClick={() => void loadList()} className="font-bold underline">Retry</button></div>}
            {listLoading || (!currentPage && !listError) ? <div className="flex min-h-56 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600"><Loader2 size={20} className="animate-spin text-blue-600" />Loading records…</div> :
              currentPage && currentPage.items.length ? (
                <RecordTable
                  data={listData}
                  onInvoice={openInvoice}
                  onVendor={openVendor}
                  onBill={openBill}
                  onAudit={openAudit}
                />
              ) : !listError ? <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">No matching persisted financial records.</div> : null}
            {currentPage && <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <span>{currentPage.total.toLocaleString()} records · Page {currentPage.page} of {Math.max(currentPage.total_pages, 1)}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1 || listLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-slate-200 p-2 disabled:opacity-40"><ArrowLeft size={16} /></button>
                <button type="button" disabled={page >= currentPage.total_pages || listLoading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-200 p-2 disabled:opacity-40"><ArrowRight size={16} /></button>
              </div>
            </div>}
          </>
        )}

        {(detail || detailLoading || detailError) && <DetailDialog
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={() => { setDetail(null); setDetailError(""); setDetailRetry(null); }}
          onRetry={() => detailRetry?.()}
          onOpenBill={openBill}
          onPaymentPage={openInvoice}
          onVendorBillPage={openVendor}
        />}
      </main>
    </AdminShell>
  );
}

function MetricCard({ title, value, icon: Icon, values, caption }: { title: string; value: string; icon: typeof Wallet; values: CurrencyAmount[]; caption: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></div><span className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><Icon size={19} /></span></div>
    <CurrencyList values={values} />
    <p className="mt-2 text-xs text-slate-500">{caption}</p>
  </article>;
}

function FilterBar(props: {
  tab: Tab; searchInput: string; employerInput: string; status: string; activeFilter: string;
  unassignedOnly: boolean; dateFrom: string; dateTo: string; issueDateFrom: string;
  issueDateTo: string; dueDateFrom: string; dueDateTo: string;
  onSearch: (value: string) => void; onEmployer: (value: string) => void; onStatus: (value: string) => void;
  onActive: (value: string) => void; onUnassigned: (value: boolean) => void;
  onDateFrom: (value: string) => void; onDateTo: (value: string) => void;
  onIssueFrom: (value: string) => void; onIssueTo: (value: string) => void;
  onDueFrom: (value: string) => void; onDueTo: (value: string) => void;
}) {
  const searchEnabled = props.tab !== "audits";
  const label = props.tab === "payments" ? "Payment reference" : props.tab === "vendors" ? "Vendor search" : props.tab === "bills" ? "Vendor or bill number" : "Invoice number or client";
  return <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {searchEnabled && <label className="relative block"><span className="sr-only">{label}</span><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input value={props.searchInput} onChange={(event) => props.onSearch(event.target.value)} placeholder={label} className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400" /></label>}
      <label><span className="sr-only">Filter by employer</span><input value={props.employerInput} onChange={(event) => props.onEmployer(event.target.value)} placeholder="Employer name" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400" /></label>
      {props.tab === "invoices" && <>
        <select value={props.status} onChange={(event) => props.onStatus(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">All invoice statuses</option><option value="GENERATED">Generated</option><option value="DRAFT">Draft</option></select>
        <DateInput label="Issue date from" value={props.issueDateFrom} onChange={props.onIssueFrom} />
        <DateInput label="Issue date to" value={props.issueDateTo} onChange={props.onIssueTo} />
        <DateInput label="Due date from" value={props.dueDateFrom} onChange={props.onDueFrom} />
        <DateInput label="Due date to" value={props.dueDateTo} onChange={props.onDueTo} />
      </>}
      {props.tab === "payments" && <><DateInput label="Payment date from" value={props.dateFrom} onChange={props.onDateFrom} /><DateInput label="Payment date to" value={props.dateTo} onChange={props.onDateTo} /></>}
      {props.tab === "vendors" && <select value={props.activeFilter} onChange={(event) => props.onActive(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Active and inactive</option><option value="true">Active</option><option value="false">Inactive</option></select>}
      {props.tab === "bills" && <><label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-600"><input type="checkbox" checked={props.unassignedOnly} onChange={(event) => props.onUnassigned(event.target.checked)} />Unassigned historical bills</label><DateInput label="Confirmed from" value={props.dateFrom} onChange={props.onDateFrom} /><DateInput label="Confirmed to" value={props.dateTo} onChange={props.onDateTo} /></>}
      {props.tab === "audits" && <><select value={props.status} onChange={(event) => props.onStatus(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">All run statuses</option><option value="RUNNING">Running</option><option value="COMPLETED">Completed</option><option value="FAILED">Failed</option></select><DateInput label="Started from" value={props.dateFrom} onChange={props.onDateFrom} /><DateInput label="Started to" value={props.dateTo} onChange={props.onDateTo} /></>}
    </div>
  </div>;
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="sr-only">{label}</span><input type="date" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600" /></label>;
}

function RecordTable({ data, onInvoice, onVendor, onBill, onAudit }: {
  data: ListData | null; onInvoice: (id: string) => void; onVendor: (id: string) => void;
  onBill: (id: string) => void; onAudit: (id: string) => void;
}) {
  if (!data) return null;
  if (data.kind === "invoices") return <TableFrame headers={["Invoice", "Employer", "Dates", "Status", "Total", "Paid", "Outstanding"]}>
    {data.page.items.map((item) => <tr key={item.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onInvoice(item.id)}>
      <Cell><strong>{item.invoice_number}</strong><span className="block text-xs text-slate-500">{item.client_name}</span></Cell><Cell>{item.employer.name}</Cell><Cell>{dateText(item.issue_date)}<span className="block text-xs text-slate-500">Due {dateText(item.due_date)}</span></Cell><Cell><Status value={item.is_overdue ? "OVERDUE" : item.status} /></Cell><Cell>{item.currency} {amount(item.total)}</Cell><Cell>{item.currency} {amount(item.paid_amount)}</Cell><Cell>{item.currency} {amount(item.outstanding_amount)}</Cell>
    </tr>)}
  </TableFrame>;
  if (data.kind === "payments") return <TableFrame headers={["Payment", "Employer", "Invoice", "Payment date", "Amount", "Reference"]}>
    {data.page.items.map((item) => <tr key={item.id} className="hover:bg-slate-50">
      <Cell><strong>{item.id.slice(0, 8)}</strong><span className="block text-xs text-slate-500">{dateTimeText(item.created_at)}</span></Cell><Cell>{item.employer.name}</Cell><Cell>{item.invoice_number}<span className="block text-xs text-slate-500">{item.client_name}</span></Cell><Cell>{dateText(item.payment_date)}</Cell><Cell>{item.currency} {amount(item.amount)}</Cell><Cell>{item.payment_reference || "—"}</Cell>
    </tr>)}
  </TableFrame>;
  if (data.kind === "vendors") return <TableFrame headers={["Vendor", "Employer", "Status", "Bills", "Bill totals by currency", "Contact"]}>
    {data.page.items.map((item) => <tr key={item.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onVendor(item.id)}>
      <Cell><strong>{item.vendor_name}</strong><span className="block text-xs text-slate-500">{item.tax_identifier || "Tax ID not provided"}</span></Cell><Cell>{item.employer.name}</Cell><Cell><Status value={item.is_active ? "ACTIVE" : "INACTIVE"} /></Cell><Cell>{item.bill_count}</Cell><Cell>{currencyTotals(item.bill_totals_by_currency)}</Cell><Cell>{item.contact_email || item.contact_phone || "—"}</Cell>
    </tr>)}
  </TableFrame>;
  if (data.kind === "bills") return <TableFrame headers={["Bill", "Employer", "Vendor", "Dates", "Assignment", "Amount"]}>
    {data.page.items.map((item) => <tr key={item.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onBill(item.id)}>
      <Cell><strong>{item.bill_number || "Unnumbered bill"}</strong><span className="block text-xs text-slate-500">{item.id.slice(0, 8)}</span></Cell><Cell>{item.employer.name}</Cell><Cell>{item.vendor_name || "Vendor unavailable"}</Cell><Cell>{dateText(item.bill_date)}<span className="block text-xs text-slate-500">Due {dateText(item.due_date)}</span></Cell><Cell><Status value={item.is_assigned ? "ASSIGNED" : "UNASSIGNED"} /></Cell><Cell>{item.currency ? `${item.currency} ${amount(item.total ?? 0)}` : "Currency unavailable"}</Cell>
    </tr>)}
  </TableFrame>;
  return <TableFrame headers={["Audit run", "Employer", "Status", "Started", "Checks", "Failed checks"]}>
    {data.page.items.map((item) => <tr key={item.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onAudit(item.id)}>
      <Cell><strong>{item.id.slice(0, 8)}</strong><span className="block text-xs text-slate-500">Completed {dateTimeText(item.completed_at)}</span></Cell><Cell>{item.employer.name}</Cell><Cell><Status value={item.status} /></Cell><Cell>{dateTimeText(item.started_at)}</Cell><Cell><span className="text-emerald-700">{item.passed_checks} passed</span><span className="block text-xs text-rose-700">{item.failed_checks} failed / {item.total_checks} checks</span></Cell><Cell>{item.failed_checks}</Cell>
    </tr>)}
  </TableFrame>;
}

function TableFrame({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs"><table className="w-full min-w-[900px] border-collapse text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{headers.map((header) => <th key={header} className="px-4 py-3 font-bold">{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table></div>;
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top text-slate-700">{children}</td>;
}

function DetailDialog({ detail, loading, error, onClose, onRetry, onOpenBill, onPaymentPage, onVendorBillPage }: {
  detail: Detail | null; loading: boolean; error: string; onClose: () => void;
  onRetry: () => void; onOpenBill: (id: string) => void;
  onPaymentPage: (id: string, page: number) => void;
  onVendorBillPage: (id: string, page: number) => void;
}) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="Financial record details" className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7">
      <header className="mb-5 flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-900">Financial record details</h2><button type="button" onClick={onClose} aria-label="Close details" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={19} /></button></header>
      {loading && <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-slate-500"><Loader2 className="animate-spin text-blue-600" />Loading persisted details…</div>}
      {error && <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><span>{error}</span><button type="button" onClick={onRetry} className="font-bold underline">Retry</button></div>}
      {!loading && detail?.kind === "invoice" && <div className="space-y-5">
        <DetailHeading title={detail.value.invoice_number} subtitle={`${detail.value.client_name} · ${detail.value.employer.name}`} />
        <div className="grid gap-3 sm:grid-cols-4"><DetailValue label="Status" value={detail.value.status} /><DetailValue label="Issued" value={dateText(detail.value.issue_date)} /><DetailValue label="Due" value={dateText(detail.value.due_date)} /><DetailValue label="Currency" value={detail.value.currency} /></div>
        <section><h3 className="mb-2 font-semibold">Line items</h3><TableFrame headers={["Description", "Quantity", "Unit price", "Line total"]}>{detail.value.items.map((item) => <tr key={item.id}><Cell>{item.description}</Cell><Cell>{amount(item.quantity)}</Cell><Cell>{detail.value.currency} {amount(item.unit_price)}</Cell><Cell>{detail.value.currency} {amount(item.line_total)}</Cell></tr>)}</TableFrame></section>
        <div className="grid gap-3 sm:grid-cols-4"><DetailValue label="Subtotal" value={`${detail.value.currency} ${amount(detail.value.subtotal)}`} /><DetailValue label="Tax" value={`${detail.value.currency} ${amount(detail.value.tax_amount)} (${amount(detail.value.tax_rate)}%)`} /><DetailValue label="Total" value={`${detail.value.currency} ${amount(detail.value.total)}`} /><DetailValue label="Outstanding" value={`${detail.value.currency} ${amount(detail.value.outstanding_amount)}`} /></div>
        <section><h3 className="mb-2 font-semibold">Payment history ({detail.payments.total})</h3>{detail.payments.items.length ? <><TableFrame headers={["Date", "Amount", "Reference", "Notes"]}>{detail.payments.items.map((payment) => <tr key={payment.id}><Cell>{dateText(payment.payment_date)}</Cell><Cell>{payment.currency} {amount(payment.amount)}</Cell><Cell>{payment.payment_reference || "—"}</Cell><Cell>{payment.notes || "—"}</Cell></tr>)}</TableFrame>{detail.payments.total_pages > 1 && <PageControls page={detail.payments.page} pages={detail.payments.total_pages} onChange={(nextPage) => onPaymentPage(detail.value.id, nextPage)} />}</> : <EmptyInline>No recorded payments for this invoice.</EmptyInline>}</section>
      </div>}
      {!loading && detail?.kind === "vendor" && <div className="space-y-5">
        <DetailHeading title={detail.value.vendor_name} subtitle={detail.value.employer.name} />
        <div className="grid gap-3 sm:grid-cols-3"><DetailValue label="Status" value={detail.value.is_active ? "Active" : "Inactive"} /><DetailValue label="Contact" value={detail.value.contact_email || detail.value.contact_phone || "Not provided"} /><DetailValue label="Tax identifier" value={detail.value.tax_identifier || "Not provided"} /><DetailValue label="Address" value={detail.value.address || "Not provided"} /><DetailValue label="Linked bills" value={String(detail.value.bill_count)} /><div className="rounded-xl bg-slate-50 p-3"><span className="text-xs uppercase text-slate-500">Bill totals</span><CurrencyList values={detail.value.bill_totals_by_currency} /></div></div>
        <section><h3 className="mb-2 font-semibold">Linked bills ({detail.value.bill_count})</h3>{detail.value.bills.length ? <><TableFrame headers={["Bill", "Date", "Amount", "Confirmed"]}>{detail.value.bills.map((bill) => <tr key={bill.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpenBill(bill.id)}><Cell>{bill.bill_number || "Unnumbered bill"}</Cell><Cell>{dateText(bill.bill_date)}</Cell><Cell>{bill.currency ? `${bill.currency} ${amount(bill.total ?? 0)}` : "Currency unavailable"}</Cell><Cell>{dateTimeText(bill.confirmed_at)}</Cell></tr>)}</TableFrame>{detail.value.bill_total_pages > 1 && <PageControls page={detail.value.bill_page} pages={detail.value.bill_total_pages} onChange={(nextPage) => onVendorBillPage(detail.value.id, nextPage)} />}</> : <EmptyInline>No linked bills are available.</EmptyInline>}</section>
      </div>}
      {!loading && detail?.kind === "bill" && <div className="space-y-5">
        <DetailHeading title={detail.value.bill_number || "Unnumbered vendor bill"} subtitle={`${detail.value.vendor_name || "Vendor unassigned"} · ${detail.value.employer.name}`} />
        <div className="grid gap-3 sm:grid-cols-4"><DetailValue label="Assignment" value={detail.value.is_assigned ? "Assigned" : "Unassigned historical bill"} /><DetailValue label="Bill date" value={dateText(detail.value.bill_date)} /><DetailValue label="Due date" value={dateText(detail.value.due_date)} /><DetailValue label="Confirmed" value={dateTimeText(detail.value.confirmed_at)} /></div>
        {detail.value.currency && <div className="grid gap-3 sm:grid-cols-3"><DetailValue label="Subtotal" value={`${detail.value.currency} ${amount(detail.value.subtotal ?? 0)}`} /><DetailValue label="Tax" value={`${detail.value.currency} ${amount(detail.value.tax_amount ?? 0)}`} /><DetailValue label="Total" value={`${detail.value.currency} ${amount(detail.value.total ?? 0)}`} /></div>}
        <section><h3 className="mb-2 font-semibold">Bill line items</h3>{detail.value.line_items.length ? <pre className="overflow-x-auto rounded-xl bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(detail.value.line_items, null, 2)}</pre> : <EmptyInline>No line items were persisted for this bill.</EmptyInline>}</section>
      </div>}
      {!loading && detail?.kind === "audit" && <div className="space-y-5">
        <DetailHeading title={`Audit run ${detail.value.id.slice(0, 8)}`} subtitle={`${detail.value.employer.name} · Started ${dateTimeText(detail.value.started_at)}`} />
        <div className="grid gap-3 sm:grid-cols-4"><DetailValue label="Status" value={detail.value.status} /><DetailValue label="Passed" value={String(detail.value.passed_checks)} /><DetailValue label="Failed" value={String(detail.value.failed_checks)} /><DetailValue label="Not applicable" value={String(detail.value.not_applicable_checks)} /></div>
        {detail.value.error_message && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{detail.value.error_message}</p>}
        <section><h3 className="mb-2 font-semibold">Persisted checks and findings</h3>{detail.value.checks.length ? <div className="space-y-3">{detail.value.checks.map((check) => <article key={check.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{check.title}</h4><Status value={check.result} /></div><p className="mt-1 text-xs text-slate-500">{check.check_id} · {dateTimeText(check.checked_at)}</p><p className="mt-2 text-sm text-slate-700">{check.explanation}</p>{check.findings.length > 0 && <pre className="mt-3 overflow-x-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{JSON.stringify(check.findings, null, 2)}</pre>}</article>)}</div> : <EmptyInline>No check results were persisted for this run.</EmptyInline>}</section>
      </div>}
    </section>
  </div>;
}

function DetailHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div><h3 className="text-xl font-bold text-slate-900">{title}</h3><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>;
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</p></div>;
}

function EmptyInline({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">{children}</p>;
}

function PageControls({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  return <div className="mt-3 flex items-center justify-end gap-3 text-xs text-slate-500"><span>Page {page} of {pages}</span><button type="button" aria-label="Previous detail page" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-md border border-slate-200 p-1.5 disabled:opacity-40"><ArrowLeft size={14} /></button><button type="button" aria-label="Next detail page" disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded-md border border-slate-200 p-1.5 disabled:opacity-40"><ArrowRight size={14} /></button></div>;
}
