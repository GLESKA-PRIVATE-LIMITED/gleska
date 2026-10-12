BEGIN;

CREATE TABLE public.supplier_user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  show_archived_offerings BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_supplier_user_preferences_updated_at
  ON public.supplier_user_preferences;
CREATE TRIGGER update_supplier_user_preferences_updated_at
  BEFORE UPDATE ON public.supplier_user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.supplier_user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own supplier preferences"
  ON public.supplier_user_preferences;
CREATE POLICY "Users can view their own supplier preferences"
  ON public.supplier_user_preferences FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "Users can insert their own supplier preferences"
  ON public.supplier_user_preferences;
CREATE POLICY "Users can insert their own supplier preferences"
  ON public.supplier_user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "Users can update their own supplier preferences"
  ON public.supplier_user_preferences;
CREATE POLICY "Users can update their own supplier preferences"
  ON public.supplier_user_preferences FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "Service role can manage supplier preferences"
  ON public.supplier_user_preferences;
CREATE POLICY "Service role can manage supplier preferences"
  ON public.supplier_user_preferences FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.supplier_user_preferences FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.supplier_user_preferences
  TO authenticated;
GRANT ALL ON TABLE public.supplier_user_preferences TO service_role;

COMMIT;
