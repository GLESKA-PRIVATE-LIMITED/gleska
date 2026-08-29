BEGIN;

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

  SELECT CASE WHEN subscription_valid_until IS NOT NULL AND subscription_valid_until > NOW()
    THEN subscription_valid_until ELSE NOW() END
  INTO base_time
  FROM public.employer_profiles
  WHERE id = payment_record.employer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;

  UPDATE public.employer_profiles
  SET subscription_valid_until = base_time + INTERVAL '30 days'
  WHERE id = payment_record.employer_id;
  RETURN 'SUCCESS';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_job_for_employer(
  p_employer_id UUID,
  p_job_site_id UUID,
  p_title TEXT,
  p_headcount_required INTEGER,
  p_max_daily_salary NUMERIC DEFAULT NULL,
  p_min_experience INTEGER DEFAULT NULL
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
  IF employer.subscription_valid_until IS NULL OR employer.subscription_valid_until <= NOW() THEN
    IF employer.has_availed_free_dispatch THEN RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED'; END IF;
    employer.has_availed_free_dispatch := TRUE;
    UPDATE public.employer_profiles SET has_availed_free_dispatch = TRUE WHERE id = p_employer_id;
  END IF;
  INSERT INTO public.jobs (employer_id, job_site_id, title, headcount_required, max_daily_salary, min_experience, status)
  VALUES (p_employer_id, p_job_site_id, p_title, p_headcount_required, p_max_daily_salary, p_min_experience, 'SEARCHING')
  RETURNING * INTO created_job;
  RETURN created_job;
END;
$$;

REVOKE ALL ON FUNCTION public.create_job_for_employer(UUID, UUID, TEXT, INTEGER, NUMERIC, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_for_employer(UUID, UUID, TEXT, INTEGER, NUMERIC, INTEGER) TO service_role;

COMMIT;