"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileCheck,
  LoaderCircle,
  Play,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { financialConfig } from "@/components/agents/financial/financialConfig";
import apiClient from "@/lib/api";
import { getApproximateIpCountry, getSessionKey } from "@/lib/security";

type AuditResult = "PASS" | "FAIL" | "NOT_APPLICABLE";
type AuditStatus = "RUNNING" | "COMPLETED" | "FAILED";
type FilterCategory = "All" | "Financial" | "Settings" | "Invoices" | "Vendors" | "Access & Security";

interface AuditCheck {
  id: string;
  check_id: string;
  title: string;
  result: AuditResult;
  explanation: string;
  entity_type: string | null;
  entity_id: string | null;
  findings: Record<string, unknown>[];
  checked_at: string;
}

interface AuditRun {
  id: string;
  status: AuditStatus;
  started_at: string;
  completed_at: string | null;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  not_applicable_checks: number;
  pass_rate: number | null;
  summary: Record<string, unknown>;
  error_message: string | null;
  checks: AuditCheck[];
}

interface AuditRunsResponse {
  runs: AuditRun[];
}

interface FinancialAuditEvent {
  id: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE";
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AuditEventsResponse {
  audits: FinancialAuditEvent[];
}

interface SecurityActivity {
  id: string;
  event_type: "login" | "logout" | "session_revoked" | "password_changed" | string;
  description?: string | null;
  device_name?: string | null;
  browser?: string | null;
  os?: string | null;
  city?: string | null;
  country?: string | null;
  created_at: string;
}

interface AccountSecurityResponse {
  sessions: unknown[];
  activities: SecurityActivity[];
  activity_count?: number | null;
  next_cursor?: string | null;
}

interface TimelineAction {
  kind: "action";
  id: string;
  timestamp: string;
  category: "Financial" | "Settings" | "Invoices" | "Vendors" | "Access & Security";
  event: FinancialAuditEvent;
}

interface TimelineSecurity {
  kind: "security";
  id: string;
  timestamp: string;
  category: "Access & Security";
  activity: SecurityActivity;
}

interface TimelineRun {
  kind: "run";
  id: string;
  timestamp: string;
  category: "Financial";
  run: AuditRun;
  checks: AuditCheck[];
}

type TimelineEntry = TimelineAction | TimelineSecurity | TimelineRun;

interface TimelineDateGroup {
  key: string;
  label: string;
  entries: TimelineEntry[];
  actionCount: number;
  actionSuccessCount: number;
  actionFailureCount: number;
  securityCount: number;
  runCount: number;
  runPassedChecks: number;
  runFailedChecks: number;
  categoriesPresent: Set<string>;
}

const FINANCIAL_API = "/api/v1/financial";
const EMPLOYER_SECURITY_API = "/api/v1/employers/me/security";

const FILTER_CATEGORIES: FilterCategory[] = [
  "All",
  "Financial",
  "Settings",
  "Invoices",
  "Vendors",
  "Access & Security",
];

const AUDIT_ACTION_PRESENTATION: Record<string, { title: string; description: string }> = {
  INVOICE_GENERATED: { title: "Invoice Generated", description: "was generated successfully." },
  INVOICE_DRAFT_CREATED: { title: "Invoice Draft Created", description: "was created successfully." },
  INVOICE_DRAFT_UPDATED: { title: "Invoice Updated", description: "was updated successfully." },
  INVOICE_DRAFT_DELETED: { title: "Invoice Deleted", description: "was deleted successfully." },
  INVOICE_GENERATION_FAILED: { title: "Invoice Generation", description: "The invoice could not be generated." },
  INVOICE_DRAFT_CREATE_FAILED: { title: "Invoice Draft Creation", description: "The invoice draft could not be created." },
  INVOICE_DRAFT_UPDATE_FAILED: { title: "Invoice Update", description: "The invoice could not be updated." },
  INVOICE_DRAFT_DELETE_FAILED: { title: "Invoice Deletion", description: "The invoice draft could not be deleted." },
  SCAN_PROCESSING_COMPLETED: { title: "Scan Processed", description: "The uploaded invoice was processed successfully." },
  SCAN_UPLOAD_SUCCEEDED: { title: "Invoice Scan Uploaded", description: "The uploaded invoice is ready for processing." },
  SCAN_SUBMITTED: { title: "Invoice Scan Submitted", description: "The invoice scan was submitted for processing." },
  SCAN_UPLOAD_FAILED: { title: "Invoice Scan Upload", description: "The invoice could not be uploaded." },
  SCAN_PROCESSING_FAILED: { title: "Scan Processing", description: "The uploaded invoice could not be processed." },
  SCAN_PROCESSING_RETRY_FAILED: { title: "Scan Retry", description: "Processing could not be restarted for the uploaded invoice." },
  SCAN_RESULT_REVIEW_FAILED: { title: "Scan Review", description: "The extracted invoice details could not be saved." },
  SCAN_BILL_CONFIRMATION_FAILED: { title: "Bill Confirmation", description: "The reviewed invoice could not be added to financial records." },
  SCAN_RESULT_REVIEWED: { title: "Scan Reviewed", description: "The extracted invoice details were reviewed." },
  SCAN_PROCESSING_RETRIED: { title: "Scan Retry Started", description: "Processing was restarted for the uploaded invoice." },
  SCAN_CONVERTED_TO_FINANCIAL_BILL: { title: "Bill Added to Financial Records", description: "The reviewed invoice was added to financial records." },
  FINANCIAL_SETTINGS_CREATED: { title: "Financial Settings Set Up", description: "Your financial settings were set up successfully." },
  FINANCIAL_SETTINGS_UPDATED: { title: "Financial Settings Updated", description: "Your financial settings were updated successfully." },
  FINANCIAL_INVOICE_CREATE_FAILED: { title: "Invoice Creation", description: "The invoice could not be created." },
  FINANCIAL_INVOICE_UPDATE_FAILED: { title: "Invoice Update", description: "The invoice could not be updated." },
  FINANCIAL_INVOICE_DELETE_FAILED: { title: "Invoice Deletion", description: "The invoice could not be deleted." },
  FINANCIAL_SETTINGS_UPDATE_FAILED: { title: "Financial Settings Update", description: "Your financial settings could not be updated." },
};

const AUDIT_FAILURE_MESSAGES: Record<string, string> = {
  INVOICE_NUMBER_ALREADY_EXISTS: "That invoice number is already in use. No changes were made.",
  INVOICE_NOT_FOUND: "The invoice could not be found, so no changes were made.",
  INVOICE_ALREADY_GENERATED: "This invoice has already been generated and could not be changed.",
  GENERATED_INVOICE_CANNOT_BE_DELETED: "Only invoice drafts can be deleted.",
  INVOICE_INPUT_INVALID: "Some invoice details need attention. Please review them and try again.",
  FINANCIAL_SETTINGS_INPUT_INVALID: "Some financial settings need attention. Please review them and try again.",
  FINANCIAL_SETTINGS_SAVE_FAILED: "Your financial settings could not be saved. Please try again.",
  OCR_PROVIDER_NOT_CONFIGURED: "Invoice processing is not configured yet. Please contact your administrator.",
  OCR_PROVIDER_TIMEOUT: "Invoice processing took too long. Please try again.",
  OCR_PROVIDER_UNAVAILABLE: "Invoice processing is temporarily unavailable. Please try again later.",
  OCR_PROVIDER_RATE_LIMITED: "Invoice processing is busy. Please try again later.",
  SCAN_FILE_TOO_LARGE: "The file is larger than the allowed limit. Choose a smaller file and try again.",
  SCAN_FILE_TYPE_UNSUPPORTED: "This file type is not supported. Choose a supported invoice document.",
  SCAN_NOT_RETRYABLE: "This scan cannot be retried because its document is unavailable.",
  SCAN_PROCESSING_IN_PROGRESS: "This scan is still processing. Wait before retrying.",
  SCAN_NOT_READY_FOR_REVIEW: "The scan must finish processing before its details can be reviewed.",
  SCAN_NOT_READY_FOR_CONFIRMATION: "The scan must finish processing before the bill can be confirmed.",
};

const RESULT_STYLE: Record<AuditResult, string> = {
  PASS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  FAIL: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
  NOT_APPLICABLE: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const STATUS_STYLE: Record<AuditStatus, string> = {
  RUNNING: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  FAILED: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
};

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const getAuditCategory = (record: { action?: string; entity_type?: string | null }): "Financial" | "Settings" | "Invoices" | "Vendors" | "Access & Security" => {
  const action = record.action ?? "";
  const entityType = record.entity_type?.toLowerCase() ?? "";
  if (action.startsWith("AUTH_") || action.startsWith("SECURITY_") || entityType === "security" || entityType === "access") {
    return "Access & Security";
  }
  if (entityType === "financial_settings" || action.startsWith("FINANCIAL_SETTINGS_")) return "Settings";
  if (entityType === "invoice" || action.startsWith("INVOICE_") || action.startsWith("FINANCIAL_INVOICE_")) {
    return "Invoices";
  }
  if (
    entityType === "vendor"
    || entityType === "vendor_bill"
    || entityType === "financial_invoice_scan"
    || action.startsWith("SCAN_")
  ) {
    return "Vendors";
  }
  return "Financial";
};

const getActionPresentation = (event: FinancialAuditEvent) => {
  const presentation = AUDIT_ACTION_PRESENTATION[event.action];
  const actionTitle = event.action
    .split("_")
    .map((word) => `${word.charAt(0)}${word.slice(1).toLowerCase()}`)
    .join(" ");
  const invoiceNumber = typeof event.metadata?.invoice_number === "string"
    ? event.metadata.invoice_number.trim()
    : "";
  const invoiceReferenceType = event.action === "INVOICE_DRAFT_CREATED" || event.action === "INVOICE_DRAFT_DELETED"
    ? "Draft"
    : "Invoice";
  const reference = invoiceNumber
    ? `${invoiceReferenceType} ${invoiceNumber}`
    : `The ${invoiceReferenceType.toLowerCase()}`;

  if (event.outcome === "FAILURE") {
    const errorCode = typeof event.metadata?.error_code === "string" ? event.metadata.error_code : "";
    const description = AUDIT_FAILURE_MESSAGES[errorCode]
      || presentation?.description
      || (event.entity_type === "financial_settings"
        ? "Your financial settings could not be updated. Please try again."
        : event.entity_type === "financial_invoice_scan"
          ? "The invoice scan could not be completed. Please try again."
          : "This action could not be completed. Please try again.");
    return {
      title: presentation?.title || actionTitle,
      description: invoiceNumber && event.entity_type === "invoice" ? `${reference}: ${description}` : description,
    };
  }

  if (!presentation) {
    return { title: actionTitle, description: "A financial action was completed successfully." };
  }
  if (invoiceNumber && event.entity_type === "invoice") {
    return { title: presentation.title, description: `${reference} ${presentation.description}` };
  }
  return { title: presentation.title, description: presentation.description };
};

const getCheckCategory = (check: AuditCheck): "Financial" | "Invoices" | "Vendors" => {
  if (check.entity_type === "invoice") return "Invoices";
  if (check.entity_type === "vendor_bill" || check.entity_type === "vendor") return "Vendors";
  return "Financial";
};

const groupTimelineByLocalDate = (entries: TimelineEntry[]): TimelineDateGroup[] => {
  const groups = new Map<string, TimelineDateGroup>();

  entries.forEach((entry) => {
    const date = new Date(entry.timestamp);
    const validDate = !Number.isNaN(date.getTime());
    const key = validDate
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      : "unknown";

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: validDate
          ? new Intl.DateTimeFormat("en-IN", { dateStyle: "full" }).format(date)
          : "Date unavailable",
        entries: [],
        actionCount: 0,
        actionSuccessCount: 0,
        actionFailureCount: 0,
        securityCount: 0,
        runCount: 0,
        runPassedChecks: 0,
        runFailedChecks: 0,
        categoriesPresent: new Set(),
      };
      groups.set(key, group);
    }

    group.entries.push(entry);
    group.categoriesPresent.add(entry.category);

    if (entry.kind === "action") {
      group.actionCount += 1;
      if (entry.event.outcome === "SUCCESS") {
        group.actionSuccessCount += 1;
      } else {
        group.actionFailureCount += 1;
      }
    } else if (entry.kind === "security") {
      group.securityCount += 1;
    } else {
      group.runCount += 1;
      group.runPassedChecks += entry.run.passed_checks;
      group.runFailedChecks += entry.run.failed_checks;
    }
  });

  return [...groups.values()]
    .sort((left, right) => {
      if (left.key === "unknown") return 1;
      if (right.key === "unknown") return -1;
      return right.key.localeCompare(left.key);
    })
    .map((group) => ({
      ...group,
      entries: group.entries.sort((left, right) => {
        const difference = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
        return Number.isNaN(difference) ? 0 : difference;
      }),
    }));
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
      if (detail === "FINANCIAL_AUDIT_ALREADY_RUNNING") return "An audit is already running for this employer. Refresh the run history to check its status.";
      if (detail === "FINANCIAL_AUDIT_RUN_NOT_FOUND") return "This audit run could not be found in your account.";
      return detail;
    }
  }
  return fallback;
};

export default function FinancialAuditsPage() {
  const [events, setEvents] = useState<FinancialAuditEvent[]>([]);
  const [securityActivities, setSecurityActivities] = useState<SecurityActivity[]>([]);
  const [securityActivityCount, setSecurityActivityCount] = useState<number | null>(null);
  const [securityActivityCursor, setSecurityActivityCursor] = useState<string | null>(null);
  const [loadingOlderSecurityActivities, setLoadingOlderSecurityActivities] = useState(false);
  const [olderSecurityActivitiesError, setOlderSecurityActivitiesError] = useState<string | null>(null);
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [category, setCategory] = useState<FilterCategory>("All");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [expandedDateKeys, setExpandedDateKeys] = useState<Set<string>>(new Set());
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const startLock = useRef(false);
  const securityActivityPageLock = useRef(false);
  const requestKey = useRef<string | null>(null);

  const latestCompletedRun = useMemo(() => (
    runs
      .filter((run) => run.status === "COMPLETED")
      .sort((left, right) => new Date(right.completed_at || right.started_at).getTime() - new Date(left.completed_at || left.started_at).getTime())[0] ?? null
  ), [runs]);

  const historyByDate = useMemo(() => {
    const entries: TimelineEntry[] = [];

    // Filter action-history events
    events.forEach((event) => {
      const eventCategory = getAuditCategory(event);
      if (category === "All" || category === eventCategory) {
        entries.push({
          kind: "action" as const,
          id: event.id,
          timestamp: event.created_at,
          category: eventCategory,
          event,
        });
      }
    });

    // Filter security activity events (under "Access & Security")
    if (category === "All" || category === "Access & Security") {
      securityActivities.forEach((activity) => {
        entries.push({
          kind: "security" as const,
          id: activity.id,
          timestamp: activity.created_at,
          category: "Access & Security",
          activity,
        });
      });
    }

    // Filter automated audit runs
    runs.forEach((run) => {
      if (category === "Settings" || category === "Access & Security") {
        // Automated audit runs do not test settings or access/security
        return;
      }

      if (category === "All" || category === "Financial") {
        entries.push({
          kind: "run" as const,
          id: run.id,
          timestamp: run.started_at,
          category: "Financial",
          run,
          checks: run.checks,
        });
      } else {
        // Specific check filtering for Invoices or Vendors
        const matchingChecks = run.checks
          .filter((check) => getCheckCategory(check) === category)
          .sort((left, right) => new Date(left.checked_at).getTime() - new Date(right.checked_at).getTime());

        if (matchingChecks.length > 0) {
          entries.push({
            kind: "run" as const,
            id: run.id,
            timestamp: run.started_at,
            category: "Financial",
            run,
            checks: matchingChecks,
          });
        }
      }
    });

    return groupTimelineByLocalDate(entries);
  }, [category, events, securityActivities, runs]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const sessionKey = getSessionKey() || "";
      const [eventResult, runResult, securityResult] = await Promise.allSettled([
        apiClient.get<AuditEventsResponse>(`${FINANCIAL_API}/audits`),
        apiClient.get<AuditRunsResponse>(`${FINANCIAL_API}/audit-runs`),
        apiClient.get<AccountSecurityResponse>(EMPLOYER_SECURITY_API, {
          params: { limit: 100 },
          headers: { "X-Goleska-Session-Key": sessionKey },
        }),
      ]);

      if (eventResult.status === "rejected" && runResult.status === "rejected") {
        throw new Error(getErrorMessage(eventResult.reason, "Unable to load the complete audit history."));
      }

      const rawEvents = eventResult.status === "fulfilled" && Array.isArray(eventResult.value.data?.audits)
        ? eventResult.value.data.audits
        : [];
      const rawRuns = runResult.status === "fulfilled" && Array.isArray(runResult.value.data?.runs)
        ? runResult.value.data.runs
        : [];
      const rawSecurityActivities = securityResult.status === "fulfilled" && Array.isArray(securityResult.value.data?.activities)
        ? securityResult.value.data.activities
        : [];

      const completeRuns: AuditRun[] = [];
      for (let offset = 0; offset < rawRuns.length; offset += 6) {
        const detailResponses = await Promise.all(
          rawRuns.slice(offset, offset + 6).map(async (run) => {
            try {
              const response = await apiClient.get<AuditRun>(`${FINANCIAL_API}/audit-runs/${run.id}`);
              if (response.data.id === run.id && Array.isArray(response.data.checks)) {
                return response.data;
              }
              return run;
            } catch {
              return run;
            }
          }),
        );
        completeRuns.push(...detailResponses);
      }

      setEvents(rawEvents);
      setRuns(completeRuns);
      setSecurityActivities(rawSecurityActivities);
      setSecurityActivityCount(
        typeof securityResult.status === "fulfilled" && typeof securityResult.value.data?.activity_count === "number"
          ? securityResult.value.data.activity_count
          : rawSecurityActivities.length,
      );
      setSecurityActivityCursor(
        securityResult.status === "fulfilled" && typeof securityResult.value.data?.next_cursor === "string"
          ? securityResult.value.data.next_cursor
          : null,
      );
      setOlderSecurityActivitiesError(null);
      setHistoryLoaded(true);
    } catch (error) {
      setHistoryError(getErrorMessage(error, "Unable to load the complete audit history."));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadOlderSecurityActivities = useCallback(async () => {
    if (!securityActivityCursor || securityActivityPageLock.current) return;
    securityActivityPageLock.current = true;
    setLoadingOlderSecurityActivities(true);
    setOlderSecurityActivitiesError(null);
    try {
      const response = await apiClient.get<AccountSecurityResponse>(
        `${EMPLOYER_SECURITY_API}?limit=100&cursor=${encodeURIComponent(securityActivityCursor)}`,
      );
      const olderActivities = Array.isArray(response.data?.activities) ? response.data.activities : [];
      setSecurityActivities((current) => {
        const byId = new Map(current.map((activity) => [activity.id, activity]));
        olderActivities.forEach((activity) => byId.set(activity.id, activity));
        return [...byId.values()];
      });
      setSecurityActivityCursor(
        typeof response.data?.next_cursor === "string" ? response.data.next_cursor : null,
      );
    } catch (error) {
      setOlderSecurityActivitiesError(getErrorMessage(error, "Unable to load older security events."));
    } finally {
      securityActivityPageLock.current = false;
      setLoadingOlderSecurityActivities(false);
    }
  }, [securityActivityCursor]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const toggleDate = (dateKey: string) => {
    setExpandedDateKeys((current) => {
      const next = new Set(current);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const toggleRun = (runId: string) => {
    setExpandedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const startAudit = async () => {
    if (startLock.current) return;
    startLock.current = true;
    setStarting(true);
    setStartError(null);
    setSuccessMessage(null);
    try {
      if (!requestKey.current) requestKey.current = crypto.randomUUID();
      const response = await apiClient.post<AuditRun>(`${FINANCIAL_API}/audit-runs`, {
        idempotency_key: requestKey.current,
      });
      requestKey.current = null;
      if (response.data.status === "COMPLETED") {
        setSuccessMessage("Financial data checks completed. The dashboard now reflects this run.");
      } else if (response.data.status === "FAILED") {
        setStartError(response.data.error_message || "The audit run failed. Review its persisted results below.");
      } else {
        setSuccessMessage("An audit run is already in progress. Its status is shown in the run history.");
      }
      await refreshHistory();
    } catch (error) {
      setStartError(getErrorMessage(error, "The audit could not be started or completed."));
      await refreshHistory();
    } finally {
      startLock.current = false;
      setStarting(false);
    }
  };

  const applicableChecks = latestCompletedRun
    ? latestCompletedRun.passed_checks + latestCompletedRun.failed_checks
    : 0;
  const latestPassRate = latestCompletedRun && applicableChecks > 0
    ? (latestCompletedRun.passed_checks / applicableChecks) * 100
    : null;

  const totalActionAndSecurityCount = events.length + (securityActivityCount ?? securityActivities.length);

  return (
    <AgentLayout config={financialConfig} activeTab="audits" setActiveTab={() => undefined} fullWidth>
      <div className="mt-3 space-y-5 sm:mt-6 sm:space-y-7">
        {/* Page Header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Audits</h1>
            <p className="mt-1 max-w-4xl text-xs text-slate-500 dark:text-slate-400">
              Consolidated history of operational actions, authentication/security events, and automated consistency check runs. Automated checks are informational and do not replace certified accounting or compliance advice.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void startAudit()}
            disabled={starting}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {starting ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />}
            {starting ? "Running checks…" : "Start Audit"}
          </button>
        </header>

        {successMessage && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            {successMessage}
          </div>
        )}
        {startError && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            {startError}
            <button type="button" onClick={() => void refreshHistory()} className="ml-3 underline">Refresh history</button>
          </div>
        )}

        {/* Top Stats Cards */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Automated audit summary">
          <Metric label="Total automated runs">
            {historyLoading && !historyLoaded ? "…" : historyLoaded ? runs.length : "—"}
            <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">
              {historyLoaded ? `${totalActionAndSecurityCount} activity events recorded` : "Loading activity…"}
            </span>
          </Metric>
          <Metric label="Latest check pass rate">
            {latestPassRate == null ? "—" : `${latestPassRate.toFixed(1)}%`}
            <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">
              {latestCompletedRun ? `${latestCompletedRun.passed_checks} of ${applicableChecks} applicable passed` : "No completed runs"}
            </span>
          </Metric>
          <Metric label="Failed checks · latest run">
            {latestCompletedRun ? latestCompletedRun.failed_checks : "—"}
            <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">
              {latestCompletedRun ? `${latestCompletedRun.not_applicable_checks} not applicable` : "—"}
            </span>
          </Metric>
          <Metric label="Last audit run">
            {runs.length
              ? formatDateTime([...runs].sort((left, right) => new Date(right.started_at).getTime() - new Date(left.started_at).getTime())[0].started_at)
              : "—"}
            <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">
              {runs.length ? runs[0].status : "No runs recorded"}
            </span>
          </Metric>
        </section>

        {/* Audit History Card */}
        <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
          <div className="space-y-4 border-b border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900 dark:text-white">Audit history by date</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Each date displays an activity summary. Click &ldquo;View details&rdquo; to expand into the chronological timeline of actions, security events, and automated checks.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshHistory()}
                disabled={historyLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <RefreshCw size={13} className={historyLoading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>

            {/* Category Filters */}
            <div role="group" aria-label="Filter audit history by category" className="flex flex-wrap items-center gap-2">
              {FILTER_CATEGORIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={category === option}
                  onClick={() => setCategory(option)}
                  className={`min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
                    category === option
                      ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/40"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {/* Body Content */}
          {historyLoading && !historyLoaded ? (
            <p className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
              <LoaderCircle size={16} className="animate-spin" /> Loading audit history…
            </p>
          ) : historyError && !historyLoaded ? (
            <div className="p-8 text-center">
              <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{historyError}</p>
              <button
                type="button"
                onClick={() => void refreshHistory()}
                className="mt-3 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 dark:border-rose-800 dark:text-rose-300"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {historyError && (
                <p role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                  Refresh failed; showing the last loaded history. {historyError}
                </p>
              )}

              {historyByDate.length === 0 ? (
                <div className="p-12 text-center">
                  <ShieldCheck className="mx-auto h-9 w-9 text-slate-400" />
                  <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {category === "All"
                      ? "No action history, security events, or audit runs have been recorded yet."
                      : `No audit records match the "${category}" category.`}
                  </p>
                  {category !== "All" && (
                    <button
                      type="button"
                      onClick={() => setCategory("All")}
                      className="mt-3 text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Show all categories
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {historyByDate.map((group) => {
                    const isDateExpanded = expandedDateKeys.has(group.key);
                    const totalEntries = group.entries.length;

                    return (
                      <section key={group.key} className="min-w-0 transition">
                        {/* Collapsed Date Summary Row */}
                        <div className="flex flex-col gap-4 p-4 transition sm:flex-row sm:items-center sm:justify-between sm:p-5">
                          <div className="min-w-0 space-y-1.5">
                            {/* Date Label & Categories */}
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                {group.label}
                              </h3>
                              <div className="flex flex-wrap gap-1">
                                {[...group.categoriesPresent].map((cat) => (
                                  <span
                                    key={cat}
                                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                  >
                                    {cat}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Summary Metrics */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                {totalEntries} {totalEntries === 1 ? "record" : "records"}
                              </span>
                              {group.actionCount > 0 && (
                                <span>
                                  · {group.actionCount} {group.actionCount === 1 ? "action" : "actions"}
                                  {" "}(<span className="text-emerald-600 dark:text-emerald-400 font-medium">{group.actionSuccessCount} succeeded</span>
                                  {group.actionFailureCount > 0 && (
                                    <span className="text-rose-600 dark:text-rose-400 font-medium">, {group.actionFailureCount} failed</span>
                                  )})
                                </span>
                              )}
                              {group.securityCount > 0 && (
                                <span>
                                  · {group.securityCount} security {group.securityCount === 1 ? "event" : "events"}
                                </span>
                              )}
                              {group.runCount > 0 && (
                                <span>
                                  · {group.runCount} automated {group.runCount === 1 ? "run" : "runs"}
                                  {" "}(<span className="text-emerald-600 dark:text-emerald-400 font-medium">{group.runPassedChecks} checks passed</span>
                                  {group.runFailedChecks > 0 && (
                                    <span className="text-rose-600 dark:text-rose-400 font-medium">, {group.runFailedChecks} failed</span>
                                  )})
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Date View / Close Toggle */}
                          <div className="shrink-0">
                            <button
                              type="button"
                              onClick={() => toggleDate(group.key)}
                              aria-expanded={isDateExpanded}
                              aria-label={`${isDateExpanded ? "Close" : "View"} details for ${group.label}`}
                              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                                isDateExpanded
                                  ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                  : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
                              }`}
                            >
                              {isDateExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              {isDateExpanded ? "Close" : "View details"}
                            </button>
                          </div>
                        </div>

                        {/* Expanded Date Details */}
                        {isDateExpanded && (
                          <div className="border-t border-slate-100 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-950/30">
                            <div className="divide-y divide-slate-100 p-3 sm:p-5 dark:divide-slate-800 space-y-3">
                              {group.entries.map((entry) => (
                                <div key={`${entry.kind}-${entry.id}`} className="first:pt-0 pt-3">
                                  {entry.kind === "action" ? (
                                    <ActionHistoryEntry entry={entry} />
                                  ) : entry.kind === "security" ? (
                                    <SecurityActivityEntry entry={entry} />
                                  ) : (
                                    <AuditRunEntry
                                      entry={entry}
                                      expanded={expandedRunIds.has(entry.id)}
                                      onToggle={() => toggleRun(entry.id)}
                                      selectedCategory={category}
                                    />
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Bottom Close Bar */}
                            <div className="flex justify-end border-t border-slate-100 px-4 py-2.5 dark:border-slate-800 sm:px-5">
                              <button
                                type="button"
                                onClick={() => toggleDate(group.key)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                              >
                                <ChevronUp size={13} />
                                Close {group.label}
                              </button>
                            </div>
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
              {(category === "All" || category === "Access & Security") && securityActivityCursor && (
                <div className="border-t border-slate-100 px-4 py-4 text-center dark:border-slate-800">
                  {olderSecurityActivitiesError && (
                    <p role="alert" className="mb-2 text-xs text-rose-600 dark:text-rose-400">
                      {olderSecurityActivitiesError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void loadOlderSecurityActivities()}
                    disabled={loadingOlderSecurityActivities}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {loadingOlderSecurityActivities && <LoaderCircle size={14} className="animate-spin" />}
                    {loadingOlderSecurityActivities ? "Loading older events…" : "Load older security events"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </AgentLayout>
  );
}

function ActionHistoryEntry({ entry }: { entry: TimelineAction }) {
  const presentation = getActionPresentation(entry.event);
  const succeeded = entry.event.outcome === "SUCCESS";
  const categoryIcon = entry.category === "Settings"
    ? Settings
    : entry.category === "Invoices"
      ? FileCheck
      : entry.category === "Vendors"
        ? Building2
        : entry.category === "Access & Security"
          ? ShieldAlert
          : ShieldCheck;
  const Icon = categoryIcon;

  return (
    <article className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 shrink-0 rounded-xl p-2 ${
              succeeded
                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300"
            }`}
          >
            <Icon size={18} />
          </span>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {presentation.title}
              </h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Action history · {entry.category}
              </span>
            </div>

            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {presentation.description}
            </p>

            <div className="flex items-center gap-1 pt-1 text-xs text-slate-400 dark:text-slate-500">
              <Clock3 size={12} />
              <span>{formatDateTime(entry.timestamp)}</span>
            </div>

            {/* Affected Record Information */}
            {entry.event.entity_id && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                <span className="break-all font-mono text-[11px]">
                  Affected {entry.event.entity_type || "record"}: {entry.event.entity_id}
                </span>
                {entry.event.entity_type === "invoice" && (
                  <Link
                    href={`/financial?invoice=${encodeURIComponent(entry.event.entity_id)}`}
                    className="shrink-0 font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Open invoice
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <span
          className={`self-start rounded-full px-3 py-1 text-xs font-bold shrink-0 ${
            succeeded
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
          }`}
        >
          {succeeded ? "Success" : "Failed"}
        </span>
      </div>
    </article>
  );
}

function SecurityActivityEntry({ entry }: { entry: TimelineSecurity }) {
  const { activity } = entry;
  const eventTitleMap: Record<string, string> = {
    login: "Account Sign In",
    logout: "Account Sign Out",
    session_revoked: "Session Revoked",
    password_changed: "Password Changed",
  };
  const title = eventTitleMap[activity.event_type]
    || activity.event_type.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const country = getApproximateIpCountry(activity.country);
  const device = [activity.browser, activity.os].filter(Boolean).join(" · ") || activity.device_name;

  return (
    <article className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 shrink-0 rounded-xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
            <ShieldAlert size={18} />
          </span>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {title}
              </h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Security activity · Access & Security
              </span>
            </div>

            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {activity.description || "Security activity recorded for this employer account."}
            </p>

            <div className="flex items-center gap-1 pt-1 text-xs text-slate-400 dark:text-slate-500">
              <Clock3 size={12} />
              <span>{formatDateTime(entry.timestamp)}</span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {device && (
                <span>
                  Device: <span className="font-medium text-slate-800 dark:text-slate-200">{device}</span>
                </span>
              )}
              <span>
                Approximate public-IP location: <span className="font-medium text-slate-800 dark:text-slate-200">{country || "Location unavailable"}</span>
              </span>
            </div>
          </div>
        </div>

        <span className="self-start shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
          Security Log
        </span>
      </div>
    </article>
  );
}

function AuditRunEntry({
  entry,
  expanded,
  onToggle,
  selectedCategory,
}: {
  entry: TimelineRun;
  expanded: boolean;
  onToggle: () => void;
  selectedCategory: FilterCategory;
}) {
  const { run, checks } = entry;

  return (
    <article className="min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-sm transition dark:border-slate-800 dark:bg-slate-900">
      <div className="grid min-w-0 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,auto)_auto] lg:items-center">
        {/* Left Run Info */}
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ShieldCheck size={18} className="shrink-0 text-indigo-600 dark:text-indigo-400" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Automated financial audit run
            </h4>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${STATUS_STYLE[run.status]}`}>
              {run.status}
            </span>
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              Automated checks · Financial
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>Started {formatDateTime(run.started_at)}</span>
            {run.completed_at && <span>· Completed {formatDateTime(run.completed_at)}</span>}
          </div>

          {run.status === "FAILED" && run.error_message && (
            <p role="alert" className="mt-2 break-words rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              {run.error_message}
            </p>
          )}
        </div>

        {/* Center Run Metrics */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RunStat label="Passed" value={run.passed_checks} />
          <RunStat label="Failed" value={run.failed_checks} />
          <RunStat label="N/A" value={run.not_applicable_checks} />
          <RunStat
            label="Pass rate"
            value={run.status === "COMPLETED" && run.pass_rate != null ? `${Number(run.pass_rate).toFixed(1)}%` : "—"}
          />
        </div>

        {/* Right Toggle Control */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Close" : "View"} checks for audit run started ${formatDateTime(run.started_at)}`}
            className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/60 lg:w-auto"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{expanded ? "Hide checks" : "View checks"}</span>
            <span className="text-[10px] opacity-75">({checks.length})</span>
          </button>
        </div>
      </div>

      {/* Expanded Checks List */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40">
          {selectedCategory !== "All" && selectedCategory !== "Financial" && (
            <p className="px-4 pt-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400 sm:px-5">
              Run totals above cover all checks; displaying {checks.length} {selectedCategory.toLowerCase()} check{checks.length === 1 ? "" : "s"}.
            </p>
          )}

          {checks.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {run.status === "RUNNING"
                ? "This audit run is currently in progress; check results will be available once completed."
                : run.status === "FAILED"
                  ? "This run failed before check results were recorded."
                  : "No check results were recorded for this run."}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {checks.map((check) => (
                <article key={check.id} className="min-w-0 p-4 sm:p-5">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h5 className="text-sm font-bold text-slate-900 dark:text-white">
                          {check.title}
                        </h5>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {getCheckCategory(check)}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {check.explanation}
                      </p>
                    </div>

                    <span
                      className={`self-start rounded-full px-2.5 py-1 text-[10px] font-bold sm:shrink-0 ${
                        RESULT_STYLE[check.result]
                      }`}
                    >
                      {check.result.replace("_", " ")}
                    </span>
                  </div>

                  {/* Check Affected Record */}
                  {(check.entity_type || check.entity_id) && (
                    <div className="mt-3 flex min-w-0 flex-col gap-1 rounded-xl bg-white px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-300 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <span className="break-all font-mono text-[11px]">
                        Affected {check.entity_type || "record"}: {check.entity_id || "ID unavailable"}
                      </span>
                      {check.entity_type === "invoice" && check.entity_id && (
                        <Link
                          href={`/financial?invoice=${encodeURIComponent(check.entity_id)}`}
                          className="shrink-0 font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Open invoice
                        </Link>
                      )}
                    </div>
                  )}

                  {/* Findings */}
                  {check.findings.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {check.findings.map((finding, index) => (
                        <li
                          key={`${check.id}-${index}`}
                          className={`flex min-w-0 gap-2 rounded-xl p-3 text-xs ${
                            check.result === "FAIL"
                              ? "bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
                              : "bg-white text-slate-700 dark:bg-slate-900/80 dark:text-slate-300"
                          }`}
                        >
                          {check.result === "FAIL" ? (
                            <XCircle size={14} className="mt-0.5 shrink-0" />
                          ) : check.result === "PASS" ? (
                            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                          ) : (
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          )}
                          <span className="break-words">
                            {Object.entries(finding)
                              .map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`)
                              .join(" · ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="mt-3 flex items-center gap-1 text-[10px] text-slate-400">
                    <Clock3 size={12} /> Checked {formatDateTime(check.checked_at)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function RunStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex min-w-0 flex-col justify-center rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/50">
      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="mt-0.5 truncate text-xs font-bold text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{children}</div>
    </div>
  );
}
