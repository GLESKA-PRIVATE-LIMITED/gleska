BEGIN;

CREATE OR REPLACE FUNCTION public.create_job_matches_for_profiles(
  p_job_id uuid
)
RETURNS TABLE (
  match_id uuid,
  worker_profile_id uuid,
  composite_score numeric,
  distance_m numeric,
  expires_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH effective_locations AS (
    SELECT profile.id,
      profile.profile_completed,
      profile.availability_status,
      profile.trade_id,
      profile.skills,
      profile.experience_years,
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
    WHERE job.id = p_job_id
      AND site.location IS NOT NULL
      AND profile.profile_completed = TRUE
      AND profile.availability_status = 'AVAILABLE'
      AND profile.latitude IS NOT NULL AND profile.longitude IS NOT NULL
      AND distance.distance_m <= 30000
      AND (job.trade_id IS NULL OR trim(job.trade_id) = ''
        OR (profile.trade_id IS NOT NULL AND lower(trim(profile.trade_id)) = lower(trim(job.trade_id))))
      AND (job.min_experience IS NULL OR (profile.experience_years IS NOT NULL AND profile.experience_years >= job.min_experience))
      AND (job.max_daily_salary IS NULL OR (profile.expected_daily_wage IS NOT NULL AND profile.expected_daily_wage <= job.max_daily_salary))
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(job.required_skills, '{}'::text[])) AS required_skill(value)
        WHERE trim(required_skill.value) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(COALESCE(profile.skills, '{}'::text[])) AS worker_skill(value)
            WHERE lower(trim(worker_skill.value)) = lower(trim(required_skill.value))
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_matches AS existing_match
        WHERE existing_match.job_id = job.id
          AND existing_match.worker_profile_id = profile.id
      )
    ORDER BY composite_score DESC
    LIMIT (SELECT headcount_required * 3 FROM jobs WHERE id = p_job_id)
  ),
  inserted_matches AS (
    INSERT INTO job_matches (id, job_id, worker_profile_id, composite_score, expires_at, status)
    SELECT gen_random_uuid(), p_job_id, worker_profile_id, composite_score,
      NOW() + INTERVAL '2 minutes', 'PENDING'
    FROM ranked_profiles
    RETURNING id AS match_id, worker_profile_id, composite_score, expires_at
  )
  SELECT inserted.match_id, inserted.worker_profile_id, inserted.composite_score,
    ranked.distance_m, inserted.expires_at
  FROM inserted_matches AS inserted
  JOIN ranked_profiles AS ranked ON ranked.worker_profile_id = inserted.worker_profile_id
  ORDER BY inserted.composite_score DESC;
$$;

COMMIT;