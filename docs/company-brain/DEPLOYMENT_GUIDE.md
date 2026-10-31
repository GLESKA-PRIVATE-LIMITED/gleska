# Company Brain — Deployment Guide

Order matters: database first, then backend, then website.

## 1. Database (Supabase, needs owner approval)
1. Apply `gleska-website/supabase/migrations/106_company_brain.sql` (enables `vector` in schema
   `extensions`; Company Brain tables; search function).
2. Apply `107_logistics_storage.sql` (Logistics vehicle listings and rental requests).
3. Verify (read-only):
   ```sql
   SELECT extname FROM pg_extension WHERE extname = 'vector';
   SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'company_brain_%' OR relname LIKE 'logistics_%';
   SELECT has_function_privilege('authenticated','public.company_brain_search_chunks(uuid,text,extensions.vector,integer)','EXECUTE'); -- false
   ```
4. Run Supabase security advisors; expect only INFO "RLS enabled, no policy" for chunks/audit.

## 2. Backend (Render)
- New dependency: `pypdf==5.1.0` (requirements.txt).
- New optional env var: `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`).
- Optional: `BILLING_SELLER_NAME` unchanged. No new secrets.
- Routers registered in `app/main.py`: `/api/v1/company-brain/*`, `/api/v1/admin/company-brain/health`,
  `/api/v1/logistics/*`.

## 3. Website (Vercel)
- New route `/company-brain` (landing card 08 "Company's Brain" now opens it); Logistics page now
  stores data on the server and imports browser data once.

## 4. Billing set-up (owner, in /admin/billing)
- Company Brain chat uses the existing `GEMINI_MODEL` price — nothing new.
- For semantic document search add a verified price for the embedding model (input price per 1M
  tokens from Google's pricing page; output 0). Without it documents are keyword-searchable only.

## 5. Smoke test after deploy
1. Open `/company-brain` as an employer → welcome screen, no figures shown.
2. Ask "What is pending from customers?" → answer with Sources showing `financial_invoices`, Live.
3. Ask "How many tenders are active?" → "I couldn't verify…" with the reason.
4. Upload a small policy PDF in Documents → status becomes Indexed (keyword or semantic).
5. Logistics: list a vehicle, reload → it persists; ask Company Brain "status of our vehicles".
6. `/api/v1/admin/company-brain/health` as admin → counts, no content.

## Rollback
Website and backend: redeploy the previous commit. Database: the new tables are additive; leave them
(dropping loses conversation history and the Logistics data entered since deploy).
