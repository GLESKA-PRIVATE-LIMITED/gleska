BEGIN;

LOCK TABLE public.procurement_conversations IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.procurement_conversation_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.procurement_conversations(id) ON DELETE CASCADE,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX procurement_conversation_messages_owner_order
  ON public.procurement_conversation_messages(conversation_id, id DESC);

ALTER TABLE public.procurement_conversation_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Procurement owners can view archived conversation messages"
  ON public.procurement_conversation_messages FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  );
REVOKE ALL ON public.procurement_conversation_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.procurement_conversation_messages TO authenticated, service_role;

INSERT INTO public.procurement_conversation_messages (
  conversation_id, employer_id, user_id, role, content, created_at
)
SELECT c.id, c.employer_id, c.user_id, entry.value->>'role',
       entry.value->>'content', (entry.value->>'created_at')::timestamptz
FROM public.procurement_conversations c
CROSS JOIN LATERAL jsonb_array_elements(c.history) WITH ORDINALITY AS entry(value, ordinal)
WHERE entry.value->>'role' IN ('user', 'assistant')
  AND length(COALESCE(entry.value->>'content', '')) BETWEEN 1 AND 4000
  AND entry.value ? 'created_at'
ORDER BY c.id, entry.ordinal;

CREATE OR REPLACE FUNCTION public.archive_procurement_conversation_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry JSONB;
  v_previous_history JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_previous_history := '[]'::jsonb;
  ELSE
    v_previous_history := OLD.history;
  END IF;
  FOR v_entry IN
    SELECT entry.value
    FROM jsonb_array_elements(NEW.history) AS entry(value)
    WHERE entry.value->>'role' IN ('user', 'assistant')
      AND length(COALESCE(entry.value->>'content', '')) BETWEEN 1 AND 4000
      AND entry.value ? 'created_at'
      AND NOT v_previous_history @> jsonb_build_array(entry.value)
  LOOP
    INSERT INTO public.procurement_conversation_messages (
      conversation_id, employer_id, user_id, role, content, created_at
    )
    SELECT NEW.id, NEW.employer_id, NEW.user_id, v_entry->>'role',
           v_entry->>'content', (v_entry->>'created_at')::timestamptz;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER archive_procurement_conversation_history
  AFTER INSERT OR UPDATE OF history ON public.procurement_conversations
  FOR EACH ROW EXECUTE FUNCTION public.archive_procurement_conversation_history();
REVOKE ALL ON FUNCTION public.archive_procurement_conversation_history()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.append_procurement_conversation_turn(
  p_conversation_id UUID,
  p_user_id UUID,
  p_employer_id UUID,
  p_expected_revision INTEGER,
  p_user_message TEXT,
  p_assistant_message TEXT,
  p_history JSONB,
  p_draft JSONB,
  p_confirmed_fields TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_conversation public.procurement_conversations%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employer_profiles ep
    WHERE ep.id = p_employer_id AND ep.user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT * INTO v_conversation
  FROM public.procurement_conversations
  WHERE id = p_conversation_id
    AND user_id = p_user_id
    AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'STALE_CONVERSATION_STATE');
  END IF;
  IF v_conversation.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'CONVERSATION_NOT_ACTIVE');
  END IF;
  IF v_conversation.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'STALE_CONVERSATION_STATE');
  END IF;
  IF length(COALESCE(p_user_message, '')) NOT BETWEEN 1 AND 4000
    OR length(COALESCE(p_assistant_message, '')) NOT BETWEEN 1 AND 4000
    OR jsonb_typeof(p_history) <> 'array'
    OR jsonb_array_length(p_history) > 80
    OR jsonb_typeof(p_draft) <> 'object' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'CONVERSATION_STATE_INVALID');
  END IF;

  UPDATE public.procurement_conversations
  SET history = p_history,
      draft = p_draft,
      confirmed_fields = p_confirmed_fields,
      revision = revision + 1
  WHERE id = p_conversation_id
  RETURNING * INTO v_conversation;

  RETURN jsonb_build_object('ok', TRUE, 'conversation', to_jsonb(v_conversation));
END;
$$;

REVOKE ALL ON FUNCTION public.append_procurement_conversation_turn(
  UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, JSONB, TEXT[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_procurement_conversation_turn(
  UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, JSONB, TEXT[]
) TO service_role;

COMMIT;
