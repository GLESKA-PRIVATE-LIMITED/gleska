-- Assertion tests for migration 104 (AI billing core). Run against a throwaway database after
-- applying the migration with the Supabase stand-ins described in gleska-website/supabase/CLAUDE.md
-- plus users(id) and employer_profiles(id, user_id) rows for two employers. Every failed check
-- raises an exception; a clean run prints "ALL BILLING TESTS PASSED".
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect(ok BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF; END $$;

CREATE OR REPLACE FUNCTION pg_temp.new_event(p_account UUID, p_request TEXT) RETURNS UUID LANGUAGE sql AS $$
  INSERT INTO ai_usage_events (request_id, account_id, initiating_agent, executing_agent, operation, provider, model, status)
  VALUES (p_request, p_account, 'general_work', 'general_work', 'chat', 'gemini', 'test-model', 'reserved')
  RETURNING id;
$$;

DO $$
DECLARE
  a UUID := billing_ensure_account('aaaaaaaa-0000-0000-0000-000000000001');
  b UUID := billing_ensure_account('aaaaaaaa-0000-0000-0000-000000000002');
  admin UUID := '11111111-1111-1111-1111-111111111111';
  e1 UUID; e2 UUID; e3 UUID; r JSONB; w credit_wallets%ROWTYPE;
BEGIN
  PERFORM pg_temp.expect(billing_ensure_account('aaaaaaaa-0000-0000-0000-000000000001') = a, 'ensure_account is idempotent');
  PERFORM pg_temp.expect((SELECT available FROM credit_wallets WHERE account_id = a) = 0, 'new wallet starts at 0');

  -- Admin grant (idempotent, reason required)
  PERFORM billing_admin_adjust(a, 10, 'Opening balance for tests', admin, 'k1');
  PERFORM billing_admin_adjust(a, 10, 'Opening balance for tests', admin, 'k1');
  PERFORM pg_temp.expect((SELECT available FROM credit_wallets WHERE account_id = a) = 10, 'adjustment applied exactly once');
  BEGIN PERFORM billing_admin_adjust(a, 1, 'no', admin, 'k2'); PERFORM pg_temp.expect(false, 'short reason rejected');
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN PERFORM billing_admin_adjust(a, -11, 'Would go negative', admin, 'k3'); PERFORM pg_temp.expect(false, 'negative balance rejected');
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Reserve -> settle below reservation releases the rest
  e1 := pg_temp.new_event(a, 'req-1');
  PERFORM billing_reserve(e1, 2.5);
  PERFORM billing_reserve(e1, 2.5);  -- idempotent
  SELECT * INTO w FROM credit_wallets WHERE account_id = a;
  PERFORM pg_temp.expect(w.available = 7.5 AND w.reserved = 2.5, 'reserve moves credits once');
  r := billing_settle(e1, 1.1, '{"status":"succeeded","usage_status":"confirmed","input_tokens":"100","output_tokens":"50"}');
  PERFORM pg_temp.expect((r->>'charged')::numeric = 1.1, 'settle charges actual');
  r := billing_settle(e1, 1.1, '{}');
  PERFORM pg_temp.expect((r->>'idempotent')::boolean, 'second settle is a no-op');
  SELECT * INTO w FROM credit_wallets WHERE account_id = a;
  PERFORM pg_temp.expect(w.available = 8.9 AND w.reserved = 0 AND w.total_consumed = 1.1, 'unused reservation released');
  PERFORM pg_temp.expect((SELECT status = 'succeeded' AND input_tokens = 100 AND credits_charged = 1.1
                          FROM ai_usage_events WHERE id = e1), 'usage event updated atomically');

  -- Overrun: charge beyond reservation takes from balance to zero, rest unrecovered
  e2 := pg_temp.new_event(a, 'req-2');
  PERFORM billing_reserve(e2, 1);
  r := billing_settle(e2, 12, '{"status":"succeeded"}');
  SELECT * INTO w FROM credit_wallets WHERE account_id = a;
  PERFORM pg_temp.expect(w.available = 0 AND w.reserved = 0, 'overrun drains to zero, never negative');
  PERFORM pg_temp.expect((r->>'unrecovered')::numeric = 3.1 AND w.total_unrecovered = 3.1, 'shortfall recorded as unrecovered');

  -- Insufficient credits
  e3 := pg_temp.new_event(a, 'req-3');
  BEGIN PERFORM billing_reserve(e3, 0.5); PERFORM pg_temp.expect(false, 'reserve without credits rejected');
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Release on failure
  PERFORM billing_admin_adjust(a, 5, 'Top up for release test', admin, 'k4');
  PERFORM billing_reserve(e3, 2);
  PERFORM billing_settle(e3, 0, '{"status":"failed","error_code":"AI_TIMEOUT"}');
  SELECT * INTO w FROM credit_wallets WHERE account_id = a;
  PERFORM pg_temp.expect(w.available = 5 AND w.reserved = 0, 'release restores full reservation');

  -- Ledger reconciles with the wallet
  PERFORM pg_temp.expect(
    (SELECT sum(delta_available) FROM credit_ledger WHERE account_id = a) = w.available
    AND (SELECT sum(delta_reserved) FROM credit_ledger WHERE account_id = a) = w.reserved,
    'ledger sums equal wallet balances');

  -- Append-only ledger (even for the owner role)
  BEGIN UPDATE credit_ledger SET description = 'x' WHERE account_id = a; PERFORM pg_temp.expect(false, 'ledger update blocked');
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM credit_ledger WHERE account_id = a; PERFORM pg_temp.expect(false, 'ledger delete blocked');
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Suspended accounts cannot reserve
  UPDATE billing_accounts SET status = 'suspended' WHERE id = b;
  PERFORM billing_admin_adjust(b, 5, 'Credits for suspended test', admin, 'k5');
  BEGIN PERFORM billing_reserve(pg_temp.new_event(b, 'req-b'), 1); PERFORM pg_temp.expect(false, 'suspended account blocked');
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Client access: owners read their own rows only; no client writes or function calls.
SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
DO $$ BEGIN
  PERFORM pg_temp.expect((SELECT count(*) FROM credit_wallets) = 1, 'employer sees only own wallet');
  PERFORM pg_temp.expect((SELECT count(*) FROM ai_usage_events WHERE request_id LIKE 'req-%' AND request_id <> 'req-b') = 0, 'no cross-tenant usage');
END $$;
DO $$ BEGIN
  BEGIN UPDATE credit_wallets SET available = 999; PERFORM pg_temp.expect(false, 'client wallet update blocked');
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM billing_admin_adjust(gen_random_uuid(), 5, 'self service grant', gen_random_uuid(), 'x'); PERFORM pg_temp.expect(false, 'client cannot call adjust');
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM ai_model_pricing; PERFORM pg_temp.expect(false, 'pricing not client-readable');
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM credit_wallets; PERFORM pg_temp.expect(false, 'anon blocked');
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

\echo ALL BILLING TESTS PASSED
