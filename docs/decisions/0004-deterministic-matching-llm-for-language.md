# ADR 0004: Deterministic matching; LLMs only for language tasks

- Status: Accepted (recorded from existing code)
- Date: 2026-10-31

## Context
Worker↔job matching must be explainable and auditable; free text from employers needs structure.

## Decision
Matching is SQL/PostGIS business rules (migration 011 onward). Gemini is used for natural-language
work only: job extraction, Hiring/General Work chat, invoice scanning, transcription. Model output
is validated (Pydantic) or rendered as untrusted Markdown, never trusted for authorization or money.

## Consequences
Matching is reproducible and cheap; AI features degrade gracefully when `GEMINI_API_KEY` is unset.
