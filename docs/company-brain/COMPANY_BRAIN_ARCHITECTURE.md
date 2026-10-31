# Company Brain — Architecture

Status: implemented 2026-10-31; migrations 106 and 107 applied to production 2026-10-31. See "Build status" at the bottom.

## Principle
Company data is the source of truth; the model plans and explains. **No company fact reaches an
answer unless a backend tool retrieved it**, and every number in the answer must match a number in
the evidence package or the answer is rejected.

## Placement in the codebase
New backend package `gleska-backend-f/app/company_brain/` (router `app/routers/company_brain.py`,
prefix `/api/v1/company-brain`, `require_employer`). It reuses:
- `app.ai_gateway.generate_content` inside `billing_scope(agent="company_brain")` — no new Gemini
  integration, no new wallet;
- the service-role Supabase client, with the organisation resolved server-side exactly like the
  Financial agent (`employer_profiles.user_id = caller`);
- the Financial agent's receivable rules (invoice status computation) re-implemented in the metric
  layer with the same definitions, and tested against the same fixtures.
Website: route `/company-brain` built on the shared `AgentLayout` / General Work chat components.

## Request pipeline

```
Owner question
  │
  ├─ 1. Context: last N turns of this conversation (text + the previous turn's *plan*, never its facts)
  ├─ 2. Planner (LLM, JSON-schema output) → Plan{ intent, tool calls[], period, clarification? }
  │       tools come from a fixed catalogue; arguments are validated by Pydantic; org id is NOT an argument
  ├─ 3. Router executes only the requested tools (parallel), each:
  │       tenant-filtered query → rows → Decimal calculation → Evidence items + Calculation records
  │       unavailable domains return an explicit Unavailable evidence item with the reason
  ├─ 4. Document search tool (if planned): FTS (+ vector when enabled) over org-scoped chunks
  ├─ 5. Evidence package: numbered items E1..En (value, unit, period, source table/ids, retrieved_at,
  │       source_updated_at, freshness=live|indexed), limitations, conflicts
  ├─ 6. Answer generation (LLM) with rules: use only evidence, cite [E#], no new numbers
  ├─ 7. Validator (deterministic): every number/date in the answer ∈ evidence (normalised),
  │       every [E#] exists, no citation-free sentences containing numbers → else one regeneration
  │       → else deterministic fallback answer rendered from the evidence itself
  └─ 8. Persist message + plan + evidence + calculations + validation result; return with sources
```

Cost control: 2 model calls per question (plan + answer), 3 when regeneration is needed. Greetings
and questions answerable purely by catalogue keywords still use the planner (one small call); the
deterministic tools and document search are never billed as tokens.

## Tool catalogue (approved operations — the only way to read data)
Each tool = name, Pydantic args (period, status filters, limit ≤ 50, sort), fixed tables/columns,
tenant filter, output → evidence. Examples: `workforce_summary`, `attendance_summary`,
`receivables_summary`, `receivables_by_customer`, `supplier_bills_summary`, `platform_payments`,
`procurement_summary`, `procurement_by_supplier`, `delayed_deliveries`, `open_rfqs`, `ai_usage`,
`company_overview` (fan-out of the summaries), `document_search`, `unavailable_domain`.
There is **no free-form SQL tool**. This removes SQL injection and cross-tenant SQL by construction;
the catalogue is the "allowlist".

## Evidence & calculation records
`Evidence{ id, source_agent, source_type(table|document|calculation|unavailable), table, record_ids[],
fields[], period, value, unit/currency, retrieved_at, source_updated_at, freshness, classification }`
`Calculation{ id, metric, formula, input_record_ids[], period, result, currency, executed_at }`
Both are stored with the assistant message (JSONB) so any answer can be reproduced/audited.

## Conversation memory
Follow-ups reuse the previous turn's **plan** (metric, period, filters) as context for the planner;
facts are always re-retrieved. Ambiguous references → the planner must return `clarification`.

## Executive summaries
`company_overview(period)` runs every summary tool for the period and returns evidence; the answer
step writes sections (Verified facts / Calculated metrics / Observed changes vs previous period /
Interpretation / Recommendations, each recommendation citing evidence). Summaries are cached per
(org, period, data version) for 10 minutes; any write to source tables is not observable without
triggers, so the cache TTL is short and the UI shows "generated at".

## Security (summary — see SECURITY_DESIGN.md)
Org from auth only; owner-only access; read-only tools; prompt-injection isolation (documents and DB
text are passed as quoted data, never as instructions); PII minimisation (no phones, Aadhaar, bank);
per-user rate limit; audit log of every tool call (no prompt text).

## Data that cannot be connected
Tender Filing/Tracking (placeholders), Industrial Maintenance (none), payroll/departments/expenses
(no tables). Logistics was browser-only and now persists via migration 107. The `unavailable_domain` tool returns the exact reason so
the answer says so instead of guessing.

## Build status (2026-10-31)
| Feature | Status |
|---|---|
| Audit, relationship map, data dictionary | Implemented |
| Structured tools (13) with allowlisted, tenant-scoped data access and Decimal calculations | Implemented, tested |
| Planner (model, JSON) + deterministic keyword fallback | Implemented, tested with scripted model; live-model quality not measured |
| Evidence package, calculation records, validator, regeneration, fallback answer | Implemented, tested |
| Period comparison (deterministic % change) | Implemented, tested |
| Executive summaries (`POST /summary`, overview fan-out) | Implemented, tested via UI test; no caching (live queries) |
| Conversation memory (previous questions + plans, never previous answers) | Implemented, tested |
| Document RAG (upload, GW files, scanned bills; FTS + pgvector hybrid; versioning; deletion) | Implemented, tested (SQL + Python); semantic quality on real docs not measured |
| Embeddings via central gateway (billed, estimated usage) | Implemented, tested with fakes; needs admin price for the embedding model |
| Logistics server storage (migration 107) + one-time browser import | Implemented, tested |
| UI `/company-brain` (chat, history, search, sources, documents, summaries, attach) | Implemented, tested |
| Audit log, rate limits, admin health endpoint | Implemented; health has no UI page yet |
| Tender / maintenance / payroll / departments | Not implementable — no data exists; reported as unavailable |
