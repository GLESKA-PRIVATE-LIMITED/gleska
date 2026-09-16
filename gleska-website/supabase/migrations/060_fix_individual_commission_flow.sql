BEGIN;

-- Commission payments are employer-owned. The selected worker is carried in
-- raw_webhook_payload because payment_transactions_owner_check forbids both
-- owner columns from being populated.
DROP INDEX IF EXISTS public.idx_payment_transactions_one_pending_employer;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_one_pending_business
  ON public.payment_transactions(employer_id)
  WHERE status = 'PENDING' AND payment_category = 'BUSINESS_SUBSCRIPTION';
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_one_pending_commission
  ON public.payment_transactions(
    employer_id,
    job_id,
    ((raw_webhook_payload->>'worker_profile_id'))
  )
  WHERE status = 'PENDING' AND payment_category = 'INDIVIDUAL_COMMISSION';

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
  validity_from TIMESTAMPTZ;
  validity_until TIMESTAMPTZ;
  employer_kind public.employer_type;
  commission_worker_id UUID;
BEGIN
  SELECT * INTO payment_record
  FROM public.payment_transactions
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'UNKNOWN'; END IF;
  IF payment_record.status = 'SUCCESS' THEN RETURN 'ALREADY_SUCCESS'; END IF;
  IF payment_record.status <> 'PENDING' THEN RETURN 'INVALID_STATE'; END IF;

  IF payment_record.payment_category = 'WORKER_SUBSCRIPTION' THEN
    IF payment_record.worker_profile_id IS NULL
      OR payment_record.employer_id IS NOT NULL
      OR payment_record.amount <> 200.00 THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
    END IF;
    SELECT CASE WHEN subscription_valid_until IS NOT NULL AND subscription_valid_until > NOW()
      THEN subscription_valid_until ELSE NOW() END
    INTO base_time FROM public.worker_profiles
    WHERE id = payment_record.worker_profile_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WORKER_NOT_FOUND'; END IF;
    validity_from := base_time;
    validity_until := base_time + INTERVAL '30 days';
    UPDATE public.payment_transactions
    SET status = 'SUCCESS', cf_order_id = COALESCE(p_cf_order_id, cf_order_id),
        subscription_valid_from = validity_from, subscription_valid_until = validity_until,
        payment_success_at = NOW()
    WHERE id = payment_record.id;
    UPDATE public.worker_profiles SET subscription_valid_until = validity_until
    WHERE id = payment_record.worker_profile_id;
  ELSIF payment_record.payment_category = 'BUSINESS_SUBSCRIPTION' THEN
    IF payment_record.employer_id IS NULL
      OR payment_record.worker_profile_id IS NOT NULL
      OR payment_record.amount <> 2000.00 THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
    END IF;
    SELECT employer_type, subscription_valid_until INTO employer_kind, base_time
    FROM public.employer_profiles WHERE id = payment_record.employer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;
    IF employer_kind NOT IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS') THEN
      RAISE EXCEPTION 'INVALID_EMPLOYER_TYPE';
    END IF;
    IF base_time IS NULL OR base_time <= NOW() THEN base_time := NOW(); END IF;
    validity_from := base_time;
    validity_until := base_time + INTERVAL '30 days';
    UPDATE public.payment_transactions
    SET status = 'SUCCESS', cf_order_id = COALESCE(p_cf_order_id, cf_order_id),
        subscription_valid_from = validity_from, subscription_valid_until = validity_until,
        payment_success_at = NOW()
    WHERE id = payment_record.id;
    UPDATE public.employer_profiles SET subscription_valid_until = validity_until
    WHERE id = payment_record.employer_id;
  ELSIF payment_record.payment_category = 'INDIVIDUAL_COMMISSION' THEN
    IF payment_record.employer_id IS NULL
      OR payment_record.worker_profile_id IS NOT NULL
      OR payment_record.amount <> 30.00
      OR payment_record.job_id IS NULL
      OR jsonb_typeof(payment_record.raw_webhook_payload) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
    END IF;
    BEGIN
      commission_worker_id := (payment_record.raw_webhook_payload->>'worker_profile_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
    END;
    IF commission_worker_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.worker_profiles WHERE id = commission_worker_id
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.jobs
        WHERE id = payment_record.job_id AND employer_id = payment_record.employer_id
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.job_matches
        WHERE job_id = payment_record.job_id AND worker_profile_id = commission_worker_id
      ) THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
    END IF;
    SELECT employer_type INTO employer_kind FROM public.employer_profiles
    WHERE id = payment_record.employer_id FOR UPDATE;
    IF NOT FOUND OR employer_kind <> 'INDIVIDUAL' THEN RAISE EXCEPTION 'INVALID_EMPLOYER_TYPE'; END IF;
    UPDATE public.payment_transactions
    SET status = 'SUCCESS', cf_order_id = COALESCE(p_cf_order_id, cf_order_id),
        subscription_valid_from = NULL, subscription_valid_until = NULL, payment_success_at = NOW()
    WHERE id = payment_record.id;
  ELSE
    RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
  END IF;
  RETURN 'SUCCESS';
END;
$$;

REVOKE ALL ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_job_match(
  p_employer_id UUID, p_job_id UUID, p_worker_profile_id UUID
)
RETURNS TABLE (match_id UUID, worker_profile_id UUID, match_status TEXT, job_status TEXT, accepted_count INTEGER)
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
  SELECT * INTO selected_employer FROM public.employer_profiles WHERE id = p_employer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;
  SELECT * INTO selected_job FROM public.jobs WHERE id = p_job_id AND employer_id = p_employer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF selected_job.status <> 'SEARCHING' THEN RAISE EXCEPTION 'JOB_NOT_OPEN_FOR_HIRING'; END IF;
  SELECT * INTO selected_match FROM public.job_matches
  WHERE job_id = p_job_id AND worker_profile_id = p_worker_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
  IF selected_match.status <> 'PENDING' THEN RAISE EXCEPTION 'MATCH_NOT_PENDING'; END IF;
  IF selected_match.expires_at <= NOW() THEN RAISE EXCEPTION 'MATCH_EXPIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_current_job_match_workers(p_employer_id, p_job_id) current_match
    WHERE current_match.worker_profile_id = p_worker_profile_id AND current_match.status = 'PENDING') THEN
    RAISE EXCEPTION 'WORKER_NOT_ELIGIBLE';
  END IF;
  IF selected_employer.employer_type IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS') THEN
    IF selected_employer.subscription_valid_until IS NULL OR selected_employer.subscription_valid_until <= NOW() THEN
      RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED';
    END IF;
  ELSIF selected_employer.employer_type = 'INDIVIDUAL' THEN
    IF NOT selected_employer.has_availed_free_dispatch THEN
      UPDATE public.employer_profiles SET has_availed_free_dispatch = TRUE WHERE id = p_employer_id;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.payment_transactions pt
        WHERE pt.employer_id = p_employer_id AND pt.job_id = p_job_id
          AND pt.worker_profile_id IS NULL AND pt.payment_category = 'INDIVIDUAL_COMMISSION'
          AND pt.amount = 30.00 AND pt.status = 'SUCCESS'
          AND pt.raw_webhook_payload->>'worker_profile_id' = p_worker_profile_id::text
      ) INTO has_paid_commission;
      IF NOT has_paid_commission THEN RAISE EXCEPTION 'COMMISSION_REQUIRED'; END IF;
    END IF;
  END IF;
  SELECT COUNT(*)::INTEGER INTO accepted_workers FROM public.job_matches WHERE job_id = p_job_id AND status = 'ACCEPTED';
  IF accepted_workers >= selected_job.headcount_required THEN RAISE EXCEPTION 'HEADCOUNT_FILLED'; END IF;
  UPDATE public.job_matches SET status = 'ACCEPTED' WHERE id = selected_match.id;
  accepted_workers := accepted_workers + 1;
  resulting_job_status := CASE WHEN accepted_workers >= selected_job.headcount_required THEN 'FILLED' ELSE 'SEARCHING' END;
  IF resulting_job_status = 'FILLED' THEN UPDATE public.jobs SET status = resulting_job_status WHERE id = p_job_id; END IF;
  RETURN QUERY SELECT selected_match.id, p_worker_profile_id, 'ACCEPTED', resulting_job_status, accepted_workers;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_job_match(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_job_match(UUID, UUID, UUID) TO service_role;

COMMIT;