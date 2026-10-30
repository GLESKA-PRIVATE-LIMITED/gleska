-- General Work conversational workspace: projects, conversations, messages and library files.
--
-- Access model: the FastAPI backend (service role) performs every write after validating
-- ownership. Authenticated clients may only SELECT their own rows; anon has no access.
--
-- RLS impact: four new tables, RLS enabled on all of them with owner-only SELECT policies.
-- Data impact: additive only; no existing table or row is changed.
-- Storage: reuses the private `assistant-uploads` bucket (created by
--   gleska-backend-f/migrations/connectors_setup.sql). Objects live under
--   `<user_id>/general-work/<file_id>/<filename>`, so that bucket's existing per-user policies apply.
-- Rollback: DROP the four tables (in reverse order: messages, files, conversations, projects).
--   That permanently deletes General Work data and requires explicit approval.

BEGIN;

CREATE TABLE IF NOT EXISTS public.general_work_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_general_work_projects_user_updated
  ON public.general_work_projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.general_work_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.general_work_projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'New chat' CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_general_work_conversations_user_recent
  ON public.general_work_conversations(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_general_work_conversations_project
  ON public.general_work_conversations(project_id)
  WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.general_work_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.general_work_conversations(id) ON DELETE SET NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'assistant-uploads',
  storage_path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'document')),
  source TEXT NOT NULL CHECK (source IN ('upload', 'camera', 'generated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT general_work_files_owner_path CHECK (storage_path LIKE user_id::text || '/%')
);

CREATE INDEX IF NOT EXISTS idx_general_work_files_user_created
  ON public.general_work_files(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_general_work_files_conversation
  ON public.general_work_files(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.general_work_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.general_work_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 100000),
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  client_message_id UUID,
  reply_to_message_id UUID REFERENCES public.general_work_messages(id) ON DELETE CASCADE,
  -- clock_timestamp() keeps a user message and its reply strictly ordered.
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT general_work_messages_client_id_unique UNIQUE (conversation_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_general_work_messages_conversation_created
  ON public.general_work_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_general_work_messages_reply_to
  ON public.general_work_messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_general_work_projects_updated_at ON public.general_work_projects;
CREATE TRIGGER update_general_work_projects_updated_at
  BEFORE UPDATE ON public.general_work_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_general_work_conversations_updated_at ON public.general_work_conversations;
CREATE TRIGGER update_general_work_conversations_updated_at
  BEFORE UPDATE ON public.general_work_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.general_work_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_work_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_work_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_work_messages ENABLE ROW LEVEL SECURITY;

-- Writes are backend-only; clients get read access to their own rows.
REVOKE ALL ON public.general_work_projects, public.general_work_conversations,
  public.general_work_files, public.general_work_messages FROM anon, authenticated;
GRANT SELECT ON public.general_work_projects, public.general_work_conversations,
  public.general_work_files, public.general_work_messages TO authenticated;
GRANT ALL ON public.general_work_projects, public.general_work_conversations,
  public.general_work_files, public.general_work_messages TO service_role;

DROP POLICY IF EXISTS "Users read own general work projects" ON public.general_work_projects;
CREATE POLICY "Users read own general work projects"
  ON public.general_work_projects FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own general work conversations" ON public.general_work_conversations;
CREATE POLICY "Users read own general work conversations"
  ON public.general_work_conversations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own general work files" ON public.general_work_files;
CREATE POLICY "Users read own general work files"
  ON public.general_work_files FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own general work messages" ON public.general_work_messages;
CREATE POLICY "Users read own general work messages"
  ON public.general_work_messages FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMIT;
