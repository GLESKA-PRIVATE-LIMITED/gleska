# Company Brain — Database Relationship Map

Generated from the live foreign keys (`information_schema.table_constraints`, 2026-10-31). Only
tables Company Brain reads are drawn. Composite FKs (used by the financial and procurement
migrations to pin child rows to the same `(id, user_id, employer_id)` tuple) are shown once.

```mermaid
erDiagram
    users ||--o| employer_profiles : "user_id (owner)"
    employer_profiles ||--o| employer_onboarding_details : employer_id
    employer_profiles ||--o{ job_sites : employer_id
    employer_profiles ||--o{ jobs : employer_id
    job_sites ||--o{ jobs : job_site_id
    jobs ||--o{ job_matches : job_id
    worker_profiles ||--o{ job_matches : worker_profile_id
    users ||--o| worker_profiles : user_id
    job_matches ||--o{ attendance : job_match_id
    employer_profiles ||--o{ attendance : employer_id
    employer_profiles ||--o{ payment_transactions : "employer_id (nullable)"
    jobs ||--o{ payment_transactions : "job_id (commission)"

    employer_profiles ||--o{ financial_invoices : employer_id
    financial_invoices ||--o{ financial_invoice_items : invoice_id
    financial_invoices ||--o{ financial_invoice_payments : invoice_id
    employer_profiles ||--o{ financial_vendors : employer_id
    financial_vendors ||--o{ financial_vendor_bills : vendor_id
    financial_invoice_scans ||--o| financial_vendor_bills : "scan_id / confirmed_bill_id"
    employer_profiles ||--o{ financial_audit_runs : employer_id
    financial_audit_runs ||--o{ financial_audit_check_results : run_id

    employer_profiles ||--o{ procurement_material_requests : employer_id
    procurement_material_requests ||--o{ procurement_rfqs : material_request_id
    procurement_rfqs ||--o{ procurement_rfq_recipients : rfq_id
    procurement_rfqs ||--o{ procurement_supplier_quotations : rfq_id
    procurement_rfqs ||--o| procurement_purchase_orders : "rfq_id (unique)"
    procurement_supplier_quotations ||--o| procurement_purchase_orders : quotation_id
    supplier_companies ||--o{ procurement_purchase_orders : supplier_company_id
    supplier_companies ||--o{ procurement_supplier_quotations : company_id
    procurement_purchase_orders ||--o{ procurement_purchase_order_fulfillment_events : purchase_order_id

    employer_profiles ||--o| billing_accounts : employer_id
    billing_accounts ||--|| credit_wallets : account_id
    billing_accounts ||--o{ ai_usage_events : account_id
    billing_accounts ||--o{ credit_purchase_orders : account_id

    users ||--o{ general_work_conversations : user_id
    general_work_conversations ||--o{ general_work_files : conversation_id
```

## Tenant paths (how every row reaches the organisation)

| Table | Path to `employer_profiles.id` | Company Brain filter |
|---|---|---|
| jobs, job_sites, attendance, payment_transactions, financial_*, procurement_material_requests, procurement_rfqs, procurement_purchase_orders, financial_audit_runs | direct `employer_id` | `.eq("employer_id", org)` |
| job_matches | `job_id → jobs.employer_id` | inner join `jobs!inner(employer_id)` + `.eq("jobs.employer_id", org)` |
| financial_invoice_items / payments | composite FK to invoice + own `employer_id` | `.eq("employer_id", org)` |
| procurement_purchase_order_fulfillment_events | `purchase_order_id → POs.employer_id` | PO ids pre-filtered by org |
| worker_profiles, supplier_companies | shared entities, reachable only through the org's matches / POs | fetched **only** by ids returned from org-filtered rows |
| credit_wallets, ai_usage_events | `account_id → billing_accounts.employer_id` | account resolved from org |
| general_work_* | `user_id` (owner) | `.eq("user_id", owner)` |

## Relationships that do NOT exist (and their consequences)
- `procurement_purchase_orders` ↔ `financial_vendor_bills`: no key → bills and POs for the same
  purchase cannot be matched; Company Brain never adds them together as "expenditure".
- `financial_invoices` ↔ customer master: none (free-text `client_name`).
- `jobs` / `job_matches` ↔ payroll: none; wages are an offered daily cap on `jobs`.
- Any table ↔ department: no department concept.
- Logistics / tender / maintenance: no tables.
