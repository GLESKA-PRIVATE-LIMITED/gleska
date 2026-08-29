BEGIN;

ALTER TABLE public.employer_profiles
  ADD COLUMN IF NOT EXISTS subscription_valid_until TIMESTAMPTZ;

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

REVOKE ALL ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) TO service_role;

COMMIT;
