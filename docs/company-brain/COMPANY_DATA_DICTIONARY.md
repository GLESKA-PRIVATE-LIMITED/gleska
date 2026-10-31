# Company Data Dictionary

The single source of business definitions for Company Brain. Each metric is implemented exactly
once, in `gleska-backend-f/app/company_brain/metrics.py`, and the metric id below is what appears in
answers and evidence. The model may only *name* these metrics; it cannot define new ones.

Conventions
- **Organisation** = the caller's `employer_profiles` row. Every query is filtered by it.
- **Today / periods** use India time (`Asia/Kolkata`). A period is `[start, end)` on the stated date
  column. "This month" = 1st of the current month to today inclusive.
- **Money** is `Decimal`, summed **per currency** (INR/USD/EUR/…); currencies are never added together.
- **Status sets** below are exhaustive; any other value is reported as "unrecognised" rather than
  silently counted.

## Workforce (Hiring agent)

| Metric id | Definition | Source & rule |
|---|---|---|
| `workforce.engaged_workers` | Workers who have ever been accepted for any of the organisation's jobs | distinct `job_matches.worker_profile_id` where `status ∈ {ACCEPTED, IN_PROGRESS, ARRIVED, COMPLETED}` |
| `workforce.active_workers` | Workers currently assigned | distinct worker where match `status ∈ {ACCEPTED, IN_PROGRESS, ARRIVED}` **and** `jobs.status ∈ {SEARCHING, FILLED}`. Note: the employer dashboard's "active" count uses `ACCEPTED` only (`job_match_service.py:140-150`); the two agree unless IN_PROGRESS/ARRIVED rows exist. |
| `workforce.pending_candidates` | Matches awaiting the employer's decision | `job_matches.status = PENDING` |
| `workforce.open_jobs` | Jobs still recruiting | `jobs.status = SEARCHING` |
| `workforce.headcount_gap` | Unfilled positions on open jobs | Σ max(`headcount_required` − active workers on that job, 0) for `SEARCHING` jobs |
| `workforce.present_on(date)` | Workers present on a date | `attendance.status ∈ {PRESENT, LATE}` on `attendance_date` |
| `workforce.attendance_issues(period)` | Workers with LATE or ABSENT records | count of `attendance.status ∈ {LATE, ABSENT}` per worker in period |
| `workforce.daily_wage_cap_commitment` | **Upper bound** of daily wage exposure: sum of each active worker's job `max_daily_salary` | This is the *offered maximum per day*, not payroll. Gleska stores no agreed wage or salary payments. |
| "Registered employee" | **Not defined** — Gleska has no employee register. Company Brain answers with `engaged_workers` and says so. | — |
| "Joined this month" | **Not available** — no acceptance date is stored (`job_matches` has no `accepted_at`). | — |

## Receivables (Financial agent – invoices you issued)

| Metric id | Definition | Source & rule |
|---|---|---|
| `receivables.invoiced` | Value of issued invoices | Σ `financial_invoices.total` where `status = GENERATED`, by `issue_date` in period, per currency |
| `receivables.received` | Customer payments recorded | Σ `financial_invoice_payments.amount` by `payment_date` in period, per invoice currency |
| `receivables.outstanding` | Money still owed to you (as of today) | per GENERATED invoice: max(`total` − Σ payments, 0); summed per currency |
| `receivables.overdue` | Outstanding past due date | `outstanding > 0` and `due_date < today` |
| `receivables.by_customer` | Outstanding per `client_name` (free text, exact match) | — |
| DRAFT invoices | Excluded from every receivable metric | — |

## Spending

| Metric id | Definition | Source & rule |
|---|---|---|
| `spend.supplier_bills` | **Recorded** supplier bills (scanned and confirmed) | Σ `financial_vendor_bills.total` by `bill_date` (falls back to `confirmed_at` date when `bill_date` is null, flagged), per currency. Bills with null total are counted separately as "amount unknown". |
| `spend.platform_payments` | What you paid Gleska (subscriptions, commissions) | Σ `payment_transactions.amount` where `status = SUCCESS`, by `payment_success_at` |
| `spend.ai_credits_purchased` | AI credits bought | Σ `credit_purchase_orders.amount_inr` where `status = PAID`, by `paid_at` |
| "Paid expenditure" | Only `spend.platform_payments` and `spend.ai_credits_purchased` are known to be **paid**. Supplier bills have no payment status. | — |
| "Outstanding payables" | **Not available** — supplier bills have no paid/unpaid tracking. | — |
| "Total expenditure" | Never reported as one number. Company Brain lists the components above separately, plus procurement commitments (below), and states that supplier bills and purchase orders may describe the same purchase (no link exists). | — |
| "Department spending" | **Not available** — no department data. | — |

## Procurement

| Metric id | Definition | Source & rule |
|---|---|---|
| `procurement.order_value(po)` | `unit_price × quantity`, excl. tax, in PO currency | no total column exists |
| `procurement.open_commitments` | Orders accepted by the supplier and not yet fully delivered | `status ∈ {ACCEPTED, PREPARING, DISPATCHED, PARTIALLY_DELIVERED}` |
| `procurement.awaiting_supplier` | Orders issued, not yet accepted | `status = ISSUED` (Gleska has no internal approval step; "awaiting approval" maps here and Company Brain says so) |
| `procurement.delivered_value` | Completed orders | `status = DELIVERED`, by `delivery_date` (else `updated_at`) |
| `procurement.cancelled_or_rejected` | Excluded from commitments | `status ∈ {CANCELLED, REJECTED}` |
| `procurement.delayed_deliveries` | Open orders past their estimated date | open commitment with `estimated_delivery_date < today` |
| `procurement.by_supplier` | Order value per `supplier_companies.name` | over the requested status set |
| `procurement.open_rfqs` | RFQs collecting quotations | `procurement_rfqs.status = OPEN` |

## Logistics (migration 107)

| Metric id | Definition |
|---|---|
| `logistics.listings_<status>` | Your vehicle listings by status `ACTIVE`, `DISPATCHED`, `MAINTENANCE` (archived excluded) |
| `logistics.requests_<status>` | Your vehicle rental requests by status `SUBMITTED`, `CONFIRMED`, `IN_TRANSIT`, `COMPLETED` |
| `logistics.open_request_rates` | Σ `offered_price` of open requests (submitted/confirmed/in transit), **per price unit** (per day/trip/km/ton); units are never added together |
| "Transportation expenditure" | **Not available** — rates are per unit and durations are free text; trips/costs are not tracked |

## AI usage

| Metric id | Definition |
|---|---|
| `ai.balance` | `credit_wallets.available` |
| `ai.usage(period)` | Σ `ai_usage_events.credits_charged` by `executing_agent`, by `started_at` |

## Not available (stated explicitly in answers)

| Domain | Reason |
|---|---|
| Tenders (active, pipeline value, deadlines, won/lost, documents) | Tender Filing/Tracking are UI placeholders with no stored data |
| Industrial maintenance (machines, overdue maintenance, failures, cost) | No page, backend or tables exist |
| Payroll, salary obligation, departments, expenses outside supplier bills | No tables exist |

Procurement deliveries are **not** logistics: "delayed deliveries" questions are answered from
purchase-order delivery dates and labelled as such.

## Cross-domain rules
1. Different currencies are reported side by side, never summed (no FX conversion for company data).
2. "Exposure" = `procurement.open_commitments` + `procurement.awaiting_supplier` (shown separately)
   + `workforce.daily_wage_cap_commitment` (labelled as a per-day upper bound) + open logistics
   request rates (per unit, not a total). Nothing is double counted because the three come from disjoint tables.
3. Comparisons between periods use the same metric and date column for both periods.
