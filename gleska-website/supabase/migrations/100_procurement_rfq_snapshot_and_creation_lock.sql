BEGIN;

ALTER TABLE public.procurement_rfq_idempotency_attempts
  ADD COLUMN requirement_snapshot_version INTEGER NOT NULL DEFAULT 1
    CHECK (requirement_snapshot_version IN (0, 1)),
  ADD COLUMN material_request_id UUID,
  ADD COLUMN requirement_revision INTEGER,
  ADD COLUMN requirement_snapshot JSONB,
  ADD COLUMN payload_hash TEXT
    CHECK (payload_hash IS NULL OR payload_hash ~ '^[0-9a-f]{64}$');

UPDATE public.procurement_rfq_idempotency_attempts
SET requirement_snapshot_version = 0
WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION public.capture_procurement_rfq_requirement_snapshot(
  p_user_id UUID,
  p_employer_id UUID,
  p_idempotency_key UUID,
  p_request_fingerprint TEXT,
  p_material_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.procurement_rfq_idempotency_attempts%ROWTYPE;
  v_request public.procurement_material_requests%ROWTYPE;
  v_snapshot JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    OR p_idempotency_key IS NULL
    OR p_material_request_id IS NULL
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
  IF v_attempt.status <> 'PENDING' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'status', v_attempt.status,
      'rfq_id', v_attempt.rfq_id,
      'error_code', v_attempt.error_code
    );
  END IF;

  IF v_attempt.requirement_snapshot_version = 0 THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_SNAPSHOT_UNAVAILABLE',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key
    RETURNING * INTO v_attempt;
    RETURN jsonb_build_object(
      'ok', TRUE, 'status', v_attempt.status, 'error_code', v_attempt.error_code
    );
  END IF;

  SELECT *
  INTO v_request
  FROM public.procurement_material_requests
  WHERE id = p_material_request_id
    AND employer_id = p_employer_id
    AND user_id = p_user_id
  FOR SHARE;
  IF NOT FOUND THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        material_request_id = p_material_request_id,
        error_code = 'MATERIAL_REQUEST_NOT_FOUND',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key
    RETURNING * INTO v_attempt;
    RETURN jsonb_build_object(
      'ok', TRUE, 'status', v_attempt.status, 'error_code', v_attempt.error_code
    );
  END IF;

  v_snapshot := jsonb_build_object(
    'material_request_id', v_request.id,
    'revision', v_request.revision,
    'item_name', v_request.item_name,
    'specification', v_request.specification,
    'quantity', v_request.quantity,
    'unit', v_request.unit,
    'delivery_location', v_request.delivery_location
  );

  IF v_attempt.requirement_snapshot IS NULL THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET material_request_id = p_material_request_id,
        requirement_revision = v_request.revision,
        requirement_snapshot = v_snapshot,
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key
    RETURNING * INTO v_attempt;
  ELSIF v_attempt.material_request_id IS DISTINCT FROM p_material_request_id
    OR v_attempt.requirement_revision IS DISTINCT FROM v_request.revision
    OR v_attempt.requirement_snapshot IS DISTINCT FROM v_snapshot THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_CHANGED',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key
    RETURNING * INTO v_attempt;
    RETURN jsonb_build_object(
      'ok', TRUE, 'status', v_attempt.status, 'error_code', v_attempt.error_code
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'status', v_attempt.status,
    'requirement_snapshot', v_attempt.requirement_snapshot
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_procurement_rfq_attempt_payload(
  p_user_id UUID,
  p_employer_id UUID,
  p_idempotency_key UUID,
  p_request_fingerprint TEXT,
  p_material_request_id UUID,
  p_requirement_revision INTEGER,
  p_payload_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.procurement_rfq_idempotency_attempts%ROWTYPE;
  v_request public.procurement_material_requests%ROWTYPE;
  v_snapshot JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    OR p_idempotency_key IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_payload_hash IS NULL
    OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
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
  IF v_attempt.status <> 'PENDING' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'status', v_attempt.status,
      'rfq_id', v_attempt.rfq_id,
      'error_code', v_attempt.error_code
    );
  END IF;
  IF v_attempt.requirement_snapshot_version = 0
    OR v_attempt.material_request_id IS DISTINCT FROM p_material_request_id
    OR v_attempt.requirement_revision IS DISTINCT FROM p_requirement_revision
    OR v_attempt.requirement_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_REQUIREMENT_SNAPSHOT_UNAVAILABLE');
  END IF;

  SELECT *
  INTO v_request
  FROM public.procurement_material_requests
  WHERE id = p_material_request_id
    AND employer_id = p_employer_id
    AND user_id = p_user_id
  FOR SHARE;
  IF NOT FOUND THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_CHANGED',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', TRUE, 'status', 'NOT_CREATED', 'error_code', 'RFQ_REQUIREMENT_CHANGED');
  END IF;

  v_snapshot := jsonb_build_object(
    'material_request_id', v_request.id,
    'revision', v_request.revision,
    'item_name', v_request.item_name,
    'specification', v_request.specification,
    'quantity', v_request.quantity,
    'unit', v_request.unit,
    'delivery_location', v_request.delivery_location
  );
  IF v_request.revision IS DISTINCT FROM v_attempt.requirement_revision
    OR v_snapshot IS DISTINCT FROM v_attempt.requirement_snapshot THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_CHANGED',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', TRUE, 'status', 'NOT_CREATED', 'error_code', 'RFQ_REQUIREMENT_CHANGED');
  END IF;

  IF v_attempt.payload_hash IS NOT NULL
    AND v_attempt.payload_hash <> p_payload_hash THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;
  UPDATE public.procurement_rfq_idempotency_attempts
  SET payload_hash = p_payload_hash,
      updated_at = NOW()
  WHERE employer_id = p_employer_id
    AND idempotency_key = p_idempotency_key;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'PENDING');
END;
$$;

ALTER FUNCTION public.create_procurement_rfq(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) RENAME TO create_procurement_rfq_unlocked;

REVOKE ALL ON FUNCTION public.create_procurement_rfq_unlocked(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_procurement_rfq(
  p_user_id UUID,
  p_employer_id UUID,
  p_material_request_id UUID,
  p_idempotency_key UUID,
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
  v_request public.procurement_material_requests%ROWTYPE;
  v_snapshot JSONB;
  v_result JSONB;
  v_rfq_id UUID;
  v_error_code TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    OR p_idempotency_key IS NULL
    OR p_payload_hash IS NULL
    OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
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
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;
  IF v_attempt.status = 'SUCCEEDED' THEN
    IF v_attempt.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('ok', TRUE, 'rfq_id', v_attempt.rfq_id);
  END IF;
  IF v_attempt.status = 'NOT_CREATED' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'error_code', 'RFQ_ATTEMPT_NOT_CREATED',
      'attempt_error_code', v_attempt.error_code
    );
  END IF;
  IF v_attempt.requirement_snapshot_version = 0
    OR v_attempt.material_request_id IS DISTINCT FROM p_material_request_id
    OR v_attempt.requirement_revision IS NULL
    OR v_attempt.requirement_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_REQUIREMENT_SNAPSHOT_UNAVAILABLE');
  END IF;
  IF v_attempt.payload_hash IS NULL
    OR v_attempt.payload_hash <> p_payload_hash THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;

  SELECT *
  INTO v_request
  FROM public.procurement_material_requests
  WHERE id = p_material_request_id
    AND employer_id = p_employer_id
    AND user_id = p_user_id
  FOR SHARE;
  IF NOT FOUND THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_CHANGED',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_REQUIREMENT_CHANGED');
  END IF;

  v_snapshot := jsonb_build_object(
    'material_request_id', v_request.id,
    'revision', v_request.revision,
    'item_name', v_request.item_name,
    'specification', v_request.specification,
    'quantity', v_request.quantity,
    'unit', v_request.unit,
    'delivery_location', v_request.delivery_location
  );
  IF v_request.revision IS DISTINCT FROM v_attempt.requirement_revision
    OR v_snapshot IS DISTINCT FROM v_attempt.requirement_snapshot
    OR v_attempt.requirement_snapshot ->> 'item_name' IS DISTINCT FROM p_item_name
    OR v_attempt.requirement_snapshot ->> 'specification' IS DISTINCT FROM p_specification
    OR NULLIF(v_attempt.requirement_snapshot ->> 'quantity', '')::NUMERIC
      IS DISTINCT FROM p_quantity
    OR v_attempt.requirement_snapshot ->> 'unit' IS DISTINCT FROM p_unit THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_CHANGED',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_REQUIREMENT_CHANGED');
  END IF;

  UPDATE public.procurement_rfq_idempotency_attempts
  SET payload_hash = p_payload_hash,
      updated_at = NOW()
  WHERE employer_id = p_employer_id
    AND idempotency_key = p_idempotency_key;

  v_result := public.create_procurement_rfq_unlocked(
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

CREATE OR REPLACE FUNCTION public.create_procurement_rfq_with_attempt(
  p_user_id UUID,
  p_employer_id UUID,
  p_material_request_id UUID,
  p_idempotency_key UUID,
  p_request_fingerprint TEXT,
  p_requirement_revision INTEGER,
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
  v_request public.procurement_material_requests%ROWTYPE;
  v_snapshot JSONB;
  v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    OR p_idempotency_key IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_payload_hash IS NULL
    OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
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
  IF v_attempt.requirement_snapshot_version = 0
    OR v_attempt.material_request_id IS DISTINCT FROM p_material_request_id
    OR v_attempt.requirement_revision IS DISTINCT FROM p_requirement_revision
    OR v_attempt.requirement_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_REQUIREMENT_SNAPSHOT_UNAVAILABLE');
  END IF;
  IF v_attempt.payload_hash IS NOT NULL
    AND v_attempt.payload_hash <> p_payload_hash THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;
  SELECT *
  INTO v_request
  FROM public.procurement_material_requests
  WHERE id = p_material_request_id
    AND employer_id = p_employer_id
    AND user_id = p_user_id
  FOR SHARE;
  IF NOT FOUND THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_CHANGED',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_REQUIREMENT_CHANGED');
  END IF;

  v_snapshot := jsonb_build_object(
    'material_request_id', v_request.id,
    'revision', v_request.revision,
    'item_name', v_request.item_name,
    'specification', v_request.specification,
    'quantity', v_request.quantity,
    'unit', v_request.unit,
    'delivery_location', v_request.delivery_location
  );
  IF v_request.revision IS DISTINCT FROM v_attempt.requirement_revision
    OR v_snapshot IS DISTINCT FROM v_attempt.requirement_snapshot THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_CHANGED',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_REQUIREMENT_CHANGED');
  END IF;

  UPDATE public.procurement_rfq_idempotency_attempts
  SET payload_hash = p_payload_hash,
      updated_at = NOW()
  WHERE employer_id = p_employer_id
    AND idempotency_key = p_idempotency_key;

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
  RETURN v_result;
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
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
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

  RETURN jsonb_build_object(
    'ok', FALSE,
    'error_code', 'RFQ_REQUIREMENT_SNAPSHOT_UNAVAILABLE'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.capture_procurement_rfq_requirement_snapshot(
  UUID, UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_procurement_rfq_requirement_snapshot(
  UUID, UUID, UUID, TEXT, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.prepare_procurement_rfq_attempt_payload(
  UUID, UUID, UUID, TEXT, UUID, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_procurement_rfq_attempt_payload(
  UUID, UUID, UUID, TEXT, UUID, INTEGER, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.create_procurement_rfq(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_procurement_rfq(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.create_procurement_rfq_with_attempt(
  UUID, UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_procurement_rfq_with_attempt(
  UUID, UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;
REVOKE ALL ON FUNCTION public.create_procurement_rfq_with_attempt(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_procurement_rfq_with_attempt(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;

COMMIT;
