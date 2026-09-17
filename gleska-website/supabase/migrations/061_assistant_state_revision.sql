ALTER TABLE public.assistant_conversations
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_revision
  ON public.assistant_conversations(id, revision);