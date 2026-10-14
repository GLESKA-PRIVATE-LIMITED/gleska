BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  event_key TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_audit_action_length CHECK (char_length(action) BETWEEN 1 AND 100),
  CONSTRAINT financial_audit_entity_length CHECK (char_length(entity_type) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_employer_created
  ON public.financial_audit_events (user_id, employer_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_financial_audit_entity
  ON public.financial_audit_events (employer_id, entity_type, entity_id, created_at DESC);

ALTER TABLE public.financial_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_audit_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.financial_audit_events TO authenticated;
GRANT SELECT, INSERT ON public.financial_audit_events TO service_role;
DROP POLICY IF EXISTS "Employers can view their financial audit events"
  ON public.financial_audit_events;
CREATE POLICY "Employers can view their financial audit events"
  ON public.financial_audit_events FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_audit_events.employer_id
        AND ep.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_financial_audit_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'FINANCIAL_AUDIT_EVENTS_ARE_APPEND_ONLY'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS prevent_financial_audit_event_update
  ON public.financial_audit_events;
CREATE TRIGGER prevent_financial_audit_event_update
  BEFORE UPDATE OR DELETE ON public.financial_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_audit_event_mutation();

CREATE TABLE IF NOT EXISTS public.financial_invoice_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 26214400),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CONFIRMED')),
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  extracted_text TEXT,
  extracted_result JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(extracted_result) = 'object'),
  reviewed_result JSONB CHECK (reviewed_result IS NULL OR jsonb_typeof(reviewed_result) = 'object'),
  confidence JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(confidence) = 'object'),
  error_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  upload_attempts INTEGER NOT NULL DEFAULT 0 CHECK (upload_attempts >= 0),
  confirmed_bill_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT financial_invoice_scans_confirmed_bill_check
    CHECK (status <> 'CONFIRMED' OR confirmed_bill_id IS NOT NULL),
  CONSTRAINT financial_invoice_scans_employer_hash_unique UNIQUE (employer_id, content_sha256),
  CONSTRAINT financial_invoice_scans_id_owner_unique UNIQUE (id, user_id, employer_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_invoice_scans_owner_created
  ON public.financial_invoice_scans (user_id, employer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_invoice_scans_owner_status
  ON public.financial_invoice_scans (user_id, employer_id, status);
DROP TRIGGER IF EXISTS update_financial_invoice_scans_updated_at
  ON public.financial_invoice_scans;
CREATE TRIGGER update_financial_invoice_scans_updated_at
  BEFORE UPDATE ON public.financial_invoice_scans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.financial_invoice_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_invoice_scans FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.financial_invoice_scans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_invoice_scans TO service_role;
DROP POLICY IF EXISTS "Employers can view their financial invoice scans"
  ON public.financial_invoice_scans;
CREATE POLICY "Employers can view their financial invoice scans"
  ON public.financial_invoice_scans FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_invoice_scans.employer_id
        AND ep.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.financial_vendor_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE RESTRICT,
  vendor_name TEXT,
  bill_number TEXT,
  bill_date DATE,
  due_date DATE,
  currency TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(line_items) = 'array'),
  subtotal NUMERIC(14, 2),
  tax_amount NUMERIC(14, 2),
  total NUMERIC(14, 2),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_vendor_bills_scan_owner_fk
    FOREIGN KEY (scan_id, user_id, employer_id)
    REFERENCES public.financial_invoice_scans(id, user_id, employer_id)
    ON DELETE RESTRICT,
  CONSTRAINT financial_vendor_bills_currency_check
    CHECK (currency IS NULL OR currency IN ('INR', 'USD', 'EUR')),
  CONSTRAINT financial_vendor_bills_amounts_nonnegative
    CHECK (
      (subtotal IS NULL OR subtotal >= 0)
      AND (tax_amount IS NULL OR tax_amount >= 0)
      AND (total IS NULL OR total >= 0)
    ),
  CONSTRAINT financial_vendor_bills_id_owner_unique UNIQUE (id, user_id, employer_id)
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'financial_invoice_scans_confirmed_bill_owner_fk'
      AND conrelid = 'public.financial_invoice_scans'::REGCLASS
  ) THEN
    ALTER TABLE public.financial_invoice_scans
      ADD CONSTRAINT financial_invoice_scans_confirmed_bill_owner_fk
      FOREIGN KEY (confirmed_bill_id, user_id, employer_id)
      REFERENCES public.financial_vendor_bills(id, user_id, employer_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_financial_vendor_bills_owner_confirmed
  ON public.financial_vendor_bills (user_id, employer_id, confirmed_at DESC);

ALTER TABLE public.financial_vendor_bills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_vendor_bills FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.financial_vendor_bills TO authenticated;
GRANT SELECT, INSERT ON public.financial_vendor_bills TO service_role;
DROP POLICY IF EXISTS "Employers can view their financial vendor bills"
  ON public.financial_vendor_bills;
CREATE POLICY "Employers can view their financial vendor bills"
  ON public.financial_vendor_bills FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_vendor_bills.employer_id
        AND ep.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.audit_financial_invoice_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_action TEXT;
  v_entity UUID;
  v_user UUID;
  v_employer UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := CASE WHEN NEW.status = 'GENERATED'
      THEN 'INVOICE_GENERATED' ELSE 'INVOICE_DRAFT_CREATED' END;
    v_entity := NEW.id;
    v_user := NEW.user_id;
    v_employer := NEW.employer_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) - ARRAY['updated_at'] IS NOT DISTINCT FROM
       to_jsonb(NEW) - ARRAY['updated_at'] THEN
      RETURN NEW;
    END IF;
    v_action := CASE
      WHEN OLD.status <> 'GENERATED' AND NEW.status = 'GENERATED'
        THEN 'INVOICE_GENERATED'
      ELSE 'INVOICE_DRAFT_UPDATED'
    END;
    v_entity := NEW.id;
    v_user := NEW.user_id;
    v_employer := NEW.employer_id;
  ELSE
    v_action := 'INVOICE_DRAFT_DELETED';
    v_entity := OLD.id;
    v_user := OLD.user_id;
    v_employer := OLD.employer_id;
  END IF;

  INSERT INTO public.financial_audit_events (
    user_id, employer_id, actor_user_id, action, outcome, entity_type, entity_id,
    event_key, metadata
  )
  VALUES (
    v_user, v_employer, v_user, v_action, 'SUCCESS', 'invoice', v_entity,
    'invoice:' || v_entity::TEXT || ':' || v_action ||
      CASE WHEN TG_OP = 'UPDATE' THEN ':' || NEW.updated_at::TEXT ELSE '' END,
    jsonb_build_object('invoice_number', CASE WHEN TG_OP = 'DELETE'
      THEN OLD.invoice_number ELSE NEW.invoice_number END)
  )
  ON CONFLICT (event_key) DO NOTHING;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS financial_audit_invoice_insert
  ON public.financial_invoices;
DROP TRIGGER IF EXISTS financial_audit_invoice_update
  ON public.financial_invoices;
DROP TRIGGER IF EXISTS financial_audit_invoice_delete
  ON public.financial_invoices;
CREATE TRIGGER financial_audit_invoice_insert
  AFTER INSERT ON public.financial_invoices
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_invoice_change();
CREATE TRIGGER financial_audit_invoice_update
  AFTER UPDATE ON public.financial_invoices
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_invoice_change();
CREATE TRIGGER financial_audit_invoice_delete
  AFTER DELETE ON public.financial_invoices
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_invoice_change();

CREATE OR REPLACE FUNCTION public.audit_financial_invoice_draft_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.action = 'DRAFT_UPDATED' AND NOT EXISTS (
    SELECT 1
    FROM public.financial_audit_events central_event
    WHERE central_event.user_id = NEW.user_id
      AND central_event.employer_id = NEW.employer_id
      AND central_event.entity_type = 'invoice'
      AND central_event.entity_id = NEW.invoice_id
      AND central_event.action = 'INVOICE_DRAFT_UPDATED'
      AND central_event.created_at = NEW.created_at
  ) THEN
    INSERT INTO public.financial_audit_events (
      user_id, employer_id, actor_user_id, action, outcome, entity_type, entity_id,
      event_key, metadata, created_at
    )
    VALUES (
      NEW.user_id, NEW.employer_id, NEW.actor_user_id, 'INVOICE_DRAFT_UPDATED',
      'SUCCESS', 'invoice', NEW.invoice_id,
      'invoice-legacy-audit:' || NEW.id::TEXT,
      jsonb_build_object('invoice_number', NEW.invoice_number), NEW.created_at
    )
    ON CONFLICT (event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financial_audit_invoice_draft_update
  ON public.financial_invoice_audit_events;
CREATE TRIGGER financial_audit_invoice_draft_update
  AFTER INSERT ON public.financial_invoice_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_invoice_draft_update();

INSERT INTO public.financial_audit_events (
  user_id, employer_id, actor_user_id, action, outcome, entity_type, entity_id,
  event_key, metadata, created_at
)
SELECT legacy.user_id,
       legacy.employer_id,
       legacy.actor_user_id,
       CASE legacy.action
         WHEN 'DRAFT_CREATED' THEN 'INVOICE_DRAFT_CREATED'
         WHEN 'DRAFT_UPDATED' THEN 'INVOICE_DRAFT_UPDATED'
         WHEN 'INVOICE_GENERATED' THEN 'INVOICE_GENERATED'
         WHEN 'DRAFT_DELETED' THEN 'INVOICE_DRAFT_DELETED'
       END,
       'SUCCESS',
       'invoice',
       legacy.invoice_id,
       'legacy-invoice-audit:' || legacy.id::TEXT,
       jsonb_build_object('invoice_number', legacy.invoice_number, 'status', legacy.status),
       legacy.created_at
FROM public.financial_invoice_audit_events legacy
ON CONFLICT (event_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.audit_financial_settings_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_metadata JSONB := '{}'::JSONB;
  v_changes JSONB := '[]'::JSONB;
  v_event_key TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changes := jsonb_build_array(
      jsonb_build_object('setting', 'base_currency', 'before', NULL, 'after', NEW.base_currency),
      jsonb_build_object('setting', 'tax_identifier', 'before', NULL,
        'after', CASE WHEN NEW.tax_identifier = '' THEN 'not_configured' ELSE 'configured' END),
      jsonb_build_object('setting', 'auto_reconcile_incoming_bills', 'before', NULL,
        'after', NEW.auto_reconcile_incoming_bills)
    );
  ELSE
    IF OLD.base_currency IS DISTINCT FROM NEW.base_currency THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'setting', 'base_currency', 'before', OLD.base_currency, 'after', NEW.base_currency
      ));
    END IF;
    IF OLD.tax_identifier IS DISTINCT FROM NEW.tax_identifier THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'setting', 'tax_identifier',
        'before', CASE WHEN OLD.tax_identifier = '' THEN 'not_configured' ELSE 'configured' END,
        'after', CASE WHEN NEW.tax_identifier = '' THEN 'not_configured' ELSE 'configured' END
      ));
    END IF;
    IF OLD.auto_reconcile_incoming_bills IS DISTINCT FROM NEW.auto_reconcile_incoming_bills THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'setting', 'auto_reconcile_incoming_bills',
        'before', OLD.auto_reconcile_incoming_bills,
        'after', NEW.auto_reconcile_incoming_bills
      ));
    END IF;
    IF jsonb_array_length(v_changes) = 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  v_metadata := jsonb_build_object('changes', v_changes);
  v_event_key := 'settings:' || NEW.employer_id::TEXT || ':' || NEW.updated_at::TEXT;
  INSERT INTO public.financial_audit_events (
    user_id, employer_id, actor_user_id, action, outcome, entity_type, entity_id,
    event_key, metadata
  )
  VALUES (
    NEW.user_id, NEW.employer_id, NEW.user_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'FINANCIAL_SETTINGS_CREATED' ELSE 'FINANCIAL_SETTINGS_UPDATED' END,
    'SUCCESS', 'financial_settings', NEW.id, v_event_key, v_metadata
  )
  ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financial_audit_settings_insert
  ON public.financial_settings;
DROP TRIGGER IF EXISTS financial_audit_settings_update
  ON public.financial_settings;
CREATE TRIGGER financial_audit_settings_insert
  AFTER INSERT ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_settings_change();
CREATE TRIGGER financial_audit_settings_update
  AFTER UPDATE ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_settings_change();

CREATE OR REPLACE FUNCTION public.confirm_financial_invoice_scan(
  p_scan_id UUID,
  p_user_id UUID,
  p_employer_id UUID,
  p_reviewed_result JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_scan public.financial_invoice_scans%ROWTYPE;
  v_bill public.financial_vendor_bills%ROWTYPE;
  v_data JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_SCAN_AUTHORIZATION_FAILED'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employer_profiles ep
    WHERE ep.id = p_employer_id AND ep.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'FINANCIAL_EMPLOYER_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_reviewed_result) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'FINANCIAL_SCAN_RESULT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scan
  FROM public.financial_invoice_scans
  WHERE id = p_scan_id AND user_id = p_user_id AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCIAL_SCAN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_scan.status = 'CONFIRMED' THEN
    SELECT * INTO v_bill FROM public.financial_vendor_bills
    WHERE id = v_scan.confirmed_bill_id
      AND user_id = p_user_id AND employer_id = p_employer_id;
    RETURN to_jsonb(v_bill);
  END IF;
  IF v_scan.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'FINANCIAL_SCAN_NOT_READY' USING ERRCODE = '55000';
  END IF;

  v_data := p_reviewed_result;
  INSERT INTO public.financial_vendor_bills (
    scan_id, user_id, employer_id, vendor_name, bill_number, bill_date, due_date,
    currency, line_items, subtotal, tax_amount, total
  )
  VALUES (
    v_scan.id, p_user_id, p_employer_id,
    NULLIF(v_data ->> 'vendor_name', ''),
    NULLIF(v_data ->> 'bill_number', ''),
    NULLIF(v_data ->> 'bill_date', '')::DATE,
    NULLIF(v_data ->> 'due_date', '')::DATE,
    NULLIF(v_data ->> 'currency', ''),
    COALESCE(v_data -> 'line_items', '[]'::JSONB),
    NULLIF(v_data ->> 'subtotal', '')::NUMERIC,
    NULLIF(v_data ->> 'tax_amount', '')::NUMERIC,
    NULLIF(v_data ->> 'total', '')::NUMERIC
  )
  RETURNING * INTO v_bill;

  UPDATE public.financial_invoice_scans
  SET reviewed_result = v_data, status = 'CONFIRMED', confirmed_bill_id = v_bill.id,
      updated_at = NOW(), processed_at = COALESCE(processed_at, NOW())
  WHERE id = v_scan.id;

  INSERT INTO public.financial_audit_events (
    user_id, employer_id, actor_user_id, action, outcome, entity_type, entity_id,
    event_key, metadata
  )
  VALUES (
    p_user_id, p_employer_id, p_user_id, 'SCAN_CONVERTED_TO_FINANCIAL_BILL',
    'SUCCESS', 'financial_vendor_bill', v_bill.id,
    'scan:' || v_scan.id::TEXT || ':confirmed',
    jsonb_build_object('scan_id', v_scan.id)
  )
  ON CONFLICT (event_key) DO NOTHING;
  RETURN to_jsonb(v_bill);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_financial_invoice_scan(UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_financial_invoice_scan(UUID, UUID, UUID, JSONB)
  TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'financial-invoice-scans',
  'financial-invoice-scans',
  FALSE,
  26214400,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = 26214400,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
