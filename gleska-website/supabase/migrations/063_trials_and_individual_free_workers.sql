BEGIN;

ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

ALTER TABLE public.employer_profiles
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_eligible BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.individual_free_worker_claims (
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  worker_profile_id UUID NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employer_id, worker_profile_id)
);

ALTER TABLE public.individual_free_worker_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages Individual free worker claims"
  ON public.individual_free_worker_claims;
CREATE POLICY "Service role manages Individual free worker claims"
  ON public.individual_free_worker_claims FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.individual_free_worker_claims TO service_role;

CREATE OR REPLACE FUNCTION public.create_job_for_employer(
  p_employer_id UUID,
  p_job_site_id UUID,
  p_title TEXT,
  p_headcount_required INTEGER,
  p_max_daily_salary NUMERIC DEFAULT NULL,
  p_min_experience NUMERIC DEFAULT NULL,
  p_trade_id TEXT DEFAULT NULL,
  p_required_skills TEXT[] DEFAULT '{}'::TEXT[],
  p_work_duration_days INTEGER DEFAULT NULL,
  p_work_timing TEXT DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  employer public.employer_profiles%ROWTYPE;
  created_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO employer
  FROM public.employer_profiles
  WHERE id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND OR employer.onboarding_status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'EMPLOYER_ONBOARDING_INCOMPLETE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.job_sites
    WHERE id = p_job_site_id AND employer_id = p_employer_id
  ) THEN
    RAISE EXCEPTION 'JOB_SITE_NOT_FOUND';
  END IF;

  IF employer.employer_type IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS')
    AND COALESCE(employer.subscription_valid_until > NOW(), FALSE) = FALSE
    AND COALESCE(employer.trial_ends_at > NOW(), FALSE) = FALSE THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED';
  END IF;

  INSERT INTO public.jobs (
    employer_id, job_site_id, title, headcount_required, max_daily_salary,
    min_experience, trade_id, required_skills, work_duration_days, work_timing, status
  )
  VALUES (
    p_employer_id, p_job_site_id, p_title, p_headcount_required, p_max_daily_salary,
    p_min_experience, p_trade_id, COALESCE(p_required_skills, '{}'::TEXT[]),
    p_work_duration_days, p_work_timing, 'SEARCHING'
  )
  RETURNING * INTO created_job;

  RETURN created_job;
END;
$$;

REVOKE ALL ON FUNCTION public.create_job_for_employer(
  UUID, UUID, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT, TEXT[], INTEGER, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_for_employer(
  UUID, UUID, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT, TEXT[], INTEGER, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.individual_worker_payment_required(
  p_employer_id UUID,
  p_worker_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  selected_employer public.employer_profiles%ROWTYPE;
  used_workers INTEGER;
BEGIN
  SELECT * INTO selected_employer
  FROM public.employer_profiles
  WHERE id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND OR selected_employer.employer_type <> 'INDIVIDUAL' THEN
    RAISE EXCEPTION 'INDIVIDUAL_EMPLOYER_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.individual_free_worker_claims
    WHERE employer_id = p_employer_id AND worker_profile_id = p_worker_profile_id
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*)::INTEGER INTO used_workers
  FROM public.individual_free_worker_claims
  WHERE employer_id = p_employer_id;

  RETURN used_workers >= 3;
END;
$$;

REVOKE ALL ON FUNCTION public.individual_worker_payment_required(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.individual_worker_payment_required(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_job_match(
  p_employer_id UUID,
  p_job_id UUID,
  p_worker_profile_id UUID
)
RETURNS TABLE (
  match_id UUID,
  worker_profile_id UUID,
  match_status TEXT,
  job_status TEXT,
  accepted_count INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  selected_employer public.employer_profiles%ROWTYPE;
  selected_job public.jobs%ROWTYPE;
  selected_match public.job_matches%ROWTYPE;
  accepted_workers INTEGER;
  free_workers_used INTEGER;
  resulting_job_status TEXT;
  has_paid_commission BOOLEAN;
BEGIN
  SELECT * INTO selected_employer
  FROM public.employer_profiles
  WHERE id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;

  SELECT * INTO selected_job
  FROM public.jobs
  WHERE id = p_job_id AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF selected_job.status <> 'SEARCHING' THEN RAISE EXCEPTION 'JOB_NOT_OPEN_FOR_HIRING'; END IF;

  SELECT * INTO selected_match
  FROM public.job_matches
  WHERE job_id = p_job_id AND worker_profile_id = p_worker_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
  IF selected_match.status <> 'PENDING' THEN RAISE EXCEPTION 'MATCH_NOT_PENDING'; END IF;
  IF selected_match.expires_at <= NOW() THEN RAISE EXCEPTION 'MATCH_EXPIRED'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_current_job_match_workers(p_employer_id, p_job_id) current_match
    WHERE current_match.worker_profile_id = p_worker_profile_id
      AND current_match.status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'WORKER_NOT_ELIGIBLE';
  END IF;

  IF selected_employer.employer_type IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS') THEN
    IF COALESCE(selected_employer.subscription_valid_until > NOW(), FALSE) = FALSE
      AND COALESCE(selected_employer.trial_ends_at > NOW(), FALSE) = FALSE THEN
      RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED';
    END IF;
  END IF;

  SELECT COUNT(*)::INTEGER INTO accepted_workers
  FROM public.job_matches
  WHERE job_id = p_job_id AND status = 'ACCEPTED';
  IF accepted_workers >= selected_job.headcount_required THEN RAISE EXCEPTION 'HEADCOUNT_FILLED'; END IF;

  IF selected_employer.employer_type = 'INDIVIDUAL'
    AND NOT EXISTS (
      SELECT 1 FROM public.individual_free_worker_claims
      WHERE employer_id = p_employer_id AND worker_profile_id = p_worker_profile_id
    ) THEN
    SELECT COUNT(*)::INTEGER INTO free_workers_used
    FROM public.individual_free_worker_claims
    WHERE employer_id = p_employer_id;

    IF free_workers_used < 3 THEN
      INSERT INTO public.individual_free_worker_claims (employer_id, worker_profile_id)
      VALUES (p_employer_id, p_worker_profile_id);
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.payment_transactions pt
        WHERE pt.employer_id = p_employer_id
          AND pt.job_id = p_job_id
          AND pt.worker_profile_id IS NULL
          AND pt.payment_category = 'INDIVIDUAL_COMMISSION'
          AND pt.amount = 30.00
          AND pt.status = 'SUCCESS'
          AND pt.raw_webhook_payload->>'worker_profile_id' = p_worker_profile_id::text
      ) INTO has_paid_commission;
      IF NOT has_paid_commission THEN RAISE EXCEPTION 'COMMISSION_REQUIRED'; END IF;
    END IF;
  ELSIF selected_employer.employer_type = 'INDIVIDUAL' THEN
    NULL;
  END IF;

  UPDATE public.job_matches
  SET status = 'ACCEPTED'
  WHERE id = selected_match.id;

  accepted_workers := accepted_workers + 1;
  resulting_job_status := CASE
    WHEN accepted_workers >= selected_job.headcount_required THEN 'FILLED'
    ELSE 'SEARCHING'
  END;
  IF resulting_job_status = 'FILLED' THEN
    UPDATE public.jobs SET status = resulting_job_status WHERE id = p_job_id;
  END IF;

  RETURN QUERY SELECT selected_match.id, p_worker_profile_id, 'ACCEPTED', resulting_job_status, accepted_workers;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_job_match(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_job_match(UUID, UUID, UUID) TO service_role;

COMMIT;