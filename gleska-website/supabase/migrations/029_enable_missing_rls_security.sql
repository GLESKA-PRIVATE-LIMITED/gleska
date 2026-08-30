-- Migration 029: Enable Row Level Security and add strict access policies on sensitive tables
BEGIN;

-- 1. Enable RLS on job_sites
ALTER TABLE public.job_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employers can view their own job sites" ON public.job_sites;
CREATE POLICY "Employers can view their own job sites"
  ON public.job_sites FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = job_sites.employer_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Employers can insert their own job sites" ON public.job_sites;
CREATE POLICY "Employers can insert their own job sites"
  ON public.job_sites FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = job_sites.employer_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Employers can update their own job sites" ON public.job_sites;
CREATE POLICY "Employers can update their own job sites"
  ON public.job_sites FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = job_sites.employer_id
        AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = job_sites.employer_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Employers can delete their own job sites" ON public.job_sites;
CREATE POLICY "Employers can delete their own job sites"
  ON public.job_sites FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = job_sites.employer_id
        AND ep.user_id = auth.uid()
    )
  );

-- 2. Enable RLS on jobs
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employers can view their own jobs" ON public.jobs;
CREATE POLICY "Employers can view their own jobs"
  ON public.jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = jobs.employer_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Employers can insert their own jobs" ON public.jobs;
CREATE POLICY "Employers can insert their own jobs"
  ON public.jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = jobs.employer_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Employers can update their own jobs" ON public.jobs;
CREATE POLICY "Employers can update their own jobs"
  ON public.jobs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = jobs.employer_id
        AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = jobs.employer_id
        AND ep.user_id = auth.uid()
    )
  );

-- 3. Enable RLS on job_matches (protecting OTPs and dispatch details)
ALTER TABLE public.job_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workers can view their own job matches" ON public.job_matches;
CREATE POLICY "Workers can view their own job matches"
  ON public.job_matches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.worker_profiles wp
      WHERE wp.id = job_matches.worker_profile_id
        AND wp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Employers can view job matches for their jobs" ON public.job_matches;
CREATE POLICY "Employers can view job matches for their jobs"
  ON public.job_matches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      INNER JOIN public.employer_profiles ep ON ep.id = j.employer_id
      WHERE j.id = job_matches.job_id
        AND ep.user_id = auth.uid()
    )
  );

-- 4. Enable RLS on worker_current_locations (protecting real-time GPS coordinates)
ALTER TABLE public.worker_current_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workers can view their own current location" ON public.worker_current_locations;
CREATE POLICY "Workers can view their own current location"
  ON public.worker_current_locations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Workers can insert their own current location" ON public.worker_current_locations;
CREATE POLICY "Workers can insert their own current location"
  ON public.worker_current_locations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Workers can update their own current location" ON public.worker_current_locations;
CREATE POLICY "Workers can update their own current location"
  ON public.worker_current_locations FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 5. Enable RLS on contact_inquiries (blocking direct anon/public PostgREST access)
ALTER TABLE public.contact_inquiries ENABLE ROW LEVEL SECURITY;

COMMIT;
