BEGIN;

CREATE TABLE IF NOT EXISTS public.procurement_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'COMPLETED')),
  history JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(history) = 'array'),
  draft JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(draft) = 'object'),
  confirmed_fields TEXT[] NOT NULL DEFAULT '{}'::text[]
    CHECK (
      confirmed_fields <@ ARRAY[
        'title', 'item_name', 'specification', 'quantity', 'unit',
        'required_by', 'delivery_location', 'additional_requirements', 'notes'
      ]::text[]
    ),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_conversations_owner_updated
  ON public.procurement_conversations(employer_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_procurement_conversations_status_updated
  ON public.procurement_conversations(status, updated_at DESC);

DROP TRIGGER IF EXISTS update_procurement_conversations_updated_at
  ON public.procurement_conversations;
CREATE TRIGGER update_procurement_conversations_updated_at
  BEFORE UPDATE ON public.procurement_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.procurement_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Procurement owners can view their conversations"
  ON public.procurement_conversations;
CREATE POLICY "Procurement owners can view their conversations"
  ON public.procurement_conversations FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Procurement owners can create their conversations"
  ON public.procurement_conversations;
CREATE POLICY "Procurement owners can create their conversations"
  ON public.procurement_conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Procurement owners can update their conversations"
  ON public.procurement_conversations;
CREATE POLICY "Procurement owners can update their conversations"
  ON public.procurement_conversations FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.procurement_material_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  origin_conversation_id UUID REFERENCES public.procurement_conversations(id) ON DELETE SET NULL,
  idempotency_key UUID NOT NULL,
  title TEXT,
  item_name TEXT NOT NULL,
  specification TEXT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  required_by DATE,
  delivery_location TEXT,
  additional_requirements JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(additional_requirements) = 'array'),
  notes TEXT,
  confirmed_fields TEXT[] NOT NULL
    CHECK (
      confirmed_fields <@ ARRAY[
        'title', 'item_name', 'specification', 'quantity', 'unit',
        'required_by', 'delivery_location', 'additional_requirements', 'notes'
      ]::text[]
      AND confirmed_fields @> ARRAY['item_name', 'quantity', 'unit']::text[]
    ),
  status TEXT NOT NULL DEFAULT 'SAVED' CHECK (status = 'SAVED'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procurement_material_requests_employer_idempotency_unique
    UNIQUE (employer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_procurement_requests_owner_updated
  ON public.procurement_material_requests(employer_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_procurement_requests_status_updated
  ON public.procurement_material_requests(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_procurement_requests_origin_conversation
  ON public.procurement_material_requests(origin_conversation_id);

DROP TRIGGER IF EXISTS update_procurement_material_requests_updated_at
  ON public.procurement_material_requests;
CREATE TRIGGER update_procurement_material_requests_updated_at
  BEFORE UPDATE ON public.procurement_material_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.procurement_material_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Procurement owners can view their material requests"
  ON public.procurement_material_requests;
CREATE POLICY "Procurement owners can view their material requests"
  ON public.procurement_material_requests FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Procurement owners can create their material requests"
  ON public.procurement_material_requests;
CREATE POLICY "Procurement owners can create their material requests"
  ON public.procurement_material_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Procurement owners can update their material requests"
  ON public.procurement_material_requests;
CREATE POLICY "Procurement owners can update their material requests"
  ON public.procurement_material_requests FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = employer_id AND ep.user_id = auth.uid()
    )
  );

COMMIT;
