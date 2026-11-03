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
Per-employer tokens, stored in `public.connector_tokens`. Backend-only since
migration 108: no client policy, no `anon`/`authenticated` privileges; the backend
reads it with the service role, filtered by the caller's employer id. Tokens are
Fernet-encrypted at rest (`enc:v1:` prefix) when `CONNECTOR_TOKEN_ENCRYPTION_KEY` is
set; older plaintext rows stay readable. One OAuth app per provider family — a single
Google client covers Gmail/Calendar/Drive/Docs/Sheets/Forms, one Microsoft client
covers Outlook/Excel, one Facebook client covers Facebook+Instagram. Connectors that
share a client share one grant (`oauth_service.credential_group`): connecting Gmail
authorizes Calendar/Drive/Forms too, and disconnecting any of them disconnects all.

Flow:
1. Frontend calls `GET /api/v1/connectors/oauth/{provider}/init` and the backend
   returns the provider's `authorize_url` with a signed-state JWT.
2. Browser is redirected to the provider's consent screen.
3. Provider redirects to `GET /api/v1/connectors/oauth/{provider}/callback?code=…&state=…`.
4. Backend verifies the state, exchanges the code for an access token
   (`oauth_service.exchange_code_for_token`), upserts the row into
   `connector_tokens`, and 302-redirects to
   `${FRONTEND_URL}/employer/connectors?connected={provider}`.

Service modules (`gleska-backend-f/app/services/connectors/`) get tokens only through
`token_store.get_credential(employer_id, provider)`, which refreshes access tokens
~2 minutes before expiry (`grant_type=refresh_token`; Zoom/Microsoft rotate the refresh
token, which is persisted) and marks the row `expired` when refresh fails, so the
connectors page shows "Reconnect". Facebook has no refresh token: the callback exchanges
the code-flow token for a ~60-day long-lived token, and posts use the Page token from
`/me/accounts`.

What each tool acts as:
- Gmail/Calendar/Drive/Forms/Zoom/Slack/Facebook/LinkedIn — the employer's own account.
- `send_email` — the employer's Gmail, else Outlook, else the platform Resend sender
  (result `sent_via`); an expired mailbox asks to reconnect instead of falling back.
- `send_teams_message` — the incoming-webhook URL the employer saved (allow-listed
  Microsoft hosts only; never a model-supplied URL).
- `send_whatsapp` — always the GO LESKA WhatsApp Business number (`MSG91_WHATSAPP_NUMBER`);
  WhatsApp's official API cannot send from personal accounts.

Tool definitions in `app/agents/hiring/connector_tools.py` surface each
connector action to the Hiring agent. They carry `metadata={"recoverable_errors": True}`:
a failure (bad arguments, provider error) is returned to the model, which explains it or
retries, instead of ending the turn (`engine.py`). Confirmation is conversational (the
agent instructions require confirming recipient/content); `confirmation_required` is off
because the runtime confirmation flow had no UI (7fd7b94).

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
