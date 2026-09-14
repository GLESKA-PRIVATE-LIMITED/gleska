BEGIN;

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS payment_category TEXT,
  ADD COLUMN IF NOT EXISTS payment_success_at TIMESTAMPTZ;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payment_transactions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%amount = 2000.00%'
  LOOP
    EXECUTE format('ALTER TABLE public.payment_transactions DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_payment_category_check,
  DROP CONSTRAINT IF EXISTS payment_transactions_category_amount_check;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_payment_category_check
  CHECK (
    payment_category IS NULL
    OR payment_category IN (
      'WORKER_SUBSCRIPTION',
      'BUSINESS_SUBSCRIPTION',
      'INDIVIDUAL_COMMISSION',
      'LEGACY_PAYMENT',
      'UNKNOWN'
    )
  ),
  ADD CONSTRAINT payment_transactions_category_amount_check
  CHECK (
    payment_category IS NULL
    OR payment_category IN ('LEGACY_PAYMENT', 'UNKNOWN')
    OR (payment_category = 'WORKER_SUBSCRIPTION' AND amount = 200.00)
    OR (payment_category = 'BUSINESS_SUBSCRIPTION' AND amount = 2000.00)
    OR (payment_category = 'INDIVIDUAL_COMMISSION' AND amount = 30.00)
  );

CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_category
  ON public.payment_transactions(payment_category);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_success_at
  ON public.payment_transactions(payment_success_at)
  WHERE payment_success_at IS NOT NULL;

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

  IF payment_record.payment_category = 'WORKER_SUBSCRIPTION' THEN
    IF payment_record.worker_profile_id IS NULL
      OR payment_record.employer_id IS NOT NULL
      OR payment_record.amount <> 200.00 THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
    END IF;

    SELECT CASE
      WHEN subscription_valid_until IS NOT NULL AND subscription_valid_until > NOW()
        THEN subscription_valid_until
      ELSE NOW()
    END
    INTO base_time
    FROM public.worker_profiles
    WHERE id = payment_record.worker_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WORKER_NOT_FOUND'; END IF;

    validity_from := base_time;
    validity_until := base_time + INTERVAL '30 days';

    UPDATE public.payment_transactions
    SET status = 'SUCCESS',
        cf_order_id = COALESCE(p_cf_order_id, cf_order_id),
        subscription_valid_from = validity_from,
        subscription_valid_until = validity_until,
        payment_success_at = NOW()
    WHERE id = payment_record.id;

    UPDATE public.worker_profiles
    SET subscription_valid_until = validity_until
    WHERE id = payment_record.worker_profile_id;

  ELSIF payment_record.payment_category = 'BUSINESS_SUBSCRIPTION' THEN
    IF payment_record.employer_id IS NULL
      OR payment_record.worker_profile_id IS NOT NULL
      OR payment_record.amount <> 2000.00 THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
    END IF;

    SELECT employer_type, subscription_valid_until
    INTO employer_kind, base_time
    FROM public.employer_profiles
    WHERE id = payment_record.employer_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;
    IF employer_kind NOT IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS') THEN
      RAISE EXCEPTION 'INVALID_EMPLOYER_TYPE';
    END IF;

    IF base_time IS NULL OR base_time <= NOW() THEN
      base_time := NOW();
    END IF;
    validity_from := base_time;
    validity_until := base_time + INTERVAL '30 days';

    UPDATE public.payment_transactions
    SET status = 'SUCCESS',
        cf_order_id = COALESCE(p_cf_order_id, cf_order_id),
        subscription_valid_from = validity_from,
        subscription_valid_until = validity_until,
        payment_success_at = NOW()
    WHERE id = payment_record.id;

    UPDATE public.employer_profiles
    SET subscription_valid_until = validity_until
    WHERE id = payment_record.employer_id;

  ELSIF payment_record.payment_category = 'INDIVIDUAL_COMMISSION' THEN
    IF payment_record.employer_id IS NULL
      OR payment_record.worker_profile_id IS NULL
      OR payment_record.amount <> 30.00 THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
    END IF;

    SELECT employer_type
    INTO employer_kind
    FROM public.employer_profiles
    WHERE id = payment_record.employer_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;
    IF employer_kind <> 'INDIVIDUAL' THEN RAISE EXCEPTION 'INVALID_EMPLOYER_TYPE'; END IF;

    UPDATE public.payment_transactions
    SET status = 'SUCCESS',
        cf_order_id = COALESCE(p_cf_order_id, cf_order_id),
        subscription_valid_from = NULL,
        subscription_valid_until = NULL,
        payment_success_at = NOW()
    WHERE id = payment_record.id;

  ELSE
    RAISE EXCEPTION 'INVALID_PAYMENT_CONFIGURATION';
  END IF;

  RETURN 'SUCCESS';
END;
$$;

REVOKE ALL ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) TO service_role;

COMMIT;
