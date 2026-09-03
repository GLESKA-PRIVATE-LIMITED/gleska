BEGIN;

-- Keep expired pending rows for audit/history, but do not expose them as
-- current employer matches that can no longer be accepted.
CREATE OR REPLACE FUNCTION public.get_current_job_match_workers(
  p_employer_id uuid,
  p_job_id uuid DEFAULT NULL
)
RETURNS TABLE (
  job_id uuid,
  worker_profile_id uuid,
  name text,
  trade_id text,
  skills text[],
  experience_years integer,
  expected_daily_wage numeric,
  availability_status worker_availability,
  distance_m numeric,
  composite_score numeric,
  status text,
  created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH effective_locations AS (
    SELECT profile.id, profile.user_id, profile.profile_completed, profile.availability_status,
      profile.trade_id, profile.skills, profile.experience_years,
      profile.expected_daily_wage,
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
  SELECT job.id, profile.id, worker.name, profile.trade_id, profile.skills,
    profile.experience_years, profile.expected_daily_wage, profile.availability_status,
    distance.distance_m, job_match.composite_score, job_match.status, job_match.created_at
  FROM jobs AS job
  JOIN job_sites AS site ON site.id = job.job_site_id
  JOIN job_matches AS job_match ON job_match.job_id = job.id
  JOIN effective_locations AS profile ON profile.id = job_match.worker_profile_id
  LEFT JOIN users AS worker ON worker.id = profile.user_id
  CROSS JOIN LATERAL (
    SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326), site.location
    ) AS distance_m
  ) AS distance
  WHERE job.employer_id = p_employer_id
    AND (p_job_id IS NULL OR job.id = p_job_id)
    AND site.location IS NOT NULL
    AND job_match.expires_at > NOW()
    AND profile.profile_completed = TRUE
    AND profile.availability_status = 'AVAILABLE'
    AND profile.latitude IS NOT NULL AND profile.longitude IS NOT NULL
    AND distance.distance_m <= 30000
    AND (job.trade_id IS NULL OR trim(job.trade_id) = ''
      OR (profile.trade_id IS NOT NULL AND lower(trim(profile.trade_id)) = lower(trim(job.trade_id))))
    AND (job.min_experience IS NULL OR (profile.experience_years IS NOT NULL AND profile.experience_years >= job.min_experience))
    AND (job.max_daily_salary IS NULL OR (profile.expected_daily_wage IS NOT NULL AND profile.expected_daily_wage <= job.max_daily_salary))
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(job.required_skills, '{}'::text[])) AS required_skill(value)
      WHERE trim(required_skill.value) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM unnest(COALESCE(profile.skills, '{}'::text[])) AS worker_skill(value)
          WHERE lower(trim(worker_skill.value)) = lower(trim(required_skill.value))
        )
    )
  ORDER BY job_match.composite_score DESC;
$$;

REVOKE ALL ON FUNCTION public.get_current_job_match_workers(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_job_match_workers(uuid, uuid) TO service_role;

COMMIT;