# Company Brain — Retrieval and RAG Design

## Two retrieval paths, never mixed up
| Question type | Path | Why |
|---|---|---|
| Counts, totals, statuses, dates, rankings | **Structured tools** (`app/company_brain/tools.py`) querying source tables live | Exact, current, reproducible; no vectors involved |
| Contract terms, policies, document contents | **Document search** (`app/company_brain/documents.py`) over chunks | Semantic/keyword matching over unstructured text |

Business records are **not** embedded. A document hit is quoted as `document` evidence; it never
overrides a structured figure.

## Structured retrieval
- Allowlist (`data_access.ALLOWED_TABLES`): table → organisation column → permitted columns. Anything
  else raises `DataAccessError` before a query is built.
- Organisation filter is added inside `fetch()` from the server-side `OrgContext`; the model cannot
  supply or change it (tool argument models do not contain it, extra keys are ignored).
- Shared tables (`users`, `worker_profiles`, `supplier_companies`, wallets…) are readable only with
  an `in`/`eq` id filter whose ids came from organisation-filtered rows.
- Filters: `eq, in, gte, lt, lte, neq` only. Paging 1,000 rows per request, hard cap 5,000 rows per
  table per question; a capped read adds an explicit limitation to the answer.
- Calculations happen in Python `Decimal`, per currency, with a `Calculation` record (formula, input
  ids, period, result, unit, timestamp) attached to the evidence item.

## Document pipeline
```
source (upload | General Work file | scanned bill text)
  → extract: PDF text layer (pypdf, per page) · DOCX/XLSX/CSV/TXT (existing General Work readers)
             · images and scanned PDFs → billed OCR via the gateway (operation brain_document_ocr)
  → normalise whitespace
  → chunk: ~1,200 chars, 200 overlap, paragraph/sentence boundaries, page numbers kept,
           ALL-CAPS line kept as section, max 400 chunks/document
  → embed: Gemini `GEMINI_EMBEDDING_MODEL` (default gemini-embedding-001), 768 dims,
           task RETRIEVAL_DOCUMENT, batches of 50, via ai_gateway.embed_texts (billed, estimated usage)
  → store: company_brain_chunks(document_id, employer_id, document_version, chunk_index, content,
           page, section, tsv GENERATED english, embedding vector(768), embedding_model)
```
If embedding is refused (no price/FX, no credits) the chunks are still stored with `embedding NULL`
and the document is searchable by keyword (`embedding_status = not_configured|failed`).

## Search (`company_brain_search_chunks`, migration 106)
1. Keyword ranking: `websearch_to_tsquery('english', q)` over the GIN-indexed `tsv`, top 50.
2. Vector ranking: cosine distance (HNSW, `vector_cosine_ops`) on the query embedding
   (task RETRIEVAL_QUERY), top 50 — skipped when no query embedding.
3. Reciprocal-rank fusion `1/(60+rank_kw) + 1/(60+rank_vec)` = rerank; top k (≤ 8, hard cap 20).
4. Filters inside SQL: `employer_id`, document `status = 'indexed'`, chunk version = current version.
5. Back in Python the document row is re-read (authoritative) and anything not `indexed` is dropped.
The function is `SECURITY INVOKER`, executable by `service_role` only.

## Freshness, sync, deletion
- `GET /company-brain/status` schedules an incremental `sync` in the background:
  register new General Work files and completed/confirmed scans; mark sources that disappeared as
  `deleted` and delete their chunks; re-index sources whose `source_updated_at` moved; retry
  `pending`/`failed` documents up to 3 attempts; at most 5 documents indexed per sync.
- Uploads are indexed immediately after upload (background task).
- Re-indexing writes a new `document_version`; old-version chunks are deleted after the switch, and
  search only reads the current version, so readers never see a half-written document.
- Deleting an upload deletes the row (chunks cascade) and the stored file.
- Every evidence item carries `freshness` (`live` for structured, `indexed` + index date for docs).

## Known limits
- Embedding token usage is estimated (chars/3) because the API returns no counts — recorded as
  `usage_status='estimated'`.
- No event-driven indexing (no CDC/webhooks in Gleska); sync is pull-based on visit.
- Spreadsheets are read up to the existing General Work row limit.
- OCR quality depends on the model; OCR text is still treated as untrusted data.
