-- Company Brain: conversations, evidence-bearing messages, document index (FTS + pgvector) and a
-- query audit log (docs/company-brain/*).
--
-- RLS impact: five new tables, RLS enabled on all. Employers may SELECT their own conversations,
--   messages and document list (owner = employer_profiles.user_id = auth.uid()). Chunks and the
--   audit log are not client-readable. All writes go through the backend (service_role).
-- Data impact: additive. Enables the `vector` extension in schema `extensions` (Supabase default).
--   No existing table changes.
-- Rollback: drop function company_brain_search_chunks, then the five tables (child first). The
--   extension can stay. Conversations and the document index are rebuildable from source files.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.company_brain_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat' CHECK (char_length(title) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_conversations_owner ON public.company_brain_conversations(employer_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.company_brain_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.company_brain_conversations(id) ON DELETE CASCADE,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (char_length(content) <= 40000),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  answer_status TEXT CHECK (answer_status IN ('validated', 'regenerated', 'fallback', 'clarification', 'general', 'not_verified')),
  plan JSONB,
  evidence JSONB,
  validation JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_cb_messages_conversation ON public.company_brain_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cb_messages_rate ON public.company_brain_messages(user_id, created_at DESC) WHERE role = 'user';

CREATE TABLE IF NOT EXISTS public.company_brain_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'general_work_file', 'invoice_scan')),
  source_id UUID NOT NULL,
  filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  mime_type TEXT,
  storage_bucket TEXT,
  storage_path TEXT,
  size_bytes BIGINT CHECK (size_bytes >= 0),
  content_sha256 TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexed', 'failed', 'deleted')),
  embedding_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (embedding_status IN ('pending', 'embedded', 'not_configured', 'failed')),
  error_code TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  source_updated_at TIMESTAMPTZ,
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_brain_documents_source_unique UNIQUE (employer_id, source_type, source_id),
  CONSTRAINT company_brain_documents_upload_path CHECK (
    source_type <> 'upload' OR (storage_path IS NOT NULL AND storage_path LIKE (user_id::text || '/company-brain/%'))
  )
);
CREATE INDEX IF NOT EXISTS idx_cb_documents_status ON public.company_brain_documents(employer_id, status);

CREATE TABLE IF NOT EXISTS public.company_brain_chunks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.company_brain_documents(id) ON DELETE CASCADE,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  document_version INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  page INTEGER,
  section TEXT,
  tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding extensions.vector(768),
  embedding_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_brain_chunks_unique UNIQUE (document_id, document_version, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_cb_chunks_employer ON public.company_brain_chunks(employer_id);
CREATE INDEX IF NOT EXISTS idx_cb_chunks_tsv ON public.company_brain_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS idx_cb_chunks_embedding ON public.company_brain_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.company_brain_query_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  conversation_id UUID,
  message_id UUID,
  tool TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('ok', 'blocked', 'error', 'denied')),
  row_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_cb_audit_employer ON public.company_brain_query_audit(employer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cb_audit_status ON public.company_brain_query_audit(created_at DESC) WHERE status <> 'ok';

-- Hybrid retrieval: keyword (full-text) and vector rankings fused with reciprocal-rank fusion.
-- SECURITY INVOKER and service_role-only: the backend passes the organisation from its auth context.
CREATE OR REPLACE FUNCTION public.company_brain_search_chunks(
  p_employer_id UUID, p_query TEXT, p_embedding extensions.vector(768) DEFAULT NULL, p_limit INTEGER DEFAULT 8
)
RETURNS TABLE (chunk_id BIGINT, document_id UUID, content TEXT, page INTEGER, section TEXT,
               keyword_rank INTEGER, vector_rank INTEGER, vector_similarity DOUBLE PRECISION, score DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', coalesce(p_query, '')) AS tsq),
  kw AS (
    SELECT c.id, row_number() OVER (ORDER BY ts_rank_cd(c.tsv, q.tsq) DESC, c.id) AS rnk
    FROM company_brain_chunks c, q
    WHERE c.employer_id = p_employer_id AND c.tsv @@ q.tsq
    ORDER BY ts_rank_cd(c.tsv, q.tsq) DESC, c.id LIMIT 50
  ),
  vec AS (
    SELECT c.id, row_number() OVER (ORDER BY c.embedding <=> p_embedding, c.id) AS rnk,
           1 - (c.embedding <=> p_embedding) AS sim
    FROM company_brain_chunks c
    WHERE p_embedding IS NOT NULL AND c.employer_id = p_employer_id AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> p_embedding, c.id LIMIT 50
  ),
  fused AS (
    SELECT coalesce(kw.id, vec.id) AS id, kw.rnk AS krank, vec.rnk AS vrank, vec.sim,
           coalesce(1.0 / (60 + kw.rnk), 0) + coalesce(1.0 / (60 + vec.rnk), 0) AS score
    FROM kw FULL OUTER JOIN vec ON kw.id = vec.id
  )
  SELECT c.id, c.document_id, c.content, c.page, c.section, f.krank::int, f.vrank::int, f.sim, f.score
  FROM fused f
  JOIN company_brain_chunks c ON c.id = f.id
  JOIN company_brain_documents d ON d.id = c.document_id
  WHERE d.employer_id = p_employer_id AND d.status = 'indexed' AND c.document_version = d.version
  ORDER BY f.score DESC, c.id
  LIMIT LEAST(GREATEST(coalesce(p_limit, 8), 1), 20);
$$;

ALTER TABLE public.company_brain_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_brain_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_brain_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_brain_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_brain_query_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.company_brain_conversations, public.company_brain_messages, public.company_brain_documents,
  public.company_brain_chunks, public.company_brain_query_audit FROM anon, authenticated;
GRANT SELECT ON public.company_brain_conversations, public.company_brain_messages, public.company_brain_documents
  TO authenticated;
GRANT ALL ON public.company_brain_conversations, public.company_brain_messages, public.company_brain_documents,
  public.company_brain_chunks, public.company_brain_query_audit TO service_role;
GRANT USAGE ON SCHEMA extensions TO service_role;

DROP POLICY IF EXISTS "Owners read own company brain conversations" ON public.company_brain_conversations;
CREATE POLICY "Owners read own company brain conversations" ON public.company_brain_conversations
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.employer_profiles e WHERE e.id = employer_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "Owners read own company brain messages" ON public.company_brain_messages;
CREATE POLICY "Owners read own company brain messages" ON public.company_brain_messages
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.employer_profiles e WHERE e.id = employer_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "Owners read own company brain documents" ON public.company_brain_documents;
CREATE POLICY "Owners read own company brain documents" ON public.company_brain_documents
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.employer_profiles e WHERE e.id = employer_id AND e.user_id = auth.uid()));

REVOKE ALL ON FUNCTION public.company_brain_search_chunks(UUID, TEXT, extensions.vector, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_brain_search_chunks(UUID, TEXT, extensions.vector, INTEGER) TO service_role;

COMMIT;
