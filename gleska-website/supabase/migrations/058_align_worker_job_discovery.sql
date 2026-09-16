BEGIN;

-- Keep worker discovery aligned with pending-match validity and job capacity.
-- This does not change matching eligibility or scoring.
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
  SELECT job.id, job.title, job.max_daily_salary, job.headcount_required,
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
  WHERE profile.id = p_worker_id
    AND profile.profile_completed = TRUE
    AND profile.availability_status = 'AVAILABLE'
    AND profile.latitude IS NOT NULL
    AND profile.longitude IS NOT NULL
    AND job.status = 'SEARCHING'
    AND worker_match.status = 'PENDING'
    AND worker_match.expires_at > NOW()
    AND distance.distance_m <= p_max_radius
    AND (
      SELECT COUNT(*)
      FROM job_matches AS accepted_match
      WHERE accepted_match.job_id = job.id
        AND accepted_match.status = 'ACCEPTED'
    ) < job.headcount_required
  ORDER BY distance.distance_m ASC;
$$;

REVOKE ALL ON FUNCTION public.find_available_jobs_for_worker(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_available_jobs_for_worker(UUID, INTEGER) TO service_role;

COMMIT;
