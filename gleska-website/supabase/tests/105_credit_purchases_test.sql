-- Assertion tests for migration 105 (credit purchases). Run after 104 + 105 (and after
-- 104_ai_billing_core_test.sql) on a throwaway database with the stand-ins from
-- gleska-website/supabase/CLAUDE.md and these rows:
--   users: 11111111-1111-1111-1111-111111111111, bbbbbbbb-0000-0000-0000-000000000001,
--          22222222-2222-2222-2222-222222222222, bbbbbbbb-0000-0000-0000-000000000003
--   employer_profiles (id → user_id): aaaaaaaa-…-0001 → bbbbbbbb-…-0001,
--          aaaaaaaa-…-0002 → 22222222-…, aaaaaaaa-…-0003 → bbbbbbbb-…-0003
-- Prints "ALL PURCHASE TESTS PASSED" on success; any failed check raises.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect(ok BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF; END $$;

DO $$
DECLARE
  a UUID := billing_ensure_account('aaaaaaaa-0000-0000-0000-000000000001');
  start_available NUMERIC; start_purchased NUMERIC; r JSONB; failed BOOLEAN;
BEGIN
  SELECT available, total_purchased INTO start_available, start_purchased FROM credit_wallets WHERE account_id = a;
  INSERT INTO credit_purchase_orders (order_id, account_id, credits, credit_value_inr, amount_inr)
  VALUES ('cred_00000000000000a1', a, 25, 20, 500.00),
         ('cred_00000000000000a2', a, 5, 20, 100.00),
         ('cred_00000000000000a3', a, 5, 20, 100.00);

  -- Wrong amount or currency never credits.
  failed := false;
  BEGIN PERFORM billing_complete_purchase('cred_00000000000000a1', 499.99, 'INR');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'amount mismatch rejected');
  failed := false;
  BEGIN PERFORM billing_complete_purchase('cred_00000000000000a1', 500, 'USD');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'currency mismatch rejected');
  PERFORM pg_temp.expect((SELECT available FROM credit_wallets WHERE account_id = a) = start_available, 'nothing credited on mismatch');

  -- Correct payment credits once (webhook + return-page verification both arrive).
  r := billing_complete_purchase('cred_00000000000000a1', 500, 'inr', 'cf1', 'pay1', 'upi');
  PERFORM pg_temp.expect(r->>'status' = 'PAID' AND r->>'receipt_number' LIKE 'GLK-CR-%', 'first completion pays');
  r := billing_complete_purchase('cred_00000000000000a1', 500, 'INR');
  PERFORM pg_temp.expect((r->>'idempotent')::boolean, 'second completion is idempotent');
  PERFORM pg_temp.expect((SELECT available FROM credit_wallets WHERE account_id = a) = start_available + 25, 'credited exactly once');
  PERFORM pg_temp.expect((SELECT total_purchased FROM credit_wallets WHERE account_id = a) = start_purchased + 25, 'total_purchased updated');
  PERFORM pg_temp.expect((SELECT count(*) FROM credit_ledger WHERE idempotency_key = 'purchase:cred_00000000000000a1') = 1, 'one ledger entry');
  PERFORM pg_temp.expect((SELECT cf_payment_id FROM credit_purchase_orders WHERE order_id = 'cred_00000000000000a1') = 'pay1', 'provider ids stored');

  -- Receipt numbers are unique and sequential.
  PERFORM billing_complete_purchase('cred_00000000000000a2', 100, 'INR');
  PERFORM pg_temp.expect((SELECT count(DISTINCT receipt_number) FROM credit_purchase_orders WHERE status = 'PAID') = 2, 'unique receipts');

  -- A closed (expired) order is never auto-credited.
  UPDATE credit_purchase_orders SET status = 'EXPIRED' WHERE order_id = 'cred_00000000000000a3';
  failed := false;
  BEGIN PERFORM billing_complete_purchase('cred_00000000000000a3', 100, 'INR');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'expired order not credited');

  -- PAID rows must carry a receipt.
  failed := false;
  BEGIN UPDATE credit_purchase_orders SET status = 'PAID' WHERE order_id = 'cred_00000000000000a3';
  EXCEPTION WHEN check_violation THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'PAID requires receipt');

  failed := false;
  BEGIN INSERT INTO credit_purchase_orders (order_id, account_id, credits, credit_value_inr, amount_inr)
        VALUES ('sub_123', a, 5, 20, 100);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'only cred_ order ids');
END $$;

-- Employers read only their own orders and cannot write or call the money function.
SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE failed BOOLEAN := false;
BEGIN
  PERFORM pg_temp.expect((SELECT count(*) FROM credit_purchase_orders) = 0, 'other employer sees none');
  BEGIN PERFORM billing_complete_purchase('cred_00000000000000a1', 500, 'INR');
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'authenticated cannot complete purchases');
  failed := false;
  BEGIN UPDATE credit_purchase_orders SET status = 'PAID';
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'authenticated cannot update orders');
END $$;
SET request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
DO $$ BEGIN
  PERFORM pg_temp.expect((SELECT count(*) FROM credit_purchase_orders) = 3, 'owner sees own orders');
END $$;
RESET ROLE;

\echo ALL PURCHASE TESTS PASSED
