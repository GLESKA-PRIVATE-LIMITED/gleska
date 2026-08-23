-- Bridge deterministic matching to the canonical users/worker_profiles model.
-- Existing workers/job_matches remain valid and are not rewritten.
ALTER TABLE public.job_matches
  ADD COLUMN IF NOT EXISTS worker_profile_id uuid
  REFERENCES public.worker_profiles(id);

CREATE INDEX IF NOT EXISTS idx_job_matches_worker_profile_id
  ON public.job_matches(worker_profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_matches_profile_job_unique
  ON public.job_matches(job_id, worker_profile_id)
  WHERE worker_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_job_matches_for_profiles(p_job_id uuid)
RETURNS TABLE (
  match_id uuid,
  worker_profile_id uuid,
  composite_score numeric,
  distance_m numeric,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked_profiles AS (
    SELECT
      profile.id AS worker_profile_id,
      distance.distance_m,
      (
        (1.0 - (distance.distance_m / 30000.0)) * 0.5
        + (5.0 / 5.0) * 0.3
        + (LEAST(0, 50) / 50.0) * 0.2
      ) AS composite_score
    FROM jobs AS job
    JOIN job_sites AS site ON site.id = job.job_site_id
    JOIN worker_profiles AS profile ON TRUE
    CROSS JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326),
        site.location
      ) AS distance_m
    ) AS distance
    WHERE job.id = p_job_id
      AND site.location IS NOT NULL
      AND profile.profile_completed = TRUE
      AND profile.availability_status = 'AVAILABLE'
      AND profile.trade_id IS NOT NULL
      AND profile.latitude IS NOT NULL
      AND profile.longitude IS NOT NULL
      AND LOWER(TRIM(profile.trade_id)) = LOWER(TRIM(job.title))
      AND COALESCE(profile.experience_years, 0) >= COALESCE(job.min_experience, 0)
      AND (
        job.max_daily_salary IS NULL
        OR profile.expected_daily_wage IS NULL
        OR profile.expected_daily_wage <= job.max_daily_salary
      )
      AND distance.distance_m <= 30000
      AND NOT EXISTS (
        SELECT 1
        FROM job_matches AS existing_match
        WHERE existing_match.job_id = job.id
          AND existing_match.worker_profile_id = profile.id
      )
    ORDER BY composite_score DESC
    LIMIT (SELECT headcount_required * 3 FROM jobs WHERE id = p_job_id)
  ),
  inserted_matches AS (
    INSERT INTO job_matches (id, job_id, worker_profile_id, composite_score, expires_at)
    SELECT gen_random_uuid(), p_job_id, worker_profile_id, composite_score, NOW() + INTERVAL '2 minutes'
    FROM ranked_profiles
    RETURNING id AS match_id, worker_profile_id, composite_score, expires_at
  )
  SELECT inserted.match_id, inserted.worker_profile_id, inserted.composite_score,
         ranked.distance_m, inserted.expires_at
  FROM inserted_matches AS inserted
  JOIN ranked_profiles AS ranked ON ranked.worker_profile_id = inserted.worker_profile_id
  ORDER BY inserted.composite_score DESC;
$$;

REVOKE ALL ON FUNCTION public.create_job_matches_for_profiles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_matches_for_profiles(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.find_available_jobs_for_worker(
  p_worker_id uuid,
  p_max_radius integer DEFAULT 30000
)
RETURNS TABLE (
  job_id uuid,
  title text,
  salary numeric,
  headcount integer,
  min_experience integer,
  employer_name text,
  distance_m numeric,
  distance_km numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    job.id,
    job.title,
    COALESCE(job.max_daily_salary, 0),
    job.headcount_required,
    job.min_experience,
    employer.company_name,
    distance.distance_m,
    ROUND((distance.distance_m / 1000.0)::numeric, 1)
  FROM worker_profiles AS profile
  JOIN job_sites AS site ON site.location IS NOT NULL
  JOIN jobs AS job ON job.job_site_id = site.id
  JOIN employers AS employer ON employer.id = job.employer_id
  CROSS JOIN LATERAL (
    SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326),
      site.location
    ) AS distance_m
  ) AS distance
  WHERE profile.id = p_worker_id
    AND profile.profile_completed = TRUE
    AND profile.availability_status = 'AVAILABLE'
    AND profile.trade_id IS NOT NULL
    AND profile.latitude IS NOT NULL
    AND profile.longitude IS NOT NULL
    AND job.status = 'SEARCHING'
    AND LOWER(TRIM(profile.trade_id)) = LOWER(TRIM(job.title))
    AND COALESCE(profile.experience_years, 0) >= COALESCE(job.min_experience, 0)
    AND (
      job.max_daily_salary IS NULL
      OR profile.expected_daily_wage IS NULL
      OR profile.expected_daily_wage <= job.max_daily_salary
    )
    AND distance.distance_m <= p_max_radius
    AND NOT EXISTS (
      SELECT 1
      FROM job_matches AS existing_match
      WHERE existing_match.job_id = job.id
        AND (
          existing_match.worker_profile_id = profile.id
          OR existing_match.worker_id IN (
            SELECT legacy_worker.id
            FROM workers AS legacy_worker
            JOIN users AS app_user ON app_user.id = profile.user_id
            WHERE legacy_worker.supabase_auth_id = app_user.id::text
          )
        )
    )
  ORDER BY distance.distance_m ASC;
$$;

REVOKE ALL ON FUNCTION public.find_available_jobs_for_worker(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_available_jobs_for_worker(uuid, integer) TO service_role;
