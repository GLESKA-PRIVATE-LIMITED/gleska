-- AI credit purchases via Cashfree (ADR 0007, increment 2).
--
-- RLS impact: one new table, RLS enabled. Employers may SELECT only their own account's orders
--   (via billing_account_owned from 104); no client writes. The backend (service_role) creates
--   orders; credits are added only by billing_complete_purchase, which is service_role-only.
-- Data impact: additive; no existing table changes. Credits move through credit_ledger
--   ('purchase' entries, idempotency key purchase:<order_id>) like every other balance change.
-- Money: NUMERIC only. The amount is fixed by the backend when the order is created
--   (credits × credit value in force) and must match what Cashfree reports, to the paisa.
-- Rollback: drop the two functions, the sequence and the table. That loses purchase records
--   and receipts; never do it once real payments exist without an export.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.credit_receipt_seq;

CREATE TABLE IF NOT EXISTS public.credit_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL UNIQUE CHECK (order_id ~ '^cred_[a-f0-9]{16,32}$'),
  account_id UUID NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  credits NUMERIC(20,6) NOT NULL CHECK (credits > 0),
  credit_value_inr NUMERIC(12,4) NOT NULL CHECK (credit_value_inr > 0),
  settings_id UUID REFERENCES public.billing_settings(id),
  amount_inr NUMERIC(12,2) NOT NULL CHECK (amount_inr > 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'FAILED')),
  cf_order_id TEXT,
  cf_payment_id TEXT,
  payment_method TEXT,
  last_payment_status TEXT,
  receipt_number TEXT UNIQUE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_purchase_paid_complete CHECK (
    status <> 'PAID' OR (paid_at IS NOT NULL AND receipt_number IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_credit_purchase_orders_account
  ON public.credit_purchase_orders(account_id, created_at DESC);

-- Credits a paid order exactly once. Called by the backend after Cashfree confirms payment
-- (signed webhook or server-side order lookup); re-checks the amount against the stored order.
CREATE OR REPLACE FUNCTION public.billing_complete_purchase(
  p_order_id TEXT, p_paid_amount NUMERIC, p_currency TEXT,
  p_cf_order_id TEXT DEFAULT NULL, p_cf_payment_id TEXT DEFAULT NULL, p_payment_method TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order credit_purchase_orders%ROWTYPE;
  v_wallet credit_wallets%ROWTYPE;
  v_receipt TEXT;
BEGIN
  SELECT * INTO v_order FROM credit_purchase_orders WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PURCHASE_NOT_FOUND'; END IF;
  IF v_order.status = 'PAID' THEN
    RETURN jsonb_build_object('status', 'PAID', 'idempotent', true, 'receipt_number', v_order.receipt_number);
  END IF;
  IF v_order.status <> 'PENDING' THEN
    -- Money arrived for an order we had closed: never auto-credit, leave it for admin review.
    RAISE EXCEPTION 'PURCHASE_STATE_INVALID' USING ERRCODE = 'check_violation';
  END IF;
  IF p_paid_amount IS DISTINCT FROM v_order.amount_inr OR upper(coalesce(p_currency, '')) <> v_order.currency THEN
    RAISE EXCEPTION 'PURCHASE_AMOUNT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_wallet FROM credit_wallets WHERE account_id = v_order.account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_ACCOUNT_NOT_FOUND'; END IF;

  UPDATE credit_wallets
     SET available = available + v_order.credits,
         total_purchased = total_purchased + v_order.credits,
         last_transaction_at = NOW(), updated_at = NOW()
   WHERE account_id = v_order.account_id;
  INSERT INTO credit_ledger (account_id, entry_type, delta_available, available_before, available_after,
    reserved_before, reserved_after, reference_type, reference_id, idempotency_key, description, actor_user_id)
  VALUES (v_order.account_id, 'purchase', v_order.credits, v_wallet.available, v_wallet.available + v_order.credits,
    v_wallet.reserved, v_wallet.reserved, 'credit_purchase', p_order_id, 'purchase:' || p_order_id,
    'Credits purchased', v_order.user_id);

  v_receipt := 'GLK-CR-' || lpad(nextval('credit_receipt_seq')::text, 6, '0');
  UPDATE credit_purchase_orders
     SET status = 'PAID', paid_at = NOW(), updated_at = NOW(), receipt_number = v_receipt,
         cf_order_id = coalesce(p_cf_order_id, cf_order_id),
         cf_payment_id = coalesce(p_cf_payment_id, cf_payment_id),
         payment_method = coalesce(p_payment_method, payment_method),
         last_payment_status = 'SUCCESS'
   WHERE id = v_order.id;

  RETURN jsonb_build_object('status', 'PAID', 'credits', v_order.credits, 'receipt_number', v_receipt,
                            'available', v_wallet.available + v_order.credits);
END $$;

ALTER TABLE public.credit_purchase_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_purchase_orders FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.credit_receipt_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.credit_purchase_orders TO authenticated;
GRANT ALL ON public.credit_purchase_orders TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.credit_receipt_seq TO service_role;

DROP POLICY IF EXISTS "Employers read own credit purchases" ON public.credit_purchase_orders;
CREATE POLICY "Employers read own credit purchases" ON public.credit_purchase_orders
  FOR SELECT TO authenticated USING (public.billing_account_owned(account_id));

REVOKE ALL ON FUNCTION public.billing_complete_purchase(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_complete_purchase(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
