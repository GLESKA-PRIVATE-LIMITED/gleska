BEGIN;

ALTER TABLE public.worker_profiles
  DROP CONSTRAINT IF EXISTS worker_profiles_location_source_check;

ALTER TABLE public.worker_profiles
  ADD CONSTRAINT worker_profiles_location_source_check
  CHECK (location_source IS NULL OR location_source IN ('PROFILE', 'GPS', 'SEARCH', 'MAP'));

CREATE OR REPLACE FUNCTION public.create_job_matches_for_profiles(p_job_id uuid)
RETURNS TABLE (match_id uuid, worker_profile_id uuid, composite_score numeric, distance_m numeric, expires_at timestamptz)
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
  ),
  ranked_profiles AS (
    SELECT profile.id AS worker_profile_id, distance.distance_m,
      (1.0 - (distance.distance_m / 30000.0))::numeric AS composite_score
    FROM jobs AS job
    JOIN job_sites AS site ON site.id = job.job_site_id
    JOIN effective_locations AS profile ON TRUE
    CROSS JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326),
        site.location
      ) AS distance_m
    ) AS distance
    WHERE job.id = p_job_id AND site.location IS NOT NULL
      AND profile.profile_completed = TRUE AND profile.availability_status = 'AVAILABLE'
      AND profile.latitude IS NOT NULL AND profile.longitude IS NOT NULL
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
  JOIN job_matches AS worker_match ON worker_match.job_id = job.id AND worker_match.worker_profile_id = profile.id
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
