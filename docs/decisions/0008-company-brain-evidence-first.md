# ADR 0008 — Company Brain: evidence-first answers over approved tools

- Status: Accepted 2026-10-31 (owner approved migration 106, AI semantic search, Logistics storage,
  General Work files in search)
- Detail: docs/company-brain/

## Context
The owner wants an executive assistant that answers questions about the whole company from its own
records without inventing anything. Data lives in one Supabase Postgres (hiring, attendance,
financial, procurement, payments, AI billing); Logistics was browser-only; Tender and Maintenance
store nothing.

## Decision
1. **No LLM-generated SQL.** The model picks tools from a fixed catalogue; tools read through an
   allowlisted, organisation-filtered data-access layer and compute with Decimal.
2. **Evidence first.** Tools return numbered evidence + calculation records; the answer model may
   only restate evidence with `[E#]` citations; a deterministic validator rejects any number, date
   or citation not in the evidence (one regeneration, then an evidence-only fallback answer).
3. **Live structured data, indexed documents.** No copies of business records; documents (uploads,
   General Work files, scanned-bill text) are chunked into Postgres with FTS + pgvector (768-dim
   Gemini embeddings) and fused with reciprocal-rank fusion.
4. **Central gateway for every model call** (planning, answers, OCR, embeddings), attributed to
   agent `company_brain`, the user and the conversation.
5. **Missing data is a first-class answer** (`unavailable_domain`), never guessed.
6. **Logistics moves to the server** (migration 107) so it can be part of company intelligence.

## Consequences
- 2 billed model calls per question (plan + answer); 0 when nothing can be verified.
- New metrics require code + dictionary entry + ground-truth eval case.
- Embedding usage is estimated (provider returns no counts).
- Multi-user organisations will need a permission layer in `org_context`.
