# Project status

Last verified: 2026-11-02, commit 401e135+. Update at the end of every task.

## Done (verified in code)
- Worker/employer accounts: Supabase + MSG91 OTP auth, onboarding, verification (Cashfree), terms.
- Registered business/industry CIN and Aadhaar checks are optional during onboarding; verification
  remains available afterward. Completed employers default to the Hiring dashboard.
- Jobs, job sites, PostGIS matching, attendance, subscriptions/payments (Cashfree), notifications.
- Hiring agent with connector tools and OAuth connectors page.
  - 16 connector tools (incl. Gmail list/read) wired in
    `gleska-backend-f/app/agents/hiring/connector_tools.py`
    and registered per-request in `_build_tooling` of `hiring_agent_service.py`.
  - OAuth flow (`init` + `callback`) implemented for Google, Slack, Zoom, LinkedIn,
    Facebook/Instagram, Microsoft, GitHub in
    `gleska-backend-f/app/services/connectors/oauth_service.py`.
  - OAuth client credentials configured so far: **Google** (production, External).
    Gmail read requires `gmail.readonly` scope (added 2026-11-02); existing users
    must re-authorize to grant it. Slack, Zoom, LinkedIn, Facebook, Microsoft
    still require provider-side client registration by the owner.
  - WhatsApp (via MSG91), OCR (via Gemini), GitHub (public API) marked always-on
    so employers do not need to connect them.
  - Chat composer supports file upload (25 MB, extension allowlist) and voice
    (Web Speech API) for Hiring; General Work uses the backend `/transcribe` route.
- Procurement (buyer + supplier, RFQ/quotes/POs) and Financial agent (invoices, scans, audits).
- Account deletion feature (backend fallback path; DB function broken — KI-03; profile-photo cleanup fixed — KI-19).
- Android release signing from env/untracked file (3c21127).
- General Work workspace (aabb165): chat, attachments, camera, voice, library, projects, plugins.
  Tests: backend `tests/test_general_work.py`, web `gleska-website/src/components/agents/general-work/generalWork.test.tsx`.
- Aadhaar OTP verification sends Cashfree's `ref_id` back exactly as issued (a string), keeps it
  after failures/timeouts, logs sanitized provider errors (KI-20); tests in
  `gleska-backend-f/tests/test_cashfree_verification.py`. Needs a production check after deploy.

- AI billing increment 1 (ADR 0007), **pushed to `main` 2026-10-31 (4e2be7f) at the owner's request**; migration
  104 **applied to production Supabase 2026-10-31** (verified: 9 tables with RLS, 6 functions, money
  functions service_role-only, settings v1 seeded). AI requests fail closed until a price + FX rate
  are entered and credits granted in `/admin/billing`. Central AI gateway, versioned
  pricing, credit wallet + append-only ledger (migration 104), all 7 Gemini call sites metered,
  billing APIs, admin page `/admin/billing` ("AI Billing": readiness, prices, FX, credit rules,
  employer wallets + credit adjustments, usage by agent, audit log). Tests: `tests/test_ai_gateway.py`, `tests/test_billing_api.py`,
  `gleska-website/supabase/tests/`.
- AI billing increment 3: employer page `/employer/billing` ("AI Credits" in the employer sidebar) —
  balance, usage by agent, recent requests, credit history; provider cost/markup hidden from employers.
  Test `gleska-website/src/app/employer/billing/page.test.tsx`.
- AI billing increment 2 (migration 105 **applied to production 2026-10-31**): online credit purchase via
  Cashfree (custom 5–2,500 credits), purchase history, printable receipts, admin purchases table.
  Tests: `tests/test_credit_purchases.py`, `supabase/tests/105_credit_purchases_test.sql`,
  `src/app/employer/billing/**/page.test.tsx`.

- Company Brain (ADR 0008, docs/company-brain/) **built 2026-10-31, not deployed**: `/company-brain`
  chat with evidence-validated answers over hiring, attendance, financial, procurement, payments,
  AI usage and logistics data; document RAG (uploads, General Work files, scanned bills; FTS +
  pgvector); executive summaries; conversation history; admin health endpoint. Needs migrations
  106 + 107: **both applied to production 2026-10-31** (107 = the DROP-free version from d68f866,
  verified: tables, indexes, FKs, RLS, per-role privileges, existing row counts unchanged). Logistics agent now stores vehicles/rental requests server-side (migration 107).
  Tests: `tests/test_company_brain_*.py`, `tests/test_logistics_api.py`, eval suite (44/44),
  `supabase/tests/106_company_brain_test.sql`, `src/components/agents/company-brain/companyBrain.test.tsx`.

## Waiting on the owner
- Add a verified price for `gemini-embedding-001` in /admin/billing for semantic document search.
- To switch AI back on: in `/admin/billing` enter the verified Gemini price for `GEMINI_MODEL`, a
  USD→INR rate, and grant credits to employers (done by the owner 2026-10-31). Still to build:
  increment 4 (reconciliation, spending limits).
  Owner: make one small real purchase (5 credits) to confirm the live Cashfree flow.
- Apply migration `103_general_work_workspace.sql`; confirm `assistant-uploads` bucket.
- `GEMINI_API_KEY` and `GEMINI_MODEL` set in Render; `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `OAUTH_CALLBACK_BASE_URL` also set.
- Rotate the exposed signing password / upload key (KI-01).
- Optionally remove orphaned profile photos of accounts deleted before the KI-19 fix.
- Create production OAuth apps under the Gleska-owned account (not a developer's
  personal account) for Google, Slack, Zoom, LinkedIn, Facebook/Instagram and
  Microsoft, then populate `*_OAUTH_CLIENT_ID` / `*_OAUTH_CLIENT_SECRET` on the
  hosted backend (`gleska.onrender.com`) and register each production redirect
  URI (`https://.../api/v1/connectors/oauth/{provider}/callback`) in the
  provider console. Current Google client is a developer-owned testing app and
  cannot be moved to production as-is.
- Submit Google OAuth app for verification once business account owns it;
  Gmail/Drive/Calendar scopes are "sensitive" so Google requires a CASA-tier
  security assessment (external audit, 4–8 weeks).

## In progress / partial
- Logistics agent: listings/rental requests persist server-side (migration 107, applied); the fleet
  search pool is still a hard-coded demo list.

## Planned / not started
- Tender filing & tracking backends (UI placeholders only).
- Security hardening KI-02…KI-08; CI pipeline; dependency upgrades (KI-15).

## Unknown
- Which migrations are applied in production; Play Store release status (docs/open-questions.md).
