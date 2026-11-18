-- 114_tiered_location_matching.sql
--
-- Problem: reconcile_job_candidate_pool (and related functions) require workers to have a
-- fresh GPS fix in worker_current_locations (accuracy <= 1km, updated < 10 min). Most
-- registered workers only have a city or profile-level lat/long, so matching returns zero
-- candidates even when workers clearly match the job location.
--
-- Fix: three-tier location fallback in all five matching/discovery functions:
--   Tier 1 — fresh GPS from worker_current_locations  (score 1.0 × proximity, 24h expiry)
--   Tier 2 — profile lat/long from worker_profiles     (score 0.5 × proximity, 24h expiry)
--   Tier 3 — city text: profile.city = site.city       (score 0.3 flat, 72h expiry)
-- Each worker matches at the highest available tier; city match only triggers when the
-- worker has no usable coordinates.
--
-- Functions replaced (CREATE OR REPLACE — no schema changes, pure behaviour fix):
--   worker_matches_job            (base: migration 067)
--   reconcile_job_candidate_pool  (base: migration 111)
--   get_current_job_match_workers (base: migration 069)
--   reconcile_worker_candidate_pools (base: migration 067)
--   find_available_jobs_for_worker   (base: migration 067)
--
-- RLS impact: none — all functions are SECURITY DEFINER with search_path = public.
-- Data impact: existing job_matches rows are untouched; subsequent reconciliation runs
--   will produce matches for workers that previously had no location signal.
-- Rollback: re-apply migrations 067 (worker_matches_job, reconcile_worker_candidate_pools,
--   find_available_jobs_for_worker), 069 (get_current_job_match_workers), and 111
--   (reconcile_job_candidate_pool).

BEGIN;

-- ============================================================
-- 1. worker_matches_job — eligibility check used by the
--    cancellation sweep in reconcile_job_candidate_pool.
-- ============================================================
CREATE OR REPLACE FUNCTION public.worker_matches_job(
  p_job_id UUID,
  p_worker_profile_id UUID,
  p_max_radius NUMERIC DEFAULT 30000
)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.worker_profiles AS profile
    JOIN public.jobs AS job ON job.id = p_job_id
    JOIN public.job_sites AS site ON site.id = job.job_site_id
    LEFT JOIN public.worker_current_locations AS fresh_gps
      ON fresh_gps.worker_profile_id = profile.id
     AND fresh_gps.accuracy_m <= 1000
     AND fresh_gps.updated_at >= NOW() - INTERVAL '10 minutes'
    LEFT JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(fresh_gps.longitude, fresh_gps.latitude), 4326),
        site.location
      ) AS distance_m
      WHERE fresh_gps.id IS NOT NULL
        AND fresh_gps.latitude IS NOT NULL
        AND fresh_gps.longitude IS NOT NULL
        AND site.location IS NOT NULL
    ) AS gps_dist ON TRUE
    LEFT JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326),
        site.location
      ) AS distance_m
      WHERE fresh_gps.id IS NULL
        AND profile.latitude IS NOT NULL
        AND profile.longitude IS NOT NULL
        AND site.location IS NOT NULL
    ) AS prof_dist ON TRUE
    WHERE profile.id = p_worker_profile_id
      AND job.status = 'SEARCHING'
      AND site.location IS NOT NULL
      AND profile.profile_completed = TRUE
      AND profile.availability_status = 'AVAILABLE'
      AND (
        (gps_dist.distance_m IS NOT NULL AND gps_dist.distance_m <= p_max_radius)
        OR (prof_dist.distance_m IS NOT NULL AND prof_dist.distance_m <= p_max_radius)
        OR (fresh_gps.id IS NULL
            AND (profile.latitude IS NULL OR profile.longitude IS NULL)
            AND site.city IS NOT NULL AND trim(site.city) <> ''
            AND profile.city IS NOT NULL AND trim(profile.city) <> ''
            AND lower(trim(profile.city)) = lower(trim(site.city)))
      )
      AND (job.trade_id IS NULL OR trim(job.trade_id) = ''
        OR (profile.trade_id IS NOT NULL
          AND lower(trim(profile.trade_id)) = lower(trim(job.trade_id))))
      AND (job.min_experience IS NULL
        OR (profile.experience_years IS NOT NULL
          AND profile.experience_years >= job.min_experience))
      AND (job.max_daily_salary IS NULL
        OR (profile.expected_daily_wage IS NOT NULL
          AND profile.expected_daily_wage <= job.max_daily_salary))
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(job.required_skills, '{}'::TEXT[])) AS required_skill(value)
        WHERE trim(required_skill.value) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(COALESCE(profile.skills, '{}'::TEXT[])) AS worker_skill(value)
            WHERE lower(trim(worker_skill.value)) = lower(trim(required_skill.value))
          )
      )
  );
$$;

-- ============================================================
-- 2. reconcile_job_candidate_pool — main matching function.
--    Base: migration 111 (column-alias fix).
-- ============================================================
CREATE OR REPLACE FUNCTION public.reconcile_job_candidate_pool(
  p_job_id UUID,
  p_trigger TEXT DEFAULT 'JOB_CREATED'
)
RETURNS TABLE (
  run_id UUID,
  inserted_count INTEGER,
  cancelled_count INTEGER,
  pending_count INTEGER,
  status TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  selected_job public.jobs%ROWTYPE;
  matching_run_id UUID;
  inserted_rows INTEGER := 0;
  cancelled_rows INTEGER := 0;
  newly_cancelled_rows INTEGER := 0;
  pending_rows INTEGER := 0;
  accepted_rows INTEGER := 0;
BEGIN
  SELECT * INTO selected_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;

  INSERT INTO public.job_matching_runs(job_id, trigger, status)
  VALUES (p_job_id, p_trigger, 'RUNNING')
  RETURNING id INTO matching_run_id;

  IF selected_job.status = 'SEARCHING' THEN
    INSERT INTO public.job_matches AS existing_match (
      job_id, worker_profile_id, composite_score, expires_at, status
    )
    SELECT
      selected_job.id,
      profile.id,
      CASE
        WHEN gps_dist.distance_m IS NOT NULL
          THEN (1.0 - (gps_dist.distance_m / 30000.0))::numeric
        WHEN prof_dist.distance_m IS NOT NULL
          THEN (0.5 * (1.0 - (prof_dist.distance_m / 30000.0)))::numeric
        ELSE 0.3::numeric
      END,
      CASE
        WHEN gps_dist.distance_m IS NULL AND prof_dist.distance_m IS NULL
          THEN NOW() + INTERVAL '72 hours'
        ELSE NOW() + INTERVAL '24 hours'
      END,
      'PENDING'
    FROM public.worker_profiles AS profile
    JOIN public.job_sites AS site ON site.id = selected_job.job_site_id
    LEFT JOIN public.worker_current_locations AS fresh_gps
      ON fresh_gps.worker_profile_id = profile.id
     AND fresh_gps.accuracy_m <= 1000
     AND fresh_gps.updated_at >= NOW() - INTERVAL '10 minutes'
    LEFT JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(fresh_gps.longitude, fresh_gps.latitude), 4326),
        site.location
      ) AS distance_m
      WHERE fresh_gps.id IS NOT NULL
        AND fresh_gps.latitude IS NOT NULL
        AND fresh_gps.longitude IS NOT NULL
        AND site.location IS NOT NULL
    ) AS gps_dist ON TRUE
    LEFT JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326),
        site.location
      ) AS distance_m
      WHERE fresh_gps.id IS NULL
        AND profile.latitude IS NOT NULL
        AND profile.longitude IS NOT NULL
        AND site.location IS NOT NULL
    ) AS prof_dist ON TRUE
    WHERE site.location IS NOT NULL
      AND profile.profile_completed = TRUE
      AND profile.availability_status = 'AVAILABLE'
      AND (
        (gps_dist.distance_m IS NOT NULL AND gps_dist.distance_m <= 30000)
        OR (prof_dist.distance_m IS NOT NULL AND prof_dist.distance_m <= 30000)
        OR (fresh_gps.id IS NULL
            AND (profile.latitude IS NULL OR profile.longitude IS NULL)
            AND site.city IS NOT NULL AND trim(site.city) <> ''
            AND profile.city IS NOT NULL AND trim(profile.city) <> ''
            AND lower(trim(profile.city)) = lower(trim(site.city)))
      )
      AND (selected_job.trade_id IS NULL OR trim(selected_job.trade_id) = ''
        OR (profile.trade_id IS NOT NULL
          AND lower(trim(profile.trade_id)) = lower(trim(selected_job.trade_id))))
      AND (selected_job.min_experience IS NULL
        OR (profile.experience_years IS NOT NULL
          AND profile.experience_years >= selected_job.min_experience))
      AND (selected_job.max_daily_salary IS NULL
        OR (profile.expected_daily_wage IS NOT NULL
          AND profile.expected_daily_wage <= selected_job.max_daily_salary))
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(selected_job.required_skills, '{}'::TEXT[])) AS required_skill(value)
        WHERE trim(required_skill.value) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(COALESCE(profile.skills, '{}'::TEXT[])) AS worker_skill(value)
            WHERE lower(trim(worker_skill.value)) = lower(trim(required_skill.value))
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.job_matches AS prior_match
        WHERE prior_match.job_id = selected_job.id
          AND prior_match.worker_profile_id = profile.id
          AND prior_match.status NOT IN ('CANCELLED', 'PENDING')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.job_matches AS active_match
        WHERE active_match.job_id = selected_job.id
          AND active_match.worker_profile_id = profile.id
          AND active_match.status = 'PENDING'
          AND active_match.expires_at > NOW()
      )
    ORDER BY
      CASE
        WHEN gps_dist.distance_m IS NOT NULL THEN 1
        WHEN prof_dist.distance_m IS NOT NULL THEN 2
        ELSE 3
      END ASC,
      COALESCE(gps_dist.distance_m, prof_dist.distance_m, 30000) ASC
    LIMIT (SELECT headcount_required * 3 FROM public.jobs WHERE id = selected_job.id)
    ON CONFLICT (job_id, worker_profile_id) DO UPDATE
      SET composite_score = EXCLUDED.composite_score,
          expires_at = EXCLUDED.expires_at,
          created_at = NOW(),
          status = 'PENDING'
      WHERE existing_match.status = 'CANCELLED'
         OR (existing_match.status = 'PENDING' AND existing_match.expires_at <= NOW());

    GET DIAGNOSTICS inserted_rows = ROW_COUNT;

    UPDATE public.job_matches AS pending_match
    SET status = 'CANCELLED'
    WHERE pending_match.job_id = selected_job.id
      AND pending_match.status = 'PENDING'
      AND pending_match.expires_at > NOW()
      AND NOT public.worker_matches_job(selected_job.id, pending_match.worker_profile_id);

    GET DIAGNOSTICS cancelled_rows = ROW_COUNT;
  END IF;

  SELECT COUNT(*)::INTEGER INTO accepted_rows
  FROM public.job_matches AS accepted_match
  WHERE accepted_match.job_id = selected_job.id
    AND accepted_match.status = 'ACCEPTED';

  IF selected_job.status = 'FILLED' OR accepted_rows >= selected_job.headcount_required THEN
    UPDATE public.job_matches AS fill_cancel
    SET status = 'CANCELLED'
    WHERE fill_cancel.job_id = selected_job.id
      AND fill_cancel.status = 'PENDING';
    GET DIAGNOSTICS newly_cancelled_rows = ROW_COUNT;
    cancelled_rows := cancelled_rows + newly_cancelled_rows;
  END IF;

  SELECT COUNT(*)::INTEGER INTO pending_rows
  FROM public.job_matches AS pending_count
  WHERE pending_count.job_id = selected_job.id
    AND pending_count.status = 'PENDING'
    AND pending_count.expires_at > NOW()
    AND selected_job.status = 'SEARCHING'
    AND accepted_rows < selected_job.headcount_required;

  UPDATE public.job_matching_runs
  SET status = 'SUCCEEDED',
      candidate_count = pending_rows,
      finished_at = NOW()
  WHERE id = matching_run_id;

  RETURN QUERY SELECT matching_run_id, inserted_rows, cancelled_rows, pending_rows, 'SUCCEEDED'::TEXT;
EXCEPTION WHEN OTHERS THEN
  IF matching_run_id IS NOT NULL THEN
    UPDATE public.job_matching_runs
    SET status = 'FAILED', error_code = SQLSTATE, error_message = SQLERRM, finished_at = NOW()
    WHERE id = matching_run_id;
  END IF;
  RAISE;
END;
$$;

-- ============================================================
-- 3. get_current_job_match_workers — employer dashboard view.
--    distance_m is now nullable (NULL for city-only matches).
--    Frontend already handles null with conditional rendering.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_current_job_match_workers(
  p_employer_id uuid,
  p_job_id uuid DEFAULT NULL
)
RETURNS TABLE (
  job_id uuid, worker_profile_id uuid, name text, trade_id text, skills text[],
  experience_years integer, expected_daily_wage numeric, availability_status worker_availability,
  distance_m numeric, composite_score numeric, status text, created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT job.id, profile.id, worker.name, profile.trade_id, profile.skills,
    profile.experience_years, profile.expected_daily_wage, profile.availability_status,
    eff_distance.distance_m, job_match.composite_score, job_match.status, job_match.created_at
  FROM public.jobs AS job
  JOIN public.job_sites AS site ON site.id = job.job_site_id
  JOIN public.job_matches AS job_match ON job_match.job_id = job.id
  JOIN public.worker_profiles AS profile ON profile.id = job_match.worker_profile_id
  LEFT JOIN public.users AS worker ON worker.id = profile.user_id
  LEFT JOIN public.worker_current_locations AS current_location
    ON current_location.worker_profile_id = profile.id
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN job_match.status = 'ACCEPTED'
          THEN profile.latitude
        WHEN current_location.id IS NOT NULL
          AND current_location.accuracy_m <= 1000
          AND current_location.updated_at >= NOW() - INTERVAL '10 minutes'
          THEN current_location.latitude
        WHEN profile.latitude IS NOT NULL
          THEN profile.latitude
        ELSE NULL
      END AS latitude,
      CASE
        WHEN job_match.status = 'ACCEPTED'
          THEN profile.longitude
        WHEN current_location.id IS NOT NULL
          AND current_location.accuracy_m <= 1000
          AND current_location.updated_at >= NOW() - INTERVAL '10 minutes'
          THEN current_location.longitude
        WHEN profile.longitude IS NOT NULL
          THEN profile.longitude
        ELSE NULL
      END AS longitude
  ) AS effective_location
  LEFT JOIN LATERAL (
    SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(effective_location.longitude, effective_location.latitude), 4326),
      site.location
    ) AS distance_m
    WHERE effective_location.latitude IS NOT NULL
      AND effective_location.longitude IS NOT NULL
      AND site.location IS NOT NULL
  ) AS eff_distance ON TRUE
  WHERE job.employer_id = p_employer_id
    AND (p_job_id IS NULL OR job.id = p_job_id)
    AND site.location IS NOT NULL
    AND (
      job_match.status = 'ACCEPTED'
      OR (
        job.status = 'SEARCHING'
        AND job_match.status = 'PENDING'
        AND job_match.expires_at > NOW()
        AND profile.profile_completed = TRUE
        AND profile.availability_status = 'AVAILABLE'
        AND public.worker_matches_job(job.id, profile.id)
        AND (
          SELECT COUNT(*) FROM public.job_matches AS accepted_match
          WHERE accepted_match.job_id = job.id AND accepted_match.status = 'ACCEPTED'
        ) < job.headcount_required
      )
    )
  ORDER BY job_match.composite_score DESC;
$$;

-- ============================================================
-- 4. reconcile_worker_candidate_pools — re-match a worker
--    when their profile changes.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reconcile_worker_candidate_pools(
  p_worker_profile_id UUID,
  p_trigger TEXT DEFAULT 'WORKER_PROFILE_UPDATED'
)
RETURNS TABLE (job_count INTEGER, failed_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  affected_job UUID;
  reconciled_count INTEGER := 0;
  failed_count_value INTEGER := 0;
BEGIN
  FOR affected_job IN
    SELECT DISTINCT candidate_jobs.id
    FROM public.jobs AS candidate_jobs
    JOIN public.job_sites AS candidate_sites
      ON candidate_sites.id = candidate_jobs.job_site_id
    LEFT JOIN public.job_matches AS existing_match
      ON existing_match.job_id = candidate_jobs.id
     AND existing_match.worker_profile_id = p_worker_profile_id
     AND existing_match.status = 'PENDING'
    JOIN public.worker_profiles AS worker ON worker.id = p_worker_profile_id
    LEFT JOIN public.worker_current_locations AS fresh_gps
      ON fresh_gps.worker_profile_id = worker.id
     AND fresh_gps.accuracy_m <= 1000
     AND fresh_gps.updated_at >= NOW() - INTERVAL '10 minutes'
    LEFT JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(fresh_gps.longitude, fresh_gps.latitude), 4326),
        candidate_sites.location
      ) AS distance_m
      WHERE fresh_gps.id IS NOT NULL
        AND fresh_gps.latitude IS NOT NULL
        AND fresh_gps.longitude IS NOT NULL
        AND candidate_sites.location IS NOT NULL
    ) AS gps_dist ON TRUE
    LEFT JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(worker.longitude, worker.latitude), 4326),
        candidate_sites.location
      ) AS distance_m
      WHERE fresh_gps.id IS NULL
        AND worker.latitude IS NOT NULL
        AND worker.longitude IS NOT NULL
        AND candidate_sites.location IS NOT NULL
    ) AS prof_dist ON TRUE
    WHERE candidate_jobs.status = 'SEARCHING'
      AND (
        existing_match.id IS NOT NULL
        OR (
          candidate_sites.location IS NOT NULL
          AND (
            (gps_dist.distance_m IS NOT NULL AND gps_dist.distance_m <= 30000)
            OR (prof_dist.distance_m IS NOT NULL AND prof_dist.distance_m <= 30000)
            OR (fresh_gps.id IS NULL
                AND (worker.latitude IS NULL OR worker.longitude IS NULL)
                AND candidate_sites.city IS NOT NULL AND trim(candidate_sites.city) <> ''
                AND worker.city IS NOT NULL AND trim(worker.city) <> ''
                AND lower(trim(worker.city)) = lower(trim(candidate_sites.city)))
          )
          AND (candidate_jobs.trade_id IS NULL OR trim(candidate_jobs.trade_id) = ''
            OR (worker.trade_id IS NOT NULL
              AND lower(trim(worker.trade_id)) = lower(trim(candidate_jobs.trade_id))))
          AND (candidate_jobs.min_experience IS NULL
            OR (worker.experience_years IS NOT NULL
              AND worker.experience_years >= candidate_jobs.min_experience))
          AND (candidate_jobs.max_daily_salary IS NULL
            OR (worker.expected_daily_wage IS NOT NULL
              AND worker.expected_daily_wage <= candidate_jobs.max_daily_salary))
        )
      )
  LOOP
    BEGIN
      PERFORM public.reconcile_job_candidate_pool(affected_job, p_trigger);
      reconciled_count := reconciled_count + 1;
    EXCEPTION WHEN OTHERS THEN
      failed_count_value := failed_count_value + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT reconciled_count, failed_count_value;
END;
$$;

-- ============================================================
-- 5. find_available_jobs_for_worker — worker-side job discovery.
--    DROP required because the return type differs from the
--    version currently in production (42P13 on CREATE OR REPLACE).
-- ============================================================
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
  SELECT job.id, job.title, job.max_daily_salary, job.headcount_required,
    job.min_experience, employer.contact_person_name,
    COALESCE(gps_dist.distance_m, prof_dist.distance_m),
    ROUND((COALESCE(gps_dist.distance_m, prof_dist.distance_m) / 1000.0)::numeric, 1)
  FROM public.worker_profiles AS profile
  JOIN public.job_matches AS worker_match
    ON worker_match.worker_profile_id = profile.id
  JOIN public.jobs AS job ON job.id = worker_match.job_id
  JOIN public.job_sites AS site ON site.id = job.job_site_id
  JOIN public.employer_profiles AS employer ON employer.id = job.employer_id
  LEFT JOIN public.worker_current_locations AS fresh_gps
    ON fresh_gps.worker_profile_id = profile.id
   AND fresh_gps.accuracy_m <= 1000
   AND fresh_gps.updated_at >= NOW() - INTERVAL '10 minutes'
  LEFT JOIN LATERAL (
    SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(fresh_gps.longitude, fresh_gps.latitude), 4326),
      site.location
    ) AS distance_m
    WHERE fresh_gps.id IS NOT NULL
      AND fresh_gps.latitude IS NOT NULL
      AND fresh_gps.longitude IS NOT NULL
      AND site.location IS NOT NULL
  ) AS gps_dist ON TRUE
  LEFT JOIN LATERAL (
    SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326),
      site.location
    ) AS distance_m
    WHERE fresh_gps.id IS NULL
      AND profile.latitude IS NOT NULL
      AND profile.longitude IS NOT NULL
      AND site.location IS NOT NULL
  ) AS prof_dist ON TRUE
  WHERE profile.id = p_worker_id
    AND profile.profile_completed = TRUE
    AND profile.availability_status = 'AVAILABLE'
    AND job.status = 'SEARCHING'
    AND worker_match.status = 'PENDING'
    AND worker_match.expires_at > NOW()
    AND site.location IS NOT NULL
    AND (
      (gps_dist.distance_m IS NOT NULL AND gps_dist.distance_m <= p_max_radius)
      OR (prof_dist.distance_m IS NOT NULL AND prof_dist.distance_m <= p_max_radius)
      OR (fresh_gps.id IS NULL
          AND (profile.latitude IS NULL OR profile.longitude IS NULL)
          AND site.city IS NOT NULL AND trim(site.city) <> ''
          AND profile.city IS NOT NULL AND trim(profile.city) <> ''
          AND lower(trim(profile.city)) = lower(trim(site.city)))
    )
    AND (job.trade_id IS NULL OR trim(job.trade_id) = ''
      OR (profile.trade_id IS NOT NULL
        AND lower(trim(profile.trade_id)) = lower(trim(job.trade_id))))
    AND (job.min_experience IS NULL
      OR (profile.experience_years IS NOT NULL
        AND profile.experience_years >= job.min_experience))
    AND (job.max_daily_salary IS NULL
      OR (profile.expected_daily_wage IS NOT NULL
        AND profile.expected_daily_wage <= job.max_daily_salary))
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(job.required_skills, '{}'::TEXT[])) AS required_skill(value)
      WHERE trim(required_skill.value) <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(COALESCE(profile.skills, '{}'::TEXT[])) AS worker_skill(value)
          WHERE lower(trim(worker_skill.value)) = lower(trim(required_skill.value))
        )
    )
    AND (
      SELECT COUNT(*)
      FROM public.job_matches AS accepted_match
      WHERE accepted_match.job_id = job.id
        AND accepted_match.status = 'ACCEPTED'
    ) < job.headcount_required
  ORDER BY COALESCE(gps_dist.distance_m, prof_dist.distance_m, 30000) ASC;
$$;

COMMIT;
