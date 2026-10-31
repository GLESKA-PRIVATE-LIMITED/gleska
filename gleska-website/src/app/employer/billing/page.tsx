"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Coins, Loader2 } from "lucide-react";
import AccountManagementShell, { formatEmployerType } from "@/components/AccountManagementShell";
import { WorkerEmptyState, WorkerErrorState, WorkerLoadingState, WorkerPageFrame, WorkerPageHeader, WorkspaceCard } from "@/components/worker/WorkspaceUI";
import { useAuth } from "@/context/AuthContext";
import {
  agentLabel,
  billingApi,
  creditsToRupees,
  entryLabel,
  formatCredits,
  type LedgerEntry,
  type UsageReport,
  type Wallet,
} from "@/lib/billing-api";

const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  succeeded: "Done",
  failed: "Failed",
  rejected: "Not run",
  reserved: "In progress",
  pending_reconciliation: "Being checked",
};

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/** Signed credit change shown to employers; AI usage shows what was consumed. */
function entryChange(entry: LedgerEntry): string {
  if (entry.entry_type === "settle") return `-${formatCredits(entry.credits_consumed)}`;
  const value = formatCredits(entry.delta_available);
  return value.startsWith("-") || value === "0" ? value : `+${value}`;
}

export default function EmployerBillingPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [period, setPeriod] = React.useState<number>(30);
  const [wallet, setWallet] = React.useState<Wallet | null>(null);
  const [usage, setUsage] = React.useState<UsageReport | null>(null);
  const [ledger, setLedger] = React.useState<LedgerEntry[] | null>(null);
  const [showHolds, setShowHolds] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback((days: number) => {
    return Promise.all([billingApi.wallet(), billingApi.usage(sinceIso(days)), billingApi.ledger()])
      .then(([w, u, l]) => {
        setWallet(w);
        setUsage(u);
        setLedger(l);
        setError(null);
      })
      .catch(() => setError("We couldn't load your AI credits. Please try again."));
  }, []);

  const isEmployer = user?.role === "EMPLOYER";
  React.useEffect(() => {
    if (!isLoading && !isEmployer) router.replace("/employer/auth");
  }, [isLoading, isEmployer, router]);

  React.useEffect(() => {
    if (isEmployer) void load(period);
  }, [isEmployer, load, period]);

  if (isLoading || !user || user.role !== "EMPLOYER") {
    return <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950"><Loader2 size={36} className="animate-spin text-blue-600" /></div>;
  }

  const entries = (ledger ?? []).filter((e) => showHolds || (e.entry_type !== "reserve" && e.entry_type !== "release"));
  const lowBalance = wallet && Number(wallet.available) < 1;

  return (
    <AccountManagementShell
      kind="employer"
      name={user.name || "Employer"}
      accountLabel={formatEmployerType(user.employer_type)}
      employerType={user.employer_type}
      onLogout={() => void logout()}
    >
      <WorkerPageFrame>
        <WorkerPageHeader
          eyebrow="Employer workspace"
          title="AI Credits & Billing"
          description="One shared credit balance pays for every AI agent in your organisation."
        />

        {error && <div className="mt-6"><WorkerErrorState message={error} onRetry={() => void load(period)} /></div>}

        {!wallet && !error ? (
          <WorkerLoadingState label="Loading your credits..." />
        ) : wallet ? (
          <div className="mt-6 space-y-6">
            {wallet.status !== "active" && (
              <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <p>Your AI billing account is suspended, so AI agents are paused. Please contact GO LESKA support.</p>
              </div>
            )}

            <WorkspaceCard>
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available credits</p>
                  <p className="mt-1 text-4xl font-bold text-slate-900 dark:text-white" data-testid="available-credits">
                    {formatCredits(wallet.available)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Worth {creditsToRupees(wallet.available, wallet.credit_value_inr)} · 1 credit = ₹{formatCredits(wallet.credit_value_inr)}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-slate-500">In use right now</dt><dd className="font-semibold">{formatCredits(wallet.reserved)}</dd></div>
                  <div><dt className="text-slate-500">Used so far</dt><dd className="font-semibold">{formatCredits(wallet.total_consumed)}</dd></div>
                  <div><dt className="text-slate-500">Purchased</dt><dd className="font-semibold">{formatCredits(wallet.total_purchased)}</dd></div>
                </dl>
              </div>
              <div className={`mt-5 flex gap-3 rounded-xl p-4 text-sm ${lowBalance ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "bg-slate-50 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"}`}>
                <Coins size={18} className="mt-0.5 shrink-0" />
                <p>
                  {lowBalance ? "Your credits are almost used up — AI agents stop when the balance runs out. " : ""}
                  Online credit purchase is coming soon. Until then, contact GO LESKA support to add credits.
                </p>
              </div>
            </WorkspaceCard>

            <WorkspaceCard>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Usage by agent</h2>
                <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label="Period">
                  {PERIODS.map((p) => (
                    <button
                      key={p.days}
                      type="button"
                      aria-pressed={period === p.days}
                      onClick={() => setPeriod(p.days)}
                      className={`rounded-md px-3 py-1 text-xs font-semibold ${period === p.days ? "bg-white text-blue-700 shadow-sm dark:bg-slate-900 dark:text-blue-300" : "text-slate-600 dark:text-slate-300"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {!usage || usage.by_agent.length === 0 ? (
                <div className="mt-4"><WorkerEmptyState>No AI usage in the last {period} days.</WorkerEmptyState></div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr><th className="py-2 pr-4">Agent</th><th className="pr-4">Requests</th><th className="pr-4">Tokens</th><th className="pr-4 text-right">Credits used</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {usage.by_agent.map((a) => (
                        <tr key={a.agent}>
                          <td className="py-2 pr-4 font-medium">{agentLabel(a.agent)}</td>
                          <td className="pr-4">{a.requests}{a.failed_requests ? <span className="text-xs text-slate-500"> ({a.failed_requests} failed)</span> : null}</td>
                          <td className="pr-4">{a.total_tokens.toLocaleString("en-IN")}</td>
                          <td className="pr-4 text-right font-semibold">{formatCredits(a.credits_charged)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td className="py-2 pr-4">Total</td>
                        <td className="pr-4">{usage.totals.requests}</td>
                        <td className="pr-4">{usage.totals.total_tokens.toLocaleString("en-IN")}</td>
                        <td className="pr-4 text-right">{formatCredits(usage.totals.credits_charged)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </WorkspaceCard>

            <WorkspaceCard>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Recent AI requests</h2>
              {!usage || usage.events.length === 0 ? (
                <div className="mt-4"><WorkerEmptyState>No AI requests in the last {period} days.</WorkerEmptyState></div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr><th className="py-2 pr-4">When</th><th className="pr-4">Agent</th><th className="pr-4">Status</th><th className="pr-4">Tokens</th><th className="pr-4 text-right">Credits</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {usage.events.map((e) => (
                        <tr key={e.id}>
                          <td className="whitespace-nowrap py-2 pr-4">{formatDate(e.started_at)}</td>
                          <td className="pr-4">{agentLabel(e.executing_agent)}</td>
                          <td className="pr-4">{STATUS_LABELS[e.status] ?? e.status}</td>
                          <td className="pr-4">{e.total_tokens?.toLocaleString("en-IN") ?? "—"}</td>
                          <td className="pr-4 text-right">{formatCredits(e.credits_charged)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </WorkspaceCard>

            <WorkspaceCard>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Credit history</h2>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={showHolds} onChange={(e) => setShowHolds(e.target.checked)} />
                  Show temporary holds
                </label>
              </div>
              {entries.length === 0 ? (
                <div className="mt-4"><WorkerEmptyState>No credit transactions yet.</WorkerEmptyState></div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr><th className="py-2 pr-4">When</th><th className="pr-4">Type</th><th className="pr-4 text-right">Change</th><th className="pr-4 text-right">Balance</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {entries.map((e) => {
                        const change = entryChange(e);
                        return (
                          <tr key={e.id}>
                            <td className="whitespace-nowrap py-2 pr-4">{formatDate(e.created_at)}</td>
                            <td className="pr-4 font-medium">{entryLabel(e)}</td>
                            <td className={`pr-4 text-right font-semibold ${change.startsWith("+") ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{change}</td>
                            <td className="pr-4 text-right">{formatCredits(e.available_after)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </WorkspaceCard>
          </div>
        ) : null}
      </WorkerPageFrame>
    </AccountManagementShell>
  );
}
