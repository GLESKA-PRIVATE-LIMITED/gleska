BEGIN;

-- Phase 4-5: Update process_subscription_payment_success to persist payment-level validity
-- This new version:
-- 1. Calculates subscription period based on existing stacking rules
-- 2. Persists subscription_valid_from and subscription_valid_until on the payment transaction
-- 3. Updates the profile's subscription_valid_until as before
-- 4. Maintains idempotency for duplicate webhook calls

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
BEGIN
  SELECT * INTO payment_record
  FROM public.payment_transactions
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'UNKNOWN'; END IF;
  IF payment_record.status = 'SUCCESS' THEN RETURN 'ALREADY_SUCCESS'; END IF;
  IF payment_record.status <> 'PENDING' THEN RETURN 'INVALID_STATE'; END IF;

  -- Mark payment as SUCCESS
  UPDATE public.payment_transactions
  SET status = 'SUCCESS', cf_order_id = COALESCE(p_cf_order_id, cf_order_id)
  WHERE id = payment_record.id;

  -- ======================================================================
  -- WORKER SUBSCRIPTION (₹200)
  -- ======================================================================
  IF payment_record.worker_profile_id IS NOT NULL AND payment_record.employer_id IS NULL THEN
    SELECT CASE WHEN subscription_valid_until IS NOT NULL AND subscription_valid_until > NOW()
      THEN subscription_valid_until ELSE NOW() END
    INTO base_time
    FROM public.worker_profiles
    WHERE id = payment_record.worker_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WORKER_NOT_FOUND'; END IF;

    -- Calculate subscription period granted by this payment
    validity_from := base_time;
    validity_until := base_time + INTERVAL '30 days';

    -- Persist payment-level subscription validity
    UPDATE public.payment_transactions
    SET subscription_valid_from = validity_from,
        subscription_valid_until = validity_until
    WHERE id = payment_record.id;

    -- Update worker's current subscription validity
    UPDATE public.worker_profiles
    SET subscription_valid_until = validity_until
    WHERE id = payment_record.worker_profile_id;

  -- ======================================================================
  -- EMPLOYER SUBSCRIPTION / COMMISSION
  -- ======================================================================
  ELSIF payment_record.employer_id IS NOT NULL THEN
    SELECT employer_type INTO employer_kind
    FROM public.employer_profiles
    WHERE id = payment_record.employer_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;

    -- ====================================================================
    -- BUSINESS SUBSCRIPTION (₹2,000) - for REGISTERED_INDUSTRY, etc.
    -- ====================================================================
    IF employer_kind IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS') THEN
      SELECT CASE WHEN subscription_valid_until IS NOT NULL AND subscription_valid_until > NOW()
        THEN subscription_valid_until ELSE NOW() END
      INTO base_time
      FROM public.employer_profiles
      WHERE id = payment_record.employer_id
      FOR UPDATE;

      -- Calculate subscription period granted by this payment
      validity_from := base_time;
      validity_until := base_time + INTERVAL '30 days';

      -- Persist payment-level subscription validity
      UPDATE public.payment_transactions
      SET subscription_valid_from = validity_from,
          subscription_valid_until = validity_until
      WHERE id = payment_record.id;

      -- Update employer's current subscription validity
      UPDATE public.employer_profiles
      SET subscription_valid_until = validity_until
      WHERE id = payment_record.employer_id;

    -- ====================================================================
    -- INDIVIDUAL COMMISSION (₹30) - NOT a subscription
    -- ====================================================================
    -- Individual employers pay per-job/worker commission.
    -- These payments NEVER grant subscription validity.
    -- subscription_valid_from and subscription_valid_until remain NULL.
    -- employer_profiles.subscription_valid_until is NOT modified.
    ELSIF employer_kind = 'INDIVIDUAL' THEN
      -- Explicitly leave subscription_valid_from and subscription_valid_until as NULL
      UPDATE public.payment_transactions
      SET subscription_valid_from = NULL,
          subscription_valid_until = NULL
      WHERE id = payment_record.id;
      -- employer_profiles.subscription_valid_until is NOT updated
    END IF;
  END IF;

  RETURN 'SUCCESS';
END;
$$;

REVOKE ALL ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) TO service_role;

COMMIT;
