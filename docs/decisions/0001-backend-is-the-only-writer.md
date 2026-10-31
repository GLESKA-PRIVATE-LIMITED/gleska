# ADR 0001: The FastAPI backend is the only writer to the database

- Status: Accepted (recorded from existing code)
- Date: 2026-10-31

## Context
Web and mobile clients hold only the public anon key. The backend uses the service-role
client (`gleska-backend-f/app/core/supabase.py`), which bypasses RLS. Migration 066 removed
client UPDATE rights on profile tables after a role self-escalation risk.

## Decision
All writes go through FastAPI, which enforces role dependencies and filters every query by the
caller's id. RLS stays enabled on every table as defence in depth; clients get at most owner-scoped
SELECT (e.g. migration 103).

## Consequences
Authorization logic lives in one place and is testable with fakes. Every new endpoint must add the
owner filter itself — forgetting it leaks data because RLS is bypassed.
