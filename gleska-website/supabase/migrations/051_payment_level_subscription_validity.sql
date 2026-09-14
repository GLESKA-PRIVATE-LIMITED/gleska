BEGIN;

-- Phase 1: Add payment-level subscription validity fields
-- These fields track the exact subscription period granted by each payment transaction
-- for Worker and Business subscription payments only.
-- They remain NULL for Individual commissions and other payment types.

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS subscription_valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_valid_until TIMESTAMPTZ;

-- Add comments for clarity
COMMENT ON COLUMN public.payment_transactions.subscription_valid_from IS 'Start of subscription period granted by this payment (Worker/Business subscriptions only). NULL for Individual commissions and other payments.';
COMMENT ON COLUMN public.payment_transactions.subscription_valid_until IS 'End of subscription period granted by this payment (Worker/Business subscriptions only). NULL for Individual commissions and other payments.';

-- Add indexes to optimize queries
CREATE INDEX IF NOT EXISTS idx_payment_transactions_subscription_valid_until
  ON public.payment_transactions(subscription_valid_until)
  WHERE subscription_valid_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_active_subscriptions
  ON public.payment_transactions(status, subscription_valid_until)
  WHERE status = 'SUCCESS' AND subscription_valid_until IS NOT NULL;

COMMIT;
