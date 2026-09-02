BEGIN;

ALTER TABLE public.worker_current_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workers can view their own current location" ON public.worker_current_locations;
CREATE POLICY "Workers can view their own current location"
  ON public.worker_current_locations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.worker_profiles wp
      WHERE wp.id = worker_current_locations.worker_profile_id
        AND wp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workers can insert their own current location" ON public.worker_current_locations;
CREATE POLICY "Workers can insert their own current location"
  ON public.worker_current_locations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.worker_profiles wp
      WHERE wp.id = worker_current_locations.worker_profile_id
        AND wp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workers can update their own current location" ON public.worker_current_locations;
CREATE POLICY "Workers can update their own current location"
  ON public.worker_current_locations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.worker_profiles wp
      WHERE wp.id = worker_current_locations.worker_profile_id
        AND wp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.worker_profiles wp
      WHERE wp.id = worker_current_locations.worker_profile_id
        AND wp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can access all worker current locations" ON public.worker_current_locations;
CREATE POLICY "Service role can access all worker current locations"
  ON public.worker_current_locations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
