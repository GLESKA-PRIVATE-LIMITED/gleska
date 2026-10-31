# Architecture

Last verified: 2026-10-31, commit aabb165. Tags: [V path] verified, [A] assumption, [?] unknown.

## Components
| Component | Stack | Responsibility |
|---|---|---|
| Website `gleska-website/` | Next.js 16, React 19, TS, Tailwind 4, axios, Supabase JS [V package.json] | Public site; worker, employer, admin, supplier UIs; employer AI agents |
| Mobile `mobile/` | Vite, React 19, Capacitor 8 Android [V package.json] | GLESKA Worker and GLESKA Employer apps |
| Backend `gleska-backend-f/` | FastAPI 0.104, Pydantic 2.5, supabase-py 2.8, httpx [V requirements.txt] | All business logic, authorization, every DB write, integrations |
| Database | Supabase Postgres + PostGIS, RLS [V supabase/migrations] | Schema, RLS, SQL RPCs (matching, payments, attendance, procurement) |
| Storage | Supabase Storage, private buckets (`worker-documents`, `profile-photos`, `supplier-verification-documents`, `assistant-uploads`, `financial-invoice-scans`) [V service `BUCKET` constants] | Files, served via short-lived signed URLs |

## Request flow
1. Client authenticates with Supabase Auth (email/Google PKCE) or MSG91 OTP widget.
2. Client calls `/api/v1/...` with `Authorization: Bearer <supabase token>` and
   `X-Goleska-Session-Key` [V website `src/lib/api.ts`]; MSG91 logins may instead use the
   backend's `goleska_session` cookie [V `gleska-backend-f/app/routers/auth.py`].
3. `get_current_user` validates the identity, loads `public.users`, applies role dependency
   [V `app/core/security.py`].
4. Service functions query Supabase with the **service-role** client, filtered by the caller's id.
5. Clients may read some tables directly with the anon key; RLS protects them.

## Integrations (all keys server-side, names in `gleska-backend-f/.env.example`)
| Provider | Use | Config |
|---|---|---|
| Google Gemini | Job extraction, Hiring agent, invoice scan, General Work chat + transcription | `GEMINI_*`, `FINANCIAL_SCAN_GEMINI_TIMEOUT_SECONDS` |
| Cashfree PG | Subscription/commission payments, webhooks | `CASHFREE_PG_*`, `WEBHOOK_URL` |
| Cashfree Verification | Employer KYC (CIN, Aadhaar, …) | `CASHFREE_*`, `EMPLOYER_VERIFICATION_*` |
| MSG91 | OTP widget, WhatsApp | `MSG91_*` |
| Resend | Contact/notification email | `RESEND_API_KEY`, `EMAIL_*` |
| Google Routes, Nominatim | Road routing, geocoding | `GOOGLE_ROUTES_*`, `NOMINATIM_*` |
| OAuth connectors | Google, Microsoft, Slack, Zoom, LinkedIn, Meta, GitHub, Tally (Hiring agent tools) | `connector_tokens` table, provider client vars |

### OAuth connector flow
Per-employer tokens, stored in `public.connector_tokens` (RLS: an employer only
reads their own row). One OAuth app per provider family — a single Google client
covers Gmail/Calendar/Drive/Docs/Sheets/Forms, one Microsoft client covers
Outlook/Teams/Excel, one Facebook client covers Facebook+Instagram.

Flow:
1. Frontend calls `GET /api/v1/connectors/oauth/{provider}/init` and the backend
   returns the provider's `authorize_url` with a signed-state JWT.
2. Browser is redirected to the provider's consent screen.
3. Provider redirects to `GET /api/v1/connectors/oauth/{provider}/callback?code=…&state=…`.
4. Backend verifies the state, exchanges the code for an access token
   (`oauth_service.exchange_code_for_token`), upserts the row into
   `connector_tokens`, and 302-redirects to
   `${FRONTEND_URL}/employer/connectors?connected={provider}`.

Service modules (`gleska-backend-f/app/services/connectors/`) use the stored
token for each provider call (e.g., `calendar_service.CalendarService.schedule_event`
reads the employer's Google token before hitting the Calendar v3 API).

Tool definitions in `app/agents/hiring/connector_tools.py` surface each
connector action to the Hiring agent; destructive actions (email, WhatsApp,
calendar create, forms create, slack/teams send, social post, zoom create)
set `confirmation_required=True`.

Redirect URIs must be registered on each provider's console — one URI per
`provider` id, per environment, e.g.
`https://gleska.onrender.com/api/v1/connectors/oauth/gmail/callback`. The
callback host comes from `OAUTH_CALLBACK_BASE_URL`.

## Employer agents
| Agent | Route | State |
|---|---|---|
| Hiring | `/employer/dashboard` | Implemented (agent runtime + 14 connector tools + file upload + voice-to-text) |
| Procurement | `/procurement`, `/supplier/*` | Implemented (RFQ, quotations, POs) |
| Financial | `/financial/*` | Implemented (invoices, scans, audits, receivables, vendors) |
| General Work | `/general-work/*` | Implemented 2026-10-30 (chat, library, projects, plugins) |
| Logistics | `/logistics` | Partial (fleet data hard-coded / localStorage) |
| Tender filing / tracking | `/tender-filing`, `/tender-tracking` | UI placeholders |

## Environments
- Local: website `localhost:3000` → backend `localhost:8000` [V `.env.example`].
- Production: backend `gleska.onrender.com` [A api.ts fallback], website `goleska.in` and
  `gleska.vercel.app` [A CORS list, GitHub homepage]. Single Supabase project [?].
- No CI/CD pipeline in the repo; deploys presumably from `main` [A].
