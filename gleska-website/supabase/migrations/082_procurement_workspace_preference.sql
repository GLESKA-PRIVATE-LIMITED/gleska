BEGIN;

CREATE TABLE public.procurement_workspace_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  preferred_workspace TEXT NOT NULL
    CHECK (preferred_workspace IN ('BUYER', 'SUPPLIER')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_procurement_workspace_preferences_updated_at
  ON public.procurement_workspace_preferences;
CREATE TRIGGER update_procurement_workspace_preferences_updated_at
  BEFORE UPDATE ON public.procurement_workspace_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.procurement_workspace_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.procurement_workspace_preferences
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.procurement_workspace_preferences TO service_role;

COMMIT;
