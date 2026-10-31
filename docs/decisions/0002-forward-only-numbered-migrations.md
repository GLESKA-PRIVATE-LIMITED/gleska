# ADR 0002: Forward-only, numbered SQL migrations in gleska-website/supabase/migrations

- Status: Accepted (recorded from existing code)
- Date: 2026-10-31

## Context
The schema evolves through files 001–103 applied manually in filename order; there are repair
migrations and duplicate numbers (KI-09).

## Decision
New schema changes are new files with the next unused number, idempotent DDL, a header stating RLS
impact, data impact and rollback. Applied files are never edited.

## Consequences
History is append-only and reviewable. Mistakes are fixed by a new migration. Switching to
timestamped names or the Supabase CLI history table is a possible future ADR.
