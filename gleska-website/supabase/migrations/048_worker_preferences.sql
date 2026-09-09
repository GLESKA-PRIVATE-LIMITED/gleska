BEGIN;

CREATE TABLE IF NOT EXISTS public.worker_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  job_matching_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  attendance_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  security_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  language TEXT NOT NULL DEFAULT 'EN' CHECK (language IN ('EN', 'HI', 'MR', 'TA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_preferences_user_id
  ON public.worker_preferences (user_id);

DROP TRIGGER IF EXISTS update_worker_preferences_updated_at ON public.worker_preferences;
CREATE TRIGGER update_worker_preferences_updated_at
  BEFORE UPDATE ON public.worker_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.worker_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own worker preferences" ON public.worker_preferences;
CREATE POLICY "Users can view their own worker preferences"
  ON public.worker_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own worker preferences" ON public.worker_preferences;
CREATE POLICY "Users can insert their own worker preferences"
  ON public.worker_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own worker preferences" ON public.worker_preferences;
CREATE POLICY "Users can update their own worker preferences"
  ON public.worker_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can do anything on worker_preferences" ON public.worker_preferences;
CREATE POLICY "Service role can do anything on worker_preferences"
  ON public.worker_preferences FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
