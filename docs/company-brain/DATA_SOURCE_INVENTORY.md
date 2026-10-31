# Company Brain — Data Source Inventory

Audited 2026-10-31 against the **live** Supabase schema (project "WEBSITE FINAL", Postgres 17.6) and
the code at commit `2bef4d8`. Every table, column and status below was read from
`information_schema` / `pg_constraint` or from the cited file; nothing is inferred.
Paths: `B/` = `gleska-backend-f/app/`, `M/` = `gleska-website/supabase/migrations/`.

## 1. Organisation model (the tenant boundary)

| Fact | Evidence |
|---|---|
| An organisation is one `employer_profiles` row; its owner is `employer_profiles.user_id → users.id`. | FK `employer_profiles.user_id -> users.id` |
| There is **no** multi-user organisation, membership or department table for employers. The employer user is the only person with access. | No such table in live schema |
| Backend resolves the org from the caller: `employer_profiles.eq("user_id", user.id)`, then filters `employer_id`. | `B/services/job_service.py:33-60`, `B/services/financial_service.py:105-125` |
| Role comes from `users.role` (`WORKER`/`EMPLOYER`/`ADMIN`). | enum `user_role` |

Consequence: Company Brain's "owner / management" = the `EMPLOYER` user of the organisation. There
is no way yet to grant a second manager access, so role-based access inside an organisation is
limited to "owner only" (see SECURITY_DESIGN.md).

## 2. Source-by-source inventory

Status legend: **Live DB** = persisted server-side, queryable now · **Browser only** = stored in
the user's browser, unreachable from the server · **None** = placeholder UI, no data.

| Agent / source | Status | Location | Tables / store | Org link | Freshness | Integrated in Company Brain |
|---|---|---|---|---|---|---|
| Hiring – jobs & sites | Live DB | Postgres | `jobs`, `job_sites` | `employer_id` | live | Yes |
| Hiring – matches (workforce) | Live DB | Postgres | `job_matches` | via `jobs.employer_id` | live | Yes |
| Hiring – attendance | Live DB | Postgres | `attendance`, `attendance_audit` | `employer_id` | live | Yes |
| Hiring – worker profiles | Live DB | Postgres | `worker_profiles` (+`users.name`) | via matches only | live | Yes (name, trade, daily wage expectation only) |
| Platform payments (subscriptions / commissions) | Live DB | Postgres | `payment_transactions` | `employer_id` | live | Yes |
| Financial – invoices (receivables) | Live DB | Postgres | `financial_invoices`, `financial_invoice_items`, `financial_invoice_payments` | `employer_id` + `user_id` | live | Yes |
| Financial – supplier bills (scanned) | Live DB | Postgres + bucket `financial-invoice-scans` | `financial_vendor_bills`, `financial_vendors`, `financial_invoice_scans` (has `extracted_text`) | `employer_id` + `user_id` | live | Yes (structured) + document text (RAG) |
| Financial – audits | Live DB | Postgres | `financial_audit_runs`, `financial_audit_check_results` | `employer_id` | live | Yes (latest run summary) |
| Procurement – requests / RFQs / quotations | Live DB | Postgres | `procurement_material_requests`, `procurement_rfqs`, `procurement_rfq_recipients`, `procurement_supplier_quotations` | `employer_id` | live | Yes |
| Procurement – purchase orders & deliveries | Live DB | Postgres | `procurement_purchase_orders`, `procurement_purchase_order_fulfillment_events` | `employer_id` | live | Yes |
| Suppliers (procurement counterparties) | Live DB | Postgres | `supplier_companies` (name only) | via POs/quotations | live | Yes (name) |
| AI credits & usage | Live DB | Postgres | `credit_wallets`, `ai_usage_events`, `credit_purchase_orders` | `billing_accounts.employer_id` | live | Yes |
| General Work – chats & files | Live DB | Postgres + bucket `assistant-uploads` | `general_work_conversations/messages/files` | `user_id` (= owner) | live | Files: RAG (opt-in); chats: **not** used as facts |
| Company Brain uploads (**planned**, migration 106) | — | Postgres + bucket `assistant-uploads` | `company_brain_documents/chunks` | `employer_id` | indexed | Planned (RAG) |
| Company profile | Live DB | Postgres | `employer_onboarding_details` (business name, city, industry) | `employer_id` | live | Yes (non-sensitive fields only) |
| Logistics agent (vehicles lent, rental requests) | Live DB **after migration 107** (was browser-only `localStorage` until 2026-10-31) | Postgres | `logistics_vehicle_listings`, `logistics_rental_requests` | `employer_id` | live | Yes. The fleet *search pool* is still a hard-coded demo array in `dashboard.tsx` and is not company data. |
| **Tender Filing / Tender Tracking** | **None** | UI placeholders ("Backend & Forms not implemented") | — | — | — | **No — no data exists** |
| **Industrial Maintenance** | **None** | only `src/components/agents/industrial-maintenance/maintenanceConfig.ts`; no page, backend or table | — | — | — | **No — no data exists** |
| Payroll / salary register | **None** | no table | — | — | — | No |
| Expenses (other than supplier bills) | **None** | no table | — | — | — | No |
| Departments / cost centres | **None** | no column anywhere | — | — | — | No |
| Customers master | **None** | only free-text `financial_invoices.client_name` | — | — | — | Partial (by name) |

Legacy tables present in the live DB but **unused by the backend** (0 references in `B/`):
`employers`, `workers`, `booking_history`, `conversations`, `messages`, `skills`, `worker_skills`.
Company Brain ignores them — their contents are not the current source of truth.

Excluded on purpose (not company-operational data, or sensitive): `users.mobile`, Aadhaar/PAN/bank
fields in `employer_onboarding_details`, `employer_verifications.provider_metadata` (KI-21),
`connector_tokens`, `user_sessions`, `security_activity`, `password_reset_challenges`, OTP columns
on `job_matches`, worker documents and selfies.

## 3. Field-level detail per integrated source

### Hiring
- `jobs`: `id, employer_id, job_site_id, title, headcount_required, max_daily_salary (per day, cap),
  monthly_salary, status, work_duration_days, work_timing, trade_id, required_skills, created_at, updated_at`.
  Status (no CHECK; code values): `SEARCHING, FILLED, COMPLETED, CANCELLED` (`M/040`, `M/058`).
  Live values 2026-10-31: SEARCHING 13, CANCELLED 9.
- `job_matches`: `id, job_id, worker_profile_id, status, composite_score, expires_at, started_at,
  completed_at, created_at`. Status (no CHECK; code): `PENDING, ACCEPTED, REJECTED, IN_PROGRESS,
  ARRIVED, COMPLETED, CANCELLED` (+`EXPIRED` in admin only). **No `accepted_at` column**, so the
  date a worker "joined" is not recorded. No agreed wage on the match.
- `attendance`: `employer_id, job_match_id, worker_profile_id, job_id, job_site_id, attendance_date,
  status (PRESENT|LATE|ABSENT), check_in_at, check_out_at, employer_manual_override, correction_reason`.
  Check-in always writes PRESENT; LATE/ABSENT only via employer correction (`B/services/attendance_service.py`).
- `job_sites`: `id, employer_id, name, address, city, state, pincode`.
- Retrieval: service-role client, `.eq("employer_id", org)`; matches via `jobs!inner(employer_id)`.

### Platform payments
- `payment_transactions`: `employer_id, amount (double precision!), currency='INR', status
  (PENDING|SUCCESS|FAILED|CANCELLED|EXPIRED), payment_category (BUSINESS_SUBSCRIPTION=₹2000,
  INDIVIDUAL_COMMISSION=₹30, …), payment_success_at, created_at`. Amount is a float column; Company
  Brain converts via `Decimal(str(x))` and the CHECK constraints pin exact values.

### Financial (receivables)
- `financial_invoices`: `invoice_number, client_name, issue_date, due_date, currency (INR|USD|EUR),
  subtotal, tax_amount, total (=subtotal+tax, CHECK), status (DRAFT|GENERATED)`.
- `financial_invoice_payments`: `invoice_id, amount (>0), payment_date, payment_reference`.
- Payment status is **computed**, not stored: UNPAID / PARTIALLY_PAID / PAID; overdue =
  outstanding > 0 and `due_date < as_of` (`B/services/financial_service.py:452-466`). Only GENERATED
  invoices are receivables.

### Financial (payables side)
- `financial_vendor_bills`: `vendor_name, vendor_id, bill_number, bill_date, due_date, currency,
  subtotal, tax_amount, total (all nullable), confirmed_at, scan_id`. **No paid/unpaid status and no
  payment table** → outstanding payables cannot be computed.
- `financial_invoice_scans.extracted_text` holds OCR text of the scanned bill (document source).

### Procurement
- `procurement_purchase_orders`: `order_reference, employer_id, supplier_company_id, item_name,
  quantity, unit, unit_price NUMERIC(18,4), currency (INR|USD|EUR|GBP|AED), status, created_at,
  dispatch_date, estimated_delivery_date, delivery_date, delivered_quantity`.
  Status: `ISSUED, ACCEPTED, REJECTED, CANCELLED, PREPARING, DISPATCHED, PARTIALLY_DELIVERED, DELIVERED`.
  **No total, tax or approval column**: order value = `unit_price × quantity` (excl. tax).
  No link to `financial_vendor_bills` → a PO and the bill for it cannot be de-duplicated automatically.
- `procurement_rfqs`: status `OPEN|CLOSED`, `quotation_deadline`. Quotations have no status.

### Documents (RAG candidates)
| Store | Bucket | Text available | Org scope |
|---|---|---|---|
| Company Brain uploads (planned) | `assistant-uploads` (`<user_id>/company-brain/…`) | extracted at ingest | employer |
| Scanned supplier bills | `financial-invoice-scans` | `financial_invoice_scans.extracted_text` | employer |
| General Work files | `assistant-uploads` | not stored; extracted on demand | user (= owner) |

No generated documents (invoice PDFs, PO PDFs) are stored anywhere (`grep pdf` in financial/procurement services: none).

## 4. Update mechanisms and freshness
All integrated structured sources are written synchronously by their agents' APIs; there is no
event bus, CDC or replication. Company Brain therefore **queries them live on every question** (no
copies), so structured answers are as fresh as the source tables. Only document chunks are
derived data; they carry `indexed_at` and the source's `updated_at` (see RETRIEVAL_AND_RAG_DESIGN.md).

## 5. Known limitations
1. Tender and maintenance data do not exist server-side; questions about them are answered with an
   explicit "not available" naming the reason. Logistics covers only vehicle listings and rental
   requests (no trips, shipments or transport costs).
2. No departments, payroll, expense or payables tracking exist.
3. No date when a worker was accepted ("joined").
4. PO value excludes tax; PO ↔ bill matching is impossible without a shared key.
5. `payment_transactions.amount` is a float column (values are pinned by CHECKs).
6. Single-user organisations only.
