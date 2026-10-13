BEGIN;

CREATE OR REPLACE FUNCTION public.update_financial_invoice_draft(
  p_invoice_id UUID,
  p_user_id UUID,
  p_employer_id UUID,
  p_client_name TEXT,
  p_issue_date DATE,
  p_due_date DATE,
  p_payment_terms_notes TEXT,
  p_tax_rate NUMERIC,
  p_subtotal NUMERIC,
  p_tax_amount NUMERIC,
  p_total NUMERIC,
  p_status TEXT,
  p_line_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.financial_invoices%ROWTYPE;
  v_line_item JSONB;
  v_items JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_INVOICE_AUTHORIZATION_FAILED'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.employer_profiles ep ON ep.user_id = u.id
    WHERE u.id = p_user_id
      AND u.role::TEXT = 'EMPLOYER'
      AND ep.id = p_employer_id
  ) THEN
    RAISE EXCEPTION 'FINANCIAL_EMPLOYER_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('DRAFT', 'GENERATED')
     OR jsonb_typeof(p_line_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'FINANCIAL_INVOICE_INPUT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_line_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'FINANCIAL_INVOICE_INPUT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.financial_invoices
  WHERE id = p_invoice_id
    AND user_id = p_user_id
    AND employer_id = p_employer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'INVOICE_ALREADY_GENERATED' USING ERRCODE = '55000';
  END IF;

  UPDATE public.financial_invoices
  SET client_name = p_client_name,
      issue_date = p_issue_date,
      due_date = p_due_date,
      payment_terms_notes = p_payment_terms_notes,
      tax_rate = p_tax_rate,
      subtotal = p_subtotal,
      tax_amount = p_tax_amount,
      total = p_total,
      status = p_status
  WHERE id = v_invoice.id
  RETURNING * INTO v_invoice;

  DELETE FROM public.financial_invoice_items
  WHERE invoice_id = v_invoice.id
    AND user_id = p_user_id
    AND employer_id = p_employer_id;

  FOR v_line_item IN
    SELECT value FROM jsonb_array_elements(p_line_items)
  LOOP
    INSERT INTO public.financial_invoice_items (
      invoice_id,
      user_id,
      employer_id,
      description,
      quantity,
      unit_price,
      line_total
    )
    VALUES (
      v_invoice.id,
      p_user_id,
      p_employer_id,
      v_line_item ->> 'description',
      (v_line_item ->> 'quantity')::NUMERIC,
      (v_line_item ->> 'unit_price')::NUMERIC,
      (v_line_item ->> 'line_total')::NUMERIC
    );
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(item_row) ORDER BY item_row.created_at, item_row.id),
    '[]'::JSONB
  )
  INTO v_items
  FROM public.financial_invoice_items item_row
  WHERE item_row.invoice_id = v_invoice.id
    AND item_row.user_id = p_user_id
    AND item_row.employer_id = p_employer_id;

  RETURN to_jsonb(v_invoice)
    || jsonb_build_object('financial_invoice_items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.update_financial_invoice_draft(
  UUID, UUID, UUID, TEXT, DATE, DATE, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_financial_invoice_draft(
  UUID, UUID, UUID, TEXT, DATE, DATE, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, JSONB
) TO service_role;

COMMIT;
