-- AI billing core: billing accounts, credit wallets, append-only ledger, reservations,
-- versioned model pricing / settings / FX, AI usage events and audit log (ADR 0007).
--
-- RLS impact: new tables only, RLS enabled on all. Employers may SELECT their own account's
--   wallet, ledger, reservations and usage; pricing/settings/FX/audit are not client-readable.
--   All writes go through the backend (service_role) and the SECURITY DEFINER functions below.
-- Data impact: additive; no existing table changes. Seeds billing_settings v1
--   (₹20 per credit, multiplier 1.10). No model prices or FX rates are seeded on purpose.
-- Money: NUMERIC everywhere, no floats. Ledger rows are immutable (trigger).
-- Rollback: drop the functions, then the tables in reverse dependency order. That destroys
--   financial history and must never be done once real credits exist without an export.

BEGIN;

-- ---------------------------------------------------------------- configuration (versioned)

CREATE TABLE IF NOT EXISTS public.billing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE CHECK (version > 0),
  credit_value_inr NUMERIC(12,4) NOT NULL CHECK (credit_value_inr > 0),
  markup_multiplier NUMERIC(8,4) NOT NULL CHECK (markup_multiplier >= 1),
  default_max_output_tokens INTEGER NOT NULL DEFAULT 8192 CHECK (default_max_output_tokens > 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.billing_settings (version, credit_value_inr, markup_multiplier, reason)
VALUES (1, 20, 1.10, 'Initial commercial rules: 1 credit = INR 20, multiplier 1.10')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fx_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency TEXT NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency TEXT NOT NULL DEFAULT 'INR' CHECK (quote_currency ~ '^[A-Z]{3}$'),
  rate NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_effective
  ON public.fx_rates(base_currency, quote_currency, effective_from DESC);

-- Prices are per 1,000,000 tokens in `currency`. NULL optional prices mean "not separately
-- billed": cached input falls back to input, thinking to output, audio input to input.
CREATE TABLE IF NOT EXISTS public.ai_model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z0-9_-]{2,40}$'),
  model TEXT NOT NULL CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  version INTEGER NOT NULL CHECK (version > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  input_price NUMERIC(18,8) NOT NULL CHECK (input_price >= 0),
  output_price NUMERIC(18,8) NOT NULL CHECK (output_price >= 0),
  cached_input_price NUMERIC(18,8) CHECK (cached_input_price >= 0),
  thinking_price NUMERIC(18,8) CHECK (thinking_price >= 0),
  audio_input_price NUMERIC(18,8) CHECK (audio_input_price >= 0),
  -- Optional long-context tier: prompts above the threshold use the *_above prices.
  tier_threshold_tokens INTEGER CHECK (tier_threshold_tokens > 0),
  input_price_above NUMERIC(18,8) CHECK (input_price_above >= 0),
  output_price_above NUMERIC(18,8) CHECK (output_price_above >= 0),
  cached_input_price_above NUMERIC(18,8) CHECK (cached_input_price_above >= 0),
  max_output_tokens INTEGER CHECK (max_output_tokens > 0),
  source_note TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_model_pricing_version_unique UNIQUE (provider, model, version),
  CONSTRAINT ai_model_pricing_tier_complete CHECK (
    tier_threshold_tokens IS NULL OR (input_price_above IS NOT NULL AND output_price_above IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_ai_model_pricing_lookup
  ON public.ai_model_pricing(provider, model, effective_from DESC);

-- ---------------------------------------------------------------- accounts and money

CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kept (SET NULL) if the employer is deleted: financial history must survive.
  employer_id UUID UNIQUE REFERENCES public.employer_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.credit_wallets (
  account_id UUID PRIMARY KEY REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  available NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  total_purchased NUMERIC(20,6) NOT NULL DEFAULT 0,
  total_consumed NUMERIC(20,6) NOT NULL DEFAULT 0,
  total_refunded NUMERIC(20,6) NOT NULL DEFAULT 0,
  total_adjusted NUMERIC(20,6) NOT NULL DEFAULT 0,
  total_unrecovered NUMERIC(20,6) NOT NULL DEFAULT 0,
  last_transaction_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL UNIQUE,
  account_id UUID NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  initiating_agent TEXT NOT NULL,
  executing_agent TEXT NOT NULL,
  operation TEXT NOT NULL,
  conversation_id TEXT,
  parent_task_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  pricing_id UUID REFERENCES public.ai_model_pricing(id),
  settings_id UUID REFERENCES public.billing_settings(id),
  fx_rate_id UUID REFERENCES public.fx_rates(id),
  status TEXT NOT NULL CHECK (status IN (
    'reserved', 'succeeded', 'failed', 'rejected', 'pending_reconciliation'
  )),
  usage_status TEXT NOT NULL DEFAULT 'unavailable' CHECK (usage_status IN ('confirmed', 'estimated', 'unavailable')),
  input_tokens BIGINT CHECK (input_tokens >= 0),
  cached_input_tokens BIGINT CHECK (cached_input_tokens >= 0),
  output_tokens BIGINT CHECK (output_tokens >= 0),
  thinking_tokens BIGINT CHECK (thinking_tokens >= 0),
  audio_input_tokens BIGINT CHECK (audio_input_tokens >= 0),
  total_tokens BIGINT CHECK (total_tokens >= 0),
  provider_request_id TEXT,
  provider_cost NUMERIC(20,8) CHECK (provider_cost >= 0),
  provider_currency TEXT,
  fx_rate NUMERIC(18,8),
  provider_cost_inr NUMERIC(20,4) CHECK (provider_cost_inr >= 0),
  customer_charge_inr NUMERIC(20,4) CHECK (customer_charge_inr >= 0),
  credits_reserved NUMERIC(20,6) CHECK (credits_reserved >= 0),
  credits_charged NUMERIC(20,6) CHECK (credits_charged >= 0),
  credits_unrecovered NUMERIC(20,6) CHECK (credits_unrecovered >= 0),
  error_code TEXT,
  latency_ms INTEGER CHECK (latency_ms >= 0),
  raw_usage JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_account_started
  ON public.ai_usage_events(account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_agent ON public.ai_usage_events(account_id, executing_agent, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_status ON public.ai_usage_events(status) WHERE status <> 'succeeded';

CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  usage_event_id UUID NOT NULL UNIQUE REFERENCES public.ai_usage_events(id) ON DELETE RESTRICT,
  amount NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'settled', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_held
  ON public.credit_reservations(account_id, created_at) WHERE status = 'held';

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'purchase', 'reserve', 'release', 'settle', 'refund', 'adjustment'
  )),
  delta_available NUMERIC(20,6) NOT NULL,
  delta_reserved NUMERIC(20,6) NOT NULL DEFAULT 0,
  available_before NUMERIC(20,6) NOT NULL,
  available_after NUMERIC(20,6) NOT NULL CHECK (available_after >= 0),
  reserved_before NUMERIC(20,6) NOT NULL,
  reserved_after NUMERIC(20,6) NOT NULL CHECK (reserved_after >= 0),
  credits_consumed NUMERIC(20,6) NOT NULL DEFAULT 0,
  credits_unrecovered NUMERIC(20,6) NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT credit_ledger_balance_math CHECK (
    available_after = available_before + delta_available
    AND reserved_after = reserved_before + delta_reserved
  )
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_account_created ON public.credit_ledger(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Financial history is append-only for every role, service_role included.
CREATE OR REPLACE FUNCTION public.billing_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS credit_ledger_append_only ON public.credit_ledger;
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.billing_forbid_mutation();
DROP TRIGGER IF EXISTS billing_audit_logs_append_only ON public.billing_audit_logs;
CREATE TRIGGER billing_audit_logs_append_only BEFORE UPDATE OR DELETE ON public.billing_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.billing_forbid_mutation();

-- ---------------------------------------------------------------- functions (service_role only)

CREATE OR REPLACE FUNCTION public.billing_ensure_account(p_employer_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account UUID;
BEGIN
  INSERT INTO billing_accounts (employer_id) VALUES (p_employer_id)
  ON CONFLICT (employer_id) DO NOTHING;
  SELECT id INTO v_account FROM billing_accounts WHERE employer_id = p_employer_id;
  INSERT INTO credit_wallets (account_id) VALUES (v_account) ON CONFLICT (account_id) DO NOTHING;
  RETURN v_account;
END $$;

-- Hold credits for a usage event. Idempotent per usage event.
CREATE OR REPLACE FUNCTION public.billing_reserve(p_usage_event_id UUID, p_amount NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event ai_usage_events%ROWTYPE;
  v_wallet credit_wallets%ROWTYPE;
  v_status TEXT;
  v_reservation UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'BILLING_INVALID_AMOUNT' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_event FROM ai_usage_events WHERE id = p_usage_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND'; END IF;

  SELECT id INTO v_reservation FROM credit_reservations WHERE usage_event_id = p_usage_event_id;
  IF FOUND THEN RETURN v_reservation; END IF;

  SELECT status INTO v_status FROM billing_accounts WHERE id = v_event.account_id;
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'BILLING_ACCOUNT_SUSPENDED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_wallet FROM credit_wallets WHERE account_id = v_event.account_id FOR UPDATE;
  IF v_wallet.available < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE credit_wallets
     SET available = available - p_amount, reserved = reserved + p_amount,
         last_transaction_at = NOW(), updated_at = NOW()
   WHERE account_id = v_event.account_id;
  INSERT INTO credit_reservations (account_id, usage_event_id, amount)
  VALUES (v_event.account_id, p_usage_event_id, p_amount) RETURNING id INTO v_reservation;
  INSERT INTO credit_ledger (account_id, entry_type, delta_available, delta_reserved,
    available_before, available_after, reserved_before, reserved_after,
    reference_type, reference_id, idempotency_key, description)
  VALUES (v_event.account_id, 'reserve', -p_amount, p_amount,
    v_wallet.available, v_wallet.available - p_amount, v_wallet.reserved, v_wallet.reserved + p_amount,
    'ai_usage_event', p_usage_event_id::text, 'reserve:' || p_usage_event_id, 'AI request reservation');
  UPDATE ai_usage_events SET credits_reserved = p_amount WHERE id = p_usage_event_id;
  RETURN v_reservation;
END $$;

-- Close a held reservation: charge p_charge credits (0 = release). If the charge exceeds the
-- reservation, the extra comes from the available balance down to zero; anything left is
-- recorded as unrecovered (owner policy). Applies p_event fields to the usage event atomically.
-- Idempotent: a closed reservation returns without changes.
CREATE OR REPLACE FUNCTION public.billing_settle(
  p_usage_event_id UUID, p_charge NUMERIC, p_event JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res credit_reservations%ROWTYPE;
  v_wallet credit_wallets%ROWTYPE;
  v_extra NUMERIC := 0;
  v_taken NUMERIC := 0;
  v_charged NUMERIC;
  v_unrecovered NUMERIC := 0;
  v_delta_available NUMERIC;
  v_type TEXT;
BEGIN
  IF p_charge IS NULL OR p_charge < 0 THEN
    RAISE EXCEPTION 'BILLING_INVALID_AMOUNT' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_res FROM credit_reservations WHERE usage_event_id = p_usage_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_RESERVATION_NOT_FOUND'; END IF;
  IF v_res.status <> 'held' THEN
    RETURN jsonb_build_object('status', v_res.status, 'idempotent', true);
  END IF;

  SELECT * INTO v_wallet FROM credit_wallets WHERE account_id = v_res.account_id FOR UPDATE;
  IF p_charge > v_res.amount THEN
    v_extra := p_charge - v_res.amount;
    v_taken := LEAST(v_extra, v_wallet.available);
    v_unrecovered := v_extra - v_taken;
  END IF;
  v_charged := LEAST(p_charge, v_res.amount) + v_taken;
  v_delta_available := v_res.amount - LEAST(p_charge, v_res.amount) - v_taken;
  v_type := CASE WHEN p_charge = 0 THEN 'release' ELSE 'settle' END;

  UPDATE credit_wallets
     SET available = available + v_delta_available,
         reserved = reserved - v_res.amount,
         total_consumed = total_consumed + v_charged,
         total_unrecovered = total_unrecovered + v_unrecovered,
         last_transaction_at = NOW(), updated_at = NOW()
   WHERE account_id = v_res.account_id;
  UPDATE credit_reservations
     SET status = CASE WHEN p_charge = 0 THEN 'released' ELSE 'settled' END, closed_at = NOW()
   WHERE id = v_res.id;
  INSERT INTO credit_ledger (account_id, entry_type, delta_available, delta_reserved,
    available_before, available_after, reserved_before, reserved_after,
    credits_consumed, credits_unrecovered, reference_type, reference_id, idempotency_key, description)
  VALUES (v_res.account_id, v_type, v_delta_available, -v_res.amount,
    v_wallet.available, v_wallet.available + v_delta_available, v_wallet.reserved, v_wallet.reserved - v_res.amount,
    v_charged, v_unrecovered, 'ai_usage_event', p_usage_event_id::text,
    v_type || ':' || p_usage_event_id,
    CASE WHEN p_charge = 0 THEN 'AI request reservation released' ELSE 'AI request charged' END);

  UPDATE ai_usage_events SET
    status = COALESCE(p_event->>'status', status),
    usage_status = COALESCE(p_event->>'usage_status', usage_status),
    input_tokens = COALESCE((p_event->>'input_tokens')::bigint, input_tokens),
    cached_input_tokens = COALESCE((p_event->>'cached_input_tokens')::bigint, cached_input_tokens),
    output_tokens = COALESCE((p_event->>'output_tokens')::bigint, output_tokens),
    thinking_tokens = COALESCE((p_event->>'thinking_tokens')::bigint, thinking_tokens),
    audio_input_tokens = COALESCE((p_event->>'audio_input_tokens')::bigint, audio_input_tokens),
    total_tokens = COALESCE((p_event->>'total_tokens')::bigint, total_tokens),
    provider_request_id = COALESCE(p_event->>'provider_request_id', provider_request_id),
    provider_cost = COALESCE((p_event->>'provider_cost')::numeric, provider_cost),
    provider_currency = COALESCE(p_event->>'provider_currency', provider_currency),
    fx_rate = COALESCE((p_event->>'fx_rate')::numeric, fx_rate),
    provider_cost_inr = COALESCE((p_event->>'provider_cost_inr')::numeric, provider_cost_inr),
    customer_charge_inr = COALESCE((p_event->>'customer_charge_inr')::numeric, customer_charge_inr),
    error_code = COALESCE(p_event->>'error_code', error_code),
    latency_ms = COALESCE((p_event->>'latency_ms')::integer, latency_ms),
    raw_usage = COALESCE(p_event->'raw_usage', raw_usage),
    credits_charged = v_charged,
    credits_unrecovered = v_unrecovered,
    completed_at = NOW()
  WHERE id = p_usage_event_id;

  RETURN jsonb_build_object('status', v_type, 'charged', v_charged, 'unrecovered', v_unrecovered);
END $$;

-- Administrative credit/debit with a mandatory reason, attributed to an admin, idempotent.
CREATE OR REPLACE FUNCTION public.billing_admin_adjust(
  p_account_id UUID, p_delta NUMERIC, p_reason TEXT, p_actor UUID, p_idempotency_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet credit_wallets%ROWTYPE;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN RAISE EXCEPTION 'BILLING_INVALID_AMOUNT'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN RAISE EXCEPTION 'BILLING_REASON_REQUIRED'; END IF;
  IF p_actor IS NULL OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'BILLING_ACTOR_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM credit_ledger WHERE idempotency_key = 'adjust:' || p_idempotency_key) THEN
    RETURN jsonb_build_object('status', 'adjustment', 'idempotent', true);
  END IF;
  SELECT * INTO v_wallet FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_ACCOUNT_NOT_FOUND'; END IF;
  IF v_wallet.available + p_delta < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE credit_wallets SET available = available + p_delta, total_adjusted = total_adjusted + p_delta,
         last_transaction_at = NOW(), updated_at = NOW()
   WHERE account_id = p_account_id;
  INSERT INTO credit_ledger (account_id, entry_type, delta_available, available_before, available_after,
    reserved_before, reserved_after, reference_type, idempotency_key, description, actor_user_id)
  VALUES (p_account_id, 'adjustment', p_delta, v_wallet.available, v_wallet.available + p_delta,
    v_wallet.reserved, v_wallet.reserved, 'admin', 'adjust:' || p_idempotency_key, btrim(p_reason), p_actor);
  INSERT INTO billing_audit_logs (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor, 'credit_adjustment', 'billing_account', p_account_id::text,
          jsonb_build_object('delta', p_delta, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('status', 'adjustment', 'available', v_wallet.available + p_delta);
END $$;

-- ---------------------------------------------------------------- privileges and RLS

ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.billing_settings, public.fx_rates, public.ai_model_pricing, public.billing_accounts,
  public.credit_wallets, public.ai_usage_events, public.credit_reservations, public.credit_ledger,
  public.billing_audit_logs FROM anon, authenticated;
GRANT SELECT ON public.billing_accounts, public.credit_wallets, public.ai_usage_events,
  public.credit_reservations, public.credit_ledger TO authenticated;
GRANT ALL ON public.billing_settings, public.fx_rates, public.ai_model_pricing, public.billing_accounts,
  public.credit_wallets, public.ai_usage_events, public.credit_reservations, public.credit_ledger,
  public.billing_audit_logs TO service_role;

CREATE OR REPLACE FUNCTION public.billing_account_owned(p_account_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM billing_accounts a JOIN employer_profiles e ON e.id = a.employer_id
    WHERE a.id = p_account_id AND e.user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "Employers read own billing account" ON public.billing_accounts;
CREATE POLICY "Employers read own billing account" ON public.billing_accounts
  FOR SELECT TO authenticated USING (public.billing_account_owned(id));
DROP POLICY IF EXISTS "Employers read own wallet" ON public.credit_wallets;
CREATE POLICY "Employers read own wallet" ON public.credit_wallets
  FOR SELECT TO authenticated USING (public.billing_account_owned(account_id));
DROP POLICY IF EXISTS "Employers read own usage" ON public.ai_usage_events;
CREATE POLICY "Employers read own usage" ON public.ai_usage_events
  FOR SELECT TO authenticated USING (public.billing_account_owned(account_id));
DROP POLICY IF EXISTS "Employers read own reservations" ON public.credit_reservations;
CREATE POLICY "Employers read own reservations" ON public.credit_reservations
  FOR SELECT TO authenticated USING (public.billing_account_owned(account_id));
DROP POLICY IF EXISTS "Employers read own ledger" ON public.credit_ledger;
CREATE POLICY "Employers read own ledger" ON public.credit_ledger
  FOR SELECT TO authenticated USING (public.billing_account_owned(account_id));

REVOKE ALL ON FUNCTION public.billing_ensure_account(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_reserve(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_settle(UUID, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_admin_adjust(UUID, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_forbid_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_account_owned(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_ensure_account(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_reserve(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_settle(UUID, NUMERIC, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_admin_adjust(UUID, NUMERIC, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_account_owned(UUID) TO authenticated, service_role;

COMMIT;
