-- Preserve the legacy deterministic matcher behind the Supabase API boundary.
CREATE OR REPLACE FUNCTION public.create_job_matches(p_job_id uuid)
RETURNS TABLE (
  match_id uuid,
  worker_id uuid,
  composite_score numeric,
  distance_m numeric,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked_workers AS (
    SELECT
      w.id AS worker_id,
      distance.distance_m,
      (
        (1.0 - (distance.distance_m / 30000.0)) * 0.5
        + (w.overall_rating / 5.0) * 0.3
        + (LEAST(w.total_jobs, 50) / 50.0) * 0.2
      ) AS composite_score,
      j.headcount_required
    FROM jobs AS j
    JOIN job_sites AS site ON site.id = j.job_site_id
    JOIN workers AS w ON TRUE
    CROSS JOIN LATERAL (
      SELECT ST_DistanceSphere(w.current_location, site.location) AS distance_m
    ) AS distance
    WHERE j.id = p_job_id
      AND w.current_location IS NOT NULL
      AND site.location IS NOT NULL
      AND w.is_available = TRUE
      AND (w.is_verified = TRUE OR w.account_type = 'INDIVIDUAL')
      AND distance.distance_m <= 30000
      AND NOT EXISTS (
        SELECT 1
        FROM job_matches AS existing_match
        WHERE existing_match.job_id = j.id
          AND existing_match.worker_id = w.id
      )
    ORDER BY composite_score DESC
    LIMIT (SELECT headcount_required * 3 FROM jobs WHERE id = p_job_id)
  ),
  inserted_matches AS (
    INSERT INTO job_matches (id, job_id, worker_id, composite_score, expires_at)
    SELECT gen_random_uuid(), p_job_id, worker_id, composite_score, NOW() + INTERVAL '2 minutes'
    FROM ranked_workers
    RETURNING id AS match_id, worker_id, composite_score, expires_at
  )
  SELECT inserted.match_id, inserted.worker_id, inserted.composite_score,
         ranked.distance_m, inserted.expires_at
  FROM inserted_matches AS inserted
  JOIN ranked_workers AS ranked ON ranked.worker_id = inserted.worker_id
  ORDER BY inserted.composite_score DESC;
$$;

REVOKE ALL ON FUNCTION public.create_job_matches(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_matches(uuid) TO service_role;

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
    j.id,
    j.title,
    COALESCE(j.max_daily_salary, 0),
    j.headcount_required,
    j.min_experience,
    e.company_name,
    distance.distance_m,
    ROUND((distance.distance_m / 1000.0)::numeric, 1)
  FROM workers AS w
  JOIN job_sites AS site ON site.location IS NOT NULL
  JOIN jobs AS j ON j.job_site_id = site.id
  JOIN employers AS e ON e.id = j.employer_id
  CROSS JOIN LATERAL (
    SELECT ST_DistanceSphere(w.current_location, site.location) AS distance_m
  ) AS distance
  WHERE w.id = p_worker_id
    AND w.current_location IS NOT NULL
    AND j.status = 'SEARCHING'
    AND distance.distance_m <= p_max_radius
    AND NOT EXISTS (
      SELECT 1
      FROM job_matches AS existing_match
      WHERE existing_match.worker_id = w.id
        AND existing_match.job_id = j.id
    )
  ORDER BY distance.distance_m ASC;
$$;

REVOKE ALL ON FUNCTION public.find_available_jobs_for_worker(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_available_jobs_for_worker(uuid, integer) TO service_role;