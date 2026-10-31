# Codebase audit — 2026-10-22

Record of the first full audit (Claude Code session, commit dc653c8). Saved to the repo on
2026-10-31 with the owner's approval; findings were re-verified against commit aabb165 and their
live status is tracked in [../known-issues.md](../known-issues.md). Database and frontend findings
came from delegated read-only reviews; the critical ones (KI-02, KI-03) were re-checked directly.

## Scope
Read-only review of `gleska-website/`, `mobile/`, `gleska-backend-f/` and the 102 SQL migrations.
Backend tests could not run at the time (Python 3.13 vs pinned pydantic 2.5); frontend lint/type
checks could not run (no `node_modules`).

## Findings
1. Critical — SECURITY DEFINER RPCs in 001–069 revoked only from PUBLIC; caller IDs trusted
   (payment success, job match acceptance, attendance, job create/cancel). → KI-02
2. Critical — account-deletion SQL function callable by any authenticated user for any user id. → KI-03
3. High — Android signing password committed in `mobile/android/app/build.gradle`. → KI-01
4. Medium — session revocation header-optional; logout leaves cookie JWT valid; users can edit
   their own `user_sessions` revoked flag. → KI-05, KI-06
5. Medium — localhost CORS origins always allowed; no OTP rate limiting. → KI-07, KI-08
6. Medium — migration 029 breaks fresh replay; duplicate migration numbers; `job_matching_runs`
   without RLS. → KI-09, KI-04
7. Low — stub features (tender filing/tracking, logistics fleet), public mock page, Android build
   settings, duplicated web/mobile code, large files, no CI, outdated README. → KI-13…KI-16

## Top three recommendations (as made)
1. Lock down database functions in one new migration (revoke from anon/authenticated, fix the
   deletion function, RLS on `job_matching_runs`, protect `user_sessions.is_revoked`).
2. Rotate Android signing credentials and harden sessions (server-side revocation, env-gated CORS,
   OTP rate limits). — Signing moved out of code on 2026-10-22; rotation pending.
3. Make the project buildable and verifiable (fix 029/duplicates, upgrade pinned Python deps, add CI).
