BEGIN;

ALTER TABLE public.procurement_supplier_quotations
  ADD CONSTRAINT procurement_supplier_quotation_scope_unique
  UNIQUE (id, rfq_id, company_id);

ALTER TABLE public.procurement_rfqs
  ADD CONSTRAINT procurement_rfq_buyer_scope_unique
  UNIQUE (id, user_id, employer_id);

CREATE TABLE public.procurement_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference TEXT NOT NULL UNIQUE DEFAULT (
    'PO-' || to_char(NOW(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8))
  ),
  rfq_id UUID NOT NULL UNIQUE REFERENCES public.procurement_rfqs(id) ON DELETE RESTRICT,
  quotation_id UUID NOT NULL UNIQUE,
  supplier_company_id UUID NOT NULL REFERENCES public.supplier_companies(id) ON DELETE RESTRICT,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE RESTRICT,
  buyer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,
  specification TEXT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP', 'AED')),
  quantity_offered NUMERIC(18, 4) NOT NULL CHECK (quantity_offered > 0),
  offered_unit TEXT NOT NULL,
  estimated_delivery_lead_time_days INTEGER NOT NULL
    CHECK (estimated_delivery_lead_time_days BETWEEN 0 AND 3650),
  quotation_valid_until DATE NOT NULL,
  delivery_location TEXT NOT NULL,
  delivery_terms TEXT NOT NULL,
  supplier_notes TEXT,
  status TEXT NOT NULL DEFAULT 'ISSUED'
    CHECK (status IN ('ISSUED', 'ACCEPTED', 'REJECTED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procurement_purchase_order_quotation_scope_fk
    FOREIGN KEY (quotation_id, rfq_id, supplier_company_id)
    REFERENCES public.procurement_supplier_quotations(id, rfq_id, company_id)
    ON DELETE RESTRICT,
  CONSTRAINT procurement_purchase_order_buyer_scope_fk
    FOREIGN KEY (rfq_id, buyer_user_id, employer_id)
    REFERENCES public.procurement_rfqs(id, user_id, employer_id)
    ON DELETE RESTRICT
);

CREATE INDEX procurement_purchase_orders_buyer_created_idx
  ON public.procurement_purchase_orders(buyer_user_id, employer_id, created_at DESC);
CREATE INDEX procurement_purchase_orders_supplier_created_idx
  ON public.procurement_purchase_orders(supplier_company_id, created_at DESC);

DROP TRIGGER IF EXISTS update_procurement_purchase_orders_updated_at
  ON public.procurement_purchase_orders;
CREATE TRIGGER update_procurement_purchase_orders_updated_at
  BEFORE UPDATE ON public.procurement_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.procurement_purchase_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.procurement_purchase_orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.procurement_purchase_orders TO service_role;

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

  UPDATE public.procurement_rfqs
  SET status = 'CLOSED'
  WHERE id = v_rfq.id;

  RETURN jsonb_build_object('ok', TRUE, 'purchase_order_id', v_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_procurement_purchase_order(
  p_user_id UUID,
  p_company_id UUID,
  p_order_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.procurement_purchase_orders%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('ACCEPTED', 'REJECTED') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PURCHASE_ORDER_STATUS_INVALID');
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

  SELECT * INTO v_order
  FROM public.procurement_purchase_orders
  WHERE id = p_order_id
    AND supplier_company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PURCHASE_ORDER_NOT_FOUND');
  END IF;
  IF v_order.status <> 'ISSUED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PURCHASE_ORDER_TRANSITION_INVALID');
  END IF;

  UPDATE public.procurement_purchase_orders
  SET status = p_status
  WHERE id = v_order.id;
  RETURN jsonb_build_object('ok', TRUE, 'status', p_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_procurement_purchase_order(
  p_user_id UUID,
  p_employer_id UUID,
  p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.procurement_purchase_orders%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employer_profiles ep
    WHERE ep.id = p_employer_id
      AND ep.user_id = p_user_id
      AND ep.onboarding_status = 'COMPLETED'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PROCUREMENT_FORBIDDEN');
  END IF;

  SELECT * INTO v_order
  FROM public.procurement_purchase_orders
  WHERE id = p_order_id
    AND buyer_user_id = p_user_id
    AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PURCHASE_ORDER_NOT_FOUND');
  END IF;
  IF v_order.status <> 'ISSUED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PURCHASE_ORDER_TRANSITION_INVALID');
  END IF;

  UPDATE public.procurement_purchase_orders
  SET status = 'CANCELLED'
  WHERE id = v_order.id;
  RETURN jsonb_build_object('ok', TRUE, 'status', 'CANCELLED');
END;
$$;

REVOKE ALL ON FUNCTION public.select_procurement_quotation(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_procurement_quotation(UUID, UUID, UUID, UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.respond_to_procurement_purchase_order(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_procurement_purchase_order(UUID, UUID, UUID, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.cancel_procurement_purchase_order(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_procurement_purchase_order(UUID, UUID, UUID)
  TO service_role;

COMMIT;
