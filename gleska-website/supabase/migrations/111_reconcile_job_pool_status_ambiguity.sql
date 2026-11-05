-- 111_reconcile_job_pool_status_ambiguity.sql
--
-- Bug: after migration 110 fixed the ON CONFLICT (42P10), job creation's matching call
--   reconcile_job_candidate_pool (migration 069) failed at the NEXT statement with
--   SQLSTATE 42702 "column reference \"status\" is ambiguous", so matching still returned
--   MATCHING_FAILED and candidate pools stayed empty (reproduced from Render logs 2026-11-05).
--
-- Why: the function is declared RETURNS TABLE (..., status TEXT). In PL/pgSQL every
-- RETURNS TABLE column is also an implicit variable, so the name `status` exists as a
-- variable inside the body. Three statements referenced the job_matches column `status`
-- WITHOUT a table qualifier, so each bare `status` was ambiguous between that column and
-- the implicit output variable -> 42702. (These statements run only after the INSERT,
-- which is why the 42P10 masked them until migration 110.)
--
-- Fix: qualify those three `status` (and their sibling columns) with a table alias so they
-- unambiguously mean the job_matches column. Pure CREATE OR REPLACE of the function body;
-- the matching logic is byte-for-byte identical to migration 069 except for the aliases.
-- The companion function get_current_job_match_workers (069) already qualifies every column
-- via its job_match alias, so it is left untouched.
--
-- RLS impact: none (SECURITY DEFINER function, search_path pinned to public, as before).
-- Data impact: none — behaviour is unchanged; only name resolution is disambiguated.
-- Rollback: re-apply migration 069's definition of reconcile_job_candidate_pool.

BEGIN;

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
      (1.0 - (distance.distance_m / 30000.0))::numeric,
      NOW() + INTERVAL '24 hours',
      'PENDING'
    FROM public.worker_profiles AS profile
    JOIN public.job_sites AS site ON site.id = selected_job.job_site_id
    JOIN public.worker_current_locations AS current_location
      ON current_location.worker_profile_id = profile.id
     AND current_location.accuracy_m <= 1000
     AND current_location.updated_at >= NOW() - INTERVAL '10 minutes'
    CROSS JOIN LATERAL (
      SELECT current_location.latitude AS latitude,
        current_location.longitude AS longitude
    ) AS effective_location
    CROSS JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(effective_location.longitude, effective_location.latitude), 4326),
        site.location
      ) AS distance_m
    ) AS distance
    WHERE site.location IS NOT NULL
      AND profile.profile_completed = TRUE
      AND profile.availability_status = 'AVAILABLE'
      AND effective_location.latitude IS NOT NULL
      AND effective_location.longitude IS NOT NULL
      AND distance.distance_m <= 30000
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
    ORDER BY distance.distance_m ASC
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

COMMIT;
