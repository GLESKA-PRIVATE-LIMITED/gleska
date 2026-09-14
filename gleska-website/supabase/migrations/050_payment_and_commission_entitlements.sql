BEGIN;

-- 1. Safely add job_id to payment_transactions for Individual commission payments
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_job_id
  ON public.payment_transactions(job_id);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_worker_job
  ON public.payment_transactions(employer_id, job_id, worker_profile_id);

-- 2. Update create_job_for_employer:
-- INDIVIDUAL employers can create jobs freely without subscription checks.
-- BUSINESS employers require an active subscription (subscription_valid_until > NOW()).
CREATE OR REPLACE FUNCTION public.create_job_for_employer(
  p_employer_id UUID,
  p_job_site_id UUID,
  p_title TEXT,
  p_headcount_required INTEGER,
  p_max_daily_salary NUMERIC DEFAULT NULL,
  p_min_experience INTEGER DEFAULT NULL,
  p_trade_id TEXT DEFAULT NULL,
  p_required_skills TEXT[] DEFAULT '{}'::TEXT[]
)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  employer public.employer_profiles%ROWTYPE;
  created_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO employer FROM public.employer_profiles WHERE id = p_employer_id FOR UPDATE;
  IF NOT FOUND OR employer.onboarding_status <> 'COMPLETED' THEN RAISE EXCEPTION 'EMPLOYER_ONBOARDING_INCOMPLETE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_sites WHERE id = p_job_site_id AND employer_id = p_employer_id) THEN RAISE EXCEPTION 'JOB_SITE_NOT_FOUND'; END IF;

  -- Business employers require an active subscription to post jobs.
  -- Individual employers do not require a subscription to create jobs.
  IF employer.employer_type IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS') THEN
    IF employer.subscription_valid_until IS NULL OR employer.subscription_valid_until <= NOW() THEN
      RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED';
    END IF;
  END IF;

  INSERT INTO public.jobs (employer_id, job_site_id, title, headcount_required, max_daily_salary, min_experience, trade_id, required_skills, status)
  VALUES (p_employer_id, p_job_site_id, p_title, p_headcount_required, p_max_daily_salary, p_min_experience, p_trade_id, COALESCE(p_required_skills, '{}'::TEXT[]), 'SEARCHING')
  RETURNING * INTO created_job;
  RETURN created_job;
END;
$$;

REVOKE ALL ON FUNCTION public.create_job_for_employer(UUID, UUID, TEXT, INTEGER, NUMERIC, INTEGER, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_for_employer(UUID, UUID, TEXT, INTEGER, NUMERIC, INTEGER, TEXT, TEXT[]) TO service_role;


-- 3. Update accept_job_match:
-- For BUSINESS employers: requires subscription_valid_until > NOW().
-- For INDIVIDUAL employers:
--   First worker dispatch is FREE (atomically consumes has_availed_free_dispatch).
--   Subsequent worker dispatches require a SUCCESS commission payment for (job_id, worker_profile_id).
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
  resulting_job_status TEXT;
  has_paid_commission BOOLEAN;
BEGIN
  -- Lock employer row to prevent race conditions on free dispatch
  SELECT * INTO selected_employer
  FROM public.employer_profiles
  WHERE id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;

  SELECT * INTO selected_job
  FROM public.jobs AS j
  WHERE j.id = p_job_id AND j.employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF selected_job.status <> 'SEARCHING' THEN RAISE EXCEPTION 'JOB_NOT_OPEN_FOR_HIRING'; END IF;

  SELECT * INTO selected_match
  FROM public.job_matches AS jm
  WHERE jm.job_id = p_job_id AND jm.worker_profile_id = p_worker_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
  IF selected_match.status <> 'PENDING' THEN RAISE EXCEPTION 'MATCH_NOT_PENDING'; END IF;
  IF selected_match.expires_at <= NOW() THEN RAISE EXCEPTION 'MATCH_EXPIRED'; END IF;

  -- Verify worker matches current criteria
  IF NOT EXISTS (
    SELECT 1
    FROM public.get_current_job_match_workers(p_employer_id, p_job_id) AS current_match
    WHERE current_match.worker_profile_id = p_worker_profile_id
      AND current_match.status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'WORKER_NOT_ELIGIBLE';
  END IF;

  -- Service Entitlement Check
  IF selected_employer.employer_type IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS') THEN
    IF selected_employer.subscription_valid_until IS NULL OR selected_employer.subscription_valid_until <= NOW() THEN
      RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED';
    END IF;
  ELSIF selected_employer.employer_type = 'INDIVIDUAL' THEN
    IF NOT selected_employer.has_availed_free_dispatch THEN
      -- First qualifying dispatch is free! Atomically consume it.
      UPDATE public.employer_profiles
      SET has_availed_free_dispatch = TRUE
      WHERE id = p_employer_id;
    ELSE
      -- Subsequent dispatches require a successful ₹30 commission payment for this specific worker and job.
      SELECT EXISTS (
        SELECT 1
        FROM public.payment_transactions pt
        WHERE pt.employer_id = p_employer_id
          AND pt.worker_profile_id = p_worker_profile_id
          AND pt.status = 'SUCCESS'
          AND (pt.job_id = p_job_id OR (pt.raw_webhook_payload->>'job_id') = p_job_id::text)
      ) INTO has_paid_commission;

      IF NOT has_paid_commission THEN
        RAISE EXCEPTION 'COMMISSION_REQUIRED';
      END IF;
    END IF;
  END IF;

  SELECT COUNT(*)::INTEGER INTO accepted_workers
  FROM public.job_matches AS jm
  WHERE jm.job_id = p_job_id AND jm.status = 'ACCEPTED';
  IF accepted_workers >= selected_job.headcount_required THEN RAISE EXCEPTION 'HEADCOUNT_FILLED'; END IF;

  UPDATE public.job_matches AS jm
  SET status = 'ACCEPTED'
  WHERE jm.id = selected_match.id;

  accepted_workers := accepted_workers + 1;
  resulting_job_status := CASE
    WHEN accepted_workers >= selected_job.headcount_required THEN 'FILLED'
    ELSE 'SEARCHING'
  END;
  IF resulting_job_status = 'FILLED' THEN
    UPDATE public.jobs AS j SET status = resulting_job_status WHERE j.id = p_job_id;
  END IF;

  RETURN QUERY SELECT selected_match.id, p_worker_profile_id, 'ACCEPTED', resulting_job_status, accepted_workers;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_job_match(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_job_match(UUID, UUID, UUID) TO service_role;


-- 4. Update process_subscription_payment_success:
-- Preserves stacking for Workers (+30 days) and Business employers (+30 days).
-- Individual employers: marks transaction SUCCESS without modifying subscription_valid_until.
CREATE OR REPLACE FUNCTION public.process_subscription_payment_success(
  p_order_id TEXT,
  p_cf_order_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payment_record public.payment_transactions%ROWTYPE;
  base_time TIMESTAMPTZ;
  employer_kind public.employer_type;
BEGIN
  SELECT * INTO payment_record
  FROM public.payment_transactions
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'UNKNOWN'; END IF;
  IF payment_record.status = 'SUCCESS' THEN RETURN 'ALREADY_SUCCESS'; END IF;
  IF payment_record.status <> 'PENDING' THEN RETURN 'INVALID_STATE'; END IF;

  UPDATE public.payment_transactions
  SET status = 'SUCCESS', cf_order_id = COALESCE(p_cf_order_id, cf_order_id)
  WHERE id = payment_record.id;

  IF payment_record.worker_profile_id IS NOT NULL AND payment_record.employer_id IS NULL THEN
    -- Worker subscription payment (₹200 / 30 days)
    SELECT CASE WHEN subscription_valid_until IS NOT NULL AND subscription_valid_until > NOW()
      THEN subscription_valid_until ELSE NOW() END
    INTO base_time
    FROM public.worker_profiles
    WHERE id = payment_record.worker_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WORKER_NOT_FOUND'; END IF;

    UPDATE public.worker_profiles
    SET subscription_valid_until = base_time + INTERVAL '30 days'
    WHERE id = payment_record.worker_profile_id;
  ELSIF payment_record.employer_id IS NOT NULL THEN
    SELECT employer_type INTO employer_kind
    FROM public.employer_profiles
    WHERE id = payment_record.employer_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;

    -- Only Business employers get subscription_valid_until updated.
    -- Individual employers pay per-job/worker commission and NEVER have subscription_valid_until set.
    IF employer_kind IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS') THEN
      SELECT CASE WHEN subscription_valid_until IS NOT NULL AND subscription_valid_until > NOW()
        THEN subscription_valid_until ELSE NOW() END
      INTO base_time
      FROM public.employer_profiles
      WHERE id = payment_record.employer_id
      FOR UPDATE;

      UPDATE public.employer_profiles
      SET subscription_valid_until = base_time + INTERVAL '30 days'
      WHERE id = payment_record.employer_id;
    END IF;
  END IF;

  RETURN 'SUCCESS';
END;
$$;

REVOKE ALL ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) TO service_role;

COMMIT;
