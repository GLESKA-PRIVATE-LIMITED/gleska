BEGIN;

CREATE TABLE public.procurement_supplier_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES public.procurement_rfqs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.supplier_companies(id) ON DELETE RESTRICT,
  unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP', 'AED')),
  quantity_offered NUMERIC(18, 4) NOT NULL CHECK (
    quantity_offered > 0 AND quantity_offered <= 1000000000
  ),
  unit TEXT NOT NULL CHECK (
    unit IN ('MT', 'Bags', 'Pieces', 'Kg', 'Tons', 'Meters', 'Sq. ft', 'Boxes', 'Liters')
  ),
  estimated_delivery_lead_time_days INTEGER NOT NULL
    CHECK (estimated_delivery_lead_time_days BETWEEN 0 AND 3650),
  quotation_valid_until DATE NOT NULL,
  delivery_terms TEXT NOT NULL CHECK (length(trim(delivery_terms)) BETWEEN 1 AND 2000),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 4000),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  submitted_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procurement_supplier_quotation_rfq_company_unique
    UNIQUE (rfq_id, company_id)
);

CREATE INDEX procurement_supplier_quotations_company_updated_idx
  ON public.procurement_supplier_quotations(company_id, updated_at DESC);
CREATE INDEX procurement_supplier_quotations_rfq_idx
  ON public.procurement_supplier_quotations(rfq_id);

DROP TRIGGER IF EXISTS update_procurement_supplier_quotations_updated_at
  ON public.procurement_supplier_quotations;
CREATE TRIGGER update_procurement_supplier_quotations_updated_at
  BEFORE UPDATE ON public.procurement_supplier_quotations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.procurement_supplier_quotations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.procurement_supplier_quotations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.procurement_supplier_quotations TO service_role;

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
DECLARE
  v_recipient public.procurement_rfq_recipients%ROWTYPE;
  v_rfq public.procurement_rfqs%ROWTYPE;
  v_quotation public.procurement_supplier_quotations%ROWTYPE;
BEGIN
  IF p_unit_price IS NULL
    OR p_unit_price < 0
    OR p_unit_price > 1000000000000
    OR p_currency IS NULL
    OR p_currency NOT IN ('INR', 'USD', 'EUR', 'GBP', 'AED')
    OR p_quantity_offered IS NULL
    OR p_quantity_offered <= 0
    OR p_quantity_offered > 1000000000
    OR p_unit IS NULL
    OR p_unit NOT IN ('MT', 'Bags', 'Pieces', 'Kg', 'Tons', 'Meters', 'Sq. ft', 'Boxes', 'Liters')
    OR p_estimated_delivery_lead_time_days IS NULL
    OR p_estimated_delivery_lead_time_days NOT BETWEEN 0 AND 3650
    OR p_quotation_valid_until IS NULL
    OR p_delivery_terms IS NULL
    OR length(trim(p_delivery_terms)) NOT BETWEEN 1 AND 2000
    OR length(COALESCE(p_notes, '')) > 4000 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_INVALID');
  END IF;

  SELECT *
  INTO v_recipient
  FROM public.procurement_rfq_recipients
  WHERE rfq_id = p_rfq_id
    AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
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
  IF v_recipient.status = 'DECLINED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_INVITATION_DECLINED');
  END IF;

  SELECT *
  INTO v_rfq
  FROM public.procurement_rfqs
  WHERE id = p_rfq_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_NOT_FOUND');
  END IF;
  IF v_rfq.status <> 'OPEN' OR v_rfq.quotation_deadline <= NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'RFQ_CLOSED');
  END IF;
  IF p_quotation_valid_until < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'QUOTATION_VALIDITY_INVALID');
  END IF;

  SELECT *
  INTO v_quotation
  FROM public.procurement_supplier_quotations
  WHERE rfq_id = p_rfq_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF FOUND THEN
    IF p_expected_revision IS NULL
      OR p_expected_revision <> v_quotation.revision THEN
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
    SET status = 'ACKNOWLEDGED',
        responded_at = NOW()
    WHERE id = v_recipient.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'quotation', to_jsonb(v_quotation)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_procurement_supplier_quotation(
  UUID, UUID, UUID, NUMERIC, TEXT, NUMERIC, TEXT, INTEGER, DATE, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_procurement_supplier_quotation(
  UUID, UUID, UUID, NUMERIC, TEXT, NUMERIC, TEXT, INTEGER, DATE, TEXT, TEXT, INTEGER
) TO service_role;

COMMIT;
