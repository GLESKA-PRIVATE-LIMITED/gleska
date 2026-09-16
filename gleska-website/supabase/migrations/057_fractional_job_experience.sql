BEGIN;

-- Experience is measured in years and may include fractional years (for example, 2.5).
ALTER TABLE public.jobs
  ALTER COLUMN min_experience TYPE NUMERIC USING min_experience::numeric;

DROP FUNCTION IF EXISTS public.create_job_for_employer(
  UUID, UUID, TEXT, INTEGER, NUMERIC, INTEGER, TEXT, TEXT[], INTEGER, TEXT
);

CREATE OR REPLACE FUNCTION public.create_job_for_employer(
  p_employer_id UUID,
  p_job_site_id UUID,
  p_title TEXT,
  p_headcount_required INTEGER,
  p_max_daily_salary NUMERIC DEFAULT NULL,
  p_min_experience NUMERIC DEFAULT NULL,
  p_trade_id TEXT DEFAULT NULL,
  p_required_skills TEXT[] DEFAULT '{}'::TEXT[],
  p_work_duration_days INTEGER DEFAULT NULL,
  p_work_timing TEXT DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  employer public.employer_profiles%ROWTYPE;
  created_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO employer FROM public.employer_profiles WHERE id = p_employer_id FOR UPDATE;
  IF NOT FOUND OR employer.onboarding_status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'EMPLOYER_ONBOARDING_INCOMPLETE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_sites WHERE id = p_job_site_id AND employer_id = p_employer_id) THEN
    RAISE EXCEPTION 'JOB_SITE_NOT_FOUND';
  END IF;
  IF employer.subscription_valid_until IS NULL OR employer.subscription_valid_until <= NOW() THEN
    IF employer.has_availed_free_dispatch THEN
      RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED';
    END IF;
    employer.has_availed_free_dispatch := TRUE;
    UPDATE public.employer_profiles SET has_availed_free_dispatch = TRUE WHERE id = p_employer_id;
  END IF;

  INSERT INTO public.jobs (
    employer_id, job_site_id, title, headcount_required, max_daily_salary,
    min_experience, trade_id, required_skills, work_duration_days, work_timing, status
  )
  VALUES (
    p_employer_id, p_job_site_id, p_title, p_headcount_required, p_max_daily_salary,
    p_min_experience, p_trade_id, COALESCE(p_required_skills, '{}'::TEXT[]),
    p_work_duration_days, p_work_timing, 'SEARCHING'
  )
  RETURNING * INTO created_job;

  RETURN created_job;
END;
$$;

REVOKE ALL ON FUNCTION public.create_job_for_employer(UUID, UUID, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT, TEXT[], INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_for_employer(UUID, UUID, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT, TEXT[], INTEGER, TEXT) TO service_role;

-- The worker-facing RPC must expose the same numeric experience contract.
DROP FUNCTION IF EXISTS public.find_available_jobs_for_worker(UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.find_available_jobs_for_worker(
  p_worker_id UUID,
  p_max_radius INTEGER DEFAULT 30000
)
RETURNS TABLE (
  job_id UUID,
  title TEXT,
  salary NUMERIC,
  headcount INTEGER,
  min_experience NUMERIC,
  employer_name TEXT,
  distance_m NUMERIC,
  distance_km NUMERIC
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH effective_locations AS (
    SELECT profile.id,
      profile.profile_completed,
      profile.availability_status,
      CASE WHEN current_location.id IS NOT NULL
        AND current_location.accuracy_m <= 1000
        AND current_location.updated_at >= NOW() - INTERVAL '10 minutes'
        THEN current_location.latitude ELSE profile.latitude END AS latitude,
      CASE WHEN current_location.id IS NOT NULL
        AND current_location.accuracy_m <= 1000
        AND current_location.updated_at >= NOW() - INTERVAL '10 minutes'
        THEN current_location.longitude ELSE profile.longitude END AS longitude
    FROM worker_profiles AS profile
    LEFT JOIN worker_current_locations AS current_location
      ON current_location.worker_profile_id = profile.id
  )
  SELECT job.id, job.title, COALESCE(job.max_daily_salary, 0), job.headcount_required,
    job.min_experience, employer.contact_person_name, distance.distance_m,
    ROUND((distance.distance_m / 1000.0)::numeric, 1)
  FROM effective_locations AS profile
  JOIN job_sites AS site ON site.location IS NOT NULL
  JOIN jobs AS job ON job.job_site_id = site.id
  JOIN job_matches AS worker_match
    ON worker_match.job_id = job.id
   AND worker_match.worker_profile_id = profile.id
  JOIN employer_profiles AS employer ON employer.id = job.employer_id
  CROSS JOIN LATERAL (
    SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326),
      site.location
    ) AS distance_m
  ) AS distance
  WHERE profile.id = p_worker_id AND profile.profile_completed = TRUE
    AND profile.availability_status = 'AVAILABLE'
    AND profile.latitude IS NOT NULL AND profile.longitude IS NOT NULL
    AND job.status = 'SEARCHING'
    AND COALESCE(worker_match.status, 'PENDING') = 'PENDING'
    AND distance.distance_m <= p_max_radius
  ORDER BY distance.distance_m ASC;
$$;

COMMIT;
