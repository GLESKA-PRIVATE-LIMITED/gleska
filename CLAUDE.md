# GLESKA — project memory for Claude Code

Loaded automatically every session. Keep it short; details live in the linked files.
Tags: [V] verified in code (path given), [A] assumption, [?] unknown — see docs/open-questions.md.

## 1. What this is
GO LESKA / GLESKA: India-focused workforce and business-agents platform (worker ↔ employer hiring,
plus employer "AI agents": procurement, financial, logistics, tender, General Work chat).

```
Website (Next.js 16) ─┐                         ┌─ Supabase Postgres + PostGIS (RLS)
Mobile (Capacitor) ───┼─ HTTPS /api/v1 ─ FastAPI ┼─ Supabase Storage (private buckets)
  Worker / Employer   │  (service-role client)  ├─ Gemini · Cashfree · MSG91 · Resend · Google Routes/Nominatim
                      └─ Supabase Auth (client) ─┘
```
Full picture: docs/architecture.md.

## 2. Repo map
| Path | What | Memory |
|---|---|---|
| `gleska-website/` | Next.js 16 + React 19 + TS + Tailwind 4; all web roles | gleska-website/CLAUDE.md |
| `gleska-website/supabase/migrations/` | **The** DB schema (001–103 SQL files) | gleska-website/supabase/CLAUDE.md |
| `gleska-backend-f/` | FastAPI + Pydantic v2; sole writer to the DB | gleska-backend-f/CLAUDE.md |
| `mobile/` | Vite + React + Capacitor 8; two Android apps from one source | mobile/CLAUDE.md |
| `docs/` | Architecture, status, known issues, ADRs, open questions | — |
| root `package.json` | Stray partial npm install (not used) [V] | do not add to it |

## 3. Commands (E = executed successfully in a session, R = read from package/README only)
| Component | Command | |
|---|---|---|
| Backend setup | `uv venv -p python3.11 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt` (Python 3.11; pinned pydantic 2.5 has no 3.13 wheel) | E |
| Backend tests | `SUPABASE_URL=https://placeholder.supabase.co SUPABASE_SERVICE_ROLE_KEY=placeholder.test.key python -m pytest -q` (Supabase client is built at import) | E |
| Backend check | `python -m compileall -q app` | E |
| Backend run | `python -m uvicorn app.main:app --reload` | R |
| Website | `npm ci`, `npx tsc --noEmit`, `npx eslint src`, `npx vitest run` | E |
| Website build | `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… npx next build` (public vars required at build) | E |
| Mobile | `npm run lint`, `npm run build:worker`, `npm run build:employer`, `npm run sync:<target>` | R |
| Android | `cd mobile/android && ./gradlew assembleWorkerDebug` / `bundleWorkerRelease` (needs Android SDK) | R |

Baselines (2026-10-31): backend 529 pass / 43 fail / 4 errors; website lint 110 errors,
88 warnings; vitest 3 failing (worker location). All failures pre-existing — **compare, don't chase**.

## 4. Database rules
- Schema lives only in `gleska-website/supabase/migrations/NNN_name.sql`; next free number = 106.
  (`gleska-backend-f/migrations/connectors_setup.sql` is a legacy exception — don't add more there.)
- Forward-only: never edit or delete an applied migration; add a new one. Idempotent DDL
  (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`), wrapped in `BEGIN; … COMMIT;`.
- Every migration header states: RLS impact, data impact, rollback approach.
- Every new table: `ENABLE ROW LEVEL SECURITY` + explicit policies; revoke from `anon, authenticated`
  what they must not do (Supabase grants them table access by default).
- SECURITY DEFINER functions: `SET search_path = public`, check the caller (`auth.uid()`), and
  `REVOKE … FROM PUBLIC, anon, authenticated` — revoking from PUBLIC alone is not enough.
- Test locally (throwaway Postgres 16 works; see supabase/CLAUDE.md) before anything touches production.

## 5. Auth, authorization, sessions
- Flow [V `gleska-backend-f/app/core/security.py`, `gleska-backend-f/app/routers/auth.py`]: client signs in with Supabase
  (email/Google) or MSG91 OTP → backend verifies → identity is a Supabase bearer token **or** the
  backend's `goleska_session` HS256 cookie → `get_current_user` loads `public.users` → role from
  `users.role` (WORKER / EMPLOYER / ADMIN) → `require_worker|require_employer|require_admin`.
- ADMIN cannot be self-provisioned [V `gleska-backend-f/app/services/auth_service.py`].
- **Frontend checks are never authorization.** Enforce role and ownership in FastAPI (filter every
  query by the caller's id) **and** in RLS. The website middleware is a navigation hint only.
- Service-role key: backend only (`app/core/supabase.py`). Never in web or mobile bundles.
  The anon key is public by design — RLS is the real boundary.
- Never trust client-sent user IDs, roles, prices or amounts.

## 6. Secrets & credentials
- Never commit `.env*` (only `*.example`), keystores, `keystore.properties`, signing passwords,
  service-account JSON, or tokens. Refer to variables by NAME only; never print values.
- Env templates: `gleska-backend-f/.env.example`, `gleska-website/.env.example`, `mobile/.env.example`.
- Android release signing reads `GLESKA_UPLOAD_*` env vars or untracked
  `mobile/android/keystore.properties` [V `mobile/android/app/release-signing.gradle`].
- An old signing password remains in public git history — see docs/known-issues.md (KI-01).

## 7. API conventions (what exists, not ideals)
- All routes under `/api/v1` (`settings.API_V1_PREFIX`); one router per domain in `app/routers/`,
  logic in `app/services/`, Pydantic models in `app/schemas/`.
- Errors: `HTTPException(detail="UPPER_SNAKE_CODE")`; unhandled → 500 `INTERNAL_SERVER_ERROR`
  [V `app/main.py`]. Some older routes return sentences or accept raw `dict` bodies — inconsistent
  (KI-12). New code: Pydantic request models + code-style `detail`.
- Mobile apps in the field depend on this API: never remove/rename fields or endpoints or change
  their meaning without a versioning/deprecation plan. Additive changes only.
- Payments (Cashfree): verify webhook signatures, idempotent handlers, server-computed amounts.
- OTP/auth: rate-limit; never log OTPs, tokens or full phone numbers (last 4 digits max).
- Logging: `logging.getLogger(__name__)`, no secrets/tokens/PII. Minimise personal data (India DPDP Act).
- AI (Gemini): send no unnecessary PII; treat model output and file contents as untrusted;
  render model Markdown without raw HTML.
- **Every LLM call goes through `app.ai_gateway.generate_content` inside a billing scope**
  (`billing_scope` / `@billed_entry`); only `app/ai_gateway/providers/` may touch the Gemini host or
  key (enforced by `tests/test_ai_gateway.py`). Billing refusals are `AIBillingError` (an
  `HTTPException`) — never swallow them. Money moves only via the SQL functions in migrations 104–105 (credit purchases: `cred_` Cashfree
  orders, credited only by `billing_complete_purchase`).

## 8. Definition of done
1. `git status` checked at start; unrelated user changes preserved.
2. Relevant tests/lint/typecheck run and compared with the baselines above; new behaviour has tests.
3. Anything that couldn't run is reported with the reason.
4. A security issue is "fixed" only with code **and** a test or reproducible check.
5. Docs in this memory updated if the change affects them.

## 9. Git & deployment
- Default branch `main`; work on the branch you are given. Commit/push/deploy/apply production
  migrations **only with explicit user approval**. No force-push, no history rewrite without approval.
- Commit messages: imperative summary + why. No secrets in messages.
- Commit identity: author and committer `gleskapvtltd-oss <gleska.pvt.ltd@gmail.com>`
  (`git -c user.name=gleskapvtltd-oss -c user.email=gleska.pvt.ltd@gmail.com commit …`).
  No `Co-Authored-By: Claude` or session trailers — the owner's explicit instruction overrides defaults.
  This holds even though GitHub then shows commits as "Unverified" and a stop hook suggests
  re-authoring as Claude: don't (owner confirmed 2026-10-31). "Verified" as Gleska would need a
  signing key on the gleskapvtltd-oss account.
- Review the impact of DB, auth and API changes with the user **before** implementing them.
- Never run destructive production operations (DROP, TRUNCATE, mass DELETE/UPDATE, db reset,
  deleting buckets/users) without explicit approval.
- Deploy targets: backend on Render [A `gleska-website/src/lib/api.ts` fallback URL]; website on
  Vercel [A repo homepage gleska.vercel.app]. No CI exists [V no `.github/`].

## 10. Session protocol
- **Start:** read this file → the component CLAUDE.md you'll touch → docs/project-status.md and
  docs/known-issues.md → `git status`. Use Grep/Glob for specifics; don't re-audit the repo.
- **End:** update docs/project-status.md, docs/known-issues.md and ADRs if anything changed.
  Change "Last verified" only for sections you actually re-checked.
- Enforced by hooks in `.claude/settings.json` (bash + git only): `memory-session-start.sh` lists
  code changed since the memory was last updated (re-check those areas first);
  `memory-stop-check.sh` blocks finishing once if code changed but the memory didn't.

## 11. Docs
- docs/architecture.md — components, data flow, integrations, environments
- docs/project-status.md — done / in progress / planned / unknown
- docs/known-issues.md — audit findings & tech debt (severity, status)
- docs/decisions/ — ADRs (template: 0000-template.md)
- docs/open-questions.md — things not verifiable from code
- docs/audits/2026-10-22-codebase-audit.md — original audit record

---
Last verified: 2026-10-31, commit aabb165.
