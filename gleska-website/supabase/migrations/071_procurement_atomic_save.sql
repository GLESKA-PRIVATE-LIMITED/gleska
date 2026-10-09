BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.procurement_material_requests
    WHERE origin_conversation_id IS NOT NULL
    GROUP BY employer_id, origin_conversation_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add Procurement conversation uniqueness: duplicate saved requests already exist';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS procurement_requests_one_per_origin_conversation
  ON public.procurement_material_requests(employer_id, origin_conversation_id)
  WHERE origin_conversation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_procurement_material_request(
  p_conversation_id UUID,
  p_user_id UUID,
  p_employer_id UUID,
  p_expected_revision INTEGER,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_role TEXT;
  v_onboarding_status TEXT;
  v_conversation public.procurement_conversations%ROWTYPE;
  v_saved public.procurement_material_requests%ROWTYPE;
  v_draft_payload JSONB;
  v_saved_payload JSONB;
  v_payload_matches BOOLEAN;
BEGIN
  SELECT role::TEXT
  INTO v_user_role
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND OR v_user_role <> 'EMPLOYER' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT onboarding_status::TEXT
  INTO v_onboarding_status
  FROM public.employer_profiles
  WHERE id = p_employer_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'EMPLOYER_NOT_FOUND');
  END IF;
  IF v_onboarding_status <> 'COMPLETED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.procurement_conversations
  WHERE id = p_conversation_id
    AND user_id = p_user_id
    AND employer_id = p_employer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'CONVERSATION_NOT_FOUND');
  END IF;

  v_draft_payload := jsonb_build_object(
    'title', NULLIF(v_conversation.draft ->> 'title', ''),
    'item_name', NULLIF(v_conversation.draft ->> 'item_name', ''),
    'specification', NULLIF(v_conversation.draft ->> 'specification', ''),
    'quantity', NULLIF(v_conversation.draft ->> 'quantity', '')::NUMERIC,
    'unit', NULLIF(v_conversation.draft ->> 'unit', ''),
    'required_by', NULLIF(v_conversation.draft ->> 'required_by', '')::DATE,
    'delivery_location', NULLIF(v_conversation.draft ->> 'delivery_location', ''),
    'additional_requirements', COALESCE(
      v_conversation.draft -> 'additional_requirements',
      '[]'::JSONB
    ),
    'notes', NULLIF(v_conversation.draft ->> 'notes', '')
  );

  SELECT *
  INTO v_saved
  FROM public.procurement_material_requests
  WHERE employer_id = p_employer_id
    AND user_id = p_user_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_saved.origin_conversation_id IS DISTINCT FROM p_conversation_id THEN
      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'IDEMPOTENCY_KEY_REUSED');
    END IF;
  ELSE
    SELECT *
    INTO v_saved
    FROM public.procurement_material_requests
    WHERE employer_id = p_employer_id
      AND user_id = p_user_id
      AND origin_conversation_id = p_conversation_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_conversation.draft IS NULL THEN
        RETURN jsonb_build_object('ok', FALSE, 'error_code', 'CONVERSATION_STATE_INVALID');
      END IF;
    END IF;
  END IF;

  IF v_saved.id IS NOT NULL THEN
    v_saved_payload := jsonb_build_object(
      'title', v_saved.title,
      'item_name', v_saved.item_name,
      'specification', v_saved.specification,
      'quantity', v_saved.quantity,
      'unit', v_saved.unit,
      'required_by', v_saved.required_by,
      'delivery_location', v_saved.delivery_location,
      'additional_requirements', v_saved.additional_requirements,
      'notes', v_saved.notes
    );
    v_payload_matches := (
      v_saved_payload = v_draft_payload
      AND v_saved.confirmed_fields @> v_conversation.confirmed_fields
      AND v_saved.confirmed_fields <@ v_conversation.confirmed_fields
    );

    IF NOT v_payload_matches THEN
      IF v_saved.idempotency_key = p_idempotency_key THEN
        RETURN jsonb_build_object('ok', FALSE, 'error_code', 'IDEMPOTENCY_PAYLOAD_CONFLICT');
      END IF;
      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'CONVERSATION_ALREADY_SAVED');
    END IF;

    IF v_conversation.status = 'ACTIVE' THEN
      UPDATE public.procurement_conversations
      SET status = 'COMPLETED',
          revision = revision + 1
      WHERE id = p_conversation_id;
    ELSIF v_conversation.status <> 'COMPLETED' THEN
      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'CONVERSATION_STATE_INVALID');
    END IF;

    RETURN jsonb_build_object('ok', TRUE, 'request', to_jsonb(v_saved));
  END IF;

  IF v_conversation.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'CONVERSATION_NOT_ACTIVE');
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision <> v_conversation.revision THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'STALE_CONVERSATION_STATE');
  END IF;
  IF NOT (
    v_conversation.confirmed_fields @> ARRAY['item_name', 'quantity', 'unit']::TEXT[]
    AND NULLIF(v_conversation.draft ->> 'item_name', '') IS NOT NULL
    AND NULLIF(v_conversation.draft ->> 'quantity', '') IS NOT NULL
    AND NULLIF(v_conversation.draft ->> 'quantity', '')::NUMERIC > 0
    AND NULLIF(v_conversation.draft ->> 'unit', '') IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'REQUIRED_FIELDS_NOT_CONFIRMED');
  END IF;

  BEGIN
    INSERT INTO public.procurement_material_requests (
      employer_id,
      user_id,
      origin_conversation_id,
      idempotency_key,
      title,
      item_name,
      specification,
      quantity,
      unit,
      required_by,
      delivery_location,
      additional_requirements,
      notes,
      confirmed_fields
    )
    VALUES (
      p_employer_id,
      p_user_id,
      p_conversation_id,
      p_idempotency_key,
      NULLIF(v_conversation.draft ->> 'title', ''),
      NULLIF(v_conversation.draft ->> 'item_name', ''),
      NULLIF(v_conversation.draft ->> 'specification', ''),
      NULLIF(v_conversation.draft ->> 'quantity', '')::NUMERIC,
      NULLIF(v_conversation.draft ->> 'unit', ''),
      NULLIF(v_conversation.draft ->> 'required_by', '')::DATE,
      NULLIF(v_conversation.draft ->> 'delivery_location', ''),
      COALESCE(v_conversation.draft -> 'additional_requirements', '[]'::JSONB),
      NULLIF(v_conversation.draft ->> 'notes', ''),
      v_conversation.confirmed_fields
    )
    RETURNING * INTO v_saved;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_saved
      FROM public.procurement_material_requests
      WHERE employer_id = p_employer_id
        AND user_id = p_user_id
        AND idempotency_key = p_idempotency_key
      FOR UPDATE;

      IF FOUND AND v_saved.origin_conversation_id IS DISTINCT FROM p_conversation_id THEN
        RETURN jsonb_build_object('ok', FALSE, 'error_code', 'IDEMPOTENCY_KEY_REUSED');
      END IF;

      SELECT *
      INTO v_saved
      FROM public.procurement_material_requests
      WHERE employer_id = p_employer_id
        AND user_id = p_user_id
        AND origin_conversation_id = p_conversation_id
      FOR UPDATE;

      IF FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error_code', 'CONVERSATION_ALREADY_SAVED');
      END IF;

      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'MATERIAL_REQUEST_SAVE_FAILED');
  END;

  UPDATE public.procurement_conversations
  SET status = 'COMPLETED',
      revision = revision + 1
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('ok', TRUE, 'request', to_jsonb(v_saved));
END;
$$;

REVOKE ALL ON FUNCTION public.save_procurement_material_request(UUID, UUID, UUID, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_procurement_material_request(UUID, UUID, UUID, INTEGER, UUID)
  TO service_role;

COMMIT;
