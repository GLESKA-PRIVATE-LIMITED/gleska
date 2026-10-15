"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, Play, ShieldCheck, XCircle } from "lucide-react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { financialConfig } from "@/components/agents/financial/financialConfig";
import apiClient from "@/lib/api";

type AuditResult = "PASS" | "FAIL" | "NOT_APPLICABLE";
type AuditStatus = "RUNNING" | "COMPLETED" | "FAILED";

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

const FINANCIAL_API = "/api/v1/financial";

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

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const groupRunsByLocalDate = (runs: AuditRun[]) => {
  const groups = new Map<string, { label: string; runs: AuditRun[] }>();
  const sortedRuns = [...runs].sort(
    (left, right) => new Date(right.started_at).getTime() - new Date(left.started_at).getTime(),
  );

  sortedRuns.forEach((run) => {
    const date = new Date(run.started_at);
    const key = Number.isNaN(date.getTime())
      ? "unknown"
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const label = Number.isNaN(date.getTime())
      ? "Date unavailable"
      : new Intl.DateTimeFormat("en-IN", { dateStyle: "full" }).format(date);
    const group = groups.get(key);
    if (group) {
      group.runs.push(run);
    } else {
      groups.set(key, { label, runs: [run] });
    }
  });

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "unknown") return 1;
      if (right === "unknown") return -1;
      return right.localeCompare(left);
    })
    .map(([key, group]) => ({ key, ...group }));
};

const resultStyle: Record<AuditResult, string> = {
  PASS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  FAIL: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
  NOT_APPLICABLE: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const statusStyle: Record<AuditStatus, string> = {
  RUNNING: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  FAILED: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
};

export default function FinancialAuditsPage() {
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<AuditRun | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const startLock = useRef(false);
  const requestKey = useRef<string | null>(null);
  const detailRequestId = useRef(0);
  const runsByLocalDate = useMemo(() => groupRunsByLocalDate(runs), [runs]);

  const refreshRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const response = await apiClient.get<AuditRunsResponse>(`${FINANCIAL_API}/audit-runs`);
      setRuns(response.data.runs);
    } catch (error) {
      setRunsError(getErrorMessage(error, "Unable to load financial audit history."));
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  const loadRun = useCallback(async (runId: string) => {
    const requestId = ++detailRequestId.current;
    setSelectedRunId(runId);
    setSelectedRun(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await apiClient.get<AuditRun>(`${FINANCIAL_API}/audit-runs/${runId}`);
      if (requestId === detailRequestId.current) setSelectedRun(response.data);
    } catch (error) {
      if (requestId === detailRequestId.current) {
        setDetailError(getErrorMessage(error, "Unable to load this audit run."));
      }
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (runsLoading || detailLoading || selectedRunId || runs.length === 0) return;
    const latestCompleted = runs.find((run) => run.status === "COMPLETED");
    void loadRun((latestCompleted ?? runs[0]).id);
  }, [detailLoading, loadRun, runs, runsLoading, selectedRunId]);

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
      const run = response.data;
      setSelectedRunId(run.id);
      setSelectedRun(run);
      if (run.status === "COMPLETED") {
        setSuccessMessage("Financial data checks completed. The dashboard now reflects this run.");
      } else if (run.status === "FAILED") {
        setStartError(run.error_message || "The audit run failed. Review its persisted results below.");
      } else {
        setSuccessMessage("An audit run is already in progress. Its status is shown in the run history.");
      }
      await refreshRuns();
    } catch (error) {
      setStartError(getErrorMessage(error, "The audit could not be started or completed."));
      await refreshRuns();
    } finally {
      startLock.current = false;
      setStarting(false);
    }
  };

  return (
    <AgentLayout config={financialConfig} activeTab="audit-checks" setActiveTab={() => undefined}>
      <div className="mt-3 space-y-5 sm:mt-6 sm:space-y-7">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Financial Audit Checks</h1>
            <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
              Review consistency checks against saved invoices, payment records, and confirmed vendor bills.
              These checks are informational and are not certified accounting, tax, or regulatory compliance advice.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void startAudit()}
            disabled={starting}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
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
            <button type="button" onClick={() => void refreshRuns()} className="ml-3 underline">Refresh history</button>
          </div>
        )}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Selected Run Pass Rate">
            {selectedRun?.status === "COMPLETED"
              ? selectedRun.pass_rate == null ? "N/A" : `${Number(selectedRun.pass_rate).toFixed(1)}%`
              : "—"}
          </Metric>
          <Metric label="Passed">{selectedRun?.status === "COMPLETED" ? selectedRun.passed_checks : "—"}</Metric>
          <Metric label="Failed">{selectedRun?.status === "COMPLETED" ? selectedRun.failed_checks : "—"}</Metric>
          <Metric label="Not Applicable">{selectedRun?.status === "COMPLETED" ? selectedRun.not_applicable_checks : "—"}</Metric>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">Audit runs by date</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Each run keeps its own results and score.</p>
            </div>
            <button type="button" onClick={() => void refreshRuns()} aria-label="Refresh audit history" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold dark:border-slate-700">Refresh</button>
          </div>
          {runsLoading ? (
            <p className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin" /> Loading audit runs…</p>
          ) : runsError ? (
            <div className="p-6 text-center">
              <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{runsError}</p>
              <button type="button" onClick={() => void refreshRuns()} className="mt-3 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 dark:border-rose-800 dark:text-rose-300">Retry</button>
            </div>
          ) : runs.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No audit runs yet. Start an audit to evaluate saved financial records.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {runsByLocalDate.map((group) => (
                <section key={group.key} className="min-w-0">
                  <h2 className="border-b border-slate-100 bg-slate-50/80 px-4 py-3 text-xs font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 sm:px-5">
                    {group.label}
                  </h2>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {group.runs.map((run) => {
                      const isSelected = selectedRunId === run.id;
                      const runDetails = isSelected ? selectedRun : null;
                      return (
                        <article key={run.id} className={`min-w-0 ${isSelected ? "bg-indigo-50/40 dark:bg-indigo-950/15" : ""}`}>
                          <button
                            type="button"
                            onClick={() => void loadRun(run.id)}
                            aria-pressed={isSelected}
                            className={`grid w-full min-w-0 gap-3 border-l-4 p-4 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800/60 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(100px,0.7fr))] lg:items-center ${isSelected ? "border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30" : "border-transparent"}`}
                          >
                            <div className="flex min-w-0 items-center justify-between gap-2 sm:block">
                              <span className="block truncate text-xs font-bold text-slate-900 dark:text-white">Started {formatDateTime(run.started_at)}</span>
                              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${statusStyle[run.status]}`}>{run.status}</span>
                              <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">Completed {formatDateTime(run.completed_at)}</span>
                            </div>
                            <RunMetric label="Passed" value={run.passed_checks} />
                            <RunMetric label="Failed" value={run.failed_checks} />
                            <RunMetric label="Not applicable" value={run.not_applicable_checks} />
                            <RunMetric
                              label="Pass rate"
                              value={run.status === "COMPLETED" && run.pass_rate != null
                                ? `${Number(run.pass_rate).toFixed(2)}%`
                                : "—"}
                            />
                          </button>

                          {isSelected && (
                            <div className="min-w-0 border-t border-slate-200/80 dark:border-slate-700">
                              {run.status === "FAILED" && run.error_message && (
                                <p role="alert" className="mx-4 mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 sm:mx-5">
                                  {run.error_message}
                                </p>
                              )}
                              {detailLoading ? (
                                <p className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin" /> Loading this run’s audit details…</p>
                              ) : detailError ? (
                                <div className="p-8 text-center">
                                  <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{detailError}</p>
                                  <button type="button" onClick={() => void loadRun(run.id)} className="mt-3 text-xs font-bold underline">Retry</button>
                                </div>
                              ) : runDetails ? (
                                runDetails.checks.length === 0 ? (
                                  <p className="p-8 text-center text-sm text-slate-500">
                                    {runDetails.status === "RUNNING"
                                      ? "This audit is still in progress; no completed check results are available yet."
                                      : runDetails.status === "FAILED"
                                        ? "This run failed before any check results were persisted."
                                        : "This completed run has no persisted check results."}
                                  </p>
                                ) : (
                                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {runDetails.checks.map((check) => (
                                      <article key={check.id} className="min-w-0 p-4 sm:p-5">
                                        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                          <div className="min-w-0">
                                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{check.title}</h3>
                                            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{check.explanation}</p>
                                          </div>
                                          <span className={`self-start rounded-full px-2.5 py-1 text-[10px] font-bold sm:shrink-0 ${resultStyle[check.result]}`}>{check.result.replace("_", " ")}</span>
                                        </div>
                                        {(check.entity_type || check.entity_id) && (
                                          <div className="mt-3 flex min-w-0 flex-col gap-1 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                                            <span className="min-w-0 break-all">Affected {check.entity_type || "record"} · {check.entity_id || "ID unavailable"}</span>
                                            {check.entity_type === "invoice" && check.entity_id && (
                                              <Link href={`/financial?invoice=${encodeURIComponent(check.entity_id)}`} className="shrink-0 font-semibold text-indigo-600 hover:underline dark:text-indigo-400">Open invoice</Link>
                                            )}
                                          </div>
                                        )}
                                        {check.findings.length > 0 && (
                                          <ul className="mt-3 space-y-2">
                                            {check.findings.map((finding, index) => (
                                              <li key={`${check.id}-${index}`} className={`flex min-w-0 gap-2 rounded-xl p-3 text-xs ${check.result === "FAIL" ? "bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200" : "bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-300"}`}>
                                                {check.result === "FAIL" ? <XCircle size={14} className="mt-0.5 shrink-0" /> : check.result === "PASS" ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                                                <span className="break-words">{Object.entries(finding).map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`).join(" · ")}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                        <p className="mt-3 flex items-center gap-1 text-[10px] text-slate-400"><Clock3 size={12} /> Checked {formatDateTime(check.checked_at)}</p>
                                      </article>
                                    ))}
                                  </div>
                                )
                              ) : (
                                <p className="p-8 text-center text-sm text-slate-500">
                                  {run.status === "RUNNING" ? "This audit is still in progress." : "Select this run to load its persisted results."}
                                </p>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>
    </AgentLayout>
  );
}

function RunMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="flex min-w-0 items-baseline justify-between gap-2 sm:block">
      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">{value}</span>
    </span>
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
