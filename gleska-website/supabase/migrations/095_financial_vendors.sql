BEGIN;

CREATE TABLE public.financial_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE RESTRICT,
  vendor_name TEXT NOT NULL CHECK (char_length(btrim(vendor_name)) BETWEEN 1 AND 240),
  normalized_name TEXT GENERATED ALWAYS AS (
    lower(btrim(regexp_replace(vendor_name, '[[:space:]]+', ' ', 'g')))
  ) STORED,
  contact_email TEXT CHECK (
    contact_email IS NULL OR char_length(contact_email) <= 254
  ),
  contact_phone TEXT CHECK (
    contact_phone IS NULL OR char_length(contact_phone) <= 40
  ),
  address TEXT CHECK (address IS NULL OR char_length(address) <= 1000),
  tax_identifier TEXT CHECK (
    tax_identifier IS NULL OR char_length(tax_identifier) <= 64
  ),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_vendors_employer_normalized_name_unique
    UNIQUE (employer_id, normalized_name),
  CONSTRAINT financial_vendors_id_owner_unique UNIQUE (id, user_id, employer_id)
);

CREATE INDEX idx_financial_vendors_owner_active_name
  ON public.financial_vendors (user_id, employer_id, is_active, normalized_name);

DROP TRIGGER IF EXISTS update_financial_vendors_updated_at
  ON public.financial_vendors;
CREATE TRIGGER update_financial_vendors_updated_at
  BEFORE UPDATE ON public.financial_vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.financial_vendors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_vendors FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.financial_vendors TO authenticated, service_role;
DROP POLICY IF EXISTS "Employers can view their financial vendors"
  ON public.financial_vendors;
CREATE POLICY "Employers can view their financial vendors"
  ON public.financial_vendors FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_vendors.employer_id
        AND ep.user_id = auth.uid()
    )
  );

ALTER TABLE public.financial_vendor_bills
  ADD COLUMN vendor_id UUID;
ALTER TABLE public.financial_vendor_bills
  ADD CONSTRAINT financial_vendor_bills_vendor_owner_fk
  FOREIGN KEY (vendor_id, user_id, employer_id)
  REFERENCES public.financial_vendors(id, user_id, employer_id)
  ON DELETE RESTRICT;

CREATE INDEX idx_financial_vendor_bills_vendor_owner_confirmed
  ON public.financial_vendor_bills
    (user_id, employer_id, vendor_id, confirmed_at DESC);

CREATE OR REPLACE FUNCTION public.create_financial_vendor(
  p_user_id UUID,
  p_employer_id UUID,
  p_vendor_name TEXT,
  p_contact_email TEXT,
  p_contact_phone TEXT,
  p_address TEXT,
  p_tax_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_vendor public.financial_vendors%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_VENDOR_AUTHORIZATION_FAILED'
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
  IF p_vendor_name IS NULL OR char_length(btrim(p_vendor_name)) NOT BETWEEN 1 AND 240
     OR char_length(COALESCE(p_contact_email, '')) > 254
     OR char_length(COALESCE(p_contact_phone, '')) > 40
     OR char_length(COALESCE(p_address, '')) > 1000
     OR char_length(COALESCE(p_tax_identifier, '')) > 64 THEN
    RAISE EXCEPTION 'FINANCIAL_VENDOR_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.financial_vendors (
    user_id, employer_id, vendor_name, contact_email, contact_phone, address, tax_identifier
  )
  VALUES (
    p_user_id, p_employer_id, btrim(regexp_replace(p_vendor_name, '[[:space:]]+', ' ', 'g')),
    NULLIF(btrim(p_contact_email), ''),
    NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(regexp_replace(p_address, '[[:space:]]+', ' ', 'g')), ''),
    NULLIF(btrim(p_tax_identifier), '')
  )
  RETURNING * INTO v_vendor;
  RETURN to_jsonb(v_vendor);
END;
$$;

REVOKE ALL ON FUNCTION public.create_financial_vendor(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_financial_vendor(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.update_financial_vendor(
  p_vendor_id UUID,
  p_user_id UUID,
  p_employer_id UUID,
  p_vendor_name TEXT,
  p_contact_email TEXT,
  p_contact_phone TEXT,
  p_address TEXT,
  p_tax_identifier TEXT,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_vendor public.financial_vendors%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_VENDOR_AUTHORIZATION_FAILED'
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
  IF p_vendor_name IS NULL OR char_length(btrim(p_vendor_name)) NOT BETWEEN 1 AND 240
     OR p_is_active IS NULL
     OR char_length(COALESCE(p_contact_email, '')) > 254
     OR char_length(COALESCE(p_contact_phone, '')) > 40
     OR char_length(COALESCE(p_address, '')) > 1000
     OR char_length(COALESCE(p_tax_identifier, '')) > 64 THEN
    RAISE EXCEPTION 'FINANCIAL_VENDOR_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_vendor
  FROM public.financial_vendors
  WHERE id = p_vendor_id AND user_id = p_user_id AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCIAL_VENDOR_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.financial_vendors
  SET vendor_name = btrim(regexp_replace(p_vendor_name, '[[:space:]]+', ' ', 'g')),
      contact_email = NULLIF(btrim(p_contact_email), ''),
      contact_phone = NULLIF(btrim(p_contact_phone), ''),
      address = NULLIF(btrim(regexp_replace(p_address, '[[:space:]]+', ' ', 'g')), ''),
      tax_identifier = NULLIF(btrim(p_tax_identifier), ''),
      is_active = p_is_active
  WHERE id = p_vendor_id AND user_id = p_user_id AND employer_id = p_employer_id
  RETURNING * INTO v_vendor;
  RETURN to_jsonb(v_vendor);
END;
$$;

REVOKE ALL ON FUNCTION public.update_financial_vendor(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_financial_vendor(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO service_role;

CREATE OR REPLACE FUNCTION public.link_financial_vendor_bill(
  p_bill_id UUID,
  p_user_id UUID,
  p_employer_id UUID,
  p_vendor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_bill public.financial_vendor_bills%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_VENDOR_AUTHORIZATION_FAILED'
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

  SELECT * INTO v_bill
  FROM public.financial_vendor_bills
  WHERE id = p_bill_id AND user_id = p_user_id AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCIAL_VENDOR_BILL_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_vendors
    WHERE id = p_vendor_id AND user_id = p_user_id AND employer_id = p_employer_id
  ) THEN
    RAISE EXCEPTION 'FINANCIAL_VENDOR_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_bill.vendor_id IS NOT NULL AND v_bill.vendor_id IS DISTINCT FROM p_vendor_id THEN
    RAISE EXCEPTION 'FINANCIAL_VENDOR_BILL_ALREADY_LINKED'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_bill.vendor_id IS NULL THEN
    UPDATE public.financial_vendor_bills
    SET vendor_id = p_vendor_id
    WHERE id = p_bill_id AND user_id = p_user_id AND employer_id = p_employer_id
    RETURNING * INTO v_bill;
  END IF;
  RETURN to_jsonb(v_bill);
END;
$$;

REVOKE ALL ON FUNCTION public.link_financial_vendor_bill(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_financial_vendor_bill(UUID, UUID, UUID, UUID)
  TO service_role;

COMMIT;
