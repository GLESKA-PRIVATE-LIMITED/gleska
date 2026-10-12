BEGIN;

CREATE OR REPLACE FUNCTION public.update_procurement_rfq(
  p_user_id UUID,
  p_employer_id UUID,
  p_rfq_id UUID,
  p_delivery_location TEXT,
  p_quotation_deadline TIMESTAMPTZ,
  p_buyer_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rfq public.procurement_rfqs%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employer_profiles ep
    WHERE ep.id = p_employer_id
      AND ep.user_id = p_user_id
      AND ep.onboarding_status = 'COMPLETED'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT * INTO v_rfq
  FROM public.procurement_rfqs
  WHERE id = p_rfq_id
    AND user_id = p_user_id
    AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.procurement_purchase_orders po
    WHERE po.rfq_id = p_rfq_id
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ALREADY_AWARDED');
  END IF;
  IF v_rfq.status <> 'OPEN' OR v_rfq.quotation_deadline <= NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_CLOSED');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.procurement_rfq_recipients r
    WHERE r.rfq_id = p_rfq_id
      AND (r.status <> 'INVITED' OR r.responded_at IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.procurement_supplier_quotations q
    WHERE q.rfq_id = p_rfq_id
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ACTIVITY_EXISTS');
  END IF;
  IF p_delivery_location IS NULL
    OR length(trim(p_delivery_location)) NOT BETWEEN 1 AND 500
    OR p_quotation_deadline IS NULL
    OR p_quotation_deadline <= NOW()
    OR length(COALESCE(p_buyer_notes, '')) > 4000 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_UPDATE_INVALID');
  END IF;

  UPDATE public.procurement_rfqs
  SET delivery_location = trim(p_delivery_location),
      quotation_deadline = p_quotation_deadline,
      buyer_notes = NULLIF(trim(p_buyer_notes), '')
  WHERE id = p_rfq_id;

  RETURN jsonb_build_object('ok', TRUE, 'rfq_id', p_rfq_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_procurement_rfq(
  p_user_id UUID,
  p_employer_id UUID,
  p_rfq_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rfq public.procurement_rfqs%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employer_profiles ep
    WHERE ep.id = p_employer_id
      AND ep.user_id = p_user_id
      AND ep.onboarding_status = 'COMPLETED'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT * INTO v_rfq
  FROM public.procurement_rfqs
  WHERE id = p_rfq_id
    AND user_id = p_user_id
    AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.procurement_purchase_orders po
    WHERE po.rfq_id = p_rfq_id
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ALREADY_AWARDED');
  END IF;
  IF v_rfq.status <> 'OPEN' OR v_rfq.quotation_deadline <= NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_CLOSED');
  END IF;

  UPDATE public.procurement_rfqs
  SET status = 'CLOSED'
  WHERE id = p_rfq_id;

  RETURN jsonb_build_object('ok', TRUE, 'rfq_id', p_rfq_id);
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
  v_rfq public.procurement_rfqs%ROWTYPE;
  v_recipient public.procurement_rfq_recipients%ROWTYPE;
  v_responded_at TIMESTAMPTZ;
BEGIN
  IF p_status IS NULL
    OR p_status NOT IN ('ACKNOWLEDGED', 'DECLINED')
    OR length(COALESCE(p_response_note, '')) > 2000 THEN
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

  SELECT * INTO v_recipient
  FROM public.procurement_rfq_recipients
  WHERE rfq_id = p_rfq_id
    AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;

  SELECT * INTO v_rfq
  FROM public.procurement_rfqs
  WHERE id = p_rfq_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;
  IF v_rfq.status <> 'OPEN' OR v_rfq.quotation_deadline <= NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_CLOSED');
  END IF;

  SELECT * INTO v_recipient
  FROM public.procurement_rfq_recipients
  WHERE rfq_id = p_rfq_id
    AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;
  IF v_recipient.status <> 'INVITED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ALREADY_RESPONDED');
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

REVOKE ALL ON FUNCTION public.update_procurement_rfq(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_procurement_rfq(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.close_procurement_rfq(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_procurement_rfq(UUID, UUID, UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.respond_to_procurement_rfq(UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_procurement_rfq(UUID, UUID, UUID, TEXT, TEXT)
  TO service_role;

COMMIT;
