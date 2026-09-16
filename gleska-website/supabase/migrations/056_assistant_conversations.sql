BEGIN;

CREATE TABLE IF NOT EXISTS public.assistant_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  structured_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  language TEXT NOT NULL DEFAULT 'EN' CHECK (language IN ('EN', 'HI', 'MR', 'TA', 'HINGLISH')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'ARCHIVED')),
  created_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assistant_conversations_state_object CHECK (jsonb_typeof(structured_state) = 'object'),
  CONSTRAINT assistant_conversations_history_array CHECK (jsonb_typeof(history) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user_updated
  ON public.assistant_conversations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_employer_updated
  ON public.assistant_conversations(employer_id, updated_at DESC);

DROP TRIGGER IF EXISTS update_assistant_conversations_updated_at ON public.assistant_conversations;
CREATE TRIGGER update_assistant_conversations_updated_at
  BEFORE UPDATE ON public.assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own assistant conversations" ON public.assistant_conversations;
CREATE POLICY "Users can view their own assistant conversations"
  ON public.assistant_conversations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Employers can create their own assistant conversations" ON public.assistant_conversations;
CREATE POLICY "Employers can create their own assistant conversations"
  ON public.assistant_conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own assistant conversations" ON public.assistant_conversations;
CREATE POLICY "Users can update their own assistant conversations"
  ON public.assistant_conversations FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  );

COMMIT;
