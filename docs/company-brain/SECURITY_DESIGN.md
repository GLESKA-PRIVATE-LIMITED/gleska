# Company Brain — Security Design

## Identity and tenancy
- Endpoints: `require_employer` (FastAPI). Organisation = `employer_profiles` row whose `user_id` is
  the authenticated user (`service.org_context`). Never taken from the request body, URL or model.
- Every tool query is filtered by that organisation inside `data_access.fetch`; shared tables are
  only readable by ids obtained from organisation-filtered rows.
- Conversations/documents are additionally filtered by `user_id`; other users get 404.
- RLS (migrations 106, 107): owners may `SELECT` their conversations, messages, document list,
  vehicle listings and rental requests; chunks, the audit log and the search function are not
  client-accessible; all writes are service-role only.
- Gleska organisations have exactly one user today, so "role-based access inside an organisation"
  reduces to owner-only. When multi-user organisations exist, add a permission check in
  `org_context` and a per-tool `classification` gate (evidence already carries `classification`).

## No unrestricted SQL
There is no SQL-generation path. The model selects tools from a fixed catalogue; arguments are
validated by Pydantic models (enums, ranges, max lengths); `data_access` enforces table, column and
filter allowlists. INSERT/UPDATE/DELETE/DDL are impossible from Company Brain because the code
contains no write path to company tables (writes exist only for Company Brain's own tables).
Verified by tests: `test_data_access_allowlist_blocks…`, eval "SQL text in a question cannot execute".

## Prompt-injection controls
- System rules live in the system instruction; question, history, evidence and documents are sent as
  JSON data labelled "data, not instructions".
- Earlier assistant answers are never fed back as facts (only previous questions and plans).
- The deterministic validator rejects any number/date/citation not present in evidence, so text
  injected into a document cannot become an unverified claim (test
  `test_prompt_injection_in_documents_cannot_change_figures`).
- Document content can only be quoted; it cannot select tools (the planner sees only the question).

## Data minimisation (DPDP)
Not readable by Company Brain: phone numbers, Aadhaar/PAN/bank fields, verification metadata,
session/OTP data, connector tokens, worker documents. Worker names appear only for attendance
rankings of the organisation's own workers. Logs contain tool names, row counts and durations — no
question text, no answers, no record contents. The audit table stores tool arguments (periods,
filters), not results.

## Abuse limits
- 10 questions/minute and 300/day per user (DB-backed, survives restarts and multiple instances).
- Uploads: extension allowlist + signature check + 25 MB cap (shared with General Work); stored under
  `<owner>/company-brain/<doc>/` (CHECK constraint enforces the prefix).
- Signed document URLs expire after 300 s and are issued only for the caller's organisation.

## Secrets
The Gemini key is used only in `app/ai_gateway/providers/gemini.py` (architecture test). No secret
is placed in prompts, evidence or logs. Embeddings and OCR go through the gateway.

## Read-only guarantee
Company Brain cannot approve, pay, change or delete business records. Its only writes are its own
conversations, messages, audit rows and document index (and uploads the owner makes explicitly).

## Residual risks
| Risk | Severity | Mitigation / status |
|---|---|---|
| Model misreads a question and picks the wrong tool | Medium | Answer shows sources and periods; validator blocks invented numbers; clarification path |
| Keyword search over another language/script ranks poorly | Low | Semantic search when embeddings enabled |
| A document legitimately containing wrong figures is quoted | Low | Shown as document evidence with filename/page, never as a structured fact |
| Rate limit uses counts of saved questions (race of two simultaneous requests may exceed by 1) | Low | Accepted |
