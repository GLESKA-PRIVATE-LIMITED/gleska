BEGIN;

-- Requires financial tables from 088 and update RPC from 091; does not backfill history.
CREATE TABLE IF NOT EXISTS public.financial_invoice_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  employer_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  invoice_number TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('DRAFT_CREATED', 'DRAFT_UPDATED', 'INVOICE_GENERATED', 'DRAFT_DELETED')
  ),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'GENERATED', 'DELETED')),
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_invoice_audit_once_per_invoice_action
  ON public.financial_invoice_audit_events (invoice_id, action)
  WHERE action <> 'DRAFT_UPDATED';
CREATE INDEX IF NOT EXISTS idx_financial_invoice_audit_owner_created
  ON public.financial_invoice_audit_events (user_id, employer_id, created_at DESC);

ALTER TABLE public.financial_invoice_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_invoice_audit_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.financial_invoice_audit_events TO authenticated;
GRANT SELECT, INSERT ON public.financial_invoice_audit_events TO service_role;

DROP POLICY IF EXISTS "Employers can view their financial invoice audit events"
  ON public.financial_invoice_audit_events;
CREATE POLICY "Employers can view their financial invoice audit events"
  ON public.financial_invoice_audit_events FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.employer_profiles ep
      WHERE ep.id = financial_invoice_audit_events.employer_id
        AND ep.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_financial_invoice_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'FINANCIAL_INVOICE_AUDIT_EVENTS_ARE_APPEND_ONLY'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS prevent_financial_invoice_audit_update
  ON public.financial_invoice_audit_events;
CREATE TRIGGER prevent_financial_invoice_audit_update
  BEFORE UPDATE OR DELETE ON public.financial_invoice_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_invoice_audit_mutation();

CREATE OR REPLACE FUNCTION public.record_financial_invoice_insert_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.financial_invoice_audit_events (
    user_id, employer_id, invoice_id, invoice_number, action, status, actor_user_id
  )
  VALUES (
    NEW.user_id,
    NEW.employer_id,
    NEW.id,
    NEW.invoice_number,
    CASE WHEN NEW.status = 'GENERATED' THEN 'INVOICE_GENERATED' ELSE 'DRAFT_CREATED' END,
    NEW.status,
    NEW.user_id
  )
  ON CONFLICT (invoice_id, action)
    WHERE action <> 'DRAFT_UPDATED'
    DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_financial_invoice_delete_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.financial_invoice_audit_events (
    user_id, employer_id, invoice_id, invoice_number, action, status, actor_user_id
  )
  VALUES (
    OLD.user_id,
    OLD.employer_id,
    OLD.id,
    OLD.invoice_number,
    'DRAFT_DELETED',
    'DELETED',
    OLD.user_id
  )
  ON CONFLICT (invoice_id, action)
    WHERE action <> 'DRAFT_UPDATED'
    DO NOTHING;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS financial_invoice_insert_audit
  ON public.financial_invoices;
CREATE TRIGGER financial_invoice_insert_audit
  AFTER INSERT ON public.financial_invoices
  FOR EACH ROW EXECUTE FUNCTION public.record_financial_invoice_insert_audit();

CREATE OR REPLACE FUNCTION public.prevent_generated_financial_invoice_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'GENERATED_INVOICE_CANNOT_BE_DELETED'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_generated_financial_invoice_delete
  ON public.financial_invoices;
CREATE TRIGGER prevent_generated_financial_invoice_delete
  BEFORE DELETE ON public.financial_invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_generated_financial_invoice_delete();

DROP TRIGGER IF EXISTS financial_invoice_delete_audit
  ON public.financial_invoices;
CREATE TRIGGER financial_invoice_delete_audit
  AFTER DELETE ON public.financial_invoices
  FOR EACH ROW EXECUTE FUNCTION public.record_financial_invoice_delete_audit();

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
  v_before_invoice JSONB;
  v_requested_invoice JSONB;
  v_before_items JSONB;
  v_requested_items JSONB;
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

  v_before_invoice := jsonb_build_object(
    'client_name', v_invoice.client_name,
    'issue_date', v_invoice.issue_date,
    'due_date', v_invoice.due_date,
    'payment_terms_notes', v_invoice.payment_terms_notes,
    'tax_rate', v_invoice.tax_rate,
    'subtotal', v_invoice.subtotal,
    'tax_amount', v_invoice.tax_amount,
    'total', v_invoice.total,
    'status', v_invoice.status
  );
  v_requested_invoice := jsonb_build_object(
    'client_name', p_client_name,
    'issue_date', p_issue_date,
    'due_date', p_due_date,
    'payment_terms_notes', p_payment_terms_notes,
    'tax_rate', p_tax_rate,
    'subtotal', p_subtotal,
    'tax_amount', p_tax_amount,
    'total', p_total,
    'status', p_status
  );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'description', item_row.description,
        'quantity', item_row.quantity,
        'unit_price', item_row.unit_price,
        'line_total', item_row.line_total
      )
      ORDER BY item_row.description, item_row.quantity, item_row.unit_price, item_row.line_total
    ),
    '[]'::JSONB
  )
  INTO v_before_items
  FROM public.financial_invoice_items item_row
  WHERE item_row.invoice_id = v_invoice.id
    AND item_row.user_id = p_user_id
    AND item_row.employer_id = p_employer_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'description', requested.value ->> 'description',
        'quantity', (requested.value ->> 'quantity')::NUMERIC,
        'unit_price', (requested.value ->> 'unit_price')::NUMERIC,
        'line_total', (requested.value ->> 'line_total')::NUMERIC
      )
      ORDER BY
        requested.value ->> 'description',
        (requested.value ->> 'quantity')::NUMERIC,
        (requested.value ->> 'unit_price')::NUMERIC,
        (requested.value ->> 'line_total')::NUMERIC
    ),
    '[]'::JSONB
  )
  INTO v_requested_items
  FROM jsonb_array_elements(p_line_items) AS requested(value);

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

  IF v_before_invoice IS DISTINCT FROM v_requested_invoice
     OR v_before_items IS DISTINCT FROM v_requested_items THEN
    INSERT INTO public.financial_invoice_audit_events (
      user_id, employer_id, invoice_id, invoice_number, action, status, actor_user_id
    )
    VALUES (
      p_user_id,
      p_employer_id,
      v_invoice.id,
      v_invoice.invoice_number,
      CASE WHEN p_status = 'GENERATED' THEN 'INVOICE_GENERATED' ELSE 'DRAFT_UPDATED' END,
      p_status,
      p_user_id
    );
  END IF;

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
