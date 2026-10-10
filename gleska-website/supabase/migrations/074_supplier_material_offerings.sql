BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_material_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL
    REFERENCES public.supplier_companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL
    CHECK (length(trim(name)) BETWEEN 2 AND 240),
  specification TEXT
    CHECK (specification IS NULL OR length(specification) <= 2000),
  unit TEXT NOT NULL
    CHECK (length(trim(unit)) BETWEEN 1 AND 48),
  indicative_price NUMERIC(18, 4)
    CHECK (indicative_price IS NULL OR indicative_price > 0),
  currency_code TEXT
    CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  minimum_order_quantity NUMERIC(18, 4)
    CHECK (minimum_order_quantity IS NULL OR minimum_order_quantity > 0),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  service_coverage TEXT[] NOT NULL DEFAULT '{}'::TEXT[]
    CHECK (cardinality(service_coverage) <= 50),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supplier_material_offering_price_currency_check CHECK (
    (indicative_price IS NULL) = (currency_code IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS supplier_material_offerings_company_updated_idx
  ON public.supplier_material_offerings(company_id, updated_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS supplier_material_offerings_available_idx
  ON public.supplier_material_offerings(company_id, is_available)
  WHERE archived_at IS NULL;

DROP TRIGGER IF EXISTS update_supplier_material_offerings_updated_at
  ON public.supplier_material_offerings;
CREATE TRIGGER update_supplier_material_offerings_updated_at
  BEFORE UPDATE ON public.supplier_material_offerings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_supplier_material_offering_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_operational_status TEXT;
  v_membership_id UUID;
  v_actor_id UUID;
  v_user_active BOOLEAN;
  v_area TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.updated_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'SUPPLIER_OFFERING_CREATOR_INVALID';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_OFFERING_OWNERSHIP_IMMUTABLE';
  END IF;

  v_actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END;

  SELECT operational_status
  INTO v_operational_status
  FROM public.supplier_companies
  WHERE id = NEW.company_id
  FOR UPDATE;

  SELECT id
  INTO v_membership_id
  FROM public.supplier_company_memberships
  WHERE company_id = NEW.company_id
    AND user_id = v_actor_id
    AND status = 'ACTIVE'
    AND role IN ('OWNER', 'ADMIN')
  FOR UPDATE;

  SELECT is_active
  INTO v_user_active
  FROM public.users
  WHERE id = v_actor_id;

  IF v_operational_status IS DISTINCT FROM 'ACTIVE'
    OR v_membership_id IS NULL
    OR v_user_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'SUPPLIER_OFFERING_WRITE_NOT_ALLOWED';
  END IF;

  FOREACH v_area IN ARRAY NEW.service_coverage LOOP
    IF length(trim(v_area)) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'SUPPLIER_OFFERING_SERVICE_COVERAGE_INVALID';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_material_offering_write_guard
  ON public.supplier_material_offerings;
CREATE TRIGGER supplier_material_offering_write_guard
  BEFORE INSERT OR UPDATE ON public.supplier_material_offerings
  FOR EACH ROW EXECUTE FUNCTION public.validate_supplier_material_offering_write();

ALTER TABLE public.supplier_material_offerings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.supplier_material_offerings
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.supplier_material_offerings TO service_role;
REVOKE ALL ON FUNCTION public.validate_supplier_material_offering_write()
  FROM PUBLIC, anon, authenticated;

COMMIT;
