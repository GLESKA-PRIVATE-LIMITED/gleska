BEGIN;

ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS subscription_valid_until TIMESTAMPTZ;

ALTER TABLE public.payment_transactions
  ALTER COLUMN employer_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS worker_profile_id UUID REFERENCES public.worker_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_owner_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_owner_check
  CHECK ((employer_id IS NOT NULL) <> (worker_profile_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_one_pending_worker
  ON public.payment_transactions(worker_profile_id) WHERE status = 'PENDING';

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

  IF payment_record.employer_id IS NOT NULL THEN
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
  ELSE
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
  END IF;

  RETURN 'SUCCESS';
END;
$$;

REVOKE ALL ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) TO service_role;

COMMIT;