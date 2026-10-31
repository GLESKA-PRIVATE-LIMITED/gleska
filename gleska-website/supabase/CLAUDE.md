# Database (Supabase Postgres + PostGIS) — component memory

Rules are in root CLAUDE.md §4. This file holds the facts you need to apply them.

## Facts
- Migrations: `migrations/001…103`, applied in filename order; next free number **104**.
  Duplicate numbers exist (031, 044, 058, 068, 069) — never reuse a number.
- Applying is manual (Supabase SQL editor or `supabase db push`); there is no migration-tracking
  table in the repo [?] — whether a given file ran in production is unknown (docs/open-questions.md).
- Core model: `users` (1:1 `auth.users`, `role`) → `worker_profiles` / `employer_profiles` →
  `jobs`/`job_sites` (PostGIS `geometry(Point,4326)`) → `job_matches`; plus payments, attendance,
  procurement (070–101), financial (088–098), General Work (103).
- Shared trigger function: `update_updated_at_column()` (001).
- Matching is deterministic SQL (`ST_DistanceSphere`, 30 km), not AI.

## Local test recipe (verified 2026-10-30)
Postgres 16 is installed in the cloud container. Run as the `postgres` user:
`initdb -A trust`, start on a spare port, then create stand-ins before applying a migration:
roles `anon`, `authenticated`, `service_role BYPASSRLS`; schema `auth` with
`auth.uid()` reading `current_setting('request.jwt.claim.sub')`; `ALTER DEFAULT PRIVILEGES …
GRANT ALL ON TABLES TO anon, authenticated, service_role` (mimics Supabase); minimal referenced
tables. Then apply twice (idempotency) and test RLS with `SET ROLE authenticated; SET
request.jwt.claim.sub = '<uuid>'`.

## Watch-outs
- Migrations 001–069 revoke function EXECUTE only from PUBLIC (KI-02).
- 029 cannot replay on a fresh DB (KI-09).

Last verified: 2026-10-31, commit aabb165.
