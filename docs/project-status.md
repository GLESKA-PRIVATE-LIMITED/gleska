# Project status

Last verified: 2026-10-31, commit aabb165. Update at the end of every task.

## Done (verified in code)
- Worker/employer accounts: Supabase + MSG91 OTP auth, onboarding, verification (Cashfree), terms.
- Registered business/industry CIN and Aadhaar checks are optional during onboarding; verification
  remains available afterward. Completed employers default to the Hiring dashboard.
- Jobs, job sites, PostGIS matching, attendance, subscriptions/payments (Cashfree), notifications.
- Hiring agent with connector tools and OAuth connectors page.
  - 14 connector tools wired in `gleska-backend-f/app/agents/hiring/connector_tools.py`
    and registered per-request in `_build_tooling` of `hiring_agent_service.py`.
  - OAuth flow (`init` + `callback`) implemented for Google, Slack, Zoom, LinkedIn,
    Facebook/Instagram, Microsoft, GitHub in
    `gleska-backend-f/app/services/connectors/oauth_service.py`.
  - OAuth client credentials configured so far: **Google** (tested end-to-end,
    testing mode — 100 test users). Slack, Zoom, LinkedIn, Facebook, Microsoft
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
  104 not yet applied to Supabase, so AI requests fail closed until it is, prices + FX are set and
  credits granted. Central AI gateway, versioned
  pricing, credit wallet + append-only ledger (migration 104), all 7 Gemini call sites metered,
  billing APIs, admin page `/admin/billing` ("AI Billing": readiness, prices, FX, credit rules,
  employer wallets + credit adjustments, usage by agent, audit log). Tests: `tests/test_ai_gateway.py`, `tests/test_billing_api.py`,
  `gleska-website/supabase/tests/`.

## Waiting on the owner
- Before AI billing can deploy: verified Gemini prices for the configured model, a USD→INR rate,
  and increments 2–4 (credit purchase, Billing Management UI, admin console).
- Apply migration `103_general_work_workspace.sql`; set `GEMINI_API_KEY`; confirm `assistant-uploads` bucket.
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
- Logistics agent: UI with hard-coded fleet; persistence in localStorage only.

## Planned / not started
- Tender filing & tracking backends (UI placeholders only).
- Security hardening KI-02…KI-08; CI pipeline; dependency upgrades (KI-15).

## Unknown
- Which migrations are applied in production; Play Store release status (docs/open-questions.md).
