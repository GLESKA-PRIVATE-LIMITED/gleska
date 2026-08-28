BEGIN;

ALTER TABLE public.job_sites
  ADD COLUMN IF NOT EXISTS address TEXT;

CREATE TABLE IF NOT EXISTS public.worker_current_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_profile_id UUID NOT NULL UNIQUE REFERENCES public.worker_profiles(id) ON DELETE CASCADE,
  latitude NUMERIC NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude NUMERIC NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  accuracy_m NUMERIC NOT NULL CHECK (accuracy_m > 0),
  address TEXT NOT NULL CHECK (char_length(trim(address)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_current_locations_profile
  ON public.worker_current_locations(worker_profile_id);

DROP TRIGGER IF EXISTS update_worker_current_locations_updated_at ON public.worker_current_locations;
CREATE TRIGGER update_worker_current_locations_updated_at
  BEFORE UPDATE ON public.worker_current_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.create_job_matches_for_profiles(p_job_id uuid)
RETURNS TABLE (match_id uuid, worker_profile_id uuid, composite_score numeric, distance_m numeric, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH ranked_profiles AS (
    SELECT profile.id AS worker_profile_id, distance.distance_m,
      (1.0 - (distance.distance_m / 30000.0))::numeric AS composite_score
    FROM jobs AS job
    JOIN job_sites AS site ON site.id = job.job_site_id
    JOIN worker_profiles AS profile ON TRUE
    JOIN worker_current_locations AS current_location ON current_location.worker_profile_id = profile.id
    CROSS JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(current_location.longitude, current_location.latitude), 4326),
        site.location
      ) AS distance_m
    ) AS distance
    WHERE job.id = p_job_id AND site.location IS NOT NULL
      AND profile.profile_completed = TRUE AND profile.availability_status = 'AVAILABLE'
      AND distance.distance_m <= 30000
      AND NOT EXISTS (
        SELECT 1 FROM job_matches AS existing_match
        WHERE existing_match.job_id = job.id AND existing_match.worker_profile_id = profile.id
      )
    ORDER BY composite_score DESC
    LIMIT (SELECT headcount_required * 3 FROM jobs WHERE id = p_job_id)
  ),
  inserted_matches AS (
    INSERT INTO job_matches (id, job_id, worker_profile_id, composite_score, expires_at, status)
    SELECT gen_random_uuid(), p_job_id, worker_profile_id, composite_score, NOW() + INTERVAL '2 minutes', 'PENDING'
    FROM ranked_profiles
    RETURNING id AS match_id, worker_profile_id, composite_score, expires_at
  )
  SELECT inserted.match_id, inserted.worker_profile_id, inserted.composite_score,
    ranked.distance_m, inserted.expires_at
  FROM inserted_matches AS inserted
  JOIN ranked_profiles AS ranked ON ranked.worker_profile_id = inserted.worker_profile_id
  ORDER BY inserted.composite_score DESC;
$$;

CREATE OR REPLACE FUNCTION public.find_available_jobs_for_worker(p_worker_id uuid, p_max_radius integer DEFAULT 30000)
RETURNS TABLE (job_id uuid, title text, salary numeric, headcount integer, min_experience integer, employer_name text, distance_m numeric, distance_km numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT job.id, job.title, COALESCE(job.max_daily_salary, 0), job.headcount_required,
    job.min_experience, employer.contact_person_name, distance.distance_m,
    ROUND((distance.distance_m / 1000.0)::numeric, 1)
  FROM worker_profiles AS profile
  JOIN worker_current_locations AS current_location ON current_location.worker_profile_id = profile.id
  JOIN job_sites AS site ON site.location IS NOT NULL
  JOIN jobs AS job ON job.job_site_id = site.id
  JOIN job_matches AS worker_match ON worker_match.job_id = job.id AND worker_match.worker_profile_id = profile.id
  JOIN employer_profiles AS employer ON employer.id = job.employer_id
  CROSS JOIN LATERAL (
    SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(current_location.longitude, current_location.latitude), 4326),
      site.location
    ) AS distance_m
  ) AS distance
  WHERE profile.id = p_worker_id AND profile.profile_completed = TRUE
    AND profile.availability_status = 'AVAILABLE' AND job.status = 'SEARCHING'
    AND COALESCE(worker_match.status, 'PENDING') = 'PENDING'
    AND distance.distance_m <= p_max_radius
  ORDER BY distance.distance_m ASC;
$$;

REVOKE ALL ON FUNCTION public.create_job_matches_for_profiles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_matches_for_profiles(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.find_available_jobs_for_worker(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_available_jobs_for_worker(uuid, integer) TO service_role;

COMMIT;
