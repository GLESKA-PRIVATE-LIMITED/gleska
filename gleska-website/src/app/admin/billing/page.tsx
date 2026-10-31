"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Plus, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import AdminShell from "@/components/admin/AdminShell";
import apiClient from "@/lib/api";

const API = "/api/v1/admin/billing";

interface Status {
  model: string | null;
  api_key_configured: boolean;
  migration_applied: boolean;
  price: { id: string; version: number; currency: string } | null;
  fx_rate: string | null;
  credit_value_inr?: string;
  markup_multiplier?: string;
  missing: string[];
  ready: boolean;
}

interface PriceRow {
  id: string;
  provider: string;
  model: string;
  version: number;
  currency: string;
  input_price: string;
  output_price: string;
  cached_input_price: string | null;
  is_active: boolean;
  effective_from: string;
  source_note: string;
}

interface Wallet {
  available: string;
  reserved: string;
  total_consumed: string;
  total_unrecovered: string;
}

interface Account {
  id: string;
  status: "active" | "suspended";
  employer_name: string | null;
  employer_email?: string | null;
  employer_phone_last4?: string | null;
  wallet: Wallet | null;
}

interface AgentUsage {
  agent: string;
  requests: number;
  total_tokens: number;
  credits_charged: string;
  customer_charge_inr: string;
  provider_cost_inr: string;
}

interface UsageReport {
  totals: AgentUsage;
  by_agent: AgentUsage[];
}

interface AuditEntry {
  id: number;
  action: string;
  target_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => (d as { msg?: string }).msg).filter(Boolean).join("; ") || fallback;
  return fallback;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const buttonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export default function AdminBillingPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [purchases, setPurchases] = useState<AdminPurchase[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/admin/login");
    else if (!isLoading && user && user.role !== "ADMIN") router.replace("/");
  }, [isLoading, router, user]);

  const load = useCallback(() => {
    return apiClient
      .get<Status>(`${API}/status`)
      .then(async ({ data }) => {
        setStatus(data);
        if (!data.migration_applied) return;
        const [p, a, u, l] = await Promise.all([
          apiClient.get<{ pricing: PriceRow[] }>(`${API}/pricing`),
          apiClient.get<{ accounts: Account[] }>(`${API}/accounts`),
          apiClient.get<UsageReport>(`${API}/usage`, { params: { limit: 1 } }),
          apiClient.get<{ entries: AuditEntry[] }>(`${API}/audit-log`, { params: { limit: 20 } }),
        ]);
        setPrices(p.data.pricing);
        setAccounts(a.data.accounts);
        setUsage(u.data);
        setAudit(l.data.entries);
        // Separate request: works (as "not available") even before migration 105 is applied.
        await apiClient
          .get<{ purchases: AdminPurchase[] }>(`${API}/purchases`)
          .then((r) => setPurchases(r.data.purchases))
          .catch(() => setPurchases(null));
      })
      .catch((error) => toast.error(errorText(error, "Couldn't load billing data.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user?.role === "ADMIN") void load();
  }, [user, load]);

  if (isLoading || !user || user.role !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb]">
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <AdminShell name={user.name} email={user.email} onLogout={() => void logout()}>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700">
              AI Billing
            </div>
            <h1 className="mt-2 font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl">
              Billing Management
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Model prices, exchange rate, credit rules and employer wallets. Every change is versioned and audited.
            </p>
          </div>
          <button type="button" onClick={() => { setLoading(true); void load(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RotateCw size={14} /> Refresh
          </button>
        </div>

        {loading && !status ? (
          <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-blue-600" /></div>
        ) : status ? (
          <>
            <ReadinessBanner status={status} />
            {status.migration_applied && (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <PriceForm defaultModel={status.model ?? ""} onSaved={load} />
                  <div className="space-y-6">
                    <FxForm onSaved={load} current={status.fx_rate} needed={status.price ? status.price.currency !== "INR" : true} />
                    <SettingsForm status={status} onSaved={load} />
                  </div>
                </div>
                <PriceList prices={prices} onChanged={load} />
                <AccountsTable accounts={accounts} onChanged={load} />
                <UsageSummary usage={usage} />
                <PurchasesTable purchases={purchases} />
                <AuditLog entries={audit} />
              </>
            )}
          </>
        ) : null}
      </main>
    </AdminShell>
  );
}

function ReadinessBanner({ status }: { status: Status }) {
  if (status.ready) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">AI billing is ready. AI features run for employers who have credits.</p>
          <p className="mt-0.5 text-emerald-700">
            Model <b>{status.model}</b> · price v{status.price?.version} ({status.price?.currency})
            {status.fx_rate ? ` · 1 ${status.price?.currency} = ₹${status.fx_rate}` : ""} · 1 credit = ₹{status.credit_value_inr} · multiplier ×{status.markup_multiplier}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">AI features are switched off until these are done:</p>
        <ul className="mt-1 list-disc pl-5">
          {status.missing.map((item) => <li key={item}>{item}</li>)}
        </ul>
        {status.model && <p className="mt-1 text-amber-700">Model used by the backend: <b>{status.model}</b></p>}
      </div>
    </div>
  );
}

function PriceForm({ defaultModel, onSaved }: { defaultModel: string; onSaved: () => void }) {
  const empty = { model: defaultModel, currency: "USD", input_price: "", output_price: "", cached_input_price: "", source_note: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiClient.post(`${API}/pricing`, {
        model: form.model.trim(),
        currency: form.currency,
        input_price: form.input_price,
        output_price: form.output_price,
        cached_input_price: form.cached_input_price || null,
        source_note: form.source_note.trim(),
      });
      toast.success("New price version saved.");
      setForm({ ...empty, model: form.model });
      onSaved();
    } catch (error) {
      toast.error(errorText(error, "Couldn't save the price."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={cardClass}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Model price</h2>
      <p className="mb-4 mt-1 text-xs text-slate-500">
        Prices per <b>1,000,000 tokens</b>, copied from Google&apos;s official Gemini pricing page. Saving creates a new version; old versions stay in history.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Model"><input className={inputClass} value={form.model} onChange={set("model")} required /></Field>
        <Field label="Currency">
          <select className={inputClass} value={form.currency} onChange={set("currency")}>
            <option value="USD">USD</option>
            <option value="INR">INR</option>
          </select>
        </Field>
        <Field label="Input price / 1M tokens"><input className={inputClass} inputMode="decimal" value={form.input_price} onChange={set("input_price")} required /></Field>
        <Field label="Output price / 1M tokens" hint="Thinking tokens are billed at this rate."><input className={inputClass} inputMode="decimal" value={form.output_price} onChange={set("output_price")} required /></Field>
        <Field label="Cached input price / 1M (optional)" hint="Leave blank to bill cached tokens at the input price."><input className={inputClass} inputMode="decimal" value={form.cached_input_price} onChange={set("cached_input_price")} /></Field>
        <Field label="Source" hint="e.g. ai.google.dev/pricing, checked 31 Oct 2026"><input className={inputClass} value={form.source_note} onChange={set("source_note")} minLength={5} required /></Field>
      </div>
      <button type="submit" disabled={busy} className={`${buttonClass} mt-4`}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Save price version
      </button>
    </form>
  );
}

function FxForm({ current, needed, onSaved }: { current: string | null; needed: boolean; onSaved: () => void }) {
  const [rate, setRate] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={cardClass}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await apiClient.post(`${API}/fx-rates`, { base_currency: "USD", rate, source: source.trim() });
          toast.success("Exchange rate saved.");
          setRate("");
          setSource("");
          onSaved();
        } catch (error) {
          toast.error(errorText(error, "Couldn't save the exchange rate."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">USD → INR exchange rate</h2>
      <p className="mb-4 mt-1 text-xs text-slate-500">
        {current ? `Current: 1 USD = ₹${current}.` : needed ? "Required for USD prices." : "Not needed while prices are in INR."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="₹ per 1 USD"><input className={inputClass} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required /></Field>
        <Field label="Source"><input className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} placeholder="RBI reference rate 31 Oct" minLength={3} required /></Field>
      </div>
      <button type="submit" disabled={busy} className={`${buttonClass} mt-4`}>{busy && <Loader2 size={14} className="animate-spin" />} Save rate</button>
    </form>
  );
}

function SettingsForm({ status, onSaved }: { status: Status; onSaved: () => void }) {
  const [value, setValue] = useState(status.credit_value_inr ?? "20");
  const [multiplier, setMultiplier] = useState(status.markup_multiplier ?? "1.10");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={cardClass}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await apiClient.post(`${API}/settings`, { credit_value_inr: value, markup_multiplier: multiplier, reason: reason.trim() });
          toast.success("Credit rules saved as a new version.");
          setReason("");
          onSaved();
        } catch (error) {
          toast.error(errorText(error, "Couldn't save credit rules."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Credit rules</h2>
      <p className="mb-4 mt-1 text-xs text-slate-500">
        Current: 1 credit = ₹{status.credit_value_inr} · customer charge = provider cost × {status.markup_multiplier}. Change only if your commercial terms change.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="₹ per credit"><input className={inputClass} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required /></Field>
        <Field label="Multiplier"><input className={inputClass} inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} required /></Field>
        <Field label="Reason"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required /></Field>
      </div>
      <button type="submit" disabled={busy} className={`${buttonClass} mt-4`}>{busy && <Loader2 size={14} className="animate-spin" />} Save new version</button>
    </form>
  );
}

function PriceList({ prices, onChanged }: { prices: PriceRow[]; onChanged: () => void }) {
  return (
    <section className={cardClass}>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Price history</h2>
      {prices.length === 0 ? (
        <p className="text-sm text-slate-500">No prices yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="py-2 pr-4">Model</th><th className="pr-4">Ver.</th><th className="pr-4">Input / Output / Cached (per 1M)</th><th className="pr-4">Since</th><th className="pr-4">Source</th><th>Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prices.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-4 font-medium">{p.model}</td>
                  <td className="pr-4">v{p.version}</td>
                  <td className="pr-4">{p.currency} {p.input_price} / {p.output_price} / {p.cached_input_price ?? "—"}</td>
                  <td className="pr-4">{new Date(p.effective_from).toLocaleDateString()}</td>
                  <td className="max-w-[16rem] truncate pr-4 text-slate-500" title={p.source_note}>{p.source_note}</td>
                  <td>
                    {p.is_active ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-rose-600 hover:underline"
                        onClick={async () => {
                          const reason = window.prompt("Reason for deactivating this price version?");
                          if (!reason || reason.trim().length < 5) return;
                          try {
                            await apiClient.post(`${API}/pricing/${p.id}/deactivate`, { reason: reason.trim() });
                            onChanged();
                          } catch (error) {
                            toast.error(errorText(error, "Couldn't deactivate."));
                          }
                        }}
                      >
                        Active · deactivate
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AccountsTable({ accounts, onChanged }: { accounts: Account[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Account | null>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? accounts.filter((a) =>
        [a.employer_name, a.employer_email, a.employer_phone_last4].some((v) => v?.toLowerCase().includes(needle)),
      )
    : accounts;
  return (
    <section className={cardClass}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Employer wallets</h2>
      <p className="mb-3 mt-1 text-xs text-slate-500">Every employer has one shared wallet for all AI agents. 1 credit = ₹20.</p>
      {accounts.length > 0 && (
        <input
          className={`${inputClass} mb-3 max-w-sm`}
          placeholder="Search by name, email or last 4 phone digits"
          aria-label="Search employers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {accounts.length === 0 ? (
        <p className="text-sm text-slate-500">No billing accounts yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500">No employer matches “{query}”.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="py-2 pr-4">Employer</th><th className="pr-4">Available</th><th className="pr-4">Reserved</th><th className="pr-4">Consumed</th><th className="pr-4">Unrecovered</th><th className="pr-4">Status</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4">
                    <div className="font-medium">{a.employer_name || "Unnamed employer"}</div>
                    <div className="text-xs text-slate-500">
                      {[a.employer_email, a.employer_phone_last4 && `phone ••${a.employer_phone_last4}`].filter(Boolean).join(" · ") || "No contact details"}
                    </div>
                  </td>
                  <td className="pr-4">{a.wallet?.available ?? "0"}</td>
                  <td className="pr-4">{a.wallet?.reserved ?? "0"}</td>
                  <td className="pr-4">{a.wallet?.total_consumed ?? "0"}</td>
                  <td className="pr-4">{a.wallet?.total_unrecovered ?? "0"}</td>
                  <td className="pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{a.status}</span>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button type="button" onClick={() => setEditing(a)} className="text-xs font-semibold text-blue-600 hover:underline">Adjust credits</button>
                    <button
                      type="button"
                      className="ml-3 text-xs font-semibold text-slate-500 hover:underline"
                      onClick={async () => {
                        const next = a.status === "active" ? "suspended" : "active";
                        const reason = window.prompt(`Reason to mark this account ${next}?`);
                        if (!reason || reason.trim().length < 5) return;
                        try {
                          await apiClient.post(`${API}/accounts/${a.id}/status`, { status: next, reason: reason.trim() });
                          onChanged();
                        } catch (error) {
                          toast.error(errorText(error, "Couldn't change status."));
                        }
                      }}
                    >
                      {a.status === "active" ? "Suspend" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <AdjustDialog account={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); onChanged(); }} />}
    </section>
  );
}

function AdjustDialog({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: () => void }) {
  const [credits, setCredits] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // One key per dialog: a double click or retry can't grant twice.
  const [idempotencyKey] = useState(() => `admin-${crypto.randomUUID()}`);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <form
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await apiClient.post(`${API}/accounts/${account.id}/adjust`, { credits, reason: reason.trim(), idempotency_key: idempotencyKey });
            toast.success("Credits updated.");
            onDone();
          } catch (error) {
            toast.error(errorText(error, "Couldn't adjust credits."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 className="text-base font-bold text-slate-900">Adjust credits · {account.employer_name || "Employer"}</h3>
        {account.employer_email && <p className="mt-0.5 text-xs text-slate-500">{account.employer_email}</p>}
        <p className="mb-4 mt-1 text-xs text-slate-500">Available now: {account.wallet?.available ?? "0"} credits. Use a negative number to remove credits.</p>
        <div className="space-y-3">
          <Field label="Credits (e.g. 50 or -10)"><input className={inputClass} inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} required autoFocus /></Field>
          <Field label="Reason (recorded in the audit log)"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={busy} className={buttonClass}>{busy && <Loader2 size={14} className="animate-spin" />} Apply</button>
        </div>
      </form>
    </div>
  );
}

function UsageSummary({ usage }: { usage: UsageReport | null }) {
  if (!usage) return null;
  const rows = usage.by_agent;
  return (
    <section className={cardClass}>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">AI usage by agent (all employers)</h2>
      <p className="mb-3 text-xs text-slate-500">
        {usage.totals.requests} requests · {usage.totals.total_tokens.toLocaleString()} tokens · provider cost ₹{usage.totals.provider_cost_inr} · charged ₹{usage.totals.customer_charge_inr} ({usage.totals.credits_charged} credits)
      </p>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="py-2 pr-4">Agent</th><th className="pr-4">Requests</th><th className="pr-4">Tokens</th><th className="pr-4">Provider cost ₹</th><th className="pr-4">Charged ₹</th><th>Credits</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.agent}>
                  <td className="py-2 pr-4 font-medium capitalize">{r.agent.replace("_", " ")}</td>
                  <td className="pr-4">{r.requests}</td>
                  <td className="pr-4">{r.total_tokens.toLocaleString()}</td>
                  <td className="pr-4">{r.provider_cost_inr}</td>
                  <td className="pr-4">{r.customer_charge_inr}</td>
                  <td>{r.credits_charged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AuditLog({ entries }: { entries: AuditEntry[] }) {
  return (
    <section className={cardClass}>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Recent billing changes</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">No changes recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-medium text-slate-800">{e.action.replaceAll("_", " ")}</span>
              <span className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface AdminPurchase {
  order_id: string;
  employer_name: string | null;
  credits: string;
  amount_inr: string;
  status: string;
  receipt_number: string | null;
  last_payment_status: string | null;
  paid_at: string | null;
  created_at: string;
}

function PurchasesTable({ purchases }: { purchases: AdminPurchase[] | null }) {
  return (
    <section className={cardClass}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Credit purchases</h2>
      <p className="mb-3 mt-1 text-xs text-slate-500">Employer payments via Cashfree. Credits are added automatically once Cashfree confirms payment.</p>
      {purchases === null ? (
        <p className="text-sm text-slate-500">Not available yet (database migration 105 not applied).</p>
      ) : purchases.length === 0 ? (
        <p className="text-sm text-slate-500">No purchases yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="py-2 pr-4">Date</th><th className="pr-4">Employer</th><th className="pr-4">Credits</th><th className="pr-4">Amount (₹)</th><th className="pr-4">Status</th><th className="pr-4">Receipt</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchases.map((p) => (
                <tr key={p.order_id}>
                  <td className="whitespace-nowrap py-2 pr-4">{new Date(p.paid_at ?? p.created_at).toLocaleString()}</td>
                  <td className="pr-4">{p.employer_name || "Unnamed employer"}</td>
                  <td className="pr-4">{p.credits}</td>
                  <td className="pr-4">{p.amount_inr}</td>
                  <td className="pr-4">{p.status}{p.status === "PENDING" && p.last_payment_status ? ` (last attempt: ${p.last_payment_status})` : ""}</td>
                  <td className="pr-4">{p.receipt_number ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
