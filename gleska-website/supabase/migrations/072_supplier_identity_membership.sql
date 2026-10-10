BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  description TEXT,
  website TEXT,
  operational_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (operational_status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.supplier_company_private_profiles (
  company_id UUID PRIMARY KEY REFERENCES public.supplier_companies(id) ON DELETE CASCADE,
  registered_name TEXT,
  registration_number TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  registered_address TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.supplier_company_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.supplier_companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  invited_email TEXT,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('ACTIVE', 'PENDING', 'REVOKED')),
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supplier_membership_pending_email_check CHECK (
    (status = 'PENDING' AND invited_email IS NOT NULL)
    OR (status <> 'PENDING' AND invited_email IS NULL)
  ),
  CONSTRAINT supplier_membership_invite_email_normalized CHECK (
    invited_email IS NULL OR invited_email = lower(trim(invited_email))
  ),
  CONSTRAINT supplier_membership_owner_check CHECK (
    role <> 'OWNER'
    OR (user_id IS NOT NULL AND status = 'ACTIVE')
  )
);

ALTER TABLE public.supplier_company_memberships
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
UPDATE public.supplier_company_memberships
SET expires_at = created_at + INTERVAL '7 days'
WHERE expires_at IS NULL;
ALTER TABLE public.supplier_company_memberships
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '7 days'),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_membership_company_user_unique
  ON public.supplier_company_memberships(company_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_membership_pending_email_unique
  ON public.supplier_company_memberships(company_id, invited_email)
  WHERE status = 'PENDING' AND invited_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_membership_single_owner_unique
  ON public.supplier_company_memberships(company_id)
  WHERE role = 'OWNER' AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS supplier_membership_user_status_idx
  ON public.supplier_company_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS supplier_membership_invited_email_status_idx
  ON public.supplier_company_memberships(invited_email, status)
  WHERE invited_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.supplier_company_membership_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.supplier_companies(id) ON DELETE RESTRICT,
  membership_id UUID REFERENCES public.supplier_company_memberships(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('OWNER_CREATED', 'INVITED', 'ACCEPTED', 'ROLE_CHANGED', 'REVOKED')
  ),
  previous_role TEXT CHECK (previous_role IN ('OWNER', 'ADMIN', 'MEMBER')),
  new_role TEXT CHECK (new_role IN ('OWNER', 'ADMIN', 'MEMBER')),
  previous_status TEXT CHECK (previous_status IN ('ACTIVE', 'PENDING', 'REVOKED')),
  new_status TEXT CHECK (new_status IN ('ACTIVE', 'PENDING', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS supplier_membership_events_company_created_idx
  ON public.supplier_company_membership_events(company_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_supplier_membership_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := CASE
      WHEN NEW.role = 'OWNER' THEN 'OWNER_CREATED'
      ELSE 'INVITED'
    END;
    INSERT INTO public.supplier_company_membership_events (
      company_id, membership_id, actor_user_id, event_type,
      new_role, new_status
    )
    VALUES (
      NEW.company_id, NEW.id, COALESCE(NEW.updated_by, NEW.created_by),
      v_event_type, NEW.role, NEW.status
    );
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.role IS DISTINCT FROM NEW.role THEN
    v_event_type := CASE
      WHEN OLD.status = 'PENDING' AND NEW.status = 'ACTIVE' THEN 'ACCEPTED'
      WHEN NEW.status = 'REVOKED' THEN 'REVOKED'
      WHEN OLD.role IS DISTINCT FROM NEW.role THEN 'ROLE_CHANGED'
      ELSE 'INVITED'
    END;
    INSERT INTO public.supplier_company_membership_events (
      company_id, membership_id, actor_user_id, event_type,
      previous_role, new_role, previous_status, new_status
    )
    VALUES (
      NEW.company_id, NEW.id, COALESCE(NEW.updated_by, NEW.created_by),
      v_event_type, OLD.role, NEW.role, OLD.status, NEW.status
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_membership_audit_trigger
  ON public.supplier_company_memberships;
CREATE TRIGGER supplier_membership_audit_trigger
  AFTER INSERT OR UPDATE ON public.supplier_company_memberships
  FOR EACH ROW EXECUTE FUNCTION public.record_supplier_membership_event();

DROP TRIGGER IF EXISTS update_supplier_companies_updated_at
  ON public.supplier_companies;
CREATE TRIGGER update_supplier_companies_updated_at
  BEFORE UPDATE ON public.supplier_companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_supplier_private_profiles_updated_at
  ON public.supplier_company_private_profiles;
CREATE TRIGGER update_supplier_private_profiles_updated_at
  BEFORE UPDATE ON public.supplier_company_private_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_supplier_memberships_updated_at
  ON public.supplier_company_memberships;
CREATE TRIGGER update_supplier_memberships_updated_at
  BEFORE UPDATE ON public.supplier_company_memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.supplier_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_company_private_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_company_membership_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supplier members can view their companies"
  ON public.supplier_companies;
CREATE POLICY "Supplier members can view their companies"
  ON public.supplier_companies FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.company_id = supplier_companies.id
        AND membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "Supplier users can view their own memberships"
  ON public.supplier_company_memberships;
CREATE POLICY "Supplier users can view their own memberships"
  ON public.supplier_company_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Supplier owners and admins can view private company details"
  ON public.supplier_company_private_profiles;
CREATE POLICY "Supplier owners and admins can view private company details"
  ON public.supplier_company_private_profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.company_id = supplier_company_private_profiles.company_id
        AND membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
        AND membership.role IN ('OWNER', 'ADMIN')
    )
  );

DROP POLICY IF EXISTS "Supplier owners and admins can view membership history"
  ON public.supplier_company_membership_events;
CREATE POLICY "Supplier owners and admins can view membership history"
  ON public.supplier_company_membership_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.company_id = supplier_company_membership_events.company_id
        AND membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
        AND membership.role IN ('OWNER', 'ADMIN')
    )
  );

REVOKE ALL ON public.supplier_companies,
  public.supplier_company_private_profiles,
  public.supplier_company_memberships,
  public.supplier_company_membership_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supplier_companies,
  public.supplier_company_private_profiles,
  public.supplier_company_memberships,
  public.supplier_company_membership_events TO authenticated;
GRANT ALL ON public.supplier_companies,
  public.supplier_company_private_profiles,
  public.supplier_company_memberships,
  public.supplier_company_membership_events TO service_role;

REVOKE ALL ON FUNCTION public.record_supplier_membership_event()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_supplier_company_with_owner(
  p_user_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_website TEXT,
  p_registered_name TEXT,
  p_registration_number TEXT,
  p_contact_email TEXT,
  p_contact_phone TEXT,
  p_registered_address TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.supplier_companies;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_user_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_USER_INACTIVE';
  END IF;

  INSERT INTO public.supplier_companies (
    name, description, website, created_by
  )
  VALUES (
    trim(p_name), NULLIF(trim(p_description), ''), NULLIF(trim(p_website), ''), p_user_id
  )
  RETURNING * INTO v_company;

  INSERT INTO public.supplier_company_private_profiles (
    company_id, registered_name, registration_number,
    contact_email, contact_phone, registered_address
  )
  VALUES (
    v_company.id, NULLIF(trim(p_registered_name), ''),
    NULLIF(trim(p_registration_number), ''), NULLIF(lower(trim(p_contact_email)), ''),
    NULLIF(trim(p_contact_phone), ''), NULLIF(trim(p_registered_address), '')
  );

  INSERT INTO public.supplier_company_memberships (
    company_id, user_id, role, status, created_by, accepted_at
  )
  VALUES (v_company.id, p_user_id, 'OWNER', 'ACTIVE', p_user_id, NOW());

  RETURN to_jsonb(v_company);
END;
$$;

REVOKE ALL ON FUNCTION public.create_supplier_company_with_owner(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_supplier_company_with_owner(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.transfer_supplier_company_ownership(
  p_company_id UUID,
  p_current_owner_id UUID,
  p_new_owner_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_owner_id UUID;
  v_new_owner_id UUID;
BEGIN
  IF p_current_owner_id = p_new_owner_id THEN
    RAISE EXCEPTION 'SUPPLIER_OWNER_TRANSFER_TARGET_INVALID';
  END IF;

  SELECT id INTO v_old_owner_id
  FROM public.supplier_company_memberships
  WHERE company_id = p_company_id
    AND user_id = p_current_owner_id
    AND role = 'OWNER'
    AND status = 'ACTIVE'
  FOR UPDATE;

  SELECT id INTO v_new_owner_id
  FROM public.supplier_company_memberships
  WHERE company_id = p_company_id
    AND user_id = p_new_owner_id
    AND role IN ('ADMIN', 'MEMBER')
    AND status = 'ACTIVE'
  FOR UPDATE;

  IF v_old_owner_id IS NULL OR v_new_owner_id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_OWNER_TRANSFER_NOT_ALLOWED';
  END IF;

  UPDATE public.supplier_company_memberships
  SET role = 'ADMIN', updated_by = p_current_owner_id
  WHERE id = v_old_owner_id;

  UPDATE public.supplier_company_memberships
  SET role = 'OWNER', updated_by = p_current_owner_id
  WHERE id = v_new_owner_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_supplier_company_ownership(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_supplier_company_ownership(
  UUID, UUID, UUID
) TO service_role;

COMMIT;
