# ADR 0007: Central AI gateway, metering and prepaid credit billing

- Status: Accepted 2026-10-31 (increment 1 merged to `main` in 4e2be7f at the owner's request)
- Date: 2026-10-31
- Audit: docs/audits/2026-10-31-gemini-integration-audit.md

## Context
Seven backend call sites talk to Gemini directly with the company key; none records usage or cost.
The owner wants prepaid credits: 1 credit = ₹20, customer charge = provider cost (INR) × 1.10,
one shared wallet per organisation, no subscription, no unmetered AI calls, no invented prices.

## Decision (proposed)
**One backend module owns every LLM call:** `app/ai_gateway/`
- `contracts.py` — provider-neutral `AIRequest` / `AIResult` / `Usage` (input, cached input, output,
  thinking, per-modality tokens, provider request id, latency, usage status confirmed|estimated|unavailable).
- `providers/gemini.py` — the only code allowed to call `generativelanguage.googleapis.com`; parses
  `usageMetadata` and `responseId`. Future providers implement the same adapter interface.
- `pricing.py` — loads the active `ai_model_pricing` version for (provider, model, at time), converts
  USD→INR with the recorded FX rate, applies the configured multiplier (1.10), computes credits.
  Python `Decimal` + Postgres `NUMERIC`; rounding only at the transaction (half-up, 6 dp credits, 4 dp INR).
- `gateway.py` — `await ai_gateway.generate(request, context)`: resolve billing account → check
  limits → **reserve** (DB function, row lock) → call adapter → price actual usage → **settle**
  (DB function) → write usage event. Context = org, user, initiating agent, executing agent,
  operation, conversation, parent task, idempotency key.
- Architecture test fails CI if any file outside `app/ai_gateway/providers/` references the Gemini host
  or `GEMINI_API_KEY`.

**Money lives in Postgres functions, not Python:** `billing_reserve`, `billing_settle`, `billing_release`,
`billing_credit_purchase`, `billing_admin_adjust` — `SECURITY DEFINER`, fixed `search_path`, granted to
`service_role` only, `SELECT … FOR UPDATE` on the wallet row, idempotency keys with unique constraints,
`CHECK (available >= 0)`. The ledger is append-only (no UPDATE/DELETE grants, trigger guard).

**Tables (migration 104+):** `billing_accounts` (1:1 employer_profiles), `credit_wallets`,
`credit_ledger`, `credit_reservations`, `ai_usage_events`, `ai_provider_configs`, `ai_model_pricing`
(versioned, effective-dated), `billing_settings` (multiplier, credit value, FX — versioned),
`credit_packages`, `credit_purchases` (links existing `payment_transactions`), `billing_invoices`,
`usage_limits`, `billing_audit_logs`, `ai_reconciliation_imports`. RLS on all; customers may only
SELECT their own account's rows; all writes via backend/DB functions.

**Payments:** reuse Cashfree PG (`cashfree_payment_service`) with a `crd_` order prefix; the existing
signed webhook credits the wallet exactly once via `billing_credit_purchase(order_id)`.

**UI:** employer "Billing Management" in `AccountManagementShell` (overview, usage analytics,
agent-wise, transactions + CSV, wallet, invoices, spending controls, settings); admin "Billing" in
`AdminShell` (accounts, platform usage, pricing versions, multiplier, adjustments with reason,
failed/unmetered requests, reconciliation, audit log).

**Delivery in reviewable increments** (each tested and deployable):
1. Schema + DB functions + pricing engine + gateway + Gemini adapter + migrate G1–G7 (+ tests, concurrency tests).
2. Credit purchase via Cashfree + invoices/receipts.
3. Employer Billing Management UI.
4. Admin Billing console + reconciliation.

## Owner decisions (2026-10-31)
1. **Enforce immediately**: no price or no credits → AI requests are refused (no shadow mode).
   Consequence: increment 1 must not reach production before admins can set prices and grant or
   sell credits (increments 2 and 4), or every AI feature stops.
2. **Overrun**: charge beyond the reservation from the available balance down to zero; record the
   rest as `credits_unrecovered` for admin review; the empty wallet blocks further requests.
3. **Prices and USD→INR rate are entered by admins**, versioned with effective dates and a source note.
4. **Not GST-registered yet**: receipts without GST for now; GST fields added when registered.
5. **Credit purchase (increment 2, decided 2026-10-31)**: custom whole-credit amount only (no packs),
   min 5 / max 2,500 credits per payment (₹100–₹50,000 at ₹20/credit). Build after increment 3.
6. **Employers never see Gleska's provider cost or the markup** (`/billing/usage` omits
   `provider_cost*`; `/billing/wallet` omits `markup_multiplier`); admin adjustment reasons stay internal.

## Implementation status
- Increment 1 (done; on `main`; migration 104 applied to production 2026-10-31): migration 104 + SQL tests + concurrency test;
  `app/ai_gateway/` (context, pricing, Gemini adapter, backend, gateway); all 7 call sites (G1–G7)
  migrated; architecture test; employer `/api/v1/billing/*` and admin `/api/v1/admin/billing/*` APIs.
- No streaming call sites exist; the gateway is non-streaming until one is added.
- Usage reports aggregate up to 5,000 events in Python — move to SQL aggregation before volume grows.
- Admin console page `/admin/billing` (prices, FX, settings, wallets + adjustments, usage, audit log).
- Increment 3 (done 2026-10-31): employer page `/employer/billing` ("AI Credits" in the employer
  sidebar): balance, usage by agent (7/30/90 days), recent AI requests, credit history.
- Increment 2 (built 2026-10-31, migration 105 not yet applied): employers buy 5–2,500 whole
  credits on `/employer/billing`; server prices the order (credits × credit value), Cashfree
  order id `cred_…`; credits added only by `billing_complete_purchase` after a signed webhook or a
  server-side order lookup (idempotent, amount re-checked to the paisa); the shared Cashfree
  webhook routes `cred_` orders away from subscription logic; printable receipts
  (`GLK-CR-NNNNNN`, no GST); admin "Credit purchases" table.
- Next: increment 4 (reconciliation of held/pending reservations and of payments received for
  closed orders, spending limits).

## Consequences
Every AI feature depends on the billing database: if it is unavailable, AI calls fail closed.
Adding a provider = one adapter + pricing rows, no billing changes. Prices and multiplier change by
admin action with audit history, never by deploy.
