# Backend (FastAPI) — component memory

Read the root CLAUDE.md first. Commands and baselines are in its §3.

## Layout
- `app/main.py` — app, CORS, router registration (add new routers here), global 500 handler.
- `app/core/` — `config.py` (all env settings, pydantic-settings), `supabase.py` (service-role
  client, built at import), `security.py` (auth deps), `supplier_access.py`.
- `app/routers/<domain>.py` → `app/services/<domain>_service.py` → `app/schemas/<domain>.py`.
- `app/agents/` + `app/tools/` + `app/llm/providers.py` — generic agent runtime (structured JSON,
  tool registry; in-memory state). Used by the Hiring agent; financial partly; logistics,
  procurement and tender agent folders are empty stubs.
- `app/services/connectors/` — OAuth/API connectors used as Hiring-agent tools.
- `app/ai_gateway/` — **the only LLM entry point** (ADR 0007): `context.py` (billing scope,
  `@billed_entry`), `pricing.py` (Decimal pricing engine), `providers/gemini.py` (only module that
  knows the Gemini host/key), `backend.py` (Supabase + money SQL functions), `gateway.py` (lifecycle).
  Tests get an in-memory billing backend from `tests/conftest.py`.
- `tests/` — pytest, one file per area; fakes replace the Supabase client (see `test_general_work.py`
  for a reusable in-memory `FakeSupabase` with filters, inserts, updates, storage).

## Rules
- Every endpoint declares a role dependency (`require_employer` etc.) and every query filters by
  the caller (`.eq("user_id", user.id)` or the owning profile id). The service-role client
  bypasses RLS, so these filters are the isolation boundary. Return 404 (not 403) for others' rows.
- Services raise domain exceptions; routers map them to `HTTPException(detail="CODE")`.
- Request bodies are Pydantic models (no raw `dict`); validate lengths and enums.
- Uploads: derive MIME from extension, check file signature and size server-side, store under
  `<user_id>/…` in a private bucket, hand out short-lived signed URLs only.
- External calls use `httpx.AsyncClient` with the timeout from settings; never put keys in URLs.
- Gemini settings: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_SECONDS` (shared by job
  extraction, Hiring agent, General Work).

## Gotchas
- Python 3.11 needed (pinned pydantic 2.5 / FastAPI 0.104); 3.13 install stalls.
- Tests fail at import without `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` placeholders.
- `get_current_user` only checks session revocation when `X-Goleska-Session-Key` is sent (KI-05).
- `JWT_SECRET_KEY` default is rejected only when `ENVIRONMENT=production`.
- `app/routers/admin.py` is ~2.7k lines; prefer adding new admin areas as separate routers.

Last verified: 2026-10-31, commit aabb165.
