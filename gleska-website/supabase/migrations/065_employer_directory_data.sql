-- The base schema creates employer_profiles; stop with a clear instruction if
-- this incremental migration is run before migration 001.
DO $$
BEGIN
  IF to_regclass('public.employer_profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing public.employer_profiles. Run 001_create_schema.sql before 065_employer_directory_data.sql.';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.employer_onboarding_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID UNIQUE NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  business_name TEXT,
  business_type TEXT,
  business_category TEXT,
  industry_category TEXT,
  industry_type TEXT,
  registered_address TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gstin TEXT,
  registration_number TEXT,
  work_location TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  nature_of_business TEXT,
  number_of_proprietors INTEGER,
  company_email TEXT,
  company_phone TEXT,
  proprietor_name TEXT,
  proprietor_names JSONB,
  proprietor_aadhaar TEXT,
  director_name TEXT,
  director_phone TEXT,
  director_email TEXT,
  director_address TEXT,
  director_aadhaar TEXT,
  website_url TEXT,
  annual_revenue TEXT,
  description TEXT,
  services_required JSONB,
  pan_number TEXT,
  cin_number TEXT,
  udyam_number TEXT,
  tan_number TEXT,
  director_data JSONB,
  bank_account_number TEXT,
  bank_ifsc TEXT,
  bank_account_holder_name TEXT,
  business_document_url TEXT,
  hiring_mode TEXT NOT NULL DEFAULT 'MANUAL',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.employer_onboarding_details
  ADD COLUMN IF NOT EXISTS directory_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.employer_onboarding_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employers can view their own onboarding details"
  ON public.employer_onboarding_details;
CREATE POLICY "Employers can view their own onboarding details"
  ON public.employer_onboarding_details FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      INNER JOIN public.users u ON u.id = ep.user_id
      WHERE u.id = auth.uid()
      AND ep.id = employer_onboarding_details.employer_id
    )
  );

DROP POLICY IF EXISTS "Employers can update their own onboarding details"
  ON public.employer_onboarding_details;
CREATE POLICY "Employers can update their own onboarding details"
  ON public.employer_onboarding_details FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      INNER JOIN public.users u ON u.id = ep.user_id
      WHERE u.id = auth.uid()
      AND ep.id = employer_onboarding_details.employer_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      INNER JOIN public.users u ON u.id = ep.user_id
      WHERE u.id = auth.uid()
      AND ep.id = employer_onboarding_details.employer_id
    )
  );

DROP POLICY IF EXISTS "Service role can do anything on employer_onboarding_details"
  ON public.employer_onboarding_details;
CREATE POLICY "Service role can do anything on employer_onboarding_details"
  ON public.employer_onboarding_details FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, UPDATE ON public.employer_onboarding_details TO authenticated;
GRANT ALL ON public.employer_onboarding_details TO service_role;