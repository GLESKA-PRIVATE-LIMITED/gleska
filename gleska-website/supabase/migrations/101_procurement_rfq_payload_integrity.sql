BEGIN;

ALTER TABLE public.procurement_rfq_idempotency_attempts
  ADD COLUMN canonical_payload JSONB;

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.procurement_rfq_idempotency_attempts
  FROM service_role;
GRANT SELECT
  ON TABLE public.procurement_rfq_idempotency_attempts
  TO service_role;

UPDATE public.procurement_rfq_idempotency_attempts
SET payload_hash = NULL
WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION public.procurement_rfq_canonical_payload(
  p_material_request_id UUID,
  p_requirement_revision INTEGER,
  p_item_name TEXT,
  p_specification TEXT,
  p_quantity NUMERIC,
  p_unit TEXT,
  p_delivery_location TEXT,
  p_quotation_deadline TIMESTAMPTZ,
  p_buyer_notes TEXT,
  p_requirement_snapshot JSONB,
  p_recipients JSONB
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  WITH recipient_rows AS (
    SELECT
      value ->> 'company_id' AS company_id,
      value ->> 'offering_id' AS offering_id
    FROM jsonb_array_elements(p_recipients)
  ),
  normalized_recipients AS (
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'company_id', company_id,
            'offering_id', offering_id
          )
          ORDER BY company_id
        ),
        '[]'::JSONB
      ) AS recipients,
      COALESCE(
        jsonb_agg(to_jsonb(company_id) ORDER BY company_id),
        '[]'::JSONB
      ) AS supplier_company_ids
    FROM recipient_rows
  )
  SELECT jsonb_build_object(
    'material_request_id', p_material_request_id::TEXT,
    'requirement_revision', p_requirement_revision,
    'item_name', p_item_name,
    'specification', p_specification,
    'quantity', trim_scale(p_quantity)::TEXT,
    'unit', p_unit,
    'delivery_location', p_delivery_location,
    'quotation_deadline',
      to_char(
        p_quotation_deadline AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US'
      ) || '+00:00',
    'buyer_notes', p_buyer_notes,
    'requirement_snapshot', p_requirement_snapshot,
    'supplier_company_ids', normalized_recipients.supplier_company_ids,
    'recipients', normalized_recipients.recipients
  )
  FROM normalized_recipients;
$$;

REVOKE ALL ON FUNCTION public.procurement_rfq_canonical_payload(
  UUID, INTEGER, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_procurement_rfq_attempt_payload_v2(
  p_user_id UUID,
  p_employer_id UUID,
  p_idempotency_key UUID,
  p_request_fingerprint TEXT,
  p_material_request_id UUID,
  p_requirement_revision INTEGER,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.procurement_rfq_idempotency_attempts%ROWTYPE;
  v_request public.procurement_material_requests%ROWTYPE;
  v_payload JSONB;
  v_hash TEXT;
  v_supplier_ids JSONB;
  v_recipient_company_ids JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    OR p_idempotency_key IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_material_request_id IS NULL
    OR p_requirement_revision IS NULL
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR jsonb_object_length(p_payload) <> 12
    OR p_payload - ARRAY[
      'material_request_id', 'requirement_revision', 'item_name', 'specification',
      'quantity', 'unit', 'delivery_location', 'quotation_deadline', 'buyer_notes',
      'requirement_snapshot', 'supplier_company_ids', 'recipients'
    ] <> '{}'::JSONB
    OR jsonb_typeof(p_payload -> 'supplier_company_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'recipients') IS DISTINCT FROM 'array' THEN
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
    RETURN jsonb_build_object(
      'ok', TRUE, 'status', 'NOT_CREATED', 'error_code', 'RFQ_REQUIREMENT_CHANGED'
    );
  END IF;
  IF v_request.revision IS DISTINCT FROM v_attempt.requirement_revision
    OR jsonb_build_object(
      'material_request_id', v_request.id,
      'revision', v_request.revision,
      'item_name', v_request.item_name,
      'specification', v_request.specification,
      'quantity', v_request.quantity,
      'unit', v_request.unit,
      'delivery_location', v_request.delivery_location
    ) IS DISTINCT FROM v_attempt.requirement_snapshot THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_CHANGED',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object(
      'ok', TRUE, 'status', 'NOT_CREATED', 'error_code', 'RFQ_REQUIREMENT_CHANGED'
    );
  END IF;

  IF p_payload ->> 'material_request_id' IS DISTINCT FROM p_material_request_id::TEXT
    OR (p_payload ->> 'requirement_revision')::INTEGER IS DISTINCT FROM p_requirement_revision
    OR p_payload -> 'requirement_snapshot' IS DISTINCT FROM v_attempt.requirement_snapshot
    OR p_payload ->> 'item_name' IS DISTINCT FROM v_request.item_name
    OR p_payload ->> 'specification' IS DISTINCT FROM v_request.specification
    OR p_payload ->> 'quantity' IS DISTINCT FROM trim_scale(v_request.quantity)::TEXT
    OR p_payload ->> 'unit' IS DISTINCT FROM v_request.unit
    OR p_payload ->> 'delivery_location' IS NULL
    OR length(p_payload ->> 'delivery_location') NOT BETWEEN 1 AND 500
    OR p_payload ->> 'quotation_deadline' IS NULL
    OR length(p_payload ->> 'quotation_deadline') = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ATTEMPT_PAYLOAD_INVALID');
  END IF;

  SELECT
    COALESCE(jsonb_agg(to_jsonb(value) ORDER BY value), '[]'::JSONB)
  INTO v_supplier_ids
  FROM jsonb_array_elements_text(p_payload -> 'supplier_company_ids') AS ids(value);

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload -> 'recipients') AS recipients(value)
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
      OR jsonb_object_length(value) <> 2
      OR value - ARRAY['company_id', 'offering_id'] <> '{}'::JSONB
      OR value ->> 'company_id' IS NULL
      OR value ->> 'offering_id' IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ATTEMPT_PAYLOAD_INVALID');
  END IF;
  SELECT
    COALESCE(
      jsonb_agg(to_jsonb(value ->> 'company_id') ORDER BY value ->> 'company_id'),
      '[]'::JSONB
    )
  INTO v_recipient_company_ids
  FROM jsonb_array_elements(p_payload -> 'recipients') AS recipients(value);
  IF v_supplier_ids IS DISTINCT FROM v_recipient_company_ids
    OR jsonb_array_length(v_supplier_ids) NOT BETWEEN 1 AND 100
    OR jsonb_array_length(v_supplier_ids) <> (
      SELECT COUNT(DISTINCT value)
      FROM jsonb_array_elements_text(v_supplier_ids) AS supplier_ids(value)
    )
    OR jsonb_array_length(p_payload -> 'recipients') <> jsonb_array_length(v_supplier_ids) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ATTEMPT_PAYLOAD_INVALID');
  END IF;

  v_payload := jsonb_build_object(
    'material_request_id', p_material_request_id::TEXT,
    'requirement_revision', p_requirement_revision,
    'item_name', p_payload ->> 'item_name',
    'specification', p_payload -> 'specification',
    'quantity', p_payload ->> 'quantity',
    'unit', p_payload ->> 'unit',
    'delivery_location', p_payload ->> 'delivery_location',
    'quotation_deadline', p_payload ->> 'quotation_deadline',
    'buyer_notes', p_payload -> 'buyer_notes',
    'requirement_snapshot', v_attempt.requirement_snapshot,
    'supplier_company_ids', v_supplier_ids,
    'recipients', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'company_id', value ->> 'company_id',
            'offering_id', value ->> 'offering_id'
          )
          ORDER BY value ->> 'company_id'
        ),
        '[]'::JSONB
      )
      FROM jsonb_array_elements(p_payload -> 'recipients') AS recipients(value)
    )
  );
  v_hash := encode(digest(convert_to(v_payload::TEXT, 'UTF8'), 'sha256'), 'hex');

  IF v_attempt.canonical_payload IS NOT NULL
    AND v_attempt.canonical_payload IS DISTINCT FROM v_payload THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;
  IF v_attempt.payload_hash IS NOT NULL AND v_attempt.payload_hash <> v_hash THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;

  UPDATE public.procurement_rfq_idempotency_attempts
  SET canonical_payload = v_payload,
      payload_hash = v_hash,
      updated_at = NOW()
  WHERE employer_id = p_employer_id
    AND idempotency_key = p_idempotency_key;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'PENDING', 'payload_hash', v_hash);
END;
$$;

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
  v_actual_payload JSONB;
  v_actual_hash TEXT;
  v_result JSONB;
  v_rfq_id UUID;
  v_error_code TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    OR p_idempotency_key IS NULL
    OR p_payload_hash IS NULL
    OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_recipients) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_recipients) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ATTEMPT_PAYLOAD_INVALID');
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
    OR v_attempt.requirement_snapshot IS NULL
    OR v_attempt.canonical_payload IS NULL THEN
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
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_REQUIREMENT_CHANGED');
  END IF;
  IF v_request.revision IS DISTINCT FROM v_attempt.requirement_revision
    OR jsonb_build_object(
      'material_request_id', v_request.id,
      'revision', v_request.revision,
      'item_name', v_request.item_name,
      'specification', v_request.specification,
      'quantity', v_request.quantity,
      'unit', v_request.unit,
      'delivery_location', v_request.delivery_location
    ) IS DISTINCT FROM v_attempt.requirement_snapshot
    OR v_attempt.requirement_snapshot ->> 'item_name' IS DISTINCT FROM p_item_name
    OR v_attempt.requirement_snapshot ->> 'specification' IS DISTINCT FROM p_specification
    OR (v_attempt.requirement_snapshot ->> 'quantity')::NUMERIC IS DISTINCT FROM p_quantity
    OR v_attempt.requirement_snapshot ->> 'unit' IS DISTINCT FROM p_unit THEN
    UPDATE public.procurement_rfq_idempotency_attempts
    SET status = 'NOT_CREATED',
        error_code = 'RFQ_REQUIREMENT_CHANGED',
        updated_at = NOW()
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_REQUIREMENT_CHANGED');
  END IF;

  v_actual_payload := public.procurement_rfq_canonical_payload(
    p_material_request_id,
    v_attempt.requirement_revision,
    p_item_name,
    p_specification,
    p_quantity,
    p_unit,
    p_delivery_location,
    p_quotation_deadline,
    p_buyer_notes,
    jsonb_build_object(
      'material_request_id', v_request.id,
      'revision', v_request.revision,
      'item_name', v_request.item_name,
      'specification', v_request.specification,
      'quantity', v_request.quantity,
      'unit', v_request.unit,
      'delivery_location', v_request.delivery_location
    ),
    p_recipients
  );
  v_actual_hash := encode(
    digest(convert_to(v_actual_payload::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_actual_payload IS DISTINCT FROM v_attempt.canonical_payload
    OR v_actual_hash IS DISTINCT FROM v_attempt.payload_hash
    OR p_payload_hash IS DISTINCT FROM v_attempt.payload_hash THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;

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
  IF v_attempt.requirement_revision IS DISTINCT FROM p_requirement_revision
    OR v_attempt.material_request_id IS DISTINCT FROM p_material_request_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
  END IF;

  RETURN public.create_procurement_rfq(
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

  RETURN jsonb_build_object(
    'ok', FALSE,
    'error_code', 'RFQ_REQUIREMENT_SNAPSHOT_UNAVAILABLE'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_procurement_rfq_attempt_payload(
  UUID, UUID, UUID, TEXT, UUID, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_procurement_rfq_attempt_payload_v2(
  UUID, UUID, UUID, TEXT, UUID, INTEGER, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_procurement_rfq_attempt_payload_v2(
  UUID, UUID, UUID, TEXT, UUID, INTEGER, JSONB
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
