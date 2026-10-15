"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  FileText,
  Download,
  Eye,
  Scan,
  Search,
  Plus,
  Printer,
  Mic,
  MicOff,
  Upload,
  Camera,
  Image as ImageIcon,
  X,
  CheckCircle2,
  Clock,
  Building2,
  ShieldCheck,
  AlertCircle,
  Trash2,
  Sparkles,
  FileCheck,
  Check,
  RefreshCw,
} from "lucide-react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { financialConfig } from "@/components/agents/financial/financialConfig";
import apiClient from "@/lib/api";
import { createInvoicePdf } from "./invoicePdf";

// Supported file formats for upload
const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
];

interface FinancialRecord {
  id: string;
  type: "INVOICE" | "TRANSACTION" | "AUDIT" | "VENDOR";
  title: string;
  entity: string;
  reference: string;
  amount: number | null;
  currency?: "INR" | "USD" | "EUR" | null;
  status: string;
  date: string;
  category: string;
}

interface DashboardSummary {
  total_invoiced: number | null;
  total_invoiced_currency?: "INR" | "USD" | "EUR" | null;
  total_invoiced_has_multiple_currencies?: boolean;
  pending_receivables: number | null;
  pending_receivables_by_currency?: { currency: "INR" | "USD" | "EUR"; amount: number }[];
  pending_receivable_count?: number;
  receivables_as_of_date?: string;
  active_invoices: number | null;
  audits_passed: number | null;
  audit_pass_rate: number | null;
  latest_audit_run_id?: string | null;
  latest_audit_failed_checks?: number | null;
  latest_audit_completed_at?: string | null;
  latest_audit_started_at?: string | null;
  latest_audit_run_status?: "RUNNING" | "COMPLETED" | "FAILED" | null;
  total_audit_runs?: number;
  active_vendors: number | null;
}

interface FinancialInvoice {
  id: string;
  invoice_number: string;
  client_name: string;
  issue_date: string;
  due_date: string;
  payment_terms_notes: string;
  currency: "INR" | "USD" | "EUR";
  status: "DRAFT" | "GENERATED";
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  line_items: {
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
}

interface FinancialInvoiceCompanyDetails {
  business_name?: string | null;
  registered_address?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  company_email?: string | null;
  company_phone?: string | null;
}

interface FinancialSettings {
  base_currency: "INR" | "USD" | "EUR";
  tax_identifier: string;
  auto_reconcile_incoming_bills: boolean;
  created_at: string | null;
  updated_at: string | null;
  document_processing_configured: boolean;
  document_processing_upload_limit_bytes: number;
}

type FinancialSettingsValues = Pick<
  FinancialSettings,
  "base_currency" | "tax_identifier" | "auto_reconcile_incoming_bills"
>;

interface FinancialScanResult {
  vendor_name: string | null;
  bill_number: string | null;
  bill_date: string | null;
  due_date: string | null;
  currency: "INR" | "USD" | "EUR" | null;
  line_items: {
    description: string | null;
    quantity: number | null;
    unit_rate: number | null;
    tax_amount: number | null;
    total: number | null;
  }[];
  subtotal: number | null;
  tax_amount: number | null;
  total: number | null;
}

interface FinancialScan {
  id: string;
  original_filename: string;
  content_type: string;
  file_size: number;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CONFIRMED";
  progress: number;
  retryable: boolean;
  result: FinancialScanResult;
  reviewed_result: FinancialScanResult | null;
  confidence: Record<string, number>;
  extracted_text: string | null;
  error_code: string | null;
  retry_count: number;
  confirmed_bill_id: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

const emptyScanResult: FinancialScanResult = {
  vendor_name: null,
  bill_number: null,
  bill_date: null,
  due_date: null,
  currency: null,
  line_items: [],
  subtotal: null,
  tax_amount: null,
  total: null,
};

const FINANCIAL_API = "/api/v1/financial";

const getApiErrorMessage = (error: unknown, fallback: string) => {
  const response = (error as {
    response?: { status?: number; data?: { detail?: unknown; message?: unknown } };
  })?.response;
  const detail = response?.data?.detail;
  const message = response?.data?.message;
  if (typeof detail === "string") {
    const messages: Record<string, string> = {
      INVOICE_IDEMPOTENCY_KEY_REUSED: "This invoice creation key was already used with different details. Review the invoice and retry with the current details.",
      OCR_PROVIDER_NOT_CONFIGURED: "Invoice OCR is not configured on the server. The private scan is saved and can be retried after configuration.",
      SCAN_FILE_TOO_LARGE: "Files must be 25 MB or smaller.",
      SCAN_FILE_TYPE_UNSUPPORTED: "Unsupported file. Use PDF, DOCX, XLSX, CSV, PNG, JPG, JPEG, WEBP, or SVG.",
      SCAN_FILE_CONTENT_TYPE_MISMATCH: "The file contents do not match its filename or declared document type.",
      SCAN_FILE_EMPTY: "The selected file is empty.",
      SCAN_STORAGE_UPLOAD_FAILED: "Private document storage is unavailable. The scan record was kept. Select the file again after storage is restored.",
      SCAN_SVG_TEXT_ONLY_SUPPORTED: "SVG documents are accepted, but only embedded text can be extracted. Use a PNG, JPG, JPEG, or WEBP image for OCR.",
      SCAN_ARCHIVE_TOO_LARGE: "The compressed document expands beyond the safe processing limit. Save a smaller DOCX or XLSX file and upload it again.",
      OCR_PROVIDER_UPLOAD_FAILED: "The OCR provider could not accept this large document. Retry later or upload a smaller copy.",
      OCR_PROVIDER_TIMEOUT: "The OCR provider timed out. Retry this scan.",
      OCR_PROVIDER_UNAVAILABLE: "The OCR provider is temporarily unavailable. Retry this scan.",
      OCR_PROVIDER_RATE_LIMITED: "The OCR provider is rate-limited. Retry this scan later.",
      OCR_PROVIDER_AUTHENTICATION_FAILED: "The configured OCR provider rejected its credentials. Contact your administrator.",
      SCAN_NOT_RETRYABLE: "This scan cannot be retried because its document was not stored successfully.",
      SCAN_PROCESSING_IN_PROGRESS: "This scan is still processing. Wait for it to finish before retrying.",
      SCAN_NOT_READY_FOR_CONFIRMATION: "Wait until processing finishes before confirming this scan.",
    };
    return messages[detail] || detail;
  }
  if (Array.isArray(detail)) return detail.map((item) => String(item?.msg || item)).join("; ");
  if (typeof message === "string") return message;
  return fallback;
};

interface AttachedDocument {
  name: string;
  size: string;
  type: string;
  source: "upload" | "camera" | "photo";
}

interface InvoiceItemDraft {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

export default function FinancialDashboard() {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const activeTabRef = useRef<string>("dashboard");
  const [selectedOption, setSelectedOption] = useState<"create" | "scan">("create");

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [executedSearchQuery, setExecutedSearchQuery] = useState<string>("");
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState<boolean>(false);
  const [menuPlacement, setMenuPlacement] = useState<"top" | "bottom">("top");
  const [isListening, setIsListening] = useState<boolean>(false);
  const [attachedFile, setAttachedFile] = useState<AttachedDocument | null>(null);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [dashboardRecords, setDashboardRecords] = useState<FinancialRecord[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState<boolean>(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<FinancialRecord[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<FinancialInvoice[]>([]);
  const [invoiceCompanyDetails, setInvoiceCompanyDetails] = useState<FinancialInvoiceCompanyDetails | null>(null);
  const [invoicesLoading, setInvoicesLoading] = useState<boolean>(true);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [invoiceListView, setInvoiceListView] = useState<"drafts" | "generated">("drafts");
  const [viewingInvoice, setViewingInvoice] = useState<FinancialInvoice | null>(null);
  const [invoiceMutationId, setInvoiceMutationId] = useState<string | null>(null);
  const [invoiceMutationKind, setInvoiceMutationKind] = useState<"generate" | "delete" | null>(null);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);
  const [scans, setScans] = useState<FinancialScan[]>([]);
  const [scansLoading, setScansLoading] = useState<boolean>(false);
  const [scansError, setScansError] = useState<string | null>(null);
  const [activeScan, setActiveScan] = useState<FinancialScan | null>(null);
  const [scanReview, setScanReview] = useState<FinancialScanResult>(emptyScanResult);
  const [scanUploadProgress, setScanUploadProgress] = useState<number>(0);
  const [scanSubmitting, setScanSubmitting] = useState<boolean>(false);
  const [scanConfirming, setScanConfirming] = useState<boolean>(false);

  // Toast feedback state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Camera modal state
  const [showCameraModal, setShowCameraModal] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // Create Invoice state
  const [invoiceForm, setInvoiceForm] = useState({
    clientName: "",
    issueDate: new Date().toISOString().split("T")[0],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    taxRate: "18",
    notes: "",
  });
  const [generatedInvoiceNumber, setGeneratedInvoiceNumber] = useState<string | null>(null);
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [isViewingGeneratedInvoice, setIsViewingGeneratedInvoice] = useState<boolean>(false);
  const [submitAttempted, setSubmitAttempted] = useState<boolean>(false);
  const [isSavingInvoice, setIsSavingInvoice] = useState<boolean>(false);
  const invoiceMutationLockRef = useRef<boolean>(false);
  const invoiceCreateIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const pdfDownloadLockRef = useRef<boolean>(false);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItemDraft[]>([
    { id: "1", description: "", quantity: "", unitPrice: "" },
  ]);
  const [financialSettings, setFinancialSettings] = useState<FinancialSettings>({
    base_currency: "INR",
    tax_identifier: "",
    auto_reconcile_incoming_bills: false,
    created_at: null,
    updated_at: null,
    document_processing_configured: false,
    document_processing_upload_limit_bytes: 25 * 1024 * 1024,
  });
  const [savedSettingsValues, setSavedSettingsValues] = useState<FinancialSettingsValues | null>(null);
  const [settingsLoading, setSettingsLoading] = useState<boolean>(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const operatingCurrency = savedSettingsValues?.base_currency ?? financialSettings.base_currency;
  const latestAuditCheckTotal = (dashboardSummary?.audits_passed ?? 0)
    + (dashboardSummary?.latest_audit_failed_checks ?? 0);
  const latestAuditPassRate = dashboardSummary?.latest_audit_run_id && latestAuditCheckTotal > 0
    ? ((dashboardSummary.audits_passed ?? 0) / latestAuditCheckTotal) * 100
    : null;
  const invoiceFormCurrency = activeInvoiceId
    ? invoices.find((invoice) => invoice.id === activeInvoiceId)?.currency || operatingCurrency
    : operatingCurrency;

  // Scan Invoice state
  // Refs
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<any>(null);
  const searchRequestIdRef = useRef<number>(0);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  }, []);

  const formatMoney = (amount: number, currency = operatingCurrency) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);

  const currencySymbol = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: invoiceFormCurrency,
    maximumFractionDigits: 0,
  }).formatToParts(0).find((part) => part.type === "currency")?.value || invoiceFormCurrency;

  const formatInvoiceDate = (date: string) =>
    new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));

  const refreshDashboard = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`${FINANCIAL_API}/dashboard`);
      setDashboardSummary(data.summary);
      setDashboardRecords(data.records || []);
      setDashboardError(null);
    } catch (error) {
      setDashboardError(getApiErrorMessage(error, "Unable to load financial dashboard data."));
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const refreshInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const { data } = await apiClient.get(`${FINANCIAL_API}/invoices`);
      setInvoices(data.invoices || []);
      setInvoiceCompanyDetails(data.company_details || null);
      setInvoicesError(null);
    } catch (error) {
      setInvoicesError(getApiErrorMessage(error, "Unable to load invoices."));
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  const refreshScans = useCallback(async () => {
    setScansLoading(true);
    setScansError(null);
    try {
      const { data } = await apiClient.get(`${FINANCIAL_API}/scans`);
      setScans(Array.isArray(data?.scans) ? data.scans : []);
    } catch (error) {
      setScansError(getApiErrorMessage(error, "Unable to load scan history."));
    } finally {
      setScansLoading(false);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const { data } = await apiClient.get(`${FINANCIAL_API}/settings`);
      const saved = data?.settings || data;
      if (
        !saved ||
        !["INR", "USD", "EUR"].includes(saved.base_currency) ||
        typeof saved.tax_identifier !== "string" ||
        typeof saved.auto_reconcile_incoming_bills !== "boolean" ||
        typeof saved.document_processing_configured !== "boolean" ||
        !Number.isSafeInteger(saved.document_processing_upload_limit_bytes) ||
        saved.document_processing_upload_limit_bytes <= 0
      ) {
        throw new Error("Financial settings response was incomplete.");
      }
      const normalized: FinancialSettings = {
        base_currency: saved.base_currency,
        tax_identifier: saved.tax_identifier,
        auto_reconcile_incoming_bills: saved.auto_reconcile_incoming_bills,
        created_at: typeof saved.created_at === "string" ? saved.created_at : null,
        updated_at: typeof saved.updated_at === "string" ? saved.updated_at : null,
        document_processing_configured: saved.document_processing_configured,
        document_processing_upload_limit_bytes: saved.document_processing_upload_limit_bytes,
      };
      setFinancialSettings(normalized);
      setSavedSettingsValues({
        base_currency: normalized.base_currency,
        tax_identifier: normalized.tax_identifier,
        auto_reconcile_incoming_bills: normalized.auto_reconcile_incoming_bills,
      });
    } catch (error) {
      setSettingsError(getApiErrorMessage(error, "Unable to load financial settings."));
      setSavedSettingsValues(null);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDashboard();
    void refreshInvoices();
    void refreshSettings();
    const refreshAfterPayment = () => void refreshDashboard();
    window.addEventListener("financial-receivables-updated", refreshAfterPayment);
    return () => window.removeEventListener("financial-receivables-updated", refreshAfterPayment);
  }, [refreshDashboard, refreshInvoices, refreshSettings]);

  useEffect(() => {
    if (invoicesLoading || typeof window === "undefined") return;
    const invoiceId = new URLSearchParams(window.location.search).get("invoice");
    if (!invoiceId) return;
    const invoice = invoices.find((candidate) => candidate.id === invoiceId);
    if (invoice) setViewingInvoice(invoice);
  }, [invoices, invoicesLoading]);

  useEffect(() => {
    if (activeTab !== "scan-invoice") return;
    void refreshScans();
  }, [activeTab, refreshScans]);

  useEffect(() => {
    if (
      !activeScan ||
      scanSubmitting ||
      (activeScan.status !== "QUEUED" && activeScan.status !== "PROCESSING")
    ) return;
    let current = true;
    const timer = window.setInterval(async () => {
      try {
        const { data } = await apiClient.get(`${FINANCIAL_API}/scans/${activeScan.id}`);
        if (!current) return;
        setActiveScan(data);
        setScans((items) => [data, ...items.filter((item) => item.id !== data.id)]);
        if (data.status === "COMPLETED") {
          setScanReview(data.reviewed_result || data.result);
          showToast("Invoice scan processed. Review the extracted values before confirming.", "success");
        }
        if (data.status === "FAILED") {
          showToast(getApiErrorMessage(
            { response: { data: { detail: data.error_code } } },
            "Invoice processing failed. Retry the scan."
          ), "error");
        }
      } catch (error) {
        if (current) setScansError(getApiErrorMessage(error, "Unable to refresh scan processing status."));
      }
    }, 2500);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [activeScan?.id, activeScan?.status, scanSubmitting, showToast]);

  const parseQuantity = (val: string): number | null => {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isNaN(num) || !Number.isFinite(num) || num <= 0) return null;
    return num;
  };

  const parseRate = (val: string): number | null => {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) return null;
    return num;
  };

  const parseTaxRate = (val: string): number => {
    const trimmed = val.trim();
    if (!trimmed) return 0;
    const num = Number(trimmed);
    if (Number.isNaN(num) || !Number.isFinite(num) || num < 0 || num > 100) return 0;
    return num;
  };

  const getRowAmount = (item: InvoiceItemDraft): number => {
    const q = parseQuantity(item.quantity);
    const r = parseRate(item.unitPrice);
    if (q !== null && r !== null) {
      return q * r;
    }
    return 0;
  };

  const validateInvoiceForm = (): string | null => {
    if (!invoiceForm.clientName.trim()) {
      return "Client or company name is required.";
    }
    if (!invoiceForm.issueDate) {
      return "Issue date is required.";
    }
    if (!invoiceForm.dueDate) {
      return "Payment due date is required.";
    }
    if (invoiceForm.dueDate < invoiceForm.issueDate) {
      return "Payment due date cannot be earlier than issue date.";
    }
    const taxNum = Number(invoiceForm.taxRate.trim());
    if (invoiceForm.taxRate.trim() !== "" && (Number.isNaN(taxNum) || taxNum < 0 || taxNum > 100)) {
      return "Tax rate must be between 0% and 100%.";
    }
    if (invoiceItems.length === 0) {
      return "At least one line item is required.";
    }
    for (let i = 0; i < invoiceItems.length; i++) {
      const item = invoiceItems[i];
      const rowNum = i + 1;
      if (!item.description.trim()) {
        return `Line item #${rowNum}: description is required.`;
      }
      const q = parseQuantity(item.quantity);
      if (q === null) {
        return `Line item #${rowNum}: quantity must be a positive number greater than 0.`;
      }
      const r = parseRate(item.unitPrice);
      if (r === null) {
        return `Line item #${rowNum}: unit rate must be 0 or greater.`;
      }
    }
    return null;
  };

  const handleDescriptionChange = (id: string, value: string) => {
    setInvoiceItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, description: value } : item))
    );
  };

  const handleQuantityChange = (id: string, value: string) => {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setInvoiceItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, quantity: value } : item))
      );
    }
  };

  const handleRateChange = (id: string, value: string) => {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setInvoiceItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, unitPrice: value } : item))
      );
    }
  };

  const addLineItem = () => {
    setInvoiceItems((prev) => [
      ...prev,
      {
        id: String(Date.now() + Math.random()),
        description: "",
        quantity: "",
        unitPrice: "",
      },
    ]);
  };

  const removeLineItem = (id: string) => {
    setInvoiceItems((prev) => {
      if (prev.length <= 1) {
        return [{ id: prev[0]?.id || "1", description: "", quantity: "", unitPrice: "" }];
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const resetInvoiceForm = () => {
    setInvoiceForm({
      clientName: "",
      issueDate: new Date().toISOString().split("T")[0],
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      taxRate: "18",
      notes: "",
    });
    setInvoiceItems([{ id: "1", description: "", quantity: "", unitPrice: "" }]);
    setSubmitAttempted(false);
    setGeneratedInvoiceNumber(null);
    setActiveInvoiceId(null);
    setIsViewingGeneratedInvoice(false);
  };

  const saveInvoice = async (action: "save_draft" | "generate") => {
    if (invoiceMutationLockRef.current) return;
    if (!activeInvoiceId && savedSettingsValues === null) {
      showToast("Load your saved Financial Agent Settings before creating an invoice.", "error");
      return;
    }
    setSubmitAttempted(true);

    const validationError = validateInvoiceForm();
    if (validationError) {
      showToast(validationError, "error");
      return;
    }

    invoiceMutationLockRef.current = true;
    setIsSavingInvoice(true);
    try {
      const payloadLineItems = invoiceItems.map(({ description, quantity, unitPrice }) => ({
        description: description.trim(),
        quantity: Number(quantity),
        unit_price: Number(unitPrice),
      }));

      const payload = {
        client_name: invoiceForm.clientName.trim(),
        issue_date: invoiceForm.issueDate,
        due_date: invoiceForm.dueDate,
        payment_terms_notes: invoiceForm.notes.trim(),
        tax_rate: parseTaxRate(invoiceForm.taxRate),
        line_items: payloadLineItems,
        action,
      };
      let responseData: FinancialInvoice | { invoice: FinancialInvoice };
      if (activeInvoiceId) {
        const response = await apiClient.put<FinancialInvoice | { invoice: FinancialInvoice }>(
          `${FINANCIAL_API}/invoices/${activeInvoiceId}`,
          payload,
        );
        responseData = response.data;
      } else {
        const fingerprint = JSON.stringify(payload);
        const priorIdempotency = invoiceCreateIdempotencyRef.current;
        const idempotencyKey = priorIdempotency?.fingerprint === fingerprint
          ? priorIdempotency.key
          : crypto.randomUUID();
        invoiceCreateIdempotencyRef.current = { fingerprint, key: idempotencyKey };
        const response = await apiClient.post<FinancialInvoice | { invoice: FinancialInvoice }>(`${FINANCIAL_API}/invoices`, {
          ...payload,
          idempotency_key: idempotencyKey,
        });
        responseData = response.data;
      }

      const savedInvoice: FinancialInvoice | undefined = "invoice" in responseData
        ? responseData.invoice
        : responseData;
      if (!savedInvoice?.id || !savedInvoice.invoice_number) {
        throw new Error("Invoice creation response did not include the saved invoice number.");
      }
      setInvoices((current) => [
        savedInvoice,
        ...current.filter((invoice) => invoice.id !== savedInvoice.id),
      ]);
      if (!activeInvoiceId) invoiceCreateIdempotencyRef.current = null;
      setGeneratedInvoiceNumber(savedInvoice.invoice_number);
      setActiveInvoiceId(savedInvoice.id);
      setIsViewingGeneratedInvoice(savedInvoice.status === "GENERATED");
      setInvoiceListView(savedInvoice.status === "DRAFT" ? "drafts" : "generated");
      if (action === "generate" && savedInvoice.status === "GENERATED") {
        setViewingInvoice(savedInvoice);
      }
      const serverTotal =
        typeof savedInvoice?.total === "number"
          ? ` Server-computed total: ${formatMoney(savedInvoice.total, savedInvoice.currency || operatingCurrency)}.`
          : "";
      showToast(
        action === "save_draft"
          ? `Invoice draft ${savedInvoice.invoice_number} ${activeInvoiceId ? "updated" : "saved"}.${serverTotal}`
          : `Invoice ${savedInvoice.invoice_number} saved with GENERATED status.${serverTotal} No ledger record was written.`,
        "success"
      );
      void refreshDashboard();
    } catch (error) {
      showToast(getApiErrorMessage(error, "Unable to save this invoice. Your entries have been kept."), "error");
    } finally {
      invoiceMutationLockRef.current = false;
      setIsSavingInvoice(false);
    }
  };

  const settingsDirty = savedSettingsValues !== null && (
    financialSettings.base_currency !== savedSettingsValues.base_currency
    || financialSettings.tax_identifier !== savedSettingsValues.tax_identifier
    || financialSettings.auto_reconcile_incoming_bills !== savedSettingsValues.auto_reconcile_incoming_bills
  );

  const saveSettings = async () => {
    const taxIdentifier = financialSettings.tax_identifier.trim();
    if (taxIdentifier.length > 64) {
      setSettingsSaveError("Company tax identifiers must be 64 characters or fewer.");
      return;
    }
    if (/[\u0000-\u001f\u007f]/.test(taxIdentifier)) {
      setSettingsSaveError("Company tax identifiers cannot contain control characters.");
      return;
    }
    setIsSavingSettings(true);
    setSettingsSaveError(null);
    try {
      const { data } = await apiClient.put(`${FINANCIAL_API}/settings`, {
        base_currency: financialSettings.base_currency,
        tax_identifier: taxIdentifier,
        auto_reconcile_incoming_bills: financialSettings.auto_reconcile_incoming_bills,
      });
      const saved = data?.settings || data;
      if (
        !saved ||
        !["INR", "USD", "EUR"].includes(saved.base_currency) ||
        typeof saved.tax_identifier !== "string" ||
        typeof saved.auto_reconcile_incoming_bills !== "boolean" ||
        typeof saved.document_processing_configured !== "boolean" ||
        !Number.isSafeInteger(saved.document_processing_upload_limit_bytes) ||
        saved.document_processing_upload_limit_bytes <= 0
      ) {
        throw new Error("The settings save did not return the persisted configuration.");
      }
      const authoritative: FinancialSettings = {
        base_currency: saved.base_currency,
        tax_identifier: saved.tax_identifier,
        auto_reconcile_incoming_bills: saved.auto_reconcile_incoming_bills,
        created_at: typeof saved.created_at === "string" ? saved.created_at : null,
        updated_at: typeof saved.updated_at === "string" ? saved.updated_at : null,
        document_processing_configured: saved.document_processing_configured,
        document_processing_upload_limit_bytes: saved.document_processing_upload_limit_bytes,
      };
      setFinancialSettings(authoritative);
      setSavedSettingsValues({
        base_currency: authoritative.base_currency,
        tax_identifier: authoritative.tax_identifier,
        auto_reconcile_incoming_bills: authoritative.auto_reconcile_incoming_bills,
      });
      setSettingsError(null);
      showToast("Financial settings saved.", "success");
    } catch (error) {
      const message = getApiErrorMessage(error, "Unable to save financial settings. Your entries have been kept.");
      setSettingsSaveError(message);
      showToast(message, "error");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const uploadScan = async (file: File) => {
    const uploadLimitBytes = financialSettings.document_processing_upload_limit_bytes;
    const uploadLimitMegabytes = Math.floor(uploadLimitBytes / (1024 * 1024));
    if (file.size > uploadLimitBytes) {
      showToast(`Files must be ${uploadLimitMegabytes} MB or smaller.`, "error");
      return;
    }
    if (!file.size) {
      showToast("The selected file is empty.", "error");
      return;
    }
    setScanSubmitting(true);
    setScanUploadProgress(0);
    setScansError(null);
    setActiveScan(null);
    setScanReview(emptyScanResult);
    const body = new FormData();
    body.append("file", file);
    try {
      const { data } = await apiClient.post(`${FINANCIAL_API}/scans`, body, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          if (event.total) setScanUploadProgress(Math.round((event.loaded * 100) / event.total));
        },
      });
      setScanSubmitting(false);
      setAttachedFile({
        name: data.original_filename,
        size: `${(data.file_size / (1024 * 1024)).toFixed(2)} MB`,
        type: data.content_type,
        source: "upload",
      });
      setActiveScan(data);
      setScanReview(data.reviewed_result || data.result || emptyScanResult);
      setScans((current) => [data, ...current.filter((scan) => scan.id !== data.id)]);
      if (data.status === "FAILED") {
        showToast(getApiErrorMessage(
          { response: { data: { detail: data.error_code } } },
          "The document could not be processed."
        ), "error");
      } else if (data.status === "COMPLETED") {
        setScanReview(data.reviewed_result || data.result || emptyScanResult);
        showToast("Invoice scan processed. Review the extracted values before confirming.", "success");
      } else if (data.status !== "CONFIRMED") {
        showToast("Document uploaded securely. Processing has started.", "info");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, "Unable to upload this document. Please retry."), "error");
      setScansError(getApiErrorMessage(error, "Unable to upload this document."));
      void refreshScans();
    } finally {
      setScanSubmitting(false);
    }
  };

  const openScan = async (scanId: string) => {
    try {
      const { data } = await apiClient.get(`${FINANCIAL_API}/scans/${scanId}`);
      setActiveScan(data);
      setScanReview(data.reviewed_result || data.result || emptyScanResult);
    } catch (error) {
      showToast(getApiErrorMessage(error, "Unable to reopen this scan."), "error");
    }
  };

  const retryScan = async (scan: FinancialScan) => {
    try {
      const { data } = await apiClient.post(`${FINANCIAL_API}/scans/${scan.id}/retry`);
      setActiveScan(data);
      setScans((current) => [data, ...current.filter((item) => item.id !== data.id)]);
      showToast("Scan retry queued.", "info");
    } catch (error) {
      showToast(getApiErrorMessage(error, "Unable to retry this scan."), "error");
    }
  };

  const confirmScan = async () => {
    if (!activeScan || activeScan.status !== "COMPLETED") return;
    setScanConfirming(true);
    try {
      await apiClient.put(`${FINANCIAL_API}/scans/${activeScan.id}/review`, { result: scanReview });
      const { data } = await apiClient.post(
        `${FINANCIAL_API}/scans/${activeScan.id}/confirm`,
        { result: scanReview }
      );
      const confirmed = { ...activeScan, status: "CONFIRMED" as const, confirmed_bill_id: data.id, reviewed_result: scanReview };
      setActiveScan(confirmed);
      setScans((current) => current.map((scan) => scan.id === confirmed.id ? confirmed : scan));
      showToast("Reviewed vendor bill confirmed and saved to financial records.", "success");
    } catch (error) {
      showToast(getApiErrorMessage(error, "Unable to confirm this vendor bill."), "error");
    } finally {
      setScanConfirming(false);
    }
  };

  const updateScanLineItem = (
    index: number,
    field: keyof FinancialScanResult["line_items"][number],
    value: string
  ) => {
    setScanReview((current) => ({
      ...current,
      line_items: current.line_items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (field === "description") return { ...item, description: value || null };
        return { ...item, [field]: value === "" ? null : Number(value) };
      }),
    }));
  };

  const scanStatusLabel = (scan: FinancialScan) =>
    scan.status === "COMPLETED" ? "Ready to review" :
      scan.status === "CONFIRMED" ? "Confirmed" :
        scan.status === "FAILED" ? "Failed" :
          scan.status === "PROCESSING" ? "Processing" : "Queued";

  // Close plus dropdown menu when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setIsPlusMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPlusMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Smart placement for the plus menu
  const handleTogglePlusMenu = () => {
    if (!isPlusMenuOpen && plusButtonRef.current) {
      const rect = plusButtonRef.current.getBoundingClientRect();
      // If there is >= 160px available above the button, position above to avoid overlapping cards below
      if (rect.top >= 160) {
        setMenuPlacement("top");
      } else {
        setMenuPlacement("bottom");
      }
    }
    setIsPlusMenuOpen((prev) => !prev);
  };

  // Sync camera stream to video tag
  useEffect(() => {
    if (showCameraModal && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch(() => {});
    }
  }, [showCameraModal, cameraStream]);

  // Clean up the camera stream when it changes or the component unmounts.
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (!recognition) return;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {}
    };
  }, []);

  const clearInvoiceSearch = () => {
    searchRequestIdRef.current += 1;
    setSearchQuery("");
    setExecutedSearchQuery("");
    setHasSearched(false);
    setSearchResults([]);
    setSearchLoading(false);
    setSearchError(null);
  };

  // Synchronize selector changes with tabs if user clicks
  const handleSelectorChange = (optionId: "create" | "scan") => {
    const nextTab = optionId === "create" ? "create-invoice" : "scan-invoice";
    if (activeTabRef.current !== nextTab) clearInvoiceSearch();
    activeTabRef.current = nextTab;
    setSelectedOption(optionId);
    setActiveTab(nextTab);
  };

  const handleTabChange = (tabId: string) => {
    if (activeTabRef.current !== tabId) clearInvoiceSearch();
    activeTabRef.current = tabId;
    setActiveTab(tabId);
    setSelectedOption(tabId === "scan-invoice" ? "scan" : "create");
  };

  const openSavedInvoice = (invoice: FinancialInvoice) => {
    setInvoiceForm({
      clientName: invoice.client_name,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      taxRate: String(invoice.tax_rate),
      notes: invoice.payment_terms_notes,
    });
    setInvoiceItems(invoice.line_items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: String(item.unit_price),
    })));
    setGeneratedInvoiceNumber(invoice.invoice_number);
    setActiveInvoiceId(invoice.id);
    setIsViewingGeneratedInvoice(invoice.status === "GENERATED");
    setInvoiceListView(invoice.status === "DRAFT" ? "drafts" : "generated");
    setSubmitAttempted(false);
    handleSelectorChange("create");
  };

  const generateSavedInvoice = async (invoice: FinancialInvoice) => {
    if (invoiceMutationLockRef.current || invoice.status !== "DRAFT") return;
    invoiceMutationLockRef.current = true;
    setInvoiceMutationId(invoice.id);
    setInvoiceMutationKind("generate");
    try {
      const { data } = await apiClient.put(`${FINANCIAL_API}/invoices/${invoice.id}`, {
        client_name: invoice.client_name,
        issue_date: invoice.issue_date,
        due_date: invoice.due_date,
        payment_terms_notes: invoice.payment_terms_notes,
        tax_rate: invoice.tax_rate,
        line_items: invoice.line_items.map(({ description, quantity, unit_price }) => ({
          description,
          quantity,
          unit_price,
        })),
        action: "generate",
      });
      const savedInvoice: FinancialInvoice | undefined = data?.invoice || data;
      if (!savedInvoice?.id || !savedInvoice.invoice_number || savedInvoice.status !== "GENERATED") {
        throw new Error("Invoice generation response did not include the persisted generated invoice.");
      }
      setInvoices((current) => [
        savedInvoice,
        ...current.filter((currentInvoice) => currentInvoice.id !== savedInvoice.id),
      ]);
      setInvoiceListView("generated");
      setViewingInvoice(savedInvoice);
      showToast(`Invoice ${savedInvoice.invoice_number} generated.`, "success");
      void refreshDashboard();
      void refreshInvoices();
    } catch (error) {
      showToast(getApiErrorMessage(error, "Unable to generate this invoice."), "error");
    } finally {
      invoiceMutationLockRef.current = false;
      setInvoiceMutationId(null);
      setInvoiceMutationKind(null);
    }
  };

  const deleteInvoice = async (invoice: FinancialInvoice) => {
    if (invoice.status !== "DRAFT") return;
    if (!window.confirm(`Delete draft ${invoice.invoice_number} for ${invoice.client_name}? This cannot be undone.`)) return;
    if (invoiceMutationLockRef.current) return;
    invoiceMutationLockRef.current = true;
    setInvoiceMutationId(invoice.id);
    setInvoiceMutationKind("delete");
    try {
      await apiClient.delete(`${FINANCIAL_API}/invoices/${invoice.id}`);
      setInvoices((current) => current.filter((currentInvoice) => currentInvoice.id !== invoice.id));
      setViewingInvoice((current) => current?.id === invoice.id ? null : current);
      showToast(`Draft ${invoice.invoice_number} deleted.`, "success");
      void refreshDashboard();
    } catch (error) {
      showToast(getApiErrorMessage(error, "Unable to delete this invoice draft."), "error");
    } finally {
      invoiceMutationLockRef.current = false;
      setInvoiceMutationId(null);
      setInvoiceMutationKind(null);
    }
  };

  const downloadInvoicePdf = async (invoice: FinancialInvoice) => {
    if (pdfDownloadLockRef.current || invoice.status !== "GENERATED") return;
    pdfDownloadLockRef.current = true;
    setDownloadingInvoiceId(invoice.id);
    try {
      const pdf = await createInvoicePdf(
        invoice,
        invoiceCompanyDetails,
        savedSettingsValues?.tax_identifier || "",
      );
      const safeInvoiceNumber = invoice.invoice_number.replace(/[^\w.-]+/g, "-");
      const downloadUrl = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${safeInvoiceNumber || "invoice"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      showToast(`Downloaded ${link.download}.`, "success");
    } catch (error) {
      showToast(
        getApiErrorMessage(error, "Unable to create or download this invoice PDF."),
        "error",
      );
    } finally {
      pdfDownloadLockRef.current = false;
      setDownloadingInvoiceId(null);
    }
  };

  const printInvoice = (invoice: FinancialInvoice) => {
    if (invoice.status !== "GENERATED") return;
    setViewingInvoice(invoice);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });
  };

  // File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const isValid = SUPPORTED_DOCUMENT_EXTENSIONS.includes(extension);

    if (!isValid) {
      showToast(
        "Invalid file type. Please select a supported document (PDF, DOCX, XLSX, CSV, or image).",
        "error"
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const sizeFormatted =
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${Math.round(file.size / 1024)} KB`;

    setAttachedFile({
      name: file.name,
      size: sizeFormatted,
      type: file.type || extension.toUpperCase(),
      source: "upload",
    });

    setIsPlusMenuOpen(false);

    if (activeTabRef.current === "scan-invoice") {
      void uploadScan(file);
    } else {
      showToast(`Selected locally: ${file.name} (${sizeFormatted}).`, "info");
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Choose Photo Handler
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Invalid file. Please select a valid photo or image file.", "error");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    const sizeFormatted = `${Math.round(file.size / 1024)} KB`;
    setAttachedFile({
      name: file.name,
      size: sizeFormatted,
      type: "Photo Image",
      source: "photo",
    });

    setIsPlusMenuOpen(false);

    if (activeTabRef.current === "scan-invoice") {
      void uploadScan(file);
    } else {
      showToast(`Photo selected locally: ${file.name}.`, "info");
    }

    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  // Trigger Take Photo: Checks camera support & permissions
  const triggerTakePhoto = async () => {
    setIsPlusMenuOpen(false);

    if (
      typeof window !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    ) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        setCameraStream(stream);
        setShowCameraModal(true);
        return;
      } catch (err: any) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          showToast(
            "Camera permission was denied. Please allow camera permissions in browser settings.",
            "error"
          );
          return;
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          showToast("No camera device found on this system. Opening image selector instead.", "info");
          cameraInputRef.current?.click();
          return;
        }
        // Fallback to native capture input
        cameraInputRef.current?.click();
      }
    } else {
      // Browser does not support getUserMedia or is in insecure context
      cameraInputRef.current?.click();
    }
  };

  // Native camera input fallback
  const handleCameraCaptureFallback = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeFormatted = `${Math.round(file.size / 1024)} KB`;
    const capturedFile = file.name
      ? file
      : new File([file], "Captured_Document_Photo.jpg", { type: file.type || "image/jpeg" });
    setAttachedFile({
      name: capturedFile.name,
      size: sizeFormatted,
      type: "Camera Capture",
      source: "camera",
    });

    if (activeTabRef.current === "scan-invoice") {
      void uploadScan(capturedFile);
    } else {
      showToast("Document photo selected.", "info");
    }
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  // Capture Frame from Live Camera Stream
  const capturePhotoFromStream = () => {
    if (!videoRef.current) return;
    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            showToast("The camera image could not be encoded. Please try again.", "error");
            closeCameraModal();
            return;
          }
          const filename = `Document_Scan_${new Date().toISOString().slice(0, 10)}.jpg`;
          const capturedFile = new File([blob], filename, { type: "image/jpeg" });
          setAttachedFile({
            name: filename,
            size: `${(capturedFile.size / 1024).toFixed(0)} KB`,
            type: "Camera Capture (HD)",
            source: "camera",
          });
          closeCameraModal();
          if (activeTabRef.current === "scan-invoice") {
            void uploadScan(capturedFile);
          } else {
            showToast("Document photo selected.", "info");
          }
        }, "image/jpeg", 0.92);
      }
    } catch (e) {
      showToast("Error capturing photo from camera.", "error");
      closeCameraModal();
    }
  };

  const closeCameraModal = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    setShowCameraModal(false);
  };

  // Speech Recognition / Voice Input
  const toggleListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        showToast("Unable to stop speech recognition. Please try again.", "error");
      }
      return;
    }

    const SpeechRecognition =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognition) {
      showToast(
        "Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari, or enter text manually.",
        "error"
      );
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setSearchQuery(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        if (event.error === "not-allowed" || event.error === "permission-denied") {
          showToast(
            "Microphone permission denied. Please allow microphone access in your browser settings.",
            "error"
          );
        } else if (event.error === "no-speech") {
          showToast("No speech was detected. Please try speaking again.", "info");
        } else if (event.error !== "aborted") {
          showToast(`Speech recognition issue: ${event.error}`, "error");
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      showToast("Unable to start speech recognition. Please check your browser microphone settings.", "error");
    }
  };

  // Search execution
  const executeSearch = async () => {
    const query = searchQuery.trim();
    const requestId = ++searchRequestIdRef.current;
    setExecutedSearchQuery(query);
    setHasSearched(true);
    setSearchLoading(true);
    setSearchError(null);
    try {
      const { data } = await apiClient.get(`${FINANCIAL_API}/dashboard`, {
        params: { search: query },
      });
      if (requestId === searchRequestIdRef.current) {
        setSearchResults(
          (data.records || []).filter((record: FinancialRecord) => record.type === "INVOICE"),
        );
      }
    } catch (error) {
      if (requestId === searchRequestIdRef.current) {
        setSearchResults([]);
        const message = getApiErrorMessage(error, "Unable to search invoices.");
        setSearchError(message);
        showToast(message, "error");
      }
    } finally {
      if (requestId === searchRequestIdRef.current) setSearchLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeSearch();
    }
  };

  // Invoice calculations
  const invoiceSubtotal = useMemo(() => {
    return invoiceItems.reduce((acc, item) => {
      const q = parseQuantity(item.quantity);
      const r = parseRate(item.unitPrice);
      if (q !== null && r !== null) {
        return acc + q * r;
      }
      return acc;
    }, 0);
  }, [invoiceItems]);

  const numericTaxRate = useMemo(() => parseTaxRate(invoiceForm.taxRate), [invoiceForm.taxRate]);
  const invoiceTaxAmount = useMemo(() => (invoiceSubtotal * numericTaxRate) / 100, [invoiceSubtotal, numericTaxRate]);
  const invoiceGrandTotal = useMemo(() => invoiceSubtotal + invoiceTaxAmount, [invoiceSubtotal, invoiceTaxAmount]);
  const invoiceCompanyAddress = [
    invoiceCompanyDetails?.registered_address || invoiceCompanyDetails?.address,
    [invoiceCompanyDetails?.city, invoiceCompanyDetails?.state, invoiceCompanyDetails?.pincode]
      .filter(Boolean)
      .join(", "),
  ].filter(Boolean);

  return (
    <AgentLayout
      config={financialConfig}
      activeTab={activeTab}
      setActiveTab={handleTabChange}
    >
      {/* Toast Notification Container */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs font-semibold shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-3 ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/90 dark:text-emerald-200"
              : toast.type === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/90 dark:text-rose-200"
              : "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/90 dark:text-indigo-200"
          }`}
        >
          {toast.type === "success" && <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />}
          {toast.type === "error" && <AlertCircle size={16} className="text-rose-600 dark:text-rose-400 shrink-0" />}
          {toast.type === "info" && <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {viewingInvoice && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-preview-title"
            className="w-full max-w-4xl overflow-hidden rounded-2xl bg-slate-100 shadow-2xl dark:bg-slate-950"
          >
            <div className="financial-invoice-modal-controls flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <div>
                <h2 id="invoice-preview-title" className="text-sm font-bold text-slate-900 dark:text-white">
                  {viewingInvoice.status === "DRAFT" ? "Draft Preview" : "Invoice Document"}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {viewingInvoice.status === "DRAFT"
                    ? "Showing saved draft data. Generate the invoice before printing or downloading."
                    : "Showing persisted invoice data. Preview does not change or regenerate the invoice."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {viewingInvoice.status === "GENERATED" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void downloadInvoicePdf(viewingInvoice)}
                      disabled={downloadingInvoiceId !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      <Download size={14} />
                      {downloadingInvoiceId === viewingInvoice.id ? "Preparing PDF…" : "Download PDF"}
                    </button>
                    <button
                      type="button"
                      onClick={() => printInvoice(viewingInvoice)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Printer size={14} />
                      Print
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setViewingInvoice(null)}
                  aria-label="Close invoice preview"
                  className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-100px)] overflow-y-auto p-3 sm:p-6">
              <article
                id="financial-invoice-print"
                className="mx-auto max-w-[800px] bg-white p-6 text-slate-900 shadow-sm sm:p-10"
              >
                <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-indigo-600 pb-6">
                  <div>
                    {invoiceCompanyDetails?.business_name && (
                      <h3 className="text-xl font-bold tracking-tight">
                        {invoiceCompanyDetails.business_name}
                      </h3>
                    )}
                    {invoiceCompanyAddress.map((addressLine) => (
                      <p key={addressLine} className="mt-1 text-sm text-slate-600">{addressLine}</p>
                    ))}
                    {invoiceCompanyDetails?.gstin && (
                      <p className="mt-1 text-sm text-slate-600">GSTIN: {invoiceCompanyDetails.gstin}</p>
                    )}
                    {savedSettingsValues?.tax_identifier && (
                      <p className="mt-1 text-sm text-slate-600">
                        Tax ID: {savedSettingsValues.tax_identifier}
                      </p>
                    )}
                    {invoiceCompanyDetails?.company_email && (
                      <p className="mt-1 text-sm text-slate-600">{invoiceCompanyDetails.company_email}</p>
                    )}
                    {invoiceCompanyDetails?.company_phone && (
                      <p className="mt-1 text-sm text-slate-600">{invoiceCompanyDetails.company_phone}</p>
                    )}
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-3xl font-extrabold tracking-wide text-indigo-700">INVOICE</p>
                    <p className="mt-2 font-mono text-base font-bold">{viewingInvoice.invoice_number}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {viewingInvoice.status}
                    </p>
                  </div>
                </header>

                <section className="grid grid-cols-1 gap-6 py-6 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Bill To</p>
                    <p className="mt-2 text-base font-semibold">{viewingInvoice.client_name}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:justify-self-end">
                    <dt className="text-slate-500">Issue Date</dt>
                    <dd className="text-right font-medium">{formatInvoiceDate(viewingInvoice.issue_date)}</dd>
                    <dt className="text-slate-500">Due Date</dt>
                    <dd className="text-right font-medium">{formatInvoiceDate(viewingInvoice.due_date)}</dd>
                  </dl>
                </section>

                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-slate-300 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-600">
                      <th className="px-2 py-3 font-bold">Description</th>
                      <th className="px-2 py-3 text-right font-bold">Qty</th>
                      <th className="px-2 py-3 text-right font-bold">Unit Rate</th>
                      <th className="px-2 py-3 text-right font-bold">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingInvoice.line_items.map((item) => (
                      <tr key={item.id} className="border-b border-slate-200">
                        <td className="px-2 py-3">{item.description}</td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          {new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(item.quantity)}
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          {formatMoney(item.unit_price, viewingInvoice.currency)}
                        </td>
                        <td className="px-2 py-3 text-right font-medium tabular-nums">
                          {formatMoney(item.line_total, viewingInvoice.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <section className="mt-6 flex flex-col justify-between gap-6 sm:flex-row">
                  {viewingInvoice.payment_terms_notes && (
                    <div className="max-w-sm">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                        {viewingInvoice.payment_terms_notes}
                      </p>
                    </div>
                  )}
                  <dl className="w-full space-y-2 text-sm sm:ml-auto sm:max-w-xs">
                    <div className="flex justify-between gap-6">
                      <dt className="text-slate-600">Subtotal</dt>
                      <dd className="font-medium tabular-nums">
                        {formatMoney(viewingInvoice.subtotal, viewingInvoice.currency)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-6">
                      <dt className="text-slate-600">Tax ({viewingInvoice.tax_rate}%)</dt>
                      <dd className="font-medium tabular-nums">
                        {formatMoney(viewingInvoice.tax_amount, viewingInvoice.currency)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-6 border-t border-slate-300 pt-3 text-base font-bold">
                      <dt>Grand Total</dt>
                      <dd className="tabular-nums">
                        {formatMoney(viewingInvoice.total, viewingInvoice.currency)}
                      </dd>
                    </div>
                  </dl>
                </section>
                <footer className="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-500">
                  {viewingInvoice.status === "DRAFT"
                    ? "Saved invoice draft"
                    : `Invoice ${viewingInvoice.invoice_number}`}
                </footer>
              </article>
            </div>
          </section>
          <style>{`
            @media print {
              @page { size: A4; margin: 16mm; }
              body * { visibility: hidden !important; }
              #financial-invoice-print, #financial-invoice-print * { visibility: visible !important; }
              #financial-invoice-print {
                position: fixed !important;
                inset: 0 !important;
                width: 100% !important;
                max-width: none !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: visible !important;
                background: #fff !important;
                box-shadow: none !important;
                color: #111827 !important;
              }
              .financial-invoice-modal-controls { display: none !important; }
            }
          `}</style>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.svg"
        onChange={handleFileUpload}
        className="hidden"
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/jpg"
        onChange={handlePhotoSelect}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture="environment"
        onChange={handleCameraCaptureFallback}
        className="hidden"
      />

      {/* Live Camera Viewfinder Modal */}
      {showCameraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Camera size={20} className="text-indigo-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Document Camera Scanner</h3>
              </div>
              <button
                type="button"
                onClick={closeCameraModal}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="relative mt-4 overflow-hidden rounded-2xl bg-black aspect-video flex items-center justify-center border border-slate-800">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              {/* Document Alignment Frame */}
              <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-dashed border-indigo-400/60" />
              <div className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] font-semibold text-white/80 bg-slate-900/60 py-1">
                Position document or receipt within the frame
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={closeCameraModal}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={capturePhotoFromStream}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 active:scale-95 transition cursor-pointer"
              >
                <Camera size={16} />
                <span>Capture Document Photo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2 & 3: UPWARD FREED SPACE SELECTOR + COMPACT FUNCTIONAL SEARCH BAR */}
      {/* ========================================================================= */}
      <div className="relative z-30 flex flex-col items-center justify-center space-y-3 sm:space-y-5 pt-0 sm:pt-1">
        {/* Compact Segmented Control (Create Invoice / Scan Invoice) */}
        <div className="inline-flex items-center rounded-full border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur-md dark:border-slate-800/90 dark:bg-slate-900/95">
          <button
            type="button"
            onClick={() => handleSelectorChange("create")}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
              selectedOption === "create"
                ? "bg-indigo-600 text-white font-bold shadow-xs dark:bg-indigo-600"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/70"
            }`}
          >
            <FileText size={16} />
            <span>Create Invoice</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectorChange("scan")}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
              selectedOption === "scan"
                ? "bg-indigo-600 text-white font-bold shadow-xs dark:bg-indigo-600"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/70"
            }`}
          >
            <Scan size={16} />
            <span>Scan Invoice</span>
          </button>
        </div>

        {/* Compact Functional Search Bar Directly Below Selector */}
        <div className="relative z-40 mx-auto w-full max-w-2xl">
          <div className="relative flex items-center rounded-full border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur-md transition-all focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-900/95">
            {/* Left: Plus (+) Button & Dropdown Menu */}
            <div className="relative" ref={plusMenuRef}>
              <button
                ref={plusButtonRef}
                type="button"
                onClick={handleTogglePlusMenu}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-all cursor-pointer ${
                  isPlusMenuOpen
                    ? "bg-indigo-600 text-white rotate-45 shadow-md shadow-indigo-600/30"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
                }`}
                title="Add Document, Photo, or File"
                aria-label="Add Document or Photo"
              >
                <Plus size={18} />
              </button>

              {/* Plus Menu Popup */}
              {isPlusMenuOpen && (
                <div
                  className={`absolute left-0 z-50 w-60 max-w-[calc(100vw-32px)] rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 animate-in fade-in zoom-in-95 duration-150 ${
                    menuPlacement === "top"
                      ? "bottom-full mb-2.5 origin-bottom-left"
                      : "top-full mt-2.5 origin-top-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlusMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition text-left cursor-pointer"
                  >
                    <Upload size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <div>
                      <p className="font-bold">Select File</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Choose a document on this device</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={triggerTakePhoto}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition text-left cursor-pointer"
                  >
                    <Camera size={16} className="text-purple-600 dark:text-purple-400 shrink-0" />
                    <div>
                      <p className="font-bold">Take Photo</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Capture document via camera</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsPlusMenuOpen(false);
                      photoInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition text-left cursor-pointer"
                  >
                    <ImageIcon size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div>
                      <p className="font-bold">Choose Photo</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Select image from device</p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Center: Search Input */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Search invoices"
              placeholder="Search invoices..."
              className="flex-1 bg-transparent px-3 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none dark:text-white"
            />

            {/* Right: Listening Indicator + Mic + Search Action Buttons */}
            <div className="flex items-center gap-1 sm:gap-1.5 pr-1">
              {isListening && (
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400 animate-pulse">
                  <span className="h-2 w-2 rounded-full bg-red-600 animate-ping" />
                  Listening...
                </span>
              )}

              {/* Microphone Button */}
              <button
                type="button"
                onClick={toggleListening}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition cursor-pointer ${
                  isListening
                    ? "bg-red-500 text-white shadow-md shadow-red-500/30 animate-pulse"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                }`}
                title={isListening ? "Click to stop listening" : "Speak to search (Voice Input)"}
                aria-label={isListening ? "Stop voice listening" : "Start voice listening"}
              >
                {isListening ? <MicOff size={17} /> : <Mic size={17} />}
              </button>

              {/* Search Button */}
              <button
                type="button"
                onClick={executeSearch}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:scale-95 transition cursor-pointer"
                title="Execute Search"
                aria-label="Search invoices"
              >
                <Search size={16} />
              </button>
            </div>
          </div>

          {/* Attached Document Indicator Badge (if any) */}
          {attachedFile && (
            <div className="mt-2.5 flex items-center justify-between rounded-xl border border-indigo-200/90 bg-indigo-50/80 px-3.5 py-2 text-xs font-semibold text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/60 dark:text-indigo-200 animate-in fade-in">
              <div className="flex items-center gap-2 truncate">
                <FileCheck size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span className="truncate">
                  Selected on this device: <strong>{attachedFile.name}</strong> ({attachedFile.size})
                </span>
                <span className="rounded-md bg-indigo-200/60 dark:bg-indigo-900/80 px-1.5 py-0.5 text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-300">
                  {attachedFile.source}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAttachedFile(null)}
                className="ml-2 text-indigo-500 hover:text-indigo-800 dark:hover:text-white cursor-pointer"
                title="Remove attached file"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SEARCH RESULTS VIEW (when user is searching)                             */}
      {/* ========================================================================= */}
      {(hasSearched || searchLoading) && (
        <section className="space-y-4 rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Invoice Search Results ({searchResults.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {executedSearchQuery
                  ? `Invoices matching “${executedSearchQuery}”.`
                  : "Invoice search results."}
              </p>
            </div>
            <button
              type="button"
              onClick={clearInvoiceSearch}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <RefreshCw size={13} />
              <span>Reset Search</span>
            </button>
          </div>

          {searchLoading ? (
            <p className="py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
              Searching invoices…
            </p>
          ) : searchError ? (
            <p className="py-8 text-center text-sm font-semibold text-rose-600 dark:text-rose-400">
              {searchError}
            </p>
          ) : searchResults.length === 0 ? (
            <div className="py-12 text-center">
              <Search className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                No matching invoices found.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Try searching by invoice number or client name.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 overflow-x-auto dark:divide-slate-800">
              {searchResults.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 rounded-xl px-2 transition"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                      Invoice
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        {item.title}
                      </h4>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{item.entity}</span>
                        <span>•</span>
                        <span className="font-mono">{item.reference}</span>
                        <span>•</span>
                        <span>{item.category}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4">
                    {item.amount !== null && (
                      <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                        {formatMoney(item.amount, item.currency || operatingCurrency)}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        ["paid", "completed", "passed", "active", "generated"].includes(item.status.toLowerCase())
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : ["pending", "draft"].includes(item.status.toLowerCase())
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ========================================================================= */}
      {/* SECTION 4: MAIN FINANCIAL FUNCTIONALITY TABS                              */}
      {/* ========================================================================= */}

      {/* VIEW: DASHBOARD OVERVIEW */}
      {activeTab === "dashboard" && (
        <div className="space-y-6 sm:space-y-8 mt-3 sm:mt-6 md:mt-8 lg:mt-10">
          {dashboardError && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              {dashboardError}
            </p>
          )}
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Total Invoiced
                </span>
                <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                  <FileText size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">
                {dashboardLoading
                  ? "Loading…"
                  : dashboardSummary?.total_invoiced_has_multiple_currencies
                    ? "Multiple currencies"
                    : dashboardSummary?.total_invoiced != null
                      ? formatMoney(
                        dashboardSummary.total_invoiced,
                        dashboardSummary.total_invoiced_currency || operatingCurrency,
                      )
                      : "—"}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                {dashboardSummary?.total_invoiced_has_multiple_currencies
                  ? "Amounts are not combined across currencies"
                  : dashboardSummary?.total_invoiced_currency
                    ? `Generated invoices · ${dashboardSummary.total_invoiced_currency}`
                    : `Generated invoices · ${operatingCurrency}`}
              </p>
            </div>

            <Link href="/financial/receivables" className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm transition hover:border-amber-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/95 dark:hover:border-amber-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pending Receivables
                </span>
                <span className="rounded-lg bg-amber-50 p-2 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                  <Clock size={18} />
                </span>
              </div>
              <div className="mt-3 min-h-8 text-lg font-bold text-slate-900 dark:text-white font-mono">
                {dashboardLoading
                  ? "Loading…"
                  : dashboardError || !dashboardSummary
                    ? "Unavailable"
                  : dashboardSummary?.pending_receivables_by_currency?.length
                    ? dashboardSummary.pending_receivables_by_currency.map((entry) => (
                      <span key={entry.currency} className="mr-3 inline-block">
                        {formatMoney(entry.amount, entry.currency)}
                      </span>
                    ))
                    : "No outstanding balance"}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                {dashboardLoading
                  ? "Loading invoice count…"
                  : dashboardError || !dashboardSummary
                    ? "Receivables data unavailable"
                    : `${dashboardSummary.pending_receivable_count ?? 0} invoices outstanding`}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                {dashboardSummary?.receivables_as_of_date
                  ? `As of ${formatInvoiceDate(dashboardSummary.receivables_as_of_date)} · View receivables`
                  : "View receivables"}
              </p>
            </Link>

            <Link href="/financial/audits" className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm transition hover:border-cyan-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/95 dark:hover:border-cyan-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Audit Summary
                </span>
                <span className="rounded-lg bg-cyan-50 p-2 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
                  <ShieldCheck size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">
                {dashboardLoading
                  ? "Loading…"
                  : dashboardError || !dashboardSummary
                    ? "Unavailable"
                    : dashboardSummary.total_audit_runs ?? "—"}
              </p>
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Automated audit runs</p>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-[11px] dark:border-slate-800">
                <p className="text-slate-600 dark:text-slate-300">
                  Pass rate <span className="font-bold text-slate-900 dark:text-white">
                    {dashboardLoading ? "…" : dashboardError || !dashboardSummary ? "Unavailable" : latestAuditPassRate == null ? "—" : `${latestAuditPassRate.toFixed(1)}%`}
                  </span>
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  Failed checks <span className="font-bold text-slate-900 dark:text-white">
                    {dashboardLoading ? "…" : dashboardError || !dashboardSummary ? "Unavailable" : dashboardSummary.latest_audit_run_id ? dashboardSummary.latest_audit_failed_checks ?? "—" : "—"}
                  </span>
                </p>
              </div>
              <p className="mt-2 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                {dashboardLoading
                  ? "Loading latest run…"
                  : dashboardError || !dashboardSummary
                    ? "Audit data unavailable"
                    : dashboardSummary.latest_audit_started_at
                      ? `Last run ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dashboardSummary.latest_audit_started_at))} · ${dashboardSummary.latest_audit_run_status ?? "Status unavailable"}`
                      : "No audit runs yet"}
              </p>
              <p className="mt-1 text-[10px] font-bold text-cyan-700 dark:text-cyan-300">View audit history</p>
            </Link>

            <Link href="/financial/vendors" className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm transition hover:border-emerald-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/95 dark:hover:border-emerald-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Active Vendors
                </span>
                <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <Building2 size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">
                {dashboardLoading
                  ? "Loading…"
                  : dashboardError || !dashboardSummary
                    ? "Unavailable"
                    : dashboardSummary.active_vendors ?? 0}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                {dashboardError || !dashboardSummary
                  ? "Vendor count unavailable"
                  : "Active records · Manage vendors"}
              </p>
            </Link>
          </div>

          {/* Recent Invoices & Activity Table */}
          <div className="rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {invoiceListView === "drafts" ? "Saved Drafts" : "Generated Invoices"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {invoiceListView === "drafts"
                    ? "Continue editing drafts saved to your financial account."
                    : "View invoices generated from your financial account."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (generatedInvoiceNumber) {
                    resetInvoiceForm();
                  }
                  handleSelectorChange("create");
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-700 transition cursor-pointer"
              >
                <Plus size={14} />
                <span>New Invoice</span>
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Invoice status">
              {(["drafts", "generated"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={invoiceListView === view}
                  onClick={() => setInvoiceListView(view)}
                  className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                    invoiceListView === view
                      ? "bg-indigo-600 text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  {view === "drafts" ? "Saved Drafts" : "Generated Invoices"}
                  <span className="ml-2 opacity-75">
                    {invoices.filter((invoice) => invoice.status === (view === "drafts" ? "DRAFT" : "GENERATED")).length}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 divide-y divide-slate-100 overflow-x-auto dark:divide-slate-800">
              {invoicesLoading ? (
                <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading invoices…</p>
              ) : invoicesError ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-rose-600 dark:text-rose-400">{invoicesError}</p>
                  <button
                    type="button"
                    onClick={() => void refreshInvoices()}
                    className="mt-3 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  >
                    Retry loading invoices
                  </button>
                </div>
              ) : invoices.filter((invoice) => invoice.status === (invoiceListView === "drafts" ? "DRAFT" : "GENERATED")).length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  {invoiceListView === "drafts" ? "No saved drafts yet." : "No generated invoices yet."}
                </p>
              ) : invoices.filter((invoice) => invoice.status === (invoiceListView === "drafts" ? "DRAFT" : "GENERATED")).map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-col gap-3 py-3.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 rounded-xl px-2 transition sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      <FileText size={18} />
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">{inv.client_name}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{inv.invoice_number}</span> • {inv.issue_date}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                    <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                      {formatMoney(inv.total, inv.currency)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        inv.status === "GENERATED"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : inv.status === "DRAFT"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                      }`}
                    >
                      {inv.status}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setViewingInvoice(inv)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Eye size={14} />
                        View Invoice
                      </button>
                      {inv.status === "DRAFT" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openSavedInvoice(inv)}
                            disabled={isSavingInvoice || invoiceMutationId !== null}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            Continue Editing
                          </button>
                          <button
                            type="button"
                            onClick={() => void generateSavedInvoice(inv)}
                            disabled={isSavingInvoice || invoiceMutationId !== null}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {invoiceMutationId === inv.id && invoiceMutationKind === "generate"
                              ? "Generating…"
                              : "Generate Invoice"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteInvoice(inv)}
                            disabled={isSavingInvoice || invoiceMutationId !== null}
                            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                          >
                            {invoiceMutationId === inv.id && invoiceMutationKind === "delete"
                              ? "Deleting…"
                              : "Delete"}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void downloadInvoicePdf(inv)}
                            disabled={downloadingInvoiceId !== null}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Download size={14} />
                            {downloadingInvoiceId === inv.id ? "Preparing PDF…" : "Download PDF"}
                          </button>
                          <button
                            type="button"
                            onClick={() => printInvoice(inv)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Printer size={14} />
                            Print
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: CREATE INVOICE */}
      {activeTab === "create-invoice" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-4 sm:p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 mt-3 sm:mt-6 md:mt-8 lg:mt-10 pb-6 sm:pb-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 dark:border-slate-800">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                <FileText size={14} />
                <span>INVOICE GENERATOR</span>
              </div>
              <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
                {isViewingGeneratedInvoice ? "View Generated Invoice" : activeInvoiceId ? "Continue Editing Draft" : "Create Industrial Invoice"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create invoices for supply chain, machinery, and services.
              </p>
            </div>

            {generatedInvoiceNumber && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <CheckCircle2 size={14} />
                  <span>
                    {isViewingGeneratedInvoice
                      ? `Viewing generated invoice ${generatedInvoiceNumber}`
                      : activeInvoiceId
                        ? `Editing draft ${generatedInvoiceNumber}`
                        : `Invoice ${generatedInvoiceNumber} saved`}
                  </span>
                </span>
                {isViewingGeneratedInvoice ? (
                  <button
                    type="button"
                    onClick={() => handleTabChange("dashboard")}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
                  >
                    Back to Invoices
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={resetInvoiceForm}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
                  >
                    Create Another
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Invoice Header Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Invoice Number
              </label>
              <input
                type="text"
                value={generatedInvoiceNumber || ""}
                placeholder="Generated automatically"
                readOnly
                tabIndex={-1}
                aria-label="Invoice number generated automatically"
                className="w-full rounded-xl border border-slate-200 bg-slate-100/70 px-3.5 py-2.5 text-xs sm:text-sm font-mono font-medium text-slate-600 outline-none select-none dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 cursor-not-allowed"
              />
            </div>

            <div className="lg:col-span-3">
              <label htmlFor="client-name" className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Client / Company Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="client-name"
                type="text"
                placeholder="e.g. Apex Digital"
                value={invoiceForm.clientName}
                disabled={isViewingGeneratedInvoice}
                onChange={(e) => setInvoiceForm((prev) => ({ ...prev, clientName: e.target.value }))}
                className={`w-full rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 outline-none transition focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-800/50 dark:text-white ${
                  submitAttempted && !invoiceForm.clientName.trim()
                    ? "border-rose-400 dark:border-rose-600 bg-rose-50/30 dark:bg-rose-950/20"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              />
              {submitAttempted && !invoiceForm.clientName.trim() && (
                <p className="mt-1 text-[11px] font-semibold text-rose-500 dark:text-rose-400">
                  Client name is required
                </p>
              )}
            </div>

            <div className="lg:col-span-2">
              <label htmlFor="issue-date" className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Issue Date <span className="text-rose-500">*</span>
              </label>
              <input
                id="issue-date"
                type="date"
                value={invoiceForm.issueDate}
                disabled={isViewingGeneratedInvoice}
                onChange={(e) => setInvoiceForm((prev) => ({ ...prev, issueDate: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-xs sm:text-sm font-medium text-slate-900 outline-none transition focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white"
              />
            </div>

            <div className="lg:col-span-2">
              <label htmlFor="due-date" className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Payment Due Date <span className="text-rose-500">*</span>
              </label>
              <input
                id="due-date"
                type="date"
                value={invoiceForm.dueDate}
                min={invoiceForm.issueDate}
                disabled={isViewingGeneratedInvoice}
                onChange={(e) => setInvoiceForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                className={`w-full rounded-xl border bg-slate-50/50 px-3 py-2.5 text-xs sm:text-sm font-medium text-slate-900 outline-none transition focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-800/50 dark:text-white ${
                  submitAttempted && invoiceForm.dueDate < invoiceForm.issueDate
                    ? "border-rose-400 dark:border-rose-600 bg-rose-50/30 dark:bg-rose-950/20"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              />
              {submitAttempted && invoiceForm.dueDate < invoiceForm.issueDate && (
                <p className="mt-1 text-[11px] font-semibold text-rose-500 dark:text-rose-400">
                  Due date must not precede issue date
                </p>
              )}
            </div>

            <div className="lg:col-span-2">
              <label htmlFor="tax-rate" className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Tax Rate (%)
              </label>
              <input
                id="tax-rate"
                type="text"
                inputMode="decimal"
                placeholder="18"
                value={invoiceForm.taxRate}
                disabled={isViewingGeneratedInvoice}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || /^\d*\.?\d*$/.test(val)) {
                    setInvoiceForm((prev) => ({ ...prev, taxRate: val }));
                  }
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-xs sm:text-sm font-mono font-medium text-slate-900 outline-none transition focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white"
              />
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Invoice Line Items <span className="text-rose-500">*</span>
              </h3>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 shadow-xs">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="border-b border-slate-200/80 bg-slate-50/90 dark:border-slate-800 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3 w-28">Qty</th>
                    <th className="py-2.5 px-3 w-36">Rate ({currencySymbol})</th>
                    <th className="py-2.5 px-3 w-36 text-right">Amount ({currencySymbol})</th>
                    <th className="py-2.5 px-3 w-16 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {invoiceItems.map((item, index) => {
                    const rowAmount = getRowAmount(item);
                    const hasDescError = submitAttempted && !item.description.trim();
                    const hasQtyError = submitAttempted && parseQuantity(item.quantity) === null;
                    const hasRateError = submitAttempted && parseRate(item.unitPrice) === null;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            placeholder="Item description"
                            aria-label={`Line item ${index + 1} description`}
                            value={item.description}
                            disabled={isViewingGeneratedInvoice}
                            onChange={(e) => handleDescriptionChange(item.id, e.target.value)}
                            className={`w-full rounded-lg border bg-slate-50/50 px-3 py-2 text-xs sm:text-sm font-medium text-slate-900 outline-none transition focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-800/50 dark:text-white ${
                              hasDescError
                                ? "border-rose-400 dark:border-rose-600 bg-rose-50/30 dark:bg-rose-950/20"
                                : "border-slate-200 dark:border-slate-700"
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="Qty"
                            aria-label={`Line item ${index + 1} quantity`}
                            value={item.quantity}
                            disabled={isViewingGeneratedInvoice}
                            onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                            className={`w-full rounded-lg border bg-slate-50/50 px-3 py-2 text-xs sm:text-sm font-mono font-medium text-slate-900 outline-none transition focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-800/50 dark:text-white ${
                              hasQtyError
                                ? "border-rose-400 dark:border-rose-600 bg-rose-50/30 dark:bg-rose-950/20"
                                : "border-slate-200 dark:border-slate-700"
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder={`Rate (${currencySymbol})`}
                            aria-label={`Line item ${index + 1} unit rate`}
                            value={item.unitPrice}
                            disabled={isViewingGeneratedInvoice}
                            onChange={(e) => handleRateChange(item.id, e.target.value)}
                            className={`w-full rounded-lg border bg-slate-50/50 px-3 py-2 text-xs sm:text-sm font-mono font-medium text-slate-900 outline-none transition focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-800/50 dark:text-white ${
                              hasRateError
                                ? "border-rose-400 dark:border-rose-600 bg-rose-50/30 dark:bg-rose-950/20"
                                : "border-slate-200 dark:border-slate-700"
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 dark:text-white">
                          {formatMoney(rowAmount, invoiceFormCurrency)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => removeLineItem(item.id)}
                            aria-label={`Remove line item ${index + 1}`}
                            title={invoiceItems.length <= 1 ? "Clear row" : "Remove item"}
                            disabled={isViewingGeneratedInvoice || (invoiceItems.length <= 1 && !item.description && !item.quantity && !item.unitPrice)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* + Add item directly beneath the rows */}
            <div className="pt-1">
              <button
                type="button"
                onClick={addLineItem}
                disabled={isViewingGeneratedInvoice}
                className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-400 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/60 transition cursor-pointer"
              >
                <Plus size={14} />
                <span>Add item</span>
              </button>
            </div>
          </div>

          {/* Payment Terms & Notes and Summary */}
          <div className="flex flex-col sm:flex-row justify-between gap-6 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="max-w-md w-full">
              <label htmlFor="payment-notes" className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Payment Terms & Notes
              </label>
              <textarea
                id="payment-notes"
                rows={3}
                placeholder="Payment due within 15 days"
                value={invoiceForm.notes}
                disabled={isViewingGeneratedInvoice}
                onChange={(e) => setInvoiceForm((prev) => ({ ...prev, notes: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-800 outline-none transition focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200"
              />
            </div>

            <div className="w-full sm:w-80 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/50 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Subtotal:</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white">
                  {formatMoney(invoiceSubtotal, invoiceFormCurrency)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Tax ({numericTaxRate}%):</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white">
                  {formatMoney(invoiceTaxAmount, invoiceFormCurrency)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900 dark:border-slate-700 dark:text-white">
                <span>Grand Total:</span>
                <span className="font-mono text-indigo-600 dark:text-indigo-400">
                  {formatMoney(invoiceGrandTotal, invoiceFormCurrency)}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1">
                Preview only; the server recomputes invoice totals when saved.
              </p>
            </div>
          </div>

          {/* Sticky Bottom Action Bar */}
          <div className="sticky bottom-0 z-20 -mx-4 -mb-4 sm:-mx-6 sm:-mb-6 sm:-mx-8 sm:-mb-8 mt-6 border-t border-slate-200/80 bg-white/95 dark:border-slate-800 dark:bg-slate-900/95 backdrop-blur-md px-4 py-3.5 sm:px-8 rounded-b-3xl shadow-lg">
            {isViewingGeneratedInvoice ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span>Generated invoices are read-only.</span>
                <button
                  type="button"
                  onClick={() => handleTabChange("dashboard")}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Back to Invoices
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs">
                  {submitAttempted && (
                    !invoiceForm.clientName.trim() ||
                    !invoiceForm.issueDate ||
                    !invoiceForm.dueDate ||
                    invoiceForm.dueDate < invoiceForm.issueDate ||
                    invoiceItems.some(
                      (it) =>
                        !it.description.trim() ||
                        parseQuantity(it.quantity) === null ||
                        parseRate(it.unitPrice) === null
                    )
                  ) ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-rose-500 dark:text-rose-400">
                      <AlertCircle size={14} className="shrink-0" />
                      <span>Please complete required fields highlighted above</span>
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => void saveInvoice("save_draft")}
                    disabled={isSavingInvoice || (!activeInvoiceId && savedSettingsValues === null)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingInvoice ? "Saving…" : "Save Draft"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveInvoice("generate")}
                    disabled={isSavingInvoice || (!activeInvoiceId && savedSettingsValues === null)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-700 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingInvoice ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        <span>Generate Invoice</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW: SCAN INVOICE */}
      {activeTab === "scan-invoice" && (
        <div className="space-y-3.5 sm:space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-3.5 sm:p-6 lg:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 mt-3 sm:mt-6 md:mt-8 lg:mt-10">
          <div className="border-b border-slate-100 pb-2.5 sm:pb-4 dark:border-slate-800">
            <div className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full bg-purple-50 px-2.5 py-0.5 sm:px-3 sm:py-1 text-[10px] sm:text-xs font-bold text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
              <Scan size={13} className="sm:w-3.5 sm:h-3.5" />
              <span>SCAN SERVICE</span>
            </div>
            <h2 className="mt-1 sm:mt-2 text-sm sm:text-xl font-bold text-slate-900 dark:text-white">
              Scan & Process Vendor Bills
            </h2>
            <p className="mt-0.5 text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
              Upload a vendor bill or capture it with your camera. Extracted values remain a draft until you review and confirm.
            </p>
          </div>

          {!settingsLoading && !settingsError && !financialSettings.document_processing_configured && (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              Invoice extraction is not configured, so processing cannot complete until an administrator configures the provider. Uploads may be retried afterward if private storage is available.
            </p>
          )}
          {settingsError && (
            <p role="status" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Document-processing availability could not be checked. The server will enforce the upload limit.
            </p>
          )}

          {/* Document Dropzone & Capture Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-5">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-3 sm:p-6 lg:p-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/30 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-indigo-500 cursor-pointer"
            >
              <div className="rounded-full bg-indigo-50 p-1.5 sm:p-3 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                <Upload size={16} className="sm:w-6 sm:h-6" />
              </div>
              <h4 className="mt-1 sm:mt-3 text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                Select Invoice File
              </h4>
              <p className="mt-0.5 text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
                PDF, DOCX, XLSX, CSV, PNG, JPG, JPEG, WEBP, or SVG (up to {Math.floor(financialSettings.document_processing_upload_limit_bytes / (1024 * 1024))} MB)
              </p>
              <button
                type="button"
                className="mt-1.5 sm:mt-4 rounded-lg sm:rounded-xl bg-slate-200/70 px-3 py-1 sm:px-4 sm:py-1.5 text-[10px] sm:text-xs font-semibold sm:font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 transition"
              >
                Browse Document
              </button>
            </div>

            <div
              onClick={triggerTakePhoto}
              className="group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-3 sm:p-6 lg:p-8 text-center transition hover:border-purple-400 hover:bg-purple-50/30 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-purple-500 cursor-pointer"
            >
              <div className="rounded-full bg-purple-50 p-1.5 sm:p-3 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400 group-hover:scale-110 transition-transform">
                <Camera size={16} className="sm:w-6 sm:h-6" />
              </div>
              <h4 className="mt-1 sm:mt-3 text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                Capture via Camera
              </h4>
              <p className="mt-0.5 text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">
                Take a direct photo of physical bills or receipts
              </p>
              <button
                type="button"
                className="mt-1.5 sm:mt-4 rounded-lg sm:rounded-xl bg-slate-200/70 px-3 py-1 sm:px-4 sm:py-1.5 text-[10px] sm:text-xs font-semibold sm:font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200 hover:bg-purple-600 hover:text-white dark:hover:bg-purple-600 transition"
              >
                Open Camera
              </button>
            </div>
          </div>

          {scanSubmitting && (
            <div className="space-y-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/60 dark:text-indigo-300">
              <div className="flex items-center justify-between gap-3 text-xs font-bold">
                <span className="inline-flex items-center gap-2"><RefreshCw size={15} className="animate-spin" /> Uploading private document…</span>
                <span>{scanUploadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-900/70">
                <div className="h-full bg-indigo-600 transition-all" style={{ width: `${scanUploadProgress}%` }} />
              </div>
            </div>
          )}
          {scansError && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              <span>{scansError}</span>
              <button type="button" onClick={() => void refreshScans()} className="font-bold underline">Retry history</button>
            </div>
          )}

          {activeScan && (
            <section className="space-y-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700" aria-live="polite">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-all text-sm font-bold text-slate-900 dark:text-white">{activeScan.original_filename}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {scanStatusLabel(activeScan)} · {activeScan.progress}% · {(activeScan.file_size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
                {activeScan.retryable && ["FAILED", "QUEUED", "PROCESSING"].includes(activeScan.status) && (
                  <button type="button" onClick={() => void retryScan(activeScan)} disabled={scanSubmitting}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40">
                    <RefreshCw size={14} /> {activeScan.status === "QUEUED" ? "Restart queued scan" : "Retry processing"}
                  </button>
                )}
              </div>
              {(activeScan.status === "QUEUED" || activeScan.status === "PROCESSING") && (
                <div className="space-y-2">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full bg-indigo-600 transition-all" style={{ width: `${activeScan.progress}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Your scan is being processed. You can reopen it from scan history.</p>
                </div>
              )}
              {activeScan.error_code && activeScan.status === "FAILED" && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                  {getApiErrorMessage({ response: { data: { detail: activeScan.error_code } } }, "The document could not be processed.")}
                </p>
              )}
              {(activeScan.status === "COMPLETED" || activeScan.status === "CONFIRMED") && (
                <>
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <span>Extracted values may be missing or uncertain. Review and correct them. Scanning alone never creates a financial record.</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {([
                      ["vendor_name", "Vendor name", "text"],
                      ["bill_number", "Bill / invoice number", "text"],
                      ["bill_date", "Bill date", "date"],
                      ["due_date", "Due date", "date"],
                      ["currency", "Currency", "text"],
                      ["subtotal", "Subtotal", "number"],
                      ["tax_amount", "Tax amount", "number"],
                      ["total", "Total", "number"],
                    ] as const).map(([field, label, type]) => {
                      const value = scanReview[field];
                      const confidence = activeScan.confidence[field];
                      return (
                        <label key={field} className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <span className="mb-1 flex items-center justify-between gap-2">
                            {label}
                            {confidence != null && confidence < 0.7 && (
                              <span className="font-medium text-amber-700 dark:text-amber-300">Low confidence</span>
                            )}
                            {value == null && <span className="font-medium text-slate-400">Not detected</span>}
                          </span>
                          {field === "currency" ? (
                            <select value={scanReview.currency ?? ""} disabled={activeScan.status === "CONFIRMED"}
                              onChange={(event) => setScanReview((current) => ({
                                ...current,
                                currency: event.target.value === "INR" || event.target.value === "USD" || event.target.value === "EUR"
                                  ? event.target.value
                                  : null,
                              }))}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                              <option value="">Not detected</option>
                              <option value="INR">INR</option>
                              <option value="USD">USD</option>
                              <option value="EUR">EUR</option>
                            </select>
                          ) : (
                            <input
                              type={type}
                              min={type === "number" ? "0" : undefined}
                              step={type === "number" ? "0.01" : undefined}
                              value={value ?? ""}
                              disabled={activeScan.status === "CONFIRMED"}
                              onChange={(event) => setScanReview((current) => ({
                                ...current,
                                [field]: event.target.value === ""
                                  ? null
                                  : type === "number"
                                    ? Number(event.target.value)
                                    : event.target.value,
                              }))}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        Line items {activeScan.confidence.line_items != null && activeScan.confidence.line_items < 0.7 && (
                          <span className="ml-1 font-medium normal-case text-amber-700 dark:text-amber-300">· Low confidence</span>
                        )}
                      </h4>
                      {activeScan.status === "COMPLETED" && scanReview.line_items.length < 100 && (
                        <button type="button" onClick={() => setScanReview((current) => ({
                          ...current,
                          line_items: [...current.line_items, { description: null, quantity: null, unit_rate: null, tax_amount: null, total: null }],
                        }))} className="text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">
                          Add line item
                        </button>
                      )}
                    </div>
                    {scanReview.line_items.length === 0 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">No line items were detected.</p>
                    )}
                    {scanReview.line_items.map((item, index) => (
                      <div key={index} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-5 dark:border-slate-700">
                        <input aria-label={`Line item ${index + 1} description`} placeholder="Description" value={item.description ?? ""} disabled={activeScan.status === "CONFIRMED"}
                          onChange={(event) => updateScanLineItem(index, "description", event.target.value)}
                          className="col-span-2 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs sm:col-span-1 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                        {([
                          ["quantity", "Quantity"],
                          ["unit_rate", "Unit rate"],
                          ["tax_amount", "Tax"],
                          ["total", "Line total"],
                        ] as const).map(([field, label]) => (
                          <input key={field} aria-label={`Line item ${index + 1} ${label.toLowerCase()}`} type="number" min="0" step="0.01" placeholder={label}
                            value={item[field] ?? ""} disabled={activeScan.status === "CONFIRMED"}
                            onChange={(event) => updateScanLineItem(index, field, event.target.value)}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                        ))}
                        {activeScan.status === "COMPLETED" && (
                          <button type="button" onClick={() => setScanReview((current) => ({
                            ...current,
                            line_items: current.line_items.filter((_, itemIndex) => itemIndex !== index),
                          }))} className="col-span-2 justify-self-start text-[11px] font-bold text-rose-600 hover:underline sm:col-span-5">
                            Remove line item
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {activeScan.extracted_text && (
                    <details className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
                      <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-300">View extracted document text</summary>
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-600 dark:text-slate-400">{activeScan.extracted_text}</pre>
                    </details>
                  )}
                  {activeScan.content_type === "image/svg+xml" && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      SVG processing reads embedded text only; it does not perform OCR on vector outlines.
                    </p>
                  )}
                  {activeScan.status === "COMPLETED" ? (
                    <button type="button" onClick={() => void confirmScan()} disabled={scanConfirming}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                      <Check size={15} /> {scanConfirming ? "Saving reviewed bill…" : "Confirm & add vendor bill"}
                    </button>
                  ) : (
                    <p className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 size={15} /> Vendor bill confirmed · {activeScan.confirmed_bill_id}
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          <section className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Scan history</h3>
              <button type="button" onClick={() => void refreshScans()} disabled={scansLoading}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400">
                <RefreshCw size={13} className={scansLoading ? "animate-spin" : ""} /> Refresh
              </button>
            </div>
            {scansLoading && scans.length === 0 ? (
              <p className="py-5 text-center text-xs text-slate-500 dark:text-slate-400">Loading scan history…</p>
            ) : scans.length === 0 ? (
              <p className="py-5 text-center text-xs text-slate-500 dark:text-slate-400">No scans have been submitted yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {scans.map((scan) => (
                  <div key={scan.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <button type="button" onClick={() => void openScan(scan.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-xs font-bold text-slate-800 hover:text-indigo-600 dark:text-slate-200">{scan.original_filename}</span>
                      <span className="mt-1 block text-[10px] text-slate-500 dark:text-slate-400">
                        {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(scan.created_at))}
                      </span>
                    </button>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                      scan.status === "FAILED" ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" :
                        scan.status === "CONFIRMED" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" :
                          scan.status === "COMPLETED" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" :
                            "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                    }`}>{scanStatusLabel(scan)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* VIEW: SETTINGS */}
      {activeTab === "settings" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-4 sm:p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 mt-3 sm:mt-6 md:mt-8 lg:mt-10">
          <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Financial Agent Settings</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure your saved financial preferences. Saving the reconciliation preference does not run reconciliation.
            </p>
          </div>

          {settingsLoading && (
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Loading financial settings…</p>
          )}
          {settingsError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              <p>{settingsError}</p>
              <button type="button" onClick={() => void refreshSettings()} disabled={settingsLoading}
                className="mt-2 rounded-lg border border-rose-300 px-3 py-1.5 font-bold hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800 dark:hover:bg-rose-950/60">
                Retry loading settings
              </button>
            </div>
          )}
          <div className="space-y-5 max-w-xl text-xs">
            {!settingsLoading && !settingsError && (
              <p className={`rounded-xl border px-3 py-2 font-semibold ${
                settingsDirty
                  ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
              }`}>
                {settingsDirty
                  ? "You have unsaved settings changes."
                  : financialSettings.updated_at
                    ? `All changes saved · Updated ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(financialSettings.updated_at))}`
                    : "Your settings are saved."}
              </p>
            )}
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Base Operating Currency
              </label>
              <select
                value={financialSettings.base_currency}
                disabled={settingsLoading || !!settingsError || isSavingSettings}
                onChange={(e) => setFinancialSettings({
                  ...financialSettings,
                  base_currency: e.target.value as FinancialSettings["base_currency"],
                })}
                aria-label="Base operating currency"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="INR">INR (₹) — Indian Rupee</option>
                <option value="USD">USD ($) — United States Dollar</option>
                <option value="EUR">EUR (€) — Euro</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Company Tax Identifier
              </label>
              <input
                type="text"
                value={financialSettings.tax_identifier}
                maxLength={64}
                autoComplete="off"
                disabled={settingsLoading || !!settingsError || isSavingSettings}
                onChange={(e) => {
                  setFinancialSettings({ ...financialSettings, tax_identifier: e.target.value });
                  setSettingsSaveError(null);
                }}
                aria-label="Company tax identifier"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Optional · up to 64 characters. This value is not included in audit history.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Auto-Reconcile Incoming Bills</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Preference only; automatic reconciliation is not currently configured.
                </p>
              </div>
              <input
                type="checkbox"
                checked={financialSettings.auto_reconcile_incoming_bills}
                disabled={settingsLoading || !!settingsError || isSavingSettings}
                onChange={(e) => setFinancialSettings({
                  ...financialSettings,
                  auto_reconcile_incoming_bills: e.target.checked,
                })}
                className="h-4 w-4 accent-indigo-600 cursor-pointer"
              />
            </div>

            <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
              <p className="font-bold text-slate-900 dark:text-white">Invoice Document Processing</p>
              <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                {financialSettings.document_processing_configured
                  ? "Provider configuration is present. Provider connectivity has not been tested."
                  : "Provider configuration is missing; invoice extraction is unavailable until an administrator configures it."}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Upload limit: {Math.floor(financialSettings.document_processing_upload_limit_bytes / (1024 * 1024))} MB · PDF, DOCX, XLSX, CSV, PNG, JPG, JPEG, WEBP, or SVG.
              </p>
            </div>

            {settingsSaveError && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                {settingsSaveError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={settingsLoading || !!settingsError || isSavingSettings || !settingsDirty}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingSettings ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </div>
      )}
    </AgentLayout>
  );
}
