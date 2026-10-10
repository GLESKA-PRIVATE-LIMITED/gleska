BEGIN;

CREATE TABLE public.procurement_rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  material_request_id UUID REFERENCES public.procurement_material_requests(id) ON DELETE SET NULL,
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  item_name TEXT NOT NULL CHECK (length(trim(item_name)) BETWEEN 2 AND 240),
  specification TEXT CHECK (specification IS NULL OR length(specification) <= 2000),
  quantity NUMERIC NOT NULL CHECK (quantity > 0 AND quantity <= 1000000000),
  unit TEXT NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 48),
  delivery_location TEXT NOT NULL CHECK (length(trim(delivery_location)) BETWEEN 1 AND 500),
  quotation_deadline TIMESTAMPTZ NOT NULL,
  buyer_notes TEXT CHECK (buyer_notes IS NULL OR length(buyer_notes) <= 4000),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procurement_rfqs_employer_idempotency_unique
    UNIQUE (employer_id, idempotency_key)
);

CREATE TABLE public.procurement_rfq_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES public.procurement_rfqs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.supplier_companies(id) ON DELETE RESTRICT,
  offering_id UUID NOT NULL REFERENCES public.supplier_material_offerings(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED', 'ACKNOWLEDGED', 'DECLINED')),
  response_note TEXT CHECK (response_note IS NULL OR length(response_note) <= 2000),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procurement_rfq_recipient_company_unique UNIQUE (rfq_id, company_id),
  CONSTRAINT procurement_rfq_recipient_response_check CHECK (
    (status = 'INVITED' AND responded_at IS NULL AND response_note IS NULL)
    OR (status IN ('ACKNOWLEDGED', 'DECLINED') AND responded_at IS NOT NULL)
  )
);

CREATE INDEX procurement_rfqs_employer_created_idx
  ON public.procurement_rfqs(employer_id, created_at DESC);
CREATE INDEX procurement_rfqs_deadline_idx
  ON public.procurement_rfqs(status, quotation_deadline);
CREATE INDEX procurement_rfq_recipients_company_created_idx
  ON public.procurement_rfq_recipients(company_id, created_at DESC);
CREATE INDEX procurement_rfq_recipients_rfq_idx
  ON public.procurement_rfq_recipients(rfq_id);

DROP TRIGGER IF EXISTS update_procurement_rfqs_updated_at
  ON public.procurement_rfqs;
CREATE TRIGGER update_procurement_rfqs_updated_at
  BEFORE UPDATE ON public.procurement_rfqs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.procurement_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_rfq_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.procurement_rfqs, public.procurement_rfq_recipients
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.procurement_rfqs, public.procurement_rfq_recipients
  TO service_role;

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
  v_request public.procurement_material_requests%ROWTYPE;
  v_existing public.procurement_rfqs%ROWTYPE;
  v_company public.supplier_companies%ROWTYPE;
  v_offering public.supplier_material_offerings%ROWTYPE;
  v_recipient JSONB;
  v_company_id UUID;
  v_offering_id UUID;
  v_rfq_id UUID;
  v_count INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_recipients) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_RECIPIENTS_INVALID');
  END IF;
  IF jsonb_array_length(p_recipients) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_RECIPIENTS_INVALID');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_recipients) AS entries(value)
    GROUP BY value ->> 'company_id'
    HAVING COUNT(*) > 1
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_RECIPIENTS_INVALID');
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
  INTO v_request
  FROM public.procurement_material_requests
  WHERE id = p_material_request_id
    AND employer_id = p_employer_id
    AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'MATERIAL_REQUEST_NOT_FOUND');
  END IF;

  SELECT *
  INTO v_existing
  FROM public.procurement_rfqs
  WHERE employer_id = p_employer_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payload_hash <> p_payload_hash
      OR v_existing.material_request_id IS DISTINCT FROM p_material_request_id THEN
      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('ok', TRUE, 'rfq_id', v_existing.id);
  END IF;

  IF p_quotation_deadline <= NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_DEADLINE_INVALID');
  END IF;

  INSERT INTO public.procurement_rfqs (
    employer_id, user_id, material_request_id, idempotency_key, payload_hash,
    item_name, specification, quantity, unit, delivery_location,
    quotation_deadline, buyer_notes
  )
  VALUES (
    p_employer_id, p_user_id, p_material_request_id, p_idempotency_key, p_payload_hash,
    p_item_name, p_specification, p_quantity, p_unit, p_delivery_location,
    p_quotation_deadline, p_buyer_notes
  )
  ON CONFLICT (employer_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_rfq_id;

  IF v_rfq_id IS NULL THEN
    SELECT *
    INTO v_existing
    FROM public.procurement_rfqs
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    IF NOT FOUND
      OR v_existing.payload_hash <> p_payload_hash
      OR v_existing.material_request_id IS DISTINCT FROM p_material_request_id THEN
      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('ok', TRUE, 'rfq_id', v_existing.id);
  END IF;

  FOR v_recipient IN SELECT value FROM jsonb_array_elements(p_recipients)
  LOOP
    v_company_id := (v_recipient ->> 'company_id')::UUID;
    v_offering_id := (v_recipient ->> 'offering_id')::UUID;

    SELECT *
    INTO v_company
    FROM public.supplier_companies
    WHERE id = v_company_id
    FOR SHARE;
    IF NOT FOUND
      OR v_company.operational_status <> 'ACTIVE'
      OR v_company.verification_status <> 'VERIFIED' THEN
      RAISE EXCEPTION 'RFQ_SUPPLIER_INELIGIBLE';
    END IF;

    SELECT *
    INTO v_offering
    FROM public.supplier_material_offerings
    WHERE id = v_offering_id
      AND company_id = v_company_id
    FOR SHARE;
    IF NOT FOUND
      OR v_offering.is_available IS DISTINCT FROM TRUE
      OR v_offering.archived_at IS NOT NULL
      OR (
        v_offering.minimum_order_quantity IS NOT NULL
        AND lower(trim(v_offering.unit)) = lower(trim(p_unit))
        AND p_quantity < v_offering.minimum_order_quantity
      ) THEN
      RAISE EXCEPTION 'RFQ_SUPPLIER_INELIGIBLE';
    END IF;

    INSERT INTO public.procurement_rfq_recipients (
      rfq_id, company_id, offering_id
    )
    VALUES (v_rfq_id, v_company_id, v_offering_id);
    v_count := v_count + 1;
  END LOOP;

  IF v_count <> jsonb_array_length(p_recipients) THEN
    RAISE EXCEPTION 'RFQ_RECIPIENTS_INVALID';
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'rfq_id', v_rfq_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_procurement_rfq(
  p_user_id UUID,
  p_company_id UUID,
  p_rfq_id UUID,
  p_status TEXT,
  p_response_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_recipient public.procurement_rfq_recipients%ROWTYPE;
  v_responded_at TIMESTAMPTZ;
BEGIN
  IF p_status NOT IN ('ACKNOWLEDGED', 'DECLINED') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_RESPONSE_INVALID');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.supplier_company_memberships m
    JOIN public.supplier_companies c ON c.id = m.company_id
    WHERE m.company_id = p_company_id
      AND m.user_id = p_user_id
      AND m.status = 'ACTIVE'
      AND c.operational_status = 'ACTIVE'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'SUPPLIER_COMPANY_MEMBERSHIP_NOT_FOUND');
  END IF;

  SELECT r.*
  INTO v_recipient
  FROM public.procurement_rfq_recipients r
  JOIN public.procurement_rfqs q ON q.id = r.rfq_id
  WHERE r.rfq_id = p_rfq_id
    AND r.company_id = p_company_id
  FOR UPDATE OF r;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;
  IF v_recipient.status <> 'INVITED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ALREADY_RESPONDED');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.procurement_rfqs q
    WHERE q.id = p_rfq_id
      AND q.status = 'OPEN'
      AND q.quotation_deadline > NOW()
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_CLOSED');
  END IF;

  UPDATE public.procurement_rfq_recipients
  SET status = p_status,
      response_note = NULLIF(trim(p_response_note), ''),
      responded_at = NOW()
  WHERE id = v_recipient.id
  RETURNING responded_at INTO v_responded_at;

  RETURN jsonb_build_object('ok', TRUE, 'responded_at', v_responded_at);
END;
$$;

REVOKE ALL ON FUNCTION public.create_procurement_rfq(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_procurement_rfq(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;
REVOKE ALL ON FUNCTION public.respond_to_procurement_rfq(
  UUID, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_procurement_rfq(
  UUID, UUID, UUID, TEXT, TEXT
) TO service_role;

COMMIT;
