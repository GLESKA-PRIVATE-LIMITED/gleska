import apiClient from "@/lib/api";

/** Amounts arrive as decimal strings from the backend; never do money maths with floats. */
export interface Wallet {
  account_id: string;
  status: "active" | "suspended" | string;
  available: string;
  reserved: string;
  total_purchased: string;
  total_consumed: string;
  total_refunded: string;
  total_adjusted: string;
  total_unrecovered: string;
  credit_value_inr: string;
}

export interface UsageTotals {
  requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  total_tokens: number;
  customer_charge_inr: string;
  credits_charged: string;
}

export interface AgentUsage extends UsageTotals {
  agent: string;
}

export interface UsageEvent {
  id: string;
  started_at: string;
  executing_agent: string;
  initiating_agent?: string;
  operation: string;
  model: string;
  status: string;
  total_tokens: number | null;
  credits_charged: string | null;
  error_code: string | null;
}

export interface UsageReport {
  totals: UsageTotals;
  by_agent: AgentUsage[];
  events: UsageEvent[];
}

export interface LedgerEntry {
  id: number;
  entry_type: "purchase" | "reserve" | "release" | "settle" | "refund" | "adjustment" | string;
  delta_available: string;
  available_after: string;
  credits_consumed: string;
  description: string | null;
  created_at: string;
}

export const billingApi = {
  wallet: () => apiClient.get<Wallet>("/api/v1/billing/wallet").then((r) => r.data),
  usage: (start: string) =>
    apiClient.get<UsageReport>("/api/v1/billing/usage", { params: { start, limit: 50 } }).then((r) => r.data),
  ledger: () =>
    apiClient.get<{ entries: LedgerEntry[] }>("/api/v1/billing/ledger", { params: { limit: 100 } }).then((r) => r.data.entries),
};

const AGENT_LABELS: Record<string, string> = {
  hiring: "Hiring",
  financial: "Financial",
  procurement: "Procurement",
  general_work: "General Work",
  logistics: "Logistics",
  tender: "Tender",
};

export function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const ENTRY_LABELS: Record<string, string> = {
  purchase: "Credits purchased",
  adjustment: "Credits added by GO LESKA",
  settle: "AI usage",
  reserve: "Held for AI request",
  release: "Hold released",
  refund: "Refund",
};

export function entryLabel(entry: LedgerEntry): string {
  if (entry.entry_type === "adjustment" && entry.delta_available.startsWith("-")) return "Credits removed by GO LESKA";
  return ENTRY_LABELS[entry.entry_type] ?? entry.entry_type;
}

/** Trim a decimal string for display ("12.500000" → "12.5", "3" → "3"). Display only. */
export function formatCredits(value: string | null | undefined): string {
  if (!value) return "0";
  const negative = value.startsWith("-");
  const raw = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = raw.split(".");
  const shown = fraction.slice(0, 2).replace(/0+$/, "");
  const result = `${Number(whole).toLocaleString("en-IN")}${shown ? `.${shown}` : ""}`;
  return negative && result !== "0" ? `-${result}` : result;
}

/** Rupee value of a credit amount, for display only (credits × credit value, rounded to paise). */
export function creditsToRupees(credits: string, creditValueInr: string): string {
  const paise = Math.round(Number(credits) * Number(creditValueInr) * 100);
  return (paise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" });
}
