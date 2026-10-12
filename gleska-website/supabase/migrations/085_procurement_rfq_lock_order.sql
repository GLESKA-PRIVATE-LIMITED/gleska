BEGIN;

CREATE OR REPLACE FUNCTION public.submit_procurement_supplier_quotation(
  p_user_id UUID,
  p_company_id UUID,
  p_rfq_id UUID,
  p_unit_price NUMERIC,
  p_currency TEXT,
  p_quantity_offered NUMERIC,
  p_unit TEXT,
  p_estimated_delivery_lead_time_days INTEGER,
  p_quotation_valid_until DATE,
  p_delivery_terms TEXT,
  p_notes TEXT,
  p_expected_revision INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_STALE');
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_procurement_supplier_quotation_v2(
  p_user_id UUID,
  p_company_id UUID,
  p_rfq_id UUID,
  p_expected_rfq_updated_at TIMESTAMPTZ,
  p_unit_price NUMERIC,
  p_currency TEXT,
  p_quantity_offered NUMERIC,
  p_unit TEXT,
  p_estimated_delivery_lead_time_days INTEGER,
  p_quotation_valid_until DATE,
  p_delivery_terms TEXT,
  p_notes TEXT,
  p_expected_revision INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rfq public.procurement_rfqs%ROWTYPE;
  v_recipient public.procurement_rfq_recipients%ROWTYPE;
  v_quotation public.procurement_supplier_quotations%ROWTYPE;
BEGIN
  IF p_unit_price IS NULL OR p_unit_price < 0 OR p_unit_price > 1000000000000
    OR p_currency IS NULL OR p_currency NOT IN ('INR', 'USD', 'EUR', 'GBP', 'AED')
    OR p_quantity_offered IS NULL OR p_quantity_offered <= 0 OR p_quantity_offered > 1000000000
    OR p_unit IS NULL OR p_unit NOT IN ('MT', 'Bags', 'Pieces', 'Kg', 'Tons', 'Meters', 'Sq. ft', 'Boxes', 'Liters')
    OR p_estimated_delivery_lead_time_days IS NULL
      OR p_estimated_delivery_lead_time_days NOT BETWEEN 0 AND 3650
    OR p_quotation_valid_until IS NULL
    OR p_delivery_terms IS NULL OR length(trim(p_delivery_terms)) NOT BETWEEN 1 AND 2000
    OR length(COALESCE(p_notes, '')) > 4000 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_INVALID');
  END IF;
  SELECT * INTO v_rfq
  FROM public.procurement_rfqs
  WHERE id = p_rfq_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;
  IF v_rfq.updated_at IS DISTINCT FROM p_expected_rfq_updated_at THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_STALE');
  END IF;
  IF v_rfq.status <> 'OPEN' OR v_rfq.quotation_deadline <= NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_CLOSED');
  END IF;
  IF p_quotation_valid_until < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_VALIDITY_INVALID');
  END IF;

  SELECT * INTO v_recipient
  FROM public.procurement_rfq_recipients
  WHERE rfq_id = p_rfq_id AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;
  IF v_recipient.status = 'DECLINED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_INVITATION_DECLINED');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.supplier_company_memberships m
    JOIN public.supplier_companies c ON c.id = m.company_id
    JOIN public.users u ON u.id = m.user_id
    WHERE m.company_id = p_company_id
      AND m.user_id = p_user_id
      AND m.status = 'ACTIVE'
      AND c.operational_status = 'ACTIVE'
      AND u.is_active = TRUE
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'SUPPLIER_COMPANY_MEMBERSHIP_NOT_FOUND');
  END IF;

  SELECT * INTO v_quotation
  FROM public.procurement_supplier_quotations
  WHERE rfq_id = p_rfq_id AND company_id = p_company_id
  FOR UPDATE;
  IF FOUND THEN
    IF p_expected_revision IS NULL OR p_expected_revision <> v_quotation.revision THEN
      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_STALE');
    END IF;
    UPDATE public.procurement_supplier_quotations
    SET unit_price = p_unit_price,
        currency = p_currency,
        quantity_offered = p_quantity_offered,
        unit = p_unit,
        estimated_delivery_lead_time_days = p_estimated_delivery_lead_time_days,
        quotation_valid_until = p_quotation_valid_until,
        delivery_terms = p_delivery_terms,
        notes = p_notes,
        revision = revision + 1,
        submitted_by = p_user_id,
        submitted_at = NOW()
    WHERE id = v_quotation.id
    RETURNING * INTO v_quotation;
  ELSE
    IF p_expected_revision IS NOT NULL THEN
      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_STALE');
    END IF;
    INSERT INTO public.procurement_supplier_quotations (
      rfq_id, company_id, unit_price, currency, quantity_offered, unit,
      estimated_delivery_lead_time_days, quotation_valid_until, delivery_terms,
      notes, submitted_by
    )
    VALUES (
      p_rfq_id, p_company_id, p_unit_price, p_currency, p_quantity_offered, p_unit,
      p_estimated_delivery_lead_time_days, p_quotation_valid_until, p_delivery_terms,
      p_notes, p_user_id
    )
    RETURNING * INTO v_quotation;
  END IF;

  IF v_recipient.status = 'INVITED' THEN
    UPDATE public.procurement_rfq_recipients
    SET status = 'ACKNOWLEDGED', responded_at = NOW()
    WHERE id = v_recipient.id;
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'quotation', to_jsonb(v_quotation));
END;
$$;

CREATE OR REPLACE FUNCTION public.select_procurement_quotation(
  p_user_id UUID,
  p_employer_id UUID,
  p_rfq_id UUID,
  p_quotation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rfq public.procurement_rfqs%ROWTYPE;
  v_quotation public.procurement_supplier_quotations%ROWTYPE;
  v_recipient public.procurement_rfq_recipients%ROWTYPE;
  v_order_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employer_profiles ep
    WHERE ep.id = p_employer_id AND ep.user_id = p_user_id
      AND ep.onboarding_status = 'COMPLETED'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT * INTO v_rfq
  FROM public.procurement_rfqs
  WHERE id = p_rfq_id AND user_id = p_user_id AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;
  IF v_rfq.status <> 'OPEN' OR v_rfq.quotation_deadline <= NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_CLOSED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_purchase_orders po WHERE po.rfq_id = p_rfq_id) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ALREADY_AWARDED');
  END IF;

  SELECT * INTO v_quotation
  FROM public.procurement_supplier_quotations
  WHERE id = p_quotation_id AND rfq_id = p_rfq_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_NOT_FOUND');
  END IF;
  SELECT * INTO v_recipient
  FROM public.procurement_rfq_recipients
  WHERE rfq_id = p_rfq_id AND company_id = v_quotation.company_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_INVITATION_NOT_FOUND');
  END IF;
  IF v_recipient.status = 'DECLINED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_INVITATION_DECLINED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_companies c
    WHERE c.id = v_quotation.company_id
      AND c.operational_status = 'ACTIVE'
      AND c.verification_status = 'VERIFIED'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'SUPPLIER_COMPANY_INELIGIBLE');
  END IF;
  IF v_quotation.quotation_valid_until < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_EXPIRED');
  END IF;
  IF lower(trim(v_quotation.unit)) <> lower(trim(v_rfq.unit))
    OR v_quotation.quantity_offered < v_rfq.quantity THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_NOT_COMPARABLE');
  END IF;

  INSERT INTO public.procurement_purchase_orders (
    rfq_id, quotation_id, supplier_company_id, employer_id, buyer_user_id,
    item_name, specification, quantity, unit, unit_price, currency,
    quantity_offered, offered_unit, estimated_delivery_lead_time_days,
    quotation_valid_until, delivery_location, delivery_terms, supplier_notes
  )
  VALUES (
    v_rfq.id, v_quotation.id, v_quotation.company_id, p_employer_id, p_user_id,
    v_rfq.item_name, v_rfq.specification, v_rfq.quantity, v_rfq.unit,
    v_quotation.unit_price, v_quotation.currency, v_quotation.quantity_offered,
    v_quotation.unit, v_quotation.estimated_delivery_lead_time_days,
    v_quotation.quotation_valid_until, v_rfq.delivery_location,
    v_quotation.delivery_terms, v_quotation.notes
  )
  RETURNING id INTO v_order_id;

  UPDATE public.procurement_rfqs SET status = 'CLOSED' WHERE id = v_rfq.id;
  RETURN jsonb_build_object('ok', TRUE, 'purchase_order_id', v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_procurement_supplier_quotation_v2(
  UUID, UUID, UUID, TIMESTAMPTZ, NUMERIC, TEXT, NUMERIC, TEXT, INTEGER, DATE, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_procurement_supplier_quotation_v2(
  UUID, UUID, UUID, TIMESTAMPTZ, NUMERIC, TEXT, NUMERIC, TEXT, INTEGER, DATE, TEXT, TEXT, INTEGER
) TO service_role;
REVOKE ALL ON FUNCTION public.select_procurement_quotation(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_procurement_quotation(UUID, UUID, UUID, UUID)
  TO service_role;

COMMIT;
