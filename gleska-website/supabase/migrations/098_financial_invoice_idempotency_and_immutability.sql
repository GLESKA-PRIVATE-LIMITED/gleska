BEGIN;

CREATE TABLE public.financial_invoice_idempotency (
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  request_payload JSONB NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  -- Keep replay responses stable even if a draft invoice is later deleted.
  invoice_id UUID NOT NULL,
  response_payload JSONB NOT NULL CHECK (jsonb_typeof(response_payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employer_id, idempotency_key)
);

ALTER TABLE public.financial_invoice_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.financial_invoice_idempotency FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.financial_invoice_idempotency TO service_role;
CREATE POLICY "Service role can access financial invoice idempotency"
  ON public.financial_invoice_idempotency FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.create_financial_invoice_idempotent(
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
  p_line_items JSONB,
  p_idempotency_key UUID,
  p_request_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request_payload JSONB;
  v_existing public.financial_invoice_idempotency%ROWTYPE;
  v_response JSONB;
  v_invoice_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_INVOICE_AUTHORIZATION_FAILED'
      USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'FINANCIAL_INVOICE_IDEMPOTENCY_KEY_REQUIRED'
      USING ERRCODE = '22023';
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

  IF jsonb_typeof(p_request_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'FINANCIAL_INVOICE_INPUT_INVALID'
      USING ERRCODE = '22023';
  END IF;
  v_request_payload := p_request_payload;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_employer_id::TEXT || ':' || p_idempotency_key::TEXT, 0)
  );

  SELECT *
  INTO v_existing
  FROM public.financial_invoice_idempotency
  WHERE employer_id = p_employer_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.request_payload IS DISTINCT FROM v_request_payload THEN
      RAISE EXCEPTION 'INVOICE_IDEMPOTENCY_KEY_REUSED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing.response_payload;
  END IF;

  v_response := public.create_financial_invoice(
    p_user_id,
    p_employer_id,
    p_client_name,
    p_issue_date,
    p_due_date,
    p_payment_terms_notes,
    p_currency,
    p_tax_rate,
    p_subtotal,
    p_tax_amount,
    p_total,
    p_status,
    p_line_items
  );
  v_invoice_id := (v_response ->> 'id')::UUID;

  INSERT INTO public.financial_invoice_idempotency (
    employer_id,
    idempotency_key,
    user_id,
    request_payload,
    invoice_id,
    response_payload
  )
  VALUES (
    p_employer_id,
    p_idempotency_key,
    p_user_id,
    v_request_payload,
    v_invoice_id,
    v_response
  );

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.create_financial_invoice_idempotent(
  UUID, UUID, TEXT, DATE, DATE, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, JSONB, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_financial_invoice_idempotent(
  UUID, UUID, TEXT, DATE, DATE, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, JSONB, UUID, JSONB
) TO service_role;

REVOKE ALL ON TABLE
  public.financial_invoices,
  public.financial_invoice_items
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE
  public.financial_invoices,
  public.financial_invoice_items
TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.financial_invoices,
  public.financial_invoice_items
TO service_role;

DROP POLICY IF EXISTS "Employers can access their financial invoices"
  ON public.financial_invoices;
CREATE POLICY "Employers can read their financial invoices"
  ON public.financial_invoices FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_invoices.employer_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Employers can access their financial invoice items"
  ON public.financial_invoice_items;
CREATE POLICY "Employers can read their financial invoice items"
  ON public.financial_invoice_items FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_invoice_items.employer_id
        AND ep.user_id = auth.uid()
    )
  );

COMMIT;
