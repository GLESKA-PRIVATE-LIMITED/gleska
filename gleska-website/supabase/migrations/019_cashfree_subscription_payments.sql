BEGIN;

ALTER TABLE public.employer_profiles
  ADD COLUMN IF NOT EXISTS has_availed_free_dispatch BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subscription_valid_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL UNIQUE,
  cf_order_id TEXT,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount = 2000.00),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED')),
  payment_session_id TEXT NOT NULL,
  raw_webhook_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_employer_id
  ON public.payment_transactions(employer_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_cf_order_id
  ON public.payment_transactions(cf_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_one_pending_employer
  ON public.payment_transactions(employer_id) WHERE status = 'PENDING';

DROP TRIGGER IF EXISTS update_payment_transactions_updated_at ON public.payment_transactions;
CREATE TRIGGER update_payment_transactions_updated_at
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can manage payment transactions" ON public.payment_transactions;
CREATE POLICY "Service role can manage payment transactions"
  ON public.payment_transactions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

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

  IF NOT FOUND THEN
    RETURN 'UNKNOWN';
  END IF;

  IF payment_record.status = 'SUCCESS' THEN
    RETURN 'ALREADY_SUCCESS';
  END IF;

  UPDATE public.payment_transactions
  SET status = 'SUCCESS',
      cf_order_id = COALESCE(p_cf_order_id, cf_order_id)
  WHERE id = payment_record.id;

  SELECT CASE
    WHEN subscription_valid_until IS NOT NULL AND subscription_valid_until > NOW()
      THEN subscription_valid_until
    ELSE NOW()
  END
  INTO base_time
  FROM public.employer_profiles
  WHERE id = payment_record.employer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMPLOYER_NOT_FOUND';
  END IF;

  UPDATE public.employer_profiles
  SET subscription_valid_until = base_time + INTERVAL '30 days'
  WHERE id = payment_record.employer_id;

  RETURN 'SUCCESS';
END;
$$;

REVOKE ALL ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_subscription_payment_success(TEXT, TEXT) TO service_role;

COMMIT;
