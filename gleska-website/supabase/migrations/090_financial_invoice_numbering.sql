BEGIN;

CREATE TABLE public.financial_invoice_counters (
  employer_id UUID PRIMARY KEY
    REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  last_number BIGINT NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.financial_invoice_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_invoice_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.financial_invoice_counters TO service_role;

CREATE OR REPLACE FUNCTION public.create_financial_invoice(
  p_user_id UUID,
  p_employer_id UUID,
  p_client_name TEXT,
  p_issue_date DATE,
  p_due_date DATE,
  p_payment_terms_notes TEXT,
  p_currency TEXT,
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
  v_counter public.financial_invoice_counters%ROWTYPE;
  v_invoice public.financial_invoices%ROWTYPE;
  v_line_item JSONB;
  v_invoice_number TEXT;
  v_existing_max BIGINT;
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

  INSERT INTO public.financial_invoice_counters (employer_id)
  VALUES (p_employer_id)
  ON CONFLICT (employer_id) DO NOTHING;

  SELECT *
  INTO v_counter
  FROM public.financial_invoice_counters
  WHERE employer_id = p_employer_id
  FOR UPDATE;

  SELECT COALESCE(
    MAX(substring(invoice_number FROM '^INV-([0-9]+)$')::BIGINT),
    0
  )
  INTO v_existing_max
  FROM public.financial_invoices
  WHERE employer_id = p_employer_id;

  v_counter.last_number := GREATEST(v_counter.last_number, v_existing_max);

  LOOP
    v_counter.last_number := v_counter.last_number + 1;
    v_invoice_number := 'INV-' || CASE
      WHEN length(v_counter.last_number::TEXT) < 6
        THEN lpad(v_counter.last_number::TEXT, 6, '0')
      ELSE v_counter.last_number::TEXT
    END;

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.financial_invoices
      WHERE employer_id = p_employer_id
        AND invoice_number = v_invoice_number
    );
  END LOOP;

  UPDATE public.financial_invoice_counters
  SET last_number = v_counter.last_number,
      updated_at = NOW()
  WHERE employer_id = p_employer_id;

  INSERT INTO public.financial_invoices (
    user_id,
    employer_id,
    invoice_number,
    client_name,
    issue_date,
    due_date,
    payment_terms_notes,
    currency,
    tax_rate,
    subtotal,
    tax_amount,
    total,
    status
  )
  VALUES (
    p_user_id,
    p_employer_id,
    v_invoice_number,
    p_client_name,
    p_issue_date,
    p_due_date,
    p_payment_terms_notes,
    p_currency,
    p_tax_rate,
    p_subtotal,
    p_tax_amount,
    p_total,
    p_status
  )
  RETURNING * INTO v_invoice;

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

REVOKE ALL ON FUNCTION public.create_financial_invoice(
  UUID, UUID, TEXT, DATE, DATE, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_financial_invoice(
  UUID, UUID, TEXT, DATE, DATE, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, JSONB
) TO service_role;

COMMIT;
