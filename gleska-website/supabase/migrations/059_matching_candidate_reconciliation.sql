BEGIN;

-- Older production schemas may not have received migration 032 yet, while
-- the reconciliation functions require the canonical worker skill array.
ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS skills TEXT[];

CREATE TABLE IF NOT EXISTS public.job_matching_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  worker_profile_id UUID REFERENCES public.worker_profiles(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  candidate_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_job_matching_runs_job_started
  ON public.job_matching_runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_matching_runs_worker_started
  ON public.job_matching_runs(worker_profile_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.worker_matches_job(
  p_job_id UUID,
  p_worker_profile_id UUID,
  p_max_radius NUMERIC DEFAULT 30000
)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH effective_location AS (
    SELECT
      profile.id,
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
    FROM public.worker_profiles AS profile
    LEFT JOIN public.worker_current_locations AS current_location
      ON current_location.worker_profile_id = profile.id
    WHERE profile.id = p_worker_profile_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs AS job
    JOIN public.job_sites AS site ON site.id = job.job_site_id
    JOIN effective_location AS profile ON TRUE
    CROSS JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326),
        site.location
      ) AS distance_m
    ) AS distance
    WHERE job.id = p_job_id
      AND job.status = 'SEARCHING'
      AND site.location IS NOT NULL
      AND profile.profile_completed = TRUE
      AND profile.availability_status = 'AVAILABLE'
      AND profile.latitude IS NOT NULL
      AND profile.longitude IS NOT NULL
      AND distance.distance_m <= p_max_radius
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
    INSERT INTO public.job_matches (
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
    LEFT JOIN public.worker_current_locations AS current_location
      ON current_location.worker_profile_id = profile.id
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN current_location.id IS NOT NULL
          AND current_location.accuracy_m <= 1000
          AND current_location.updated_at >= NOW() - INTERVAL '10 minutes'
          THEN current_location.latitude ELSE profile.latitude END AS latitude,
        CASE WHEN current_location.id IS NOT NULL
          AND current_location.accuracy_m <= 1000
          AND current_location.updated_at >= NOW() - INTERVAL '10 minutes'
          THEN current_location.longitude ELSE profile.longitude END AS longitude
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
        FROM public.job_matches AS existing_match
        WHERE existing_match.job_id = selected_job.id
          AND existing_match.worker_profile_id = profile.id
      )
    ORDER BY distance.distance_m ASC
    LIMIT (SELECT headcount_required * 3 FROM public.jobs WHERE id = selected_job.id);

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
  FROM public.job_matches
  WHERE job_id = selected_job.id
    AND status = 'ACCEPTED';

  IF selected_job.status = 'FILLED' OR accepted_rows >= selected_job.headcount_required THEN
    UPDATE public.job_matches
    SET status = 'CANCELLED'
    WHERE job_id = selected_job.id
      AND status = 'PENDING';
    GET DIAGNOSTICS newly_cancelled_rows = ROW_COUNT;
    cancelled_rows := cancelled_rows + newly_cancelled_rows;
  END IF;

  SELECT COUNT(*)::INTEGER INTO pending_rows
  FROM public.job_matches
  WHERE job_id = selected_job.id
    AND status = 'PENDING'
    AND expires_at > NOW()
    AND (selected_job.status = 'SEARCHING')
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
    JOIN public.job_sites AS candidate_sites ON candidate_sites.id = candidate_jobs.job_site_id
    LEFT JOIN public.job_matches AS existing_match
      ON existing_match.job_id = candidate_jobs.id
     AND existing_match.worker_profile_id = p_worker_profile_id
     AND existing_match.status = 'PENDING'
    JOIN public.worker_profiles AS worker ON worker.id = p_worker_profile_id
    LEFT JOIN public.worker_current_locations AS current_location
      ON current_location.worker_profile_id = worker.id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN current_location.id IS NOT NULL
        AND current_location.accuracy_m <= 1000
        AND current_location.updated_at >= NOW() - INTERVAL '10 minutes'
        THEN current_location.latitude ELSE worker.latitude END AS latitude,
        CASE WHEN current_location.id IS NOT NULL
        AND current_location.accuracy_m <= 1000
        AND current_location.updated_at >= NOW() - INTERVAL '10 minutes'
        THEN current_location.longitude ELSE worker.longitude END AS longitude
    ) AS effective_location
    CROSS JOIN LATERAL (
      SELECT ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(effective_location.longitude, effective_location.latitude), 4326),
        candidate_sites.location
      ) AS distance_m
    ) AS distance
    WHERE candidate_jobs.status = 'SEARCHING'
      AND (existing_match.id IS NOT NULL OR (
        candidate_sites.location IS NOT NULL
        AND effective_location.latitude IS NOT NULL
        AND effective_location.longitude IS NOT NULL
        AND distance.distance_m <= 30000
        AND (candidate_jobs.trade_id IS NULL OR trim(candidate_jobs.trade_id) = ''
          OR (worker.trade_id IS NOT NULL
            AND lower(trim(worker.trade_id)) = lower(trim(candidate_jobs.trade_id))))
        AND (candidate_jobs.min_experience IS NULL
          OR (worker.experience_years IS NOT NULL
            AND worker.experience_years >= candidate_jobs.min_experience))
        AND (candidate_jobs.max_daily_salary IS NULL
          OR (worker.expected_daily_wage IS NOT NULL
            AND worker.expected_daily_wage <= candidate_jobs.max_daily_salary))
      ))
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

-- Keep active employer candidate projections aligned with the worker-side contract.
-- Accepted matches remain readable, but pending candidates require all active predicates.
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
    distance.distance_m, job_match.composite_score, job_match.status, job_match.created_at
  FROM public.jobs AS job
  JOIN public.job_sites AS site ON site.id = job.job_site_id
  JOIN public.job_matches AS job_match ON job_match.job_id = job.id
  JOIN public.worker_profiles AS profile ON profile.id = job_match.worker_profile_id
  LEFT JOIN public.users AS worker ON worker.id = profile.user_id
  CROSS JOIN LATERAL (
    SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326), site.location
    ) AS distance_m
  ) AS distance
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
        AND profile.latitude IS NOT NULL AND profile.longitude IS NOT NULL
        AND distance.distance_m <= 30000
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
              SELECT 1 FROM unnest(COALESCE(profile.skills, '{}'::TEXT[])) AS worker_skill(value)
              WHERE lower(trim(worker_skill.value)) = lower(trim(required_skill.value))
            )
        )
        AND (
          SELECT COUNT(*) FROM public.job_matches AS accepted_match
          WHERE accepted_match.job_id = job.id AND accepted_match.status = 'ACCEPTED'
        ) < job.headcount_required
      )
    )
  ORDER BY job_match.composite_score DESC;
$$;

DROP FUNCTION IF EXISTS public.find_available_jobs_for_worker(UUID, INTEGER);

CREATE FUNCTION public.find_available_jobs_for_worker(
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
    FROM public.worker_profiles AS profile
    LEFT JOIN public.worker_current_locations AS current_location
      ON current_location.worker_profile_id = profile.id
    WHERE profile.id = p_worker_id
  )
  SELECT job.id, job.title, job.max_daily_salary, job.headcount_required,
    job.min_experience, employer.contact_person_name, distance.distance_m,
    ROUND((distance.distance_m / 1000.0)::numeric, 1)
  FROM effective_locations AS profile
  JOIN public.job_sites AS site ON site.location IS NOT NULL
  JOIN public.jobs AS job ON job.job_site_id = site.id
  JOIN public.job_matches AS worker_match
    ON worker_match.job_id = job.id
   AND worker_match.worker_profile_id = profile.id
  JOIN public.employer_profiles AS employer ON employer.id = job.employer_id
  CROSS JOIN LATERAL (
    SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(profile.longitude, profile.latitude), 4326),
      site.location
    ) AS distance_m
  ) AS distance
  WHERE profile.profile_completed = TRUE
    AND profile.availability_status = 'AVAILABLE'
    AND profile.latitude IS NOT NULL
    AND profile.longitude IS NOT NULL
    AND job.status = 'SEARCHING'
    AND worker_match.status = 'PENDING'
    AND worker_match.expires_at > NOW()
    AND distance.distance_m <= p_max_radius
    AND (job.trade_id IS NULL OR trim(job.trade_id) = ''
      OR EXISTS (
        SELECT 1
        FROM public.worker_profiles AS matching_profile
        WHERE matching_profile.id = profile.id
          AND matching_profile.trade_id IS NOT NULL
          AND lower(trim(matching_profile.trade_id)) = lower(trim(job.trade_id))
      ))
    AND (job.min_experience IS NULL
      OR profile.id IN (
        SELECT experienced_profile.id
        FROM public.worker_profiles AS experienced_profile
        WHERE experienced_profile.id = profile.id
          AND experienced_profile.experience_years IS NOT NULL
          AND experienced_profile.experience_years >= job.min_experience
      ))
    AND (job.max_daily_salary IS NULL
      OR profile.id IN (
        SELECT waged_profile.id
        FROM public.worker_profiles AS waged_profile
        WHERE waged_profile.id = profile.id
          AND waged_profile.expected_daily_wage IS NOT NULL
          AND waged_profile.expected_daily_wage <= job.max_daily_salary
      ))
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
  ORDER BY distance.distance_m ASC;
$$;

REVOKE ALL ON FUNCTION public.worker_matches_job(UUID, UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_job_candidate_pool(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_worker_candidate_pools(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_available_jobs_for_worker(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_matches_job(UUID, UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_job_candidate_pool(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_worker_candidate_pools(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_available_jobs_for_worker(UUID, INTEGER) TO service_role;

COMMIT;
