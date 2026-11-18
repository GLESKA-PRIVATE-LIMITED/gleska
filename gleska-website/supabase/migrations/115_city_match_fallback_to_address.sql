-- 115_city_match_fallback_to_address.sql
--
-- Problem: migration 114's tier-3 city match checks site.city = profile.city, but job
-- sites created before this fix have city = NULL (the geocoder doesn't always return a
-- city component). Those sites have the city name in site.address instead (e.g.
-- "Hyderabad, Telangana, India"), so the tier-3 match was never reached.
--
-- Fix: when site.city IS NULL, fall back to checking whether site.address contains the
-- worker's city as a substring (case-insensitive ILIKE). This handles all existing sites
-- that have an address but no city column.
--
-- Functions updated (3 of the 5 from migration 114 — the other 2 don't perform the
-- initial eligibility check):
--   worker_matches_job
--   reconcile_job_candidate_pool
--   reconcile_worker_candidate_pools
--
-- RLS impact: none.
-- Data impact: none on existing rows; new reconciliation runs will now match workers
--   against sites where city was not populated but the address contains the city name.
-- Rollback: re-apply migration 114's versions of these three functions.

BEGIN;

-- ============================================================
-- Helper macro: city matches site when
--   (a) site.city is set and equals profile.city exactly, OR
--   (b) site.city is NULL and site.address contains profile.city
-- Used as a final OR branch in all three eligibility checks.
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
        OR (
          fresh_gps.id IS NULL
          AND (profile.latitude IS NULL OR profile.longitude IS NULL)
          AND profile.city IS NOT NULL AND trim(profile.city) <> ''
          AND (
            (site.city IS NOT NULL AND trim(site.city) <> ''
             AND lower(trim(profile.city)) = lower(trim(site.city)))
            OR
            (site.address IS NOT NULL
             AND lower(site.address) LIKE '%' || lower(trim(profile.city)) || '%')
          )
        )
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
        OR (
          fresh_gps.id IS NULL
          AND (profile.latitude IS NULL OR profile.longitude IS NULL)
          AND profile.city IS NOT NULL AND trim(profile.city) <> ''
          AND (
            (site.city IS NOT NULL AND trim(site.city) <> ''
             AND lower(trim(profile.city)) = lower(trim(site.city)))
            OR
            (site.address IS NOT NULL
             AND lower(site.address) LIKE '%' || lower(trim(profile.city)) || '%')
          )
        )
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
            OR (
              fresh_gps.id IS NULL
              AND (worker.latitude IS NULL OR worker.longitude IS NULL)
              AND worker.city IS NOT NULL AND trim(worker.city) <> ''
              AND (
                (candidate_sites.city IS NOT NULL AND trim(candidate_sites.city) <> ''
                 AND lower(trim(worker.city)) = lower(trim(candidate_sites.city)))
                OR
                (candidate_sites.address IS NOT NULL
                 AND lower(candidate_sites.address) LIKE '%' || lower(trim(worker.city)) || '%')
              )
            )
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

COMMIT;
