BEGIN;

CREATE TABLE public.financial_invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payment_reference TEXT CHECK (
    payment_reference IS NULL OR char_length(payment_reference) <= 120
  ),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  idempotency_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_invoice_payments_invoice_owner_fk
    FOREIGN KEY (invoice_id, user_id, employer_id)
    REFERENCES public.financial_invoices(id, user_id, employer_id)
    ON DELETE RESTRICT,
  CONSTRAINT financial_invoice_payments_employer_idempotency_unique
    UNIQUE (employer_id, idempotency_key)
);

CREATE INDEX idx_financial_invoice_payments_invoice_date
  ON public.financial_invoice_payments
    (user_id, employer_id, invoice_id, payment_date DESC, created_at DESC);

ALTER TABLE public.financial_invoice_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_invoice_payments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.financial_invoice_payments TO authenticated, service_role;
DROP POLICY IF EXISTS "Employers can view their financial invoice payments"
  ON public.financial_invoice_payments;
CREATE POLICY "Employers can view their financial invoice payments"
  ON public.financial_invoice_payments FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_invoice_payments.employer_id
        AND ep.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_financial_invoice_payment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'FINANCIAL_INVOICE_PAYMENTS_ARE_APPEND_ONLY'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER prevent_financial_invoice_payment_update
  BEFORE UPDATE OR DELETE ON public.financial_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_invoice_payment_mutation();

CREATE OR REPLACE FUNCTION public.record_financial_invoice_payment(
  p_invoice_id UUID,
  p_user_id UUID,
  p_employer_id UUID,
  p_amount NUMERIC,
  p_payment_date DATE,
  p_payment_reference TEXT,
  p_notes TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.financial_invoices%ROWTYPE;
  v_payment public.financial_invoice_payments%ROWTYPE;
  v_existing_paid NUMERIC(14, 2);
  v_created BOOLEAN := FALSE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_PAYMENT_AUTHORIZATION_FAILED'
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

  IF p_amount IS NULL OR p_amount <= 0
     OR p_payment_date IS NULL
     OR p_idempotency_key IS NULL
     OR char_length(COALESCE(p_payment_reference, '')) > 120
     OR char_length(COALESCE(p_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'PAYMENT_INPUT_INVALID' USING ERRCODE = '22023';
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
  IF v_invoice.status <> 'GENERATED' THEN
    RAISE EXCEPTION 'INVOICE_NOT_GENERATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.financial_invoice_payments
  WHERE employer_id = p_employer_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_payment.invoice_id IS DISTINCT FROM p_invoice_id
       OR v_payment.user_id IS DISTINCT FROM p_user_id
       OR v_payment.amount IS DISTINCT FROM p_amount
       OR v_payment.payment_date IS DISTINCT FROM p_payment_date
       OR v_payment.payment_reference IS DISTINCT FROM NULLIF(p_payment_reference, '')
       OR v_payment.notes IS DISTINCT FROM COALESCE(p_notes, '') THEN
      RAISE EXCEPTION 'PAYMENT_IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
    END IF;
    RETURN to_jsonb(v_payment) || jsonb_build_object('currency', v_invoice.currency);
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_existing_paid
  FROM public.financial_invoice_payments
  WHERE invoice_id = p_invoice_id
    AND user_id = p_user_id
    AND employer_id = p_employer_id;
  IF p_amount > v_invoice.total - v_existing_paid THEN
    RAISE EXCEPTION 'PAYMENT_EXCEEDS_OUTSTANDING' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.financial_invoice_payments (
      invoice_id, user_id, employer_id, amount, payment_date,
      payment_reference, notes, idempotency_key
    )
    VALUES (
      p_invoice_id, p_user_id, p_employer_id, p_amount, p_payment_date,
      NULLIF(p_payment_reference, ''), COALESCE(p_notes, ''), p_idempotency_key
    )
    RETURNING * INTO v_payment;
    v_created := TRUE;
  EXCEPTION WHEN unique_violation THEN
    SELECT *
    INTO v_payment
    FROM public.financial_invoice_payments
    WHERE employer_id = p_employer_id
      AND idempotency_key = p_idempotency_key;
    IF NOT FOUND
       OR v_payment.invoice_id IS DISTINCT FROM p_invoice_id
       OR v_payment.user_id IS DISTINCT FROM p_user_id
       OR v_payment.amount IS DISTINCT FROM p_amount
       OR v_payment.payment_date IS DISTINCT FROM p_payment_date
       OR v_payment.payment_reference IS DISTINCT FROM NULLIF(p_payment_reference, '')
       OR v_payment.notes IS DISTINCT FROM COALESCE(p_notes, '') THEN
      RAISE EXCEPTION 'PAYMENT_IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
    END IF;
  END;

  IF v_created THEN
    INSERT INTO public.financial_audit_events (
      user_id, employer_id, actor_user_id, action, outcome, entity_type, entity_id,
      event_key, metadata
    )
    VALUES (
      p_user_id, p_employer_id, p_user_id, 'INVOICE_PAYMENT_RECORDED', 'SUCCESS',
      'financial_invoice_payment', v_payment.id,
      'invoice-payment:' || v_payment.id::TEXT || ':recorded',
      jsonb_build_object(
        'invoice_id', p_invoice_id,
        'invoice_number', v_invoice.invoice_number,
        'amount', v_payment.amount,
        'currency', v_invoice.currency
      )
    )
    ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN to_jsonb(v_payment) || jsonb_build_object('currency', v_invoice.currency);
END;
$$;

REVOKE ALL ON FUNCTION public.record_financial_invoice_payment(
  UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_financial_invoice_payment(
  UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT, UUID
) TO service_role;

COMMIT;
