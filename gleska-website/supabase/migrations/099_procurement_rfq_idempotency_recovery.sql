BEGIN;

CREATE TABLE public.procurement_rfq_idempotency_attempts (
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SUCCEEDED', 'NOT_CREATED')),
  rfq_id UUID REFERENCES public.procurement_rfqs(id) ON DELETE CASCADE,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employer_id, idempotency_key),
  CHECK (
    (status = 'PENDING' AND rfq_id IS NULL AND error_code IS NULL)
    OR (status = 'SUCCEEDED' AND rfq_id IS NOT NULL AND error_code IS NULL)
    OR (status = 'NOT_CREATED' AND rfq_id IS NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX procurement_rfq_attempts_owner_pending_idx
  ON public.procurement_rfq_idempotency_attempts(user_id, employer_id, created_at DESC)
  WHERE status = 'PENDING';

ALTER TABLE public.procurement_rfq_idempotency_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.procurement_rfq_idempotency_attempts
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.procurement_rfq_idempotency_attempts TO service_role;
CREATE POLICY "Service role can access Procurement RFQ idempotency attempts"
  ON public.procurement_rfq_idempotency_attempts FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.begin_procurement_rfq_attempt(
  p_user_id UUID,
  p_employer_id UUID,
  p_idempotency_key UUID,
  p_request_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.procurement_rfq_idempotency_attempts%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    OR p_idempotency_key IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ATTEMPT_INVALID');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employer_profiles ep
    WHERE ep.id = p_employer_id
      AND ep.user_id = p_user_id
      AND ep.onboarding_status = 'COMPLETED'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  INSERT INTO public.procurement_rfq_idempotency_attempts (
    employer_id, user_id, idempotency_key, request_fingerprint
  )
  VALUES (
    p_employer_id, p_user_id, p_idempotency_key, p_request_fingerprint
  )
  ON CONFLICT (employer_id, idempotency_key) DO NOTHING;

  SELECT *
  INTO v_attempt
  FROM public.procurement_rfq_idempotency_attempts
  WHERE employer_id = p_employer_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND OR v_attempt.user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;
  IF v_attempt.request_fingerprint <> p_request_fingerprint THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'status', v_attempt.status,
    'rfq_id', v_attempt.rfq_id,
    'error_code', v_attempt.error_code,
    'created_at', v_attempt.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_procurement_rfq_attempt_not_created(
  p_user_id UUID,
  p_employer_id UUID,
  p_idempotency_key UUID,
  p_request_fingerprint TEXT,
  p_error_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.procurement_rfq_idempotency_attempts%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    OR p_idempotency_key IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_error_code IS NULL
    OR length(trim(p_error_code)) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.employer_profiles ep
    WHERE ep.id = p_employer_id
      AND ep.user_id = p_user_id
      AND ep.onboarding_status = 'COMPLETED'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT *
  INTO v_attempt
  FROM public.procurement_rfq_idempotency_attempts
  WHERE employer_id = p_employer_id
    AND user_id = p_user_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.request_fingerprint <> p_request_fingerprint THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;

  IF v_attempt.status = 'PENDING' THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = p_error_code,
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key
    RETURNING * INTO v_attempt;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'status', v_attempt.status,
    'rfq_id', v_attempt.rfq_id,
    'error_code', v_attempt.error_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_procurement_rfq_with_attempt(
  p_user_id UUID,
  p_employer_id UUID,
  p_material_request_id UUID,
  p_idempotency_key UUID,
  p_request_fingerprint TEXT,
  p_payload_hash TEXT,
  p_item_name TEXT,
  p_specification TEXT,
  p_quantity NUMERIC,
  p_unit TEXT,
  p_delivery_location TEXT,
  p_quotation_deadline TIMESTAMPTZ,
  p_buyer_notes TEXT,
  p_recipients JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.procurement_rfq_idempotency_attempts%ROWTYPE;
  v_result JSONB;
  v_rfq_id UUID;
  v_error_code TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    OR p_idempotency_key IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.employer_profiles ep
    WHERE ep.id = p_employer_id
      AND ep.user_id = p_user_id
      AND ep.onboarding_status = 'COMPLETED'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT *
  INTO v_attempt
  FROM public.procurement_rfq_idempotency_attempts
  WHERE employer_id = p_employer_id
    AND user_id = p_user_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.request_fingerprint <> p_request_fingerprint THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;
  IF v_attempt.status = 'SUCCEEDED' THEN
    RETURN jsonb_build_object('ok', TRUE, 'rfq_id', v_attempt.rfq_id);
  END IF;
  IF v_attempt.status = 'NOT_CREATED' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'error_code', 'RFQ_ATTEMPT_NOT_CREATED',
      'attempt_error_code', v_attempt.error_code
    );
  END IF;

  v_result := public.create_procurement_rfq(
    p_user_id,
    p_employer_id,
    p_material_request_id,
    p_idempotency_key,
    p_payload_hash,
    p_item_name,
    p_specification,
    p_quantity,
    p_unit,
    p_delivery_location,
    p_quotation_deadline,
    p_buyer_notes,
    p_recipients
  );

  IF v_result ->> 'ok' = 'true' THEN
    v_rfq_id := (v_result ->> 'rfq_id')::UUID;
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'SUCCEEDED',
        rfq_id = v_rfq_id,
        error_code = NULL,
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
  ELSE
    v_error_code := v_result ->> 'error_code';
    IF v_error_code IN (
      'MATERIAL_REQUEST_NOT_FOUND',
      'RFQ_DEADLINE_INVALID',
      'RFQ_SUPPLIER_INELIGIBLE',
      'RFQ_RECIPIENTS_INVALID',
      'RFQ_IDEMPOTENCY_CONFLICT'
    ) THEN
      UPDATE public.procurement_rfq_idempotency_attempts
      SET status = 'NOT_CREATED',
          error_code = v_error_code,
          updated_at = NOW()
      WHERE employer_id = p_employer_id
        AND idempotency_key = p_idempotency_key;
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_procurement_rfq_attempt(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_procurement_rfq_attempt(UUID, UUID, UUID, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.mark_procurement_rfq_attempt_not_created(UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_procurement_rfq_attempt_not_created(UUID, UUID, UUID, TEXT, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.create_procurement_rfq_with_attempt(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_procurement_rfq_with_attempt(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;

COMMIT;
