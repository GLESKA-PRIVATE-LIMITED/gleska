BEGIN;

CREATE OR REPLACE FUNCTION public.update_procurement_purchase_order_fulfillment(
  p_user_id UUID,
  p_company_id UUID,
  p_order_id UUID,
  p_idempotency_key UUID,
  p_status TEXT,
  p_dispatched_quantity NUMERIC,
  p_delivered_quantity NUMERIC,
  p_unit TEXT,
  p_dispatch_date DATE,
  p_carrier TEXT,
  p_tracking_reference TEXT,
  p_estimated_delivery_date DATE,
  p_delivery_date DATE,
  p_delivery_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.procurement_purchase_orders%ROWTYPE;
  v_existing public.procurement_purchase_order_fulfillment_events%ROWTYPE;
  v_dispatched_quantity NUMERIC(18, 4);
  v_delivered_quantity NUMERIC(18, 4);
  v_event_id UUID;
BEGIN
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

  IF p_idempotency_key IS NULL
    OR p_status IS NULL
    OR p_status NOT IN ('PREPARING', 'DISPATCHED', 'PARTIALLY_DELIVERED', 'DELIVERED')
    OR p_dispatched_quantity IS NULL
    OR p_dispatched_quantity < 0
    OR p_delivered_quantity IS NULL
    OR p_delivered_quantity < 0
    OR p_dispatched_quantity > 1000000000
    OR p_delivered_quantity > 1000000000
    OR p_unit IS NULL
    OR lower(trim(p_unit)) <> lower(trim(v_order.unit))
    OR length(COALESCE(p_carrier, '')) > 200
    OR length(COALESCE(p_tracking_reference, '')) > 200
    OR length(COALESCE(p_delivery_notes, '')) > 2000 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_UPDATE_INVALID');
  END IF;

  SELECT * INTO v_existing
  FROM public.procurement_purchase_order_fulfillment_events
  WHERE purchase_order_id = p_order_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM p_status
      OR v_existing.dispatched_quantity IS DISTINCT FROM p_dispatched_quantity
      OR v_existing.delivered_quantity IS DISTINCT FROM p_delivered_quantity
      OR lower(trim(v_existing.unit)) IS DISTINCT FROM lower(trim(p_unit))
      OR v_existing.dispatch_date IS DISTINCT FROM p_dispatch_date
      OR v_existing.carrier IS DISTINCT FROM NULLIF(trim(p_carrier), '')
      OR v_existing.tracking_reference IS DISTINCT FROM NULLIF(trim(p_tracking_reference), '')
      OR v_existing.estimated_delivery_date IS DISTINCT FROM p_estimated_delivery_date
      OR v_existing.delivery_date IS DISTINCT FROM p_delivery_date
      OR v_existing.delivery_notes IS DISTINCT FROM NULLIF(trim(p_delivery_notes), '') THEN
      RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('ok', TRUE, 'event_id', v_existing.id, 'duplicate', TRUE);
  END IF;

  IF v_order.status NOT IN ('ACCEPTED', 'PREPARING', 'DISPATCHED', 'PARTIALLY_DELIVERED') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PURCHASE_ORDER_FULFILLMENT_NOT_ALLOWED');
  END IF;

  IF NOT (
    (v_order.status = 'ACCEPTED' AND p_status IN ('PREPARING', 'DISPATCHED'))
    OR (v_order.status = 'PREPARING' AND p_status IN ('PREPARING', 'DISPATCHED'))
    OR (v_order.status = 'DISPATCHED' AND p_status IN ('DISPATCHED', 'PARTIALLY_DELIVERED', 'DELIVERED'))
    OR (v_order.status = 'PARTIALLY_DELIVERED' AND p_status IN ('PARTIALLY_DELIVERED', 'DELIVERED'))
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'PURCHASE_ORDER_TRANSITION_INVALID');
  END IF;

  IF p_dispatched_quantity > 0 AND p_dispatch_date IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_DISPATCH_DATE_REQUIRED');
  END IF;
  IF p_delivered_quantity > 0 AND p_delivery_date IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_DELIVERY_DATE_REQUIRED');
  END IF;
  IF p_dispatch_date IS NOT NULL
    AND (
      p_dispatch_date > CURRENT_DATE
      OR v_order.created_at::DATE > p_dispatch_date
      OR p_dispatch_date < COALESCE(v_order.dispatch_date, v_order.created_at::DATE)
    ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_DATE_INVALID');
  END IF;
  IF p_delivery_date IS NOT NULL
    AND (p_delivery_date > CURRENT_DATE
      OR p_delivery_date < COALESCE(p_dispatch_date, v_order.dispatch_date, v_order.created_at::DATE)
      OR p_delivery_date < COALESCE(v_order.delivery_date, v_order.created_at::DATE)) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_DATE_INVALID');
  END IF;
  IF p_estimated_delivery_date IS NOT NULL
    AND p_estimated_delivery_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_DATE_INVALID');
  END IF;

  v_dispatched_quantity := v_order.dispatched_quantity + p_dispatched_quantity;
  v_delivered_quantity := v_order.delivered_quantity + p_delivered_quantity;
  IF v_dispatched_quantity > v_order.quantity THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_DISPATCH_QUANTITY_EXCEEDED');
  END IF;
  IF v_delivered_quantity > v_dispatched_quantity
    OR v_delivered_quantity > v_order.quantity THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_DELIVERY_QUANTITY_EXCEEDED');
  END IF;

  IF (p_status = 'PREPARING' AND (v_dispatched_quantity <> 0 OR v_delivered_quantity <> 0))
    OR (p_status = 'DISPATCHED' AND (
      p_dispatched_quantity <= 0 OR v_dispatched_quantity <= 0 OR v_delivered_quantity <> 0
    ))
    OR (p_status = 'PARTIALLY_DELIVERED' AND (
      p_delivered_quantity <= 0
      OR v_delivered_quantity <= 0
      OR v_delivered_quantity >= v_order.quantity
    ))
    OR (p_status = 'DELIVERED' AND (
      v_delivered_quantity <> v_order.quantity
      OR p_delivered_quantity <= 0
      OR p_delivery_date IS NULL
    )) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error_code', 'FULFILLMENT_STATUS_QUANTITY_INVALID');
  END IF;

  INSERT INTO public.procurement_purchase_order_fulfillment_events (
    purchase_order_id, idempotency_key, status, dispatched_quantity, delivered_quantity,
    unit, dispatch_date, carrier, tracking_reference, estimated_delivery_date,
    delivery_date, delivery_notes, created_by
  )
  VALUES (
    p_order_id, p_idempotency_key, p_status, p_dispatched_quantity,
    p_delivered_quantity, v_order.unit, p_dispatch_date,
    NULLIF(trim(p_carrier), ''), NULLIF(trim(p_tracking_reference), ''),
    p_estimated_delivery_date, p_delivery_date, NULLIF(trim(p_delivery_notes), ''),
    p_user_id
  )
  RETURNING id INTO v_event_id;

  UPDATE public.procurement_purchase_orders
  SET status = p_status,
      dispatched_quantity = v_dispatched_quantity,
      delivered_quantity = v_delivered_quantity,
      fulfillment_unit = v_order.unit,
      dispatch_date = COALESCE(p_dispatch_date, dispatch_date),
      carrier = COALESCE(NULLIF(trim(p_carrier), ''), carrier),
      tracking_reference = COALESCE(NULLIF(trim(p_tracking_reference), ''), tracking_reference),
      estimated_delivery_date = COALESCE(p_estimated_delivery_date, estimated_delivery_date),
      delivery_date = COALESCE(p_delivery_date, delivery_date),
      delivery_notes = COALESCE(NULLIF(trim(p_delivery_notes), ''), delivery_notes)
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', TRUE, 'event_id', v_event_id, 'duplicate', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.update_procurement_purchase_order_fulfillment(
  UUID, UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, DATE, TEXT, TEXT, DATE, DATE, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_procurement_purchase_order_fulfillment(
  UUID, UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, DATE, TEXT, TEXT, DATE, DATE, TEXT
) TO service_role;

COMMIT;
