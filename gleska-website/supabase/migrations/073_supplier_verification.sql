BEGIN;

ALTER TABLE public.supplier_company_memberships
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE public.supplier_company_memberships
SET expires_at = created_at + INTERVAL '7 days'
WHERE expires_at IS NULL;

ALTER TABLE public.supplier_company_memberships
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '7 days'),
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.supplier_companies
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN IF NOT EXISTS verification_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verification_reason TEXT;

ALTER TABLE public.supplier_companies
  DROP CONSTRAINT IF EXISTS supplier_companies_verification_status_check;
ALTER TABLE public.supplier_companies
  ADD CONSTRAINT supplier_companies_verification_status_check
  CHECK (verification_status IN (
    'NOT_SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'
  ));

REVOKE SELECT ON public.supplier_companies FROM authenticated;
GRANT SELECT (
  id, name, description, website, operational_status, created_by,
  created_at, updated_at, verification_status, verification_submitted_at,
  verification_reviewed_at
) ON public.supplier_companies TO authenticated;

CREATE TABLE IF NOT EXISTS public.supplier_verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.supplier_companies(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (
    document_type IN ('BUSINESS_REGISTRATION', 'TAX_REGISTRATION', 'ADDRESS_PROOF', 'OTHER')
  ),
  storage_path TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 10485760),
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS supplier_verification_documents_company_uploaded_idx
  ON public.supplier_verification_documents(company_id, uploaded_at DESC);

CREATE OR REPLACE FUNCTION public.validate_supplier_verification_document_upload()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_operational_status TEXT;
  v_verification_status TEXT;
  v_membership_id UUID;
  v_user_active BOOLEAN;
BEGIN
  SELECT operational_status, verification_status
  INTO v_operational_status, v_verification_status
  FROM public.supplier_companies
  WHERE id = NEW.company_id
  FOR UPDATE;

  SELECT id INTO v_membership_id
  FROM public.supplier_company_memberships
  WHERE company_id = NEW.company_id
    AND user_id = NEW.uploaded_by
    AND status = 'ACTIVE'
    AND role IN ('OWNER', 'ADMIN')
  FOR UPDATE;

  SELECT is_active INTO v_user_active
  FROM public.users
  WHERE id = NEW.uploaded_by;

  IF v_operational_status IS DISTINCT FROM 'ACTIVE'
    OR v_verification_status NOT IN ('NOT_SUBMITTED', 'REJECTED')
    OR v_membership_id IS NULL
    OR v_user_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'SUPPLIER_DOCUMENT_UPLOAD_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_verification_document_upload_guard
  ON public.supplier_verification_documents;
CREATE TRIGGER supplier_verification_document_upload_guard
  BEFORE INSERT ON public.supplier_verification_documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_supplier_verification_document_upload();

REVOKE ALL ON FUNCTION public.validate_supplier_verification_document_upload()
  FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.supplier_verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.supplier_companies(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  previous_status TEXT CHECK (
    previous_status IS NULL OR previous_status IN (
      'NOT_SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'
    )
  ),
  new_status TEXT NOT NULL CHECK (
    new_status IN ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED')
  ),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS supplier_verification_events_company_created_idx
  ON public.supplier_verification_events(company_id, created_at DESC);

ALTER TABLE public.supplier_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_verification_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supplier managers can view verification documents"
  ON public.supplier_verification_documents;
CREATE POLICY "Supplier managers can view verification documents"
  ON public.supplier_verification_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.company_id = supplier_verification_documents.company_id
        AND membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
        AND membership.role IN ('OWNER', 'ADMIN')
    )
  );

DROP POLICY IF EXISTS "Supplier managers can view verification history"
  ON public.supplier_verification_events;
CREATE POLICY "Supplier managers can view verification history"
  ON public.supplier_verification_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.company_id = supplier_verification_events.company_id
        AND membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
        AND membership.role IN ('OWNER', 'ADMIN')
    )
  );

REVOKE ALL ON public.supplier_verification_documents,
  public.supplier_verification_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supplier_verification_documents,
  public.supplier_verification_events TO authenticated;
GRANT ALL ON public.supplier_verification_documents,
  public.supplier_verification_events TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'supplier-verification-documents',
  'supplier-verification-documents',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Supplier managers can upload verification documents"
  ON storage.objects;

DROP POLICY IF EXISTS "Supplier managers can view verification documents"
  ON storage.objects;
CREATE POLICY "Supplier managers can view verification documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'supplier-verification-documents'
    AND (storage.foldername(name))[1] = 'companies'
    AND (storage.foldername(name))[3] = 'verification'
    AND EXISTS (
      SELECT 1
      FROM public.supplier_company_memberships membership
      WHERE membership.company_id::TEXT = (storage.foldername(name))[2]
        AND membership.user_id = auth.uid()
        AND membership.status = 'ACTIVE'
        AND membership.role IN ('OWNER', 'ADMIN')
    )
  );

CREATE OR REPLACE FUNCTION public.submit_supplier_verification(
  p_company_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.supplier_companies;
  v_previous_status TEXT;
  v_membership_id UUID;
BEGIN
  SELECT * INTO v_company
  FROM public.supplier_companies
  WHERE id = p_company_id
  FOR UPDATE;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_COMPANY_NOT_FOUND';
  END IF;
  IF v_company.operational_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'SUPPLIER_COMPANY_NOT_OPERATIONAL';
  END IF;
  SELECT membership.id INTO v_membership_id
  FROM public.supplier_company_memberships membership
  JOIN public.users app_user ON app_user.id = membership.user_id
  WHERE membership.company_id = p_company_id
    AND membership.user_id = p_user_id
    AND membership.status = 'ACTIVE'
    AND membership.role IN ('OWNER', 'ADMIN')
    AND app_user.is_active = TRUE
  FOR UPDATE OF membership;
  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_VERIFICATION_SUBMISSION_FORBIDDEN';
  END IF;
  IF v_company.verification_status NOT IN ('NOT_SUBMITTED', 'REJECTED') THEN
    RAISE EXCEPTION 'SUPPLIER_VERIFICATION_SUBMISSION_NOT_ALLOWED';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.supplier_verification_documents
    WHERE company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_VERIFICATION_DOCUMENT_REQUIRED';
  END IF;

  v_previous_status := v_company.verification_status;
  UPDATE public.supplier_companies
  SET verification_status = 'PENDING_REVIEW',
      verification_submitted_at = NOW(),
      verification_reviewed_at = NULL,
      verification_reviewed_by = NULL,
      verification_reason = NULL
  WHERE id = p_company_id
  RETURNING * INTO v_company;

  INSERT INTO public.supplier_verification_events (
    company_id, actor_user_id, previous_status, new_status
  )
  VALUES (p_company_id, p_user_id, v_previous_status, 'PENDING_REVIEW');

  RETURN to_jsonb(v_company);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_supplier_verification(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_supplier_verification(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.review_supplier_verification(
  p_company_id UUID,
  p_reviewer_id UUID,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.supplier_companies;
  v_previous_status TEXT;
  v_reason TEXT := NULLIF(trim(p_reason), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_reviewer_id
      AND role = 'ADMIN'
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_VERIFICATION_ADMIN_REQUIRED';
  END IF;
  IF p_new_status NOT IN ('VERIFIED', 'REJECTED', 'SUSPENDED') THEN
    RAISE EXCEPTION 'SUPPLIER_VERIFICATION_STATUS_INVALID';
  END IF;
  IF p_new_status IN ('REJECTED', 'SUSPENDED') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_VERIFICATION_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_company
  FROM public.supplier_companies
  WHERE id = p_company_id
  FOR UPDATE;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_COMPANY_NOT_FOUND';
  END IF;
  v_previous_status := v_company.verification_status;
  IF NOT (
    (v_previous_status = 'PENDING_REVIEW' AND p_new_status IN ('VERIFIED', 'REJECTED'))
    OR (v_previous_status = 'VERIFIED' AND p_new_status = 'SUSPENDED')
    OR (v_previous_status = 'SUSPENDED' AND p_new_status = 'VERIFIED')
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_VERIFICATION_TRANSITION_NOT_ALLOWED';
  END IF;
  IF v_previous_status = 'SUSPENDED' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_VERIFICATION_REASON_REQUIRED';
  END IF;

  UPDATE public.supplier_companies
  SET verification_status = p_new_status,
      verification_reviewed_at = NOW(),
      verification_reviewed_by = p_reviewer_id,
      verification_reason = v_reason
  WHERE id = p_company_id
  RETURNING * INTO v_company;

  INSERT INTO public.supplier_verification_events (
    company_id, actor_user_id, previous_status, new_status, reason
  )
  VALUES (p_company_id, p_reviewer_id, v_previous_status, p_new_status, v_reason);

  RETURN to_jsonb(v_company);
END;
$$;

REVOKE ALL ON FUNCTION public.review_supplier_verification(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_supplier_verification(UUID, UUID, TEXT, TEXT)
  TO service_role;

COMMIT;
