BEGIN;

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
    WHERE ep.id = p_employer_id
      AND ep.user_id = p_user_id
      AND ep.onboarding_status = 'COMPLETED'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT * INTO v_quotation
  FROM public.procurement_supplier_quotations
  WHERE id = p_quotation_id
    AND rfq_id = p_rfq_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_NOT_FOUND');
  END IF;

  SELECT * INTO v_recipient
  FROM public.procurement_rfq_recipients
  WHERE rfq_id = p_rfq_id
    AND company_id = v_quotation.company_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_INVITATION_NOT_FOUND');
  END IF;
  IF v_recipient.status = 'DECLINED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_INVITATION_DECLINED');
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
  IF v_rfq.status <> 'OPEN' OR v_rfq.quotation_deadline <= NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_CLOSED');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.procurement_purchase_orders po
    WHERE po.rfq_id = p_rfq_id
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_ALREADY_AWARDED');
  END IF;

  SELECT * INTO v_quotation
  FROM public.procurement_supplier_quotations
  WHERE id = p_quotation_id
    AND rfq_id = p_rfq_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_NOT_FOUND');
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
    quotation_valid_until, delivery_location, delivery_terms, supplier_notes,
    fulfillment_unit
  )
  VALUES (
    v_rfq.id, v_quotation.id, v_quotation.company_id, p_employer_id, p_user_id,
    v_rfq.item_name, v_rfq.specification, v_rfq.quantity, v_rfq.unit,
    v_quotation.unit_price, v_quotation.currency, v_quotation.quantity_offered,
    v_quotation.unit, v_quotation.estimated_delivery_lead_time_days,
    v_quotation.quotation_valid_until, v_rfq.delivery_location,
    v_quotation.delivery_terms, v_quotation.notes, v_rfq.unit
  )
  RETURNING id INTO v_order_id;

  UPDATE public.procurement_rfqs
  SET status = 'CLOSED'
  WHERE id = v_rfq.id;

  RETURN jsonb_build_object('ok', TRUE, 'purchase_order_id', v_order_id);
END;
$$;

COMMIT;
